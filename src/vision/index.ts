// Vision module: camera, hand landmarks, silhouette. NO puppet/game-flow logic.
export { extractFeatures, FeatureExtractor } from './feature-extractor';
export type { HandFeatures, ExtractedFeatures, InterHandFeatures } from './feature-extractor';
export {
  createMaskGenerator,
  MaskGeneratorFactory,
  encodeMask,
  decodeMask,
  computeCropRect,
  fitCentered,
  maskRenderOptions,
} from './mask-generator';
export type { MaskGenerator, CropRect } from './mask-generator';
