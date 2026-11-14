// Shared fast-check generators and helpers for debouncer property tests.
import fc from 'fast-check';
import { LABELS, type Label } from '../../vision/types';
import { createDebouncer, type ShapeEvent } from '../debouncer';

export interface Frame {
  label: Label;
  confidence: number;
  timestamp: number;
}

export interface FiredEvent {
  /** Index of the frame at which the event fired. */
  index: number;
  event: ShapeEvent;
}

export const DEFAULT_THRESHOLD = 0.85;

/** stableFrames in 2..30. */
export const stableFramesArb: fc.Arbitrary<number> = fc.integer({ min: 2, max: 30 });

/** Confidence in [0, 1], biased toward threshold-exact and near-threshold values. */
export function confidenceArb(threshold: number = DEFAULT_THRESHOLD): fc.Arbitrary<number> {
  const below = Math.max(0, threshold - 1e-9);
  return fc.oneof(
    { weight: 3, arbitrary: fc.constant(threshold) },
    { weight: 1, arbitrary: fc.constant(below) },
    { weight: 1, arbitrary: fc.constant(1) },
    { weight: 1, arbitrary: fc.constant(0) },
    { weight: 3, arbitrary: fc.double({ min: threshold, max: 1, noNaN: true }) },
    { weight: 2, arbitrary: fc.double({ min: 0, max: 1, noNaN: true }) },
  );
}

const labelArb: fc.Arbitrary<Label> = fc.constantFrom(...LABELS);
const nonNoneLabelArb: fc.Arbitrary<Label> = fc.constantFrom(
  ...LABELS.filter((l) => l !== 'none'),
);

/** A run of `length` frames with one label and per-frame confidences. */
function runArb(threshold: number, maxLength: number): fc.Arbitrary<Array<{ label: Label; confidence: number }>> {
  return fc
    .tuple(
      fc.oneof({ weight: 5, arbitrary: nonNoneLabelArb }, { weight: 1, arbitrary: fc.constant<Label>('none') }),
      fc.array(confidenceArb(threshold), { minLength: 1, maxLength }),
    )
    .map(([label, confs]) => confs.map((confidence) => ({ label, confidence })));
}

/**
 * Frame sequences of {label, confidence, timestamp}, built from runs so long
 * same-label stretches, exact-threshold confidences and `none` frames are common.
 */
export function frameSequenceArb(
  threshold: number = DEFAULT_THRESHOLD,
  maxFrames = 150,
): fc.Arbitrary<Frame[]> {
  const runs = fc.array(runArb(threshold, 40), { maxLength: 8 }).map((rs) => rs.flat());
  const scattered = fc.array(
    fc.record({ label: labelArb, confidence: confidenceArb(threshold) }),
    { maxLength: 60 },
  );
  return fc.oneof({ weight: 3, arbitrary: runs }, { weight: 1, arbitrary: scattered }).map((frames) =>
    frames.slice(0, maxFrames).map((f, i) => ({ ...f, timestamp: i * 33 })),
  );
}

/** Pairs a stableFrames value with a frame sequence. */
export function debouncerCaseArb(
  threshold: number = DEFAULT_THRESHOLD,
): fc.Arbitrary<{ stableFrames: number; frames: Frame[] }> {
  return fc.record({ stableFrames: stableFramesArb, frames: frameSequenceArb(threshold) });
}

/** Runs a fresh debouncer over the frames and returns fired events with frame indices. */
export function runDebouncer(
  frames: readonly Frame[],
  stableFrames: number,
  threshold: number = DEFAULT_THRESHOLD,
): FiredEvent[] {
  const debouncer = createDebouncer({ stableFrames, confidenceThreshold: threshold });
  const fired: FiredEvent[] = [];
  frames.forEach((f, index) => {
    const event = debouncer.push(f.label, f.confidence, f.timestamp);
    if (event) fired.push({ index, event });
  });
  return fired;
}
