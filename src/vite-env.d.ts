/// <reference types="vite/client" />

declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  /** '1' in a QA build (`vite build --mode qa`): keeps window.__qa and the debug overlay. */
  readonly VITE_QA?: string;
  /** Nakama's HTTP origin for hub visits (src/hub/link.ts). Default: the hub's local compose server. */
  readonly VITE_NAKAMA_URL?: string;
  /** Nakama's client server key (not a secret; src/hub/serverKey.ts). */
  readonly VITE_NAKAMA_SERVER_KEY?: string;
  /** The hub page. Default: same-origin `/hub/`. */
  readonly VITE_HUB_URL?: string;
}
