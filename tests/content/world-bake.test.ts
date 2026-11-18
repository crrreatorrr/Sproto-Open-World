import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `npm run bake:world` is deterministic (plan §3.6): baking Sproutvale again into a temp dir gives
 * byte-identical files to the committed public/world/sproutvale, and `--check` agrees.
 */
const ROOT = path.resolve(__dirname, '../..');
const COMMITTED = path.join(ROOT, 'public/world/sproutvale');
const VITE_NODE = path.join(ROOT, 'node_modules/.bin/vite-node');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bake-world-'));
const fresh = path.join(tmp, 'fresh');
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const list = (dir: string, base = ''): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? list(path.join(dir, e.name), `${base}${e.name}/`) : [`${base}${e.name}`])).sort();

describe('bake:world', () => {
  it('re-baking Sproutvale gives the committed bytes', () => {
    execFileSync(VITE_NODE, ['tools/bake-world.ts', '--', 'sproutvale', '--out', fresh], { cwd: ROOT, stdio: 'pipe' });
    const files = list(fresh);
    // The map picture comes from `npm run bake:map`, not this bake.
    expect(files).toEqual(list(COMMITTED).filter((f) => f !== 'map.webp'));
    for (const f of files) expect(fs.readFileSync(path.join(fresh, f)).equals(fs.readFileSync(path.join(COMMITTED, f))), f).toBe(true);
  }, 120_000);

  it('--check passes on the committed output and fails on a stale file', () => {
    execFileSync(VITE_NODE, ['tools/bake-world.ts', '--', 'sproutvale', '--check'], { cwd: ROOT, stdio: 'pipe' });
    const stale = path.join(tmp, 'stale');
    fs.cpSync(COMMITTED, stale, { recursive: true });
    const victim = path.join(stale, 'cells/c_3_0.json');
    fs.writeFileSync(victim, fs.readFileSync(victim, 'utf8').replace('"cx":3', '"cx":3 '));
    expect(() => execFileSync(VITE_NODE, ['tools/bake-world.ts', '--', 'sproutvale', '--check', '--out', stale], { cwd: ROOT, stdio: 'pipe' })).toThrow();
  }, 120_000);
});
