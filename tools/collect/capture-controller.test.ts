import { describe, expect, it } from 'vitest';
import { createCaptureController } from './capture-controller';
import type { FrameResult, Sample } from './types';

const frame: FrameResult = { hands: [], timestamp: 0, frameWidth: 640, frameHeight: 480 };
const cfg = { countdownDurationMs: 3000, burstDurationMs: 4000, captureRatePerSecond: 10 };

function setup(opts: { ready?: boolean } = {}) {
  const puts: Sample[] = [];
  const prompts: string[] = [];
  let n = 0;
  let ready = opts.ready ?? true;
  const c = createCaptureController({
    store: { put: async (s) => void puts.push(s) },
    maskGenerator: { generate: () => new Uint8Array(96 * 96) },
    isTrackerReady: () => ready,
    config: cfg,
    wallClock: () => 1234,
    newId: () => `id${n++}`,
    onPrompt: (m) => prompts.push(m),
  });
  c.setLabel('rabbit');
  c.setContributor('Asha');
  return { c, puts, prompts, setReady: (r: boolean) => (ready = r) };
}

function run(c: ReturnType<typeof setup>['c'], from: number, to: number, fps: number) {
  const step = 1000 / fps;
  for (let t = from; t <= to + 1e-6; t += step) c.update(t, frame);
}

describe('CaptureController', () => {
  it('blocks recording until tracker is ready', () => {
    const { c, setReady } = setup({ ready: false });
    expect(c.canRecord()).toBe(false);
    expect(c.start(0)).toMatchObject({ ok: false, reason: 'tracker-not-ready' });
    setReady(true);
    expect(c.canRecord()).toBe(true);
  });

  it('blocks and prompts when contributor name is empty', () => {
    const { c, prompts } = setup();
    c.setContributor('   ');
    expect(c.start(0)).toMatchObject({ ok: false, reason: 'name-required' });
    expect(prompts).toHaveLength(1);
    expect(c.state).toBe('ready');
  });

  it.each([30, 60])('countdown, ~10 samples/s at %i fps, then returns to ready', (fps) => {
    const { c, puts } = setup();
    expect(c.start(0)).toEqual({ ok: true });
    expect(c.state).toBe('countdown');
    run(c, 0, 2900, fps);
    expect(c.state).toBe('countdown');
    expect(puts).toHaveLength(0);
    run(c, 3000, 7100, fps);
    expect(c.state).toBe('ready');
    expect(puts.length).toBeGreaterThanOrEqual(38);
    expect(puts.length).toBeLessThanOrEqual(41);
  });

  it('labels samples and mints a new burst id per burst', () => {
    const { c, puts } = setup();
    c.start(0);
    run(c, 0, 7100, 30);
    c.start(8000);
    run(c, 8000, 15100, 30);
    const bursts = new Set(puts.map((s) => s.burstId));
    expect(bursts.size).toBe(2);
    for (const s of puts) {
      expect(s).toMatchObject({
        label: 'rabbit',
        sessionId: c.sessionId,
        contributor: 'Asha',
        timestamp: 1234,
      });
    }
  });

  it('shows recording indicator only during the burst', () => {
    const { c } = setup();
    c.start(0);
    c.update(1000, frame);
    expect(c.isRecording).toBe(false);
    c.update(3500, frame);
    expect(c.isRecording).toBe(true);
    c.update(7100, frame);
    expect(c.isRecording).toBe(false);
  });
});

describe('CaptureController capture rate (Req 10.3)', () => {
  /** Runs a 4s burst with the given frame-interval generator; returns sample counts per simulated second. */
  function perSecondCounts(nextStep: () => number): number[] {
    const seconds = 4;
    const counts = new Array<number>(seconds).fill(0);
    let t = 0;
    const c = createCaptureController({
      store: { put: async () => {} },
      maskGenerator: { generate: () => new Uint8Array(96 * 96) },
      isTrackerReady: () => true,
      config: { countdownDurationMs: 0, burstDurationMs: seconds * 1000, captureRatePerSecond: 10 },
      newId: () => 'id',
      onSample: () => {
        const sec = Math.floor(t / 1000);
        if (sec < seconds) counts[sec] = (counts[sec] ?? 0) + 1;
      },
    });
    c.setLabel('rabbit');
    c.setContributor('Asha');
    c.start(0);
    while (t < seconds * 1000 - 1) {
      c.update(t, frame);
      t += nextStep();
    }
    return counts;
  }

  it.each([30, 60, 144])('emits ~10 samples per second at %i fps', (fps) => {
    const counts = perSecondCounts(() => 1000 / fps);
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(9);
      expect(n).toBeLessThanOrEqual(11);
    }
  });

  it('emits ~10 samples per second with irregular frame intervals', () => {
    // Deterministic LCG yielding steps between 5ms and 60ms.
    let seed = 12345;
    const counts = perSecondCounts(() => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return 5 + (seed / 4294967296) * 55;
    });
    for (const n of counts) {
      expect(n).toBeGreaterThanOrEqual(9);
      expect(n).toBeLessThanOrEqual(11);
    }
  });
});
