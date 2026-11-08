# Kiro Build Log

## Nov 5 – Setup
- Added 4 custom steering docs (product, tech, structure, cultural guidelines) with inclusion: always
- Added Context7 MCP so Kiro reads real MediaPipe / TF.js / PixiJS docs
- Why: keep every generation aligned with the vision and stop API hallucinations
## Nov 5 – Spec 1: vision-and-collection
- Started first spec from a structured prompt; Kiro generating requirements
- Kiro consulted Context7 for the real MediaPipe HandLandmarker API before writing the spec (driven by our tech.md rule: "never invent APIs")
- Tasks generated: 18 task groups, ordered with a dependency graph; property tests placed next to the code they validate
- Next: implement tasks 1.1 → 8.1, then preview page (16.1) to visually verify the shadow early

## Nov 7 – Spec 1 implementation (Day 2)

### Tasks 1.1–1.5: Scaffold + assets
- Kiro scaffolded Vite + TypeScript (strict), multi-page build (main app + collector)
- Added Vitest + fast-check
- Asset setup script on npm postinstall: copies MediaPipe WASM to public/wasm and
  downloads hand_landmarker.task to public/models (served locally, no CDN)
- README documents the asset setup

### Tasks 2.1, 3.1: Config + shared types
- All tunables centralised in src/config.ts
- Shared types document the mirrored Display_Coordinate_Space contract

### Tasks 4.1–8.1: Vision pipeline
- Camera with permission / no-device error handling and on-device privacy notice
- HandLandmarker with GPU delegate and CPU fallback
- Per-frame pipeline: single timestamp per tick, single mirror (x' = 1 − x)
- Silhouette renderer: thick rounded finger strokes + palm polygon, scale-relative
  thickness, offscreen downscaled blur
- FPS overlay toggled with D

### Task 16.1: Preview page (early visual checkpoint)
- Ran the preview before building the collector to catch visual issues early
- Bug: black screen. Console proved tracking worked, so the fault was in rendering.
  Asked Kiro to debug the render path and add an L-key landmark debug overlay → fixed
- Checkpoint passed: mirroring correct, distinct fingers (rabbit ears separate), 42–52 FPS

![First shadow – rabbit](docs/screenshots/shadow.png)
![Open hand – all five fingers at 52 FPS](docs/screenshots/open-hand-shadow.png)

### Tasks 9.1–9.3: Feature extractor + property-based tests
- Feature extractor: fixed hand slots, aspect-corrected normalization, inter-hand features
- 10 fast-check properties (100 runs each), all passing
- Property 2 generator deliberately includes identical-wrist-x and identical-x+y pairs
  to exercise the tiebreaker
- Strict TypeScript: zero errors

### Next (Nov 8)
- Tasks 11.1 → 15.1: mask generator, sample store, exporter, capture controller, collector page

## Nov 8 – Spec 1 implementation (Day 3) – collector complete

### Tasks 11.1–11.2: Mask generator + Property 11
- 96×96 single-channel shadow mask (0 = background, 255 = shadow), raw uint8 → base64
- Reuses the SAME SilhouetteRenderer as the preview, rendered white-on-black, so the CNN
  trains on exactly the geometry users see (no duplicated drawing code)
- Crops to the hands' bounding box + padding scaled to hand size, centred, aspect preserved; no hands → blank mask
- Review caught gaps the green tests hid; sent back to Kiro:
  - Property 11 was testing helpers inside the test file → moved into production
    `encodeMask` / `decodeMask`, which the exporter now reuses
  - Added edge masks (all-0, all-255, single lit pixel at index 0 and 9215)
  - Padding now covers the silhouette's half stroke width (0.125 × hand scale) so fingertips never clip
  - New assertion: non-null crop ⇒ non-empty mask, plus an asymmetric-hand example, so a double-mirror bug fails loudly
  - `maskBlurRadius: 0` → crisp training masks; preview keeps its warm blur
- Lesson: a passing property is only as good as the code it actually calls

### Task 12.1: Sample store
- IndexedDB persistence; undo removes the latest-timestamp burst; clear-all asks for confirmation

### Tasks 13.1–13.2: Exporter + Property 12
- Versioned JSON export with metadata; uses the shared mask codec
- Export round-trip property passing

### Task 14.1: Capture controller
- Fixed 4 s bursts at 10 samples/sec (40 per burst), tagged with sessionId + burstId
- Recording disabled until the tracker is ready

### Task 15.1: Collector page
- Contributor name (required), 7-label picker with live counts, reference illustration + hint per shape
- Live 96×96 mask thumbnail, Record / Undo last burst / Clear all / Export

### Task 18: Final checkpoint
- `tsc --noEmit` clean · 12/12 correctness properties passing (100 runs each)
- Live test passed: name gate, thumbnail centred with fingertips intact, correct mirroring,
  mask size stable at any distance, two hands combine, 40 samples/burst, `none` records
  without hands, undo removes only the last burst, data survives reload, export has all
  fields, clear-all confirms, no console errors

![Collector – rabbit shadow, live mask, mid-recording](docs/screenshots/collector.png)

### Other
- Requested the 4,000 Kiro credits via the Devpost Resources form
- Considering Frankenstein as the primary category (ancient craft stitched to ML)

### Next (Nov 9–10)
- Recording sessions with 3–5 people, 250+ samples per label; export after each session
- Optional: PBT mutation check (break the slot tiebreaker, screenshot fast-check catching it)
- Spec 2: `classifier`