// MaskGenerator: 96x96 single-channel Shadow_Mask (0 = background, 255 = shadow).
//
// Reuses the SAME SilhouetteRenderer as the live preview, rendered white-on-black
// (Req 12.1), crops to the detected hands plus scale-relative padding (Req 12.2),
// then centers and resizes to 96x96 preserving aspect ratio (Req 12.3).
// With no hands the mask is blank (Req 12.4). The same path feeds the live
// thumbnail (Req 14.3, 14.4).

import { config } from '../../src/config';
import {
  createSilhouetteRenderer,
  type RenderOptions,
  type SilhouetteRenderer,
} from '../../src/vision/silhouette-renderer';
import type { HandFeatures } from './feature-extractor';
import type { FrameResult } from './types';

export interface MaskGenerator {
  generate(frame: FrameResult, slots: [HandFeatures, HandFeatures]): Uint8Array; // 96*96 bytes
}

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** White-on-black options for the mask render. */
export function maskRenderOptions(): RenderOptions {
  return { color: '#ffffff', background: '#000000', blurRadius: config.maskBlurRadius };
}

/**
 * Bounding box (frame pixels) of the present hands' landmarks, expanded by
 * `max(config.maskPaddingScale, strokeThicknessScale / 2) * handScalePx` (largest present
 * hand) plus the mask render blur radius, clamped to the frame. The floor and blur term keep
 * the silhouette (which extends past landmarks by half the stroke width plus blur) from
 * being clipped at the fingertips. Returns null when no hand is present.
 *
 * Coordinate space: FrameResult.hands landmarks are already mirrored (x' = 1 - x, applied
 * exactly once in VisionPipeline), and slot.rawLandmarks are copied verbatim from them by
 * the FeatureExtractor, so both are in the same mirrored Display_Coordinate_Space. The
 * renderer draws them directly (no flip), so the crop here must not mirror again.
 */
export function computeCropRect(
  frame: FrameResult,
  slots: readonly HandFeatures[],
): CropRect | null {
  const { frameWidth: fw, frameHeight: fh } = frame;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let scalePx = 0;

  for (const slot of slots) {
    if (!slot.present || slot.rawLandmarks.length === 0) continue;
    for (const p of slot.rawLandmarks) {
      minX = Math.min(minX, p.x * fw);
      maxX = Math.max(maxX, p.x * fw);
      minY = Math.min(minY, p.y * fh);
      maxY = Math.max(maxY, p.y * fh);
    }
    const w = slot.rawLandmarks[0];
    const m = slot.rawLandmarks[9];
    if (w && m) scalePx = Math.max(scalePx, Math.hypot((m.x - w.x) * fw, (m.y - w.y) * fh));
  }
  if (!Number.isFinite(minX) || fw <= 0 || fh <= 0) return null;

  const strokeHalfScale = config.strokeThicknessScale / 2;
  const pad = Math.max(config.maskPaddingScale, strokeHalfScale) * scalePx + maskRenderOptions().blurRadius;
  const x0 = Math.max(0, minX - pad);
  const y0 = Math.max(0, minY - pad);
  const x1 = Math.min(fw, maxX + pad);
  const y1 = Math.min(fh, maxY + pad);
  const width = x1 - x0;
  const height = y1 - y0;
  // Sub-pixel crops are degenerate (collapsed landmarks): nothing meaningful to render.
  if (width < 1 || height < 1) return null;
  return { x: x0, y: y0, width, height };
}

/** Destination rect inside the size x size mask: aspect preserved, centered. */
export function fitCentered(crop: CropRect, size: number): CropRect {
  const s = Math.min(size / crop.width, size / crop.height);
  const width = crop.width * s;
  const height = crop.height * s;
  return { x: (size - width) / 2, y: (size - height) / 2, width, height };
}

/** Encode a raw row-major uint8 mask as base64 (no PNG, no compression). */
export function encodeMask(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

/** Decode a base64 mask; throws unless it is exactly maskSize.width * maskSize.height bytes. */
export function decodeMask(b64: string): Uint8Array {
  const bin = atob(b64);
  const expected = config.maskSize.width * config.maskSize.height;
  if (bin.length !== expected) {
    throw new Error(`Invalid mask: decoded ${bin.length} bytes, expected ${expected}`);
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function createCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function createMaskGenerator(renderer?: SilhouetteRenderer): MaskGenerator {
  const { width: MW, height: MH } = config.maskSize;
  let work: HTMLCanvasElement | null = null;
  let workRenderer: SilhouetteRenderer | null = null;
  let outCanvas: HTMLCanvasElement | null = null;

  return {
    generate(frame, slots) {
      const out = new Uint8Array(MW * MH);
      const crop = computeCropRect(frame, slots);
      if (!crop || frame.hands.length === 0) return out;

      // Render the shared silhouette at frame resolution (reusing one work canvas).
      let r = renderer;
      if (!r) {
        const fw = Math.max(1, Math.round(frame.frameWidth));
        const fh = Math.max(1, Math.round(frame.frameHeight));
        if (!work || work.width !== fw || work.height !== fh) {
          work = createCanvas(fw, fh);
          workRenderer = createSilhouetteRenderer(work);
        }
        r = workRenderer!;
      }
      const rendered = r.renderToCanvas(frame, maskRenderOptions());

      if (!outCanvas) outCanvas = createCanvas(MW, MH);
      const octx = outCanvas.getContext('2d', { willReadFrequently: true });
      if (!octx) return out;

      // Crop in rendered-canvas pixels (rendered may differ in size from the frame).
      const sx = rendered.width / frame.frameWidth;
      const sy = rendered.height / frame.frameHeight;
      const dest = fitCentered(crop, MW);

      octx.save();
      octx.setTransform(1, 0, 0, 1, 0, 0);
      octx.fillStyle = '#000000';
      octx.fillRect(0, 0, MW, MH);
      octx.imageSmoothingEnabled = true;
      octx.imageSmoothingQuality = 'high';
      octx.drawImage(
        rendered,
        crop.x * sx,
        crop.y * sy,
        crop.width * sx,
        crop.height * sy,
        dest.x,
        dest.y,
        dest.width,
        dest.height,
      );
      octx.restore();

      // RGBA -> single-channel grayscale (red channel; render is white-on-black).
      const data = octx.getImageData(0, 0, MW, MH).data;
      for (let i = 0; i < MW * MH; i++) out[i] = data[i * 4] ?? 0;
      return out;
    },
  };
}

export const MaskGeneratorFactory = { create: createMaskGenerator };
