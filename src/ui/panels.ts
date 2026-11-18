/**
 * Full-screen panels for the cases the plan says must be handled (§2.9): a loading veil, a fatal
 * error with Retry, and the "restoring graphics" veil after a lost WebGL context.
 */
export class Panels {
  private readonly veil: HTMLElement;
  private readonly veilText: HTMLElement;
  private readonly error: HTMLElement;
  private readonly errorText: HTMLElement;
  private readonly errorButton: HTMLButtonElement;
  private readonly buttons: HTMLElement;
  private actions: { button: HTMLButtonElement; run: () => void }[] = [];
  private focus = 0;

  constructor(host: HTMLElement) {
    this.veil = document.createElement('div');
    this.veil.className = 'veil';
    this.veilText = document.createElement('p');
    this.veil.append(Object.assign(document.createElement('div'), { className: 'spinner' }), this.veilText);
    this.error = document.createElement('div');
    this.error.className = 'error-panel';
    this.errorText = document.createElement('p');
    this.errorButton = this.makeButton();
    this.buttons = document.createElement('div');
    this.buttons.className = 'error-actions';
    const h = document.createElement('h2');
    h.textContent = 'Something went wrong';
    this.error.append(h, this.errorText, this.buttons);
    host.append(this.veil, this.error);
    window.addEventListener('keydown', (e) => this.onKey(e), { capture: true });
  }

  /** The keyboard on the error panel: arrows or WASD move between the actions, Enter or Space confirms. */
  private onKey(e: KeyboardEvent): void {
    if (!this.errorOpen) return;
    switch (e.code) {
      case 'ArrowLeft':
      case 'ArrowUp':
      case 'KeyA':
      case 'KeyW':
        if (!e.repeat) this.move(-1);
        break;
      case 'ArrowRight':
      case 'ArrowDown':
      case 'KeyD':
      case 'KeyS':
        if (!e.repeat) this.move(1);
        break;
      case 'Enter':
      case 'NumpadEnter':
      case 'Space':
        if (!e.repeat) this.confirmError();
        break;
      default:
        return;
    }
    e.preventDefault();
  }

  showVeil(text: string): void {
    this.veilText.textContent = text;
    this.veil.classList.add('active');
  }

  hideVeil(): void {
    this.veil.classList.remove('active');
  }

  get errorOpen(): boolean {
    return this.error.classList.contains('active');
  }

  showError(text: string, action: string, onAction: () => void): void {
    this.showChoice(text, [{ label: action, run: onAction }]);
  }

  /**
   * The error panel with several actions (the cell-load timeout's Retry / Return to start). The
   * pad's D-pad or stick moves between them (App calls `move`), A confirms.
   */
  showChoice(text: string, actions: { label: string; run: () => void }[]): void {
    this.hideVeil();
    this.errorText.textContent = text;
    this.buttons.replaceChildren();
    this.actions = actions.map((a, i) => {
      const button = i === 0 ? this.errorButton : this.makeButton();
      button.textContent = a.label;
      this.buttons.append(button);
      return { button, run: a.run };
    });
    this.error.classList.add('active');
    this.setFocus(0);
  }

  /** Move the focus between the panel's actions. */
  move(dir: -1 | 1): void {
    if (this.actions.length > 1) this.setFocus((this.focus + dir + this.actions.length) % this.actions.length);
  }

  /** The focused action's label (QA). */
  get focusedAction(): string | null {
    return this.errorOpen ? (this.actions[this.focus]?.button.textContent ?? null) : null;
  }

  private setFocus(i: number): void {
    this.focus = i;
    this.actions.forEach((a, k) => a.button.classList.toggle('focused', k === i));
    this.actions[i]?.button.focus();
  }

  private makeButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'btn';
    b.dataset.nav = '';
    b.addEventListener('click', () => this.actions.find((a) => a.button === b)?.run());
    b.addEventListener('mouseenter', () => {
      const i = this.actions.findIndex((a) => a.button === b);
      if (i >= 0) this.setFocus(i);
    });
    return b;
  }

  hideError(): void {
    this.error.classList.remove('active');
  }

  /** Pad A / Enter on the error panel. */
  confirmError(): void {
    if (this.errorOpen) this.actions[this.focus]?.run();
  }
}
