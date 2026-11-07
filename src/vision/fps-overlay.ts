// FpsOverlay: debug FPS readout drawn onto the preview canvas.
// Starts hidden (Req 7.3); the D key toggles visibility (Req 7.2).
// Call update(ts) once per processed frame, AFTER the silhouette has been drawn,
// with the performance.now() timestamp. No puppet or game logic here.
import { config } from '../config';

export interface FpsOverlay {
  /** Register a processed frame; draws the readout if visible (Req 7.1). */
  update(ts: number): void;
  toggle(): void;
  isVisible(): boolean;
  /** Remove the key listener. */
  dispose(): void;
}

const MARGIN_PX = 8;

export function createFpsOverlay(canvas: HTMLCanvasElement): FpsOverlay {
  let visible = false; // Req 7.3
  let windowStart: number | null = null;
  let framesInWindow = 0;
  let displayedFps = 0;

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
    if (e.key === 'd' || e.key === 'D') toggle();
  }

  function toggle(): void {
    visible = !visible;
    // Restart measurement so a re-enabled overlay doesn't show stale data.
    windowStart = null;
    framesInWindow = 0;
    displayedFps = 0;
  }

  function draw(): void {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { font, color, corner } = config.fpsOverlayStyle;
    const text = `${Math.round(displayedFps)} FPS`;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = corner === 'tr' || corner === 'br' ? 'right' : 'left';
    ctx.textBaseline = corner === 'bl' || corner === 'br' ? 'bottom' : 'top';
    const x = corner === 'tr' || corner === 'br' ? canvas.width - MARGIN_PX : MARGIN_PX;
    const y = corner === 'bl' || corner === 'br' ? canvas.height - MARGIN_PX : MARGIN_PX;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  function update(ts: number): void {
    if (!visible) return;
    if (windowStart === null) {
      windowStart = ts;
      framesInWindow = 0;
    }
    framesInWindow++;
    const elapsed = ts - windowStart;
    // Refresh the displayed value at the configured interval (Req 7.4).
    if (elapsed >= config.uiRefreshIntervalMs) {
      displayedFps = (framesInWindow * 1000) / elapsed;
      windowStart = ts;
      framesInWindow = 0;
    }
    draw();
  }

  window.addEventListener('keydown', onKeyDown);

  return {
    update,
    toggle,
    isVisible: () => visible,
    dispose: () => window.removeEventListener('keydown', onKeyDown),
  };
}
