import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HandLandmarkerResult } from '@mediapipe/tasks-vision';
import type { HandTracker } from './hand-landmarker';
import { createVisionPipeline } from './pipeline';
import type { FrameResult } from './types';

const CANVAS_WIDTH = 640;

describe('VisionPipeline mirroring and emission', () => {
  let rafCallback: FrameRequestCallback | null;

  beforeEach(() => {
    rafCallback = null;
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      rafCallback = cb;
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', () => {
      rafCallback = null;
    });
    vi.spyOn(performance, 'now').mockReturnValue(1234.5);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  function runOneTick(rawX: number): { frame: FrameResult; detectTs: number } {
    let detectTs = -1;
    const raw = {
      landmarks: [[{ x: rawX, y: 0.5, z: 0.1 }]],
      worldLandmarks: [],
      handedness: [[{ categoryName: 'Left', score: 0.9, index: 0, displayName: '' }]],
      handednesses: [],
    } as unknown as HandLandmarkerResult;
    const tracker: HandTracker = {
      init: async () => {},
      isReady: () => true,
      detect: (_video, ts) => {
        detectTs = ts;
        return raw;
      },
    };
    const video = { currentTime: 1, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

    const pipeline = createVisionPipeline(video, tracker);
    let frame: FrameResult | null = null;
    pipeline.onFrame((f) => {
      frame = f;
    });
    pipeline.start();
    rafCallback?.(0);
    pipeline.stop();
    expect(frame).not.toBeNull();
    return { frame: frame as unknown as FrameResult, detectTs };
  }

  it('mirrors a raw landmark at x=0.8 to x=0.2, in the left half of the preview', () => {
    const { frame } = runOneTick(0.8);
    const x = frame.hands[0]!.landmarks[0]!.x;
    expect(x).toBeCloseTo(0.2, 10);
    expect(x * CANVAS_WIDTH).toBeLessThan(CANVAS_WIDTH / 2);
  });

  it('emits the same timestamp that was passed to detect', () => {
    const { frame, detectTs } = runOneTick(0.8);
    expect(detectTs).toBe(1234.5);
    expect(frame.timestamp).toBe(detectTs);
  });
});
