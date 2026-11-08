import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  NothingToExportError,
  buildExportDocument,
  exportFilename,
  parseExport,
  serializeExport,
} from './exporter';
import { decodeMask, encodeMask } from './mask-generator';
import { LABELS } from './types';
import type { HandSlot, Landmark, Sample } from './types';

const RUNS = { numRuns: 100 };
const MASK_BYTES = 96 * 96;

// `+ 0` normalizes -0 to 0 (JSON does not preserve -0).
const num = fc
  .double({ noNaN: true, noDefaultInfinity: true, min: -1e6, max: 1e6 })
  .map((n) => n + 0);
const landmark: fc.Arbitrary<Landmark> = fc.record({ x: num, y: num, z: num });
const slot: fc.Arbitrary<HandSlot> = fc.record({
  present: fc.boolean(),
  handedness: fc.constantFrom('Left', 'Right', ''),
  score: num,
  rawLandmarks: fc.array(landmark, { minLength: 21, maxLength: 21 }),
  normalizedLandmarks: fc.array(landmark, { minLength: 21, maxLength: 21 }),
});
const maskBytes = fc
  .uint8Array({ minLength: MASK_BYTES, maxLength: MASK_BYTES })
  .map((a) => encodeMask(a));

const sample: fc.Arbitrary<Sample> = fc.record({
  id: fc.uuid(),
  label: fc.constantFrom(...LABELS),
  slots: fc.tuple(slot, slot),
  interHand: fc.record({
    wristOffset: fc.record({ x: num, y: num, z: num }),
    handCount: fc.integer({ min: 0, max: 2 }),
  }),
  maskBase64: maskBytes,
  frameWidth: fc.integer({ min: 1, max: 4096 }),
  frameHeight: fc.integer({ min: 1, max: 4096 }),
  sessionId: fc.uuid(),
  burstId: fc.uuid(),
  contributor: fc.string({ maxLength: 20 }),
  timestamp: fc.integer({ min: 0, max: 2 ** 40 }),
});

describe('Exporter', () => {
  // Feature: vision-and-collection, Property 12: Export round-trip preserves samples
  // **Validates: Requirements 16.1, 16.3, 16.4**
  it('Property 12: export round-trip preserves samples and mask bytes', () => {
    fc.assert(
      fc.property(fc.array(sample, { minLength: 1, maxLength: 4 }), (samples) => {
        const parsed = parseExport(serializeExport(samples));
        expect(parsed.samples).toHaveLength(samples.length);
        samples.forEach((s, i) => {
          const out = parsed.samples[i];
          expect(out).toEqual(s);
          expect(Array.from(decodeMask(out.maskBase64))).toEqual(
            Array.from(decodeMask(s.maskBase64)),
          );
        });
      }),
      RUNS,
    );
  });

  it('filename includes contributor and export date (16.5)', () => {
    const name = exportFilename('Asha Rao', new Date('2026-03-04T10:00:00Z'));
    expect(name).toContain('Asha_Rao');
    expect(name).toContain('2026-03-04');
    expect(name.endsWith('.json')).toBe(true);
  });

  it('blocks export with zero samples (16.6)', () => {
    expect(() => buildExportDocument([])).toThrow(NothingToExportError);
    expect(() => serializeExport([])).toThrow(/nothing to export/i);
  });
});
