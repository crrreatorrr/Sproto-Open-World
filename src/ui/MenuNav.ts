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
}

const REPEAT_DELAY = 0.38;
const REPEAT_RATE = 0.09;

/**
 * Menu navigation for keyboard, mouse and gamepad (owner: pad support from the start). Items are
 * elements with `data-nav`; the focused one gets `.focused` and real DOM focus. Up/down (d-pad,
 * left stick, arrows, W/S) move with key repeat, left/right adjust, A/Enter/Space confirm, B/Esc
 * go back. Hovering with the mouse focuses too.
 */
export class MenuNav {
  private readonly stack: Screen[] = [];
  /** Focus index per open screen, so going back lands where you left. */
  private readonly focusMemory: number[] = [];
  private index = 0;
  /** The pad press that woke the pad is ignored until every menu button is released. */
  private swallow = false;
  private holdDir = 0;
  private holdTime = 0;
  /** Called after a confirm or a move (UI sounds and rumble hook in here). */
  onMove: (() => void) | null = null;
  onConfirm: (() => void) | null = null;
  onBackSound: (() => void) | null = null;

  constructor(private readonly input: Input) {
    window.addEventListener('keydown', (e) => {
      if (!this.top || this.top.capturing?.()) return;
      switch (e.code) {
        case 'ArrowUp':
        case 'KeyW':
          this.move(-1);
          break;
        case 'ArrowDown':
        case 'KeyS':
          this.move(1);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          this.adjust(-1);
          break;
        case 'ArrowRight':
        case 'KeyD':
          this.adjust(1);
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
          return;
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

  push(screen: Screen): void {
    if (this.top) {
      this.top.el.classList.remove('active');
      this.focusMemory[this.stack.length - 1] = this.index;
    }
    this.stack.push(screen);
    this.show(screen, 0);
  }

  /** Replace the whole stack with one screen. */
  reset(screen: Screen | null): void {
    for (const s of this.stack) s.el.classList.remove('active');
    this.stack.length = 0;
    this.focusMemory.length = 0;
    if (screen) this.push(screen);
  }

  pop(): void {
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
    const navButtons = ['a', 'b', 'up', 'down', 'left', 'right'];
    if (pad.justActivated) this.swallow = true; // the press that woke the pad is not also a menu action
    if (this.swallow) {
      if (pad.isDown(navButtons) || Math.hypot(pad.move.x, pad.move.y) > 0.3) return;
      this.swallow = false;
      this.holdDir = 0;
    }
    if (pad.wasPressed(['a'])) this.confirm();
    else if (pad.wasPressed(['b'])) this.back();
    let dir = 0;
    if (pad.isDown(['up']) || pad.move.y < -0.55) dir = -1;
    else if (pad.isDown(['down']) || pad.move.y > 0.55) dir = 1;
    if (dir !== 0) {
      if (dir !== this.holdDir) {
        this.holdDir = dir;
        this.holdTime = 0;
        this.move(dir);
      } else {
        this.holdTime += dt;
        if (this.holdTime > REPEAT_DELAY) {
          this.holdTime -= REPEAT_RATE;
          this.move(dir);
        }
      }
    } else this.holdDir = 0;
    if (pad.wasPressed(['left']) || (pad.move.x < -0.6 && this.lastX >= -0.6)) this.adjust(-1);
    if (pad.wasPressed(['right']) || (pad.move.x > 0.6 && this.lastX <= 0.6)) this.adjust(1);
    this.lastX = pad.move.x;
  }

  private lastX = 0;
}
