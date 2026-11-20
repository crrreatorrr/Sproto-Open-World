/**
 * The hub feedback window on a gamepad. The SDK's window takes a mouse and a keyboard only, and
 * every menu here works with a pad alone (AGENTS.md), so while it is open App hands the pad to this
 * each frame:
 *
 *   D-pad / left stick  move the focus through the options and the buttons (the window's Tab order)
 *   A                   press the focused option or button
 *   B                   close the window (the game picks up where it stopped)
 *   Start               send
 *
 * The note box is skipped: a pad cannot type, and the note is optional. The window lives in an open
 * shadow root under `[data-hub-feedback]` (hub-sdk 0.9.0, dist/feedback.js).
 */

/** What this reads from the pad for one frame (Gamepad satisfies it). */
export interface FeedbackPadInput {
  wasPressed(buttons: readonly string[]): boolean;
  readonly move: { readonly x: number; readonly y: number };
}

/** The few DOM calls this makes, so tests can stand in for the window. */
export interface FeedbackDom {
  querySelector(selector: string): { shadowRoot: FeedbackRoot | null } | null;
}
export interface FeedbackRoot {
  readonly activeElement: Element | null;
  querySelector(selector: string): FeedbackElement | null;
}
export interface FeedbackElement {
  querySelectorAll(selector: string): ArrayLike<FeedbackButton>;
  querySelector(selector: string): FeedbackElement | null;
  append(...nodes: (string | Node)[]): void;
  dataset?: DOMStringMap;
}
export interface FeedbackButton {
  readonly disabled: boolean;
  focus(options?: FocusOptions): void;
  click(): void;
}

const HOST = '[data-hub-feedback]';
/** Options, the screenshot's Draw / Undo, Close and Send, in the window's own order. */
const TARGETS = '.chip, .mini, .btn';
const STICK_PUSH = 0.6;

export class FeedbackPad {
  /** Which way the stick was pushed last frame: one push moves the focus once. */
  private stick = 0;

  constructor(private readonly doc: FeedbackDom) {}

  private root(): FeedbackRoot | null {
    return this.doc.querySelector(HOST)?.shadowRoot ?? null;
  }

  private panel(): FeedbackElement | null {
    return this.root()?.querySelector('.panel') ?? null;
  }

  /** True while the window itself (not just a toast) is up. */
  get open(): boolean {
    return this.panel() !== null;
  }

  /** The buttons a pad can reach, enabled ones only. */
  targets(): FeedbackButton[] {
    const panel = this.panel();
    return panel ? Array.from(panel.querySelectorAll(TARGETS)).filter((b) => !b.disabled) : [];
  }

  private focused(list: FeedbackButton[]): number {
    const active = this.root()?.activeElement ?? null;
    return list.findIndex((b) => (b as unknown) === active);
  }

  /** Focus the first option, so the pad has a visible place to start. */
  focusFirst(): void {
    this.targets()[0]?.focus({ preventScroll: true });
  }

  /** Move the focus one step (wrapping), or onto the first / last button if none has it. */
  move(dir: 1 | -1): void {
    const list = this.targets();
    if (!list.length) return;
    const at = this.focused(list);
    const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
    list[next].focus({ preventScroll: true });
  }

  /**
   * Add the pad's buttons to the window's key hint ("1–7 pick · Enter send · Esc close"), once.
   * `glyph` names a button on the pad in hand (A or Cross, and so on).
   */
  hint(glyph: (button: string) => string): void {
    const hint = this.panel()?.querySelector('.hint');
    if (!hint || hint.dataset?.pad !== undefined) return;
    if (hint.dataset) hint.dataset.pad = '';
    hint.append(` · ${glyph('a')} pick · ${glyph('b')} close · ${glyph('start')} send`);
  }

  /** One frame of pad input while the window is open. `close` closes it (the SDK handle). */
  frame(pad: FeedbackPadInput, close: () => void): void {
    const axis = Math.abs(pad.move.x) > Math.abs(pad.move.y) ? pad.move.x : pad.move.y;
    const push = axis > STICK_PUSH ? 1 : axis < -STICK_PUSH ? -1 : 0;
    const pushed = push !== this.stick;
    this.stick = push;
    if (!this.open) return;
    if (pad.wasPressed(['b'])) {
      close();
      return;
    }
    if (pad.wasPressed(['start'])) {
      // Send checks itself: nothing picked and no note says so in the window.
      const send = this.panel()?.querySelector('.btn.primary') as unknown as FeedbackButton | null;
      if (send && !send.disabled) send.click();
      return;
    }
    if (pad.wasPressed(['up', 'left']) || (push < 0 && pushed)) this.move(-1);
    if (pad.wasPressed(['down', 'right']) || (push > 0 && pushed)) this.move(1);
    if (pad.wasPressed(['a'])) {
      const list = this.targets();
      const at = this.focused(list);
      if (at >= 0) list[at].click();
      else this.focusFirst();
    }
  }
}
