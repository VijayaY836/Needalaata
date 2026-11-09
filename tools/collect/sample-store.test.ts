import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAVE_FAILED_MESSAGE, createSampleStore } from './sample-store';
import { LABELS } from './types';
import type { HandSlot, Label, Sample } from './types';

const emptySlot: HandSlot = {
  present: false,
  handedness: '',
  score: 0,
  rawLandmarks: [],
  normalizedLandmarks: [],
};

let n = 0;
function makeSample(burstId: string, timestamp: number, label: Label = LABELS[0]): Sample {
  n += 1;
  return {
    id: `sample-${n}`,
    label,
    slots: [emptySlot, emptySlot],
    interHand: { wristOffset: { x: 0, y: 0, z: 0 }, handCount: 0 },
    maskBase64: '',
    frameWidth: 640,
    frameHeight: 480,
    sessionId: 'session',
    burstId,
    contributor: 'tester',
    timestamp,
  };
}

const ids = (samples: Sample[]): string[] => samples.map((s) => s.id).sort();

describe('SampleStore persistence', () => {
  beforeEach(() => {
    // Fresh, empty database for each test.
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  });

  it('restores samples and counts on a fresh instance (simulated reload)', async () => {
    const first = createSampleStore();
    const a1 = makeSample('A', 1, LABELS[0]);
    const a2 = makeSample('A', 2, LABELS[0]);
    const b1 = makeSample('B', 3, LABELS[1]);
    for (const s of [a1, a2, b1]) await first.put(s);

    const reloaded = createSampleStore();
    expect(ids(await reloaded.all())).toEqual(ids([a1, a2, b1]));
    const counts = await reloaded.countsByLabel();
    expect(counts[LABELS[0]]).toBe(2);
    expect(counts[LABELS[1]]).toBe(1);
  });

  it('undo after reload deletes exactly the max-timestamp burst', async () => {
    const first = createSampleStore();
    const a1 = makeSample('A', 10);
    const b1 = makeSample('B', 20);
    const b2 = makeSample('B', 21);
    const c1 = makeSample('C', 15);
    for (const s of [a1, b1, b2, c1]) await first.put(s);

    const reloaded = createSampleStore();
    await reloaded.undoLastBurst();
    expect(ids(await reloaded.all())).toEqual(ids([a1, c1]));

    // Persisted: another fresh instance sees the same result.
    expect(ids(await createSampleStore().all())).toEqual(ids([a1, c1]));
  });

  it('is timestamp-based, not insertion-order', async () => {
    const first = createSampleStore();
    const newest = makeSample('NEW', 100);
    const newest2 = makeSample('NEW', 101);
    const olderInsertedLater = makeSample('OLD', 5);
    for (const s of [newest, newest2, olderInsertedLater]) await first.put(s);

    const reloaded = createSampleStore();
    await reloaded.undoLastBurst();
    expect(ids(await reloaded.all())).toEqual(ids([olderInsertedLater]));
  });

  it('undo on an empty store is a no-op', async () => {
    const store = createSampleStore();
    await store.undoLastBurst();
    expect(await store.all()).toEqual([]);
  });

  it('deleteBurst and clearAll persist across reload', async () => {
    const first = createSampleStore();
    const a = makeSample('A', 1);
    const b = makeSample('B', 2);
    await first.put(a);
    await first.put(b);
    await first.deleteBurst('A');
    expect(ids(await createSampleStore().all())).toEqual(ids([b]));
    await first.clearAll();
    expect(await createSampleStore().all()).toEqual([]);
  });

  it('reports a non-fatal error when IndexedDB is unavailable', async () => {
    const messages: string[] = [];
    const store = createSampleStore({
      factory: {
        open() {
          throw new Error('boom');
        },
      } as unknown as IDBFactory,
      onError: (m) => messages.push(m),
    });
    await expect(store.put(makeSample('A', 1))).resolves.toBeUndefined();
    expect(messages).toEqual([SAVE_FAILED_MESSAGE]);
  });
});
