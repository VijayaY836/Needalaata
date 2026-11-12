import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { config } from '../../src/config';
import { createCaptureController } from './capture-controller';
import { extractFeatures } from '../../src/vision/feature-extractor';
import { parseExport, serializeExport } from './exporter';
import { decodeMask, encodeMask } from '../../src/vision/mask-generator';
import { createSampleStore } from './sample-store';
import type { FrameResult, HandObservation, Landmark } from './types';

// Cross-module integration: capture -> extract -> persist -> reload -> undo -> export.
// Covers Req 10.3, 15.1-15.3, 16.1, 16.3, 16.4 end to end with real modules (no mocks
// except a deterministic mask source, since the node environment has no canvas).

function hand(wristX: number): HandObservation {
  const landmarks: Landmark[] = Array.from({ length: 21 }, (_, i) => ({
    x: wristX + i * 0.005,
    y: 0.5 - i * 0.01,
    z: 0,
  }));
  return { landmarks, handedness: 'Right', score: 0.9 } as HandObservation;
}

const frame: FrameResult = {
  hands: [hand(0.2)],
  timestamp: 0,
  frameWidth: 640,
  frameHeight: 480,
};

function maskOf(seed: number): Uint8Array {
  const m = new Uint8Array(96 * 96);
  for (let i = 0; i < m.length; i++) m[i] = (i * 31 + seed) % 256;
  return m;
}

describe('collector pipeline integration', () => {
  beforeEach(() => {
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  async function recordBurst(
    store: ReturnType<typeof createSampleStore>,
    start: number,
    wall: number,
    label: 'rabbit' | 'lion',
  ): Promise<void> {
    const c = createCaptureController({
      store,
      maskGenerator: { generate: () => maskOf(wall) },
      isTrackerReady: () => true,
      config: { countdownDurationMs: 0, burstDurationMs: 2000, captureRatePerSecond: 10 },
      wallClock: () => wall,
      newId: () => crypto.randomUUID(),
    });
    c.setLabel(label);
    c.setContributor('Asha');
    c.start(start);
    for (let t = start; t < start + 2100; t += 1000 / 30) {
      c.update(t, frame);
    }
    // Allow fire-and-forget store writes to settle.
    await new Promise((r) => setTimeout(r, 50));
  }

  it('persists bursts, survives reload, undoes the latest burst, and exports byte-exact', async () => {
    const store = createSampleStore();
    await recordBurst(store, 0, 1000, 'rabbit');
    await recordBurst(store, 10000, 2000, 'lion');

    // Simulated reload: a fresh store instance reads from IndexedDB (Req 15.1, 15.2).
    const reloaded = createSampleStore();
    const all = await reloaded.all();
    const counts = await reloaded.countsByLabel();
    expect(counts.rabbit).toBeGreaterThanOrEqual(18);
    expect(counts.lion).toBeGreaterThanOrEqual(18);
    expect(all.length).toBe(counts.rabbit + counts.lion);

    // Feature extraction output is fixed-length (hand in slot 0, slot 1 absent).
    const f = extractFeatures(frame);
    expect(f.slots).toHaveLength(2);
    expect(f.slots[1].present).toBe(false);

    // Undo after reload removes exactly the most recent burst (Req 15.3).
    await reloaded.undoLastBurst();
    const after = await createSampleStore().all();
    expect(after.every((s) => s.label === 'rabbit')).toBe(true);
    expect(after.length).toBe(counts.rabbit);

    // Export round-trip preserves samples and masks byte-for-byte (Req 16.1, 16.3, 16.4).
    const parsed = parseExport(serializeExport(after));
    expect(parsed.samples).toHaveLength(after.length);
    expect(parsed.samples[0]).toEqual(after[0]);
    expect(Array.from(decodeMask(parsed.samples[0]!.maskBase64))).toEqual(
      Array.from(maskOf(1000)),
    );
    expect(parsed.samples[0]!.maskBase64).toBe(encodeMask(maskOf(1000)));
  });
});

// Performance smoke (Req 6 / design "Performance"): the 30 fps target cannot be measured
// in a node environment. It is verified manually by pressing D on the preview page to show
// the FPS overlay. This test asserts the configuration that makes the target achievable:
// the offscreen blur runs at a reduced resolution, and the overlay refresh is throttled.
describe('performance smoke (30 fps target)', () => {
  it('blurs on a downscaled offscreen canvas and throttles the FPS overlay refresh', () => {
    expect(config.silhouetteDownscale).toBeGreaterThan(0);
    expect(config.silhouetteDownscale).toBeLessThan(1);
    expect(config.uiRefreshIntervalMs).toBeGreaterThanOrEqual(100);
    expect(config.fpsOverlayStyle).toBeDefined();
  });
});
