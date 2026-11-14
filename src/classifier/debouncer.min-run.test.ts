import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { config } from '../config';
import { DEFAULT_THRESHOLD, debouncerCaseArb, runDebouncer } from './test-support/frame-sequences';

describe('debouncer minimum run length', () => {
  // Feature: classifier, Property 1: No fire without a long enough run
  // **Validates: Requirements 10.2, 11.2**
  it('only fires when the N frames ending at the fire frame share one non-none label at or above threshold', () => {
    fc.assert(
      fc.property(debouncerCaseArb(DEFAULT_THRESHOLD), ({ stableFrames, frames }) => {
        const fired = runDebouncer(frames, stableFrames, DEFAULT_THRESHOLD);
        for (const { index, event } of fired) {
          expect(index).toBeGreaterThanOrEqual(stableFrames - 1);
          const window = frames.slice(index - stableFrames + 1, index + 1);
          expect(window).toHaveLength(stableFrames);
          for (const f of window) {
            expect(f.label).toBe(event.label);
            expect(f.label).not.toBe('none');
            expect(f.confidence).toBeGreaterThanOrEqual(DEFAULT_THRESHOLD);
          }
        }
        // Consequently, no qualifying window means nothing fires.
        if (!hasQualifyingWindow(frames, stableFrames)) {
          expect(fired).toHaveLength(0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it('uses the Config threshold of 0.85', () => {
    expect(config.classifier.confidenceThreshold).toBe(DEFAULT_THRESHOLD);
  });
});

function hasQualifyingWindow(
  frames: ReadonlyArray<{ label: string; confidence: number }>,
  n: number,
): boolean {
  let run = 0;
  let prev: string | null = null;
  for (const f of frames) {
    if (f.label === 'none' || !(f.confidence >= DEFAULT_THRESHOLD)) {
      run = 0;
      prev = null;
      continue;
    }
    run = f.label === prev ? run + 1 : 1;
    prev = f.label;
    if (run >= n) return true;
  }
  return false;
}
