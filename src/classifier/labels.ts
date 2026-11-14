// Label <-> index mapping shared by training and the runtime classifier.
// Pure: no TensorFlow.js import.

import { LABELS, type Label } from '../vision/types';

export { LABELS };

/** Number of classifier output classes. */
export const LABEL_COUNT = 7;

/** Index of a label in LABELS (rabbit = 0 ... none = 6). */
export function labelToIndex(label: Label): number {
  const index = LABELS.indexOf(label);
  if (index < 0) {
    throw new RangeError(`Unknown label: ${String(label)}`);
  }
  return index;
}

/** Label at an index. Throws RangeError for anything outside 0..6 or non-integers. */
export function indexToLabel(index: number): Label {
  const label = Number.isInteger(index) ? LABELS[index] : undefined;
  if (label === undefined) {
    throw new RangeError(`Label index out of range 0..${LABEL_COUNT - 1}: ${String(index)}`);
  }
  return label;
}
