# Requirements Document

## Introduction

This spec covers the **hand-shadow classifier** for Needalaata (నీడలాట), a browser-based Tholu Bommalata shadow theatre. It takes the labeled dataset exported by the Spec 1 Collection_Tool (`vision-and-collection`), trains two candidate models, keeps the better one, exports it to TensorFlow.js, and runs it live in the browser. The runtime emits debounced shape events that the theatre (a later spec) can subscribe to.

The work has four parts:

1. **Shared code.** FeatureExtractor and MaskGenerator (including `encodeMask`/`decodeMask`) move from `tools/collect/` into `src/vision/`, so the collector, the training scripts, and the runtime predictor import one implementation. This removes train/serve skew.
2. **Offline training pipeline** (Node, TypeScript, TensorFlow.js): dataset loading and validation, dataset report, leak-free splitting by contributor and burst, two candidate models (Landmark MLP and a small depthwise-separable CNN), evaluation, model selection, and export to `public/models/classifier/`. The pipeline is exposed as npm scripts and as importable library functions so a future "Shadow Lab" MCP server can wrap it.
3. **Runtime predictor** in `src/classifier/`: per-frame probabilities from `FrameResult`, then a debouncer that fires `{label, confidence, timestamp}` events.
4. **Classifier debug view** on the existing vision preview page.

All webcam processing stays on-device. Raw dataset exports are local-only and are never committed. Contributors appear in reports only as anonymised IDs. Out of scope: the theatre, puppets, tales, audio, the Shadow Lab MCP server itself (training only needs to be wrappable), collecting more data, and changes to the collector UI.

## Glossary

- **Classifier_Module**: The runtime code in `src/classifier/` that loads the exported model, produces Predictions, and emits Shape_Events. It contains no puppet or story logic.
- **Training_Pipeline**: The Node/TypeScript code in `training/` that loads the Dataset, builds Splits, trains both Candidate_Models, evaluates them, selects one, and exports it.
- **Vision_Module**: The code in `src/vision/` (camera, HandLandmarker, silhouette, FeatureExtractor, MaskGenerator), as defined in Spec 1.
- **Collection_Tool**: The collector page in `tools/collect/`, as defined in Spec 1.
- **FeatureExtractor**: The shared module that turns a FrameResult into a fixed-length, slot-ordered feature set (Hand_Slots plus Inter_Hand_Features).
- **MaskGenerator**: The shared module that renders and encodes the 96x96 Shadow_Mask, including `encodeMask` and `decodeMask`.
- **FrameResult**: The per-frame output of the VisionPipeline (hands in mirrored Display_Coordinate_Space, timestamp, frameWidth, frameHeight).
- **Label**: One of exactly seven snake_case classifier labels, in this order everywhere: `rabbit`, `lion`, `bird`, `snake`, `crocodile`, `demon`, `none`.
- **Label_Index**: The zero-based position of a Label in the Label order (`rabbit` = 0 through `none` = 6).
- **Sample**: One recorded data point from the Collection_Tool (label, two Hand_Slots with raw landmarks, Inter_Hand_Features, Shadow_Mask, frame size, Session_ID, Burst_ID, contributor name, timestamp).
- **Export_File**: A versioned JSON file produced by the Collection_Tool exporter.
- **Schema_Version**: The `schemaVersion` string in an Export_File header, compared against the exporter's `SCHEMA_VERSION` constant.
- **Dataset**: The set of valid Samples loaded from one or more Export_Files in `data/raw/`.
- **Raw_Data_Folder**: The local, gitignored `data/raw/` folder that holds Export_Files.
- **Contributor**: The person who recorded a Sample, identified in storage by a free-text name.
- **Normalised_Name**: A Contributor name after removing leading and trailing whitespace and applying case-insensitive comparison. Two names with the same Normalised_Name denote the same Contributor.
- **Display_Name**: The Contributor name exactly as first seen for a Normalised_Name, stored in the Contributor_Registry.
- **Contributor_ID**: A stable anonymised identifier (`C1`, `C2`, ...) assigned to each distinct Normalised_Name through the Contributor_Registry. Once assigned, a Contributor_ID never changes. Reports use Contributor_IDs and never names.
- **Contributor_Registry**: The persistent, append-only, gitignored mapping file `data/contributors.json` from Normalised_Names to Contributor_IDs, storing the Display_Name for each entry. It is the only place where Contributor names are stored by the Training_Pipeline.
- **Test_Contributor_IDs**: The list of Contributor_IDs, set in the Training_Config, whose Samples form the Test_Split.
- **Burst**: The group of Samples sharing one Burst_ID.
- **Dataset_Report**: The JSON and readable summary of Dataset contents (counts per Label, per Burst, per Contributor_ID, and warnings).
- **Split**: A partition of the Dataset into train, validation, and test subsets.
- **Test_Split**: The Split that holds out at least one whole Contributor, chosen by Test_Contributor_IDs, and is used only for evaluation and model selection.
- **Validation_Split**: The Split used for early stopping, drawn by whole Bursts from the Contributors not in the Test_Split.
- **Train_Split**: The remaining Samples, the only Split to which augmentation is applied.
- **Split_Seed**: The integer seed that drives Validation_Split Burst selection deterministically.
- **Training_Seed**: The integer seed in the Training_Config from which the shuffle seed, the augmentation seed, and every kernel, depthwise, and pointwise initialiser seed are derived. Dropout layers are not seeded.
- **Landmark_MLP**: Candidate_Model A, a multilayer perceptron on the Feature_Vector.
- **Silhouette_CNN**: Candidate_Model B, a small MobileNet-style convolutional network built from depthwise-separable convolutions on 96x96 single-channel Shadow_Masks.
- **Candidate_Model**: Either the Landmark_MLP or the Silhouette_CNN.
- **Feature_Vector**: The fixed-length numeric input of the Landmark_MLP: both Hand_Slots' Normalized_Landmarks (2 x 21 x 3 = 126 values), both Presence_Flags (2 values), and the normalized inter-hand wrist offset (3 values), for 131 values in total.
- **Training_Config**: The single module `training/training-config.ts` that holds all training hyperparameters, thresholds for the Dataset_Report, the Split_Seed, and the accuracy target.
- **Evaluation_Report**: The JSON and readable summary of a Candidate_Model's performance on the Test_Split (accuracy, per-Label precision and recall, Confusion_Matrix, misclassified Samples).
- **Confusion_Matrix**: A 7x7 matrix of counts with true Labels as rows and predicted Labels as columns, in Label order.
- **Model_Selection**: The step that picks the Candidate_Model to export, by held-out test accuracy with a size/speed tie-break.
- **Exported_Model**: The TensorFlow.js model files in `public/models/classifier/` together with Model_Metadata.
- **Model_Metadata**: The small JSON file saved beside the Exported_Model with the Label order, input type (`MLP` or `CNN`), input shape, Schema_Version, training date, and test accuracy.
- **Training_Backend**: The TensorFlow.js compute backend used by the Training_Pipeline: `tfjs-node` (native), `wasm`, or `cpu` (pure JavaScript).
- **Training_API**: The importable TypeScript functions of the Training_Pipeline (dataset statistics, training, evaluation, confusion matrix, misclassified Samples) that npm scripts and a future Shadow Lab MCP server call.
- **Predictor**: The Classifier_Module component that turns each FrameResult into a Prediction.
- **Prediction**: A probability for each of the seven Labels, plus the top Label and its confidence, for one frame.
- **Debouncer**: The Classifier_Module component that turns the stream of Predictions into Shape_Events.
- **Stable_Run**: A sequence of consecutive frames whose top Label is the same Label other than `none`, with confidence at or above the Confidence_Threshold on every frame.
- **Confidence_Threshold**: The minimum top-Label confidence for a frame to count toward a Stable_Run, defined in Config (default 0.85).
- **Stable_Frame_Count**: The number N of consecutive qualifying frames a Stable_Run needs before its Label fires, defined in Config (default 24 frames, about 0.8 s at 30 fps).
- **Shape_Event**: The object `{label, confidence, timestamp}` delivered to subscribers when a Stable_Run reaches the Stable_Frame_Count.
- **Classifier_Debug_View**: The overlay on the vision preview page that shows the current top Label with its confidence and a log of recent Shape_Events, toggled with the C key.
- **FPS_Overlay**: The Spec 1 debug corner display toggled with the D key.
- **Config**: The `src/config.ts` module that centralizes runtime tunable numbers.

## Requirements

### Requirement 1: Shared Code Relocation

**User Story:** As a developer, I want the feature and mask code in one shared location, so that the collector, the training scripts, and the runtime predictor all use the same implementation and training input equals live input.

#### Acceptance Criteria

1. THE Vision_Module SHALL contain the FeatureExtractor in `src/vision/`.
2. THE Vision_Module SHALL contain the MaskGenerator, `encodeMask`, and `decodeMask` in `src/vision/`.
3. THE Collection_Tool SHALL import the FeatureExtractor and the MaskGenerator from `src/vision/`.
4. THE Training_Pipeline SHALL import the FeatureExtractor and the MaskGenerator codec from `src/vision/`.
5. THE Classifier_Module SHALL import the FeatureExtractor and the MaskGenerator from `src/vision/`.
6. THE repository SHALL contain exactly one implementation of the FeatureExtractor and exactly one implementation of the mask codec.
7. WHEN the relocation is complete, THE Collection_Tool SHALL produce byte-identical Samples and exports compared with its behavior before the relocation.
8. WHEN the relocation is complete, THE existing Spec 1 test suite, including fast-check Properties 1 through 12, SHALL pass without modification of any assertion.
9. WHEN the Training_Pipeline runs in Node, THE FeatureExtractor module and the mask codec SHALL load without access to browser globals such as `document` or `window`.

### Requirement 2: Dataset Loading and Validation

**User Story:** As a model trainer, I want exported files loaded and validated, so that a single bad file or sample never corrupts or crashes training.

#### Acceptance Criteria

1. WHEN the Training_Pipeline loads a Dataset, THE Training_Pipeline SHALL read every `.json` Export_File in the Raw_Data_Folder, or only the files named by the caller.
2. WHEN an Export_File has a Schema_Version that differs from the exporter's `SCHEMA_VERSION`, THE Training_Pipeline SHALL reject that file and record the file name, the found version, and the expected version in the load report.
3. WHEN an Export_File has a Label list that differs from the Label order, THE Training_Pipeline SHALL reject that file and record the reason in the load report.
4. WHEN an Export_File declares a mask size other than 96 by 96, THE Training_Pipeline SHALL reject that file and record the reason in the load report.
5. IF an Export_File cannot be read or parsed as JSON, THEN THE Training_Pipeline SHALL record the file name and the error in the load report and SHALL continue with the remaining files.
6. WHEN a Sample is loaded, THE Training_Pipeline SHALL validate the Sample's mask with the production `decodeMask`.
7. IF a Sample has an unknown Label, a mask that `decodeMask` rejects, a Hand_Slot that is not 21 landmarks, a non-finite coordinate, or a missing Burst_ID or contributor name, THEN THE Training_Pipeline SHALL skip that Sample and record its identifier and the reason in the load report.
8. IF two Samples share the same identifier, THEN THE Training_Pipeline SHALL keep the first and record the duplicate in the load report.
9. WHEN a Sample is accepted, THE Training_Pipeline SHALL rebuild the Sample's Feature_Vector from the stored Raw_Landmarks, frameWidth, and frameHeight using the shared FeatureExtractor.
10. WHEN a Sample is accepted, THE Training_Pipeline SHALL use the stored Shadow_Mask bytes as the Silhouette_CNN input.
11. WHEN the Feature_Vector rebuilt from raw data differs from the stored Normalized_Landmarks by more than the tolerance in the Training_Config, THE Training_Pipeline SHALL record a warning for that Sample and SHALL keep the rebuilt values.
12. WHEN loading finishes, THE Training_Pipeline SHALL return a load report listing files read, files rejected, Samples accepted, Samples skipped, and the reason for each rejection or skip.
13. IF no valid Sample remains after loading, THEN THE Training_Pipeline SHALL stop with an error that states the Raw_Data_Folder path and the load report.
14. THE repository SHALL list `data/raw/` and `data/contributors.json` in `.gitignore` so that Export_Files and the Contributor_Registry are never committed, and SHALL NOT ignore `/.kiro` or any of its subfolders, as verifiable with `git check-ignore`.

### Requirement 3: Dataset Report

**User Story:** As a model trainer, I want a per-label and per-contributor summary of the dataset, so that I can see imbalance and coverage problems before training.

#### Acceptance Criteria

1. WHEN the Dataset_Report is requested, THE Training_Pipeline SHALL report, for each of the seven Labels, the number of Samples and the number of Bursts.
2. WHEN the Dataset_Report is requested, THE Training_Pipeline SHALL report, for each Contributor_ID, the number of Samples per Label.
3. THE Training_Pipeline SHALL assign Contributor_IDs of the form `C1`, `C2`, and so on, through the Contributor_Registry at `data/contributors.json`, so that a Contributor name whose Normalised_Name is already in the Contributor_Registry keeps its Contributor_ID and a Contributor name whose Normalised_Name is not yet in the Contributor_Registry receives the next unused Contributor_ID (`C{n+1}`, where n is the highest assigned number).
4. THE Training_Pipeline SHALL omit contributor names from the Dataset_Report, the Evaluation_Report, and all log output, so that names appear only in the Contributor_Registry.
5. IF a Label has fewer Samples than the minimum in the Training_Config (default 250), THEN THE Training_Pipeline SHALL add a warning to the Dataset_Report that names the Label and its Sample count.
6. IF one Contributor_ID supplies more than the share in the Training_Config (default 50 percent) of a Label's Samples, THEN THE Training_Pipeline SHALL add a warning to the Dataset_Report that names the Label and the Contributor_ID.
7. WHEN the Dataset_Report is requested, THE Training_Pipeline SHALL write the report as JSON and print a readable summary.
8. THE Training_Pipeline SHALL treat the Contributor_Registry as append-only, so that no existing entry is changed, renumbered, or removed.
9. IF `data/contributors.json` does not exist, THEN THE Training_Pipeline SHALL create it and SHALL assign `C1` to the first new Contributor name.
10. IF `data/contributors.json` cannot be parsed or contains duplicate Contributor_IDs, THEN THE Training_Pipeline SHALL stop with an error that names the file and the problem and SHALL leave the file unchanged.
11. THE Dataset_Report and the repository README SHALL state that Samples labeled `none` should include a pointing index finger and a relaxed open hand, because later specs use those poses for pointing and puppeteering and they must classify as `none`.
12. WHEN the Dataset_Report is requested, THE Training_Pipeline SHALL include the `none` guidance from criterion 11 in the readable summary.
13. WHEN the Training_Pipeline looks up a Contributor name in the Contributor_Registry, THE Training_Pipeline SHALL first remove leading and trailing whitespace and SHALL compare names case-insensitively, so that names differing only by case or surrounding whitespace map to the same Contributor_ID.
14. WHEN a Normalised_Name is added to the Contributor_Registry, THE Training_Pipeline SHALL store the first-seen Display_Name and SHALL keep that Display_Name unchanged when later names with the same Normalised_Name occur.

### Requirement 4: Leak-Free Splitting

**User Story:** As a model trainer, I want train, validation, and test sets that cannot leak between each other, so that reported accuracy reflects performance on new people.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL hold out at least one whole Contributor in the Test_Split.
2. THE Training_Pipeline SHALL read the Test_Contributor_IDs from `training/training-config.ts` and SHALL place every Sample of each listed Contributor_ID in the Test_Split, without choosing Test_Split Contributors by name sort order or by random shuffle of names.
3. IF the Test_Contributor_IDs list is empty, THEN THE Training_Pipeline SHALL stop with an error that states at least one Contributor_ID is required.
4. IF any configured Test_Contributor_ID is absent from the Dataset, THEN THE Training_Pipeline SHALL stop with an error that names the missing Contributor_IDs and lists the Contributor_IDs present in the Dataset.
5. IF the configured Test_Contributor_IDs include every Contributor_ID in the Dataset, THEN THE Training_Pipeline SHALL stop with an error that states the Train_Split would be empty.
6. THE Training_Pipeline SHALL assign every Sample of a Contributor to the same Split as that Contributor's other Samples, so that no Contributor appears in both the Train_Split and the Test_Split.
7. THE Training_Pipeline SHALL draw the Validation_Split from the Contributors not in the Test_Split by selecting whole Bursts using the Split_Seed, so that no Burst appears in more than one Split.
8. THE Training_Pipeline SHALL NOT split the Dataset by individual Sample.
9. WHEN the Training_Pipeline builds Splits twice from the same Dataset, the same Test_Contributor_IDs, and the same Split_Seed, THE Training_Pipeline SHALL produce identical Splits.
10. THE Training_Pipeline SHALL record the Split_Seed, the Test_Contributor_IDs, the Contributor_IDs in each Split, and the Sample and Burst counts per Label in each Split in the Dataset_Report.
11. IF the Dataset contains fewer than two Contributors, THEN THE Training_Pipeline SHALL stop with an error that states a leak-free Test_Split needs at least two Contributors.
12. IF a Label has no Samples in the Test_Split, THEN THE Training_Pipeline SHALL add a warning to the report that names the Label.
13. WHEN the Validation_Split is drawn, THE Training_Pipeline SHALL select Bursts per Label so that each Label with at least two Bursts among the non-test Contributors appears in the Validation_Split.
14. THE Training_Pipeline SHALL apply augmentation to the Train_Split only.

### Requirement 5: Two Candidate Models

**User Story:** As a model trainer, I want a landmark MLP and a silhouette CNN trained reproducibly from one config, so that I can compare them fairly.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL build the Landmark_MLP with the 131-value Feature_Vector as input and a 7-way softmax output in Label order.
2. THE Feature_Vector SHALL consist of both Hand_Slots' Normalized_Landmarks, both Presence_Flags, and the normalized inter-hand wrist offset, in that order.
3. THE Training_Pipeline SHALL build the Silhouette_CNN with a 96x96x1 input, depthwise-separable convolution blocks, and a 7-way softmax output in Label order.
4. THE Training_Pipeline SHALL scale Shadow_Mask bytes to the range 0 to 1 for the Silhouette_CNN input.
5. THE Training_Pipeline SHALL read every hyperparameter (epochs, batch size, learning rate, layer sizes, dropout, early-stopping patience, augmentation settings, seed) from the Training_Config.
6. WHEN the Training_Pipeline trains a Candidate_Model twice with the same Dataset, Training_Config, and Training_Backend, THE Training_Pipeline SHALL produce the same Split, the same shuffle order, the same augmentation, and the same initial weights.
7. THE Training_Pipeline SHALL derive a distinct seed from the Training_Seed for the data shuffle, for the augmentation, for every dense and convolution kernel initialiser, and for every depthwise and pointwise kernel initialiser, and SHALL drive the Split with the Split_Seed.
8. THE Training_Pipeline SHALL guarantee reproducibility only within the same Training_Backend, and SHALL NOT guarantee identical results across Training_Backends.
9. THE Training_Pipeline SHALL use the Validation_Split for early stopping and SHALL NOT use the Test_Split for any training decision.
10. WHEN the Training_Pipeline trains a Candidate_Model, THE Training_Pipeline SHALL dispose of all intermediate tensors so that tensor count after training equals the count before training plus the model's own weights.
11. THE Training_Pipeline SHALL leave dropout layers unseeded, so that dropout is the one source of run-to-run variation, and two runs with the same Training_Seed SHALL match in initial weights but MAY differ in final weights.

### Requirement 6: Evaluation and Model Selection

**User Story:** As a model trainer, I want clear held-out metrics for both models and an automatic pick of the better one, so that I can trust what ships.

#### Acceptance Criteria

1. WHEN a Candidate_Model finishes training, THE Training_Pipeline SHALL evaluate the Candidate_Model on the Test_Split and report test accuracy.
2. WHEN a Candidate_Model is evaluated, THE Training_Pipeline SHALL report precision and recall for each Label and the 7x7 Confusion_Matrix.
3. WHEN a Candidate_Model is evaluated, THE Training_Pipeline SHALL list every misclassified Test_Split Sample with its identifier, true Label, predicted Label, and confidence.
4. THE Training_Pipeline SHALL write each Evaluation_Report as JSON and print a readable summary.
5. WHEN both Candidate_Models are evaluated, THE Training_Pipeline SHALL select the Candidate_Model with the higher test accuracy.
6. WHEN the test accuracies of the two Candidate_Models differ by 1 percentage point or less, THE Training_Pipeline SHALL select the Candidate_Model with the smaller exported size and, if sizes are equal, the lower measured inference time.
7. IF neither Candidate_Model reaches the accuracy target in the Training_Config (default 0.90), THEN THE Training_Pipeline SHALL state in the report that the target was not met, SHALL list the most-confused Label pairs by Confusion_Matrix count, and SHALL still complete without crashing.
8. IF a Label has zero Test_Split Samples, THEN THE Training_Pipeline SHALL report precision and recall for that Label as undefined rather than as zero or NaN.
9. WHEN the Training_Pipeline completes, THE Training_Pipeline SHALL report which Candidate_Model was selected and why.

### Requirement 7: Export to TensorFlow.js

**User Story:** As a developer, I want the chosen model exported in a browser-loadable format with a metadata file, so that the runtime loads exactly what was evaluated.

#### Acceptance Criteria

1. WHEN Model_Selection completes, THE Training_Pipeline SHALL save the selected Candidate_Model in TensorFlow.js layers format to `public/models/classifier/`.
2. WHEN the Exported_Model is saved, THE Training_Pipeline SHALL write a Model_Metadata file to `public/models/classifier/` containing the Label order, the input type (`MLP` or `CNN`), the input shape, the Schema_Version, the training date, and the test accuracy.
3. WHEN the Exported_Model is saved, THE Training_Pipeline SHALL verify that the total size of the files in `public/models/classifier/` is under 5 MB and SHALL report an error if it is not.
4. WHEN the Exported_Model is saved, THE Training_Pipeline SHALL load the saved files back and SHALL verify that predictions on the Test_Split match the in-memory model within a floating-point tolerance in the Training_Config.
5. THE repository SHALL track `public/models/classifier/` in version control while `public/models/hand_landmarker.task` stays ignored.
6. WHEN the Training_Pipeline writes the Exported_Model, THE Training_Pipeline SHALL produce the same file layout regardless of the Training_Backend.
7. THE repository `.gitignore` SHALL un-ignore `public/models/classifier/` while `public/models/hand_landmarker.task` and `public/wasm/` remain ignored, as verifiable with `git check-ignore`.
8. THE test suite SHALL include a required export round-trip test that saves a small model with the Training_Pipeline's custom model writer, loads the saved files with `tf.loadLayersModel`, which is the loader the Predictor uses in the browser, and verifies that predictions on fixed inputs match the in-memory model within the floating-point tolerance in the Training_Config.
9. IF the export round-trip test fails, THEN THE test suite SHALL report the failure, and THE Training_Pipeline SHALL NOT treat the Exported_Model writer as verified.

### Requirement 8: Node Training Runtime, Backends, and Wrappable API

**User Story:** As a developer, I want training to run in TypeScript on Node with a backend that works on my machine, and to be callable from scripts and a future MCP server, so that I keep one language and reuse the production code.

#### Acceptance Criteria

1. THE Training_Pipeline SHALL be written in TypeScript and SHALL run on Node with TensorFlow.js.
2. WHEN the Training_Pipeline selects a Training_Backend, THE Training_Pipeline SHALL prefer `tfjs-node` and SHALL verify it by running a small tensor operation before use.
3. IF `@tensorflow/tfjs-node` fails to install, fails to load, or fails the verification operation, THEN THE Training_Pipeline SHALL fall back in the order `tfjs-node`, then `wasm`, then `cpu`, verifying each backend before use.
4. WHEN the Training_Pipeline selects a Training_Backend, THE Training_Pipeline SHALL log the chosen backend and the reason for any fallback.
5. WHERE the caller names a Training_Backend, THE Training_Pipeline SHALL use that backend or stop with an error if it is unavailable.
6. THE Training_Pipeline SHALL guarantee identical results for repeated runs only within the same Training_Backend, and results across Training_Backends MAY differ by floating-point differences.
7. THE repository SHALL provide npm scripts named `train`, `evaluate`, and `dataset:report`.
8. THE Training_API SHALL export functions for dataset statistics, building Splits, training a Candidate_Model, evaluating a Candidate_Model, returning a Confusion_Matrix, and returning misclassified Samples.
9. THE Training_API SHALL return structured results as plain JSON-serializable objects and SHALL NOT call `process.exit` or write to the console except through an injectable logger.
10. THE Training_Pipeline SHALL reuse the shared FeatureExtractor and mask codec so that training input equals live input.
11. WHEN the `train` command starts, THE `train` command SHALL print which Training_Backend it chose (`tfjs-node`, `wasm`, or `cpu`).
12. THE repository README SHALL document that running under Node 22 LTS enables `tfjs-node` for faster training.
13. THE repository SHALL NOT contain an `engines` field in `package.json` or an `.nvmrc` file for the purpose of pinning the Node version.

### Requirement 9: Runtime Predictor

**User Story:** As a player, I want my hand shadow classified live without slowing the stage, so that the theatre can react to what I cast.

#### Acceptance Criteria

1. WHEN the Classifier_Module starts, THE Classifier_Module SHALL load the Exported_Model and Model_Metadata from `public/models/classifier/`.
2. WHEN a FrameResult is emitted by the VisionPipeline, THE Predictor SHALL build the model input with the shared FeatureExtractor when the input type is `MLP`, or with the shared MaskGenerator when the input type is `CNN`, as stated in the Model_Metadata.
3. WHEN a FrameResult is processed, THE Predictor SHALL output one probability for each of the seven Labels in Label order.
4. WHEN a FrameResult contains no hands, THE Predictor SHALL output a Prediction with top Label `none` without running the model.
5. WHEN the Predictor runs the model for a frame, THE Predictor SHALL wrap tensor work in `tf.tidy` so that the number of live tensors after the frame equals the number before the frame.
6. WHILE the Classifier_Module is running, THE Classifier_Module SHALL keep the preview at 30 frames per second or higher on a mid-range laptop.
7. WHILE the Classifier_Module is running, THE Predictor SHALL complete inference in under the per-frame budget defined in Config (default 15 ms).
8. IF the model files or Model_Metadata fail to load, THEN THE Classifier_Module SHALL enter an error state, SHALL show a message stating that the classifier could not load, and SHALL leave the camera preview running.
9. IF the Model_Metadata Label order differs from the application's Label order, THEN THE Classifier_Module SHALL enter the error state and SHALL name the mismatch.
10. IF the Predictor throws while processing a frame, THEN THE Classifier_Module SHALL skip that frame, SHALL record the error, and SHALL process the next frame.
11. WHEN the Classifier_Module is stopped, THE Classifier_Module SHALL unsubscribe from the VisionPipeline and SHALL dispose of the model.

### Requirement 10: Debounced Shape Events

**User Story:** As a theatre developer, I want a shape event only when a shadow is held steadily, so that flicker never triggers a puppet.

#### Acceptance Criteria

1. THE Config SHALL define the Stable_Frame_Count and the Confidence_Threshold.
2. WHEN the top Label stays the same Label other than `none` with confidence at or above the Confidence_Threshold for the Stable_Frame_Count consecutive frames, THE Debouncer SHALL fire a Shape_Event for that Label.
3. WHEN the Debouncer fires a Shape_Event, THE Debouncer SHALL set the event's label to the Stable_Run's Label, its confidence to the confidence of the frame that completed the Stable_Run, and its timestamp to that frame's FrameResult timestamp.
4. WHILE a Stable_Run continues after it has fired, THE Debouncer SHALL fire no further Shape_Event for that Stable_Run.
5. WHEN a Stable_Run is broken and a new Stable_Run of the same Label then reaches the Stable_Frame_Count, THE Debouncer SHALL fire a Shape_Event again.
6. WHEN a frame has top Label `none`, THE Debouncer SHALL reset the current run.
7. WHEN a frame has top-Label confidence below the Confidence_Threshold, THE Debouncer SHALL reset the current run.
8. WHEN a frame has a different qualifying top Label than the current run, THE Debouncer SHALL end the current run and SHALL start a new run of length one for the new Label.
9. THE Classifier_Module SHALL provide `onShape(subscriber)` that registers a subscriber of Shape_Events and returns an unsubscribe function, in the same style as the VisionPipeline `onFrame`.
10. WHEN a subscriber calls its unsubscribe function, THE Classifier_Module SHALL stop delivering Shape_Events to that subscriber.
11. IF a subscriber throws while handling a Shape_Event, THEN THE Classifier_Module SHALL continue delivering the event to the remaining subscribers.

### Requirement 11: Property-Based Tests

**User Story:** As a developer, I want the debounce, split, and label logic covered by property-based tests, so that edge cases are found automatically.

#### Acceptance Criteria

1. THE test suite SHALL test each property in this requirement with fast-check, with at least 100 runs each, and SHALL tag each test with `// Feature: classifier, Property {number}: {property_text}`.
2. FOR ALL frame sequences, THE Debouncer SHALL fire no Shape_Event unless the sequence contains at least Stable_Frame_Count consecutive qualifying frames of the same Label.
3. FOR ALL frame sequences in which the top Label changes at least once in every window shorter than the Stable_Frame_Count, THE Debouncer SHALL fire no Shape_Event.
4. FOR ALL frame sequences, a frame with top Label `none` or confidence below the Confidence_Threshold SHALL reset the run, so that the next fire needs a further Stable_Frame_Count qualifying frames.
5. FOR ALL frame sequences, THE Debouncer SHALL fire exactly once within each unbroken Stable_Run of length at least Stable_Frame_Count.
6. FOR ALL frame sequences, each fired Shape_Event's label SHALL equal the Label of the Stable_Run that produced it.
7. FOR ALL generated Datasets with at least two Contributors, THE Split builder SHALL place no Contributor in both the Train_Split and the Test_Split and SHALL place no Burst in more than one Split.
8. FOR ALL seven Labels, mapping a Label to its Label_Index and back SHALL return the original Label.
9. FOR ALL Contributor_Registry states and all lists of new Contributor names, adding the new names SHALL leave every existing Contributor name's Contributor_ID unchanged (stable-ID property).
10. FOR ALL lists of Contributor names, assigning Contributor_IDs twice through the same Contributor_Registry SHALL return the same Contributor_ID for each existing name and SHALL NOT add entries on the second pass (idempotence and determinism); FOR ALL such lists, names that differ only by case or leading and trailing whitespace SHALL map to the same Contributor_ID, and the stored Display_Name for each Contributor_ID SHALL equal the first-seen name.
11. FOR ALL generated Datasets and Test_Contributor_IDs present in the Dataset, THE Split builder SHALL place exactly the Samples of the Test_Contributor_IDs in the Test_Split.
12. THE test suite SHALL include the export round-trip test defined in Requirement 7, criterion 8, as a required test.

### Requirement 12: Classifier Debug View

**User Story:** As a developer, I want a live readout of the classifier on the preview page, so that I can check predictions and events while casting shadows.

#### Acceptance Criteria

1. THE Classifier_Debug_View SHALL start hidden.
2. WHEN the user presses the C key, THE Classifier_Debug_View SHALL toggle its visibility.
3. WHILE the Classifier_Debug_View is visible, THE Classifier_Debug_View SHALL show the current top Label and its confidence, updated each frame.
4. WHILE the Classifier_Debug_View is visible, THE Classifier_Debug_View SHALL show a log of the most recent Shape_Events, with the log length defined in Config.
5. THE Classifier_Debug_View SHALL use the font and color of the FPS_Overlay style defined in Config.
6. WHILE focus is in a text input, THE Classifier_Debug_View SHALL ignore the C key.
7. WHILE the Classifier_Module is in the error state and the Classifier_Debug_View is visible, THE Classifier_Debug_View SHALL show the error message.
8. WHILE both overlays are visible, THE Classifier_Debug_View SHALL appear in a different corner from the FPS_Overlay so that neither hides the other.
