// SilhouetteRenderer: warm, soft shadow-hand preview.
//
// Landmarks arrive already mirrored (Display_Coordinate_Space). They are drawn
// directly with NO additional canvas flip (Req 4.2). No skeleton lines or joint dots.

import { config } from '../config';
import type { FrameResult, HandObservation } from './types';

export interface RenderOptions {
  color: string;
  background: string;
  blurRadius: number;
}

export interface SilhouetteRenderer {
  /** Render into the renderer's target canvas. */
  render(frame: FrameResult, options: RenderOptions): void;
  /** Render into a canvas (the target, or a fresh one) and return it, for MaskGenerator reuse. */
  renderToCanvas(frame: FrameResult, options: RenderOptions): HTMLCanvasElement;
}

/** Finger bone chains (landmark indices). */
const FINGER_CHAINS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4], // thumb
  [5, 6, 7, 8], // index
  [9, 10, 11, 12], // middle
  [13, 14, 15, 16], // ring
  [17, 18, 19, 20], // pinky
];

/** Palm polygon (landmark indices). */
const PALM_POLYGON: readonly number[] = [0, 1, 5, 9, 13, 17];

/** Aspect-corrected pixel distance from wrist (0) to middle-finger MCP (9). */
export function handScalePx(
  hand: HandObservation,
  frameWidth: number,
  frameHeight: number,
): number {
  const a = hand.landmarks[0];
  const b = hand.landmarks[9];
  if (!a || !b) return 0;
  return Math.hypot((b.x - a.x) * frameWidth, (b.y - a.y) * frameHeight);
}

function drawHand(
  ctx: CanvasRenderingContext2D,
  hand: HandObservation,
  frame: FrameResult,
  outW: number,
  outH: number,
  color: string,
): void {
  const lm = hand.landmarks;
  if (lm.length < 21) return;

  // Stroke width is computed in frame pixels, then scaled to the output surface.
  const strokeFramePx = config.strokeThicknessScale * handScalePx(hand, frame.frameWidth, frame.frameHeight);
  const outScale = frame.frameWidth > 0 ? outW / frame.frameWidth : 1;
  const strokeWidth = Math.max(1, strokeFramePx * outScale);

  const trace = (indices: readonly number[], close: boolean) => {
    let started = false;
    ctx.beginPath();
    for (const i of indices) {
      const p = lm[i];
      if (!p) continue;
      if (!started) {
        ctx.moveTo(p.x * outW, p.y * outH);
        started = true;
      } else {
        ctx.lineTo(p.x * outW, p.y * outH);
      }
    }
    if (close) ctx.closePath();
  };

  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineWidth = strokeWidth;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Filled palm polygon (also stroked so its edges are rounded and thick).
  trace(PALM_POLYGON, true);
  ctx.fill();
  ctx.stroke();

  // Thick rounded finger-bone strokes.
  for (const chain of FINGER_CHAINS) {
    trace(chain, false);
    ctx.stroke();
  }
}

function createCanvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(width));
  c.height = Math.max(1, Math.round(height));
  return c;
}

function supportsFilter(ctx: CanvasRenderingContext2D): boolean {
  return typeof (ctx as { filter?: unknown }).filter === 'string';
}

function renderInto(
  target: HTMLCanvasElement,
  frame: FrameResult,
  options: RenderOptions,
): void {
  const ctx = target.getContext('2d');
  if (!ctx) return;
  const w = target.width;
  const h = target.height;

  // Background fill (Req 6.1). No hands -> background only (Req 6.7).
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = options.background;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
  if (frame.hands.length === 0) return;

  // Offscreen, downscaled surface for cheap blur (Req 6.4).
  const ds = config.silhouetteDownscale > 0 ? config.silhouetteDownscale : 1;
  const off = createCanvas(w * ds, h * ds);
  const octx = off.getContext('2d');
  if (!octx) return;

  const useFilter = supportsFilter(octx) && options.blurRadius > 0;
  if (useFilter) {
    octx.filter = `blur(${options.blurRadius * ds}px)`;
  }
  for (const hand of frame.hands) {
    drawHand(octx, hand, frame, off.width, off.height, options.color);
  }
  if (useFilter) octx.filter = 'none';

  // Upscale back to full size. Without ctx.filter, the downscale->upscale
  // with smoothing provides the softening fallback.
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(off, 0, 0, off.width, off.height, 0, 0, w, h);
  ctx.restore();
}

/**
 * Create a renderer. If `target` is given, `render` draws into it (sized by the caller)
 * and `renderToCanvas` reuses it; otherwise a canvas sized to the frame is created per call.
 */
export function createSilhouetteRenderer(target?: HTMLCanvasElement): SilhouetteRenderer {
  return {
    render(frame, options) {
      if (!target) return;
      renderInto(target, frame, options);
    },
    renderToCanvas(frame, options) {
      const canvas = target ?? createCanvas(frame.frameWidth, frame.frameHeight);
      renderInto(canvas, frame, options);
      return canvas;
    },
  };
}
