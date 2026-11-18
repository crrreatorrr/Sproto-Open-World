import type { Screen } from './MenuNav';

export interface BossBarState {
  name: string;
  title: string;
  hp: number;
  hpMax: number;
}

const div = (cls: string, text = ''): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (text) d.textContent = text;
  return d;
};

/** Restart a CSS animation class. */
function replay(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

/**
 * The boss fight's HUD (plan §4.10): the big health bar along the bottom with a trailing chunk, the
 * intro card, and the end card after the quest is done. The end card is a menu screen, so a pad
 * alone gets past it. Writes to the DOM only when a value changes.
 */
export class BossHud {
  /** The end card, for MenuNav. Continue returns to the game (`onContinue`, set by the app). */
  readonly endCard: Screen;
  onContinue: (() => void) | null = null;
  private readonly bar = div('boss-bar');
  private readonly nameEl = div('name');
  private readonly titleEl = div('title');
  private readonly fill = div('fill');
  private readonly lag = div('lag');
  private readonly card = div('boss-intro');
  private shown = false;
  private value = -1;
  private lagValue = 1;
  private lastName = '';

  constructor(hud: HTMLElement, menus: HTMLElement) {
    const track = div('track');
    track.append(this.lag, this.fill);
    this.bar.append(this.nameEl, this.titleEl, track);
    hud.append(this.bar, this.card);
    this.endCard = this.makeEndCard(menus);
  }

  private makeEndCard(host: HTMLElement): Screen {
    const el = document.createElement('section');
    el.className = 'screen end-card';
    el.id = 'screen-end-card';
    const go = document.createElement('button');
    go.className = 'btn';
    go.type = 'button';
    go.dataset.nav = '';
    go.textContent = 'Keep exploring';
    go.addEventListener('click', () => this.onContinue?.());
    const list = div('list');
    list.append(go);
    el.append(
      Object.assign(document.createElement('h1'), { className: 'logo', textContent: 'The Scrap Rumble' }),
      Object.assign(document.createElement('p'), { className: 'tagline', textContent: 'Scrapjaw is beaten and Sproutvale sleeps easy. Thank you for playing.' }),
      list,
    );
    host.append(el);
    // Back does what Continue does: the card never traps a pad.
    return { el, onBack: () => this.onContinue?.() };
  }

  /** The bar, once per rendered frame: `null` hides it. */
  update(s: BossBarState | null, dt: number): void {
    const on = !!s;
    if (on !== this.shown) {
      this.shown = on;
      this.bar.classList.toggle('active', on);
    }
    if (!s) return;
    if (s.name !== this.lastName) {
      this.lastName = s.name;
      this.nameEl.textContent = s.name;
      this.titleEl.textContent = s.title;
      this.lagValue = 1;
      this.value = -1;
    }
    const f = Math.min(1, Math.max(0, s.hp / Math.max(1, s.hpMax)));
    if (Math.abs(f - this.value) > 1e-4) {
      this.value = f;
      this.fill.style.transform = `scaleX(${f.toFixed(4)})`;
    }
    const lag = f >= this.lagValue ? f : this.lagValue - Math.max(0.0008, (this.lagValue - f) * 2.5 * dt);
    if (Math.abs(lag - this.lagValue) > 1e-4) {
      this.lagValue = Math.max(f, lag);
      this.lag.style.transform = `scaleX(${this.lagValue.toFixed(4)})`;
    }
  }

  /** The fight begins: the boss's name across the screen. */
  intro(name: string, title: string): void {
    this.card.replaceChildren(div('name', name), div('title', title));
    replay(this.card, 'go');
  }
}
