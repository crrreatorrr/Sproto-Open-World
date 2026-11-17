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
}

export function installQa(api: QaApi): void {
  (window as unknown as { __qa: QaApi }).__qa = api;
}
