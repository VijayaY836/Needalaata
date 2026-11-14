import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LABELS } from '../vision/types';
import {
  MetadataError,
  parseModelMetadata,
  serializeModelMetadata,
  type ModelMetadata,
} from './metadata';

const metadataArb: fc.Arbitrary<ModelMetadata> = fc
  .record({
    variant: fc.constantFrom(
      { inputType: 'MLP' as const, inputShape: [131] },
      { inputType: 'CNN' as const, inputShape: [96, 96, 1] },
    ),
    schemaVersion: fc.string({ minLength: 1, maxLength: 12 }),
    trainedAt: fc
      .date({ min: new Date('2020-01-01'), max: new Date('2100-01-01'), noInvalidDate: true })
      .map((d) => d.toISOString()),
    testAccuracy: fc
      .double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true })
      .filter((x) => !Object.is(x, -0)),
  })
  .map(({ variant, ...rest }) => ({
    labels: [...LABELS],
    inputType: variant.inputType,
    inputShape: [...variant.inputShape],
    ...rest,
  }));

const valid: ModelMetadata = {
  labels: [...LABELS],
  inputType: 'MLP',
  inputShape: [131],
  schemaVersion: '1',
  trainedAt: '2026-10-30T12:00:00.000Z',
  testAccuracy: 0.9,
};

function reasonOf(input: unknown): string | undefined {
  try {
    parseModelMetadata(input);
  } catch (e) {
    return e instanceof MetadataError ? e.reason : 'other';
  }
  return undefined;
}

// Feature: classifier, Property 21: Model metadata round trip
// **Validates: Requirements 7.2, 9.9**
describe('Property 21: Model metadata round trip', () => {
  it('parse(JSON.parse(serialize(m))) deep-equals m', () => {
    fc.assert(
      fc.property(metadataArb, (m) => {
        expect(parseModelMetadata(JSON.parse(serializeModelMetadata(m)))).toEqual(m);
      }),
      { numRuns: 100 },
    );
  });

  it('rejects label mismatch', () => {
    expect(reasonOf({ ...valid, labels: [...LABELS].reverse() })).toBe('label_mismatch');
  });

  it('rejects unknown input type', () => {
    expect(reasonOf({ ...valid, inputType: 'RNN' })).toBe('unknown_input_type');
  });

  it('rejects shape/type mismatch', () => {
    expect(reasonOf({ ...valid, inputType: 'CNN' })).toBe('shape_mismatch');
  });

  it('rejects non-finite accuracy', () => {
    expect(reasonOf({ ...valid, testAccuracy: Infinity })).toBe('non_finite_accuracy');
    expect(reasonOf({ ...valid, testAccuracy: NaN })).toBe('non_finite_accuracy');
  });
});
