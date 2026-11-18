/// <reference types="vite/client" />

declare const __BUILD_ID__: string;

interface ImportMetaEnv {
  /** '1' in a QA build (`vite build --mode qa`): keeps window.__qa and the debug overlay. */
  readonly VITE_QA?: string;
}
