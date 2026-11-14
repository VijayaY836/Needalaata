import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { createDebouncer } from './debouncer';
import {
  DEFAULT_THRESHOLD,
  debouncerCaseArb,
  runDebouncer,
  stableFramesArb,
} from './test-support/frame-sequences';

describe('debouncer event content', () => {
  // Feature: classifier, Property 5: Fired event matches its run
  // **Validates: Requirements 10.3, 11.6**
  it('fires events whose label, confidence and timestamp come from the run and its completing frame', () => {
    fc.assert(
      fc.property(debouncerCaseArb(DEFAULT_THRESHOLD), ({ stableFrames, frames }) => {
        const fired = runDebouncer(frames, stableFrames, DEFAULT_THRESHOLD);
        for (const { index, event } of fired) {
          const completing = frames[index];
          if (!completing) throw new Error('expected a completing frame');
          expect(event.label).toBe(completing.label);
          expect(event.confidence).toBe(completing.confidence);
          expect(event.timestamp).toBe(completing.timestamp);
          // Every frame of the run's minimum window carries the event label.
          for (const f of frames.slice(index - stableFrames + 1, index + 1)) {
            expect(f.label).toBe(event.label);
          }
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: classifier, Property 5: Fired event matches its run
  // **Validates: Requirements 10.3, 11.6**
  it('reports the confidence and timestamp of the Nth frame when per-frame values differ', () => {
    fc.assert(
      fc.property(
        stableFramesArb,
        fc.constantFrom('rabbit', 'lion', 'bird', 'snake', 'crocodile', 'demon'),
        fc.array(fc.double({ min: DEFAULT_THRESHOLD, max: 1, noNaN: true }), {
          minLength: 30,
          maxLength: 30,
        }),
        fc.integer({ min: 0, max: 1_000_000 }),
        (stableFrames, label, confs, startTs) => {
          const debouncer = createDebouncer({
            stableFrames,
            confidenceThreshold: DEFAULT_THRESHOLD,
          });
          const events = confs.map((c, i) => debouncer.push(label, c, startTs + i * 33));
          const firedAt = events.findIndex((e) => e !== null);
          expect(firedAt).toBe(stableFrames - 1);
          expect(events[firedAt]).toEqual({
            label,
            confidence: confs[stableFrames - 1],
            timestamp: startTs + (stableFrames - 1) * 33,
          });
        },
      ),
      { numRuns: 100 },
    );
  });
});
