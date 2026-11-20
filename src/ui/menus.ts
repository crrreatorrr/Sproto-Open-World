import { CLASSES, CLASS_IDS, type ClassId } from '../content/classes';
import { padGlyph, PAD_BUTTONS, type GamepadInput } from '../input/Gamepad';
import {
  ACTION_LABELS, KEY_ACTIONS, KEY_SLOTS, PAD_ACTIONS, bindKey, bindPad, clearKey, defaultControlPrefs,
  type ControlPrefs, type KeyAction, type PadAction,
} from '../input/controlPrefs';
import type { Input } from '../input/Input';
import { keyLabel } from '../input/glyphs';
import type { MenuNav, Screen } from './MenuNav';
import type { Settings } from './settings';
import { SETTING_GROUPS, settingRow } from './settingsRows';

export interface MenuActions {
  /** New game (Play), as the class picked on the class screen. */
  play(cls: ClassId): void;
  /** Continue from the save (offered on the title only when one loaded). */
  continueGame(): void;
  resume(): void;
  quitToTitle(): void;
  /** Leave for the hub plaza (its ring for this game), signed in or not. */
  returnToHub(): void;
  settingsChanged(s: Settings): void;
  controlsChanged(p: ControlPrefs): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** The hub account as the title shows it (src/hub/link.ts, src/save/slot.ts). */
export interface HubChip {
  status: 'connecting' | 'connected' | 'guest' | 'offline' | 'error';
  /** The hub username, or `Guest`. */
  label: string;
  /** The error code, when `status` is `error`. */
  error: string;
  /** Whose save the title shows: the account's (cloud) or this browser's. */
  owner: 'device' | 'pending' | 'account';
  sync: 'local' | 'syncing' | 'synced' | 'offline' | 'error';
}

const SYNC_TEXT: Record<HubChip['sync'], string> = {
  local: '',
  syncing: 'syncing your save…',
  synced: 'save in the cloud',
  offline: 'cloud save will retry',
  error: "cloud save failed (kept on this browser)",
};

/** The chip's text: who is signed in and where the save lives. */
export function hubChipText(h: HubChip): string {
  if (h.status === 'connecting' || h.owner === 'pending') return 'Signing in to the hub…';
  const account = h.status === 'error' ? `Hub: ${h.error || 'error'}` : h.status === 'offline' ? 'Not signed in' : h.label;
  const where = h.owner === 'account' ? SYNC_TEXT[h.sync] : 'saves on this browser';
  return where ? `${account} · ${where}` : account;
}

function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.dataset.nav = '';
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** Builds the title, pause, settings and controls screens (all reachable by pad only). */
export class Menus {
  readonly root: HTMLElement;
  readonly title: Screen;
  readonly pause: Screen;
  readonly settings: Screen;
  readonly controls: Screen;
  /** A new save's first choice: Wizard, Soldier or Pepe. */
  readonly classes: Screen;
  private captureState: { kind: 'key'; action: KeyAction; slot: number } | { kind: 'pad'; action: PadAction } | null = null;
  private captureTimer = 0;
  private note = '';
  /** The title's save state: whether Continue is offered, and a notice about a damaged save. */
  private titleSave: { canContinue: boolean; notice: string; diskPath: string | null } = { canContinue: false, notice: '', diskPath: null };
  private hub: HubChip = { status: 'offline', label: '', error: '', owner: 'device', sync: 'local' };

  constructor(
    host: HTMLElement,
    private readonly nav: MenuNav,
    private readonly input: Input,
    private readonly actions: MenuActions,
    private settingsValue: Settings,
    private prefs: ControlPrefs,
  ) {
    this.root = el('div', 'menus');
    host.appendChild(this.root);
    this.title = this.makeTitle();
    this.pause = this.makePause();
    this.settings = this.makeSettings();
    this.controls = this.makeControls();
    this.classes = this.makeClasses();
    input.onKeyDown((code, e) => this.onCaptureKey(code, e));
  }

  private screen(id: string): HTMLElement {
    const s = el('section', 'screen');
    s.id = id;
    this.root.appendChild(s);
    return s;
  }

  /**
   * Tell the title about the save (plan §2.8): with one, Continue comes first and Play becomes
   * New game; `notice` says when the save was damaged (loaded from the backup, or not at all).
   * `diskPath`: local save mode is on and keeps the save in this file (dev servers).
   */
  setSave(canContinue: boolean, notice = '', diskPath: string | null = this.titleSave.diskPath): void {
    this.titleSave = { canContinue, notice, diskPath };
    if (this.nav.top === this.title) this.nav.refresh();
  }

  /** Tell the title about the hub account and its save (redrawn in place when it is up). */
  setHub(hub: HubChip): void {
    const same = JSON.stringify(hub) === JSON.stringify(this.hub);
    this.hub = hub;
    if (!same && this.nav.top === this.title) this.nav.refresh();
  }

  private hubChip(): HTMLElement {
    const chip = el('div', `hub-chip ${this.hub.status}`, hubChipText(this.hub));
    chip.dataset.hub = this.hub.status;
    chip.dataset.save = this.hub.owner;
    return chip;
  }

  private makeTitle(): Screen {
    const s = this.screen('screen-title');
    const render = () => {
      s.replaceChildren(el('h1', 'logo', 'Sproto Open World'), el('p', 'tagline', 'Sproutvale — bootstrap build'));
      const { canContinue, notice, diskPath } = this.titleSave;
      if (notice) s.append(el('p', 'note save-notice', notice));
      s.append(this.hubChip());
      const list = el('div', 'list');
      // While a hub visit signs in, whose save this is isn't known yet: no Play over it.
      if (this.hub.owner === 'pending') list.append(el('p', 'note hub-wait', 'Loading your hub save…'));
      // A new game picks its class first.
      else if (canContinue) list.append(button('Continue', () => this.actions.continueGame()), button('New game', () => this.nav.push(this.classes)));
      else list.append(button('Play', () => this.nav.push(this.classes)));
      list.append(button('Settings', () => this.nav.push(this.settings)), button('Return to Hub', () => this.actions.returnToHub()));
      s.append(list, el('p', 'build', diskPath ? `build ${__BUILD_ID__} · local save: ${diskPath}` : `build ${__BUILD_ID__}`));
    };
    return { el: s, render, onBack: () => {} };
  }

  /** Creating a save: pick a class (content/classes.ts). It is kept for the whole save. */
  private makeClasses(): Screen {
    const s = this.screen('screen-classes');
    const render = () => {
      s.replaceChildren(el('h2', '', 'Choose your class'));
      if (this.titleSave.canContinue) s.append(el('p', 'note', 'A new game replaces your saved one.'));
      const list = el('div', 'list class-list');
      for (const id of CLASS_IDS) {
        const c = CLASSES[id];
        const b = button('', () => this.actions.play(id), 'btn class-card');
        b.dataset.class = id;
        b.append(el('span', 'label', c.name), el('span', 'blurb', c.blurb));
        list.append(b);
      }
      list.append(button('Back', () => this.nav.pop()));
      s.append(list);
    };
    return { el: s, render, onBack: () => this.nav.pop() };
  }

  private makePause(): Screen {
    const s = this.screen('screen-pause');
    const render = () => {
      s.replaceChildren(el('h2', '', 'Paused'));
      const list = el('div', 'list');
      list.append(button('Resume', () => this.actions.resume()));
      list.append(
        button('Settings', () => this.nav.push(this.settings)),
        button('Quit to title', () => this.actions.quitToTitle()),
        button('Return to Hub', () => this.actions.returnToHub()),
      );
      s.append(list);
    };
    return { el: s, render, onBack: () => this.actions.resume() };
  }

  private makeSettings(): Screen {
    const s = this.screen('screen-settings');
    const render = () => {
      s.replaceChildren(el('h2', '', 'Settings'));
      const list = el('div', 'list settings-list');
      const v = this.settingsValue;
      list.append(button('Controls', () => this.nav.push(this.controls)));
      for (const group of SETTING_GROUPS) {
        list.append(el('h3', 'settings-group', group.title));
        for (const row of group.rows) {
          const b = button('', () => this.adjustSetting(b, 1, true), 'btn setting-row');
          b.dataset.setting = row.key;
          const value = el('span', 'value', row.text(v));
          if (row.meter) {
            const meter = el('i', 'meter');
            meter.style.setProperty('--fill', String(row.meter(v)));
            value.prepend(meter);
          }
          b.append(el('span', 'label', row.label), value);
          list.append(b);
        }
      }
      list.append(button('Back', () => this.nav.pop()));
      s.append(list, el('p', 'hint', '← → to change'));
    };
    return { el: s, render, onAdjust: (item, dir) => this.adjustSetting(item, dir, false) };
  }

  private adjustSetting(item: HTMLElement, dir: -1 | 1, wrap: boolean): void {
    const row = settingRow(item.dataset.setting ?? '');
    if (!row) return;
    const v = row.step(this.settingsValue, dir, wrap);
    this.settingsValue = v;
    this.actions.settingsChanged(v);
    this.nav.refresh();
  }

  private makeControls(): Screen {
    const s = this.screen('screen-controls');
    const render = () => {
      s.replaceChildren(el('h2', '', 'Controls'));
      const table = el('div', 'controls-table');
      table.append(el('div', 'th', 'Action'), el('div', 'th', 'Key'), el('div', 'th', 'Alt key'), el('div', 'th', 'Pad'));
      const actions = [...new Set<string>([...KEY_ACTIONS, ...PAD_ACTIONS])];
      for (const a of actions) {
        table.append(el('div', 'td label', ACTION_LABELS[a as KeyAction]));
        for (let slot = 0; slot < KEY_SLOTS; slot++) {
          if ((KEY_ACTIONS as string[]).includes(a)) {
            const ka = a as KeyAction;
            const capturing = this.captureState?.kind === 'key' && this.captureState.action === ka && this.captureState.slot === slot;
            const b = button(capturing ? 'Press a key…' : keyLabel(this.prefs.keys[ka][slot]) || '—', () => this.startCapture({ kind: 'key', action: ka, slot }), 'btn cell');
            if (a === 'pause' && slot === 0) b.disabled = true;
            table.append(b);
          } else table.append(el('div', 'td', ''));
        }
        if ((PAD_ACTIONS as string[]).includes(a)) {
          const pa = a as PadAction;
          const capturing = this.captureState?.kind === 'pad' && this.captureState.action === pa;
          const style = this.input.pad.style;
          table.append(button(capturing ? 'Press a button…' : this.prefs.pad[pa].map((b) => padGlyph(b, style)).join(' / ') || '—', () => this.startCapture({ kind: 'pad', action: pa }), 'btn cell'));
        } else table.append(el('div', 'td', a === 'forward' || a === 'back' || a === 'left' || a === 'right' ? 'Left stick' : ''));
      }
      const foot = el('div', 'list row');
      foot.append(
        button('Reset to defaults', () => {
          this.prefs = defaultControlPrefs();
          this.note = 'Controls reset.';
          this.actions.controlsChanged(this.prefs);
          this.nav.refresh();
        }),
        button('Back', () => this.nav.pop()),
      );
      s.append(table, el('p', 'note', this.note || 'Select a slot, then press the key or button. Esc cancels; Delete clears a key.'), foot);
    };
    return { el: s, render, capturing: () => this.captureState !== null };
  }

  private startCapture(c: NonNullable<Menus['captureState']>): void {
    this.captureState = c;
    this.captureTimer = 0;
    this.note = c.kind === 'key' ? 'Press a key or mouse button for this action.' : 'Press a pad button for this action (or wait to cancel).';
    this.nav.refresh();
  }

  private endCapture(note: string): void {
    this.captureState = null;
    this.note = note;
    this.nav.refresh();
  }

  private onCaptureKey(code: string, e: KeyboardEvent | MouseEvent): void {
    const c = this.captureState;
    if (!c) return;
    e.preventDefault();
    e.stopPropagation();
    if (code === 'Escape') return this.endCapture('Cancelled.');
    if (c.kind !== 'key') return;
    if (code === 'Delete' || code === 'Backspace') {
      const r = clearKey(this.prefs, c.action, c.slot);
      if (r.ok) this.applyPrefs(r.prefs);
      return this.endCapture(r.ok ? 'Key cleared.' : r.reason);
    }
    const r = bindKey(this.prefs, c.action, c.slot, code);
    if (r.ok) this.applyPrefs(r.prefs);
    this.endCapture(r.ok ? (r.swapped ? `Swapped with ${ACTION_LABELS[r.swapped]}.` : 'Saved.') : r.reason);
  }

  /** Once per frame while the controls screen is up: pad rebinding and the capture timeout. */
  frame(dt: number, pad: GamepadInput): void {
    const c = this.captureState;
    if (!c) return;
    this.captureTimer += dt;
    if (this.captureTimer > 6) return this.endCapture('Timed out.');
    if (c.kind !== 'pad') return;
    pad.update();
    for (const b of PAD_BUTTONS) {
      if (b === 'home' || !pad.wasPressed([b])) continue;
      const r = bindPad(this.prefs, c.action, b);
      if (r.ok) this.applyPrefs(r.prefs);
      return this.endCapture(r.ok ? (r.swapped ? `Swapped with ${ACTION_LABELS[r.swapped]}.` : 'Saved.') : r.reason);
    }
  }

  private applyPrefs(p: ControlPrefs): void {
    this.prefs = p;
    this.actions.controlsChanged(p);
  }
}
