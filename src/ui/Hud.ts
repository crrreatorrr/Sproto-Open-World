import type { GamepadInput } from '../input/Gamepad';
import { KEYS, PAD } from '../input/bindings';
import { promptLabel } from '../input/glyphs';

export interface HudVitals {
  hp: number;
  hpMax: number;
  stamina: number;
  staminaMax: number;
  mana: number;
  manaMax: number;
}

/** Something drawn at a projected screen point (px), hidden when off screen or behind the camera. */
export interface HudPoint {
  x: number;
  y: number;
  visible: boolean;
}

export interface HudCombat {
  player: HudVitals | null;
  /** The locked target, else the enemy the player hit last. */
  enemy: (HudPoint & { name: string; hp: number; hpMax: number }) | null;
  /** Lock-on reticle on the locked target's chest. */
  reticle: HudPoint | null;
}

interface Bar {
  root: HTMLElement;
  fill: HTMLElement;
  /** Trails the fill down so a hit shows how much it took. */
  lag: HTMLElement;
  value: number;
  lagValue: number;
}

function bar(cls: string, label?: string): Bar {
  const root = document.createElement('div');
  root.className = `bar ${cls}`;
  const lag = document.createElement('div');
  lag.className = 'lag';
  const fill = document.createElement('div');
  fill.className = 'fill';
  root.append(lag, fill);
  if (label) {
    const l = document.createElement('span');
    l.className = 'label';
    l.textContent = label;
    root.append(l);
  }
  return { root, fill, lag, value: -1, lagValue: 1 };
}

/**
 * The play HUD: vitals (top left), an enemy health bar and the lock-on reticle projected over the
 * world, a "You died" card, and control prompts that follow the last device used (keyboard +
 * mouse or a pad, with the pad's own glyphs), plus a "click to look" hint when the mouse isn't
 * captured. Writes to the DOM only when a value changes.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly prompts: HTMLElement;
  private readonly clickHint: HTMLElement;
  private readonly hp = bar('hp');
  private readonly stamina = bar('stamina');
  private readonly mana = bar('mana');
  private readonly enemy: HTMLElement;
  private readonly enemyName: HTMLElement;
  private readonly enemyBar = bar('enemy-hp');
  private readonly reticle: HTMLElement;
  private readonly died: HTMLElement;
  private last = '';
  private lastEnemyName = '';

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    const vitals = document.createElement('div');
    vitals.className = 'vitals';
    vitals.append(this.hp.root, this.stamina.root, this.mana.root);
    this.enemy = document.createElement('div');
    this.enemy.className = 'enemy-bar';
    this.enemyName = document.createElement('div');
    this.enemyName.className = 'name';
    this.enemy.append(this.enemyName, this.enemyBar.root);
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.died = document.createElement('div');
    this.died.className = 'died';
    this.died.textContent = 'You died';
    this.prompts = document.createElement('div');
    this.prompts.className = 'prompts';
    this.clickHint = document.createElement('div');
    this.clickHint.className = 'click-hint';
    this.clickHint.textContent = 'Click to look around';
    this.root.append(vitals, this.enemy, this.reticle, this.died, this.prompts, this.clickHint);
    host.appendChild(this.root);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('active', v);
  }

  update(pad: GamepadInput, mouseLocked: boolean): void {
    const d = pad.device, s = pad.style;
    const p = (keys: readonly string[], padB: readonly string[]) => promptLabel(d, s, keys, padB);
    const move = d === 'gamepad' ? 'Left stick' : `${p(KEYS.forward, [])}${p(KEYS.left, [])}${p(KEYS.back, [])}${p(KEYS.right, [])}`;
    const items: [string, string][] = [
      [move, 'Move'],
      [p(KEYS.light, PAD.light), 'Light'],
      [p(KEYS.heavy, PAD.heavy), 'Heavy (hold)'],
      [p(KEYS.dodge, PAD.dodge), 'Dodge'],
      [p(KEYS.block, PAD.block), 'Block'],
      [p(KEYS.lock, PAD.lock), 'Lock on'],
      [p(KEYS.sprint, PAD.sprint), 'Sprint'],
      [p(KEYS.jump, PAD.jump), 'Jump'],
      [p(KEYS.pause, PAD.pause), 'Pause'],
    ];
    const html = items.map(([k, v]) => `<span class="prompt"><kbd>${k}</kbd>${v}</span>`).join('');
    if (html !== this.last) {
      this.last = html;
      this.prompts.innerHTML = html;
    }
    this.clickHint.classList.toggle('active', d === 'kbm' && !mouseLocked);
  }

  /** Bars, the enemy bar and the reticle, once per rendered frame while playing. */
  combat(c: HudCombat, dt: number): void {
    const v = c.player;
    if (v) {
      this.setBar(this.hp, v.hp / Math.max(1, v.hpMax), dt);
      this.setBar(this.stamina, v.stamina / Math.max(1, v.staminaMax), dt);
      this.setBar(this.mana, v.mana / Math.max(1, v.manaMax), dt);
    }
    const e = c.enemy;
    const showEnemy = !!e && e.visible;
    this.enemy.classList.toggle('active', showEnemy);
    if (e && showEnemy) {
      if (e.name !== this.lastEnemyName) {
        this.lastEnemyName = e.name;
        this.enemyName.textContent = e.name;
        // A new enemy: no trailing chunk from the last one.
        this.enemyBar.lagValue = e.hp / Math.max(1, e.hpMax);
      }
      this.setBar(this.enemyBar, e.hp / Math.max(1, e.hpMax), dt);
      this.enemy.style.transform = `translate3d(${e.x.toFixed(1)}px, ${e.y.toFixed(1)}px, 0) translate(-50%, -100%)`;
    }
    const r = c.reticle;
    const showReticle = !!r && r.visible;
    this.reticle.classList.toggle('active', showReticle);
    if (r && showReticle) this.reticle.style.transform = `translate3d(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }

  /** Dodge or attack pressed with no stamina: the bar flashes (plan §4.3). */
  flashStamina(): void {
    const el = this.stamina.root;
    el.classList.remove('flash');
    void el.offsetWidth;
    el.classList.add('flash');
  }

  showDeath(on: boolean): void {
    this.died.classList.toggle('active', on);
  }

  private setBar(b: Bar, frac: number, dt: number): void {
    const f = Math.min(1, Math.max(0, frac));
    if (Math.abs(f - b.value) > 1e-4) {
      b.value = f;
      b.fill.style.transform = `scaleX(${f.toFixed(4)})`;
    }
    // The lag chunk drains down to the fill (fast at first); it snaps up on a heal.
    const lag = f >= b.lagValue ? f : b.lagValue - Math.max(0.0015, (b.lagValue - f) * 4 * dt);
    if (Math.abs(lag - b.lagValue) > 1e-4) {
      b.lagValue = Math.max(f, lag);
      b.lag.style.transform = `scaleX(${b.lagValue.toFixed(4)})`;
    }
  }
}
