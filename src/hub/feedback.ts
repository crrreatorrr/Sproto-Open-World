/**
 * In-game feedback, as in Sproto Duel and Sproto Shooter: N twice, or Send feedback on the pause
 * menu, opens the hub SDK's feedback window (options, a note, a screenshot). The window, the
 * screenshot and the sending live in the vendored SDK (`@metaverse/hub-sdk/feedback`); this is only
 * Sproto Open World's adapter: how to freeze and unfreeze the game, what "right now" looks like,
 * which sim events are worth a breadcrumb, the window's colors, and driving it with a pad
 * (feedbackPad.ts). Notes send only from a signed-in hub visit (hub/link.ts). See docs/feedback.md
 * in metaverse-hub.
 *
 * App loads this off the boot path, about a second after the title is up.
 */
import { feedbackTransportFromSdk, installFeedback, type FeedbackContext, type FeedbackHandle, type FeedbackTransport } from '@metaverse/hub-sdk/feedback';
import type { HubSdk } from '@metaverse/hub-sdk/core';
import type { SimEvent } from '../sim/events';
import type { EntityId } from '../sim/entity';
import { FeedbackPad, type FeedbackDom, type FeedbackPadInput } from './feedbackPad';

/** Matches src/styles.css (--panel, --panel-edge, --accent, --ink) and the menus' rounded type. */
export const FEEDBACK_THEME = Object.freeze({
  font: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
  titleFont: "ui-rounded, 'SF Pro Rounded', 'Segoe UI', system-ui, sans-serif",
  background: 'rgba(10, 14, 8, 0.7)',
  panel: 'rgba(22, 30, 18, 0.97)',
  text: '#fdf8ec',
  muted: '#d8d0bc',
  accent: '#f0c548',
  accentText: '#2a2008',
  border: 'rgba(240, 214, 120, 0.35)',
  radius: '12px',
  // A pad moves the focus with focus(), which not every browser marks as :focus-visible.
  css: '.title { color: #f0c548; } .chip:focus, .mini:focus, .btn:focus { outline: 2px solid #f0c548; outline-offset: 2px; }',
});

/** What the game knows about this moment (App.feedbackSnapshot). Plain data only. */
export type FeedbackSnapshot = FeedbackContext;

/** What the adapter needs from App. App builds it; tests drive it with a stand-in. */
export interface FeedbackHost {
  snapshot(): FeedbackSnapshot;
  /**
   * Freeze the game, right before the screenshot (and before the SDK releases the mouse, so the
   * token can say whether play had it). The token comes back to `release`.
   */
  hold(): unknown;
  release(token: unknown): void;
  /** Draw one frame now: the drawing buffer is not preserved, and the loop skips frozen frames. */
  renderNow(): void;
  canvas(): HTMLCanvasElement;
  /** The pad's glyph for a button on the pad in hand, or null while the keyboard is in use. */
  padGlyph(button: string): string | null;
  /** Every sim event, after the tick that raised it. */
  onSimEvent(fn: (e: SimEvent, me: EntityId | null) => void): void;
}

/** App's handle on the window: open it, and hand it the pad while the game is held for it. */
export interface FeedbackWindow {
  open(): void;
  frame(pad: FeedbackPadInput): void;
}

/**
 * The sim events worth a breadcrumb (the last 24 ride along with a note), and the few fields of
 * each that say what happened. Only the local player's own events, plus the world's.
 */
export function breadcrumbFor(e: SimEvent, me: EntityId | null): { type: string; data?: Record<string, unknown> } | null {
  const mine = 'entity' in e && e.entity === me;
  switch (e.type) {
    case 'death':
      return e.entity === me ? { type: 'death', data: { killer: e.killer } } : null;
    case 'respawn':
      return mine ? { type: 'respawn' } : null;
    case 'levelUp':
      return mine ? { type: 'level_up', data: { level: e.level } } : null;
    case 'questStarted':
    case 'questComplete':
      return mine ? { type: e.type === 'questStarted' ? 'quest_start' : 'quest_complete', data: { quest: e.quest } } : null;
    case 'questStep':
      return mine ? { type: 'quest_step', data: { quest: e.quest, step: e.step } } : null;
    case 'shrineRest':
      return mine ? { type: 'shrine_rest', data: { shrine: e.shrine } } : null;
    case 'portalTravel':
      return mine ? { type: 'portal', data: { portal: e.portal, to: e.to } } : null;
    case 'spellLearned':
      return mine ? { type: 'spell_learned', data: { spell: e.spell } } : null;
    case 'equip':
      return mine ? { type: 'equip', data: { slot: e.slot, item: e.item } } : null;
    case 'mount':
      return mine && (e.phase === 'seated' || e.phase === 'off') ? { type: e.phase === 'seated' ? 'mounted' : 'dismounted' } : null;
    case 'refused':
      return mine ? { type: 'refused', data: { action: e.action, reason: e.reason } } : null;
    case 'bossIntro':
      return { type: 'boss_intro', data: { boss: e.boss } };
    case 'bossPhase':
      return { type: 'boss_phase', data: { boss: e.boss, phase: e.phase } };
    case 'bossDefeated':
      return { type: 'boss_defeated', data: { boss: e.boss } };
    case 'gateOpened':
      return { type: 'gate_opened', data: { gate: e.gate } };
    case 'wave':
      return { type: 'wave', data: { wave: e.wave, loop: e.loop } };
    case 'waveClear':
      return { type: 'wave_clear', data: { wave: e.wave } };
    default:
      return null;
  }
}

/** Standalone play: no hub session, so the SDK shows its one-line "play from the hub" message. */
const STANDALONE: FeedbackTransport = {
  access: () => Promise.resolve({ ok: false, reason: 'standalone' }),
  submit: () => Promise.reject(Object.assign(new Error('Feedback needs a hub session'), { code: 'standalone' })),
};

/**
 * Dev and QA builds only, with `?feedbackMock` in the address: a transport that accepts every note
 * and keeps it on `window.__feedbackSent`, so the smoke test can drive the whole window with a pad.
 * Production builds drop this (import.meta.env is constant there).
 */
function mockTransport(): FeedbackTransport | null {
  if (!(import.meta.env.DEV || import.meta.env.VITE_QA === '1')) return null;
  if (!new URLSearchParams(location.search).has('feedbackMock')) return null;
  const sent: unknown[] = [];
  (window as unknown as { __feedbackSent?: unknown[] }).__feedbackSent = sent;
  return {
    access: () => Promise.resolve({ ok: true, username: 'qa' }),
    submit: (input) => {
      sent.push(input);
      return Promise.resolve({ id: `qa-${sent.length}` });
    },
  };
}

function transportFor(sdk: HubSdk | null): FeedbackTransport {
  const mock = mockTransport();
  if (mock) return mock;
  return sdk ? feedbackTransportFromSdk(sdk) : STANDALONE;
}

/** Install the shortcut and the window. Returns null if the SDK refused (the game plays on). */
export function installGameFeedback(host: FeedbackHost, sdk: HubSdk | null): FeedbackWindow | null {
  const pad = new FeedbackPad(document as unknown as FeedbackDom);
  // The screenshot is taken a frame after the window is asked for, and the page's HTML can take
  // a moment to draw: the game is held from the screenshot on, not from when the window appears.
  let token: unknown = false;
  let handle: FeedbackHandle;
  try {
    handle = installFeedback({
      title: 'Sproto Open World',
      version: __BUILD_ID__,
      transport: transportFor(sdk),
      beforeCapture: () => {
        token = host.hold();
        host.renderNow();
      },
      pause: () => token,
      resume: (t) => {
        token = false;
        host.release(t);
      },
      onOpen: () => {
        if (host.padGlyph('a') === null) return;
        pad.focusFirst();
        pad.hint((b) => host.padGlyph(b) ?? b);
      },
      context: () => host.snapshot(),
      canvases: () => [host.canvas()],
      theme: FEEDBACK_THEME,
    });
  } catch (err) {
    // Feedback is an extra: it never stops the game.
    console.warn('[feedback] not installed', err);
    return null;
  }

  host.onSimEvent((e, me) => {
    const crumb = breadcrumbFor(e, me);
    if (crumb) handle.breadcrumb(crumb.type, crumb.data);
  });

  return {
    open: () => handle.open(),
    frame: (input) => pad.frame(input, () => handle.close()),
  };
}
