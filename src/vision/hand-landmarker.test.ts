import { beforeEach, describe, expect, it, vi } from 'vitest';

// **Validates: Requirements 3.4, 3.5, 3.6**
const { forVisionTasks, createFromOptions } = vi.hoisted(() => ({
  forVisionTasks: vi.fn(),
  createFromOptions: vi.fn(),
}));

vi.mock('@mediapipe/tasks-vision', () => ({
  FilesetResolver: { forVisionTasks },
  HandLandmarker: { createFromOptions },
}));

import { config } from '../config';
import { HAND_TRACKING_FAILED_MESSAGE, MediaPipeHandTracker } from './hand-landmarker';

const fileset = { wasmLoaderPath: 'x', wasmBinaryPath: 'y' };

beforeEach(() => {
  forVisionTasks.mockReset().mockResolvedValue(fileset);
  createFromOptions.mockReset();
});

describe('MediaPipeHandTracker.init', () => {
  it('prefers the GPU delegate and does not try CPU when GPU succeeds', async () => {
    createFromOptions.mockResolvedValueOnce({ detectForVideo: vi.fn() });
    const tracker = new MediaPipeHandTracker();
    await tracker.init();

    expect(createFromOptions).toHaveBeenCalledTimes(1);
    expect(createFromOptions.mock.calls[0]![1].baseOptions.delegate).toBe('GPU');
    expect(tracker.isReady()).toBe(true);
  });

  it('passes fileset, numHands, VIDEO mode, and config paths', async () => {
    createFromOptions.mockResolvedValueOnce({});
    await new MediaPipeHandTracker().init();

    expect(forVisionTasks).toHaveBeenCalledWith(config.wasmPath);
    const [fs, opts] = createFromOptions.mock.calls[0]!;
    expect(fs).toBe(fileset);
    expect(opts.numHands).toBe(2);
    expect(opts.runningMode).toBe('VIDEO');
    expect(opts.baseOptions.modelAssetPath).toBe(config.modelAssetPath);
  });

  it('falls back to CPU when GPU creation fails', async () => {
    createFromOptions
      .mockRejectedValueOnce(new Error('no gpu'))
      .mockResolvedValueOnce({});
    const tracker = new MediaPipeHandTracker();
    await tracker.init();

    expect(createFromOptions).toHaveBeenCalledTimes(2);
    expect(createFromOptions.mock.calls[0]![1].baseOptions.delegate).toBe('GPU');
    expect(createFromOptions.mock.calls[1]![1].baseOptions.delegate).toBe('CPU');
    expect(tracker.isReady()).toBe(true);
  });

  it('rejects with "hand tracking could not start" when both fail', async () => {
    createFromOptions.mockRejectedValue(new Error('fail'));
    const tracker = new MediaPipeHandTracker();

    await expect(tracker.init()).rejects.toThrow(HAND_TRACKING_FAILED_MESSAGE);
    expect(HAND_TRACKING_FAILED_MESSAGE).toBe('hand tracking could not start');
    expect(createFromOptions).toHaveBeenCalledTimes(2);
    expect(tracker.isReady()).toBe(false);
  });
});
