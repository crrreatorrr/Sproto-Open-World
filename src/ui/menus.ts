import { padGlyph, PAD_BUTTONS, type GamepadInput } from '../input/Gamepad';
import {
  ACTION_LABELS, KEY_ACTIONS, KEY_SLOTS, PAD_ACTIONS, bindKey, bindPad, clearKey, defaultControlPrefs,
  type ControlPrefs, type KeyAction, type PadAction,
} from '../input/controlPrefs';
import type { Input } from '../input/Input';
import { keyLabel } from '../input/glyphs';
import type { MenuNav, Screen } from './MenuNav';
import type { Settings } from './settings';

export interface MenuActions {
  play(): void;
  resume(): void;
  quitToTitle(): void;
  settingsChanged(s: Settings): void;
  controlsChanged(p: ControlPrefs): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

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
  private captureState: { kind: 'key'; action: KeyAction; slot: number } | { kind: 'pad'; action: PadAction } | null = null;
  private captureTimer = 0;
  private note = '';

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
    input.onKeyDown((code, e) => this.onCaptureKey(code, e));
  }

  private screen(id: string): HTMLElement {
    const s = el('section', 'screen');
    s.id = id;
    this.root.appendChild(s);
    return s;
  }

  private makeTitle(): Screen {
    const s = this.screen('screen-title');
    s.append(el('h1', 'logo', 'Sproto Open World'), el('p', 'tagline', 'Sproutvale — bootstrap build'));
    const list = el('div', 'list');
    list.append(button('Play', () => this.actions.play()), button('Settings', () => this.nav.push(this.settings)));
    s.append(list, el('p', 'build', `build ${__BUILD_ID__}`));
    return { el: s, onBack: () => {} };
  }

  private makePause(): Screen {
    const s = this.screen('screen-pause');
    s.append(el('h2', '', 'Paused'));
    const list = el('div', 'list');
    list.append(
      button('Resume', () => this.actions.resume()),
      button('Settings', () => this.nav.push(this.settings)),
      button('Quit to title', () => this.actions.quitToTitle()),
    );
    s.append(list);
    return { el: s, onBack: () => this.actions.resume() };
  }

  private makeSettings(): Screen {
    const s = this.screen('screen-settings');
    const render = () => {
      s.replaceChildren(el('h2', '', 'Settings'));
      const list = el('div', 'list');
      const v = this.settingsValue;
      const slider = (key: 'mouseSensitivity' | 'padSensitivity', label: string) => {
        const b = button(`${label}: ${v[key].toFixed(1)}×`, () => this.adjustSetting(b, 1), 'btn slider');
        b.dataset.setting = key;
        return b;
      };
      const toggle = (key: 'invertY' | 'rumble' | 'shake', label: string) => {
        const b = button(`${label}: ${v[key] ? 'On' : 'Off'}`, () => this.adjustSetting(b, 1), 'btn toggle');
        b.dataset.setting = key;
        return b;
      };
      list.append(
        button('Controls', () => this.nav.push(this.controls)),
        slider('mouseSensitivity', 'Mouse sensitivity'),
        slider('padSensitivity', 'Stick sensitivity'),
        toggle('invertY', 'Invert look Y'),
        toggle('rumble', 'Rumble'),
        toggle('shake', 'Camera shake'),
        button('Back', () => this.nav.pop()),
      );
      s.append(list, el('p', 'hint', '← → to change'));
    };
    return { el: s, render, onAdjust: (item, dir) => this.adjustSetting(item, dir) };
  }

  private adjustSetting(item: HTMLElement, dir: -1 | 1): void {
    const key = item.dataset.setting as keyof Settings | undefined;
    if (!key) return;
    const v = { ...this.settingsValue };
    if (key === 'mouseSensitivity' || key === 'padSensitivity') {
      v[key] = Math.round(Math.min(3, Math.max(0.2, v[key] + dir * 0.1)) * 10) / 10;
    } else v[key] = !v[key];
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
