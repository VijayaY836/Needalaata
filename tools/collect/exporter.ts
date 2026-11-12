// Exporter: serializes all Samples into one versioned JSON document (Req 16).
// Mask codec is reused from mask-generator.ts; it is intentionally not reimplemented here.

import { config } from '../../src/config';
import { decodeMask, encodeMask } from '../../src/vision/mask-generator';
import { LABELS } from './types';
import type { ExportDocument, ExportMetadata, Sample } from './types';

export const SCHEMA_VERSION = '1.0.0';

export const NORMALIZATION_DESCRIPTION =
  'Landmarks are lifted to aspect-corrected pixel space (xc = x*frameWidth, yc = y*frameHeight, ' +
  'zc = z*frameWidth), made wrist-relative (landmark 0 subtracted), then divided by Hand_Scale ' +
  '(distance from wrist to middle-finger MCP, landmark 9). rawLandmarks are mirrored display-space ' +
  '[0,1] values, not aspect-corrected. Inter-hand wristOffset = (slot1 wrist - slot0 wrist) / mean Hand_Scale.';

export const MASK_ENCODING_DESCRIPTION =
  'base64 of row-major 96x96 uint8, 0=background 255=shadow';

/** Thrown when there is nothing to export (Req 16.6). */
export class NothingToExportError extends Error {
  constructor() {
    super('Nothing to export: no samples have been recorded.');
    this.name = 'NothingToExportError';
  }
}

export function buildMetadata(exportDate: Date = new Date()): ExportMetadata {
  return {
    schemaVersion: SCHEMA_VERSION,
    labels: [...LABELS],
    maskSize: { width: config.maskSize.width, height: config.maskSize.height },
    normalization: NORMALIZATION_DESCRIPTION,
    maskEncoding: MASK_ENCODING_DESCRIPTION,
    exportDate: exportDate.toISOString(),
  };
}

/**
 * Build the export document. Each mask is validated via decodeMask and re-encoded
 * via encodeMask so every exported mask is canonical base64 of exactly 96x96 bytes.
 * Throws NothingToExportError when there are no samples.
 */
export function buildExportDocument(
  samples: readonly Sample[],
  exportDate: Date = new Date(),
): ExportDocument {
  if (samples.length === 0) throw new NothingToExportError();
  return {
    metadata: buildMetadata(exportDate),
    samples: samples.map((s) => ({ ...s, maskBase64: encodeMask(decodeMask(s.maskBase64)) })),
  };
}

export function serializeExport(
  samples: readonly Sample[],
  exportDate: Date = new Date(),
): string {
  return JSON.stringify(buildExportDocument(samples, exportDate));
}

/** Parse an export document back; masks stay base64 (decode with decodeMask). */
export function parseExport(json: string): ExportDocument {
  return JSON.parse(json) as ExportDocument;
}

function sanitize(name: string): string {
  const cleaned = name.trim().replace(/[^\p{L}\p{N}_-]+/gu, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'anonymous';
}

/** Filename includes contributor name and export date (Req 16.5). */
export function exportFilename(contributor: string, exportDate: Date = new Date()): string {
  const date = exportDate.toISOString().slice(0, 10);
  return `needalaata-samples_${sanitize(contributor)}_${date}.json`;
}

/**
 * Serialize and trigger a browser download. Throws NothingToExportError when
 * there are no samples; the caller surfaces the message to the contributor.
 */
export function downloadExport(
  samples: readonly Sample[],
  contributor: string,
  exportDate: Date = new Date(),
): string {
  const json = serializeExport(samples, exportDate);
  const filename = exportFilename(contributor, exportDate);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  return filename;
}

export const Exporter = {
  buildExportDocument,
  serializeExport,
  parseExport,
  exportFilename,
  download: downloadExport,
};
