import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { config } from '../../src/config';
import { handScalePx } from '../../src/vision/silhouette-renderer';
import type { RenderOptions, SilhouetteRenderer } from '../../src/vision/silhouette-renderer';
import { extractFeatures } from './feature-extractor';
import {
  computeCropRect,
  createMaskGenerator,
  decodeMask,
  encodeMask,
  maskRenderOptions,
} from './mask-generator';
import type { FrameResult, HandObservation, Landmark } from './types';

const RUNS = { numRuns: 100 };
const SIZE = 96;

// ---- Minimal in-memory canvas (vitest runs in node; there is no DOM) ----
class FakeCanvas {
  data: Uint8ClampedArray;
  constructor(public width: number, public height: number) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  fillRect(x: number, y: number, w: number, h: number, v: number): void {
    const x0 = Math.max(0, Math.round(x));
    const y0 = Math.max(0, Math.round(y));
    const x1 = Math.min(this.width, Math.round(x + w));
    const y1 = Math.min(this.height, Math.round(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) {
        const i = (yy * this.width + xx) * 4;
        this.data[i] = this.data[i + 1] = this.data[i + 2] = v;
        this.data[i + 3] = 255;
      }
    }
  }
  getContext() {
    let fill = 0;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      set fillStyle(s: string) {
        fill = s === '#ffffff' ? 255 : 0;
      },
      set imageSmoothingEnabled(_: boolean) {},
      set imageSmoothingQuality(_: string) {},
      save() {},
      restore() {},
      setTransform() {},
      fillRect: (x: number, y: number, w: number, h: number) => self.fillRect(x, y, w, h, fill),
      // Nearest-neighbour drawImage.
      drawImage(
        src: FakeCanvas, sx: number, sy: number, sw: number, sh: number,
        dx: number, dy: number, dw: number, dh: number,
      ) {
        for (let yy = Math.max(0, Math.floor(dy)); yy < Math.min(self.height, Math.ceil(dy + dh)); yy++) {
          for (let xx = Math.max(0, Math.floor(dx)); xx < Math.min(self.width, Math.ceil(dx + dw)); xx++) {
            const u = Math.min(src.width - 1, Math.max(0, Math.floor(sx + ((xx + 0.5 - dx) / dw) * sw)));
            const v = Math.min(src.height - 1, Math.max(0, Math.floor(sy + ((yy + 0.5 - dy) / dh) * sh)));
            const s = src.data[(v * src.width + u) * 4] ?? 0;
            const i = (yy * self.width + xx) * 4;
            self.data[i] = self.data[i + 1] = self.data[i + 2] = s;
            self.data[i + 3] = 255;
          }
        }
      },
      getImageData: (_x: number, _y: number, w: number, h: number) => ({
        data: self.data.slice(0, w * h * 4),
      }),
    };
  }
}

/** Stand-in for the shared SilhouetteRenderer: records options, paints a white box over the hands. */
function fakeRenderer() {
  const calls: RenderOptions[] = [];
  const renderer: SilhouetteRenderer = {
    render() {},
    renderToCanvas(frame, options) {
      calls.push(options);
      const c = new FakeCanvas(Math.round(frame.frameWidth), Math.round(frame.frameHeight));
      c.fillRect(0, 0, c.width, c.height, options.background === '#000000' ? 0 : 255);
      // Paint the union bounding box of all landmarks (at least 1px, kept inside the canvas).
      if (frame.hands.length > 0) {
        const pts = frame.hands.flatMap((h) => h.landmarks);
        const xs = pts.map((l) => l.x * frame.frameWidth);
        const ys = pts.map((l) => l.y * frame.frameHeight);
        const x0 = Math.min(Math.min(...xs), c.width - 1);
        const y0 = Math.min(Math.min(...ys), c.height - 1);
        c.fillRect(x0, y0, Math.max(...xs) - x0 + 1, Math.max(...ys) - y0 + 1, 255);
      }
      return c as unknown as HTMLCanvasElement;
    },
  };
  return { renderer, calls };
}

const g = globalThis as unknown as { document?: unknown };
let originalDocument: unknown;
afterAll(() => {
  g.document = originalDocument;
});

// Canvas created by the generator must honour width/height assigned after creation.
beforeAll(() => {
  originalDocument = g.document;
  g.document = {
    createElement: () =>
      new Proxy(new FakeCanvas(1, 1), {
        set(t, k, v) {
          (t as unknown as Record<string, unknown>)[k as string] = v;
          if (k === 'width' || k === 'height') t.data = new Uint8ClampedArray(t.width * t.height * 4);
          return true;
        },
      }),
  };
});

// ---- Helpers ----
const unit = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
const lm: fc.Arbitrary<Landmark> = fc.record({ x: unit, y: unit, z: fc.double({ min: -0.5, max: 0.5, noNaN: true }) });
const hand: fc.Arbitrary<HandObservation> = fc.record({
  landmarks: fc.array(lm, { minLength: 21, maxLength: 21 }),
  handedness: fc.constantFrom('Left', 'Right'),
  score: unit,
});
const dims = fc.record({
  frameWidth: fc.integer({ min: 64, max: 320 }),
  frameHeight: fc.integer({ min: 64, max: 240 }),
});

const mkFrame = (hands: HandObservation[], d = { frameWidth: 640, frameHeight: 480 }): FrameResult => ({
  hands,
  timestamp: 0,
  ...d,
});

/** Hand centred at (0.5, 0.5) whose wrist-to-middle-MCP distance is proportional to `k`. */
function scaledHand(k: number): HandObservation {
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x: 0.5 + ((i % 5) - 2) * 0.02 * k,
    y: 0.5 + (Math.floor(i / 5) - 2) * 0.02 * k,
    z: 0,
  }));
  return { landmarks, handedness: 'Right', score: 0.9 };
}

describe('MaskGenerator', () => {
  // Feature: vision-and-collection, Property 11: Mask has fixed shape and byte-exact encoding round-trip
  // **Validates: Requirements 11.9, 12.3, 16.4**
  it('Property 11: mask is 96x96 and base64 round-trips byte-exactly', () => {
    fc.assert(
      fc.property(fc.array(hand, { minLength: 1, maxLength: 2 }), dims, (hands, d) => {
        const frame = mkFrame(hands, d);
        const { renderer } = fakeRenderer();
        const slots = extractFeatures(frame).slots;
        const mask = createMaskGenerator(renderer).generate(frame, slots);

        // A non-null crop means a hand is present, so the mask must contain shadow.
        if (computeCropRect(frame, slots) !== null) {
          expect(mask.some((v) => v > 0)).toBe(true);
        }
        expect(mask).toBeInstanceOf(Uint8Array);
        expect(mask.length).toBe(SIZE * SIZE);
        expect(mask.length).toBe(config.maskSize.width * config.maskSize.height);
        // Single-channel: every byte is a plain 0..255 value.
        const decoded = decodeMask(encodeMask(mask));
        expect(decoded.length).toBe(9216);
        expect(Array.from(decoded)).toEqual(Array.from(mask));
      }),
      RUNS,
    );
  });

  it('Property 11: arbitrary 9216-byte masks round-trip through base64 exactly', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 9216, maxLength: 9216 }), (bytes) => {
        expect(Array.from(decodeMask(encodeMask(bytes)))).toEqual(Array.from(bytes));
      }),
      RUNS,
    );
  });

  describe('Property 11 edge cases: byte-exact encodeMask/decodeMask round-trip', () => {
    const N = SIZE * SIZE;
    const single = (i: number) => {
      const m = new Uint8Array(N);
      m[i] = 255;
      return m;
    };
    const cases: Array<[string, Uint8Array]> = [
      ['all-0', new Uint8Array(N)],
      ['all-255', new Uint8Array(N).fill(255)],
      ['single 255 at index 0', single(0)],
      ['single 255 at index 9215', single(9215)],
    ];
    for (const [name, mask] of cases) {
      it(`${name} round-trips byte-exactly`, () => {
        const decoded = decodeMask(encodeMask(mask));
        expect(decoded.length).toBe(N);
        expect(Array.from(decoded)).toEqual(Array.from(mask));
      });
    }

    it('decodeMask throws on a decoded length other than 96*96', () => {
      expect(() => decodeMask(encodeMask(new Uint8Array(N - 1)))).toThrow();
      expect(() => decodeMask(encodeMask(new Uint8Array(N + 1)))).toThrow();
      expect(() => decodeMask('')).toThrow();
    });
  });

  it('asymmetric hand near x = 0.2 yields a non-empty mask (no mirroring mismatch)', () => {
    // Landmarks arrive already mirrored; rawLandmarks must be in the same space. If the crop
    // mirrored again it would target x ~ 0.8 and miss the shadow drawn near x ~ 0.2.
    const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
      x: 0.15 + (i % 5) * 0.02,
      y: 0.4 + Math.floor(i / 5) * 0.03,
      z: 0,
    }));
    const frame = mkFrame([{ landmarks, handedness: 'Left', score: 0.9 }]);
    const slots = extractFeatures(frame).slots;
    const crop = computeCropRect(frame, slots);
    expect(crop).not.toBeNull();
    expect(crop!.x + crop!.width / 2).toBeLessThan(frame.frameWidth * 0.5);
    const { renderer } = fakeRenderer();
    const mask = createMaskGenerator(renderer).generate(frame, slots);
    expect(mask.some((v) => v > 0)).toBe(true);
  });

  it('invokes the shared SilhouetteRenderer with white-on-black options (Req 12.1)', () => {
    const frame = mkFrame([scaledHand(1)]);
    const { renderer, calls } = fakeRenderer();
    const mask = createMaskGenerator(renderer).generate(frame, extractFeatures(frame).slots);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ color: '#ffffff', background: '#000000' });
    expect(calls[0]).toEqual(maskRenderOptions());
    expect(mask.some((v) => v === 255)).toBe(true);
  });

  it('padding scales with Hand_Scale across two different-scale hands (Req 12.2)', () => {
    const expectedFactor = Math.max(config.maskPaddingScale, config.strokeThicknessScale / 2);
    const blur = maskRenderOptions().blurRadius;
    const measure = (k: number) => {
      const h = scaledHand(k);
      const frame = mkFrame([h]);
      const crop = computeCropRect(frame, extractFeatures(frame).slots);
      const xs = h.landmarks.map((l) => l.x * frame.frameWidth);
      const padding = (crop!.width - (Math.max(...xs) - Math.min(...xs))) / 2;
      return { padding, scale: handScalePx(h, frame.frameWidth, frame.frameHeight) };
    };
    const small = measure(1);
    const large = measure(2);

    expect(config.maskBlurRadius).toBe(0);
    expect(large.scale).toBeGreaterThan(small.scale);
    expect(large.padding).toBeGreaterThan(small.padding);
    // padding = max(maskPaddingScale, stroke/2) * handScale + blur, so it stays proportional to scale.
    expect((small.padding - blur) / small.scale).toBeCloseTo(expectedFactor, 5);
    expect((large.padding - blur) / large.scale).toBeCloseTo(expectedFactor, 5);
    expect(large.padding / small.padding).toBeCloseTo(large.scale / small.scale, 5);
  });

  it('label none with no hands yields an all-zero mask (Req 12.4)', () => {
    const frame = mkFrame([]);
    const { renderer, calls } = fakeRenderer();
    const mask = createMaskGenerator(renderer).generate(frame, extractFeatures(frame).slots);

    expect(mask.length).toBe(SIZE * SIZE);
    expect(mask.every((v) => v === 0)).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
