import './polish.css';

/** How long the wake-up fade runs (ms): the last transition in polish.css. */
const WAKE_MS = 1500;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
};

/**
 * The two full-screen moments: the death screen (the world darkens, the words come up, black before
 * the sim moves the player, then a slow wake) and the rest fade at a shrine. They sit over the HUD
 * and under the menus, so a pause or the shrine's menu stays readable. All timing is in polish.css.
 */
export class ScreenFades {
  private readonly death = el('div', 'death-screen');
  private readonly deathSub = el('p', 'death-sub');
  private readonly rest = el('div', 'rest-screen');
  private wakeTimer = 0;

  constructor(host: HTMLElement) {
    const band = el('div', 'death-band');
    band.append(el('h2', 'death-title', 'You wilted'), this.deathSub);
    this.death.append(el('div', 'death-vignette'), band, el('div', 'death-black'));
    this.rest.append(el('p', 'rest-title', 'Rested'), el('p', 'rest-sub', 'Your wounds close. The wilds stir again.'));
    host.append(this.death, this.rest);
  }

  /** The local player fell. `sub`: where they will wake. */
  died(sub: string): void {
    window.clearTimeout(this.wakeTimer);
    this.deathSub.textContent = sub;
    this.death.classList.remove('wake');
    this.death.classList.add('on');
  }

  /** The sim has moved them: lift the black. */
  woke(): void {
    if (!this.deathShown) return;
    this.death.classList.remove('on');
    this.death.classList.add('wake');
    this.wakeTimer = window.setTimeout(() => this.death.classList.remove('wake'), WAKE_MS);
  }

  /** The death screen is up (QA). */
  get deathShown(): boolean {
    return this.death.classList.contains('on');
  }

  /** A rest at a shrine. */
  rested(): void {
    this.rest.classList.remove('go');
    // Reading layout restarts the animation when two rests come close together.
    void this.rest.offsetWidth;
    this.rest.classList.add('go');
  }

  /** Drop both at once (quit to title). */
  clear(): void {
    window.clearTimeout(this.wakeTimer);
    this.death.classList.remove('on', 'wake');
    this.rest.classList.remove('go');
  }
}
