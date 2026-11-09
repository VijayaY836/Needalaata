import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CAMERA_NOT_FOUND_MESSAGE,
  CAMERA_PERMISSION_MESSAGE,
  NoDeviceError,
  PermissionError,
  createCamera,
} from './camera';

// Vitest runs in node (no DOM), so stub document/navigator with minimal fakes.
// **Validates: Requirements 2.2, 2.3, 2.4**

class FakeVideo {
  srcObject: unknown = null;
  muted = false;
  playsInline = false;
  style: Record<string, string> = {};
  playing = false;
  play = vi.fn(async () => {
    this.playing = true;
  });
  pause = vi.fn(() => {
    this.playing = false;
  });
}

function fakeStream() {
  const track = { stop: vi.fn() };
  return { track, stream: { getTracks: () => [track] } as unknown as MediaStream };
}

function stubMedia(getUserMedia: unknown) {
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
}

const RES = { width: 640, height: 480 };

describe('camera startup', () => {
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: () => new FakeVideo() });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('granted: attaches the stream to a playing, muted video element', async () => {
    const { stream } = fakeStream();
    const gum = vi.fn().mockResolvedValue(stream);
    stubMedia(gum);

    const video = (await createCamera().start(RES)) as unknown as FakeVideo;

    expect(video.srcObject).toBe(stream);
    expect(video.play).toHaveBeenCalled();
    expect(video.playing).toBe(true);
    expect(video.muted).toBe(true);
    expect(gum.mock.calls[0]![0].video.width.ideal).toBe(640);
  });

  it('stop releases tracks and detaches the stream', async () => {
    const { stream, track } = fakeStream();
    stubMedia(vi.fn().mockResolvedValue(stream));
    const cam = createCamera();
    const video = (await cam.start(RES)) as unknown as FakeVideo;
    cam.stop();
    expect(track.stop).toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
  });

  it('denied: rejects with "camera access is required" and creates no video', async () => {
    const createElement = vi.fn();
    vi.stubGlobal('document', { createElement });
    stubMedia(vi.fn().mockRejectedValue(new DOMException('denied', 'NotAllowedError')));

    const err = await createCamera().start(RES).catch((e) => e);

    expect(err).toBeInstanceOf(PermissionError);
    expect(err.message).toBe(CAMERA_PERMISSION_MESSAGE);
    expect(err.message.toLowerCase()).toContain('camera access is required');
    expect(createElement).not.toHaveBeenCalled(); // startup halted
  });

  it('no device: rejects with "no camera was found" on NotFoundError', async () => {
    stubMedia(vi.fn().mockRejectedValue(new DOMException('none', 'NotFoundError')));

    const err = await createCamera().start(RES).catch((e) => e);

    expect(err).toBeInstanceOf(NoDeviceError);
    expect(err.message).toBe(CAMERA_NOT_FOUND_MESSAGE);
    expect(err.message.toLowerCase()).toContain('no camera was found');
  });

  it('no device: rejects with NoDeviceError when mediaDevices is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(createCamera().start(RES)).rejects.toBeInstanceOf(NoDeviceError);
  });
});
