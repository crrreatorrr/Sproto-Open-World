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
  private retry: (() => void) | null = null;

  constructor(host: HTMLElement) {
    this.veil = document.createElement('div');
    this.veil.className = 'veil';
    this.veilText = document.createElement('p');
    this.veil.append(Object.assign(document.createElement('div'), { className: 'spinner' }), this.veilText);
    this.error = document.createElement('div');
    this.error.className = 'error-panel';
    this.errorText = document.createElement('p');
    this.errorButton = document.createElement('button');
    this.errorButton.className = 'btn focused';
    this.errorButton.dataset.nav = '';
    this.errorButton.addEventListener('click', () => this.retry?.());
    const h = document.createElement('h2');
    h.textContent = 'Something went wrong';
    this.error.append(h, this.errorText, this.errorButton);
    host.append(this.veil, this.error);
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
    this.hideVeil();
    this.errorText.textContent = text;
    this.errorButton.textContent = action;
    this.retry = onAction;
    this.error.classList.add('active');
    this.errorButton.focus();
  }

  hideError(): void {
    this.error.classList.remove('active');
  }

  /** Pad A / Enter on the error panel. */
  confirmError(): void {
    if (this.errorOpen) this.retry?.();
  }
}
