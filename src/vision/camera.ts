// Camera capture. Mirrors the <video> visually only; the preview canvas is NOT flipped.
import { config } from '../config';

export interface Camera {
  start(resolution: { width: number; height: number }): Promise<HTMLVideoElement>;
  stop(): void;
}

export const CAMERA_PERMISSION_MESSAGE = 'Camera access is required to play.';
export const CAMERA_NOT_FOUND_MESSAGE = 'No camera was found.';
export const ON_DEVICE_NOTICE =
  'Webcam frames are processed on-device and never leave the browser.';

export class PermissionError extends Error {
  constructor(message: string = CAMERA_PERMISSION_MESSAGE) {
    super(message);
    this.name = 'PermissionError';
  }
}

export class NoDeviceError extends Error {
  constructor(message: string = CAMERA_NOT_FOUND_MESSAGE) {
    super(message);
    this.name = 'NoDeviceError';
  }
}

function mapError(err: unknown): Error {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError' || name === 'PermissionDeniedError') {
    return new PermissionError();
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError' || name === 'OverconstrainedError') {
    return new NoDeviceError();
  }
  return err instanceof Error ? err : new Error(String(err));
}

/** Show a user-facing message in the given container (defaults to a banner on document.body). */
export function showCameraMessage(text: string, container: HTMLElement = document.body): HTMLElement {
  const el = document.createElement('div');
  el.setAttribute('role', 'alert');
  el.className = 'camera-message';
  el.textContent = text;
  container.appendChild(el);
  return el;
}

/** Show the on-device processing notice (Req 2.5). */
export function showOnDeviceNotice(container: HTMLElement = document.body): HTMLElement {
  const el = document.createElement('p');
  el.setAttribute('role', 'note');
  el.className = 'on-device-notice';
  el.textContent = ON_DEVICE_NOTICE;
  container.appendChild(el);
  return el;
}

export function createCamera(): Camera {
  let stream: MediaStream | null = null;
  let video: HTMLVideoElement | null = null;

  return {
    async start(resolution = config.cameraResolution): Promise<HTMLVideoElement> {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new NoDeviceError();
      }
      let acquired: MediaStream;
      try {
        acquired = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: resolution.width }, height: { ideal: resolution.height } },
          audio: false,
        });
      } catch (err) {
        throw mapError(err);
      }
      stream = acquired;

      const el = document.createElement('video');
      el.srcObject = acquired;
      el.muted = true;
      el.playsInline = true;
      el.style.transform = 'scaleX(-1)'; // visual mirror of the video only
      video = el;
      try {
        await el.play();
      } catch (err) {
        this.stop();
        throw mapError(err);
      }
      return el;
    },
    stop(): void {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
      if (video) {
        video.pause();
        video.srcObject = null;
        video = null;
      }
    },
  };
}
