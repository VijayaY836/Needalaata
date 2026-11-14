// Central tunable constants for the vision-and-collection feature.

export interface Config {
  cameraResolution: { width: number; height: number };
  silhouetteBlurRadius: number;
  /** Blur radius (px) for the mask render; 0 keeps masks crisp and scale-consistent. */
  maskBlurRadius: number;
  /** Near-black background color. */
  backgroundColor: string;
  warmSilhouetteColor: string;
  /** Unitless multiplier of Hand_Scale (px). */
  strokeThicknessScale: number;
  silhouetteDownscale: number;
  countdownDurationMs: number;
  burstDurationMs: number;
  captureRatePerSecond: number;
  uiRefreshIntervalMs: number;
  fpsOverlayStyle: {
    font: string;
    color: string;
    corner: 'tl' | 'tr' | 'bl' | 'br';
  };
  maskSize: { width: 96; height: 96 };
  /** Unitless multiplier of Hand_Scale (px). */
  maskPaddingScale: number;
  wasmPath: string;
  modelAssetPath: string;
  classifier: {
    modelPath: string;
    metadataPath: string;
    /** Consecutive identical stable frames required before a Shape_Event fires. */
    stableFrames: number;
    confidenceThreshold: number;
    inferenceBudgetMs: number;
    eventLogSize: number;
    debugOverlay: { corner: 'tl' | 'tr' | 'bl' | 'br' };
  };
}

export const config: Config = {
  cameraResolution: { width: 1280, height: 720 },
  silhouetteBlurRadius: 12,
  maskBlurRadius: 0,
  backgroundColor: '#0a0a0c',
  warmSilhouetteColor: '#ffb36b',
  strokeThicknessScale: 0.25,
  silhouetteDownscale: 0.5,
  countdownDurationMs: 3000,
  burstDurationMs: 4000,
  captureRatePerSecond: 10,
  uiRefreshIntervalMs: 250,
  fpsOverlayStyle: { font: '12px monospace', color: '#8f8', corner: 'tr' },
  maskSize: { width: 96, height: 96 },
  maskPaddingScale: 0.6,
  wasmPath: '/wasm',
  modelAssetPath: '/models/hand_landmarker.task',
  classifier: {
    modelPath: '/models/classifier/model.json',
    metadataPath: '/models/classifier/metadata.json',
    stableFrames: 24,
    confidenceThreshold: 0.85,
    inferenceBudgetMs: 15,
    eventLogSize: 5,
    debugOverlay: { corner: 'tl' },
  },
};

export default config;
