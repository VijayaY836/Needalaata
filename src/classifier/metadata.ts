// Model metadata sidecar (metadata.json) shared by training and the runtime classifier.
// Pure: no TensorFlow.js import.

import { LABELS, type Label } from '../vision/types';
import { FEATURE_VECTOR_LENGTH } from './feature-vector';

export type InputType = 'MLP' | 'CNN';

export interface ModelMetadata {
  labels: Label[];
  inputType: InputType;
  inputShape: number[];
  schemaVersion: string;
  trainedAt: string;
  testAccuracy: number;
}

export type MetadataErrorReason =
  | 'label_mismatch'
  | 'unknown_input_type'
  | 'shape_mismatch'
  | 'non_finite_accuracy'
  | 'malformed';

export class MetadataError extends Error {
  readonly reason: MetadataErrorReason;

  constructor(reason: MetadataErrorReason, message: string) {
    super(message);
    this.name = 'MetadataError';
    this.reason = reason;
  }
}

const EXPECTED_SHAPES: Record<InputType, number[]> = {
  MLP: [FEATURE_VECTOR_LENGTH],
  CNN: [96, 96, 1],
};

function sameArray(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Validate untrusted JSON and return typed metadata. Throws MetadataError. */
export function parseModelMetadata(json: unknown): ModelMetadata {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new MetadataError('malformed', 'Metadata must be a JSON object');
  }
  const o = json as Record<string, unknown>;

  if (typeof o.schemaVersion !== 'string') {
    throw new MetadataError('malformed', 'schemaVersion must be a string');
  }
  if (typeof o.trainedAt !== 'string') {
    throw new MetadataError('malformed', 'trainedAt must be a string');
  }
  if (!Array.isArray(o.labels)) {
    throw new MetadataError('malformed', 'labels must be an array');
  }
  if (typeof o.inputType !== 'string') {
    throw new MetadataError('malformed', 'inputType must be a string');
  }
  if (!Array.isArray(o.inputShape) || !o.inputShape.every((n) => typeof n === 'number')) {
    throw new MetadataError('malformed', 'inputShape must be an array of numbers');
  }
  if (typeof o.testAccuracy !== 'number') {
    throw new MetadataError('malformed', 'testAccuracy must be a number');
  }

  if (!sameArray(o.labels, LABELS)) {
    throw new MetadataError('label_mismatch', `labels must equal [${LABELS.join(', ')}]`);
  }
  if (o.inputType !== 'MLP' && o.inputType !== 'CNN') {
    throw new MetadataError('unknown_input_type', `Unknown inputType: ${o.inputType}`);
  }
  const inputType: InputType = o.inputType;
  const inputShape = o.inputShape as number[];
  if (!sameArray(inputShape, EXPECTED_SHAPES[inputType])) {
    throw new MetadataError(
      'shape_mismatch',
      `inputShape for ${inputType} must be [${EXPECTED_SHAPES[inputType].join(', ')}]`,
    );
  }
  if (!Number.isFinite(o.testAccuracy) || o.testAccuracy < 0 || o.testAccuracy > 1) {
    throw new MetadataError('non_finite_accuracy', 'testAccuracy must be a finite number in 0..1');
  }

  return {
    labels: [...LABELS],
    inputType,
    inputShape: [...inputShape],
    schemaVersion: o.schemaVersion,
    trainedAt: o.trainedAt,
    testAccuracy: o.testAccuracy,
  };
}

/** Pretty-printed JSON for metadata.json. */
export function serializeModelMetadata(m: ModelMetadata): string {
  return JSON.stringify(m, null, 2);
}
