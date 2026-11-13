// Shared kit for the shadow-puppet spike scenes (src/spike/scene-*.ts).
//
// - Math helpers (clamp/smooth/lerp/frame-rate independent lerp)
// - Art: load a white-background PNG and cut the background out to transparency
// - AudioEngine: Web Audio master bus, noise buffer, chime and lamp crackle (no files)
// - Captions: lower-band caption renderer + cross-fader, and a small hint line
// - Stage: full-viewport page takeover, 16:9 world scaling, fingertip -> world mapping
//
// World units: 1 unit = canvas height on screens at least 16:9 wide, so x runs 0..aspect
// and y runs 0..1. On narrower screens the world is scaled down (keeping 16:9 of width and
// the ground line at GROUND of the screen height) so nothing falls off the edge.

// ---------------------------------------------------------------------------
// Math
// ---------------------------------------------------------------------------

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const smooth = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent version of a "per frame at 60 fps" lerp factor. */
export const rate = (perFrame: number, dt: number) => 1 - Math.pow(1 - perFrame, dt * 60);

export const INDEX_TIP = 8;
/** Narrowest world we lay out for; narrower screens scale the world down instead. */
export const MIN_ASPECT = 16 / 9;
/** Ground line, as a fraction of the screen height. */
export const GROUND = 0.72;

// ---------------------------------------------------------------------------
// Art: white background -> transparency
// ---------------------------------------------------------------------------

export interface CutoutOptions {
  /** Max distance from pure white (per channel) that still counts as white. Default 30. */
  tolerance?: number;
  /** Extra flood-fill seeds, as fractions of the image size. */
  extraSeeds?: [number, number][];
  /**
   * Also remove enclosed white regions (not touching the edge) whose area is at least this
   * fraction of the image (e.g. 0.0015 = 0.15%). Smaller ones (perforation dots, pearls,
   * eye whites) are kept. Omit to remove only edge-connected white.
   */
  enclosedMinFraction?: number;
}

/** Bounding box of the opaque content, in source pixels. */
export interface ArtBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Art {
  canvas: HTMLCanvasElement | null;
  bounds: ArtBounds | null;
  /** True once loading finished (successfully or not). */
  settled: boolean;
}

/**
 * Cuts the white background out of `img`. Always removes white connected to the image
 * edges (and to any `extraSeeds`); optionally also removes large enclosed white regions.
 */
export function makeCutout(
  img: HTMLImageElement,
  opts: CutoutOptions = {},
): { canvas: HTMLCanvasElement; bounds: ArtBounds | null } {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return { canvas: c, bounds: null };
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const d = data.data;
  const lo = 255 - (opts.tolerance ?? 30);
  const isWhite = (p: number) =>
    (d[p * 4] ?? 0) >= lo && (d[p * 4 + 1] ?? 0) >= lo && (d[p * 4 + 2] ?? 0) >= lo;

  const n = w * h;
  const seen = new Uint8Array(n);
  const stack = new Int32Array(n);
  let sp = 0;
  const push = (p: number) => {
    if (seen[p] || !isWhite(p)) return;
    seen[p] = 1;
    stack[sp++] = p;
  };
  const pushNeighbours = (p: number) => {
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  };

  // 1. Edge-connected white (+ explicit seeds).
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  for (const [fx, fy] of opts.extraSeeds ?? []) {
    push(Math.round(fy * (h - 1)) * w + Math.round(fx * (w - 1)));
  }
  while (sp > 0) {
    const p = stack[--sp] ?? 0;
    d[p * 4 + 3] = 0;
    pushNeighbours(p);
  }

  // 2. Large enclosed white regions (between cage bars, inside open doors, ...).
  if (opts.enclosedMinFraction !== undefined) {
    const minArea = Math.max(1, Math.round(opts.enclosedMinFraction * n));
    const comp = new Int32Array(n);
    for (let start = 0; start < n; start++) {
      if (seen[start] || !isWhite(start)) continue;
      let count = 0;
      push(start);
      while (sp > 0) {
        const p = stack[--sp] ?? 0;
        comp[count++] = p;
        pushNeighbours(p);
      }
      if (count >= minArea) {
        for (let i = 0; i < count; i++) d[(comp[i] ?? 0) * 4 + 3] = 0;
      }
    }
  }

  // Opaque content bounds (for placing feet on the ground regardless of image margins).
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if ((d[(y * w + x) * 4 + 3] ?? 0) > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  g.putImageData(data, 0, 0);
  return { canvas: c, bounds: x1 >= 0 ? { x0, y0, x1: x1 + 1, y1: y1 + 1 } : null };
}

/** Loads and cuts out an image. Missing files simply leave `canvas` null. */
export function loadArt(src: string, opts: CutoutOptions = {}): Art {
  const art: Art = { canvas: null, bounds: null, settled: false };
  const img = new Image();
  img.onload = () => {
    const cut = makeCutout(img, opts);
    art.canvas = cut.canvas;
    art.bounds = cut.bounds;
    art.settled = true;
  };
  img.onerror = () => {
    art.settled = true;
    console.warn(`[spike] could not load ${src}`);
  };
  img.src = src;
  return art;
}

// ---------------------------------------------------------------------------
// Audio (Web Audio, no files)
// ---------------------------------------------------------------------------

const MASTER_GAIN = 0.8;

/** Shared Web Audio bus. Scenes extend it with their own effects. */
export class AudioEngine {
  protected ctx: AudioContext | null = null;
  protected master: GainNode | null = null;
  protected noise: AudioBuffer | null = null;
  private crackleIn = 0.3;
  muted = false;

  /** Must be called from a user gesture (key press). */
  init(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor: typeof AudioContext | undefined =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER_GAIN;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const ch = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    void this.ctx.resume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    if (this.ctx && this.master) {
      this.master.gain.setTargetAtTime(m ? 0 : MASTER_GAIN, this.ctx.currentTime, 0.03);
    }
  }

  toggleMute(): void {
    this.setMuted(!this.muted);
  }

  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }

  protected noiseSrc(loop: boolean): AudioBufferSourceNode | null {
    if (!this.ctx || !this.noise) return null;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = loop;
    return s;
  }

  /** Soft bell chime. 'awaken' is a short rising arpeggio. */
  chime(kind: 'appear' | 'awaken'): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const notes = kind === 'awaken' ? [523, 659, 784, 1047] : [784, 1175];
    const t0 = ctx.currentTime;
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      const st = t0 + i * 0.12;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.13, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 1.3);
      o.connect(g).connect(master);
      o.start(st);
      o.stop(st + 1.4);
    });
  }

  /** Very quiet lamp crackle: sparse tiny filtered noise ticks, scheduled from the frame loop. */
  crackle(dt: number): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.muted) return;
    this.crackleIn -= dt;
    if (this.crackleIn > 0) return;
    this.crackleIn = 0.05 + Math.random() * Math.random() * 0.7;
    const n = this.noiseSrc(false);
    if (!n) return;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1500 + Math.random() * 2500;
    const g = ctx.createGain();
    const t0 = ctx.currentTime;
    const len = 0.006 + Math.random() * 0.02;
    g.gain.setValueAtTime(0.004 + Math.random() * 0.012, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
    n.connect(hp).connect(g).connect(master);
    n.start(t0, Math.random() * 1.5, len + 0.01);
  }
}

// ---------------------------------------------------------------------------
// Captions and overlays
// ---------------------------------------------------------------------------

const CAPTION_FADE_IN = 0.35;
const CAPTION_FADE_OUT = 0.3;

/** Cross-fades between captions: fade the old one out, then the new one in. */
export function createCaptionFader(initial: string) {
  let shown = initial;
  let alpha = 0;
  return {
    update(current: string, dt: number): { text: string; alpha: number } {
      if (shown !== current) {
        alpha -= dt / CAPTION_FADE_OUT;
        if (alpha <= 0) {
          alpha = 0;
          shown = current;
        }
      } else {
        alpha = Math.min(1, alpha + dt / CAPTION_FADE_IN);
      }
      return { text: shown, alpha };
    },
    reset(text: string): void {
      shown = text;
      alpha = 0;
    },
  };
}

/**
 * Caption in the band between the ground line and the bottom of the screen: max 80% width,
 * centred, at most 2 lines, clamp(18px, 2.6vw, 34px). Drawn in screen pixels.
 */
export function drawCaption(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  text: string,
  alpha: number,
): void {
  if (alpha <= 0.001 || !text) return;
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.width;
  const H = canvas.height;
  let size = clamp(0.026 * window.innerWidth, 18, 34) * dpr;
  const maxW = W * 0.8;

  const wrap = (): string[] => {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(' ')) {
      const trial = line ? `${line} ${word}` : word;
      if (line && ctx.measureText(trial).width > maxW) {
        lines.push(line);
        line = word;
      } else {
        line = trial;
      }
    }
    if (line) lines.push(line);
    return lines;
  };

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  let lines: string[] = [];
  for (let i = 0; i < 8; i++) {
    ctx.font = `italic ${size}px Georgia, 'Times New Roman', serif`;
    lines = wrap();
    if (lines.length <= 2) break;
    size *= 0.92; // never more than two lines
  }
  ctx.fillStyle = '#f6e7c8';
  ctx.shadowColor = 'rgba(25,10,0,0.85)';
  ctx.shadowBlur = size * 0.35;
  ctx.shadowOffsetY = size * 0.06;
  const lineH = size * 1.3;
  const bandCentre = H * (GROUND + 1) * 0.5 + H * 0.01;
  const top = bandCentre - ((lines.length - 1) * lineH) / 2;
  lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lineH));
  ctx.restore();
}

/** Small hint line near the top of the screen (e.g. "Press R to play again"). */
export function drawHint(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  text: string,
  alpha: number,
): void {
  if (alpha <= 0.001) return;
  const size = clamp(0.02 * window.innerWidth, 14, 24) * (window.devicePixelRatio || 1);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px Georgia, 'Times New Roman', serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#f6e7c8';
  ctx.shadowColor = 'rgba(25,10,0,0.85)';
  ctx.shadowBlur = 8;
  ctx.fillText(text, canvas.width / 2, canvas.height * 0.08);
  ctx.restore();
}

/** Soft radial glow (in whatever transform is current). `rgb` like '255,226,150'. */
export function drawGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  alpha: number,
  rgb = '255,226,150',
): void {
  if (alpha <= 0.001 || radius <= 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, `rgba(${rgb},${alpha})`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = g;
  ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  ctx.restore();
}

/** Hold-progress ring around the fingertip, in world units. */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
): void {
  const r = 0.045;
  ctx.save();
  ctx.globalCompositeOperation = 'source-over';
  ctx.lineCap = 'round';
  ctx.lineWidth = 0.008;
  ctx.shadowColor = 'rgba(25,10,0,0.6)';
  ctx.shadowBlur = 6;
  ctx.strokeStyle = 'rgba(246,231,200,0.3)';
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,244,214,0.95)';
  ctx.beginPath();
  ctx.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(progress, 0, 1));
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Stage: page takeover, fit, world transform
// ---------------------------------------------------------------------------

export interface Stage {
  readonly active: boolean;
  /** World width in world units (>= MIN_ASPECT). */
  readonly aspect: number;
  /** Take over the page: full-viewport canvas, no scrolling, privacy notice hidden. */
  enter(): void;
  /** Restore the normal preview page. */
  exit(): void;
  /** Size the canvas to the window (devicePixelRatio aware). Cheap; call every frame. */
  fit(): void;
  /** Fingertip (mirrored, normalized screen) -> world units. */
  tipToWorld(tip: { x: number; y: number }): { x: number; y: number };
  /** Set the canvas transform so drawing is in world units. */
  applyWorldTransform(ctx: CanvasRenderingContext2D): void;
}

/**
 * @param onAspectChange called with (newAspect / oldAspect) when the world width changes,
 *   so scenes can keep actors on their width-relative anchors.
 */
export function createStage(
  canvas: HTMLCanvasElement,
  onAspectChange: (k: number) => void = () => {},
): Stage {
  let active = false;
  let aspect = MIN_ASPECT;
  let worldScale = 1; // screen px per world unit = H * worldScale
  const worldOffsetY = () => GROUND * (1 - worldScale); // keeps the ground at GROUND of screen
  let saved: {
    canvasCss: string;
    w: number;
    h: number;
    html: string;
    body: string;
    app: string;
    notice: string;
  } | null = null;

  function fit(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    const screenAspect = w / h;
    const newAspect = Math.max(screenAspect, MIN_ASPECT);
    worldScale = screenAspect / newAspect;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (Math.abs(newAspect - aspect) > 1e-6) {
      const k = newAspect / aspect;
      aspect = newAspect;
      onAspectChange(k);
    }
  }

  const onResize = () => fit();

  return {
    get active() {
      return active;
    },
    get aspect() {
      return aspect;
    },
    enter() {
      if (active) return;
      active = true;
      const html = document.documentElement;
      const body = document.body;
      const app = document.getElementById('app');
      const notice = document.querySelector<HTMLElement>('.on-device-notice');
      saved = {
        canvasCss: canvas.style.cssText,
        w: canvas.width,
        h: canvas.height,
        html: html.style.cssText,
        body: body.style.cssText,
        app: app?.style.cssText ?? '',
        notice: notice?.style.display ?? '',
      };
      html.style.cssText += ';height:100%;margin:0;padding:0;overflow:hidden;';
      body.style.cssText += ';height:100%;margin:0;padding:0;overflow:hidden;';
      if (app) app.style.cssText += ';padding:0;margin:0;display:block;height:100%;overflow:hidden;';
      if (notice) notice.style.display = 'none';
      canvas.style.cssText =
        'position:fixed;left:0;top:0;width:100vw;height:100vh;max-width:none;display:block;';
      fit();
      window.addEventListener('resize', onResize);
    },
    exit() {
      if (!active) return;
      active = false;
      window.removeEventListener('resize', onResize);
      if (saved) {
        document.documentElement.style.cssText = saved.html;
        document.body.style.cssText = saved.body;
        const app = document.getElementById('app');
        if (app) app.style.cssText = saved.app;
        const notice = document.querySelector<HTMLElement>('.on-device-notice');
        if (notice) notice.style.display = saved.notice;
        canvas.style.cssText = saved.canvasCss;
        canvas.width = saved.w;
        canvas.height = saved.h;
        saved = null;
      }
    },
    fit,
    tipToWorld(tip) {
      return { x: tip.x * aspect, y: (tip.y - worldOffsetY()) / worldScale };
    },
    applyWorldTransform(ctx) {
      const H = canvas.height;
      ctx.setTransform(H * worldScale, 0, 0, H * worldScale, 0, H * worldOffsetY());
    },
  };
}
