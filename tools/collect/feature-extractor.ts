// FeatureExtractor: turns a FrameResult into a fixed-length, slot-ordered feature set.
// Pure logic, no DOM. Slotting never depends on handedness or detection order.
import type {
  ExtractedFeatures,
  FrameResult,
  HandObservation,
  HandSlot,
  InterHandFeatures,
  Landmark,
} from './types';

export type HandFeatures = HandSlot;
export type { ExtractedFeatures, InterHandFeatures };

const LANDMARK_COUNT = 21;
const WRIST = 0;
const MIDDLE_MCP = 9;
/** Guard against divide-by-zero for degenerate (collapsed) hands. */
const MIN_SCALE = 1e-9;

function zeroLandmarks(): Landmark[] {
  return Array.from({ length: LANDMARK_COUNT }, () => ({ x: 0, y: 0, z: 0 }));
}

function absentSlot(): HandFeatures {
  return {
    present: false,
    handedness: '',
    score: 0,
    rawLandmarks: zeroLandmarks(),
    normalizedLandmarks: zeroLandmarks(),
  };
}

/** Lift display-space landmarks to aspect-corrected pixel space. */
function aspectCorrect(lms: Landmark[], fw: number, fh: number): Landmark[] {
  return lms.map((l) => ({ x: l.x * fw, y: l.y * fh, z: l.z * fw }));
}

function dist(a: Landmark, b: Landmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

interface Computed {
  features: HandFeatures;
  wrist: Landmark;
  scale: number;
  wristX: number;
  wristY: number;
}

function computeHand(hand: HandObservation, fw: number, fh: number): Computed {
  const corrected = aspectCorrect(hand.landmarks, fw, fh);
  const wrist = corrected[WRIST] as Landmark;
  const scale = dist(wrist, corrected[MIDDLE_MCP] as Landmark);
  const divisor = scale > MIN_SCALE ? scale : 0;
  const normalized = corrected.map((l) =>
    divisor === 0
      ? { x: 0, y: 0, z: 0 }
      : {
          x: (l.x - wrist.x) / divisor,
          y: (l.y - wrist.y) / divisor,
          z: (l.z - wrist.z) / divisor,
        },
  );
  return {
    features: {
      present: true,
      handedness: hand.handedness,
      score: hand.score,
      rawLandmarks: hand.landmarks.map((l) => ({ x: l.x, y: l.y, z: l.z })),
      normalizedLandmarks: normalized,
    },
    wrist,
    scale,
    wristX: (hand.landmarks[WRIST] as Landmark).x,
    wristY: (hand.landmarks[WRIST] as Landmark).y,
  };
}

/** Slot order: smaller wrist x, then smaller wrist y, then higher score. */
function compareSlotOrder(a: Computed, b: Computed): number {
  if (a.wristX !== b.wristX) return a.wristX - b.wristX;
  if (a.wristY !== b.wristY) return a.wristY - b.wristY;
  return b.features.score - a.features.score;
}

export function extractFeatures(frame: FrameResult): ExtractedFeatures {
  const { frameWidth: fw, frameHeight: fh } = frame;
  const valid = frame.hands.filter((h) => h.landmarks.length >= LANDMARK_COUNT);
  // Only the first two matter; if more than two, keep the two highest-scoring.
  const top = [...valid].sort((a, b) => b.score - a.score).slice(0, 2);
  const computed = top.map((h) => computeHand(h, fw, fh)).sort(compareSlotOrder);

  const slot0 = computed[0]?.features ?? absentSlot();
  const slot1 = computed[1]?.features ?? absentSlot();
  const handCount = computed.length;

  let wristOffset = { x: 0, y: 0, z: 0 };
  const [a, b] = computed;
  if (a && b) {
    const meanScale = (a.scale + b.scale) / 2;
    if (meanScale > MIN_SCALE) {
      const wa = a.wrist;
      const wb = b.wrist;
      wristOffset = {
        x: (wb.x - wa.x) / meanScale,
        y: (wb.y - wa.y) / meanScale,
        z: (wb.z - wa.z) / meanScale,
      };
    }
  }

  return { slots: [slot0, slot1], interHand: { wristOffset, handCount } };
}

export const FeatureExtractor = { extract: extractFeatures };
