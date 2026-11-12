// Spike: "The Clever Rabbit and the Lion", one short playable shadow-puppet scene.
// The story is DATA (BEATS below); the code underneath just plays it.
// Landmarks arrive already mirrored (Display_Coordinate_Space); we never flip them again.
//
// All scene geometry is expressed in world units: 1 unit = canvas height on screens at least
// 16:9 wide, so x runs 0..aspect and y runs 0..1. On narrower screens the world is scaled
// down (keeping 16:9 of width, and the ground line at 72% of the screen) so nothing falls
// off the edge. The canvas transform is set once per frame so layout follows the window.
import type { FrameResult } from '../vision/types';

// ---------------------------------------------------------------------------
// Screenplay
// ---------------------------------------------------------------------------

type BeatType = 'narrate' | 'awaken' | 'lead';
type Who = 'lion' | 'rabbit';
type BeatAction = 'lionLeapsIntoWell' | 'finale';

interface Cue {
  /** Seconds after the beat starts. */
  at: number;
  appear: Who;
}

interface Beat {
  type: BeatType;
  caption: string;
  /** Narrate beats: seconds on screen before moving on. */
  seconds?: number;
  cues?: Cue[];
  /** Scripted choreography played while the beat runs. */
  action?: BeatAction;
  /** Final beat: never advances. */
  last?: boolean;
}

export const BEATS: readonly Beat[] = [
  {
    type: 'narrate',
    caption: 'Deep in the forest lived a fierce lion who demanded an animal every day.',
    seconds: 2.5,
    cues: [{ at: 0.2, appear: 'lion' }],
  },
  {
    type: 'awaken',
    caption: "Today it was the clever rabbit's turn. Raise your hand to wake the rabbit.",
    cues: [{ at: 0.3, appear: 'rabbit' }],
  },
  {
    type: 'lead',
    caption: 'Lead the lion to the old well.',
  },
  {
    type: 'narrate',
    caption:
      "'Another lion lives down there,' said the rabbit. The lion looked in, and saw himself.",
    seconds: 6.4,
    action: 'lionLeapsIntoWell',
  },
  {
    type: 'narrate',
    caption: 'And so the clever rabbit saved the forest.',
    action: 'finale',
    last: true,
  },
];

// ---------------------------------------------------------------------------
// Tuning (H units: 1 = canvas height)
// ---------------------------------------------------------------------------

const INDEX_TIP = 8;
const FOLLOW_LERP = 0.15; // per 60 fps frame
const LION_LERP = 0.045; // more lag than the rabbit
const HOLD_SECONDS = 1;
const HOLD_STEADY = 0.03;
const APPEAR_SECONDS = 0.6;
const CAPTION_FADE_IN = 0.35;
const CAPTION_FADE_OUT = 0.3;

const SPRITE_ASPECT = 1.5; // all PNGs are 1536x1024
/** Narrowest world we lay out for; narrower screens scale the world down instead. */
const MIN_ASPECT = 16 / 9;
const GROUND = 0.72;
const LION_H = 0.3;
const RABBIT_H = 0.2;
const WELL_H = 0.35;
/** Fraction of each sprite's height that is empty margin below the feet. */
const LION_FOOT = 0.035;
const RABBIT_FOOT = 0.04;
const WELL_FOOT = 0.065;
/** Content half-widths, accounting for transparent margins in the art. */
const WELL_HALF = 0.19;
const RABBIT_HALF = 0.145;
const LION_GAP = 0.47; // min centre distance: one lion body-length
const LION_MIN_X = 0.21;
/** Lion's content half-width (its art has some empty margin). */
const LION_HALF = 0.21;
/** Where the lion stands on the right of the well, relative to the well centre. */
const LION_RIGHT_OFFSET = 0.26;
/** Well opening (water surface), as fractions of the well sprite. */
const OPENING = { cx: 780 / 1536, cy: 612 / 1024, rx: 290 / 1536, ry: 34 / 1024 };
const RIM_FRAC = 650 / 1024; // front rim of the well opening, as a fraction of sprite height
const ROOF_FRAC = 15 / 1024;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smooth = (t: number) => {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Frame-rate independent version of a "per frame at 60 fps" lerp factor. */
const rate = (perFrame: number, dt: number) => 1 - Math.pow(1 - perFrame, dt * 60);

// ---------------------------------------------------------------------------
// Art: white background -> transparency via flood fill from the image edges
// ---------------------------------------------------------------------------

const WHITE_TOLERANCE = 30;

/**
 * Removes only the white that is connected to the outside (flood fill from the edges),
 * so the white perforation dots inside the puppet stay. `extraSeeds` (fractions of the
 * image size) cover white pockets that are enclosed by the art but are really background.
 */
function makeCutout(img: HTMLImageElement, extraSeeds: [number, number][] = []): HTMLCanvasElement {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return c;
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, w, h);
  const d = data.data;
  const lo = 255 - WHITE_TOLERANCE;
  const isWhite = (p: number) =>
    (d[p * 4] ?? 0) >= lo && (d[p * 4 + 1] ?? 0) >= lo && (d[p * 4 + 2] ?? 0) >= lo;

  const seen = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let sp = 0;
  const push = (p: number) => {
    if (seen[p] || !isWhite(p)) return;
    seen[p] = 1;
    stack[sp++] = p;
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  for (const [fx, fy] of extraSeeds) {
    push(Math.round(fy * (h - 1)) * w + Math.round(fx * (w - 1)));
  }
  while (sp > 0) {
    const p = stack[--sp] ?? 0;
    d[p * 4 + 3] = 0;
    const x = p % w;
    if (x > 0) push(p - 1);
    if (x < w - 1) push(p + 1);
    if (p >= w) push(p - w);
    if (p < w * (h - 1)) push(p + w);
  }
  g.putImageData(data, 0, 0);
  return c;
}

interface Art {
  canvas: HTMLCanvasElement | null;
}

function loadArt(src: string, extraSeeds: [number, number][] = []): Art {
  const art: Art = { canvas: null };
  const img = new Image();
  img.onload = () => {
    art.canvas = makeCutout(img, extraSeeds);
  };
  img.src = src;
  return art;
}

// ---------------------------------------------------------------------------
// Sound effects (Web Audio, no files)
// ---------------------------------------------------------------------------

const MASTER_GAIN = 0.8;

class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private crackleIn = 0.3;
  muted = false;

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

  dispose(): void {
    if (this.ctx) void this.ctx.close();
    this.ctx = null;
    this.master = null;
    this.noise = null;
  }

  private noiseSrc(loop: boolean): AudioBufferSourceNode | null {
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

  /** Low rumbling roar: filtered noise + low oscillator with a tremolo. */
  roar(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    const dur = 1.5;

    const n = this.noiseSrc(true);
    if (n) {
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 2;
      lp.frequency.setValueAtTime(700, t0);
      lp.frequency.exponentialRampToValueAtTime(160, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.15);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      n.connect(lp).connect(g).connect(master);
      n.start(t0);
      n.stop(t0 + dur + 0.1);
    }

    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(75, t0);
    o.frequency.exponentialRampToValueAtTime(42, t0 + dur);
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 260;
    const trem = ctx.createGain();
    trem.gain.value = 0.7;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 17;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(trem.gain);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.0001, t0);
    g2.gain.exponentialRampToValueAtTime(0.4, t0 + 0.12);
    g2.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(lp2).connect(trem).connect(g2).connect(master);
    o.start(t0);
    lfo.start(t0);
    o.stop(t0 + dur + 0.1);
    lfo.stop(t0 + dur + 0.1);
  }

  /** Hollow splash: noisy burst, a low "bloop", and a damped echo for the well-shaft ring. */
  splash(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;

    const echoIn = ctx.createGain();
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.11;
    const fb = ctx.createGain();
    fb.gain.value = 0.45;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 1100;
    echoIn.connect(delay);
    delay.connect(damp).connect(fb).connect(delay);
    damp.connect(master);
    echoIn.connect(master);

    const n = this.noiseSrc(true);
    if (n) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 0.8;
      bp.frequency.setValueAtTime(1800, t0);
      bp.frequency.exponentialRampToValueAtTime(400, t0 + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.5, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
      n.connect(bp).connect(g).connect(echoIn);
      n.start(t0);
      n.stop(t0 + 0.8);
    }

    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(260, t0);
    o.frequency.exponentialRampToValueAtTime(90, t0 + 0.25);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.0001, t0);
    og.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
    og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
    o.connect(og).connect(echoIn);
    o.start(t0);
    o.stop(t0 + 0.45);
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
// Actors
// ---------------------------------------------------------------------------

interface Actor {
  x: number; // centre, H units
  y: number;
  /** Horizontal scale: 1 = facing right, -1 = facing left (in-between while turning). */
  facing: number;
  /** Rotation in the puppet's own (already flipped) frame; positive = nose down. */
  rot: number;
  /** 0..1 appear animation progress; -1 = not yet cued. */
  appear: number;
  extraScale: number;
  alpha: number;
  glow: number;
  speed: number; // units/s, for bob
  alive: boolean; // allowed to bob
}

function makeActor(x: number, y: number): Actor {
  return {
    x,
    y,
    facing: 1,
    rot: 0,
    appear: -1,
    extraScale: 1,
    alpha: 1,
    glow: 0,
    speed: 0,
    alive: false,
  };
}

const centreOnGround = (h: number, foot: number) => GROUND - h / 2 + foot * h;

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface LionRabbitScene {
  /** Take over the page (full-viewport canvas), start audio. Call from a key press. */
  enter(): void;
  exit(): void;
  readonly active: boolean;
  render(frame: FrameResult): void;
  restart(): void;
  toggleMute(): void;
}

export function createLionRabbitScene(canvas: HTMLCanvasElement): LionRabbitScene {
  const ctx = canvas.getContext('2d');
  const rabbitArt = loadArt('/art/rabbit.png');
  const lionArt = loadArt('/art/lion.png');
  // The well has white pockets enclosed by the pillars/crossbar that are really background.
  const wellArt = loadArt('/art/well.png', [
    [520 / 1536, 225 / 1024],
    [1020 / 1536, 225 / 1024],
    [600 / 1536, 450 / 1024],
    [1000 / 1536, 450 / 1024],
  ]);
  const sfx = new Sfx();

  let active = false;
  let aspect = MIN_ASPECT; // world width in world units
  let worldScale = 1; // screen px per world unit = H * worldScale
  const worldOffsetY = () => GROUND * (1 - worldScale); // keeps the ground at 72% of the screen
  /** Fingertip (mirrored, normalized screen) -> world units. */
  const tipToWorld = (tip: { x: number; y: number }) => ({
    x: tip.x * aspect,
    y: (tip.y - worldOffsetY()) / worldScale,
  });

  // saved page state for exit()
  let saved: {
    canvasCss: string;
    w: number;
    h: number;
    html: string;
    body: string;
    app: string;
    notice: string;
  } | null = null;

  // ---- layout (H units) ----
  // Well at ~78% of the width, but always leaving room for the lion on its right.
  const wellX = () =>
    Math.min(0.78 * aspect, aspect - LION_RIGHT_OFFSET - LION_HALF - 0.03);
  const lionRightX = () => wellX() + LION_RIGHT_OFFSET;
  const lionX0 = () => 0.22 * aspect;
  const rabbitX0 = () => 0.4 * aspect;
  const stopX = () => wellX() - WELL_HALF - RABBIT_HALF - 0.04; // beside (left of) the well
  const lionGroundY = () => centreOnGround(LION_H, LION_FOOT);
  const rabbitGroundY = () => centreOnGround(RABBIT_H, RABBIT_FOOT);
  const wellY = () => centreOnGround(WELL_H, WELL_FOOT);
  const wellTop = () => wellY() - WELL_H / 2;
  const rimY = () => wellTop() + RIM_FRAC * WELL_H;
  const roofY = () => wellTop() + ROOF_FRAC * WELL_H;

  // ---- state ----
  let beatIndex = 0;
  let beatTime = 0;
  let rabbit = makeActor(rabbitX0(), rabbitGroundY());
  let lion = makeActor(lionX0(), lionGroundY());
  const fired = new Set<number>();

  let holdTime = 0;
  let holdAnchor: { x: number; y: number } | null = null;
  let awakeningT = -1;
  let ringTip: { x: number; y: number; progress: number } | null = null;

  let arriveT = -1;

  let leapStart = { x: 0, y: 0 };
  let roared = false;
  let splashed = false;
  let lionBehind = false;
  let lionHidden = false;
  let reflection = 0;
  let roarShake = 0;

  let shownCaption = BEATS[0]?.caption ?? '';
  let capAlpha = 0;

  let warmth = 0;
  let endTime = 0;
  let lastNow = performance.now();

  function resetState(): void {
    beatIndex = 0;
    beatTime = 0;
    rabbit = makeActor(rabbitX0(), rabbitGroundY());
    lion = makeActor(lionX0(), lionGroundY());
    fired.clear();
    holdTime = 0;
    holdAnchor = null;
    awakeningT = -1;
    ringTip = null;
    arriveT = -1;
    roared = false;
    splashed = false;
    lionBehind = false;
    lionHidden = false;
    reflection = 0;
    roarShake = 0;
    shownCaption = BEATS[0]?.caption ?? '';
    capAlpha = 0;
    warmth = 0;
    endTime = 0;
    lastNow = performance.now();
  }

  function nextBeat(): void {
    if (beatIndex >= BEATS.length - 1) return;
    beatIndex++;
    beatTime = 0;
    fired.clear();
    const beat = BEATS[beatIndex];
    if (!beat) return;
    if (beat.action === 'lionLeapsIntoWell') leapStart = { x: lion.x, y: lion.y };
  }

  // ---- page takeover ----

  function sizeCanvas(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(window.innerWidth * dpr));
    const h = Math.max(1, Math.round(window.innerHeight * dpr));
    const screenAspect = w / h;
    const newAspect = Math.max(screenAspect, MIN_ASPECT);
    worldScale = screenAspect / newAspect;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    if (Math.abs(newAspect - aspect) > 1e-6) {
      // Anchors are fractions of the width, so keep actors on their anchors.
      const k = newAspect / aspect;
      rabbit.x *= k;
      lion.x *= k;
      leapStart.x *= k;
      aspect = newAspect;
    }
  }

  const onResize = () => sizeCanvas();

  function enter(): void {
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
    sizeCanvas();
    window.addEventListener('resize', onResize);

    sfx.init(); // inside the key-press gesture
    resetState();
  }

  function exit(): void {
    if (!active) return;
    active = false;
    window.removeEventListener('resize', onResize);
    sfx.dispose();
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
  }

  function toggleMute(): void {
    const m = !sfx.muted;
    sfx.setMuted(m);
  }

  // ---- drawing ----

  function drawScreen(w: number, h: number, t: number): void {
    if (!ctx) return;
    // Slow layered sines: smooth, never strobing.
    const flicker =
      0.04 * Math.sin(t * 1.3) + 0.03 * Math.sin(t * 2.9 + 1.7) + 0.02 * Math.sin(t * 5.1 + 0.4);
    const k = (1 + flicker) * (1 + 0.16 * warmth);
    const cx = w / 2 + Math.sin(t * 0.7) * w * 0.01;
    const cy = h / 2 + Math.cos(t * 0.9) * h * 0.01;
    const r = Math.hypot(w, h) * (0.55 + 0.1 * warmth);
    const rr = 1 + 0.06 * warmth;
    const bb = 1 - 0.3 * warmth;
    const col = (R: number, G: number, B: number) =>
      `rgb(${clamp(Math.round(R * k * rr), 0, 255)},${clamp(Math.round(G * k), 0, 255)},${clamp(
        Math.round(B * k * bb),
        0,
        255,
      )})`;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, col(255, 205, 120));
    g.addColorStop(0.45, col(224, 150, 72));
    g.addColorStop(0.8, col(120, 66, 28));
    g.addColorStop(1, col(40, 20, 8));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    const v = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.65 - 0.25 * warmth})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }

  /** Soft warm glow in H units. */
  function drawGlow(x: number, y: number, radius: number, alpha: number): void {
    if (!ctx || alpha <= 0.001) return;
    const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
    g.addColorStop(0, `rgba(255,226,150,${alpha})`);
    g.addColorStop(1, 'rgba(255,226,150,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
  }

  function drawPuppet(art: Art, a: Actor, heightU: number, bobAmp: number, t: number): void {
    if (!ctx || !art.canvas) return;
    const ap = a.appear < 0 ? 0 : smooth(a.appear);
    const alpha = ap * a.alpha;
    if (alpha <= 0.002) return;
    const scale = (0.85 + 0.15 * ap) * a.extraScale;
    const sh = heightU * scale;
    const sw = sh * SPRITE_ASPECT;
    const bob = a.alive ? Math.sin(t * 2.3) * (bobAmp + Math.min(a.speed, 1) * 0.008) : 0;

    // Subtle warm glow behind the puppet (translucent-leather feel) + appear pulse.
    drawGlow(a.x, a.y + bob, heightU * 0.75, 0.2 * alpha + 0.55 * a.glow);

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    ctx.translate(a.x, a.y + bob);
    ctx.scale(a.facing, 1);
    ctx.rotate(a.rot);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(art.canvas, -sw / 2, -sh / 2, sw, sh);
    ctx.restore();
  }

  function drawWell(): void {
    if (!ctx || !wellArt.canvas) return;
    const sh = WELL_H;
    const sw = sh * SPRITE_ASPECT;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(wellArt.canvas, wellX() - sw / 2, wellY() - sh / 2, sw, sh);
    ctx.restore();
  }

  /** Caption in a bottom band: max 80% width, at most 2 lines, clamp(18px, 2.6vw, 34px). */
  function drawCaption(text: string, alpha: number): void {
    if (!ctx || alpha <= 0.001 || !text) return;
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
    const bandCentre = H * (GROUND + 1) * 0.5 + H * 0.01; // band between ground line and bottom
    const top = bandCentre - ((lines.length - 1) * lineH) / 2;
    lines.forEach((l, i) => ctx.fillText(l, W / 2, top + i * lineH));
    ctx.restore();
  }

  function drawRing(x: number, y: number, progress: number): void {
    if (!ctx) return;
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

  // ---- motion ----

  function appearActor(a: Actor, who: Who): void {
    if (a.appear >= 0) return;
    a.appear = 0;
    sfx.chime('appear');
    void who;
  }

  function stepAppear(a: Actor, dt: number): void {
    if (a.appear < 0) return;
    if (a.appear < 1) a.appear = Math.min(1, a.appear + dt / APPEAR_SECONDS);
    // Glow pulse over the appear animation.
    a.glow = a.appear < 1 ? Math.sin(a.appear * Math.PI) : Math.max(0, a.glow - dt * 2);
  }

  /** Rabbit tracks the fingertip, constrained to stay beside (not on) the well and ahead of the lion. */
  function leadStep(tip: { x: number; y: number }, dt: number): void {
    const px = rabbit.x;
    const k = rate(FOLLOW_LERP, dt);
    const { x: tx, y: ty } = tipToWorld(tip);
    const minY = 0.05 + RABBIT_H / 2;
    let rx = rabbit.x + (clamp(tx, 0, stopX()) - rabbit.x) * k;
    const ry = rabbit.y + (clamp(ty, minY, rabbitGroundY()) - rabbit.y) * k;

    // Lion trails at least one body-length behind, never overlapping the rabbit.
    const lionTarget = Math.max(LION_MIN_X, rx - LION_GAP);
    const lpx = lion.x;
    lion.x += (lionTarget - lion.x) * rate(LION_LERP, dt);
    lion.y = lionGroundY();
    rx = Math.max(rx, lion.x + LION_GAP);
    rabbit.x = Math.min(rx, stopX());
    rabbit.y = ry;

    const vx = (rabbit.x - px) / Math.max(dt, 1e-3);
    rabbit.speed = Math.abs(vx);
    if (vx > 0.04) rabbit.facing = 1;
    else if (vx < -0.04) rabbit.facing = -1;
    rabbit.rot += (clamp(Math.abs(vx) * 0.35, 0, 0.3) - rabbit.rot) * rate(0.15, dt);

    const lvx = (lion.x - lpx) / Math.max(dt, 1e-3);
    lion.speed = Math.abs(lvx);
    if (lvx > 0.02) lion.facing = 1;
    else if (lvx < -0.02) lion.facing = -1;
    lion.rot += (clamp(Math.abs(lvx) * 0.2, 0, 0.12) - lion.rot) * rate(0.1, dt);
  }

  /**
   * Scripted: the lion bounds over the rabbit and the well to the well's right side,
   * turns round, leans over the rim, sees its reflection, roars at it, then jumps up and
   * drops into the opening (behind the well, clipped at the rim).
   */
  function playLionLeap(t: number): void {
    const wx = wellX();
    const rx = lionRightX();
    const ground = lionGroundY();
    const apexY = roofY() - LION_H * 0.45;
    const endY = rimY() + LION_H * 0.5 * 0.8 + 0.01;
    lion.alpha = 1;
    lion.extraScale = 1;
    lion.alive = t > 1.5 && t < 3.7; // bob only while standing on the ground
    lion.speed = 0;
    lionBehind = false;

    // The rabbit turns to watch.
    rabbit.facing += (1 - rabbit.facing) * rate(0.1, 1 / 60);
    rabbit.rot *= 0.9;

    let x = leapStart.x;
    let y = leapStart.y;
    let rot = 0;
    let facing = 1;

    // 0-0.3 s: crouch.
    if (t < 0.3) {
      rot = -0.08 * smooth(t / 0.3);
    } else if (t < 1.5) {
      // 0.3-1.5 s: bound over the rabbit and the well, landing on the right.
      const u = smooth((t - 0.3) / 1.2);
      const midY = lerp(leapStart.y, ground, 0.5);
      x = lerp(leapStart.x, rx, u);
      // Skewed arc: peaks late (~65%) so he is high while passing over the well.
      y = lerp(leapStart.y, ground, u) - Math.sin(Math.pow(u, 1.6) * Math.PI) * (midY - apexY);
      rot = lerp(-0.25, 0.25, u);
    } else {
      x = rx;
      y = ground;
      // 1.5-1.9 s: turn round to face the well.
      facing = lerp(1, -1, smooth((t - 1.5) / 0.4));
      // 1.9-2.5 s: lean over the rim.
      const lean = smooth((t - 1.9) / 0.6);
      rot = 0.32 * lean;
      x -= 0.03 * lean;
    }

    // Reflection fades in as he looks in, and out as he jumps.
    reflection = smooth((t - 2.1) / 0.5) * (1 - smooth((t - 3.8) / 0.4));

    // 2.6-3.7 s: roar at the "other lion", shaking.
    if (t >= 2.6 && !roared) {
      roared = true;
      sfx.roar();
    }
    roarShake = 0;
    if (t > 2.6 && t < 3.7) {
      roarShake = Math.sin(((t - 2.6) / 1.1) * Math.PI);
      x += Math.sin(t * 55) * 0.006 * roarShake;
      rot += Math.sin(t * 42) * 0.05 * roarShake;
    }

    // 3.7-4.6 s: spring up from the right, arcing to above the opening.
    if (t >= 3.7) {
      const u = clamp((t - 3.7) / 0.9, 0, 1);
      x = lerp(rx - 0.03, wx, smooth(u));
      y = lerp(ground, apexY, 1 - Math.pow(1 - u, 3));
      rot = lerp(0.32, 0.55, smooth(u));
      facing = -1;
    }

    // 4.6-5.5 s: drop BEHIND the well, clipped at the rim, shrinking slightly.
    if (t >= 4.6) {
      const u = clamp((t - 4.6) / 0.9, 0, 1);
      lionBehind = true;
      x = wx;
      y = lerp(apexY, endY, u * u);
      rot = lerp(0.55, 0.95, smooth(u));
      lion.extraScale = lerp(1, 0.8, u);
      if (u > 0.78 && !splashed) {
        splashed = true;
        sfx.splash();
      }
      if (u >= 1) lionHidden = true;
    }
    lion.x = x;
    lion.y = y;
    lion.rot = rot;
    lion.facing = facing;
  }

  /** The lion's upside-down, rippling reflection in the water of the well. */
  function drawReflection(t: number): void {
    if (!ctx || !lionArt.canvas) return;
    const sw = WELL_H * SPRITE_ASPECT;
    const cx = wellX() + (OPENING.cx - 0.5) * sw;
    const cy = wellY() - WELL_H / 2 + OPENING.cy * WELL_H;
    const rx = OPENING.rx * sw;
    const ry = OPENING.ry * WELL_H * 1.5;

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.clip();

    // Dark water.
    ctx.globalAlpha = 0.6 * reflection;
    ctx.fillStyle = 'rgb(38,20,10)';
    ctx.fillRect(cx - rx, cy - ry, rx * 2, ry * 2);

    // Upside-down lion, head centred in the water, shaking when he roars.
    const lh = 0.13;
    const lw = lh * SPRITE_ASPECT;
    const wobble = Math.sin(t * 3.1) * 0.003 + Math.sin(t * 55) * 0.004 * roarShake;
    ctx.globalAlpha = 0.85 * reflection;
    ctx.translate(cx + wobble, cy - ry * 0.2);
    ctx.scale(-1, -1); // faces left like the lion above, and upside down
    ctx.drawImage(lionArt.canvas, -0.86 * lw, -0.3 * lh, lw, lh);
    ctx.restore();

    // Ripples.
    ctx.save();
    ctx.globalAlpha = 0.35 * reflection;
    ctx.strokeStyle = 'rgba(255,230,170,1)';
    ctx.lineWidth = 0.0025;
    for (let i = 0; i < 2; i++) {
      const p = (t * 0.6 + i * 0.5) % 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * (0.3 + 0.6 * p), ry * (0.3 + 0.6 * p), 0, 0, Math.PI * 2);
      ctx.globalAlpha = 0.35 * reflection * (1 - p);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---- frame ----

  function render(frame: FrameResult): void {
    if (!ctx || !active) return;
    sizeCanvas(); // cheap; keeps us exact even if a resize event was missed
    const W = canvas.width;
    const H = canvas.height;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const t = now / 1000;

    sfx.crackle(dt);

    const beat = BEATS[beatIndex];
    const tip = frame.hands[0]?.landmarks[INDEX_TIP] ?? null;
    ringTip = null;

    beatTime += dt;

    // Cues: puppets appear shortly after their beat starts.
    if (beat?.cues) {
      beat.cues.forEach((cue, i) => {
        if (fired.has(i)) return;
        if (beatTime >= cue.at) {
          fired.add(i);
          appearActor(cue.appear === 'lion' ? lion : rabbit, cue.appear);
        }
      });
    }
    stepAppear(lion, dt);
    stepAppear(rabbit, dt);

    // ---- beat logic ----
    if (beat) {
      switch (beat.type) {
        case 'narrate': {
          if (beat.action === 'lionLeapsIntoWell') playLionLeap(beatTime);
          if (beat.action === 'finale') {
            warmth = clamp(warmth + dt / 3, 0, 1);
            endTime += dt;
          }
          if (!beat.last && beatTime >= (beat.seconds ?? 0)) nextBeat();
          break;
        }
        case 'awaken': {
          if (awakeningT >= 0) {
            // Awakening plays to completion regardless of the hand.
            awakeningT += dt;
            rabbit.glow = Math.max(rabbit.glow, Math.sin(clamp(awakeningT / 1.2, 0, 1) * Math.PI));
            if (awakeningT >= 0.9) rabbit.alive = true;
            if (awakeningT >= 1.4) {
              rabbit.glow = 0;
              nextBeat();
            }
          } else if (tip && rabbit.appear >= 0.6) {
            // Hold the fingertip steady for HOLD_SECONDS.
            const { x: tx, y: ty } = tipToWorld(tip);
            if (!holdAnchor || Math.hypot(tx - holdAnchor.x, ty - holdAnchor.y) > HOLD_STEADY) {
              holdAnchor = { x: tx, y: ty };
              holdTime = 0;
            } else {
              holdTime += dt;
            }
            ringTip = { x: tx, y: ty, progress: holdTime / HOLD_SECONDS };
            if (holdTime >= HOLD_SECONDS) {
              awakeningT = 0;
              sfx.chime('awaken');
            }
          } else if (!tip) {
            // Hand gone: beat is paused; re-anchor when it returns.
            holdAnchor = null;
          }
          break;
        }
        case 'lead': {
          rabbit.alive = true;
          lion.alive = true;
          if (arriveT >= 0) {
            // Settle beside the well; the lion keeps its distance.
            arriveT += dt;
            const k = rate(0.12, dt);
            rabbit.x += (stopX() - rabbit.x) * k;
            rabbit.y += (rabbitGroundY() - rabbit.y) * k;
            const target = Math.max(LION_MIN_X, rabbit.x - LION_GAP);
            lion.x += (target - lion.x) * rate(LION_LERP, dt);
            lion.rot *= 0.9;
            rabbit.rot *= 0.9;
            if (arriveT >= 0.4) nextBeat();
          } else if (tip) {
            leadStep(tip, dt);
            if (rabbit.x >= stopX() - 0.12 && rabbit.y >= rabbitGroundY() - 0.25) arriveT = 0;
          }
          break;
        }
      }
    }

    // ---- captions ----
    const currentCaption = BEATS[beatIndex]?.caption ?? '';
    if (shownCaption !== currentCaption) {
      capAlpha -= dt / CAPTION_FADE_OUT;
      if (capAlpha <= 0) {
        capAlpha = 0;
        shownCaption = currentCaption;
      }
    } else {
      capAlpha = Math.min(1, capAlpha + dt / CAPTION_FADE_IN);
    }

    // ---- draw ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawScreen(W, H, t);

    // From here on, world units (see top of file).
    ctx.setTransform(H * worldScale, 0, 0, H * worldScale, 0, H * worldOffsetY());

    const leading = beat?.type === 'lead' ? 1 : 0.35;
    drawGlow(wellX(), wellY(), 0.4, (0.22 + 0.06 * Math.sin(t * 1.7)) * leading + 0.08);

    const lionBob = 0.004;
    const rabbitBob = 0.008;

    if (lionBehind && !lionHidden) {
      // Behind the well, clipped at the rim so it vanishes into the opening.
      ctx.save();
      ctx.beginPath();
      ctx.rect(-1, -1, aspect + 2, rimY() + 1);
      ctx.clip();
      drawPuppet(lionArt, lion, LION_H, lionBob, t);
      ctx.restore();
    }
    drawWell();
    if (reflection > 0.001) drawReflection(t);
    if (!lionBehind && !lionHidden) drawPuppet(lionArt, lion, LION_H, lionBob, t);
    drawPuppet(rabbitArt, rabbit, RABBIT_H, rabbitBob, t);

    if (ringTip) drawRing(ringTip.x, ringTip.y, ringTip.progress);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawCaption(shownCaption, capAlpha);

    // "Press R to play again" once the story is told and the glow has settled.
    if (BEATS[beatIndex]?.last && endTime > 1) {
      const size = clamp(0.02 * window.innerWidth, 14, 24) * (window.devicePixelRatio || 1);
      ctx.save();
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = clamp((endTime - 1) / 0.6, 0, 1) * 0.9;
      ctx.font = `${size}px Georgia, 'Times New Roman', serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#f6e7c8';
      ctx.shadowColor = 'rgba(25,10,0,0.85)';
      ctx.shadowBlur = 8;
      ctx.fillText('Press R to play again', W / 2, H * 0.08);
      ctx.restore();
    }
  }

  return {
    enter,
    exit,
    get active() {
      return active;
    },
    render,
    restart() {
      if (active) resetState();
    },
    toggleMute,
  };
}
