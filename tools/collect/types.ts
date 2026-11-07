// Collection-tool types. The shared data model lives in src/vision/types.ts;
// re-exported here so collector modules have a single local import.
export type {
  Landmark,
  HandObservation,
  FrameResult,
  Label,
  HandSlot,
  InterHandFeatures,
  ExtractedFeatures,
  Sample,
  ExportMetadata,
  ExportDocument,
} from '../../src/vision/types';
export { LABELS } from '../../src/vision/types';
