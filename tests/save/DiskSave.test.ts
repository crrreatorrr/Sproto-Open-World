import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISK_SAVE_URL, newerSave, readDiskSave, writeDiskSave } from '../../src/save/DiskSave';
import { DATA_EPOCH_SCHEMA } from '../../src/save/dataEpoch';
import { SAVE_SCHEMA, type SaveFile } from '../../src/save/schema';
import { createLocalSaveHandler } from '../../tools/localSavePlugin';

/** Local save mode: the dev server's save file and the browser code that keeps it in step. */

const fixture = (): SaveFile => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `save-v${SAVE_SCHEMA}.json`), 'utf8'));
const at = (iso: string, sprouts = 0): SaveFile => ({ ...fixture(), savedAt: iso, player: { ...fixture().player, sprouts } });

let dir: string;
let server: http.Server;
let base: string;
/** fetch against the test server, as the game would against the dev server. */
const local = (url: string, init?: RequestInit) => fetch(base + url, init);

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sow-local-save-'));
  const handle = createLocalSaveHandler(dir);
  server = http.createServer((req, res) => {
    if (req.url?.startsWith(DISK_SAVE_URL)) void handle(req, res);
    else {
      res.statusCode = 200; // like Vite's SPA fallback: an HTML page for any unknown route
      res.end('<!doctype html>');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(() => {
  for (const f of fs.readdirSync(dir)) fs.rmSync(path.join(dir, f));
});

describe('local save file (dev server)', () => {
  it('no file yet: available, no save, the path shown', async () => {
    const r = await readDiskSave(local);
    expect(r.available).toBe(true);
    expect(r.save).toBeNull();
    expect(r.error).toBeNull();
    expect(r.path).toMatch(/save\.json$/);
  });

  it('round trip: write then read gives the same save', async () => {
    expect(await writeDiskSave(at('2026-11-20T10:00:00.000Z', 7), local)).toBe(true);
    const r = await readDiskSave(local);
    expect(r.save).toEqual(at('2026-11-20T10:00:00.000Z', 7));
    expect(r.fromBackup).toBe(false);
  });

  it('each write keeps the previous good file as the backup', async () => {
    await writeDiskSave(at('2026-11-20T10:00:00.000Z', 1), local);
    await writeDiskSave(at('2026-11-20T10:05:00.000Z', 2), local);
    const bak = JSON.parse(fs.readFileSync(path.join(dir, 'save.bak.json'), 'utf8')) as SaveFile;
    expect(bak.player.sprouts).toBe(1);
  });

  it('a damaged file is answered with its backup, and never copied over it', async () => {
    await writeDiskSave(at('2026-11-20T10:00:00.000Z', 1), local);
    await writeDiskSave(at('2026-11-20T10:05:00.000Z', 2), local);
    fs.writeFileSync(path.join(dir, 'save.json'), '{"schema": 4, "pla');
    const r = await readDiskSave(local);
    expect(r.fromBackup).toBe(true);
    expect(r.save?.player.sprouts).toBe(1);
    await writeDiskSave(at('2026-11-20T10:10:00.000Z', 3), local);
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'save.bak.json'), 'utf8')).player.sprouts).toBe(1);
  });

  it('refuses a body that is not a save', async () => {
    for (const body of ['nope', '"hello"', '{"schema": 4}', '[]']) {
      const res = await local(DISK_SAVE_URL, { method: 'PUT', body });
      expect(res.status).toBe(400);
    }
    expect(fs.existsSync(path.join(dir, 'save.json'))).toBe(false);
  });

  it('a file from a newer build is reported, not loaded', async () => {
    fs.writeFileSync(path.join(dir, 'save.json'), JSON.stringify({ ...fixture(), schema: SAVE_SCHEMA + 1 }));
    const r = await readDiskSave(local);
    expect(r.save).toBeNull();
    expect(r.newerBuild).toBe(true);
  });

  it('a file from before the data epoch is ignored, so the wipe sticks (the next save replaces it)', async () => {
    const old = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `save-v${DATA_EPOCH_SCHEMA - 1}.json`), 'utf8'));
    fs.writeFileSync(path.join(dir, 'save.json'), JSON.stringify(old));
    const r = await readDiskSave(local);
    expect(r.available).toBe(true);
    expect(r.save).toBeNull();
    expect(r.error).toBeNull();
    expect(await writeDiskSave(fixture(), local)).toBe(true);
    expect((await readDiskSave(local)).save?.schema).toBe(SAVE_SCHEMA);
  });

  it('a server without the endpoint (an HTML fallback, or none at all) is unavailable', async () => {
    const html = (url: string) => fetch(base + '/elsewhere' + url);
    expect((await readDiskSave(html)).available).toBe(false);
    const down = () => Promise.reject(new TypeError('Failed to fetch'));
    expect((await readDiskSave(down)).available).toBe(false);
    expect(await writeDiskSave(fixture(), down)).toBe(false);
  });
});

describe('newerSave', () => {
  const a = at('2026-11-20T10:00:00.000Z');
  const b = at('2026-11-20T11:00:00.000Z');
  it('the one written last wins', () => {
    expect(newerSave(a, b)).toBe('disk');
    expect(newerSave(b, a)).toBe('local');
    expect(newerSave(a, at(a.savedAt))).toBe('same');
  });
  it('a missing side loses', () => {
    expect(newerSave(null, b)).toBe('disk');
    expect(newerSave(a, null)).toBe('local');
    expect(newerSave(null, null)).toBe('same');
  });
  it('an unreadable time loses', () => {
    expect(newerSave(a, at('garbage'))).toBe('local');
    expect(newerSave(at('garbage'), b)).toBe('disk');
  });
});
