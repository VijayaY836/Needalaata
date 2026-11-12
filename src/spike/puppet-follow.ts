// Spike: "puppet mode" preview. A leather rabbit puppet follows the index fingertip
// on a lamp-lit cloth screen. Purely visual; does not touch vision module logic.
import { config } from '../config';
import { createSilhouetteRenderer } from '../vision/silhouette-renderer';
import type { FrameResult } from '../vision/types';

const INDEX_TIP = 8;
const LERP = 0.15;
const FADE_SECONDS = 0.5;
const SHADOW_ALPHA = 0.35;
const RABBIT_HEIGHT_FRACTION = 0.3;
const MAX_TILT = 0.35; // radians

export interface PuppetFollow {
  render(frame: FrameResult): void;
}

export function createPuppetFollow(canvas: HTMLCanvasElement): PuppetFollow {
  const ctx = canvas.getContext('2d');
  const rabbit = new Image();
  let rabbitReady = false;
  rabbit.onload = () => {
    rabbitReady = true;
  };
  rabbit.src = '/art/rabbit.png';

  // Offscreen layer for the (transparent-background) hand shadow.
  const shadowLayer = document.createElement('canvas');
  const shadowRenderer = createSilhouetteRenderer(shadowLayer);

  let x = 0.5;
  let y = 0.5;
  let hasPos = false;
  let tilt = 0;
  let alpha = 0;
  let lastNow = performance.now();

  function drawScreen(w: number, h: number, t: number): void {
    if (!ctx) return;
    // Slow layered sines: smooth, never strobing (max swing ~ +/-6%).
    const flicker =
      0.04 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 2.9 + 1.7) + 0.02 * Math.sin(t * 5.1 + 0.4);
    const k = 1 + flicker;
    const cx = w / 2 + Math.sin(t * 0.7) * w * 0.01;
    const cy = h / 2 + Math.cos(t * 0.9) * h * 0.01;
    const r = Math.hypot(w, h) * 0.55;
    const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, `rgb(${c(255)},${c(205)},${c(120)})`);
    g.addColorStop(0.45, `rgb(${c(224)},${c(150)},${c(72)})`);
    g.addColorStop(0.8, `rgb(${c(120)},${c(66)},${c(28)})`);
    g.addColorStop(1, `rgb(${c(40)},${c(20)},${c(8)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    // Dark vignette at the edges.
    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, 'rgba(0,0,0,0.65)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  return {
    render(frame) {
      if (!ctx) return;
      const w = canvas.width;
      const h = canvas.height;
      const now = performance.now();
      const dt = Math.min(0.1, (now - lastNow) / 1000);
      lastNow = now;
      const t = now / 1000;

      drawScreen(w, h, t);

      // Target from the first hand's index fingertip (already mirrored).
      const tip = frame.hands[0]?.landmarks[INDEX_TIP];
      if (tip) {
        if (!hasPos) {
          x = tip.x;
          y = tip.y;
          hasPos = true;
        }
        const prevX = x;
        x += (tip.x - x) * LERP;
        y += (tip.y - y) * LERP;
        const vx = x - prevX; // normalized units per frame
        const targetTilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, vx * 25));
        tilt += (targetTilt - tilt) * 0.15;
        alpha = Math.min(1, alpha + dt / FADE_SECONDS);
      } else {
        tilt *= 0.9;
        alpha = Math.max(0, alpha - dt / FADE_SECONDS);
      }

      // Rabbit, multiplied so its white background vanishes into the lit cloth.
      if (rabbitReady && alpha > 0 && rabbit.naturalWidth > 0) {
        const rh = h * RABBIT_HEIGHT_FRACTION;
        const rw = rh * (rabbit.naturalWidth / rabbit.naturalHeight);
        const bob = Math.sin(t * 2.2) * h * 0.008;
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.globalAlpha = alpha;
        ctx.translate(x * w, y * h + bob);
        ctx.rotate(tilt + Math.sin(t * 1.6) * 0.02);
        ctx.drawImage(rabbit, -rw / 2, -rh / 2, rw, rh);
        ctx.restore();
      }

      // Existing coloured hand shadow on top, softer.
      shadowLayer.width = w; // resets (clears) the layer
      shadowLayer.height = h;
      shadowRenderer.render(frame, {
        color: config.warmSilhouetteColor,
        background: 'rgba(0,0,0,0)',
        blurRadius: config.silhouetteBlurRadius * 1.5,
      });
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = SHADOW_ALPHA;
      ctx.drawImage(shadowLayer, 0, 0);
      ctx.restore();
    },
  };
}
