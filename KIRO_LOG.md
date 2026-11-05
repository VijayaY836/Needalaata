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