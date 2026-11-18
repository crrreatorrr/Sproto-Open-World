import type { Affinity } from '../content/enemies';
import { SPELL_BY_SLOT, SPELLS, type SpellId } from '../content/spells';
import { TICK_HZ } from '../content/tuning';
import { WAVES } from '../content/waves';
import { padGlyph, type GamepadInput } from '../input/Gamepad';
import { KEYS, PAD } from '../input/bindings';
import { keyLabel, promptLabel } from '../input/glyphs';
import { ICONS, type IconId } from './icons';
import type { RevealKey } from './Reveals';

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

/** A status on the enemy under the bar: Chill shows its stacks, Frozen replaces Chill. */
export interface HudStatus {
  id: 'burn' | 'chill' | 'shock' | 'frozen';
  stacks: number;
}

export interface HudEnemy extends HudPoint {
  name: string;
  hp: number;
  hpMax: number;
  /** Revealed weaknesses and resistances of its type (plan §4.6). */
  affinities: { key: RevealKey; affinity: Affinity }[];
  statuses: HudStatus[];
}

/** The local player's spell state for the spell bar (plan §4.4). */
export interface HudSpells {
  mana: number;
  /** Ticks left per spell. */
  cooldowns: Partial<Record<SpellId, number>>;
  /** The spell being cast, if any. */
  casting: SpellId | null;
  /** A cast now would be woven (a melee hit landed within WOVEN.window ticks). */
  woven: boolean;
  /** Spells the player has learned (M3 progress); absent means all four (the yard and the sandbox). */
  learned?: readonly SpellId[];
}

/** The wave runner (`?sandbox=1`): `index` into WAVES (the next wave between waves), `nextIn` in ticks (0 while fighting). */
export interface HudWave {
  index: number;
  loop: number;
  enemiesLeft: number;
  nextIn: number;
}

export interface HudCombat {
  player: HudVitals | null;
  /** The locked target, else the enemy the player hit last. */
  enemy: HudEnemy | null;
  /** Lock-on reticle on the locked target's chest. */
  reticle: HudPoint | null;
  /** The dot at the centre of the screen: hidden while locked on or in a menu, lit on an enemy. */
  crosshair: 'off' | 'free' | 'enemy';
  spells: HudSpells | null;
  wave: HudWave | null;
}

interface SpellSlot {
  id: SpellId;
  root: HTMLElement;
  key: HTMLElement;
  cd: number;
  poor: boolean;
  casting: boolean;
  locked: boolean;
}

const SLOTS = [1, 2, 3, 4] as const;
/** Face buttons that cast spells 1–4 while the spell modifier is held (input/CommandBuilder). */
const SPELL_FACE = ['x', 'y', 'b', 'a'] as const;

const icon = (id: IconId, cls: string, extra = '') => `<span class="ico ${cls}">${ICONS[id]}${extra}</span>`;

interface Bar {
  root: HTMLElement;
  fill: HTMLElement;
  /** Trails the fill down so a hit shows how much it took. */
  lag: HTMLElement;
  value: number;
  lagValue: number;
}

/** How long a toast stays up (s). */
const TOAST_SEC = 5;

/** Restart a CSS animation class. */
function restartClass(el: HTMLElement, cls: string): void {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
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
 * captured. M1b adds the spell bar (costs, cooldown sweeps, device glyphs), status and
 * weakness/resistance icons on the enemy bar, the wave runner's counter and banners, and toasts.
 * Writes to the DOM only when a value changes.
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
  private readonly enemyStatus: HTMLElement;
  private readonly enemyAffinity: HTMLElement;
  private readonly reticle: HTMLElement;
  private readonly crosshair: HTMLElement;
  private readonly died: HTMLElement;
  private readonly spellBar: HTMLElement;
  private readonly slots: SpellSlot[];
  private readonly waveInfo: HTMLElement;
  private readonly banner: HTMLElement;
  private readonly toastEl: HTMLElement;
  private toastQueue: string[] = [];
  private toastLeft = 0;
  private last = '';
  private lastEnemyName = '';
  private lastStatus = '';
  private lastAffinity = '';
  private lastGlyphs = '';
  private lastWave = '';
  private woven = false;

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
    // Statuses hang off the bar's right end and reveals sit under it, so neither shifts the bar.
    const barRow = document.createElement('div');
    barRow.className = 'bar-row';
    this.enemyStatus = document.createElement('div');
    this.enemyStatus.className = 'statuses';
    barRow.append(this.enemyBar.root, this.enemyStatus);
    this.enemyAffinity = document.createElement('div');
    this.enemyAffinity.className = 'affinities';
    this.enemy.append(this.enemyName, barRow, this.enemyAffinity);
    this.reticle = document.createElement('div');
    this.reticle.className = 'reticle';
    this.crosshair = document.createElement('div');
    this.crosshair.className = 'crosshair';
    this.died = document.createElement('div');
    this.died.className = 'died';
    this.died.textContent = 'You died';
    this.prompts = document.createElement('div');
    this.prompts.className = 'prompts';
    this.clickHint = document.createElement('div');
    this.clickHint.className = 'click-hint';
    this.clickHint.textContent = 'Click to look around';
    this.spellBar = document.createElement('div');
    this.spellBar.className = 'spell-bar';
    this.slots = SLOTS.map((n) => {
      const id = SPELL_BY_SLOT[n];
      const def = SPELLS[id];
      const root = document.createElement('div');
      root.className = 'spell';
      root.dataset.spell = id;
      root.innerHTML = `<div class="sweep"></div>${icon(id, 'spell-ico')}<div class="name">${def.name}</div><div class="cost">${def.cost}</div><kbd class="key"></kbd>`;
      this.spellBar.append(root);
      return { id, root, key: root.querySelector('.key') as HTMLElement, cd: -1, poor: false, casting: false, locked: false };
    });
    this.waveInfo = document.createElement('div');
    this.waveInfo.className = 'wave-info';
    this.banner = document.createElement('div');
    this.banner.className = 'wave-banner';
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.root.append(vitals, this.enemy, this.reticle, this.crosshair, this.died, this.waveInfo, this.banner, this.toastEl, this.spellBar, this.prompts, this.clickHint);
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
    // Spell glyphs follow the device: keys 1–4, or the modifier plus a face button (LT + X…).
    const glyphs = this.slots.map((_, i) =>
      d === 'gamepad' ? `${padGlyph(PAD.spellModifier[0] ?? 'lt', s)}+${padGlyph(SPELL_FACE[i], s)}` : keyLabel(KEYS[`spell${SLOTS[i]}`][0] ?? ''),
    );
    const g = glyphs.join('|');
    if (g !== this.lastGlyphs) {
      this.lastGlyphs = g;
      this.slots.forEach((sl, i) => (sl.key.textContent = glyphs[i]));
    }
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
      this.enemyIcons(e);
    }
    if (c.spells) this.spellState(c.spells);
    this.spellBar.classList.toggle('active', !!c.spells);
    this.waveState(c.wave);
    this.toastTick(dt);
    this.crosshair.classList.toggle('active', c.crosshair !== 'off');
    this.crosshair.classList.toggle('on-enemy', c.crosshair === 'enemy');
    const r = c.reticle;
    const showReticle = !!r && r.visible;
    this.reticle.classList.toggle('active', showReticle);
    if (r && showReticle) this.reticle.style.transform = `translate3d(${r.x.toFixed(1)}px, ${r.y.toFixed(1)}px, 0) translate(-50%, -50%)`;
  }

  /** Dodge or attack pressed with no stamina: the bar flashes (plan §4.3). */
  flashStamina(): void {
    restartClass(this.stamina.root, 'flash');
  }

  /** A spell pressed with too little mana, or on cooldown: its slot flashes (and the mana bar for mana). */
  flashSpell(spell: SpellId, why: 'mana' | 'cooldown'): void {
    const sl = this.slots.find((x) => x.id === spell);
    if (sl) restartClass(sl.root, why === 'mana' ? 'flash-mana' : 'flash-cd');
    if (why === 'mana') restartClass(this.mana.root, 'flash');
  }

  /** A big centred card ("Wave 2", "Wave cleared") that pops in and fades by itself. */
  waveBanner(title: string, sub = ''): void {
    this.banner.innerHTML = `<div class="title">${title}</div>${sub ? `<div class="sub">${sub}</div>` : ''}`;
    restartClass(this.banner, 'go');
  }

  /** A one-line explanation under the top of the screen, shown for a few seconds; they queue. */
  toast(text: string): void {
    if (this.toastQueue.includes(text)) return;
    this.toastQueue.push(text);
    if (this.toastLeft <= 0) this.nextToast();
  }

  /** The toast on screen, if any (QA). */
  get toastText(): string | null {
    return this.toastLeft > 0 ? this.toastEl.textContent : null;
  }

  /** The death card; the world says "You fell" (you wake at a shrine), the yard "You died". */
  showDeath(on: boolean, text = 'You died', sub = ''): void {
    if (on) this.died.innerHTML = sub ? `<div>${text}<span class="sub">${sub}</span></div>` : text;
    this.died.classList.toggle('active', on);
  }

  /** The death card is up (QA). */
  get deathShown(): boolean {
    return this.died.classList.contains('active');
  }

  private enemyIcons(e: HudEnemy): void {
    const sk = e.statuses.map((x) => `${x.id}${x.stacks}`).join(',');
    if (sk !== this.lastStatus) {
      this.lastStatus = sk;
      this.enemyStatus.innerHTML = e.statuses
        .map((x) => icon(x.id, `status ${x.id}`, x.id === 'chill' && x.stacks > 1 ? `<b>${x.stacks}</b>` : ''))
        .join('');
    }
    const ak = e.affinities.map((x) => `${x.key}${x.affinity}`).join(',');
    if (ak !== this.lastAffinity) {
      this.lastAffinity = ak;
      // Weak and resist read without colour too: a ▲ or ▼ beside the icon.
      this.enemyAffinity.innerHTML = e.affinities
        .map((x) => icon(x.key, `aff ${x.affinity}`, x.affinity === 'weak' ? '<i>▲</i>' : x.affinity === 'resist' ? '<i>▼</i>' : ''))
        .join('');
    }
  }

  private spellState(sp: HudSpells): void {
    for (const sl of this.slots) {
      const def = SPELLS[sl.id];
      const cd = Math.round((Math.min(def.cooldown, sp.cooldowns[sl.id] ?? 0) / Math.max(1, def.cooldown)) * 100) / 100;
      if (cd !== sl.cd) {
        sl.cd = cd;
        sl.root.style.setProperty('--cd', String(cd));
        sl.root.classList.toggle('cooling', cd > 0);
      }
      const poor = sp.mana < def.cost;
      if (poor !== sl.poor) {
        sl.poor = poor;
        sl.root.classList.toggle('poor', poor);
      }
      const casting = sp.casting === sl.id;
      if (casting !== sl.casting) {
        sl.casting = casting;
        sl.root.classList.toggle('casting', casting);
      }
      // Not learned yet (quests teach them, plan §6.2): the slot shows, dimmed and padlocked.
      const locked = !!sp.learned && !sp.learned.includes(sl.id);
      if (locked !== sl.locked) {
        sl.locked = locked;
        sl.root.classList.toggle('locked', locked);
      }
    }
    if (sp.woven !== this.woven) {
      this.woven = sp.woven;
      this.spellBar.classList.toggle('woven', sp.woven);
    }
  }

  private waveState(w: HudWave | null): void {
    let text = '';
    if (w) {
      // Waves are numbered on through the loops (the sim's `wave` events count the same way);
      // between waves `index` already points at the next one.
      const n = w.index + 1 + w.loop * WAVES.length;
      text = w.nextIn > 0 ? `Wave ${n}<span>arrives in ${Math.ceil(w.nextIn / TICK_HZ)}</span>` : `Wave ${n}<span>${w.enemiesLeft} ${w.enemiesLeft === 1 ? 'enemy' : 'enemies'} left</span>`;
    }
    if (text !== this.lastWave) {
      this.lastWave = text;
      this.waveInfo.innerHTML = text;
      this.waveInfo.classList.toggle('active', !!text);
    }
  }

  private toastTick(dt: number): void {
    if (this.toastLeft <= 0) return;
    this.toastLeft -= dt;
    if (this.toastLeft <= 0) {
      this.toastEl.classList.remove('active');
      if (this.toastQueue.length) this.nextToast();
    }
  }

  private nextToast(): void {
    const t = this.toastQueue.shift();
    if (!t) return;
    this.toastEl.textContent = t;
    this.toastLeft = TOAST_SEC;
    restartClass(this.toastEl, 'active');
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
