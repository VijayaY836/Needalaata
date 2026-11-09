import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createSilhouetteRenderer } from './silhouette-renderer';
import type { FrameResult, Landmark } from './types';

// Vitest runs in node (no DOM), so use a recording fake canvas/2D context.
// **Validates: Requirements 4.2**

interface Call {
  name: string;
  args: unknown[];
}

class FakeCanvas {
  calls: Call[] = [];
  ctx: Record<string, unknown>;
  constructor(public width: number, public height: number) {
    const calls = this.calls;
    const record = (name: string) => (...args: unknown[]) => {
      calls.push({ name, args });
    };
    this.ctx = {
      save: record('save'),
      restore: record('restore'),
      beginPath: record('beginPath'),
      closePath: record('closePath'),
      moveTo: record('moveTo'),
      lineTo: record('lineTo'),
      fill: record('fill'),
      stroke: record('stroke'),
      fillRect: record('fillRect'),
      drawImage: record('drawImage'),
      setTransform: record('setTransform'),
      transform: record('transform'),
      scale: record('scale'),
      translate: record('translate'),
      rotate: record('rotate'),
    };
  }
  getContext() {
    return this.ctx;
  }
}

const g = globalThis as unknown as { document?: unknown };
let originalDocument: unknown;
const created: FakeCanvas[] = [];

beforeAll(() => {
  originalDocument = g.document;
  g.document = {
    createElement: () => {
      const c = new FakeCanvas(1, 1);
      created.push(c);
      return new Proxy(c, {
        set(t, k, v) {
          (t as unknown as Record<string, unknown>)[k as string] = v;
          return true;
        },
      });
    },
  };
});

afterAll(() => {
  g.document = originalDocument;
});

function frameWithHandAtX(x: number): FrameResult {
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x,
    y: 0.3 + i * 0.02,
    z: 0,
  }));
  return {
    hands: [{ landmarks, handedness: 'Left', score: 0.9 }],
    timestamp: 1,
    frameWidth: 640,
    frameHeight: 480,
  };
}

describe('SilhouetteRenderer single flip (Req 4.2)', () => {
  it('draws a mirrored x = 0.2 landmark on the left and applies no extra flip', () => {
    created.length = 0;
    const target = new FakeCanvas(640, 480);
    const renderer = createSilhouetteRenderer(target as unknown as HTMLCanvasElement);
    renderer.render(frameWithHandAtX(0.2), {
      color: '#ffb066',
      background: '#0a0a0a',
      blurRadius: 0,
    });

    // Offscreen canvas holds the hand strokes.
    const off = created[0];
    if (!off) throw new Error('expected offscreen canvas to be created');
    const points = off.calls.filter((c) => c.name === 'moveTo' || c.name === 'lineTo');
    expect(points.length).toBeGreaterThan(0);
    for (const p of points) {
      const px = p.args[0] as number;
      expect(px / off.width).toBeCloseTo(0.2, 5);
      expect(px).toBeLessThan(off.width / 2); // left half
    }

    // No flip/scale/rotate on either surface; only identity setTransform.
    for (const c of [off, target]) {
      for (const call of c.calls) {
        expect(['scale', 'translate', 'rotate', 'transform']).not.toContain(call.name);
        if (call.name === 'setTransform') {
          expect(call.args).toEqual([1, 0, 0, 1, 0, 0]);
        }
      }
    }

    // Offscreen is composited onto the target at origin, full size (not mirrored).
    const draw = target.calls.find((c) => c.name === 'drawImage');
    expect(draw).toBeDefined();
    const [, sx, sy, sw, sh, dx, dy, dw, dh] = draw!.args as number[];
    expect([sx, sy, dx, dy]).toEqual([0, 0, 0, 0]);
    expect(sw).toBe(off.width);
    expect(sh).toBe(off.height);
    expect(dw).toBe(target.width);
    expect(dh).toBe(target.height);
  });
});
