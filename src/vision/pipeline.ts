// VisionPipeline: per-frame loop that runs hand detection and emits FrameResults.
//
// Display_Coordinate_Space contract (shared by all consumers and stored Samples):
//   - x, y are MIRRORED and normalized to [0,1], origin at the TOP-LEFT (x right, y down).
//   - Mirroring (x' = 1 - x) is applied exactly once, here. Consumers must not flip again.
//   - z is MediaPipe's relative depth, unchanged.
//   - Values are not aspect-corrected; use frameWidth/frameHeight on the FrameResult.
//
// This module has no puppet or game logic. Rendering/FPS overlays subscribe via onFrame.
import type { HandTracker } from './hand-landmarker';
import type { FrameResult, HandObservation } from './types';

export type FrameConsumer = (result: FrameResult) => void;

export interface VisionPipeline {
  /** Subscribe to frame results. Returns an unsubscribe function. */
  onFrame(consumer: FrameConsumer): () => void;
  start(): void;
  stop(): void;
}

export function createVisionPipeline(
  video: HTMLVideoElement,
  tracker: HandTracker,
): VisionPipeline {
  const consumers = new Set<FrameConsumer>();
  let running = false;
  let rafId: number | null = null;
  let lastVideoTime = -1;

  function processFrame(ts: number): FrameResult {
    const result = tracker.detect(video, ts);
    const hands: HandObservation[] = result.landmarks.map((lm, i) => {
      const top = result.handedness[i]?.[0];
      return {
        // Single mirror: x' = 1 - x.
        landmarks: lm.map((p) => ({ x: 1 - p.x, y: p.y, z: p.z })),
        handedness: top?.categoryName ?? '',
        score: top?.score ?? 0,
      };
    });
    return {
      hands,
      timestamp: ts,
      frameWidth: video.videoWidth,
      frameHeight: video.videoHeight,
    };
  }

  function tick(): void {
    if (!running) return;
    // ONE timestamp per tick, used for detection and the emitted FrameResult.
    const ts = performance.now();
    if (tracker.isReady() && video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const frame = processFrame(ts);
      for (const consumer of [...consumers]) consumer(frame);
    }
    rafId = requestAnimationFrame(tick);
  }

  return {
    onFrame(consumer) {
      consumers.add(consumer);
      return () => {
        consumers.delete(consumer);
      };
    },
    start() {
      if (running) return;
      running = true;
      lastVideoTime = -1;
      rafId = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
    },
  };
}
