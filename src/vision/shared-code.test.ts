// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { config } from '../config';
import { decodeMask, encodeMask, extractFeatures } from './index';

describe('shared vision code (Node environment)', () => {
  it('extractFeatures runs without a DOM', () => {
    const f = extractFeatures({ hands: [], timestamp: 0, frameWidth: 640, frameHeight: 480 });
    expect(f.slots).toHaveLength(2);
    expect(f.slots[0].present).toBe(false);
  });

  it('encodeMask/decodeMask round-trip without a DOM', () => {
    const bytes = new Uint8Array(config.maskSize.width * config.maskSize.height).map((_, i) => i % 256);
    expect(decodeMask(encodeMask(bytes))).toEqual(bytes);
  });

  it('old collector copies no longer exist', async () => {
    for (const name of ['feature-extractor', 'mask-generator']) {
      const path = `../../tools/collect/${name}`;
      await expect(import(/* @vite-ignore */ path)).rejects.toThrow();
    }
  });
});
