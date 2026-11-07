import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { extractFeatures } from './feature-extractor';
import type { FrameResult, HandObservation, Landmark } from './types';

const RUNS = { numRuns: 100 };

const unit = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });
const lm: fc.Arbitrary<Landmark> = fc.record({ x: unit, y: unit, z: fc.double({ min: -0.5, max: 0.5, noNaN: true }) });
const landmarks = fc.array(lm, { minLength: 21, maxLength: 21 });
const hand: fc.Arbitrary<HandObservation> = fc.record({
  landmarks,
  handedness: fc.constantFrom('Left', 'Right'),
  score: unit,
});
const dims = fc.record({
  frameWidth: fc.integer({ min: 64, max: 1920 }),
  frameHeight: fc.integer({ min: 64, max: 1080 }),
});

const withWrist = (h: HandObservation, x: number, y: number): HandObservation => ({
  ...h,
  landmarks: h.landmarks.map((l, i) => (i === 0 ? { ...l, x, y } : l)),
});

const frame = (hands: HandObservation[], d: { frameWidth: number; frameHeight: number }): FrameResult => ({
  hands,
  timestamp: 0,
  ...d,
});

const wristOf = (h: HandObservation) => h.landmarks[0] as Landmark;

/** Two hands with a mix of distinct x, identical x, and identical x+y wrists. */
const twoHands = fc
  .tuple(hand, hand, unit, unit, unit, unit, fc.constantFrom('distinct', 'sameX', 'sameXY'))
  .map(([a, b, x1, y1, x2, y2, mode]) => {
    if (mode === 'sameXY') return [withWrist(a, x1, y1), withWrist(b, x1, y1)] as const;
    if (mode === 'sameX') return [withWrist(a, x1, y1), withWrist(b, x1, y2)] as const;
    return [withWrist(a, x1, y1), withWrist(b, x2, y2)] as const;
  });

// ---- Helpers for invariance properties (tasks 9.3) ----
type Dims = { frameWidth: number; frameHeight: number };
const EPS = 1e-6;
const close = (a: number, b: number) => Math.abs(a - b) <= EPS * (1 + Math.abs(a) + Math.abs(b));

/** Hand whose middle-MCP is clearly away from the wrist, so the scale is never degenerate. */
const solidHand = fc.tuple(hand, fc.double({ min: 0.05, max: 0.3, noNaN: true })).map(([h, dx]) => ({
  ...h,
  landmarks: h.landmarks.map((l, i) => {
    if (i !== 9) return l;
    const w = h.landmarks[0] as Landmark;
    return { ...l, x: w.x + dx };
  }),
}));

/** Two solid hands whose wrist x differ clearly, so slot order is stable under transforms. */
const separatedPair = fc
  .tuple(solidHand, solidHand, fc.double({ min: 0, max: 0.4, noNaN: true }), fc.double({ min: 0.5, max: 0.9, noNaN: true }))
  .map(([a, b, x1, x2]) => [withWrist(a, x1, (a.landmarks[0] as Landmark).y), withWrist(b, x2, (b.landmarks[0] as Landmark).y)] as const);

const translate = (h: HandObservation, tx: number, ty: number): HandObservation => ({
  ...h,
  landmarks: h.landmarks.map((l) => ({ x: l.x + tx, y: l.y + ty, z: l.z })),
});

/** Uniform scale about (cx, cy, cz) in aspect-corrected space, mapped back to display space. */
const scaleAbout = (
  h: HandObservation,
  d: Dims,
  s: number,
  c: { x: number; y: number; z: number },
): HandObservation => ({
  ...h,
  landmarks: h.landmarks.map((l) => {
    const xc = l.x * d.frameWidth;
    const yc = l.y * d.frameHeight;
    const zc = l.z * d.frameWidth;
    return {
      x: (c.x + s * (xc - c.x)) / d.frameWidth,
      y: (c.y + s * (yc - c.y)) / d.frameHeight,
      z: (c.z + s * (zc - c.z)) / d.frameWidth,
    };
  }),
});

const expectLandmarksClose = (a: Landmark[], b: Landmark[]) => {
  expect(a).toHaveLength(b.length);
  a.forEach((l, i) => {
    const m = b[i] as Landmark;
    expect(close(l.x, m.x)).toBe(true);
    expect(close(l.y, m.y)).toBe(true);
    expect(close(l.z, m.z)).toBe(true);
  });
};

const shift = fc.double({ min: -1, max: 1, noNaN: true });
const factor = fc.double({ min: 0.25, max: 4, noNaN: true });

describe('FeatureExtractor normalization invariants', () => {
  // Feature: vision-and-collection, Property 5: Normalized landmarks are translation invariant
  it('Property 5: translation in normalized space leaves Normalized_Landmarks unchanged', () => {
    fc.assert(
      fc.property(solidHand, dims, shift, shift, (h, d, tx, ty) => {
        const before = extractFeatures(frame([h], d)).slots[0].normalizedLandmarks;
        const after = extractFeatures(frame([translate(h, tx, ty)], d)).slots[0].normalizedLandmarks;
        expectLandmarksClose(before, after);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 6: Normalized landmarks are scale invariant
  it('Property 6: uniform scale about the wrist leaves Normalized_Landmarks unchanged', () => {
    fc.assert(
      fc.property(solidHand, dims, factor, (h, d, s) => {
        const w = h.landmarks[0] as Landmark;
        const c = { x: w.x * d.frameWidth, y: w.y * d.frameHeight, z: w.z * d.frameWidth };
        const before = extractFeatures(frame([h], d)).slots[0].normalizedLandmarks;
        const after = extractFeatures(frame([scaleAbout(h, d, s, c)], d)).slots[0].normalizedLandmarks;
        expectLandmarksClose(before, after);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 7: Inter-hand features are translation and scale invariant
  it('Property 7: wrist offset invariant to shared translation and shared uniform scale', () => {
    fc.assert(
      fc.property(separatedPair, dims, shift, shift, factor, shift, shift, ([a, b], d, tx, ty, s, cx, cy) => {
        const base = extractFeatures(frame([a, b], d)).interHand.wristOffset;

        const t = extractFeatures(frame([translate(a, tx, ty), translate(b, tx, ty)], d)).interHand.wristOffset;
        expect(close(base.x, t.x) && close(base.y, t.y) && close(base.z, t.z)).toBe(true);

        const c = { x: cx * d.frameWidth, y: cy * d.frameHeight, z: 0 };
        const sc = extractFeatures(frame([scaleAbout(a, d, s, c), scaleAbout(b, d, s, c)], d)).interHand.wristOffset;
        expect(close(base.x, sc.x) && close(base.y, sc.y) && close(base.z, sc.z)).toBe(true);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 10: Inter-hand wrist offset zero-filled when a hand is missing
  it('Property 10: offset is zero and handCount equals present slots when a hand is missing', () => {
    fc.assert(
      fc.property(fc.array(hand, { minLength: 0, maxLength: 1 }), dims, (hands, d) => {
        const r = extractFeatures(frame(hands, d));
        expect(r.interHand.wristOffset).toEqual({ x: 0, y: 0, z: 0 });
        expect(r.interHand.handCount).toBe(r.slots.filter((s) => s.present).length);
        expect(r.interHand.handCount).toBe(hands.length);
      }),
      RUNS,
    );
  });
});

describe('FeatureExtractor properties', () => {
  // Feature: vision-and-collection, Property 1: Single-hand goes to slot 0
  it('Property 1: single hand goes to slot 0, slot 1 absent', () => {
    fc.assert(
      fc.property(hand, dims, (h, d) => {
        const r = extractFeatures(frame([h], d));
        expect(r.slots[0].present).toBe(true);
        expect(r.slots[0].rawLandmarks).toEqual(h.landmarks);
        expect(r.slots[1].present).toBe(false);
        expect(r.interHand.handCount).toBe(1);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 2: Two-hand slot assignment by wrist x with deterministic tiebreak
  it('Property 2: two hands ordered by wrist x, then wrist y, then higher score', () => {
    fc.assert(
      fc.property(twoHands, dims, ([a, b], d) => {
        const r = extractFeatures(frame([a, b], d));
        const [s0, s1] = r.slots;
        expect(s0.present && s1.present).toBe(true);
        const w0 = s0.rawLandmarks[0] as Landmark;
        const w1 = s1.rawLandmarks[0] as Landmark;
        expect(w0.x).toBeLessThanOrEqual(w1.x);
        if (w0.x === w1.x) {
          expect(w0.y).toBeLessThanOrEqual(w1.y);
          if (w0.y === w1.y) expect(s0.score).toBeGreaterThanOrEqual(s1.score);
        }
        expect(r.interHand.handCount).toBe(2);
        // wrists are the same multiset as the inputs
        const ins = [wristOf(a), wristOf(b)].map((w) => `${w.x},${w.y}`).sort();
        expect([`${w0.x},${w0.y}`, `${w1.x},${w1.y}`].sort()).toEqual(ins);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 3: Slot assignment independent of detection order
  it('Property 3: [a,b] and [b,a] yield identical results', () => {
    fc.assert(
      fc.property(twoHands, dims, ([a, b], d) => {
        // Fully tied hands (same wrist and score) are interchangeable; make scores distinct in that case.
        const b2 = wristOf(a).x === wristOf(b).x && wristOf(a).y === wristOf(b).y && a.score === b.score
          ? { ...b, score: a.score === 1 ? 0.5 : Math.min(1, a.score + 0.25) }
          : b;
        const r1 = extractFeatures(frame([a, b2], d));
        const r2 = extractFeatures(frame([b2, a], d));
        expect(r2).toEqual(r1);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 4: Raw landmarks preserved in display space unchanged
  it('Property 4: raw landmarks equal input display-space landmarks', () => {
    fc.assert(
      fc.property(fc.array(hand, { minLength: 1, maxLength: 2 }), dims, (hands, d) => {
        const r = extractFeatures(frame(hands, d));
        const raws = r.slots.filter((s) => s.present).map((s) => s.rawLandmarks);
        for (const raw of raws) {
          expect(hands.some((h) => JSON.stringify(h.landmarks) === JSON.stringify(raw))).toBe(true);
          for (const l of raw) {
            expect(l.x).toBeGreaterThanOrEqual(0);
            expect(l.x).toBeLessThanOrEqual(1);
            expect(l.y).toBeGreaterThanOrEqual(0);
            expect(l.y).toBeLessThanOrEqual(1);
          }
        }
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 8: Absent slots store exactly zeros
  it('Property 8: absent slots are all-zero raw and normalized, present=false', () => {
    fc.assert(
      fc.property(fc.array(hand, { minLength: 0, maxLength: 1 }), dims, (hands, d) => {
        const r = extractFeatures(frame(hands, d));
        const zeros = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
        for (const s of r.slots) {
          if (!s.present) {
            expect(s.rawLandmarks).toEqual(zeros);
            expect(s.normalizedLandmarks).toEqual(zeros);
          }
        }
        if (hands.length === 0) {
          expect(r.slots[0].present).toBe(false);
          expect(r.interHand.wristOffset).toEqual({ x: 0, y: 0, z: 0 });
        }
        expect(r.slots[1].present).toBe(false);
      }),
      RUNS,
    );
  });

  // Feature: vision-and-collection, Property 9: Fixed-length feature output regardless of hand count
  it('Property 9: output always has 2 slots of 21x3 landmarks', () => {
    fc.assert(
      fc.property(fc.array(hand, { minLength: 0, maxLength: 2 }), dims, (hands, d) => {
        const r = extractFeatures(frame(hands, d));
        expect(r.slots).toHaveLength(2);
        for (const s of r.slots) {
          expect(s.rawLandmarks).toHaveLength(21);
          expect(s.normalizedLandmarks).toHaveLength(21);
        }
        expect(r.interHand.handCount).toBe(hands.length);
      }),
      RUNS,
    );
  });
});
