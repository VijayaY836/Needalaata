// CaptureController: countdown -> timed burst -> ready, with accumulator-based capture.
//
// Time is injected: the host calls update(now, frame) once per vision frame, where `now` is a
// monotonic ms clock (e.g. performance.now()). No timers are used, so all timing is testable.
// Req 10.1-10.5, 14.1, 14.2, 9.3, 11.10.

import { config as defaultConfig, type Config } from '../../src/config';
import { extractFeatures } from './feature-extractor';
import { encodeMask, type MaskGenerator } from './mask-generator';
import type { SampleStore } from './sample-store';
import type { ExtractedFeatures, FrameResult, Label, Sample } from './types';

export type CaptureState = 'ready' | 'countdown' | 'recording';

export const TRACKER_NOT_READY_MESSAGE = 'hand tracking is not ready yet';
export const NAME_REQUIRED_MESSAGE = 'please enter your name before recording';

export type StartResult =
  | { ok: true }
  | { ok: false; reason: 'tracker-not-ready' | 'name-required' | 'busy' | 'no-label'; message: string };

export interface CaptureControllerOptions {
  store: Pick<SampleStore, 'put'>;
  maskGenerator: MaskGenerator;
  /** Returns true once the HandLandmarker is ready (Req 14.1, 14.2). */
  isTrackerReady: () => boolean;
  config?: Pick<Config, 'countdownDurationMs' | 'burstDurationMs' | 'captureRatePerSecond'>;
  /** Wall-clock ms stamped on Samples (epoch-based so undo ordering survives reloads). */
  wallClock?: () => number;
  /** Id factory for session, burst and sample ids. */
  newId?: () => string;
  extract?: (frame: FrameResult) => ExtractedFeatures;
  onStateChange?: (state: CaptureState) => void;
  /** Called after each captured Sample is handed to the store. */
  onSample?: (sample: Sample) => void;
  /** Called with a user-facing message when recording is refused. */
  onPrompt?: (message: string) => void;
}

export interface CaptureController {
  readonly sessionId: string;
  readonly state: CaptureState;
  /** True while a burst is actively capturing (recording-in-progress indicator, Req 10.5). */
  readonly isRecording: boolean;
  /** Burst id of the burst in progress (or last burst); null before the first. */
  readonly burstId: string | null;
  /** Whether the record control should be enabled (tracker ready and idle). */
  canRecord(): boolean;
  setLabel(label: Label | null): void;
  setContributor(name: string): void;
  /** Begin countdown. `now` is the monotonic clock value at the moment of the request. */
  start(now: number): StartResult;
  /** Advance time; captures a Sample when due. Safe to call every frame in any state. */
  update(now: number, frame: FrameResult): void;
  /** Abort countdown/burst, returning to ready (already-captured Samples are kept). */
  cancel(): void;
  /** Remaining countdown ms (0 outside countdown). */
  countdownRemainingMs(now: number): number;
}

function defaultNewId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createCaptureController(options: CaptureControllerOptions): CaptureController {
  const cfg = options.config ?? defaultConfig;
  const wallClock = options.wallClock ?? Date.now;
  const newId = options.newId ?? defaultNewId;
  const extract = options.extract ?? extractFeatures;

  // One Session_ID per page load (Req 11.10).
  const sessionId = newId();

  let state: CaptureState = 'ready';
  let label: Label | null = null;
  let contributor = '';
  let burstId: string | null = null;
  let phaseStart = 0;
  let lastUpdate = 0;
  let accumulator = 0;

  const setState = (next: CaptureState): void => {
    if (state === next) return;
    state = next;
    options.onStateChange?.(next);
  };

  const refuse = <R extends Extract<StartResult, { ok: false }>['reason']>(
    reason: R,
    message: string,
  ): StartResult => {
    options.onPrompt?.(message);
    return { ok: false, reason, message };
  };

  const capture = (frame: FrameResult): void => {
    if (!label || !burstId) return;
    const features = extract(frame);
    const mask = options.maskGenerator.generate(frame, features.slots);
    const sample: Sample = {
      id: newId(),
      label,
      slots: features.slots,
      interHand: features.interHand,
      maskBase64: encodeMask(mask),
      frameWidth: frame.frameWidth,
      frameHeight: frame.frameHeight,
      sessionId,
      burstId,
      contributor: contributor.trim(),
      timestamp: wallClock(),
    };
    void options.store.put(sample);
    options.onSample?.(sample);
  };

  const controller: CaptureController = {
    sessionId,
    get state() {
      return state;
    },
    get isRecording() {
      return state === 'recording';
    },
    get burstId() {
      return burstId;
    },
    canRecord() {
      return state === 'ready' && options.isTrackerReady();
    },
    setLabel(l) {
      label = l;
    },
    setContributor(name) {
      contributor = name;
    },
    start(now) {
      if (state !== 'ready') return refuse('busy', 'a recording is already in progress');
      if (!options.isTrackerReady()) return refuse('tracker-not-ready', TRACKER_NOT_READY_MESSAGE);
      if (contributor.trim() === '') return refuse('name-required', NAME_REQUIRED_MESSAGE);
      if (!label) return refuse('no-label', 'please choose a label before recording');
      phaseStart = now;
      lastUpdate = now;
      accumulator = 0;
      setState('countdown');
      return { ok: true };
    },
    update(now, frame) {
      if (state === 'countdown') {
        if (now - phaseStart < cfg.countdownDurationMs) return;
        // Burst starts at the moment the countdown elapsed; mint a fresh Burst_ID (Req 10.2).
        burstId = newId();
        phaseStart = phaseStart + cfg.countdownDurationMs;
        lastUpdate = phaseStart;
        accumulator = 0;
        setState('recording');
      }
      if (state !== 'recording') return;

      const dt = Math.max(0, now - lastUpdate);
      lastUpdate = now;
      accumulator += (dt * cfg.captureRatePerSecond) / 1000;
      if (accumulator >= 1) {
        capture(frame);
        // At most one Sample per frame; drop any backlog so slow frames don't emit duplicates.
        accumulator = accumulator % 1;
      }

      if (now - phaseStart >= cfg.burstDurationMs) setState('ready'); // Req 10.4
    },
    cancel() {
      accumulator = 0;
      setState('ready');
    },
    countdownRemainingMs(now) {
      if (state !== 'countdown') return 0;
      return Math.max(0, cfg.countdownDurationMs - (now - phaseStart));
    },
  };
  return controller;
}

export const CaptureControllerFactory = { create: createCaptureController };
