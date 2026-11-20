import { describe, expect, it } from 'vitest';
import { breadcrumbFor } from '../../src/hub/feedback';
import { FeedbackPad, type FeedbackDom, type FeedbackPadInput } from '../../src/hub/feedbackPad';
import { LOCAL_SERVER_KEY, nakamaServerKey } from '../../src/hub/serverKey';
import { RESERVED_KEYS, bindKey, defaultControlPrefs } from '../../src/input/controlPrefs';
import type { SimEvent } from '../../src/sim/events';

const ME = 7;

describe('feedback breadcrumbs', () => {
  it('records the local player’s milestones and the world’s', () => {
    expect(breadcrumbFor({ type: 'death', entity: ME, killer: 3 }, ME)).toEqual({ type: 'death', data: { killer: 3 } });
    expect(breadcrumbFor({ type: 'questComplete', entity: ME, quest: 'q1' }, ME)).toEqual({ type: 'quest_complete', data: { quest: 'q1' } });
    expect(breadcrumbFor({ type: 'levelUp', entity: ME, level: 4, points: 1 }, ME)).toEqual({ type: 'level_up', data: { level: 4 } });
    expect(breadcrumbFor({ type: 'bossPhase', boss: 9, phase: 2 }, ME)).toEqual({ type: 'boss_phase', data: { boss: 9, phase: 2 } });
    expect(breadcrumbFor({ type: 'mount', entity: ME, mount: 2, phase: 'seated' }, ME)).toEqual({ type: 'mounted' });
  });

  it('skips other entities’ events and the per-hit noise', () => {
    expect(breadcrumbFor({ type: 'death', entity: 12, killer: ME }, ME)).toBeNull();
    expect(breadcrumbFor({ type: 'questComplete', entity: 12, quest: 'q1' }, ME)).toBeNull();
    expect(breadcrumbFor({ type: 'mount', entity: ME, mount: 2, phase: 'start' }, ME)).toBeNull();
    const hit = { type: 'hit', attacker: ME, target: 12 } as unknown as SimEvent;
    expect(breadcrumbFor(hit, ME)).toBeNull();
    expect(breadcrumbFor({ type: 'jump', entity: ME }, ME)).toBeNull();
  });
});

describe('the Nakama server key', () => {
  it('takes the build key, else the stock key in dev or on loopback, else none', () => {
    expect(nakamaServerKey({ envKey: 'k', dev: false, hostname: 'example.com' })).toBe('k');
    expect(nakamaServerKey({ dev: true, hostname: 'example.com' })).toBe(LOCAL_SERVER_KEY);
    expect(nakamaServerKey({ dev: false, hostname: '127.0.0.1' })).toBe(LOCAL_SERVER_KEY);
    expect(nakamaServerKey({ dev: false, hostname: 'localhost' })).toBe(LOCAL_SERVER_KEY);
    expect(nakamaServerKey({ dev: false, hostname: 'example.com' })).toBe('');
  });
});

describe('N belongs to the feedback window', () => {
  it('cannot be bound to an action', () => {
    expect(RESERVED_KEYS.has('KeyN')).toBe(true);
    const r = bindKey(defaultControlPrefs(), 'jump', 1, 'KeyN');
    expect(r.ok).toBe(false);
  });
});

/** A stand-in for the SDK's window: buttons in its order, a shadow root that tracks focus. */
function fakeWindow(opts: { open?: boolean; sendDisabled?: boolean } = {}) {
  const log: string[] = [];
  const root = { activeElement: null as unknown };
  const button = (name: string, cls: string, disabled = false) => {
    const b = {
      name, cls, disabled,
      focus: () => {
        root.activeElement = b;
      },
      click: () => log.push(`click ${name}`),
    };
    return b;
  };
  const chips = ['broke', 'unclear', 'too_hard'].map((c) => button(c, 'chip'));
  const close = button('close', 'btn');
  const send = button('send', 'btn primary', opts.sendDisabled ?? false);
  const all = [...chips, button('draw', 'mini'), button('undo', 'mini'), close, send];
  const hintText: string[] = ['1–7 pick · Enter send · Esc close'];
  const hint = { dataset: {} as DOMStringMap, append: (t: string) => hintText.push(t), querySelector: () => null, querySelectorAll: () => [] };
  const panel = {
    querySelectorAll: () => all,
    querySelector: (sel: string) => (sel === '.btn.primary' ? send : sel === '.hint' ? hint : null),
    append() {},
  };
  const shadow = { get activeElement() { return root.activeElement; }, querySelector: (sel: string) => (sel === '.panel' && opts.open !== false ? panel : null) };
  const dom = { querySelector: () => ({ shadowRoot: shadow }) } as unknown as FeedbackDom;
  const focused = () => (root.activeElement as { name?: string } | null)?.name ?? null;
  return { dom, log, focused, hintText };
}

function padPress(...buttons: string[]): FeedbackPadInput {
  return { wasPressed: (bs) => bs.some((b) => buttons.includes(b)), move: { x: 0, y: 0 } };
}
const stick = (x: number, y: number): FeedbackPadInput => ({ wasPressed: () => false, move: { x, y } });

describe('the feedback window on a pad', () => {
  it('moves the focus with the D-pad, wrapping, and presses with A', () => {
    const w = fakeWindow();
    const pad = new FeedbackPad(w.dom);
    let closed = 0;
    const close = () => closed++;
    pad.focusFirst();
    expect(w.focused()).toBe('broke');
    pad.frame(padPress('down'), close);
    expect(w.focused()).toBe('unclear');
    pad.frame(padPress('a'), close);
    expect(w.log).toEqual(['click unclear']);
    pad.frame(padPress('up'), close);
    pad.frame(padPress('up'), close);
    expect(w.focused()).toBe('send');
    expect(closed).toBe(0);
  });

  it('moves once per stick push', () => {
    const w = fakeWindow();
    const pad = new FeedbackPad(w.dom);
    pad.focusFirst();
    pad.frame(stick(0, 1), () => {});
    pad.frame(stick(0, 1), () => {});
    expect(w.focused()).toBe('unclear');
    pad.frame(stick(0, 0), () => {});
    pad.frame(stick(1, 0), () => {});
    expect(w.focused()).toBe('too_hard');
  });

  it('B closes and Start sends (only when Send is enabled)', () => {
    const w = fakeWindow();
    const pad = new FeedbackPad(w.dom);
    let closed = 0;
    pad.frame(padPress('b'), () => closed++);
    expect(closed).toBe(1);
    pad.frame(padPress('start'), () => {});
    expect(w.log).toEqual(['click send']);
    const off = fakeWindow({ sendDisabled: true });
    new FeedbackPad(off.dom).frame(padPress('start'), () => {});
    expect(off.log).toEqual([]);
  });

  it('skips disabled buttons and does nothing while only a toast is up', () => {
    const w = fakeWindow({ sendDisabled: true });
    const pad = new FeedbackPad(w.dom);
    expect(pad.targets()).toHaveLength(6);
    const closedWin = fakeWindow({ open: false });
    let closed = 0;
    const p2 = new FeedbackPad(closedWin.dom);
    expect(p2.open).toBe(false);
    p2.frame(padPress('b'), () => closed++);
    expect(closed).toBe(0);
  });

  it('adds the pad buttons to the key hint once', () => {
    const w = fakeWindow();
    const pad = new FeedbackPad(w.dom);
    pad.hint((b) => b.toUpperCase());
    pad.hint((b) => b.toUpperCase());
    expect(w.hintText).toEqual(['1–7 pick · Enter send · Esc close', ' · A pick · B close · START send']);
  });
});
