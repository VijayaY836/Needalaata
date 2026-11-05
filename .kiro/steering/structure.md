---
inclusion: always
---

# Project Structure

```
/
├── .kiro/                  # specs, steering, hooks – NEVER gitignore this
├── public/
│   ├── models/             # exported TF.js classifier (model.json + weights)
│   ├── puppets/<name>/     # puppet part images per character
│   └── audio/              # original or properly licensed sounds only
├── tools/
│   └── collect/            # data-collection page for recording hand-shadow samples
├── training/               # notebook/scripts to train + export the classifier
├── src/
│   ├── main.ts             # app bootstrap
│   ├── config.ts           # all tunable constants
│   ├── vision/             # camera, HandLandmarker, segmentation (NO game logic)
│   ├── ml/                 # feature extraction, classifier loading, debounced predictions
│   ├── story/              # flow state machine: theatre → lamp → choose tale → perform → revive; tales/ holds each tale
│   ├── puppets/            # puppet registry + rigs; one file per character
│   ├── stage/              # PixiJS scene: screen, lamp, colored shadows, particles
│   ├── audio/              # sound manager
│   └── ui/                 # overlays, captions, onboarding hints
└── README.md
```

## Boundaries
- `vision/` emits landmarks and masks. It knows nothing about puppets.
- `ml/` turns landmarks/masks into `{ label, confidence }` events.
- `story/` listens to those events and decides what happens.
- `puppets/` and `stage/` only render what `story/` tells them.

## Adding a character
Every character is registered in `src/puppets/registry.ts` with: id, display name, gesture label (must match classifier label), rig definition, color palette, entrance animation, and story beats. A Kiro hook keeps this registry, the classifier labels and the README character table in sync.

## Naming
- Files: kebab-case. Classes: PascalCase. Classifier labels: snake_case (`rabbit`, `lion`, `bird`, `snake`, `crocodile`, `demon`, `none`).
- Each tale lives in `src/story/tales/<tale-id>.ts` (e.g. `lion-and-rabbit.ts`) and lists its scenes, captions and shadow cues.