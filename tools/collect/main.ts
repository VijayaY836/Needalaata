// Collector page entry: camera + tracker + pipeline + preview, then the collector UI.
import { config } from '../../src/config';
import {
  createCamera,
  showCameraMessage,
  showOnDeviceNotice,
} from '../../src/vision/camera';
import { MediaPipeHandTracker, HAND_TRACKING_FAILED_MESSAGE } from '../../src/vision/hand-landmarker';
import { createVisionPipeline } from '../../src/vision/pipeline';
import { createSilhouetteRenderer } from '../../src/vision/silhouette-renderer';
import { createSampleStore, SAVE_FAILED_MESSAGE } from './sample-store';
import { createCollectorUi } from './ui';

async function bootstrap(): Promise<void> {
  const app = document.getElementById('app') ?? document.body;
  showOnDeviceNotice(app);

  const canvas = document.createElement('canvas');
  canvas.id = 'preview';
  canvas.width = config.cameraResolution.width;
  canvas.height = config.cameraResolution.height;
  app.appendChild(canvas);

  const uiRoot = document.createElement('div');
  uiRoot.id = 'collector';
  app.appendChild(uiRoot);

  const camera = createCamera();
  let video: HTMLVideoElement;
  try {
    video = await camera.start(config.cameraResolution);
  } catch (err) {
    showCameraMessage(err instanceof Error ? err.message : String(err), app);
    return;
  }
  video.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none';
  video.setAttribute('aria-hidden', 'true');
  app.appendChild(video);
  if (video.videoWidth > 0 && video.videoHeight > 0) {
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  const tracker = new MediaPipeHandTracker();
  const store = createSampleStore({
    onError: (m) => showCameraMessage(m || SAVE_FAILED_MESSAGE, app), // non-fatal
  });
  const pipeline = createVisionPipeline(video, tracker);
  const renderer = createSilhouetteRenderer(canvas);
  pipeline.onFrame((frame) =>
    renderer.render(frame, {
      color: config.warmSilhouetteColor,
      background: config.backgroundColor,
      blurRadius: config.silhouetteBlurRadius,
    }),
  );

  const ui = createCollectorUi({
    root: uiRoot,
    pipeline,
    store,
    isTrackerReady: () => tracker.isReady(),
  });

  try {
    await tracker.init();
  } catch {
    camera.stop();
    showCameraMessage(HAND_TRACKING_FAILED_MESSAGE, app);
    return;
  }
  ui.updateControls(); // enable recording now that the tracker is ready
  pipeline.start();
}

void bootstrap();
