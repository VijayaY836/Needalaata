import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { LABELS, LABEL_COUNT, labelToIndex, indexToLabel } from './labels';

// Feature: classifier, Property 8: Label encoding round trip
// **Validates: Requirements 11.8**
describe('Property 8: Label encoding round trip', () => {
  const labelArb = fc.constantFrom(...LABELS);
  const indexArb = fc.integer({ min: 0, max: LABEL_COUNT - 1 });

  it('has seven labels in the documented order', () => {
    expect(LABEL_COUNT).toBe(7);
    expect([...LABELS]).toEqual(['rabbit', 'lion', 'bird', 'snake', 'crocodile', 'demon', 'none']);
  });

  it('indexToLabel(labelToIndex(l)) === l', () => {
    fc.assert(
      fc.property(labelArb, (l) => indexToLabel(labelToIndex(l)) === l),
      { numRuns: 100 },
    );
  });

  it('labelToIndex(indexToLabel(i)) === i for i in 0..6', () => {
    fc.assert(
      fc.property(indexArb, (i) => labelToIndex(indexToLabel(i)) === i),
      { numRuns: 100 },
    );
  });

  it('indices follow LABELS order', () => {
    fc.assert(
      fc.property(labelArb, (l) => labelToIndex(l) === LABELS.indexOf(l)),
      { numRuns: 100 },
    );
    expect(labelToIndex('rabbit')).toBe(0);
    expect(labelToIndex('none')).toBe(6);
  });

  it('indexToLabel throws RangeError outside 0..6 and for non-integers', () => {
    const bad = fc.oneof(
      fc.integer({ max: -1 }),
      fc.integer({ min: LABEL_COUNT }),
      fc.double({ noInteger: true }),
      fc.constantFrom(NaN, Infinity, -Infinity),
    );
    fc.assert(
      fc.property(bad, (i) => {
        expect(() => indexToLabel(i)).toThrow(RangeError);
      }),
      { numRuns: 100 },
    );
  });
});
