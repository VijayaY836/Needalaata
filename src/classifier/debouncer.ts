// Pure debouncer state machine. No DOM, no TF.js.
import type { Label } from '../vision/types';

export interface ShapeEvent {
  label: Label;
  confidence: number;
  timestamp: number;
}

export interface DebouncerOptions {
  stableFrames: number;
  confidenceThreshold: number;
}

export interface DebouncerState {
  label: Label | null;
  length: number;
  fired: boolean;
}

export interface Debouncer {
  push(top: Label, confidence: number, timestamp: number): ShapeEvent | null;
  reset(): void;
  readonly state: Readonly<DebouncerState>;
}

export function createDebouncer(opts: DebouncerOptions): Debouncer {
  const { stableFrames, confidenceThreshold } = opts;
  let label: Label | null = null;
  let length = 0;
  let fired = false;

  const reset = (): void => {
    label = null;
    length = 0;
    fired = false;
  };

  return {
    push(top, confidence, timestamp) {
      if (top === 'none' || !(confidence >= confidenceThreshold)) {
        reset();
        return null;
      }
      if (top === label) {
        length += 1;
      } else {
        label = top;
        length = 1;
        fired = false;
      }
      if (length >= stableFrames && !fired) {
        fired = true;
        return { label: top, confidence, timestamp };
      }
      return null;
    },
    reset,
    get state() {
      return { label, length, fired };
    },
  };
}
