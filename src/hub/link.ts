import { createHubSdk, isGameId, type HubSdk } from '@metaverse/hub-sdk/core';
import { HUB_GAME_ID } from './config';
import { pageServerKey } from './serverKey';

/**
 * The hub SDK for this visit, or null when the hub cannot know it. Only the feedback window uses it
 * today: this game reports no events, earns no Tickets and keeps its saves in the browser.
 *
 * A portal visit arrives as `#t=<ticket>`; `init` redeems it (and strips it from the address) or
 * picks up the session cached for this tab. With neither, `init` makes no request and the SDK
 * answers `standalone`. While the vendored SDK does not list HUB_GAME_ID, nothing is redeemed.
 */
export async function connectHub(): Promise<HubSdk | null> {
  if (!isGameId(HUB_GAME_ID)) return null;
  const sdk = createHubSdk({ serverUrl: nakamaUrl(), serverKey: pageServerKey(), hubUrl: hubPageUrl() });
  try {
    await sdk.init(HUB_GAME_ID);
  } catch (err) {
    // A ticket that would not redeem: play on standalone.
    console.warn('[hub] no hub session', err);
  }
  return sdk;
}

/** Nakama's HTTP origin (VITE_NAKAMA_URL; the hub's compose default in dev). */
function nakamaUrl(): string {
  return (import.meta.env.VITE_NAKAMA_URL || 'http://127.0.0.1:7350').replace(/\/$/, '');
}

/** Build-time hub page. The default is same-origin `/hub/`. */
function hubPageUrl(): string {
  const configured = import.meta.env.VITE_HUB_URL?.trim();
  return configured ? configured.split('#')[0] : '/hub/';
}
