import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_THRESHOLD,
  debouncerCaseArb,
  runDebouncer,
  type Frame,
} from './test-support/frame-sequences';

const isReset = (f: Frame): boolean => f.label === 'none' || !(f.confidence >= DEFAULT_THRESHOLD);

describe('debouncer run reset', () => {
  // Feature: classifier, Property 3: none and low-confidence frames reset the run
  // **Validates: Requirements 10.6, 10.7, 11.4**
  it('a none or low-confidence frame at k means the next fire needs >= N qualifying frames after k', () => {
    fc.assert(
      fc.property(debouncerCaseArb(DEFAULT_THRESHOLD), ({ stableFrames, frames }) => {
        const fired = runDebouncer(frames, stableFrames);
        for (const { index } of fired) {
          let k = -1;
          for (let j = index; j >= 0; j--) {
            const candidate = frames[j];
            if (!candidate) throw new Error('expected a frame at index ' + j);
            if (isReset(candidate)) {
              k = j;
              break;
            }
          }
          // Frames k+1..index are all qualifying; there must be at least N of them.
          if (index - k < stableFrames) return false;
        }
        return true;
      }),
      { numRuns: 200 },
    );
  });

  it('frames before a reset frame do not affect firing after it', () => {
    fc.assert(
      fc.property(debouncerCaseArb(DEFAULT_THRESHOLD), ({ stableFrames, frames }) => {
        const full = runDebouncer(frames, stableFrames);
        frames.forEach((f, k) => {
          if (!isReset(f)) return;
          const after = frames.slice(k + 1);
          const fresh = runDebouncer(after, stableFrames).map((e) => e.index + k + 1);
          const orig = full.filter((e) => e.index > k).map((e) => e.index);
          expect(orig).toEqual(fresh);
        });
      }),
      { numRuns: 100 },
    );
  });

  it('example: N-1 frames, a low-confidence frame, then N-1 frames never fire', () => {
    const n = 5;
    const good = (i: number): Frame => ({ label: 'lion', confidence: 0.9, timestamp: i });
    const frames: Frame[] = [
      ...Array.from({ length: n - 1 }, (_, i) => good(i)),
      { label: 'lion', confidence: 0.5, timestamp: 99 },
      ...Array.from({ length: n - 1 }, (_, i) => good(100 + i)),
    ];
    expect(runDebouncer(frames, n)).toEqual([]);
  });
});
