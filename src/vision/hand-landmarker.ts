// HandLandmarker wrapper: local WASM + model, GPU delegate with CPU fallback.
import {
  FilesetResolver,
  HandLandmarker,
  type HandLandmarkerResult,
} from '@mediapipe/tasks-vision';
import { config } from '../config';

export const HAND_TRACKING_FAILED_MESSAGE = 'hand tracking could not start';

export interface HandTracker {
  /** GPU delegate first, then CPU fallback. Rejects with HAND_TRACKING_FAILED_MESSAGE if both fail. */
  init(): Promise<void>;
  detect(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult;
  isReady(): boolean;
}

export class MediaPipeHandTracker implements HandTracker {
  private landmarker: HandLandmarker | null = null;

  async init(): Promise<void> {
    if (this.landmarker) return;

    // WASM fileset served from our own origin (no CDN).
    const fileset = await FilesetResolver.forVisionTasks(config.wasmPath);

    const create = (delegate: 'GPU' | 'CPU') =>
      HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: config.modelAssetPath, delegate },
        numHands: 2,
        runningMode: 'VIDEO',
      });

    try {
      this.landmarker = await create('GPU');
      return;
    } catch {
      // Silently retry on CPU.
    }
    try {
      this.landmarker = await create('CPU');
    } catch {
      this.landmarker = null;
      throw new Error(HAND_TRACKING_FAILED_MESSAGE);
    }
  }

  detect(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResult {
    if (!this.landmarker) throw new Error('HandLandmarker is not initialized');
    return this.landmarker.detectForVideo(video, timestampMs);
  }

  isReady(): boolean {
    return this.landmarker !== null;
  }
}
