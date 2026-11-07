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