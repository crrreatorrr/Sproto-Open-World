/** Damage-number styles (plan §4.6): crit, weakness ("Weak!") and resistance ("Resisted") read apart. */
export type NumberStyle = 'normal' | 'crit' | 'weak' | 'resist' | 'hurt';

/** Screen position of a world point (App projects through the camera). */
export type Projector = (p: { x: number; y: number; z: number }) => { x: number; y: number; visible: boolean };

const LIFE: Record<NumberStyle, number> = { normal: 0.85, crit: 1.05, weak: 1.1, resist: 0.8, hurt: 0.9 };
/** Metres a number rises over its life. */
const RISE = 0.9;
const POOL = 32;

interface Num {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  /** Small sideways drift (screen px) so stacked numbers don't overlap. */
  drift: number;
  age: number;
  life: number;
}

/**
 * Floating damage numbers: DOM elements from a fixed pool, projected from the hit position each
 * frame, rising and fading. The punch-in is a CSS animation restarted per number (styles.css).
 */
export class DamageNumbers {
  private readonly root: HTMLElement;
  private readonly live: Num[] = [];
  private readonly free: HTMLElement[] = [];

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'damage-numbers';
    host.appendChild(this.root);
    for (let i = 0; i < POOL; i++) {
      // The outer element is positioned; the inner one runs the punch-in (both use transform).
      const el = document.createElement('div');
      el.className = 'dmg';
      el.appendChild(document.createElement('div')).className = 'in';
      this.root.appendChild(el);
      this.free.push(el);
    }
  }

  /** Show `amount` at a world position. Returns false only if the pool was empty and reused. */
  spawn(p: { x: number; y: number; z: number }, amount: number, style: NumberStyle): boolean {
    let el = this.free.pop();
    let fresh = true;
    if (!el) {
      // Out of elements: recycle the oldest.
      const oldest = this.live.shift()!;
      el = oldest.el;
      fresh = false;
    }
    const n = Math.max(0, Math.round(amount));
    el.className = `dmg ${style}`;
    (el.firstChild as HTMLElement).innerHTML = style === 'weak' ? `<span class="tag">Weak!</span>${n}` : style === 'resist' ? `<span class="tag">Resisted</span>${n}` : style === 'crit' ? `${n}!` : `${n}`;
    // Restart the CSS punch-in.
    void el.offsetWidth;
    el.classList.add('show');
    this.live.push({ el, x: p.x, y: p.y, z: p.z, drift: (Math.random() - 0.5) * 40, age: 0, life: LIFE[style] });
    return fresh;
  }

  update(dt: number, project: Projector): void {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const n = this.live[i];
      n.age += dt;
      const u = n.age / n.life;
      if (u >= 1) {
        n.el.className = 'dmg';
        n.el.style.transform = '';
        this.free.push(n.el);
        this.live.splice(i, 1);
        continue;
      }
      // Ease out: quick rise that settles.
      const rise = RISE * (1 - (1 - u) * (1 - u));
      const s = project({ x: n.x, y: n.y + rise, z: n.z });
      if (!s.visible) {
        n.el.style.opacity = '0';
        continue;
      }
      n.el.style.opacity = String(u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
      n.el.style.transform = `translate3d(${(s.x + n.drift * u).toFixed(1)}px, ${s.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
    }
  }

  clear(): void {
    for (const n of this.live) {
      n.el.className = 'dmg';
      this.free.push(n.el);
    }
    this.live.length = 0;
  }
}
