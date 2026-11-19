import type { Input } from '../input/Input';

/** One menu screen: its element, its navigable items in order, and what Back does. */
export interface Screen {
  el: HTMLElement;
  /** Called when the screen is shown, to (re)build its items. */
  render?(): void;
  /** Back (Esc, pad B). Default: pop the screen. */
  onBack?(): void;
  /** Left/right on the focused item (sliders and toggles). */
  onAdjust?(item: HTMLElement, dir: -1 | 1): void;
  /** While true, the screen is capturing a key or button (rebinding): navigation is off. */
  capturing?(): boolean;
  /** A tabbed screen: LB / RB (Q / E) switch tabs. The screen re-renders itself on the new tab. */
  onTab?(dir: -1 | 1): void;
  /** The key focus is remembered under (one per tab), so switching back lands where you left. */
  focusKey?(): string;
  /**
   * 2-D grid mode: while true, items with `data-gx` / `data-gy` are a grid, and up / down / left /
   * right (D-pad, left stick, arrows, WASD) move the focus in that direction.
   */
  grid?(): boolean;
  /**
   * A key or pad button this screen uses itself (the Relics tab's compare and jump). Return true
   * when the press was used, so the menu does not also treat it as navigation.
   */
  onExtra?(input: string): boolean;
}

export type NavDir = 'up' | 'down' | 'left' | 'right';

const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.09;
const ONE_SHOT_KEYS: ReadonlySet<string> = new Set(['Enter', 'NumpadEnter', 'Space', 'Escape', 'KeyQ', 'KeyE']);

/**
 * Menu navigation for keyboard, mouse and gamepad (owner: pad support from the start). Items are
 * elements with `data-nav`; the focused one gets `.focused` and real DOM focus. Up/down (d-pad,
 * left stick, arrows, W/S) move with key repeat, left/right adjust, A/Enter/Space confirm, B/Esc
 * go back. Hovering with the mouse focuses too. A tabbed screen switches tabs with LB/RB (Q/E),
 * remembering the focus per tab; a grid screen moves in four directions (`Screen.grid`).
 */
export class MenuNav {
  private readonly stack: Screen[] = [];
  /** Focus index per open screen, so going back lands where you left. */
  private readonly focusMemory: number[] = [];
  private index = 0;
  /** The pad press that woke the pad is ignored until every menu button is released. */
  private swallow = false;
  private holdDir: NavDir | null = null;
  private holdTime = 0;
  /** Focused index per `Screen.focusKey` (tabs). */
  private readonly keyMemory = new Map<string, number>();
  /** Called after a confirm or a move (UI sounds and rumble hook in here). */
  onMove: (() => void) | null = null;
  onConfirm: (() => void) | null = null;
  onBackSound: (() => void) | null = null;
  /** While true something covers the menus (the error panel): they take no keys. */
  blocked: (() => boolean) | null = null;

  constructor(private readonly input: Input) {
    window.addEventListener('keydown', (e) => {
      if (!this.top || this.top.capturing?.() || this.blocked?.()) return;
      // Holding a key repeats moves only: one press is one confirm, one Back, one tab.
      if (e.repeat && ONE_SHOT_KEYS.has(e.code) && (this.top.onTab || (e.code !== 'KeyQ' && e.code !== 'KeyE'))) {
        e.preventDefault();
        return;
      }
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.dir('up');
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.dir('down');
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.dir('left');
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.dir('right');
          break;
        case 'KeyQ':
        case 'KeyE':
          if (!this.top.onTab) return;
          this.tab(e.code === 'KeyQ' ? -1 : 1);
          break;
        case 'Enter':
        case 'NumpadEnter':
        case 'Space':
          this.confirm();
          break;
        case 'Escape':
          this.back();
          break;
        default:
          if (!this.top.onExtra?.(e.code)) return;
          break;
      }
      // The press is used by the menu: gameplay must not also see it (Input skips handled keys).
      e.preventDefault();
    }, { capture: true });
  }

  get top(): Screen | undefined {
    return this.stack[this.stack.length - 1];
  }

  get open(): boolean {
    return this.stack.length > 0;
  }

  /** Screens on the stack (a screen opened straight from play backs out to play, not to a parent). */
  get depth(): number {
    return this.stack.length;
  }

  /** The screen is somewhere on the stack. */
  has(screen: Screen): boolean {
    return this.stack.includes(screen);
  }

  push(screen: Screen): void {
    if (this.top) {
      this.top.el.classList.remove('active');
      this.focusMemory[this.stack.length - 1] = this.index;
    }
    this.stack.push(screen);
    this.show(screen, this.remembered(screen));
  }

  /** Where a tabbed screen's current tab was left (0 for others). */
  private remembered(screen: Screen): number {
    const k = screen.focusKey?.();
    return k !== undefined ? (this.keyMemory.get(k) ?? 0) : 0;
  }

  private remember(): void {
    const k = this.top?.focusKey?.();
    if (k !== undefined) this.keyMemory.set(k, this.index);
  }

  /** Switch tabs on the top screen (LB / RB, Q / E), keeping each tab's focus. */
  tab(dir: -1 | 1): void {
    const s = this.top;
    if (!s?.onTab) return;
    this.remember();
    s.onTab(dir);
    this.show(s, this.remembered(s));
    this.onMove?.();
  }

  /** The top screen re-rendered for a new tab chosen some other way (a click): restore its focus. */
  retab(save: () => void): void {
    const s = this.top;
    if (!s) return;
    this.remember();
    save();
    this.show(s, this.remembered(s));
  }

  /** Replace the whole stack with one screen. */
  reset(screen: Screen | null): void {
    this.remember();
    for (const s of this.stack) s.el.classList.remove('active');
    this.stack.length = 0;
    this.focusMemory.length = 0;
    if (screen) this.push(screen);
  }

  pop(): void {
    this.remember();
    const s = this.stack.pop();
    s?.el.classList.remove('active');
    if (this.top) this.show(this.top, this.focusMemory[this.stack.length - 1] ?? 0);
  }

  /** Re-render the top screen, keeping focus where it was. */
  refresh(): void {
    if (this.top) this.show(this.top, this.index);
  }

  private show(screen: Screen, focus: number): void {
    screen.render?.();
    screen.el.classList.add('active');
    for (const item of this.items()) {
      item.onmouseenter = () => this.focus(this.items().indexOf(item));
    }
    this.focus(focus);
  }

  items(): HTMLElement[] {
    return this.top ? [...this.top.el.querySelectorAll<HTMLElement>('[data-nav]:not([disabled])')] : [];
  }

  focused(): HTMLElement | undefined {
    return this.items()[this.index];
  }

  /** Focus the first item that matches (after a re-render moved what matters). */
  focusWhere(pred: (el: HTMLElement) => boolean): void {
    const i = this.items().findIndex(pred);
    if (i >= 0) this.focus(i);
  }

  focus(i: number): void {
    const items = this.items();
    if (!items.length) return;
    this.index = Math.max(0, Math.min(items.length - 1, i));
    for (const it of items) it.classList.remove('focused');
    const el = items[this.index];
    el.classList.add('focused');
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
  }

  move(dir: number): void {
    const n = this.items().length;
    if (!n) return;
    this.focus((this.index + dir + n) % n);
    this.onMove?.();
  }

  /** A direction press: a grid moves in 2-D; a list moves up / down and adjusts left / right. */
  dir(d: NavDir): void {
    if (this.top?.grid?.() && this.focused()?.dataset.gx !== undefined) return this.move2d(d);
    if (d === 'up') this.move(-1);
    else if (d === 'down') this.move(1);
    else this.adjust(d === 'left' ? -1 : 1);
  }

  /**
   * Grid move: left / right go along the focused item's row (wrapping), up / down to the nearest
   * row above or below (wrapping), landing on the item whose column is closest.
   */
  move2d(d: NavDir): void {
    const items = this.items();
    const at = (e: HTMLElement) => ({ x: Number(e.dataset.gx), y: Number(e.dataset.gy) });
    const cells = items.map((e, i) => ({ i, ...at(e) })).filter((c) => Number.isFinite(c.x) && Number.isFinite(c.y));
    const cur = cells.find((c) => c.i === this.index);
    if (!cur) return;
    let pick: number;
    if (d === 'left' || d === 'right') {
      const row = cells.filter((c) => c.y === cur.y).sort((a, b) => a.x - b.x);
      if (row.length < 2) return;
      const k = row.findIndex((c) => c.i === cur.i);
      pick = row[(k + (d === 'right' ? 1 : -1) + row.length) % row.length].i;
    } else {
      const ys = [...new Set(cells.map((c) => c.y))].sort((a, b) => a - b);
      if (ys.length < 2) return;
      const k = ys.indexOf(cur.y);
      const ty = ys[(k + (d === 'down' ? 1 : -1) + ys.length) % ys.length];
      const row = cells.filter((c) => c.y === ty);
      pick = row.reduce((b, c) => (Math.abs(c.x - cur.x) < Math.abs(b.x - cur.x) ? c : b)).i;
    }
    this.focus(pick);
    this.onMove?.();
  }

  adjust(dir: -1 | 1): void {
    const item = this.focused();
    if (item && this.top?.onAdjust) {
      this.top.onAdjust(item, dir);
      this.onMove?.();
    }
  }

  confirm(): void {
    const item = this.focused();
    if (!item) return;
    this.onConfirm?.();
    item.click();
  }

  back(): void {
    const s = this.top;
    if (!s) return;
    this.onBackSound?.();
    // A screen's own Back decides where to go; the default is the previous screen.
    if (s.onBack) s.onBack();
    else this.pop();
  }

  /** Poll the pad once per frame while a menu is open. */
  frame(dt: number): void {
    const s = this.top;
    if (!s || s.capturing?.()) return;
    const pad = this.input.pad;
    pad.update();
    const navButtons = ['a', 'b', 'up', 'down', 'left', 'right', 'lb', 'rb'];
    if (pad.justActivated) this.swallow = true; // the press that woke the pad is not also a menu action
    if (this.swallow) {
      if (pad.isDown(navButtons) || Math.hypot(pad.move.x, pad.move.y) > 0.3) return;
      this.swallow = false;
      this.holdDir = null;
    }
    if (pad.wasPressed(['a'])) this.confirm();
    else if (pad.wasPressed(['b'])) this.back();
    else if (s.onTab && pad.wasPressed(['lb'])) this.tab(-1);
    else if (s.onTab && pad.wasPressed(['rb'])) this.tab(1);
    else if (pad.wasPressed(['x'])) s.onExtra?.('x');
    else if (pad.wasPressed(['y'])) s.onExtra?.('y');
    if (this.top !== s) return; // the press changed screens
    const grid = !!s.grid?.();
    let dir: NavDir | null = null;
    if (pad.isDown(['up']) || pad.move.y < -0.55) dir = 'up';
    else if (pad.isDown(['down']) || pad.move.y > 0.55) dir = 'down';
    else if (grid && (pad.isDown(['left']) || pad.move.x < -0.6)) dir = 'left';
    else if (grid && (pad.isDown(['right']) || pad.move.x > 0.6)) dir = 'right';
    if (dir !== null) {
      if (dir !== this.holdDir) {
        this.holdDir = dir;
        this.holdTime = 0;
        this.dir(dir);
      } else {
        this.holdTime += dt;
        if (this.holdTime > REPEAT_DELAY) {
          this.holdTime -= REPEAT_RATE;
          this.dir(dir);
        }
      }
    } else this.holdDir = null;
    if (!grid) {
      if (pad.wasPressed(['left']) || (pad.move.x < -0.6 && this.lastX >= -0.6)) this.adjust(-1);
      if (pad.wasPressed(['right']) || (pad.move.x > 0.6 && this.lastX <= 0.6)) this.adjust(1);
    }
    this.lastX = pad.move.x;
  }

  private lastX = 0;
}
