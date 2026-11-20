/**
 * Nakama's client server key. Ticket redeem sends it as Basic auth. It is not the runtime HTTP key
 * and not a secret. A production build takes VITE_NAKAMA_SERVER_KEY, or every redeem is refused and
 * the game runs without a hub session. `vite dev` and a page opened on loopback fall back to Nakama's
 * stock key (the same rule as Sproto Duel and Sproto Shooter).
 */
export const LOCAL_SERVER_KEY = 'defaultkey';

const LOOPBACK_HOST = /^(localhost|[\w-]+\.localhost|127(?:\.\d{1,3}){3}|\[::1\]|::1)$/i;

export function nakamaServerKey(opts: { envKey?: string; dev?: boolean; hostname?: string }): string {
  if (opts.envKey) return opts.envKey;
  if (opts.dev) return LOCAL_SERVER_KEY;
  return LOOPBACK_HOST.test(opts.hostname ?? '') ? LOCAL_SERVER_KEY : '';
}

/** The key for this page. */
export function pageServerKey(): string {
  return nakamaServerKey({
    envKey: import.meta.env.VITE_NAKAMA_SERVER_KEY,
    dev: import.meta.env.DEV,
    hostname: typeof location !== 'undefined' ? location.hostname : '',
  });
}
