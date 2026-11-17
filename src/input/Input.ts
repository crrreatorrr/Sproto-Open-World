import { GamepadInput } from './Gamepad';

/** Keys whose browser default (scrolling, quick-find, focus change) would interrupt play. */
const BLOCK_DEFAULT = new Set(['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote']);

/**
 * Raw keyboard + mouse state, ported from sproto-duel `src/core/Input.ts`. Mouse buttons are also
 * exposed as the codes `Mouse0`..`Mouse2`, so bindings treat them like keys. Edges ("pressed
 * this frame") are cleared at the end of every rendered frame.
 */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
  locked = false;
  /** Set by the QA API to drive the game without a real keyboard. */
  enabled = true;
  /** Ignore mouse buttons while unlocked, so the click that captures the mouse doesn't attack. */
  mouseNeedsLock = true;
  /** Controller state, polled once per frame; also tracks which device was used last. */
  readonly pad = new GamepadInput();
  private readonly lockListeners: ((locked: boolean) => void)[] = [];
  /** A key went down (menus and rebinding listen to this; gameplay polls). */
  private readonly keyListeners: ((code: string, e: KeyboardEvent | MouseEvent) => void)[] = [];

  constructor(private readonly element: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      const usedByMenu = e.defaultPrevented;
      if (BLOCK_DEFAULT.has(e.code) && !(e.target instanceof HTMLInputElement)) e.preventDefault();
      if (!e.repeat && !usedByMenu) this.pressed.add(e.code);
      this.down.add(e.code);
      this.pad.useKeyboardMouse();
      if (!e.repeat) for (const fn of this.keyListeners) fn(e.code, e);
    });
    window.addEventListener('keyup', (e) => this.down.delete(e.code));
    window.addEventListener('blur', () => this.clearHeld());
    element.addEventListener('mousedown', (e) => {
      if (e.button > 2) return;
      const code = `Mouse${e.button}`;
      if (this.mouseNeedsLock && !this.locked) return;
      this.down.add(code);
      this.pressed.add(code);
    });
    window.addEventListener('mousedown', (e) => {
      this.pad.useKeyboardMouse();
      // Listeners (rebinding) hear mouse buttons anywhere, including over menus.
      if (e.button <= 2) for (const fn of this.keyListeners) fn(`Mouse${e.button}`, e);
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button <= 2) this.down.delete(`Mouse${e.button}`);
    });
    element.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      // Deliberate movement only: browsers send zero-delta moves when the layout shifts.
      if (Math.abs(e.movementX) + Math.abs(e.movementY) > 1) this.pad.useKeyboardMouse();
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.element;
      for (const fn of this.lockListeners) fn(this.locked);
    });
  }

  onLockChange(fn: (locked: boolean) => void): void {
    this.lockListeners.push(fn);
  }

  onKeyDown(fn: (code: string, e: KeyboardEvent | MouseEvent) => void): () => void {
    this.keyListeners.push(fn);
    return () => {
      const i = this.keyListeners.indexOf(fn);
      if (i >= 0) this.keyListeners.splice(i, 1);
    };
  }

  /** Forget every held key and button (an overlay took the keyboard: no key-up will arrive). */
  clearHeld(): void {
    this.down.clear();
    this.pressed.clear();
    this.dx = 0;
    this.dy = 0;
  }

  requestLock(): void {
    if (this.locked) return;
    try {
      const req = this.element.requestPointerLock() as unknown as Promise<void> | undefined;
      req?.catch?.(() => {});
    } catch {
      // Not allowed right now (no user gesture): the next click asks again.
    }
  }

  releaseLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  isDown(codes: readonly string[]): boolean {
    if (!this.enabled) return false;
    for (const c of codes) if (this.down.has(c)) return true;
    return false;
  }

  wasPressed(codes: readonly string[]): boolean {
    if (!this.enabled) return false;
    for (const c of codes) if (this.pressed.has(c)) return true;
    return false;
  }

  consumeMouseDelta(): { x: number; y: number } {
    const d = { x: this.dx, y: this.dy };
    this.dx = 0;
    this.dy = 0;
    return d;
  }

  endFrame(): void {
    this.pressed.clear();
    this.pad.endFrame();
  }
}
