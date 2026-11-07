# Needalaata

## Getting started

```sh
npm install
npm run dev
```

## Asset setup

`npm install` triggers the `postinstall` script, which runs `node scripts/setup-assets.mjs`. The script prepares the MediaPipe assets so a fresh clone works locally:

1. Copies `node_modules/@mediapipe/tasks-vision/wasm` to `public/wasm`.
2. Downloads `hand_landmarker.task` into `public/models/`, only if the file is missing. If the download fails, the script exits non-zero so the problem is noticed early.

All MediaPipe assets are served from the app's own origin. Nothing is loaded from a CDN at runtime.

The paths in `src/config.ts` match the script's output:

- `wasmPath: "/wasm"`
- `modelAssetPath: "/models/hand_landmarker.task"`

If the assets are ever missing or stale, re-run the script manually:

```sh
node scripts/setup-assets.mjs
```

Note: if `@mediapipe/tasks-vision` is not installed yet, the WASM copy is skipped with a warning. Install the package and re-run the script.
