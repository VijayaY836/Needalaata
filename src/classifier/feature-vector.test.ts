import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { buildFeatureVector, FEATURE_VECTOR_LENGTH, LANDMARK_VALUES_PER_SLOT } from './feature-vector';
import { extractFeatures } from '../vision/feature-extractor';
import type { FrameResult, HandObservation, Landmark } from '../vision/types';

const landmarkArb: fc.Arbitrary<Landmark> = fc.record({
  x: fc.double({ min: 0, max: 1, noNaN: true }),
  y: fc.double({ min: 0, max: 1, noNaN: true }),
  z: fc.double({ min: -0.5, max: 0.5, noNaN: true }),
});

const handArb: fc.Arbitrary<HandObservation> = fc.record({
  landmarks: fc.array(landmarkArb, { minLength: 21, maxLength: 21 }),
  handedness: fc.constantFrom('Left', 'Right'),
  score: fc.double({ min: 0, max: 1, noNaN: true }),
});

const frameArb: fc.Arbitrary<FrameResult> = fc.record({
  hands: fc.array(handArb, { minLength: 0, maxLength: 2 }),
  timestamp: fc.nat(),
  frameWidth: fc.integer({ min: 160, max: 1920 }),
  frameHeight: fc.integer({ min: 120, max: 1080 }),
});

describe('buildFeatureVector', () => {
  // Feature: classifier, Property 13: Feature vector layout is fixed
  // **Validates: Requirements 5.1, 5.2**
  it('has fixed length, finite values, and the documented layout', () => {
    fc.assert(
      fc.property(frameArb, (frame) => {
        const f = extractFeatures(frame);
        const v = buildFeatureVector(f);

        expect(v.length).toBe(FEATURE_VECTOR_LENGTH);
        expect(FEATURE_VECTOR_LENGTH).toBe(131);
        for (const n of v) expect(Number.isFinite(n)).toBe(true);

        const expected: number[] = [];
        for (const slot of f.slots) {
          if (slot.present) {
            for (const p of slot.normalizedLandmarks) expected.push(p.x, p.y, p.z);
          } else {
            for (let i = 0; i < LANDMARK_VALUES_PER_SLOT; i++) expected.push(0);
          }
        }
        expected.push(f.slots[0].present ? 1 : 0, f.slots[1].present ? 1 : 0);
        const o = f.interHand.wristOffset;
        expected.push(o.x, o.y, o.z);

        expect(Array.from(v)).toEqual(Array.from(Float32Array.from(expected)));

        // Absent slots are all zero.
        f.slots.forEach((slot, s) => {
          if (!slot.present) {
            const seg = v.slice(s * LANDMARK_VALUES_PER_SLOT, (s + 1) * LANDMARK_VALUES_PER_SLOT);
            expect(seg.every((n) => n === 0)).toBe(true);
          }
        });
      }),
      { numRuns: 100 },
    );
  });
});
