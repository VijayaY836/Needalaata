// Shared vision data types.
//
// Display_Coordinate_Space contract:
//   - x and y are MIRRORED, normalized to [0,1], origin at the TOP-LEFT of the frame
//     (x grows right, y grows down). Mirroring (x' = 1 - x) is applied exactly once,
//     in the VisionPipeline. Consumers (renderer, feature extractor, stored Samples)
//     receive already-mirrored values and must NOT flip again.
//   - z is MediaPipe's relative depth, roughly on the same scale as x.
//   - Values are NOT aspect-corrected; use frameWidth/frameHeight to lift them into
//     pixel space (xc = x * frameWidth, yc = y * frameHeight, zc = z * frameWidth).

/** A single 3D hand landmark in Display_Coordinate_Space. */
export interface Landmark {
  x: number;
  y: number;
  z: number;
}

/** One detected hand for a frame. */
export interface HandObservation {
  /** 21 landmarks in mirrored Display_Coordinate_Space. */
  landmarks: Landmark[];
  handedness: string;
  score: number;
}

/** Per-frame output of the VisionPipeline. */
export interface FrameResult {
  /** Empty when no hands are detected. */
  hands: HandObservation[];
  /** Same timestamp passed to detectForVideo. */
  timestamp: number;
  /** Source frame size in px, for aspect correction and Sample storage. */
  frameWidth: number;
  frameHeight: number;
}

/** The seven classifier labels. */
export const LABELS = [
  'rabbit',
  'lion',
  'bird',
  'snake',
  'crocodile',
  'demon',
  'none',
] as const;

export type Label = (typeof LABELS)[number];

/** One of the two fixed hand slots in a Sample. */
export interface HandSlot {
  /** Presence_Flag. */
  present: boolean;
  /** MediaPipe label; stored but never used for slotting. */
  handedness: string;
  score: number;
  /** 21 points, mirrored display space [0,1], NOT aspect-corrected. */
  rawLandmarks: Landmark[];
  /** 21 points, aspect-corrected, wrist-relative, divided by Hand_Scale. */
  normalizedLandmarks: Landmark[];
}

/** Features derived from both hands. Zero-filled if either slot is absent. */
export interface InterHandFeatures {
  /** (slot1 wrist - slot0 wrist) / mean Hand_Scale, in aspect-corrected space. */
  wristOffset: { x: number; y: number; z: number };
  /** Number of present slots. */
  handCount: number;
}

/** Fixed-length feature output regardless of hand count. */
export interface ExtractedFeatures {
  slots: [HandSlot, HandSlot];
  interHand: InterHandFeatures;
}

/** One recorded training sample. */
export interface Sample {
  /** UUID; IndexedDB key. */
  id: string;
  label: Label;
  slots: [HandSlot, HandSlot];
  interHand: InterHandFeatures;
  /** Base64 of row-major 96x96 uint8 (0 = background, 255 = shadow); 9216 bytes before encoding. */
  maskBase64: string;
  frameWidth: number;
  frameHeight: number;
  sessionId: string;
  burstId: string;
  contributor: string;
  timestamp: number;
}

export interface ExportMetadata {
  schemaVersion: string;
  labels: Label[];
  maskSize: { width: 96; height: 96 };
  normalization: string;
  maskEncoding: string;
  exportDate: string;
}

export interface ExportDocument {
  metadata: ExportMetadata;
  samples: Sample[];
}
