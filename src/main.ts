// Vision preview page: camera -> HandLandmarker -> silhouette on a near-black canvas.
// No puppet or game logic here.
import { config } from './config';
import {
  createCamera,
  showCameraMessage,
  showOnDeviceNotice,
  PermissionError,
  NoDeviceError,
} from './vision/camera';
import { MediaPipeHandTracker, HAND_TRACKING_FAILED_MESSAGE } from './vision/hand-landmarker';
import { createVisionPipeline } from './vision/pipeline';
import { createSilhouetteRenderer } from './vision/silhouette-renderer';
import { createFpsOverlay } from './vision/fps-overlay';
import { createPuppetFollow } from './spike/puppet-follow';
import { createLionRabbitScene } from './spike/scene-lion-rabbit';
import { createPunchkinScene } from './spike/scene-punchkin';

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app') ?? document.body;
  document.body.style.background = config.backgroundColor;

  // On-device processing notice (Req 2.5).
  showOnDeviceNotice(app);

  const canvas = document.createElement('canvas');
  canvas.id = 'preview';
  canvas.width = config.cameraResolution.width;
  canvas.height = config.cameraResolution.height;
  // The canvas is NOT mirrored; landmarks are mirrored once in the pipeline (Req 4.2).
  canvas.style.background = config.backgroundColor;
  canvas.style.maxWidth = '100%';
  app.appendChild(canvas);

  // Paint the near-black background immediately (Req 6.1).
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.fillStyle = config.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const camera = createCamera();
  let video: HTMLVideoElement;
  try {
    video = await camera.start(config.cameraResolution);
  } catch (err) {
    if (err instanceof PermissionError || err instanceof NoDeviceError) {
      showCameraMessage(err.message, app);
    } else {
      showCameraMessage(err instanceof Error ? err.message : String(err), app);
    }
    return; // halt startup
  }

  // Keep the (mirrored) video in the DOM but invisible; only the silhouette is shown.
  video.style.position = 'absolute';
  video.style.width = '1px';
  video.style.height = '1px';
  video.style.opacity = '0';
  video.style.pointerEvents = 'none';
  video.setAttribute('aria-hidden', 'true');
  app.appendChild(video);

  // Match canvas to the actual frame size so the renderer's output lines up.
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const tracker = new MediaPipeHandTracker();
  try {
    await tracker.init();
  } catch {
    camera.stop();
    showCameraMessage(HAND_TRACKING_FAILED_MESSAGE, app);
    return;
  }

  const renderer = createSilhouetteRenderer(canvas);
  const fps = createFpsOverlay(canvas);
  const pipeline = createVisionPipeline(video, tracker);

  // Spike: puppet mode, toggled with the P key (off by default).
  const puppet = createPuppetFollow(canvas);
  let puppetMode = false;
  // Spike: "The Clever Rabbit and the Lion" scene (S toggles, R restarts, M mutes).
  // enter() runs inside the key press so Web Audio is allowed to start.
  const scene = createLionRabbitScene(canvas);
  // Spike: "Punchkin: The Soul in the Parrot" scene (K toggles, R restarts, M mutes).
  const punchkin = createPunchkinScene(canvas);
  const scenes = { s: scene, k: punchkin } as const;
  window.addEventListener('keydown', (e) => {
    if (e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const current = scene.active ? scene : punchkin.active ? punchkin : null;
    if (key === 'p') {
      puppetMode = !puppetMode;
    } else if (key === 's' || key === 'k') {
      const target = scenes[key];
      if (current === target) {
        target.exit();
      } else {
        current?.exit(); // only one scene at a time
        target.enter();
      }
    } else if (key === 'r') {
      current?.restart();
    } else if (key === 'm') {
      current?.toggleMute();
    }
  });

  pipeline.onFrame((frame) => {
    if (scene.active) {
      scene.render(frame);
    } else if (punchkin.active) {
      punchkin.render(frame);
    } else if (puppetMode) {
      puppet.render(frame);
    } else {
      renderer.render(frame, {
        color: config.warmSilhouetteColor,
        background: config.backgroundColor,
        blurRadius: config.silhouetteBlurRadius,
      });
    }
    fps.update(frame.timestamp);
  });
  pipeline.start();
}

void bootstrap();
