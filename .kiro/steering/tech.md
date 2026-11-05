---
inclusion: always
---

# Tech Stack and Constraints

## Platform
- Runs entirely in the browser (desktop Chrome/Edge first). No backend required for the core experience.
- No webcam frames ever leave the device. State this in the UI and README.
- Deployed as a static site (Vercel or GitHub Pages) so judges can open one link.

## Stack
- **Build:** Vite + TypeScript (strict mode)
- **Hand tracking:** `@mediapipe/tasks-vision` HandLandmarker (GPU delegate, CPU fallback), up to 2 hands
- **Silhouette:** `@mediapipe/tasks-vision` ImageSegmenter or a landmark-based hull to render the user's hands as a shadow on the screen
- **Classifier:** TensorFlow.js. Two candidate approaches, compare both and keep the better one:
  1. Landmark MLP: input = both hands' 21x3 landmarks, normalized (wrist-relative, scale-invariant, missing hand = zeros)
  2. Silhouette CNN: transfer learning on MobileNet using 96x96 shadow masks (handles interlocked fingers better)
- **Rendering:** PixiJS (WebGL) for the theatre, puppets, lamp glow, particles; fall back to Canvas 2D only if needed
- **Puppets:** each puppet is a rig of separate painted parts (torso, head, upper/lower arms, upper/lower legs) connected at pivot points, animated in code
- **Audio:** Howler.js. Audio unlocks on the first user click ("Enter the theatre" button) because of autoplay rules

## Performance targets
- Tracking + classification + render at 30 fps or better on a mid-range laptop
- Classifier inference under 15 ms per frame
- A summon fires only after the same class is predicted with confidence >= 0.85 for ~0.8 s (debounced), to avoid flicker

## Rules for generated code
- Never invent MediaPipe or TF.js APIs. Check official docs (via MCP) before using an unfamiliar function.
- Keep tracking, classification, game state and rendering in separate modules (see structure.md).
- No new dependencies without noting why in the PR/commit message.
- All tunable numbers (thresholds, timings, colors) live in `src/config.ts`.