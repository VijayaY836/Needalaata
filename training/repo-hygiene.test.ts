// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '..');

/** Returns the exit status of `git check-ignore -q <path>` (0 = ignored, 1 = not ignored). */
function checkIgnore(path: string): number {
  try {
    execFileSync('git', ['check-ignore', '-q', path], { cwd: root, stdio: 'ignore' });
    return 0;
  } catch (err) {
    const status = (err as { status?: number | null }).status;
    if (typeof status !== 'number') throw err;
    return status;
  }
}

describe('repository hygiene', () => {
  // Validates: Requirements 2.14, 7.5, 7.7
  it.each([
    'public/models/hand_landmarker.task',
    'public/wasm/',
    'data/raw/example.json',
    'data/contributors.json',
    'training/out/report.json',
  ])('ignores %s', (path) => {
    expect(checkIgnore(path)).toBe(0);
  });

  it.each([
    'public/models/classifier/model.json',
    'public/models/classifier/weights.bin',
    'public/models/classifier/metadata.json',
  ])('does not ignore shipped model artifact %s', (path) => {
    expect(checkIgnore(path)).toBe(1);
  });

  it.each([
    '.kiro/specs/classifier/design.md',
    '.kiro/steering/product.md',
    '.kiro/settings/mcp.json',
  ])('does not ignore %s', (path) => {
    expect(checkIgnore(path)).toBe(1);
  });

  // Validates: Requirement 8.13
  it('does not pin the Node version', () => {
    const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as Record<string, unknown>;
    expect(pkg).not.toHaveProperty('engines');
    expect(existsSync(resolve(root, '.nvmrc'))).toBe(false);
  });
});
