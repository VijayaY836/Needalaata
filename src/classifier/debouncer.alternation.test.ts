import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LABELS, type Label } from '../vision/types';
import {
  DEFAULT_THRESHOLD,
  runDebouncer,
  stableFramesArb,
  type Frame,
} from './test-support/frame-sequences';

const labelArb: fc.Arbitrary<Label> = fc.constantFrom(...LABELS);
const highConfArb = fc.double({ min: DEFAULT_THRESHOLD, max: 1, noNaN: true });

/**
 * Builds frames from runs of length 1..stableFrames-1 where each run's label
 * differs from the previous one (label/label or label/none alternation).
 * No run can reach stableFrames, so nothing may fire.
 */
function alternatingCaseArb(): fc.Arbitrary<{ stableFrames: number; frames: Frame[] }> {
  return stableFramesArb.chain((stableFrames) =>
    fc
      .array(
        fc.record({
          label: labelArb,
          length: fc.integer({ min: 1, max: stableFrames - 1 }),
          confidence: highConfArb,
        }),
        { minLength: 1, maxLength: 20 },
      )
      .map((runs) => {
        // Merge-free: drop runs whose label equals the previous one.
        const kept = runs.filter((r, i) => i === 0 || r.label !== runs[i - 1]?.label);
        const frames: Frame[] = [];
        for (const r of kept) {
          for (let k = 0; k < r.length; k++) {
            frames.push({ label: r.label, confidence: r.confidence, timestamp: frames.length * 33 });
          }
        }
        return { stableFrames, frames };
      }),
  );
}

describe('debouncer rapid alternation', () => {
  // Feature: classifier, Property 2: Rapid alternation never fires
  // **Validates: Requirements 10.8, 11.3**
  it('never fires when no run of equal labels reaches stableFrames', () => {
    fc.assert(
      fc.property(alternatingCaseArb(), ({ stableFrames, frames }) => {
        expect(runDebouncer(frames, stableFrames)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });

  it('never fires for strict alternation of a label and none', () => {
    fc.assert(
      fc.property(
        stableFramesArb,
        fc.constantFrom(...LABELS.filter((l) => l !== 'none')),
        fc.integer({ min: 1, max: 100 }),
        (stableFrames, label, count) => {
          const frames: Frame[] = Array.from({ length: count }, (_, i) => ({
            label: i % 2 === 0 ? label : 'none',
            confidence: 1,
            timestamp: i * 33,
          }));
          expect(runDebouncer(frames, stableFrames)).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});
