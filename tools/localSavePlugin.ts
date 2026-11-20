/**
 * Local save mode (dev server only). The game's save normally lives in the browser's localStorage,
 * which is separate for every origin, so each dev server port (and each worktree on its own port)
 * had its own progress. This plugin keeps one save file on disk that every dev server shares:
 *
 *   GET  /__sow/save   the save file (204 when there is none; the backup when the file is damaged)
 *   PUT  /__sow/save   write it; the previous good file is kept as save.bak.json
 *
 * The file is `~/.sproto-open-world/save.json`; `SOW_SAVE_DIR` moves it and `SOW_LOCAL_SAVE=0`
 * turns the endpoint off. The game falls back to localStorage alone when the endpoint is missing
 * (production, `vite preview`). Nothing is sent anywhere but this folder.
 */
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import type { Plugin } from 'vite';

export const LOCAL_SAVE_ROUTE = '/__sow/save';
/** A save is about 20 KB; anything far bigger is not a save. */
const MAX_BODY = 1024 * 1024;

export function defaultSaveDir(): string {
  return process.env.SOW_SAVE_DIR || path.join(os.homedir(), '.sproto-open-world');
}

/** The path as shown to the player: the home folder written as `~`. */
export function displayPath(file: string): string {
  const home = os.homedir();
  return file.startsWith(home + path.sep) ? `~${file.slice(home.length)}` : file;
}

function readJson(file: string): string | null {
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return null;
  }
}

function readBody(req: IncomingMessage): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, body = '', type = 'text/plain'): void {
  res.statusCode = status;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

/** True for something shaped like a save file: an object with a numeric schema and a savedAt time. */
function looksLikeSave(v: unknown): boolean {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return typeof o.schema === 'number' && typeof o.savedAt === 'string';
}

/** The request handler, on its own so tests can mount it on a plain http server. */
export function createLocalSaveHandler(dir: string) {
  const file = path.join(dir, 'save.json');
  const bak = path.join(dir, 'save.bak.json');
  const shown = displayPath(file);
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    res.setHeader('X-Sow-Save-Path', shown);
    try {
      if (req.method === 'GET') {
        const main = readJson(file);
        if (main !== null) return send(res, 200, main, 'application/json');
        const backup = readJson(bak);
        if (backup !== null) {
          res.setHeader('X-Sow-From-Backup', '1');
          return send(res, 200, backup, 'application/json');
        }
        // No save yet is 204, not 404: the browser logs a 404 as an error.
        return fs.existsSync(file) ? send(res, 500, 'save file damaged') : send(res, 204);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        if (body === null) return send(res, 413, 'too large');
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return send(res, 400, 'not valid JSON');
        }
        if (!looksLikeSave(parsed)) return send(res, 400, 'not a save file');
        fs.mkdirSync(dir, { recursive: true });
        // Keep the current file as the backup, but only when it is readable: a damaged file never
        // replaces a good backup.
        const current = readJson(file);
        if (current !== null) fs.writeFileSync(bak, current);
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, body);
        fs.renameSync(tmp, file);
        return send(res, 204);
      }
      res.setHeader('Allow', 'GET, PUT');
      return send(res, 405, 'method not allowed');
    } catch (e) {
      return send(res, 500, e instanceof Error ? e.message : String(e));
    }
  };
}

export function localSavePlugin(dir: string = defaultSaveDir()): Plugin {
  return {
    name: 'sow-local-save',
    apply: 'serve',
    configureServer(server) {
      if (process.env.SOW_LOCAL_SAVE === '0') return;
      const handle = createLocalSaveHandler(dir);
      server.middlewares.use(LOCAL_SAVE_ROUTE, (req, res) => void handle(req, res));
    },
  };
}
