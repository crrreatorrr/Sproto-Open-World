import { qaLog, type QaEntry } from './qaLog';

/**
 * `window.__qa`: hooks for the Playwright smoke test and manual QA. Installed only in dev and QA
 * builds (`vite build --mode qa`); scripts/check-prod-debug.mjs fails a production build that
 * contains it.
 */
export interface QaApi {
  ready: boolean;
  state(): Record<string, unknown>;
  clips(): string[];
  playClip(name: string): boolean;
  /** The running app, for poking at in the console (dev and QA builds only). */
  app: unknown;
  /** The M1a timing log (debug/qaLog.ts); `log(true)` returns it and clears it. */
  log?(clear?: boolean): QaEntry[];
  /** Rendered frames so far. */
  frame?(): number;
}

export function installQa(api: QaApi): void {
  api.log ??= (clear = false) => {
    const out = qaLog.entries.slice();
    if (clear) qaLog.clear();
    return out;
  };
  api.frame ??= () => qaLog.frame;
  (window as unknown as { __qa: QaApi }).__qa = api;
}
