// Pure Landmark_MLP input builder. No TensorFlow.js imports.
import type { ExtractedFeatures } from '../vision/types';

const LANDMARKS_PER_HAND = 21;
/** 21 landmarks x (x, y, z). */
export const LANDMARK_VALUES_PER_SLOT = 63;
/** 2 * 63 landmark values + 2 presence flags + 3 wrist-offset values. */
export const FEATURE_VECTOR_LENGTH = 131;

/**
 * Layout: [slot0 normalized x,y,z * 21][slot1 normalized x,y,z * 21]
 *         [present0, present1][offset x, y, z]
 * Absent slots (or slots without 21 landmarks) are zero-filled.
 */
export function buildFeatureVector(f: ExtractedFeatures): Float32Array {
  const out = new Float32Array(FEATURE_VECTOR_LENGTH);

  f.slots.forEach((slot, s) => {
    if (!slot.present || slot.normalizedLandmarks.length !== LANDMARKS_PER_HAND) return;
    const base = s * LANDMARK_VALUES_PER_SLOT;
    for (let i = 0; i < LANDMARKS_PER_HAND; i++) {
      const p = slot.normalizedLandmarks[i];
      if (!p) continue;
      out[base + i * 3] = p.x;
      out[base + i * 3 + 1] = p.y;
      out[base + i * 3 + 2] = p.z;
    }
  });

  const flagBase = 2 * LANDMARK_VALUES_PER_SLOT;
  out[flagBase] = f.slots[0].present ? 1 : 0;
  out[flagBase + 1] = f.slots[1].present ? 1 : 0;

  out[flagBase + 2] = f.interHand.wristOffset.x;
  out[flagBase + 3] = f.interHand.wristOffset.y;
  out[flagBase + 4] = f.interHand.wristOffset.z;

  return out;
}
