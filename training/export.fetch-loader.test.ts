// @vitest-environment node
// Early check (task 1.6): tf.loadLayersModel(url, { fetchFunc }) works in Node with a fake fetch.
// Validates: Requirements 7.4, 7.8
import * as tf from '@tensorflow/tfjs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('loadLayersModel with fetchFunc in Node', () => {
  let dir: string;

  beforeAll(async () => {
    await tf.setBackend('cpu');
    await tf.ready();
    dir = await mkdtemp(join(tmpdir(), 'fetch-loader-'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads a model served by a fake fetch and reproduces predictions', async () => {
    const model = tf.sequential();
    model.add(
      tf.layers.dense({
        inputShape: [4],
        units: 5,
        activation: 'relu',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 1 }),
      }),
    );
    model.add(
      tf.layers.dense({
        units: 3,
        activation: 'softmax',
        kernelInitializer: tf.initializers.glorotUniform({ seed: 2 }),
      }),
    );

    let artifacts: tf.io.ModelArtifacts | undefined;
    await model.save(
      tf.io.withSaveHandler(async (a) => {
        artifacts = a;
        return {
          modelArtifactsInfo: { dateSaved: new Date(), modelTopologyType: 'JSON' },
        };
      }),
    );
    if (!artifacts) throw new Error('no artifacts captured');

    const { weightSpecs, weightData } = artifacts;
    if (!weightSpecs || !weightData) throw new Error('missing weights');
    const buf = Array.isArray(weightData) ? tf.io.concatenateArrayBuffers(weightData) : weightData;

    const modelJson = {
      modelTopology: artifacts.modelTopology,
      format: artifacts.format,
      generatedBy: artifacts.generatedBy,
      convertedBy: artifacts.convertedBy,
      weightsManifest: [{ paths: ['weights.bin'], weights: weightSpecs }],
    };
    await writeFile(join(dir, 'model.json'), JSON.stringify(modelJson));
    await writeFile(join(dir, 'weights.bin'), new Uint8Array(buf));

    const requested: string[] = [];
    const fetchFunc = async (input: RequestInfo | URL): Promise<Response> => {
      const url = String(input);
      requested.push(url);
      const name = url.split('/').pop() ?? '';
      if (name !== 'model.json' && name !== 'weights.bin') {
        return new Response('not found', { status: 404 });
      }
      const data = await readFile(join(dir, name));
      return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
          'Content-Type': name === 'model.json' ? 'application/json' : 'application/octet-stream',
        },
      });
    };

    const loaded = await tf.loadLayersModel('http://localhost/models/classifier/model.json', {
      fetchFunc: fetchFunc as typeof fetch,
    });

    expect(requested.some((u) => u.endsWith('/models/classifier/weights.bin'))).toBe(true);

    const input = tf.tensor2d([
      [0.1, -0.5, 0.9, 0.3],
      [1, 2, 3, 4],
      [-1, 0, 0.5, -0.2],
    ]);
    const expected = (model.predict(input) as tf.Tensor).arraySync() as number[][];
    const actual = (loaded.predict(input) as tf.Tensor).arraySync() as number[][];
    for (let i = 0; i < expected.length; i++) {
      for (let j = 0; j < 3; j++) {
        expect(actual[i]?.[j] ?? NaN).toBeCloseTo(expected[i]?.[j] ?? 0, 5);
      }
    }
    input.dispose();
  });
});
