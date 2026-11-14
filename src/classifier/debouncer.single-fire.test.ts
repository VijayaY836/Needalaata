import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_THRESHOLD,
  debouncerCaseArb,
  runDebouncer,
  type Frame,
} from './test-support/frame-sequences';

/** Frame indices where each maximal qualifying same-label run reaches length N (only runs with L >= N). */
function expectedFireIndices(frames: readonly Frame[], n: number): number[] {
  const expected: number[] = [];
  let runLabel: string | null = null;
  let runLength = 0;
  frames.forEach((f, i) => {
    const qualifies = f.label !== 'none' && f.confidence >= DEFAULT_THRESHOLD;
    if (!qualifies) {
      runLabel = null;
      runLength = 0;
      return;
    }
    if (f.label === runLabel) {
      runLength += 1;
    } else {
      runLabel = f.label;
      runLength = 1;
    }
    if (runLength === n) expected.push(i);
  });
  return expected;
}

describe('debouncer single fire per run', () => {
  // Feature: classifier, Property 4: Exactly one fire per unbroken stable run
  // **Validates: Requirements 10.4, 10.5, 11.5**
  it('fires once at the Nth frame of each run with length >= N, and never otherwise', () => {
    fc.assert(
      fc.property(debouncerCaseArb(DEFAULT_THRESHOLD), ({ stableFrames, frames }) => {
        const fired = runDebouncer(frames, stableFrames, DEFAULT_THRESHOLD);
        expect(fired.map((e) => e.index)).toEqual(expectedFireIndices(frames, stableFrames));
      }),
      { numRuns: 200 },
    );
  });

  it('fires only once for a long unbroken run', () => {
    const frames: Frame[] = Array.from({ length: 50 }, (_, i) => ({
      label: 'lion',
      confidence: 0.9,
      timestamp: i * 33,
    }));
    const fired = runDebouncer(frames, 5, DEFAULT_THRESHOLD);
    expect(fired.map((e) => e.index)).toEqual([4]);
  });
});
