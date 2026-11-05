# Requirements Document

## Introduction

This spec covers the **vision module** and the **data-collection tool** for Needalaata (నీడలాట), a browser-based Tholu Bommalata shadow theatre. The scope is strictly the camera + hand-tracking pipeline and the labeled-sample collector used to build a training dataset. It explicitly excludes the game/story flow, classifier training, puppet rigs, and the PixiJS stage.

The vision module starts the webcam, runs MediaPipe Tasks Vision HandLandmarker (GPU delegate with CPU fallback, up to 2 hands), emits normalized landmarks every frame in the mirrored display coordinate space, and renders a soft, warm, blurred shadow silhouette of the user's hands on a near-black canvas. The collection tool is a separate page that reuses the vision module to record labeled samples (both hands' raw and normalized landmarks, inter-hand features, and a 96x96 grayscale shadow mask) for the seven classifier labels, with reference illustrations, a countdown, configurable-rate burst recording, live per-label counts, persistent storage, and versioned JSON export.

All webcam processing stays on-device; no frames leave the browser. All tunable numbers live in `src/config.ts`.

## Glossary

- **Vision_Module**: The code in `src/vision/` responsible for camera capture, HandLandmarker inference, landmark emission in the Display_Coordinate_Space, and shadow silhouette rendering. It knows nothing about puppets or game logic.
- **Collection_Tool**: The separate page in `tools/collect/` that reuses the Vision_Module to record labeled training samples and export them.
- **HandLandmarker**: The `@mediapipe/tasks-vision` HandLandmarker task that detects up to 2 hands and returns 21 normalized 3D landmarks per hand, plus a handedness label and a detection score per hand.
- **Landmark**: A single normalized 3D point `{x, y, z}` returned by HandLandmarker, where x and y are in the range [0, 1] relative to the image.
- **Display_Coordinate_Space**: The horizontally mirrored coordinate space used for both the preview and the game at runtime. All emitted and stored landmarks are expressed in this space so that collected data matches runtime inference.
- **Hand_Slot**: One of exactly two fixed positions in a Sample. When exactly one hand is detected, that hand is stored in Hand_Slot 0 and Hand_Slot 1 is absent (zero-filled with its Presence_Flag absent), regardless of where the hand appears in the frame. When two hands are detected, the hand whose wrist (landmark 0) has the smaller x coordinate is stored in Hand_Slot 0 and the other hand is stored in Hand_Slot 1. Each slot stores the hand's handedness label, detection score, raw landmarks, normalized landmarks, and an explicit presence flag. Slot assignment is determined by the smaller-x rule and the single-hand rule, not by MediaPipe handedness, which makes slot assignment deterministic.
- **Presence_Flag**: A boolean stored per Hand_Slot indicating whether a hand was detected (present) or the slot is zero-filled (absent).
- **Normalized_Landmarks**: The per-hand feature representation produced by making the 21x3 landmarks wrist-relative (subtracting landmark 0, the wrist) and then dividing by the Hand_Scale. A missing hand's values are zero-filled.
- **Hand_Scale**: The per-hand normalization scale, defined as the distance from the wrist (landmark 0) to the middle-finger MCP (landmark 9).
- **Inter_Hand_Features**: Features describing the relationship between both hands: the normalized inter-hand wrist offset, defined as the Hand_Slot 1 wrist (landmark 0) minus the Hand_Slot 0 wrist (landmark 0) divided by the mean Hand_Scale of the two hands (zero-filled if either Hand_Slot is absent), and a hand count.
- **Raw_Landmarks**: Each hand's unmodified 21 three-dimensional `{x, y, z}` points in the Display_Coordinate_Space, stored so features can be recomputed later without re-recording.
- **Shadow_Mask**: A 96x96 single-channel grayscale image produced by the same silhouette renderer as the preview, cropped to the bounding box of the detected hands plus configurable padding, centered, and resized to 96x96 while preserving aspect ratio. For the `none` Label with no hands detected, the Shadow_Mask is blank.
- **Shadow_Silhouette**: The soft, blurred, filled rendering of the detected hands on a near-black canvas, lit as if by a warm lamp behind the user. It is built from thick rounded strokes along each finger's bones plus a filled palm polygon, then blurred, so individual finger shapes remain visible. No thin skeleton lines or joint dots are drawn.
- **Label**: One of the snake_case classifier labels: `rabbit`, `lion`, `bird`, `snake`, `crocodile`, `demon`, `none`.
- **Sample**: One recorded data point containing a Label, two Hand_Slots (raw and normalized landmarks, handedness, score, presence per slot), the Inter_Hand_Features, a Shadow_Mask, the Session_ID, the Burst_ID, the contributor name, and a capture timestamp.
- **Session_ID**: An identifier unique per page load, stored with every Sample recorded during that load.
- **Burst_ID**: An identifier unique per burst recording, stored with every Sample captured during that burst.
- **Config**: The `src/config.ts` module that centralizes all tunable thresholds, timings, colors, sizes, rates, and paddings.
- **FPS_Overlay**: The small debug corner display that shows the current frames-per-second, toggled with the D key.
- **Contributor**: The person recording samples, identified by a free-text name field in the Collection_Tool.
- **Sample_Store**: The IndexedDB-backed persistent store in the Collection_Tool that retains recorded Samples across page reloads.

## Requirements

### Requirement 1: Project Scaffolding

**User Story:** As a developer, I want a Vite + TypeScript project with the agreed folder structure, so that the vision module and collection tool have a consistent, strict-typed foundation.

#### Acceptance Criteria

1. THE Vision_Module SHALL be built with Vite and TypeScript configured in strict mode.
2. THE Vision_Module SHALL use `@mediapipe/tasks-vision` as the hand-tracking dependency.
3. THE Vision_Module SHALL reside in a `src/vision/` directory and SHALL contain no puppet or game-flow logic.
4. THE Collection_Tool SHALL reside in a `tools/collect/` directory separate from the main application entry point.
5. THE Collection_Tool SHALL import and reuse the Vision_Module rather than duplicate camera or HandLandmarker logic.
6. WHERE the TypeScript compiler runs, THE Vision_Module SHALL compile with zero type errors under strict mode.

### Requirement 2: Webcam Startup and Error Handling

**User Story:** As a user, I want the webcam to start reliably and tell me clearly when it cannot, so that I understand whether the shadow play can begin.

#### Acceptance Criteria

1. WHEN the page requests camera access, THE Vision_Module SHALL request a video stream using the resolution defined in Config.
2. WHEN the user grants camera permission, THE Vision_Module SHALL attach the video stream to a video element and begin playback.
3. IF the user denies camera permission, THEN THE Vision_Module SHALL display a message stating that camera access is required and SHALL stop the startup sequence.
4. IF no camera device is available, THEN THE Vision_Module SHALL display a message stating that no camera was found.
5. THE Vision_Module SHALL display a notice stating that webcam frames are processed on-device and never leave the browser.

### Requirement 3: HandLandmarker Initialization with GPU/CPU Fallback and Local Assets

**User Story:** As a user, I want hand tracking to run on the GPU for speed but still work if the GPU is unavailable, so that the experience runs on a range of machines.

#### Acceptance Criteria

1. WHEN the Vision_Module initializes HandLandmarker, THE Vision_Module SHALL resolve the vision WASM fileset from the application's own public folder before creating the HandLandmarker instance.
2. WHEN creating the HandLandmarker instance, THE Vision_Module SHALL set the model asset path to the `.task` model file served from the application's own public folder, set the number of hands to 2, and set the running mode to VIDEO.
3. THE Vision_Module SHALL NOT load the HandLandmarker model file or the WASM fileset from a content delivery network.
4. WHEN creating the HandLandmarker instance, THE Vision_Module SHALL first attempt the GPU delegate.
5. IF creating the HandLandmarker instance with the GPU delegate fails, THEN THE Vision_Module SHALL retry creation with the CPU delegate.
6. IF creating the HandLandmarker instance fails with both the GPU and CPU delegates, THEN THE Vision_Module SHALL display a message stating that hand tracking could not start.

### Requirement 4: Mirrored Video Display

**User Story:** As a user, I want my webcam video mirrored, so that my hand movements feel natural like looking in a mirror.

#### Acceptance Criteria

1. THE Vision_Module SHALL display the webcam video horizontally mirrored.
2. THE Vision_Module SHALL render the Shadow_Silhouette using the same horizontal mirroring as the video so that the Shadow_Silhouette aligns with the user's perceived movement.

### Requirement 5: Per-Frame Landmark Emission in Display Coordinate Space

**User Story:** As a developer consuming the vision module, I want landmarks emitted every frame in the same coordinate space the game uses, so that downstream features and runtime inference agree.

#### Acceptance Criteria

1. WHILE the video is playing, THE Vision_Module SHALL run HandLandmarker in VIDEO mode once per rendered frame using the frame's timestamp in milliseconds.
2. IF the current video time matches the time already processed, THEN THE Vision_Module SHALL skip inference for that frame to avoid reprocessing the same frame.
3. WHEN HandLandmarker produces a result for a frame, THE Vision_Module SHALL emit the per-hand Landmark arrays, the handedness, the detection score, and the frame timestamp to registered consumers.
4. WHEN HandLandmarker detects no hands in a frame, THE Vision_Module SHALL emit a result containing an empty set of hands for that frame.
5. THE Vision_Module SHALL emit all Landmark coordinates in the Display_Coordinate_Space so that emitted landmarks match the mirrored coordinate space used at runtime.
6. THE Vision_Module SHALL document the Display_Coordinate_Space contract so that consumers and stored Samples share one coordinate space.

### Requirement 6: Shadow Silhouette Preview Rendering

**User Story:** As a user, I want to see my hands as a soft warm shadow on a dark screen, so that the preview evokes a lamp-lit shadow theatre.

#### Acceptance Criteria

1. THE Vision_Module SHALL render onto a canvas filled with the near-black background color defined in Config.
2. WHEN hands are detected in a frame, THE Vision_Module SHALL build each detected hand's Shadow_Silhouette from thick rounded strokes along each finger's bones plus a filled palm polygon.
3. THE Vision_Module SHALL draw the finger strokes using the silhouette stroke thickness defined in Config so that individual finger shapes remain visible.
4. THE Vision_Module SHALL apply a blur to the Shadow_Silhouette using the blur radius defined in Config so that the Shadow_Silhouette appears soft.
5. THE Vision_Module SHALL render the Shadow_Silhouette with the warm lamp-lit color defined in Config.
6. THE Vision_Module SHALL NOT draw thin skeleton lines or joint dots in the Shadow_Silhouette preview.
7. WHEN no hands are detected in a frame, THE Vision_Module SHALL render only the near-black background.

### Requirement 7: FPS Debug Overlay

**User Story:** As a developer, I want to toggle an FPS readout, so that I can confirm the pipeline meets the performance target.

#### Acceptance Criteria

1. WHILE the FPS_Overlay is enabled, THE Vision_Module SHALL display the current frames-per-second in a corner of the preview using the overlay style defined in Config.
2. WHEN the user presses the D key, THE Vision_Module SHALL toggle the visibility of the FPS_Overlay.
3. THE Vision_Module SHALL start with the FPS_Overlay hidden.
4. WHILE the FPS_Overlay is enabled, THE Vision_Module SHALL update the displayed frames-per-second at the refresh interval defined in Config.

### Requirement 8: Collection Tool Label Picker and Reference

**User Story:** As a contributor, I want to pick a shadow label and see what it should look like, so that I record correct, consistent samples.

#### Acceptance Criteria

1. THE Collection_Tool SHALL present a label picker offering exactly the Labels `rabbit`, `lion`, `bird`, `snake`, `crocodile`, `demon`, and `none`.
2. WHEN the contributor selects a Label, THE Collection_Tool SHALL mark that Label as the active Label for subsequent recordings.
3. WHILE a Label is active, THE Collection_Tool SHALL display the reference illustration and the shadow description for that Label next to the label picker.
4. THE Collection_Tool SHALL source each Label's shadow description from the shadow vocabulary defined in the product documentation.

### Requirement 9: Contributor Identification

**User Story:** As a contributor, I want to enter my name, so that recorded samples are attributed and the dataset stays traceable.

#### Acceptance Criteria

1. THE Collection_Tool SHALL provide a free-text contributor name field.
2. WHEN a Sample is recorded, THE Collection_Tool SHALL store the current contributor name value with that Sample.
3. IF the contributor name field is empty when recording is started, THEN THE Collection_Tool SHALL prevent recording and SHALL prompt the contributor to enter a name.

### Requirement 10: Countdown and Configurable-Rate Burst Recording

**User Story:** As a contributor, I want a countdown and then a timed burst of captures at a steady rate, so that I can get my hands into position and record a balanced set of samples hands-free.

#### Acceptance Criteria

1. WHEN the contributor starts recording, THE Collection_Tool SHALL display a countdown of the duration defined in Config before capture begins.
2. WHEN the countdown reaches zero, THE Collection_Tool SHALL begin burst recording for the duration defined in Config and SHALL assign a new Burst_ID to that burst.
3. WHILE burst recording is active, THE Collection_Tool SHALL capture Samples at the capture rate defined in Config, labeling each Sample with the active Label.
4. WHEN the burst recording duration elapses, THE Collection_Tool SHALL stop capturing and return to the ready state.
5. WHILE burst recording is active, THE Collection_Tool SHALL display an indication that recording is in progress.

### Requirement 11: Sample Capture Content

**User Story:** As a dataset builder, I want each sample to contain raw and normalized landmarks, inter-hand features, and a shadow mask in fixed hand slots, so that both the landmark MLP and the silhouette CNN can be trained from the same data and features can be recomputed later.

#### Acceptance Criteria

1. WHEN a Sample is captured and exactly one hand is detected, THE Collection_Tool SHALL store that hand in Hand_Slot 0 regardless of where the hand appears in the frame, and SHALL leave Hand_Slot 1 absent.
2. WHEN a Sample is captured and two hands are detected, THE Collection_Tool SHALL store the hand whose wrist (landmark 0) has the smaller x coordinate in Hand_Slot 0 and the other hand in Hand_Slot 1, so that slot assignment is deterministic and independent of MediaPipe handedness.
3. WHEN a Sample is captured, THE Collection_Tool SHALL store, for each present Hand_Slot, the Raw_Landmarks as 21 three-dimensional points in the Display_Coordinate_Space.
4. WHEN a Sample is captured, THE Collection_Tool SHALL store, for each present Hand_Slot, the Normalized_Landmarks made wrist-relative by subtracting landmark 0 and then divided by the Hand_Scale, where the Hand_Scale is the distance from landmark 0 to landmark 9.
5. WHEN a Sample is captured, THE Collection_Tool SHALL store, for each Hand_Slot, the handedness label, the detection score, and the Presence_Flag.
6. IF a hand is not detected for a Hand_Slot when a Sample is captured, THEN THE Collection_Tool SHALL zero-fill that Hand_Slot's 21x3 Raw_Landmarks and Normalized_Landmarks and SHALL set that Hand_Slot's Presence_Flag to absent.
7. WHEN a Sample is captured, THE Collection_Tool SHALL store the Inter_Hand_Features consisting of the normalized inter-hand wrist offset, defined as the Hand_Slot 1 wrist (landmark 0) minus the Hand_Slot 0 wrist (landmark 0) divided by the mean Hand_Scale of the two hands, and a hand count.
8. IF either Hand_Slot is absent when a Sample is captured, THEN THE Collection_Tool SHALL zero-fill the normalized wrist offset in the Inter_Hand_Features.
9. WHEN a Sample is captured, THE Collection_Tool SHALL store a Shadow_Mask produced per the Shadow_Mask definition.
10. WHEN a Sample is captured, THE Collection_Tool SHALL store the active Label, the contributor name, the Session_ID, the Burst_ID, and a capture timestamp with the Sample.

### Requirement 12: Shadow Mask Generation

**User Story:** As a dataset builder, I want the shadow mask produced the same way as the preview and normalized to a fixed size, so that the silhouette CNN trains on consistent inputs.

#### Acceptance Criteria

1. WHEN a Shadow_Mask is generated, THE Collection_Tool SHALL render the silhouette using the same silhouette renderer as the Shadow_Silhouette preview.
2. WHEN hands are detected, THE Collection_Tool SHALL crop the rendered silhouette to the bounding box of the detected hands plus the mask bounding-box padding defined in Config.
3. WHEN a Shadow_Mask is generated, THE Collection_Tool SHALL center the cropped silhouette and resize it to 96x96 while preserving aspect ratio, and SHALL store the result as a single-channel grayscale image.
4. IF the active Label is `none` and no hands are detected when a Shadow_Mask is generated, THEN THE Collection_Tool SHALL store a blank Shadow_Mask.

### Requirement 13: Live Per-Label Sample Counts

**User Story:** As a contributor, I want to see how many samples exist per label, so that I can balance the dataset across labels.

#### Acceptance Criteria

1. THE Collection_Tool SHALL display a Sample count for each of the seven Labels.
2. WHEN a Sample is captured, THE Collection_Tool SHALL increment the displayed count for that Sample's Label.
3. THE Collection_Tool SHALL update the displayed per-label counts within the refresh interval defined in Config after a count changes.

### Requirement 14: Collection Tool Readiness and Live Mask Preview

**User Story:** As a contributor, I want to see exactly what will be captured and be prevented from recording before the tracker is ready, so that I only record valid samples.

#### Acceptance Criteria

1. WHILE HandLandmarker is not yet ready, THE Collection_Tool SHALL disable the recording control.
2. WHEN HandLandmarker becomes ready, THE Collection_Tool SHALL enable the recording control.
3. WHILE the preview is running, THE Collection_Tool SHALL display a live 96x96 Shadow_Mask thumbnail of what will be captured.
4. WHILE the preview is running, THE Collection_Tool SHALL update the live Shadow_Mask thumbnail each frame.

### Requirement 15: Sample Persistence and Editing

**User Story:** As a contributor, I want my recorded samples to survive page reloads and to be able to undo or clear them, so that I do not lose work and can correct mistakes.

#### Acceptance Criteria

1. WHEN a Sample is captured, THE Collection_Tool SHALL persist that Sample in the Sample_Store backed by IndexedDB.
2. WHEN the Collection_Tool page loads, THE Collection_Tool SHALL restore the previously recorded Samples and the per-label counts from the Sample_Store.
3. WHEN the contributor triggers undo last burst, THE Collection_Tool SHALL remove from the Sample_Store all Samples whose Burst_ID matches the most recent burst.
4. WHEN the contributor triggers clear all, THE Collection_Tool SHALL require a confirmation step before removing Samples.
5. WHEN the contributor confirms clear all, THE Collection_Tool SHALL remove all Samples from the Sample_Store.

### Requirement 16: Versioned JSON Export

**User Story:** As a dataset builder, I want to export all recorded samples to a versioned JSON file with metadata, so that I can feed them into the training pipeline with full provenance.

#### Acceptance Criteria

1. WHEN the contributor triggers export, THE Collection_Tool SHALL serialize all recorded Samples into a single JSON document containing a metadata header and the Sample list.
2. WHEN the contributor triggers export, THE Collection_Tool SHALL include in the metadata header the schema version, the Label list, the Shadow_Mask size, a description of the normalization method, and the export date.
3. WHEN the contributor triggers export, THE Collection_Tool SHALL include each Sample's Label, two Hand_Slots with Raw_Landmarks, Normalized_Landmarks, handedness, detection score, and Presence_Flag, the Inter_Hand_Features, the Shadow_Mask, the Session_ID, the Burst_ID, the contributor name, and the capture timestamp.
4. WHEN the contributor triggers export, THE Collection_Tool SHALL encode each Shadow_Mask as a base64 string in the exported JSON.
5. WHEN the contributor triggers export, THE Collection_Tool SHALL download the JSON document as a file whose filename includes the contributor name and the export date.
6. IF no Samples have been recorded when export is triggered, THEN THE Collection_Tool SHALL prevent export and SHALL inform the contributor that there is nothing to export.

### Requirement 17: Configuration Centralization

**User Story:** As a developer, I want every tunable number in one place, so that thresholds, timings, colors, sizes, rates, and paddings can be tuned without hunting through modules.

#### Acceptance Criteria

1. THE Config SHALL define the camera resolution, the silhouette blur radius, the near-black background color, the warm silhouette color, and the silhouette stroke thickness.
2. THE Config SHALL define the countdown duration, the burst recording duration, the capture rate with a default of 10 Samples per second, the UI refresh interval, and the FPS_Overlay style.
3. THE Config SHALL define the Shadow_Mask dimensions as 96 by 96 and the mask bounding-box padding.
4. THE Vision_Module and the Collection_Tool SHALL read tunable thresholds, timings, colors, sizes, rates, and paddings from the Config rather than defining literal values inline.

### Requirement 18: Correctness Properties

**User Story:** As a dataset builder, I want the feature computation to satisfy invariant properties, so that the training data is consistent and robust under property-based testing.

#### Acceptance Criteria

1. WHERE the detected hands are translated within the frame, THE Collection_Tool SHALL produce Normalized_Landmarks that are invariant to that translation.
2. WHERE the detected hands are uniformly scaled, THE Collection_Tool SHALL produce Normalized_Landmarks that are invariant to that scaling.
3. THE Collection_Tool SHALL produce a feature vector of fixed length regardless of how many hands are detected.
4. IF a Hand_Slot is absent, THEN THE Collection_Tool SHALL store exactly zeros in that Hand_Slot's landmark values.
5. WHERE the detection order of two hands is swapped, THE Collection_Tool SHALL produce the same stored Sample because Hand_Slots are assigned by mirrored-display left/right position rather than detection order.
6. WHERE the detected hands are translated within the frame, THE Collection_Tool SHALL produce Inter_Hand_Features that are invariant to that translation.
7. WHERE the detected hands are uniformly scaled, THE Collection_Tool SHALL produce Inter_Hand_Features that are invariant to that scaling.
8. WHEN exactly one hand is detected, THE Collection_Tool SHALL store that hand in Hand_Slot 0 regardless of where the hand appears in the frame.
