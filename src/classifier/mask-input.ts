// Converts a 96x96 uint8 Shadow_Mask to the Silhouette_CNN float input. No TensorFlow.js imports.

/** Scales each byte to [0, 1] (byte / 255). Output length equals input length (9216 for 96x96). */
export function maskToFloat(mask: Uint8Array): Float32Array {
  const out = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = (mask[i] ?? 0) / 255;
  return out;
}
