// Copies MediaPipe WASM + downloads the hand landmarker model so all assets
// are served from the app's own origin (never a CDN at runtime).
import { cp, mkdir, access, writeFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules", "@mediapipe", "tasks-vision", "wasm");
const wasmDest = join(root, "public", "wasm");
const modelDir = join(root, "public", "models");
const modelDest = join(modelDir, "hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

const exists = (p) =>
  access(p).then(
    () => true,
    () => false,
  );

async function copyWasm() {
  if (!(await exists(wasmSrc))) {
    console.warn(
      "[setup-assets] @mediapipe/tasks-vision is not installed; skipping WASM copy. " +
        "Install it and re-run: node scripts/setup-assets.mjs",
    );
    return;
  }
  await mkdir(wasmDest, { recursive: true });
  await cp(wasmSrc, wasmDest, { recursive: true });
  console.log("[setup-assets] Copied WASM fileset to public/wasm");
}

async function fetchModel() {
  if (await exists(modelDest)) {
    console.log("[setup-assets] Model already present; skipping download");
    return;
  }
  await mkdir(modelDir, { recursive: true });
  const tmp = `${modelDest}.part`;
  try {
    const res = await fetch(MODEL_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
    await writeFile(tmp, Buffer.from(await res.arrayBuffer()));
    await rename(tmp, modelDest);
    console.log("[setup-assets] Downloaded model to public/models/hand_landmarker.task");
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

try {
  await copyWasm();
  await fetchModel();
} catch (err) {
  console.error(`[setup-assets] Failed: ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
