// Collector UI: label picker, contributor name, live counts, mask thumbnail, controls.
// Wires pipeline -> FeatureExtractor -> MaskGenerator -> CaptureController -> SampleStore -> Exporter.
// Req 8.1-8.4, 9.1, 9.2, 13.1-13.3, 14.1-14.4, 15.4.
import { config } from '../../src/config';
import type { VisionPipeline } from '../../src/vision/pipeline';
import { createCaptureController, type CaptureController } from './capture-controller';
import { downloadExport, NothingToExportError } from './exporter';
import { extractFeatures } from './feature-extractor';
import { createMaskGenerator, type MaskGenerator } from './mask-generator';
import type { SampleStore } from './sample-store';
import { SHADOW_VOCABULARY } from './shadow-vocabulary';
import { LABELS, type FrameResult, type Label } from './types';

export const CLEAR_CONFIRM_MESSAGE = 'Delete ALL recorded samples? This cannot be undone.';

export interface CollectorUiOptions {
  root: HTMLElement;
  pipeline: VisionPipeline;
  store: SampleStore;
  /** True once the HandLandmarker is ready (Req 14.1, 14.2). */
  isTrackerReady: () => boolean;
  maskGenerator?: MaskGenerator;
  /** Overridable for tests. */
  confirmFn?: (message: string) => boolean;
  now?: () => number;
}

export interface CollectorUi {
  readonly controller: CaptureController;
  readonly activeLabel: Label;
  selectLabel(label: Label): void;
  refreshCounts(): Promise<void>;
  /** Re-evaluate the record button state (call when the tracker becomes ready). */
  updateControls(): void;
  dispose(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const c of children) node.append(c);
  return node;
}

export function createCollectorUi(options: CollectorUiOptions): CollectorUi {
  const { root, pipeline, store } = options;
  const confirmFn = options.confirmFn ?? ((m: string) => window.confirm(m));
  const now = options.now ?? (() => performance.now());
  const maskGenerator = options.maskGenerator ?? createMaskGenerator();

  const counts = {} as Record<Label, number>;
  for (const l of LABELS) counts[l] = 0;
  let active: Label = LABELS[0];

  // ---- DOM ----
  const message = el('div', { className: 'message', role: 'status' });
  message.setAttribute('aria-live', 'polite');
  const setMessage = (text: string): void => {
    message.textContent = text;
  };

  const nameInput = el('input', { id: 'contributor', type: 'text', placeholder: 'Your name' });
  nameInput.setAttribute('autocomplete', 'name');
  const nameField = el('label', {}, 'Contributor name ', nameInput);

  const labelButtons = new Map<Label, HTMLButtonElement>();
  const countCells = new Map<Label, HTMLElement>();
  const picker = el('div', { className: 'label-picker', role: 'group' });
  picker.setAttribute('aria-label', 'Label');
  for (const label of LABELS) {
    const count = el('span', { className: 'count' }, '0');
    countCells.set(label, count);
    const btn = el('button', { type: 'button', className: 'label-btn' }, label, ' ', count);
    btn.dataset.label = label;
    btn.addEventListener('click', () => selectLabel(label));
    labelButtons.set(label, btn);
    picker.append(btn);
  }

  const refImage = el('div', { className: 'ref-image' });
  const refTitle = el('h2');
  const refDesc = el('p', { className: 'ref-desc' });
  const reference = el('section', { className: 'reference' }, refImage, refTitle, refDesc);

  const thumb = el('canvas', { className: 'mask-thumb', width: config.maskSize.width, height: config.maskSize.height });
  thumb.setAttribute('aria-label', 'Live shadow mask (96x96)');
  const thumbCtx = thumb.getContext('2d');
  const thumbImage = thumbCtx?.createImageData(config.maskSize.width, config.maskSize.height) ?? null;

  const status = el('div', { className: 'status' });
  const recordBtn = el('button', { type: 'button', id: 'record' }, 'Record');
  const undoBtn = el('button', { type: 'button', id: 'undo' }, 'Undo last burst');
  const clearBtn = el('button', { type: 'button', id: 'clear' }, 'Clear all');
  const exportBtn = el('button', { type: 'button', id: 'export' }, 'Export');
  const controls = el('div', { className: 'controls' }, recordBtn, undoBtn, clearBtn, exportBtn);

  root.append(nameField, picker, reference, el('div', { className: 'thumb-row' }, thumb, status), controls, message);

  // ---- Controller ----
  const controller = createCaptureController({
    store,
    maskGenerator,
    isTrackerReady: options.isTrackerReady,
    onStateChange: () => updateControls(),
    onSample: (s) => {
      counts[s.label] += 1; // Req 13.2: increment on capture
    },
    onPrompt: (m) => setMessage(m),
  });
  controller.setLabel(active);

  // ---- Behaviour ----
  function renderCounts(): void {
    for (const label of LABELS) {
      const cell = countCells.get(label);
      if (cell) cell.textContent = String(counts[label]);
    }
  }

  function renderStatus(): void {
    if (!options.isTrackerReady()) status.textContent = 'Loading hand tracking\u2026';
    else if (controller.state === 'countdown') {
      status.textContent = `Get ready: ${Math.ceil(controller.countdownRemainingMs(now()) / 1000)}`;
    } else if (controller.isRecording) status.textContent = '\u25CF Recording\u2026';
    else status.textContent = 'Ready';
    status.classList.toggle('recording', controller.isRecording);
  }

  function updateControls(): void {
    recordBtn.disabled = !controller.canRecord(); // Req 14.1, 14.2
    undoBtn.disabled = controller.state !== 'ready';
    clearBtn.disabled = controller.state !== 'ready';
    renderStatus();
  }

  function selectLabel(label: Label): void {
    active = label;
    controller.setLabel(label);
    for (const [l, btn] of labelButtons) {
      const on = l === label;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', String(on));
    }
    const entry = SHADOW_VOCABULARY[label];
    refImage.innerHTML = entry.illustrationSvg;
    refTitle.textContent = label;
    refDesc.textContent = entry.description;
  }

  async function refreshCounts(): Promise<void> {
    const stored = await store.countsByLabel();
    for (const l of LABELS) counts[l] = stored[l];
    renderCounts();
  }

  function drawThumb(frame: FrameResult): void {
    if (!thumbCtx || !thumbImage) return;
    const mask = maskGenerator.generate(frame, extractFeatures(frame).slots);
    const d = thumbImage.data;
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ?? 0;
      d[i * 4] = v;
      d[i * 4 + 1] = v;
      d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    }
    thumbCtx.putImageData(thumbImage, 0, 0);
  }

  const unsubscribe = pipeline.onFrame((frame) => {
    drawThumb(frame); // Req 14.3, 14.4: every frame
    controller.update(now(), frame);
  });

  nameInput.addEventListener('input', () => controller.setContributor(nameInput.value)); // Req 9.2

  recordBtn.addEventListener('click', () => {
    setMessage('');
    controller.setContributor(nameInput.value);
    controller.setLabel(active);
    controller.start(now());
    updateControls();
  });

  undoBtn.addEventListener('click', () => {
    void store.undoLastBurst().then(refreshCounts);
  });

  clearBtn.addEventListener('click', () => {
    if (!confirmFn(CLEAR_CONFIRM_MESSAGE)) return; // Req 15.4
    void store.clearAll().then(refreshCounts);
  });

  exportBtn.addEventListener('click', () => {
    void store.all().then((samples) => {
      try {
        downloadExport(samples, nameInput.value.trim() || 'anonymous');
        setMessage('');
      } catch (err) {
        setMessage(err instanceof NothingToExportError ? err.message : 'Export failed.');
      }
    });
  });

  // Periodic refresh of counts + countdown/status within uiRefreshIntervalMs (Req 13.3).
  const timer = window.setInterval(() => {
    renderCounts();
    updateControls();
  }, config.uiRefreshIntervalMs);

  selectLabel(active);
  updateControls();
  void refreshCounts();

  return {
    controller,
    get activeLabel() {
      return active;
    },
    selectLabel,
    refreshCounts,
    updateControls,
    dispose() {
      unsubscribe();
      window.clearInterval(timer);
    },
  };
}
