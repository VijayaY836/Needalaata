// Spike: "Punchkin: The Soul in the Parrot", one short playable shadow-puppet scene.
// The story is DATA (BEATS below); the code underneath just plays it.
// Landmarks arrive already mirrored (Display_Coordinate_Space); we never flip them again.
// World units and fit rules come from stage-kit.ts.
import type { FrameResult } from '../vision/types';
import {
  AudioEngine,
  GROUND,
  INDEX_TIP,
  clamp,
  createCaptionFader,
  createStage,
  drawCaption,
  drawGlow,
  drawHint,
  drawRing,
  lerp,
  loadArt,
  rate,
  smooth,
  type Art,
  type CutoutOptions,
} from './stage-kit';

// ---------------------------------------------------------------------------
// Screenplay
// ---------------------------------------------------------------------------

type BeatType = 'narrate' | 'awaken' | 'lead' | 'free';
type ActorId = 'punchkin' | 'balna' | 'prince' | 'cage';
type BeatAction = 'crumble' | 'reunite';

interface Cue {
  /** Seconds after the beat starts. */
  at: number;
  appear: ActorId;
}

interface Beat {
  type: BeatType;
  /** Empty = no caption (the previous one fades out). */
  caption: string;
  /** Narrate / free beats: seconds on screen before moving on. */
  seconds?: number;
  cues?: Cue[];
  action?: BeatAction;
  /** Final beat: never advances. */
  last?: boolean;
}

export const BEATS: readonly Beat[] = [
  {
    type: 'narrate',
    caption: 'In a tower of stone, the sorcerer Punchkin held Princess Balna captive.',
    seconds: 3,
    cues: [
      { at: 0.2, appear: 'punchkin' },
      { at: 1.0, appear: 'balna' },
    ],
  },
  {
    type: 'narrate',
    caption: 'No sword could harm him, for his soul was hidden inside a green parrot.',
    seconds: 3,
    cues: [{ at: 0.2, appear: 'cage' }],
  },
  {
    type: 'awaken',
    caption:
      'Her son, the young prince, came to set her free. Raise your hand to wake the prince.',
    cues: [{ at: 0.3, appear: 'prince' }],
  },
  {
    type: 'lead',
    caption: "Lead the prince to the parrot's cage.",
  },
  {
    type: 'free',
    caption: '',
    seconds: 2.5,
  },
  {
    type: 'narrate',
    caption:
      "The parrot flew free, and Punchkin's magic flew with it. The sorcerer crumbled into dust.",
    seconds: 4,
    action: 'crumble',
  },
  {
    type: 'narrate',
    caption: 'Balna was free at last.',
    action: 'reunite',
    last: true,
  },
];

// ---------------------------------------------------------------------------
// Tuning (world units: 1 = canvas height on >= 16:9 screens)
// ---------------------------------------------------------------------------

const ART = '/art/punchkin/';
/** Removes white enclosed by the art (cage bars, open door) above 0.15% of the image. */
const CUTOUT: CutoutOptions = { tolerance: 30, enclosedMinFraction: 0.0015 };
/**
 * Which way each picture faces in the source PNG (1 = right, -1 = left).
 * Change these if a puppet ends up facing the wrong way.
 */
const ART_FACES: Record<'punchkin' | 'balna' | 'prince' | 'parrot', 1 | -1> = {
  punchkin: -1,
  balna: -1,
  prince: 1,
  parrot: 1,
};

const PUNCHKIN_H = 0.38;
const BALNA_H = 0.32;
const PRINCE_H = 0.34;
const CAGE_H = 0.3;
const PARROT_H = 0.11;
const CAGE_LIFT = 0.07; // cage hangs this far above the ground
const BALNA_BEHIND = 0.015; // Balna's feet sit slightly higher = further back

const FOLLOW_LERP = 0.15;
const HOLD_SECONDS = 1;
const HOLD_STEADY = 0.03;
const APPEAR_SECONDS = 0.6;
const PARTICLE_TARGET = 3000;

const GREEN = '120,255,150';
const WARM = '255,214,150';

// ---------------------------------------------------------------------------
// Sound effects
// ---------------------------------------------------------------------------

class PunchkinSfx extends AudioEngine {
  private drone: { stop: (fade: number) => void } | null = null;

  /** Low eerie drone: two detuned low oscillators beating slowly, through a breathing filter. */
  startDrone(): void {
    const { ctx, master } = this;
    if (!ctx || !master || this.drone) return;
    const t0 = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t0);
    out.gain.exponentialRampToValueAtTime(0.09, t0 + 2.5);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 320;
    lp.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 120;
    lfo.connect(lfoDepth).connect(lp.frequency);
    const oscs = [55, 55.6, 82.6].map((f, i) => {
      const o = ctx.createOscillator();
      o.type = i === 2 ? 'sine' : 'sawtooth';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = i === 2 ? 0.25 : 0.5;
      o.connect(g).connect(lp);
      o.start(t0);
      return o;
    });
    lp.connect(out).connect(master);
    lfo.start(t0);
    this.drone = {
      stop: (fade) => {
        const t = ctx.currentTime;
        out.gain.cancelScheduledValues(t);
        out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), t);
        out.gain.exponentialRampToValueAtTime(0.0001, t + fade);
        for (const o of oscs) o.stop(t + fade + 0.05);
        lfo.stop(t + fade + 0.05);
      },
    };
  }

  stopDrone(fade = 1.5): void {
    if (!this.drone) return;
    try {
      this.drone.stop(fade);
    } catch {
      // context already closed
    }
    this.drone = null;
  }

  override dispose(): void {
    this.drone = null;
    super.dispose();
  }

  /** Metallic creak: a slow, wavering click train through narrow metal resonances. */
  creak(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    const dur = 1.0;
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    src.frequency.setValueAtTime(22, t0);
    src.frequency.linearRampToValueAtTime(48, t0 + 0.35);
    src.frequency.linearRampToValueAtTime(30, t0 + 0.7);
    src.frequency.linearRampToValueAtTime(60, t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(0.5, t0 + 0.06);
    env.gain.setValueAtTime(0.5, t0 + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(env);
    for (const [f, q, gain] of [
      [820, 18, 0.5],
      [1630, 22, 0.35],
      [2710, 25, 0.25],
    ] as const) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(f, t0);
      bp.frequency.linearRampToValueAtTime(f * 1.06, t0 + dur);
      bp.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = gain;
      env.connect(bp).connect(g).connect(master);
    }
    src.start(t0);
    src.stop(t0 + dur + 0.05);
  }

  /** One soft wing flutter: a short double noise burst. */
  flutter(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    for (let i = 0; i < 2; i++) {
      const n = this.noiseSrc(false);
      if (!n) return;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 900 + Math.random() * 500;
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      const st = t0 + i * 0.045;
      g.gain.setValueAtTime(0.0001, st);
      g.gain.exponentialRampToValueAtTime(0.12, st + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.06);
      n.connect(bp).connect(g).connect(master);
      n.start(st, Math.random() * 1.5, 0.07);
    }
  }

  /** Granular crumbling hiss: a soft bed of hiss plus many tiny grains. */
  crumble(dur = 2.8): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;

    const bed = this.noiseSrc(true);
    if (bed) {
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.05, t0 + 0.4);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      bed.connect(hp).connect(g).connect(master);
      bed.start(t0);
      bed.stop(t0 + dur + 0.1);
    }

    for (let i = 0; i < 180; i++) {
      const n = this.noiseSrc(false);
      if (!n) return;
      // Denser early, thinning out.
      const st = t0 + Math.pow(Math.random(), 1.6) * dur;
      const len = 0.006 + Math.random() * 0.03;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1500 + Math.random() * 6000;
      bp.Q.value = 1.5;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.02 + Math.random() * 0.06, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st + len);
      n.connect(bp).connect(g).connect(master);
      n.start(st, Math.random() * 1.5, len + 0.01);
    }
  }

  /** Warm chime chord (C major, gently strummed). */
  chord(): void {
    const { ctx, master } = this;
    if (!ctx || !master) return;
    const t0 = ctx.currentTime;
    [261.6, 329.6, 392.0, 523.3, 659.3].forEach((f, i) => {
      for (const [type, gain] of [
        ['sine', 0.08],
        ['triangle', 0.025],
      ] as const) {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const g = ctx.createGain();
        const st = t0 + i * 0.06;
        g.gain.setValueAtTime(0.0001, st);
        g.gain.exponentialRampToValueAtTime(gain, st + 0.03);
        g.gain.exponentialRampToValueAtTime(0.0001, st + 3.5);
        o.connect(g).connect(master);
        o.start(st);
        o.stop(st + 3.6);
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

interface Actor {
  /** Centre of the opaque content, x. */
  x: number;
  /** Bottom of the opaque content (feet), y. */
  y: number;
  /** Content height, world units. */
  h: number;
  /** Horizontal scale: 1 = facing right, -1 = facing left. */
  facing: number;
  rot: number;
  /** 0..1 appear progress; -1 = not yet cued. */
  appear: number;
  alpha: number;
  glow: number;
  speed: number;
  alive: boolean;
  shakeX: number;
  /** Extra non-uniform scale (wing flaps). */
  sx: number;
  sy: number;
  hidden: boolean;
}

function makeActor(x: number, y: number, h: number, facing = 1): Actor {
  return {
    x,
    y,
    h,
    facing,
    rot: 0,
    appear: -1,
    alpha: 1,
    glow: 0,
    speed: 0,
    alive: false,
    shakeX: 0,
    sx: 1,
    sy: 1,
    hidden: false,
  };
}

/** Content width/height ratio of an art piece (fallback when not loaded). */
const contentAspect = (art: Art, fallback: number) =>
  art.bounds ? (art.bounds.x1 - art.bounds.x0) / (art.bounds.y1 - art.bounds.y0) : fallback;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  delay: number;
  life: number;
  age: number;
  size: number;
  color: string;
}

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  phase: number;
  size: number;
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

export interface PunchkinScene {
  enter(): void;
  exit(): void;
  readonly active: boolean;
  render(frame: FrameResult): void;
  restart(): void;
  toggleMute(): void;
}

export function createPunchkinScene(canvas: HTMLCanvasElement): PunchkinScene {
  const ctx = canvas.getContext('2d');
  const art = {
    punchkin: loadArt(`${ART}punchkin.png`, CUTOUT),
    balna: loadArt(`${ART}balna.png`, CUTOUT),
    prince: loadArt(`${ART}prince.png`, CUTOUT),
    caged: loadArt(`${ART}parrot-caged.png`, CUTOUT),
    open: loadArt(`${ART}cage-open.png`, CUTOUT),
    parrot: loadArt(`${ART}parrot.png`, CUTOUT),
  };
  const sfx = new PunchkinSfx();

  const stage = createStage(canvas, (k) => {
    for (const a of [punchkin, balna, prince, cage, parrot]) a.x *= k;
    for (const p of particles) p.x *= k;
    if (holdAnchor) holdAnchor.x *= k;
  });

  // ---- layout ----
  const W = () => stage.aspect;
  const halfW = (a: Art, h: number, fallback: number) => (h * contentAspect(a, fallback)) / 2;
  const cageX = () => Math.min(0.8 * W(), W() - halfW(art.caged, CAGE_H, 0.75) - 0.03);
  const cageFeet = () => GROUND - CAGE_LIFT;
  const princeHalf = () => halfW(art.prince, PRINCE_H, 0.5);
  const balnaHalf = () => halfW(art.balna, BALNA_H, 0.45);
  /** Goal: just left of the cage. */
  const stopX = () => cageX() - halfW(art.caged, CAGE_H, 0.75) - princeHalf() - 0.03;
  const princeX0 = () => 0.5 * W();
  const princeMinX = () => balna.x + balnaHalf() + princeHalf() * 0.6;

  // ---- state ----
  let punchkin = makeActor(0.22 * W(), GROUND, PUNCHKIN_H, ART_FACES.punchkin);
  let balna = makeActor(0.36 * W(), GROUND - BALNA_BEHIND, BALNA_H, ART_FACES.balna);
  let prince = makeActor(princeX0(), GROUND, PRINCE_H, ART_FACES.prince);
  let cage = makeActor(cageX(), cageFeet(), CAGE_H);
  let parrot = makeActor(0, 0, PARROT_H, -ART_FACES.parrot);
  let particles: Particle[] = [];
  const motes: Mote[] = [];

  let beatIndex = 0;
  let beatTime = 0;
  const fired = new Set<number>();
  let holdTime = 0;
  let holdAnchor: { x: number; y: number } | null = null;
  let awakeningT = -1;
  let ringTip: { x: number; y: number; progress: number } | null = null;
  let arriveT = -1;
  let proximity = 0; // 0..1 how close the prince is to the cage
  let cageOpen = false;
  let parrotPath: [number, number][] = [];
  let nextFlap = 0;
  let crumbled = false;
  let warmth = 0;
  let endTime = 0;
  let lastNow = performance.now();
  const captions = createCaptionFader(BEATS[0]?.caption ?? '');

  function seedMotes(): void {
    motes.length = 0;
    for (let i = 0; i < 70; i++) {
      motes.push({
        x: Math.random(),
        y: Math.random(),
        vx: (Math.random() - 0.5) * 0.01,
        vy: -0.004 - Math.random() * 0.01,
        phase: Math.random() * Math.PI * 2,
        size: 0.6 + Math.random() * 1.6,
      });
    }
  }

  function resetState(): void {
    punchkin = makeActor(0.22 * W(), GROUND, PUNCHKIN_H, ART_FACES.punchkin);
    balna = makeActor(0.36 * W(), GROUND - BALNA_BEHIND, BALNA_H, ART_FACES.balna);
    prince = makeActor(princeX0(), GROUND, PRINCE_H, ART_FACES.prince);
    cage = makeActor(cageX(), cageFeet(), CAGE_H);
    parrot = makeActor(0, 0, PARROT_H, -ART_FACES.parrot);
    parrot.hidden = true;
    particles = [];
    beatIndex = 0;
    beatTime = 0;
    fired.clear();
    holdTime = 0;
    holdAnchor = null;
    awakeningT = -1;
    ringTip = null;
    arriveT = -1;
    proximity = 0;
    cageOpen = false;
    parrotPath = [];
    nextFlap = 0;
    crumbled = false;
    warmth = 0;
    endTime = 0;
    lastNow = performance.now();
    captions.reset(BEATS[0]?.caption ?? '');
    sfx.stopDrone(0.2);
    seedMotes();
  }

  function startBeat(): void {
    const beat = BEATS[beatIndex];
    if (!beat) return;
    if (beat.type === 'free') {
      cageOpen = true;
      sfx.creak();
      // Parrot bursts out of the cage and arcs up and away to the upper left.
      const cx = cage.x;
      const cy = cage.y - cage.h * 0.45;
      parrot.x = cx;
      parrot.y = cy;
      parrot.hidden = false;
      parrot.appear = 1;
      parrot.alpha = 1;
      parrotPath = [
        [cx, cy],
        [cx - 0.15, cy - 0.45],
        [0.45 * W(), -0.05],
        [-0.25, -0.2],
      ];
      nextFlap = 0.05;
    }
    if (beat.action === 'reunite') {
      sfx.chord();
    }
  }

  function nextBeat(): void {
    if (beatIndex >= BEATS.length - 1) return;
    beatIndex++;
    beatTime = 0;
    fired.clear();
    startBeat();
  }

  // ---- page takeover ----

  function enter(): void {
    if (stage.active) return;
    stage.enter();
    sfx.init(); // inside the key-press gesture
    resetState();
  }

  function exit(): void {
    if (!stage.active) return;
    stage.exit();
    sfx.dispose();
  }

  // ---- drawing ----

  /** Moonlit night cloth: indigo gradient, pale moon glow, flickering warm lamp from below. */
  function drawScreen(Wpx: number, Hpx: number, t: number, dt: number): void {
    if (!ctx) return;
    const mix = (a: number, b: number) => Math.round(lerp(a, b, warmth));
    const rgb = (a: [number, number, number], b: [number, number, number], k = 1) =>
      `rgb(${clamp(mix(a[0], b[0]) * k, 0, 255)},${clamp(mix(a[1], b[1]) * k, 0, 255)},${clamp(
        mix(a[2], b[2]) * k,
        0,
        255,
      )})`;
    const cx = Wpx * 0.46 + Math.sin(t * 0.21) * Wpx * 0.01;
    const cy = Hpx * 0.42;
    const r = Math.hypot(Wpx, Hpx) * 0.6;

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, rgb([58, 64, 132], [196, 128, 66]));
    g.addColorStop(0.45, rgb([30, 33, 86], [128, 70, 34]));
    g.addColorStop(0.8, rgb([14, 15, 44], [56, 28, 12]));
    g.addColorStop(1, rgb([5, 5, 16], [20, 10, 4]));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, Wpx, Hpx);

    ctx.globalCompositeOperation = 'lighter';

    // Pale moon glow, upper left (warms with the ending).
    const mx = Wpx * 0.17;
    const my = Hpx * 0.17;
    const mr = Hpx * 0.42;
    const moon = ctx.createRadialGradient(mx, my, 0, mx, my, mr);
    const moonRgb = `${mix(205, 255)},${mix(218, 210)},${mix(255, 160)}`;
    moon.addColorStop(0, `rgba(${moonRgb},0.42)`);
    moon.addColorStop(0.18, `rgba(${moonRgb},0.22)`);
    moon.addColorStop(1, `rgba(${moonRgb},0)`);
    ctx.fillStyle = moon;
    ctx.fillRect(0, 0, Wpx, Hpx);

    // Warm lamp glow rising from the bottom centre, flickering (smooth, never strobing).
    const flicker =
      1 + 0.08 * Math.sin(t * 1.7) + 0.05 * Math.sin(t * 3.3 + 1.1) + 0.03 * Math.sin(t * 6.1 + 0.3);
    const lx = Wpx * 0.5 + Math.sin(t * 0.9) * Wpx * 0.008;
    const ly = Hpx * 1.08;
    const lr = Hpx * (0.75 + 0.2 * warmth) * (0.97 + 0.03 * flicker);
    const lamp = ctx.createRadialGradient(lx, ly, 0, lx, ly, lr);
    const la = (0.34 + 0.2 * warmth) * flicker;
    lamp.addColorStop(0, `rgba(255,170,80,${la})`);
    lamp.addColorStop(0.5, `rgba(230,120,50,${la * 0.4})`);
    lamp.addColorStop(1, 'rgba(230,120,50,0)');
    ctx.fillStyle = lamp;
    ctx.fillRect(0, 0, Wpx, Hpx);

    // Drifting dust motes, caught in the light.
    const dpr = window.devicePixelRatio || 1;
    for (const m of motes) {
      m.x += (m.vx + Math.sin(t * 0.5 + m.phase) * 0.004) * dt;
      m.y += m.vy * dt;
      if (m.y < -0.02) {
        m.y = 1.02;
        m.x = Math.random();
      }
      if (m.x < -0.02) m.x = 1.02;
      if (m.x > 1.02) m.x = -0.02;
      const a = 0.12 + 0.18 * (0.5 + 0.5 * Math.sin(t * 1.3 + m.phase * 3));
      const px = m.x * Wpx;
      const py = m.y * Hpx;
      const pr = m.size * dpr * 2.2;
      const dg = ctx.createRadialGradient(px, py, 0, px, py, pr);
      dg.addColorStop(0, `rgba(255,236,200,${a})`);
      dg.addColorStop(1, 'rgba(255,236,200,0)');
      ctx.fillStyle = dg;
      ctx.fillRect(px - pr, py - pr, pr * 2, pr * 2);
    }

    // Vignette.
    ctx.globalCompositeOperation = 'source-over';
    const v = ctx.createRadialGradient(Wpx / 2, Hpx / 2, Math.min(Wpx, Hpx) * 0.35, Wpx / 2, Hpx / 2, r);
    v.addColorStop(0, 'rgba(0,0,0,0)');
    v.addColorStop(1, `rgba(0,0,0,${0.6 - 0.2 * warmth})`);
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, Wpx, Hpx);
  }

  /**
   * Draws an actor so its opaque content is `a.h` tall, centred on a.x, with its bottom at a.y.
   * `pivot` 'top' rotates around the top (hanging cage), otherwise around the centre.
   */
  function drawActor(
    pic: Art,
    a: Actor,
    t: number,
    opts: { glowRgb?: string; glowBase?: number; bob?: number; pivot?: 'top' } = {},
  ): void {
    if (!ctx || !pic.canvas || !pic.bounds || a.hidden) return;
    const ap = a.appear < 0 ? 0 : smooth(a.appear);
    const alpha = ap * a.alpha;
    if (alpha <= 0.002) return;
    const b = pic.bounds;
    const bh = b.y1 - b.y0;
    const scale = (0.85 + 0.15 * ap) * (a.h / bh); // world units per source pixel
    const ch = bh * scale;
    const bob = a.alive ? Math.sin(t * 2.3 + a.x * 3) * ((opts.bob ?? 0.006) + Math.min(a.speed, 1) * 0.008) : 0;
    const cx = a.x + a.shakeX;
    const cy = a.y - ch / 2 + bob;

    // Soft glow behind (warm "lamp through leather", or the parrot's green).
    drawGlow(
      ctx,
      cx,
      cy,
      a.h * 0.75,
      (opts.glowBase ?? 0.14) * alpha + 0.55 * a.glow,
      opts.glowRgb ?? WARM,
    );

    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = alpha;
    if (opts.pivot === 'top') {
      ctx.translate(cx, cy - ch / 2);
      ctx.rotate(a.rot);
      ctx.translate(0, ch / 2);
    } else {
      ctx.translate(cx, cy);
      ctx.rotate(a.rot);
    }
    ctx.scale(a.facing * a.sx, a.sy);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    const srcCx = (b.x0 + b.x1) / 2;
    const srcCy = (b.y0 + b.y1) / 2;
    ctx.drawImage(
      pic.canvas,
      -srcCx * scale,
      -srcCy * scale,
      pic.canvas.width * scale,
      pic.canvas.height * scale,
    );
    ctx.restore();
  }

  // ---- motion ----

  function actorFor(id: ActorId): Actor {
    return id === 'punchkin' ? punchkin : id === 'balna' ? balna : id === 'prince' ? prince : cage;
  }

  function stepAppear(a: Actor, dt: number): void {
    if (a.appear < 0) return;
    if (a.appear < 1) a.appear = Math.min(1, a.appear + dt / APPEAR_SECONDS);
    a.glow = a.appear < 1 ? Math.sin(a.appear * Math.PI) : Math.max(0, a.glow - dt * 2);
  }

  function leadStep(tip: { x: number; y: number }, dt: number): void {
    const target = stage.tipToWorld(tip);
    const px = prince.x;
    const k = rate(FOLLOW_LERP, dt);
    // The fingertip holds the prince by his middle; feet stay between mid-screen and the ground.
    const tx = clamp(target.x, princeMinX(), stopX());
    const tFeet = clamp(target.y + prince.h / 2, 0.45, GROUND);
    prince.x += (tx - prince.x) * k;
    prince.y += (tFeet - prince.y) * k;
    const vx = (prince.x - px) / Math.max(dt, 1e-3);
    prince.speed = Math.abs(vx);
    if (vx > 0.04) prince.facing = ART_FACES.prince;
    else if (vx < -0.04) prince.facing = -ART_FACES.prince;
    const tilt = clamp(vx * 0.3, -0.25, 0.25);
    prince.rot += (tilt - prince.rot) * rate(0.15, dt);
  }

  function updateTremble(t: number): void {
    // Punchkin trembles harder as the prince nears his soul.
    const start = princeX0();
    const end = stopX();
    proximity = end > start ? clamp((prince.x - start) / (end - start), 0, 1) : 1;
    const amount = 0.15 + 0.85 * Math.pow(proximity, 1.4);
    punchkin.shakeX = Math.sin(t * 47) * 0.0055 * amount + Math.sin(t * 31 + 1) * 0.003 * amount;
    punchkin.rot = Math.sin(t * 39) * 0.025 * amount;
  }

  function bezier(pts: [number, number][], u: number): [number, number] {
    const [p0, p1, p2, p3] = pts as [
      [number, number],
      [number, number],
      [number, number],
      [number, number],
    ];
    const m = 1 - u;
    const a = m * m * m;
    const b = 3 * m * m * u;
    const c = 3 * m * u * u;
    const d = u * u * u;
    return [
      a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
      a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
    ];
  }

  function stepParrot(t: number, bt: number): void {
    if (parrot.hidden || parrotPath.length < 4) return;
    const dur = 2.3;
    const u = clamp(bt / dur, 0, 1);
    const eased = 1 - Math.pow(1 - u, 1.6); // bursts out fast
    const [x, y] = bezier(parrotPath, eased);
    const [nx, ny] = bezier(parrotPath, Math.min(1, eased + 0.01));
    parrot.x = x;
    parrot.y = y + parrot.h / 2; // y is the bird's centre
    // Wings: gentle scale/rotate wobble, plus heading tilt.
    const flap = Math.sin(t * 22);
    parrot.sy = 1 + 0.14 * flap;
    parrot.sx = 1 - 0.05 * flap;
    const heading = Math.atan2(ny - y, Math.abs(nx - x) + 1e-6);
    parrot.rot = -heading * 0.5 + flap * 0.07;
    parrot.alpha = 1 - smooth((u - 0.75) / 0.25);
    parrot.glow = 0.6;
    if (u >= 1) parrot.hidden = true;
  }

  /** Turns Punchkin's opaque pixels into a few thousand drifting, fading dust particles. */
  function disintegrate(): void {
    const pic = art.punchkin;
    crumbled = true;
    punchkin.hidden = true;
    sfx.stopDrone(1.2);
    sfx.crumble();
    if (!pic.canvas || !pic.bounds) return;
    const g = pic.canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return;
    const b = pic.bounds;
    const bw = b.x1 - b.x0;
    const bh = b.y1 - b.y0;
    const img = g.getImageData(b.x0, b.y0, bw, bh).data;
    // Pick a grid step that gives roughly PARTICLE_TARGET opaque samples.
    let opaque = 0;
    for (let i = 3; i < img.length; i += 4 * 16) if ((img[i] ?? 0) > 128) opaque++;
    opaque *= 16;
    const step = Math.max(1, Math.round(Math.sqrt(opaque / PARTICLE_TARGET)));
    const scale = punchkin.h / bh;
    const topY = punchkin.y - punchkin.h;
    const cx = punchkin.x + punchkin.shakeX;
    particles = [];
    for (let sy = 0; sy < bh; sy += step) {
      for (let sx = 0; sx < bw; sx += step) {
        const i = (sy * bw + sx) * 4;
        if ((img[i + 3] ?? 0) <= 128) continue;
        const lx = (sx - bw / 2) * scale * punchkin.facing;
        const ly = sy * scale;
        const heightFrac = sy / bh;
        particles.push({
          x: cx + lx,
          y: topY + ly,
          vx: 0.03 + (Math.random() - 0.35) * 0.06,
          vy: -0.01 + Math.random() * 0.025,
          // Crumbles from the top down, with some randomness.
          delay: heightFrac * 0.9 + Math.random() * 0.45,
          life: 1.4 + Math.random() * 1.3,
          age: 0,
          size: step * scale * 1.15,
          color: `rgb(${img[i]},${img[i + 1]},${img[i + 2]})`,
        });
      }
    }
  }

  function stepParticles(dt: number, t: number): void {
    if (particles.length === 0) return;
    let alive = 0;
    for (const p of particles) {
      p.age += dt;
      if (p.age < p.delay) {
        alive++;
        continue;
      }
      const live = p.age - p.delay;
      if (live > p.life) continue;
      alive++;
      p.vy += 0.09 * dt; // gentle gravity
      p.vx += Math.sin(t * 2 + p.y * 40) * 0.02 * dt; // swirl
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (alive === 0) particles = [];
  }

  function drawParticles(): void {
    if (!ctx || particles.length === 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    for (const p of particles) {
      const live = p.age - p.delay;
      let a = 1;
      if (live > 0) {
        if (live > p.life) continue;
        a = 1 - live / p.life;
      }
      ctx.globalAlpha = a * a;
      ctx.fillStyle = p.color;
      const s = live > 0 ? p.size * (1 - 0.5 * (live / p.life)) : p.size;
      ctx.fillRect(p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  // ---- frame ----

  function render(frame: FrameResult): void {
    if (!ctx || !stage.active) return;
    stage.fit();
    const Wpx = canvas.width;
    const Hpx = canvas.height;
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastNow) / 1000);
    lastNow = now;
    const t = now / 1000;

    sfx.crackle(dt);
    beatTime += dt;

    const beat = BEATS[beatIndex];
    const tip = frame.hands[0]?.landmarks[INDEX_TIP] ?? null;
    ringTip = null;

    if (beat?.cues) {
      beat.cues.forEach((cue, i) => {
        if (fired.has(i)) return;
        if (beatTime < cue.at) return;
        fired.add(i);
        const a = actorFor(cue.appear);
        if (a.appear < 0) {
          a.appear = 0;
          sfx.chime('appear');
          if (cue.appear === 'punchkin') sfx.startDrone();
        }
      });
    }
    for (const a of [punchkin, balna, prince, cage]) stepAppear(a, dt);

    // Cage hangs and sways a little; the soul inside glows green.
    cage.x = cageX();
    cage.y = cageFeet();
    cage.rot = Math.sin(t * 0.8) * 0.025;
    const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
    if (cage.appear >= 0 && !cageOpen) {
      cage.glow = Math.max(cage.glow, (0.25 + 0.2 * pulse) * (0.5 + proximity));
    }

    if (beat) {
      switch (beat.type) {
        case 'narrate': {
          if (beat.action === 'crumble' && !crumbled) {
            // Shake harder and harder, then crumble at 1 s.
            const s = 0.6 + 2.4 * smooth(beatTime / 1);
            punchkin.shakeX = Math.sin(t * 53) * 0.006 * s;
            punchkin.rot = Math.sin(t * 41) * 0.03 * s;
            if (beatTime >= 1) disintegrate();
          }
          if (beat.action === 'reunite') {
            warmth = clamp(warmth + dt / 3, 0, 1);
            endTime += dt;
            // Balna walks to stand beside the prince (on his left).
            const target = prince.x - princeHalf() - balnaHalf() - 0.02;
            const bx = balna.x;
            const step = clamp(target - balna.x, -0.25 * dt, 0.25 * dt);
            balna.x += step;
            balna.y += (GROUND - balna.y) * rate(0.08, dt);
            balna.alive = Math.abs(target - balna.x) > 0.005;
            balna.speed = Math.abs((balna.x - bx) / Math.max(dt, 1e-3));
            if (Math.abs(step) > 1e-5) balna.facing = step > 0 ? ART_FACES.balna : -ART_FACES.balna;
            // The prince turns to greet her.
            prince.facing += (-ART_FACES.prince - prince.facing) * rate(0.1, dt);
            prince.rot *= 0.9;
          }
          if (!beat.last && beatTime >= (beat.seconds ?? 0)) nextBeat();
          break;
        }
        case 'awaken': {
          if (awakeningT >= 0) {
            awakeningT += dt;
            prince.glow = Math.max(prince.glow, Math.sin(clamp(awakeningT / 1.2, 0, 1) * Math.PI));
            if (awakeningT >= 0.9) prince.alive = true;
            if (awakeningT >= 1.4) {
              prince.glow = 0;
              nextBeat();
            }
          } else if (tip && prince.appear >= 0.6) {
            const w = stage.tipToWorld(tip);
            if (!holdAnchor || Math.hypot(w.x - holdAnchor.x, w.y - holdAnchor.y) > HOLD_STEADY) {
              holdAnchor = { x: w.x, y: w.y };
              holdTime = 0;
            } else {
              holdTime += dt;
            }
            ringTip = { x: w.x, y: w.y, progress: holdTime / HOLD_SECONDS };
            if (holdTime >= HOLD_SECONDS) {
              awakeningT = 0;
              sfx.chime('awaken');
            }
          } else if (!tip) {
            holdAnchor = null; // paused until the hand returns
          }
          break;
        }
        case 'lead': {
          prince.alive = true;
          if (arriveT >= 0) {
            arriveT += dt;
            const k = rate(0.12, dt);
            prince.x += (stopX() - prince.x) * k;
            prince.y += (GROUND - prince.y) * k;
            prince.rot *= 0.9;
            prince.facing += (ART_FACES.prince - prince.facing) * k; // face the cage
            if (arriveT >= 0.4) nextBeat();
          } else if (tip) {
            leadStep(tip, dt);
            if (prince.x >= stopX() - 0.1 && prince.y >= GROUND - 0.2) arriveT = 0;
          }
          updateTremble(t);
          break;
        }
        case 'free': {
          stepParrot(t, beatTime);
          if (!parrot.hidden && beatTime >= nextFlap) {
            sfx.flutter();
            nextFlap = beatTime + 0.18 + Math.random() * 0.06;
          }
          // His soul escapes: Punchkin keeps trembling, fiercely.
          punchkin.shakeX = Math.sin(t * 53) * 0.006;
          punchkin.rot = Math.sin(t * 41) * 0.03;
          if (beatTime >= (beat.seconds ?? 0)) nextBeat();
          break;
        }
      }
    }
    if (cageOpen) cage.glow = Math.max(0, cage.glow - dt * 1.5);
    stepParticles(dt, t);

    const caption = captions.update(BEATS[beatIndex]?.caption ?? '', dt);

    // ---- draw ----
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawScreen(Wpx, Hpx, t, dt);

    stage.applyWorldTransform(ctx);

    // Cage (hanging, pivot at the top), with the parrot's green glow.
    drawActor(cageOpen ? art.open : art.caged, cage, t, {
      glowRgb: GREEN,
      glowBase: 0.1,
      pivot: 'top',
    });
    // Balna slightly behind Punchkin; the prince in front.
    drawActor(art.balna, balna, t);
    drawActor(art.punchkin, punchkin, t);
    drawParticles();
    drawActor(art.prince, prince, t);
    drawActor(art.parrot, parrot, t, { glowRgb: GREEN, glowBase: 0.2 });

    if (ringTip) drawRing(ctx, ringTip.x, ringTip.y, ringTip.progress);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    drawCaption(ctx, canvas, caption.text, caption.alpha);
    if (BEATS[beatIndex]?.last && endTime > 1.5) {
      drawHint(ctx, canvas, 'Press R to play again', clamp((endTime - 1.5) / 0.6, 0, 1) * 0.9);
    }
  }

  return {
    enter,
    exit,
    get active() {
      return stage.active;
    },
    render,
    restart() {
      if (stage.active) resetState();
    },
    toggleMute: () => sfx.toggleMute(),
  };
}
