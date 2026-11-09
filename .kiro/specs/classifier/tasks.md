# Implementation Plan: Classifier

## Overview

This plan builds the Needalaata hand-shadow classifier in TypeScript (strict mode), following the approved design. Work is ordered so each step builds on the last and nothing is left unwired: first the code relocation and tooling, then the pure shared helpers and the debouncer (the logic most worth property-testing), then the offline training pipeline (backend, dataset, splits, models, evaluation, export, API, CLI), then the browser runtime (predictor, facade, debug view, wiring), and finally an end-to-end synthetic-data smoke test and docs.

The design has a Correctness Properties section (Properties 1 to 21), so property-test sub-tasks are included next to the code they check. Properties 1 to 8 are required by Requirement 11 and are NOT marked optional. Properties 9 to 21 and example/integration tests are marked optional with `*`. Each property is its own sub-task and its own test file, so tasks in the same wave never write to the same file.

Use the TensorFlow.js docs (Context7 `/websites/js_tensorflow_api`) before using any TF.js function not listed in the design. Do not write or run training on real `data/raw/` files that are not present; use synthetic data.

## Tasks

- [ ] 1. Relocation, tooling, and repository housekeeping
  - [ ] 1.1 Move FeatureExtractor and MaskGenerator into `src/vision/`
    - Use `smart_relocate` to move `tools/collect/feature-extractor.ts` and `tools/collect/mask-generator.ts`, and their `.test.ts` files, to `src/vision/` so imports update automatically
    - Change nothing in behavior or in test assertions; only import paths change
    - Confirm no top-level reference to `document` or `window` in either module (canvas creation stays inside `createMaskGenerator().generate()`); `btoa`/`atob` are used as globals
    - Re-export the extractor and mask APIs from `src/vision/index.ts`
    - Add `src/vision/shared-code.test.ts` (Node environment): imports `extractFeatures`, `encodeMask`, `decodeMask` and calls them; asserts `tools/collect/feature-extractor.ts` and `tools/collect/mask-generator.ts` no longer exist
    - Run `npm run typecheck` and `npm test`; all Spec 1 tests including fast-check Properties 1 to 12 must pass unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [ ] 1.2 Add dependencies, npm scripts, and TypeScript config for training
    - Add pinned exact versions: `@tensorflow/tfjs` 4.22.0 and `@tensorflow/tfjs-backend-wasm` 4.22.0 as dependencies; `@tensorflow/tfjs-node` 4.22.0 as an `optionalDependencies` entry; `tsx` as a dev dependency (latest verified version at install time, pinned exactly)
    - Add scripts `dataset:report`, `train`, `evaluate` pointing to `tsx training/cli/<name>.ts`
    - Add `training` to `tsconfig.json` `include`; keep strict flags
    - Note in the commit message why each new dependency was added (tfjs: model build/train/run; wasm: Node fallback backend; tfjs-node: optional native speedup; tsx: run TS scripts with the repo's extensionless imports)
    - Do not run `npm run train` yet; confirm `npm run typecheck` still passes
    - _Requirements: 8.1, 8.2, 8.3, 8.7_

  - [ ] 1.3 Update steering structure doc
    - Edit `.kiro/steering/structure.md`: replace `ml/` with `classifier/` in the `src/` tree and the Boundaries section, describe `training/` as TypeScript scripts, and add `data/raw/` (gitignored)
    - _Requirements: Design "Deviations from steering docs"_

  - [ ] 1.4 Update `.gitignore`
    - Add `data/raw/` and `training/out/`
    - Change `public/models/` handling so `public/models/hand_landmarker.task` stays ignored while `public/models/classifier/` is tracked (for example ignore `public/models/*` and add `!public/models/classifier/`); verify with `git check-ignore -v`
    - _Requirements: 2.14, 7.5_

- [ ] 2. Shared pure helpers in `src/classifier/`
  - [ ] 2.1 Implement `labels.ts`
    - `labelToIndex`, `indexToLabel` (throws `RangeError` outside 0..6), `LABEL_COUNT`, re-export `LABELS`
    - _Requirements: 11.8, Design "Shared pure helpers"_

  - [ ] 2.2 Write property test for label encoding
    - File: `src/classifier/labels.test.ts`
    - **Property 8: Label encoding round trip**
    - **Validates: Requirements 11.8**
    - fast-check, at least 100 runs, tag `// Feature: classifier, Property 8: ...`

  - [ ] 2.3 Implement `feature-vector.ts` and `mask-input.ts`
    - `FEATURE_VECTOR_LENGTH = 131`; `buildFeatureVector(ExtractedFeatures)` with layout slot0 normalized, slot1 normalized, two presence flags, three offset values; `maskToFloat` divides bytes by 255
    - _Requirements: 5.1, 5.2, 5.4_

  - [ ] 2.4 Write property test for feature vector layout
    - File: `src/classifier/feature-vector.test.ts`
    - **Property 9: Feature vector layout is fixed**
    - **Validates: Requirements 5.1, 5.2**
    - _Requirements: 5.1, 5.2_

  - [ ] 2.5 Implement `metadata.ts`
    - `ModelMetadata`, `parseModelMetadata` (reject label mismatch, unknown input type, shape/type mismatch, non-finite accuracy, with named `MetadataError` reasons), `serializeModelMetadata`
    - _Requirements: 7.2, 9.9_

  - [ ] 2.6 Write property test for metadata round trip
    - File: `src/classifier/metadata.test.ts`
    - **Property 17: Model metadata round trip**
    - **Validates: Requirements 7.2, 9.9**

- [ ] 3. Debounced shape events
  - [ ] 3.1 Add classifier section to `src/config.ts`
    - Extend `Config` with `classifier: { modelPath, metadataPath, stableFrames: 24, confidenceThreshold: 0.85, inferenceBudgetMs: 15, eventLogSize: 5, debugOverlay: { corner: 'tl' } }`; leave existing keys unchanged
    - _Requirements: 9.7, 10.1, 12.4, 12.8_

  - [ ] 3.2 Implement `debouncer.ts`
    - `createDebouncer({stableFrames, confidenceThreshold})` with `push(top, confidence, timestamp)`, `reset()`, and read-only `state`, following the five rules in the design; `none` or low confidence resets; a different qualifying label starts a new run of length one; fire exactly when length first reaches N
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8_

  - [ ] 3.3 Write property test for minimum run length
    - File: `src/classifier/debouncer.min-run.test.ts`; also create the shared generator `src/classifier/test-support/frame-sequences.ts` (arrays of `{label, confidence, timestamp}`, `stableFrames` in 2..30, biased toward long runs, threshold-exact confidences, and `none` frames)
    - **Property 1: No fire without a long enough run**
    - **Validates: Requirements 10.2, 11.2**

  - [ ] 3.4 Write property test for rapid alternation
    - File: `src/classifier/debouncer.alternation.test.ts`
    - **Property 2: Rapid alternation never fires**
    - **Validates: Requirements 10.8, 11.3**

  - [ ] 3.5 Write property test for run reset
    - File: `src/classifier/debouncer.reset.test.ts`
    - **Property 3: `none` and low-confidence frames reset the run**
    - **Validates: Requirements 10.6, 10.7, 11.4**

  - [ ] 3.6 Write property test for single fire per run
    - File: `src/classifier/debouncer.single-fire.test.ts`
    - **Property 4: Exactly one fire per unbroken stable run**
    - **Validates: Requirements 10.4, 10.5, 11.5**

  - [ ] 3.7 Write property test for event content
    - File: `src/classifier/debouncer.event-content.test.ts`
    - **Property 5: Fired event matches its run**
    - **Validates: Requirements 10.3, 11.6**

- [ ] 4. Training configuration and backend selection
  - [ ] 4.1 Implement `training/training-config.ts` and `training/logger.ts`
    - Single exported config object with the fields in the design (seed, paths, dataset thresholds 250 and 0.5, split fractions, augmentation, MLP and CNN hyperparameters, evaluation target 0.90 and tie margin 1 point, export limits 5 MiB and reload tolerance)
    - `Logger` interface plus a console logger and a silent logger
    - _Requirements: 3.5, 3.6, 5.5, 6.6, 6.7, 7.3, 8.9_

  - [ ] 4.2 Implement `training/backend.ts`
    - Pure `chooseBackend(results, requested?)` with preference order `tfjs-node`, `wasm`, `cpu`, fallback reasons, and `BackendUnavailableError`
    - Real probes: dynamic `import('@tensorflow/tfjs-node')` in try/catch, `tf.setBackend('tensorflow')`, `tf.ready()`, then a smoke operation (`tf.tidy(() => tf.ones([2]).sum().dataSync())`); `import('@tensorflow/tfjs-backend-wasm')` with `tf.setBackend('wasm')`; `tf.setBackend('cpu')`
    - `initBackend(requested?, logger?)` reads `TRAIN_BACKEND`, logs the chosen backend and each fallback reason
    - On this machine (macOS arm64, Node v26.13.0) `tfjs-node` is expected to fail the smoke operation; record the actual result in `KIRO_LOG.md`
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6_

  - [ ]* 4.3 Write property test for backend choice
    - File: `training/backend.test.ts`
    - **Property 16: Backend choice follows preference order**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**

- [ ] 5. Dataset loading, validation, and report
  - [ ] 5.1 Implement dataset loader and validator
    - `training/dataset/validator.ts` (pure, per file, never throws) and `training/dataset/loader.ts` (reads `data/raw/*.json` or named files); define `ClassifierSample` and `LoadReport`
    - Check `schemaVersion` against `SCHEMA_VERSION` from `tools/collect/exporter.ts` (verify that module imports in Node), `labels` against `LABELS`, mask size 96x96; per sample use production `decodeMask`, landmark counts, finite numbers, burst id and contributor present; skip bad samples with reasons; dedupe ids keeping the first
    - Rebuild the `FrameResult` from stored raw landmarks, frame size, handedness, and score; run the shared `extractFeatures` and `buildFeatureVector`; compare with stored normalized landmarks and add a warning above the tolerance
    - Throw `NoValidSamplesError` with the load report when nothing is valid
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 8.10_

  - [ ]* 5.2 Write property test for validation partitioning
    - File: `training/dataset/validator.partition.test.ts`
    - **Property 10: Validation partitions every sample and never throws**
    - **Validates: Requirements 2.6, 2.7, 2.8, 2.12**

  - [ ]* 5.3 Write property test for rebuilt features
    - File: `training/dataset/validator.rebuild.test.ts`
    - **Property 11: Rebuilt features equal live features**
    - **Validates: Requirements 2.9, 2.10, 8.10**

  - [ ] 5.4 Implement dataset report and contributor IDs
    - `training/dataset/report.ts`: `assignContributorIds` (sorted ascending, `C1..Cn`), `buildDatasetReport`, `formatDatasetReport`; per-label sample and burst counts, per-contributor per-label counts, warnings for low counts and dominant contributor, split summary; never emit names
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ]* 5.5 Write property test for report counts
    - File: `training/dataset/report.counts.test.ts`
    - **Property 12: Dataset report counts are consistent**
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.6**

  - [ ]* 5.6 Write property test for contributor IDs
    - File: `training/dataset/report.contributors.test.ts`
    - **Property 13: Contributor IDs are stable and anonymising**
    - **Validates: Requirements 3.3, 3.4**

  - [ ]* 5.7 Write loader example tests
    - File: `training/dataset/loader.test.ts`; temp directory with a valid file, a wrong-version file, a garbage file, a non-JSON file; empty folder error; rebuild-tolerance warning with tampered normalized landmarks
    - _Requirements: 2.1, 2.2, 2.5, 2.11, 2.13_

- [ ] 6. Leak-free splitting and augmentation
  - [ ] 6.1 Implement `training/split.ts`
    - `buildSplits(samples, cfg, seed)` with `mulberry32`, sort-then-shuffle for order independence, whole-contributor test hold-out (at least one, always leaving one for training), whole-burst validation per label, `InsufficientContributorsError` for fewer than two contributors, warnings for labels missing from test
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ] 6.2 Write property test for leak-free splits
    - File: `training/split.leak-free.test.ts`; generator builds datasets with 2 to 8 contributors, bursts, and all seven labels
    - **Property 6: Splits are leak-free**
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.9, 11.7**

  - [ ]* 6.3 Write property test for split determinism
    - File: `training/split.determinism.test.ts`
    - **Property 7: Splits are deterministic and order-independent**
    - **Validates: Requirements 4.5**

  - [ ] 6.4 Implement `training/augment.ts`
    - Seeded augmentation: MLP path jitters and rotates raw landmarks then re-runs the shared `extractFeatures` and `buildFeatureVector`; CNN path shifts and scales the 96x96 mask; export a function that is only called for training-split samples
    - _Requirements: 4.10, 5.5_

  - [ ]* 6.5 Write split and augmentation example tests
    - File: `training/split.test.ts`; one-contributor error; label-missing-from-test warning; spy test that validation and test samples are never augmented
    - _Requirements: 4.7, 4.8, 4.10_

- [ ] 7. Models and training loop
  - [ ] 7.1 Implement model builders
    - `training/models/mlp.ts` (131 to Dense 128, Dense 64, softmax 7) and `training/models/cnn.ts` (96x96x1, Conv2D stride 2, three `separableConv2d` blocks with batch normalization, global average pooling, dropout, softmax 7); seed every initializer with `tf.initializers.glorotUniform({seed})` and every dropout with `seed`; hyperparameters from the training config
    - Confirm `separableConv2d`, `batchNormalization`, and `globalAveragePooling2d` argument names against the TF.js docs before use
    - _Requirements: 5.1, 5.3, 5.5, 5.6_

  - [ ] 7.2 Implement training data preparation and loop
    - `training/train.ts`: build tensors inside `tf.tidy`; per-epoch seeded shuffle; `model.fit` one epoch at a time with `shuffle: false`; evaluate validation each epoch; manual early stopping with a cloned best-weights snapshot restored at the end; dispose all tensors; never receive the test split
    - _Requirements: 5.5, 5.6, 5.7, 5.8_

  - [ ]* 7.3 Write training example tests
    - File: `training/train.test.ts`; tiny synthetic dataset on the CPU backend; builders have the expected input and output shapes and the CNN contains a separable convolution; same seed gives equal initial and final weights within tolerance; `tf.memory().numTensors` unchanged apart from model weights; `fit` never sees test data
    - _Requirements: 5.1, 5.3, 5.6, 5.7, 5.8_

- [ ] 8. Evaluation, selection, and export
  - [ ] 8.1 Implement metrics and evaluation adapter
    - `training/metrics.ts` (pure): `evaluatePredictions`, `formatEvaluationReport`; 7x7 confusion matrix, accuracy, per-label precision and recall (`null` when undefined), misclassified list, most-confused pairs, `targetMet`
    - `training/evaluate.ts`: run `model.predict` inside `tf.tidy`, take argmax and max probability, build predictions; measure inference time per sample
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 6.8_

  - [ ]* 8.2 Write property test for metrics
    - File: `training/metrics.property.test.ts`
    - **Property 14: Confusion matrix and metrics are consistent**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.7, 6.8, 8.9**

  - [ ] 8.3 Implement `training/select.ts`
    - `selectModel(a, b, tieMarginPoints)` returning `{chosen, reason}`: higher accuracy beyond the margin, else smaller export size, else lower inference time, else MLP
    - _Requirements: 6.5, 6.6, 6.9_

  - [ ]* 8.4 Write property test for model selection
    - File: `training/select.test.ts`
    - **Property 15: Model selection follows the rule**
    - **Validates: Requirements 6.5, 6.6**

  - [ ] 8.5 Implement `training/export.ts`
    - Capture artifacts with `tf.io.withSaveHandler`, write `model.json` (with `weightsManifest`), `weights.bin`, and `metadata.json` to `public/models/classifier/` with one writer for all backends; fail above 5 MiB; reload from disk through a file IOHandler with `tf.loadLayersModel` and compare predictions within tolerance; return file list, byte total, and max difference
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

  - [ ]* 8.6 Write export example tests
    - File: `training/export.test.ts`; tiny model into a temp directory, expected files exist, size under the limit, reload matches; oversize model is rejected
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6_

- [ ] 9. Training API and CLI
  - [ ] 9.1 Implement `training/api.ts`
    - Export `getDatasetStats`, `makeSplits`, `trainCandidate`, `evaluateCandidate`, `getConfusionMatrix`, `getMisclassified`, `runTraining`, `runEvaluation`; accept an injected `Logger`; return plain JSON-serializable results; no `process.exit`, no direct console use; `runTraining` writes JSON reports to `training/out/`, reports whether the accuracy target was met, and exports the selected model
    - _Requirements: 6.9, 8.8, 8.9, 8.10_

  - [ ] 9.2 Implement CLI entry points
    - `training/cli/dataset-report.ts`, `train.ts`, `evaluate.ts`: parse `--backend`, `--seed`, `--files`; call the API; print the readable summaries; set `process.exitCode` on error; support `--help`
    - _Requirements: 8.5, 8.7_

  - [ ]* 9.3 Write API example tests
    - File: `training/api.test.ts`; results survive `JSON.parse(JSON.stringify(x))` unchanged; API never calls `process.exit`; logger is injectable
    - _Requirements: 8.8, 8.9_

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Browser runtime predictor and facade
  - [ ] 11.1 Implement `src/classifier/tf.ts`, `types.ts`, and `predictor.ts`
    - `tf.ts` is the only browser module importing `@tensorflow/tfjs`; `types.ts` holds `Prediction`, `ShapeEvent`, `ClassifierState`, `LayersModelLike`
    - `createPredictor`: no hands returns `none` with `modelRan: false` and never touches the model; MLP path uses the shared `extractFeatures` and `buildFeatureVector`; CNN path uses the shared mask generator and `maskToFloat`; inference inside `tf.tidy`; measure inference time
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.7_

  - [ ]* 11.2 Write property test for no-hands behavior
    - File: `src/classifier/predictor.no-hands.test.ts`
    - **Property 18: No hands means `none` without running the model**
    - **Validates: Requirements 9.4**

  - [ ]* 11.3 Write property test for prediction distributions and tensor leaks
    - File: `src/classifier/predictor.distribution.test.ts`; tiny fixture models for MLP and CNN input types on the CPU backend
    - **Property 19: Predictions are distributions and leak no tensors**
    - **Validates: Requirements 9.3, 9.5**

  - [ ] 11.4 Implement `src/classifier/classifier.ts` and `index.ts`
    - `startClassifier(pipeline, deps?)`: fetch and validate metadata, `tf.loadLayersModel(config.classifier.modelPath)`, warm-up; any failure yields the error state without throwing; `onFrame` handler wraps predict and debounce in try/catch; `onShape` and `onPrediction` return unsubscribe functions; per-subscriber try/catch; `stop()` unsubscribes from the pipeline and disposes the model
    - _Requirements: 9.1, 9.8, 9.9, 9.10, 9.11, 10.9, 10.10, 10.11_

  - [ ]* 11.5 Write property test for subscriptions
    - File: `src/classifier/classifier.subscriptions.test.ts`
    - **Property 20: Subscriptions behave like a set**
    - **Validates: Requirements 10.9, 10.10, 10.11**

  - [ ]* 11.6 Write facade example tests
    - File: `src/classifier/classifier.test.ts`; failing loader gives the error state; label-mismatch metadata gives the error state; throwing predictor skips a frame and continues; `stop()` unsubscribes and disposes
    - _Requirements: 9.8, 9.9, 9.10, 9.11_

- [ ] 12. Debug view and page wiring
  - [ ] 12.1 Implement `src/classifier/debug-view.ts`
    - `createClassifierDebugView(canvas)` mirroring `FpsOverlay`: hidden by default, C toggles (ignore key repeat, modifiers, and input focus), draws on the preview canvas using `config.fpsOverlayStyle` font and color in `config.classifier.debugOverlay.corner`; shows top label, confidence, inference ms, last K events, or the error message; export pure `formatPrediction` and `takeLastEvents`
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [ ]* 12.2 Write property test for the event log
    - File: `src/classifier/debug-view.log.test.ts`
    - **Property 21: Debug event log keeps the most recent events**
    - **Validates: Requirements 12.4**

  - [ ] 12.3 Wire the classifier into `src/main.ts`
    - After creating the pipeline, start the classifier without blocking `pipeline.start()`; call `debugView.draw()` after `fps.update`; feed `onPrediction` to `debugView.update` and `onShape` to `debugView.logEvent`; a classifier error must leave the preview running
    - _Requirements: 9.6, 9.8, 12.3, 12.4, 12.7_

  - [ ]* 12.4 Write debug view example tests
    - File: `src/classifier/debug-view.test.ts`; hidden by default; C toggles; C ignored in an input; uses FPS font and color; error message shown; `config.classifier.debugOverlay.corner` differs from the FPS corner; `config.classifier.stableFrames` and `confidenceThreshold` are defined
    - _Requirements: 10.1, 12.1, 12.2, 12.5, 12.6, 12.7, 12.8_

- [ ] 13. End-to-end verification and docs
  - [ ]* 13.1 Write end-to-end synthetic pipeline test
    - File: `training/pipeline.e2e.test.ts`; generate a small synthetic export (several contributors, bursts, all labels) into a temp `data/raw`-style folder, run `runTraining` on the CPU backend with a few epochs into a temp export folder, check reports exist, selection reason is present, exported files load through `startClassifier`-style loading, and no names appear in outputs
    - _Requirements: 2.1, 3.4, 4.1, 6.9, 7.1, 7.2, 7.4, 9.1_

  - [ ] 13.2 Document training and the debug view
    - README section: place exports in `data/raw/` (never committed), run `npm run dataset:report`, `npm run train`, `npm run evaluate`; backend order and the Node 26 `tfjs-node` finding (including `npm rebuild @tensorflow/tfjs-node` for install scripts); press C for the classifier overlay
    - `KIRO_LOG.md`: record the Spec 2 steps, the backend probe result on this machine, and the performance smoke result for inference time and FPS once a real model exists
    - _Requirements: 2.14, 8.2, 8.3, 8.7, 9.6, 9.7, 12.2_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Properties 1 to 8 are required by Requirement 11 and are not optional.
- Each task references specific requirement sub-IDs for traceability.
- Property tests use fast-check with at least 100 runs each and are tagged `// Feature: classifier, Property {number}: {property_text}`.
- Do not edit assertions of existing Spec 1 tests; only their import paths change in task 1.1.
- Real accuracy depends on data collected with the Spec 1 collector. Until `data/raw/` has real exports, verify the pipeline with synthetic data only.
- Never print or commit contributor names; reports use `C1`, `C2`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.5", "3.2", "4.2"] },
    { "id": 3, "tasks": ["2.4", "2.6", "3.3", "4.3", "5.1", "7.1", "8.1", "11.1"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6", "3.7", "5.2", "5.3", "5.4", "5.7", "6.1", "6.4", "8.2", "8.3", "8.5", "11.2", "11.3", "11.4", "12.1"] },
    { "id": 5, "tasks": ["5.5", "5.6", "6.2", "6.3", "6.5", "7.2", "8.4", "8.6", "11.5", "11.6", "12.2", "12.3", "12.4"] },
    { "id": 6, "tasks": ["7.3", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3"] },
    { "id": 8, "tasks": ["13.1", "13.2"] }
  ]
}
```
