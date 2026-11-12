# Implementation Plan: Classifier

## Overview

This plan builds the Needalaata hand-shadow classifier in TypeScript (strict mode), following the approved design. Work is ordered so each step builds on the last and nothing is left unwired: first the code relocation, tooling, repository hygiene, and an early TF.js check; then the pure shared helpers and the debouncer (the logic most worth property-testing); then the offline training pipeline (backend, dataset, contributor registry, splits, seeded models, evaluation, export, API, CLI); then the browser runtime (predictor, facade, debug view, wiring); and finally an end-to-end synthetic-data smoke test and docs.

The design has a Correctness Properties section (Properties 1 to 25), so property-test sub-tasks are included next to the code they check. Properties 1 to 11 are required by Requirement 11 and are NOT marked optional: debouncer (1 to 5), splits (6, 7, 11), label encoding (8), and contributor IDs (9, 10). The export round-trip test (Requirement 7.8, 11.12) and the repository hygiene test (1.5) are also required; they are example tests, not properties. Properties 12 to 25 and all other example/integration tests, including the seeding test (7.4) and the README content test (13.3), are marked optional with `*`. Dropout layers are deliberately unseeded (Requirement 5.11), so dropout is the one source of run-to-run variation: same-seed runs match in initial weights but not necessarily in final weights. Each property is its own sub-task and its own test file, so tasks in the same wave never write to the same file.

Use the TensorFlow.js docs (Context7 `/websites/js_tensorflow_api`) before using any TF.js function not listed in the design. Do not run training on real `data/raw/` files that are not present; use synthetic data. This plan adds no new runtime features: the `none` guidance (`NONE_GUIDANCE`) is dataset and documentation text only.

## Tasks

- [x] 1. Relocation, tooling, repository housekeeping, and early checks
  - [x] 1.1 Move FeatureExtractor and MaskGenerator into `src/vision/`
    - Use `smart_relocate` to move `tools/collect/feature-extractor.ts` and `tools/collect/mask-generator.ts`, and their `.test.ts` files, to `src/vision/` so imports update automatically
    - Change nothing in behavior or in test assertions; only import paths change
    - Confirm no top-level reference to `document` or `window` in either module (canvas creation stays inside `createMaskGenerator().generate()`); `btoa`/`atob` are used as globals
    - Re-export the extractor and mask APIs from `src/vision/index.ts`
    - Add `src/vision/shared-code.test.ts` (Node environment): imports `extractFeatures`, `encodeMask`, `decodeMask` and calls them; asserts `tools/collect/feature-extractor.ts` and `tools/collect/mask-generator.ts` no longer exist
    - Run `npm run typecheck` and `npm test`; all Spec 1 tests including fast-check Properties 1 to 12 must pass unchanged
    - _Requirements: 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 1.2 Add dependencies, npm scripts, and TypeScript/test config for training
    - Add pinned exact versions: `@tensorflow/tfjs` 4.22.0 and `@tensorflow/tfjs-backend-wasm` 4.22.0 as dependencies; `@tensorflow/tfjs-node` 4.22.0 as an `optionalDependencies` entry; `tsx` as a dev dependency (latest verified version at install time, pinned exactly)
    - Add scripts `dataset:report`, `train`, `evaluate` pointing to `tsx training/cli/<name>.ts`
    - Add `training` to `tsconfig.json` `include`; keep strict flags; make sure the vitest `include` covers `training/**/*.test.ts` and `src/classifier/**/*.test.ts`
    - Do NOT add an `engines` field to `package.json` and do NOT create an `.nvmrc` (Requirement 8.13)
    - Note in the commit message why each new dependency was added (tfjs: model build/train/run; wasm: Node fallback backend; tfjs-node: optional native speedup; tsx: run TS scripts with the repo's extensionless imports)
    - Do not run `npm run train` yet; confirm `npm run typecheck` still passes
    - _Requirements: 8.1, 8.2, 8.3, 8.7, 8.13_

  - [x] 1.3 Update steering structure doc
    - Edit `.kiro/steering/structure.md`: replace `ml/` with `classifier/` in the `src/` tree and the Boundaries section, describe `training/` as TypeScript scripts, and add `data/raw/` and `data/contributors.json` (both gitignored)
    - _Requirements: Design "Deviations from steering docs"_

  - [x] 1.4 Update `.gitignore` with the exact rules from the design
    - Read the current `.gitignore` first. The final file must contain exactly these lines (no trailing comments, because `#` after a pattern is part of the pattern):
      ```
      node_modules/
      dist/
      .DS_Store
      .env
      public/wasm/
      public/models/*
      !public/models/classifier/
      data/raw/
      data/contributors.json
      training/out/
      ```
    - The only changed line is `public/models/` becoming `public/models/*`; a negation after a directory rule would have no effect, because git cannot re-include a file whose parent directory is ignored
    - Verify with `git check-ignore -v`: `public/models/hand_landmarker.task`, `public/wasm/vision_wasm_internal.js`, `data/raw/example.json`, `data/contributors.json`, and `training/out/report.json` are ignored (exit 0); `public/models/classifier/model.json`, `weights.bin`, and `metadata.json` are not ignored (exit 1, no output)
    - Also verify that `.kiro/specs/classifier/design.md`, `.kiro/steering/product.md`, and `.kiro/settings/mcp.json` are not ignored (`git check-ignore` exit 1), so `/.kiro` and its subfolders are never ignored
    - _Requirements: 2.14, 7.5, 7.7_

  - [x] 1.5 Write repository hygiene test
    - File: `training/repo-hygiene.test.ts` (Node environment, required so the ignore rules and the no-pinning rule cannot regress)
    - Run `execFileSync('git', ['check-ignore', '-q', path])` and assert exit code 0 for `public/models/hand_landmarker.task`, `public/wasm/`, `data/raw/example.json`, `data/contributors.json`, `training/out/report.json`, and exit code 1 for `public/models/classifier/model.json`, `public/models/classifier/weights.bin`, `public/models/classifier/metadata.json`
    - Assert exit code 1 (not ignored) for `.kiro/specs/classifier/design.md`, `.kiro/steering/product.md`, and `.kiro/settings/mcp.json`, so `/.kiro` and its subfolders can never be ignored
    - Assert `package.json` has no `engines` field and no `.nvmrc` file exists in the repository root
    - _Requirements: 2.14, 7.5, 7.7, 8.13_

  - [x] 1.6 Early check: `loadLayersModel(url, { fetchFunc })` in Node with a fake fetch
    - File: `training/export.fetch-loader.test.ts` (CPU backend, Node environment)
    - Save a tiny seeded model with `tf.io.withSaveHandler` into captured artifacts, write `model.json` (`modelTopology`, `format`, `generatedBy`, `convertedBy`, `weightsManifest: [{ paths: ['weights.bin'], weights: weightSpecs }]`) and `weights.bin` to a temp directory by hand, then call `tf.loadLayersModel('http://localhost/models/classifier/model.json', { fetchFunc })` where `fetchFunc` serves both files from the temp directory
    - Assert predictions on fixed inputs match the in-memory model within tolerance
    - Record the outcome in `KIRO_LOG.md` (works / does not work). If it does not work, the documented fallback applies in task 8.5: parse `model.json` and use `tf.io.getWeightSpecs`, `tf.io.getModelArtifactsForJSONSync`, and `tf.io.fromMemory`, and record that the HTTP path-resolution step is then not exercised
    - _Requirements: 7.4, 7.8_

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

  - [ ]* 2.4 Write property test for feature vector layout
    - File: `src/classifier/feature-vector.test.ts`
    - **Property 13: Feature vector layout is fixed**
    - **Validates: Requirements 5.1, 5.2**

  - [ ] 2.5 Implement `metadata.ts`
    - `ModelMetadata`, `parseModelMetadata` (reject label mismatch, unknown input type, shape/type mismatch, non-finite accuracy, with named `MetadataError` reasons), `serializeModelMetadata`
    - _Requirements: 7.2, 9.9_

  - [ ]* 2.6 Write property test for metadata round trip
    - File: `src/classifier/metadata.test.ts`
    - **Property 21: Model metadata round trip**
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
    - Single exported config object with the fields in the design: `seed` (Training_Seed), `paths` (including `contributorRegistry: 'data/contributors.json'`), dataset thresholds 250 and 0.5 and `rebuildTolerance`, `split` (`testContributorIds: ['C1']`, `seed` as Split_Seed, `validationBurstFraction`), augmentation, MLP and CNN hyperparameters, evaluation target 0.90 and tie margin 1 point, export limits 5 MiB and `reloadTolerance`
    - `Logger` interface plus a console logger and a silent logger
    - _Requirements: 3.5, 3.6, 4.2, 5.5, 6.6, 6.7, 7.3, 7.4, 8.9_

  - [ ] 4.2 Implement `training/backend.ts`
    - Pure `chooseBackend(results, requested?)` with preference order `tfjs-node`, `wasm`, `cpu`, fallback reasons, and `BackendUnavailableError`
    - Real probes: dynamic `import('@tensorflow/tfjs-node')` in try/catch, `tf.setBackend('tensorflow')`, `tf.ready()`, then a smoke operation (`tf.tidy(() => tf.ones([2]).sum().dataSync())`); `import('@tensorflow/tfjs-backend-wasm')` with `tf.setBackend('wasm')`; `tf.setBackend('cpu')`
    - `initBackend(requested?, logger?)` reads `TRAIN_BACKEND`, logs the chosen backend and each fallback reason, and returns a `BackendChoice` whose text the `train` CLI prints (task 9.2)
    - On this machine (macOS arm64, Node v26.13.0) `tfjs-node` is expected to fail the smoke operation; record the actual result in `KIRO_LOG.md`. The README (task 13.2) documents Node 22 LTS as the version that should enable `tfjs-node`, marked unverified; do not add `engines` or `.nvmrc`
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.6, 8.12, 8.13_

  - [ ]* 4.3 Write property test for backend choice
    - File: `training/backend.test.ts`
    - **Property 20: Backend choice follows preference order**
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5**

- [ ] 5. Dataset loading, contributor registry, and report
  - [ ] 5.1 Implement dataset types, loader, and validator
    - `training/dataset/types.ts`: `LoadReport`, `LoadedSample` (carries `contributorName`), `ClassifierSample` (carries `contributorId` only, never a name)
    - `training/dataset/validator.ts` (pure, per file, never throws) and `training/dataset/loader.ts` (reads `data/raw/*.json` or named files)
    - Check `schemaVersion` against `SCHEMA_VERSION` from `tools/collect/exporter.ts` (verify that module imports in Node), `labels` against `LABELS`, mask size 96x96; per sample use production `decodeMask`, landmark counts, finite numbers, burst id present, and a contributor name that is non-empty after `normaliseName` (empty or whitespace-only names are skipped with the reason "missing contributor name"); skip bad samples with reasons; dedupe ids keeping the first
    - Rebuild the `FrameResult` from stored raw landmarks, frame size, handedness, and score; run the shared `extractFeatures` and `buildFeatureVector`; compare with stored normalized landmarks and add a warning above the tolerance
    - Throw `NoValidSamplesError` with the Raw_Data_Folder path and the load report when nothing is valid
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11, 2.12, 2.13, 8.10_

  - [ ]* 5.2 Write property test for validation partitioning
    - File: `training/dataset/validator.partition.test.ts`
    - **Property 14: Validation partitions every sample and never throws**
    - **Validates: Requirements 2.6, 2.7, 2.8, 2.12**

  - [ ]* 5.3 Write property test for rebuilt features
    - File: `training/dataset/validator.rebuild.test.ts`
    - **Property 15: Rebuilt features equal live features**
    - **Validates: Requirements 2.9, 2.10, 8.10**

  - [ ] 5.4 Implement the contributor registry in `training/dataset/contributors.ts`
    - Types and constants: `ContributorRegistry` (`{ version: 1, contributors: { name, id }[] }`, where `name` is the Display_Name), `EMPTY_REGISTRY`, `ContributorRegistryError` (carries `file` and `problem`), `InvalidContributorNameError`
    - Export `normaliseName(name)` exactly as defined in the design: `name.trim().toLowerCase().normalize('NFC')` (not `toLocaleLowerCase`); the Normalised_Name is computed on the fly and not stored
    - Pure `assignContributorIds(names, existingRegistry)`: copy existing entries unchanged and in order (Display_Name never changes); normalise every input name and throw `InvalidContributorNameError` before returning anything if a name normalises to the empty string; group inputs by Normalised_Name; a group whose key is already present keeps its ID and stored Display_Name; for each new key store the smallest trimmed spelling in UTF-16 code unit order (not `localeCompare`) as the Display_Name; sort new keys by plain UTF-16 order; the k-th new key gets `C{n+k}` where n is the highest existing number (0 when empty); never mutates inputs
    - `loadContributorRegistry(path)`: missing file returns `EMPTY_REGISTRY` without writing; unreadable file, invalid JSON, wrong shape or version, ID not matching `^C[1-9][0-9]*$`, duplicate ID, a name that is empty after trimming, or two entries with the same Normalised_Name throws `ContributorRegistryError` naming the file and the problem, and never writes
    - `saveContributorRegistry(path, registry)`: writes only when the registry has entries the file lacks; write to a temp file in the same folder, then rename over the target
    - `resolveContributors(samples, path)`: load first, then assign, then save if changed, then map `LoadedSample` to `ClassifierSample` with `contributorId` and drop the names; return the registry and the added IDs
    - _Requirements: 3.3, 3.4, 3.8, 3.9, 3.10, 3.13, 3.14_

  - [ ] 5.5 Write property test for stable contributor IDs
    - File: `training/dataset/contributors.stable-ids.test.ts`; generate registries by folding `assignContributorIds` over name lists drawn from a small alphabet so collisions and out-of-order names are common; the generator also produces case variants and leading/trailing whitespace variants of the same name, and excludes names that are empty after trimming
    - **Property 9: Adding contributors never changes existing IDs**
    - **Validates: Requirements 3.3, 3.8, 11.9**
    - fast-check, at least 100 runs, tag `// Feature: classifier, Property 9: ...`

  - [ ] 5.6 Write property test for idempotent, deterministic assignment
    - File: `training/dataset/contributors.idempotent.test.ts`
    - **Property 10: Contributor ID assignment is idempotent and deterministic**
    - Also covers: names differing only by case or leading/trailing whitespace map to one Contributor_ID, and the stored Display_Name is stable (unchanged by later calls with other variants; independent of input order and duplicates within a batch)
    - **Validates: Requirements 3.3, 3.8, 3.13, 3.14, 11.10**
    - fast-check, at least 100 runs, tag `// Feature: classifier, Property 10: ...`

  - [ ]* 5.7 Write contributor registry example tests
    - File: `training/dataset/contributors.test.ts` (temp directory)
    - Missing file is created with `C1` for the first sorted new name; corrupt JSON, duplicate ID, two entries with the same Normalised_Name (for example "Alice" and " alice"), an empty-after-trim name, and bad ID format each throw `ContributorRegistryError` and the file's bytes are identical before and after; a second run with the same names writes nothing; a new name that sorts before existing names gets the next number and no existing ID moves; "Alice" and " alice " map to one ID and the first-seen Display_Name is kept; `{"alice","Alice"}` in one batch stores "Alice"; `normaliseName` handles NFC vs decomposed accents and non-ASCII case; `assignContributorIds` throws `InvalidContributorNameError` for an empty or whitespace-only name; `resolveContributors` output contains no name; an interrupted save leaves the previous file intact
    - _Requirements: 3.3, 3.4, 3.8, 3.9, 3.10, 3.13, 3.14_

  - [ ] 5.8 Implement dataset report in `training/dataset/report.ts`
    - Export the `NONE_GUIDANCE` constant, with the exact text from the design ("Label guidance for `none`: include a pointing index finger and a relaxed open hand. Later specs use these poses to point and to puppeteer, so they must classify as `none`, not as a shadow shape."); this is design-only guidance, no new runtime behavior
    - `buildDatasetReport` (per-label sample and burst counts, per-Contributor_ID per-label counts keyed `C1`, `C2`, warnings for low counts and dominant contributor, optional split summary with seed, `testContributorIds`, and per-split contributor IDs and counts, `noneGuidance` set to `NONE_GUIDANCE`, the load report) and `formatDatasetReport` (readable text that notes IDs come from `data/contributors.json` and ends with `NONE_GUIDANCE`)
    - Work only from `ClassifierSample`, so names cannot appear; use IDs from the registry, not any local numbering
    - _Requirements: 3.1, 3.2, 3.4, 3.5, 3.6, 3.7, 3.11, 3.12, 4.10_

  - [ ]* 5.9 Write property test for report counts
    - File: `training/dataset/report.counts.test.ts`
    - **Property 16: Dataset report counts are consistent**
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.6**

  - [ ]* 5.10 Write property test for name anonymity
    - File: `training/dataset/report.names.test.ts`; build reports from samples resolved through `resolveContributors` (temp registry); exclude names that are too short or equal to JSON syntax from the generator
    - **Property 17: Reports and logs contain no contributor names**
    - **Validates: Requirements 3.4**

  - [ ]* 5.11 Write loader example tests
    - File: `training/dataset/loader.test.ts`; temp directory with a valid file, a wrong-version file, a garbage file, a non-JSON file; empty folder error; rebuild-tolerance warning with tampered normalized landmarks
    - _Requirements: 2.1, 2.2, 2.5, 2.11, 2.13_

  - [ ]* 5.12 Write report guidance example test
    - File: `training/dataset/report.test.ts`; the readable summary and the JSON both contain `NONE_GUIDANCE`; the readable summary ends with it
    - _Requirements: 3.11, 3.12_

- [ ] 6. Leak-free splitting and augmentation
  - [ ] 6.1 Implement `training/split.ts`
    - `buildSplits(samples, cfg)` reads `split.testContributorIds`, `split.seed`, and `split.validationBurstFraction`; named errors `EmptyTestContributorsError`, `InsufficientContributorsError`, `MissingTestContributorsError` (names the missing IDs and lists the IDs present), `NoTrainContributorsError`, checked in that order after deduplicating the configured IDs
    - Test split is exactly the samples of the configured IDs (no sorting, shuffling, or fraction to choose test contributors); validation is whole bursts per label chosen with `mulberry32(Split_Seed)` after sorting by `(contributorId, burstId)`, keeping at least one burst per label in train; group key includes the contributor; warnings for labels missing from test; result carries `testContributorIds`, per-split contributor IDs, seed, and warnings (IDs only)
    - Do not choose test contributors in any other way anywhere in the pipeline
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11, 4.12, 4.13_

  - [ ] 6.2 Write property test for leak-free splits
    - File: `training/split.leak-free.test.ts`; generator builds datasets with 2 to 8 contributors, bursts, and all seven labels, and picks valid configured test IDs
    - **Property 6: Splits are leak-free**
    - **Validates: Requirements 4.1, 4.6, 4.7, 4.8, 4.13, 11.7**

  - [ ] 6.3 Write property test for split determinism
    - File: `training/split.determinism.test.ts`
    - **Property 7: Splits are deterministic and order-independent**
    - **Validates: Requirements 4.9**

  - [ ] 6.4 Write property test for exact test-contributor membership
    - File: `training/split.test-contributors.test.ts`; generate datasets with several contributors and choose the ID list as a random non-empty proper subset
    - **Property 11: Test split is exactly the configured contributors**
    - **Validates: Requirements 4.2, 4.6, 11.11**
    - fast-check, at least 100 runs, tag `// Feature: classifier, Property 11: ...`

  - [ ]* 6.5 Write property test for invalid test-ID configurations
    - File: `training/split.config-errors.test.ts`
    - **Property 12: Invalid test contributor configurations are rejected**
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.11**

  - [ ] 6.6 Implement `training/augment.ts`
    - Seeded augmentation: MLP path jitters and rotates raw landmarks then re-runs the shared `extractFeatures` and `buildFeatureVector`; CNN path shifts and scales the 96x96 mask; export a function that is only called for Train_Split samples; the augmentation PRNG is separate from the shuffle and Split_Seed streams
    - _Requirements: 4.14, 5.5, 5.7_

  - [ ]* 6.7 Write split and augmentation example tests
    - File: `training/split.test.ts`; concrete error examples for an empty list, an absent ID (message lists missing and present IDs), IDs covering all contributors, and one contributor; label-missing-from-test warning; worked example with `testContributorIds: ['C1']` and a fixed seed; spy test that validation and test samples are never augmented
    - _Requirements: 4.3, 4.4, 4.5, 4.11, 4.12, 4.14_

- [ ] 7. Seeded models and training loop
  - [ ] 7.1 Implement `training/seeds.ts`
    - Pure `layerSeed(S, layerIndex, role)` with roles `kernel`, `depthwise`, `pointwise` (layer position in creation order plus a role offset, so no two seeds in one model collide; there is no dropout role because dropout layers are left unseeded, Requirement 5.11), `shuffleSeed(S)` (epoch mixed in by the caller), `augmentSeed(S)`; the Split_Seed stays a separate stream
    - _Requirements: 5.6, 5.7_

  - [ ] 7.2 Implement model builders with full seeding
    - `training/models/mlp.ts` (131 to Dense 128, Dense 64, softmax 7) and `training/models/cnn.ts` (96x96x1, Conv2D stride 2, three `separableConv2d` blocks with batch normalization, global average pooling, dropout, softmax 7)
    - Seed EVERY kernel initialiser (`dense`, `conv2d`) and EVERY `depthwiseInitializer` and `pointwiseInitializer` (`separableConv2d`, and any `depthwiseConv2d`) with `tf.initializers.glorotUniform({ seed })`, all derived from the Training_Seed through `layerSeed`; leave bias and batch normalization initialisers at their non-random defaults
    - Leave dropout layers UNSEEDED (decided; Requirement 5.11): create them with `rate` only. Dropout is the one source of run-to-run variation, so same-seed runs match in initial weights but not necessarily in final weights
    - Provide a `describeSeeds(model)` test helper that lists every derived seed
    - Confirm `separableConv2d`, `batchNormalization`, and `globalAveragePooling2d` argument names against the TF.js docs before use
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 5.7_

  - [ ] 7.3 Implement training data preparation and loop
    - `training/train.ts`: build tensors inside `tf.tidy`; per-epoch seeded shuffle (own PRNG, `fit` called one epoch at a time with `shuffle: false`); evaluate validation each epoch; manual early stopping with a cloned best-weights snapshot restored at the end; dispose all tensors; never receive the test split
    - Comment in the module that reproducibility holds only within the same Training_Backend
    - _Requirements: 5.5, 5.6, 5.8, 5.9, 5.10_

  - [ ]* 7.4 Write seeding tests
    - File: `training/models/seeding.test.ts` (CPU backend, optional)
    - The list from `describeSeeds` for each model (every kernel, depthwise, and pointwise seed, plus the shuffle, augmentation, and split seeds) has no duplicates
    - Two builds with the same seed have equal initial weights for both MLP and CNN; builds with different seeds differ
    - No dropout-seed check: dropout is unseeded by decision, so only initial weights are compared, not final weights
    - Compare only within the CPU backend; add no cross-backend assertion
    - _Requirements: 5.6, 5.7, 5.8, 5.11_

  - [ ]* 7.5 Write training example tests
    - File: `training/train.test.ts`; tiny synthetic dataset on the CPU backend; builders have the expected input and output shapes and the CNN contains a separable convolution; same seed and backend give equal final weights within tolerance; `tf.memory().numTensors` unchanged apart from model weights; `fit` never sees test data
    - _Requirements: 5.1, 5.3, 5.6, 5.9, 5.10_

- [ ] 8. Evaluation, selection, and export
  - [ ] 8.1 Implement metrics and evaluation adapter
    - `training/metrics.ts` (pure): `evaluatePredictions`, `formatEvaluationReport`; 7x7 confusion matrix, accuracy, per-label precision and recall (`null` when undefined), misclassified list, most-confused pairs, `targetMet`
    - `training/evaluate.ts`: run `model.predict` inside `tf.tidy`, take argmax and max probability, build predictions; measure inference time per sample
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.7, 6.8_

  - [ ]* 8.2 Write property test for metrics
    - File: `training/metrics.property.test.ts`
    - **Property 18: Confusion matrix and metrics are consistent**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.7, 6.8, 8.9**

  - [ ] 8.3 Implement `training/select.ts`
    - `selectModel(a, b, tieMarginPoints)` returning `{chosen, reason}`: higher accuracy beyond the margin, else smaller export size, else lower inference time, else MLP
    - _Requirements: 6.5, 6.6, 6.9_

  - [ ]* 8.4 Write property test for model selection
    - File: `training/select.test.ts`
    - **Property 19: Model selection follows the rule**
    - **Validates: Requirements 6.5, 6.6**

  - [ ] 8.5 Implement `training/export.ts` (custom writer)
    - `captureArtifacts(model)`: `model.save(tf.io.withSaveHandler(...))` returning `modelArtifactsInfo` (`dateSaved`, `modelTopologyType: 'JSON'`); works on `wasm` and `cpu`, where the `file://` handler does not exist
    - `writeModelFiles(model, meta, dir)`: write `model.json` (`modelTopology`, `format`, `generatedBy`, `convertedBy`, `weightsManifest: [{ paths: ['weights.bin'], weights: weightSpecs }]`, no other keys), `weights.bin` (joined with `tf.io.concatenateArrayBuffers` when `weightData` is an array), and `metadata.json` (`serializeModelMetadata`); one writer for every backend so the layout is identical
    - `loadExportedModel(dir)`: ends in `tf.loadLayersModel`, the loader the Predictor uses in the browser. Use the `fetchFunc` approach if task 1.6 showed it works in Node; otherwise use the documented fallback (`getWeightSpecs`, `getModelArtifactsForJSONSync`, `fromMemory`). Use the single-argument form of `tf.io.fromMemory` (the multi-argument form is deprecated) where an in-memory reload fits. Record which path ran
    - `exportModel(model, meta, dir, cfg)`: write files, fail above `maxBytes`, reload with `loadExportedModel`, predict on up to 32 test samples, compare within `reloadTolerance`, and return the file list, byte total, max difference, and loader path used; remove or mark invalid the files on failure
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 7.8_

  - [ ] 8.6 Write required export round-trip test
    - File: `training/export.roundtrip.test.ts` (example test, not a property; CPU backend, vitest Node environment; required, no asterisk)
    - Build a tiny seeded model (for example `dense(4, relu)` then `dense(7, softmax)` on a 6-value input); call `writeModelFiles` into a temp directory; load with `loadExportedModel(dir)` (ends in `tf.loadLayersModel`); predict on 3 to 5 fixed inputs with both models and assert every probability differs by at most `cfg.export.reloadTolerance`
    - Also assert the written `model.json` has `modelTopology` and a `weightsManifest` whose `paths` all exist in the directory, and that a reload through `tf.io.fromMemory(captureArtifacts(...))` agrees
    - If this test fails the suite fails, and the writer must not be treated as verified
    - _Requirements: 7.4, 7.8, 7.9, 11.12_

  - [ ]* 8.7 Write additional export example tests
    - File: `training/export.test.ts`; expected files exist, `metadata.json` round-trips, total size under the limit, an oversize model is rejected with `ExportError`, the file layout is the same shape for each available backend
    - _Requirements: 7.1, 7.2, 7.3, 7.6_

- [ ] 9. Training API and CLI
  - [ ] 9.1 Implement `training/api.ts`
    - Export `getDatasetStats`, `makeSplits` (reads `config.split`), `resolveDatasetContributors` (registry load, assign, save, drop names), `trainCandidate`, `evaluateCandidate`, `getConfusionMatrix`, `getMisclassified`, `runTraining`, `runEvaluation`; accept an injected `Logger`; return plain JSON-serializable results; no `process.exit`, no direct console use
    - `runTraining` order: choose backend and log it, load data, resolve contributors (names dropped here), build splits, train both candidates, evaluate, select, export; write JSON reports to `training/out/` (IDs only, never names), report whether the accuracy target was met; `getDatasetStats` includes `NONE_GUIDANCE` in its report
    - _Requirements: 3.3, 3.4, 4.10, 6.9, 8.4, 8.8, 8.9, 8.10_

  - [ ] 9.2 Implement CLI entry points
    - `training/cli/dataset-report.ts`, `train.ts`, `evaluate.ts`: parse `--backend`, `--seed`, `--files`; call the API; print the readable summaries (the dataset report summary includes the `NONE_GUIDANCE` text); set `process.exitCode` on error; support `--help`
    - `train.ts` prints one line naming the chosen backend (for example `Training backend: wasm (tfjs-node unavailable: <reason>)` or `Training backend: tfjs-node`) right after backend selection and before loading data
    - _Requirements: 3.12, 8.4, 8.5, 8.7, 8.11_

  - [ ]* 9.3 Write API example tests
    - File: `training/api.test.ts`; results survive `JSON.parse(JSON.stringify(x))` unchanged; API never calls `process.exit`; logger is injectable; no result or log line contains a contributor name; `package.json` scripts `train`, `evaluate`, `dataset:report` exist
    - _Requirements: 3.4, 8.7, 8.8, 8.9_

  - [ ]* 9.4 Write train CLI backend-line test
    - File: `training/cli/train.test.ts`; with a fake backend choice, the `train` entry prints a line naming the chosen backend before any data is loaded
    - _Requirements: 8.4, 8.11_

- [ ] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Browser runtime predictor and facade
  - [ ] 11.1 Implement `src/classifier/tf.ts`, `types.ts`, and `predictor.ts`
    - `tf.ts` is the only browser module importing `@tensorflow/tfjs`; `types.ts` holds `Prediction`, `ShapeEvent`, `ClassifierState`, `LayersModelLike`
    - `createPredictor`: no hands returns `none` with `modelRan: false` and never touches the model; MLP path uses the shared `extractFeatures` and `buildFeatureVector`; CNN path uses the shared mask generator and `maskToFloat`; inference inside `tf.tidy`; measure inference time
    - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.7_

  - [ ]* 11.2 Write property test for no-hands behavior
    - File: `src/classifier/predictor.no-hands.test.ts`
    - **Property 22: No hands means `none` without running the model**
    - **Validates: Requirements 9.4**

  - [ ]* 11.3 Write property test for prediction distributions and tensor leaks
    - File: `src/classifier/predictor.distribution.test.ts`; tiny fixture models for MLP and CNN input types on the CPU backend
    - **Property 23: Predictions are distributions and leak no tensors**
    - **Validates: Requirements 9.3, 9.5**

  - [ ] 11.4 Implement `src/classifier/classifier.ts` and `index.ts`
    - `startClassifier(pipeline, deps?)`: fetch and validate metadata, `tf.loadLayersModel(config.classifier.modelPath)`, warm-up; any failure yields the error state without throwing; `onFrame` handler wraps predict and debounce in try/catch; `onShape` and `onPrediction` return unsubscribe functions; per-subscriber try/catch; `stop()` unsubscribes from the pipeline and disposes the model
    - _Requirements: 9.1, 9.8, 9.9, 9.10, 9.11, 10.9, 10.10, 10.11_

  - [ ]* 11.5 Write property test for subscriptions
    - File: `src/classifier/classifier.subscriptions.test.ts`
    - **Property 24: Subscriptions behave like a set**
    - **Validates: Requirements 10.9, 10.10, 10.11**

  - [ ]* 11.6 Write facade example tests
    - File: `src/classifier/classifier.test.ts`; failing loader gives the error state; label-mismatch metadata gives the error state; throwing predictor skips a frame and continues; `stop()` unsubscribes and disposes
    - _Requirements: 9.8, 9.9, 9.10, 9.11_

- [ ] 12. Debug view and page wiring
  - [ ] 12.1 Implement `src/classifier/debug-view.ts`
    - `createClassifierDebugView(canvas)` mirroring `FpsOverlay`: hidden by default, a `keydown` listener calls `toggle()` when `isToggleKey` allows it, draws on the preview canvas using `config.fpsOverlayStyle` font and color in `config.classifier.debugOverlay.corner`; shows top label, confidence, inference ms, last K events, or the error message
    - Export pure `formatPrediction`, `takeLastEvents` (most recent first), and `isToggleKey(e, target)` (true only for `c`/`C` with no repeat, no ctrl/meta/alt, and a target that is not `INPUT`, `TEXTAREA`, or contentEditable), as in design section 17
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

  - [ ]* 12.2 Write property test for the event log
    - File: `src/classifier/debug-view.log.test.ts`
    - **Property 25: Debug event log keeps the most recent events**
    - **Validates: Requirements 12.4**

  - [ ] 12.3 Wire the classifier into `src/main.ts`
    - After creating the pipeline, start the classifier without blocking `pipeline.start()`; call `debugView.draw()` after `fps.update`; feed `onPrediction` to `debugView.update` and `onShape` to `debugView.logEvent`; a classifier error must leave the preview running
    - _Requirements: 9.6, 9.8, 12.3, 12.4, 12.7_

  - [ ]* 12.4 Write debug view example tests
    - File: `src/classifier/debug-view.test.ts`; hidden by default; C toggles; `isToggleKey` examples (`c`, `C`, key repeat, ctrl/meta/alt modifiers, `INPUT`/`TEXTAREA`/contentEditable target); C ignored in an input; top label and confidence shown after `update`; `main.ts` wiring with fakes (`startClassifier` does not block `pipeline.start()`, `onPrediction` feeds `update`, `onShape` feeds `logEvent`, `draw()` runs after the FPS overlay); uses FPS font and color; error message shown; `config.classifier.debugOverlay.corner` differs from the FPS corner; `config.classifier.stableFrames` and `confidenceThreshold` are defined
    - _Requirements: 10.1, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 12.8_

- [ ] 13. End-to-end verification and docs
  - [ ]* 13.1 Write end-to-end synthetic pipeline test
    - File: `training/pipeline.e2e.test.ts`; generate a small synthetic export (several contributors, bursts, all labels) into a temp `data/raw`-style folder with a temp contributor registry, run `runTraining` on the CPU backend with a few epochs and `split.testContributorIds` set to a present ID into a temp export folder; check reports exist, selection reason is present, exported files load through the same loader the Predictor uses, only IDs (never names) appear in outputs, and the registry file contains the names
    - _Requirements: 2.1, 3.3, 3.4, 4.2, 6.9, 7.1, 7.2, 7.4, 9.1_

  - [ ] 13.2 Document training, registry, and the debug view
    - README section: place exports in `data/raw/` (never committed), run `npm run dataset:report`, `npm run train`, `npm run evaluate`
    - README states the `NONE_GUIDANCE` text word for word (import or copy from `training/dataset/report.ts` so they cannot drift)
    - README explains `data/contributors.json`: local, gitignored, append-only, do not delete or edit by hand (deleting renumbers everyone), back it up with the raw data; test contributors are set by ID in `training/training-config.ts` (`split.testContributorIds`); do not put contributor names in export file names
    - README documents that running under Node 22 LTS should enable `tfjs-node` for faster training, marked as not verified on the author's machine; backend order `tfjs-node`, `wasm`, `cpu` and the Node 26 finding (including `npm rebuild @tensorflow/tfjs-node` for blocked install scripts); the `train` command prints the chosen backend; reproducibility holds within one backend only. Do not add `engines` or `.nvmrc`
    - README: press C for the classifier overlay
    - `KIRO_LOG.md`: record the Spec 2 steps, the backend probe result on this machine, the task 1.6 outcome, and the performance smoke result for inference time and FPS once a real model exists
    - _Requirements: 2.14, 3.11, 8.2, 8.3, 8.7, 8.11, 8.12, 8.13, 9.6, 9.7, 12.2_

  - [ ]* 13.3 Write README content test
    - File: `training/readme.test.ts` (Node environment, optional)
    - Assert `README.md` contains `NONE_GUIDANCE` text exactly, the Node 22 LTS sentence with an "unverified" marker, and mentions of `data/contributors.json` and `split.testContributorIds`
    - _Requirements: 3.11, 8.12_

- [ ] 14. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. Required tests: Properties 1 to 11 (Requirement 11), the export round-trip test (task 8.6), and the repository hygiene test (1.5). The seeding tests (7.4) and the README content test (13.3) are optional.
- Each task references specific requirement sub-IDs for traceability.
- Property tests use fast-check with at least 100 runs each and are tagged `// Feature: classifier, Property {number}: {property_text}`.
- Do not edit assertions of existing Spec 1 tests; only their import paths change in task 1.1.
- Real accuracy depends on data collected with the Spec 1 collector. Until `data/raw/` has real exports, verify the pipeline with synthetic data only.
- Never print or commit contributor names; reports use `C1`, `C2`. Names exist only in the gitignored `data/contributors.json`.
- Reproducibility is guaranteed within one Training_Backend only; no test compares results across backends.
- Dropout is unseeded by decision (Requirement 5.11): it is the one source of run-to-run variation, so same-seed runs match in initial weights but not necessarily in final weights.
- Do not add an `engines` field or an `.nvmrc`. The Node 22 LTS claim is documentation only and unverified.
- The `none` guidance is dataset and documentation text only; no runtime behavior is added.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "1.6", "2.1", "3.1", "4.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.5", "3.2", "4.2", "7.1"] },
    { "id": 3, "tasks": ["2.4", "2.6", "3.3", "4.3", "5.1", "8.1", "11.1"] },
    { "id": 4, "tasks": ["3.4", "3.5", "3.6", "3.7", "5.2", "5.3", "5.4", "5.11", "6.1", "6.6", "7.2", "8.2", "8.3", "8.5", "11.2", "11.3", "11.4", "12.1"] },
    { "id": 5, "tasks": ["5.5", "5.6", "5.7", "5.8", "6.2", "6.3", "6.4", "6.5", "6.7", "7.3", "7.4", "8.4", "8.6", "8.7", "11.5", "11.6", "12.2", "12.3", "12.4"] },
    { "id": 6, "tasks": ["5.9", "5.10", "5.12", "7.5", "9.1"] },
    { "id": 7, "tasks": ["9.2", "9.3", "9.4"] },
    { "id": 8, "tasks": ["13.1", "13.2"] },
    { "id": 9, "tasks": ["13.3"] }
  ]
}
```
