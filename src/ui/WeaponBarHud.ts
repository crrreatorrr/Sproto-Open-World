import { GUN_PAD } from '../input/bindings';
import { padGlyph, type InputDevice, type PadStyle } from '../input/Gamepad';

export type WeaponKind = 'empty' | 'staff' | 'melee' | 'gun';
export type WeaponRarity = 'common' | 'uncommon' | 'rare' | 'epic' | 'legendary';

/** Plain view model for one slot on the 4-slot weapon bar. */
export interface WeaponSlotView {
  /** Display name (e.g. "Oak Staff", "Plasma MG", or empty string when unoccupied). */
  name: string;
  kind: WeaponKind;
  /** Optional short icon glyph or tag (falls back to a kind icon when omitted). */
  icon?: string;
  rarity?: WeaponRarity;
  /** True when this slot currently has a paired offhand sidearm for Dual Wield. */
  dualWield?: boolean;
}

/** Plain view model fed into `WeaponBarHud.update()` once per rendered frame. */
export interface WeaponBarHudState {
  /** Four weapon slots (0..3). */
  slots: readonly [WeaponSlotView, WeaponSlotView, WeaponSlotView, WeaponSlotView];
  /** Currently active slot index (0..3). */
  activeSlot: number;
  /** Active input device for slot/swap prompts. */
  device: InputDevice;
  padStyle: PadStyle;
  /** Active gun ammo readout; null/undefined when holding a melee/staff weapon. */
  ammo: {
    mag: number;
    magSize: number;
    reserve: number;
    /** Present when Dual Wielding: left-hand (offhand) magazine count. */
    offhandMag?: number;
    offhandMagSize?: number;
  } | null;
  /** True while reloading a gun. */
  reloading: boolean;
  /** Reload completion fraction in 0..1. */
  reloadProgress: number;
  /** Show the dynamic crosshair reticle (hidden automatically when scoped). */
  showCrosshair: boolean;
  /** Dynamic crosshair spread in radians (0 = tight, ~0.12 = wide bloom). */
  spread: number;
  /** Remaining hit-confirm flash intensity (0..1). */
  hitFlash: number;
  /** Remaining weak-spot crit flash intensity (0..1). */
  critFlash: number;
  /** Sniper scope zoom stage: 0 = off, 1 = zoom stage 1, 2 = zoom stage 2. */
  scopeZoom: 0 | 1 | 2;
  /**
   * Something stands between the barrel and the crosshair point: where the shot will land
   * instead, on screen (px). Null when the barrel is clear.
   */
  blocked?: { x: number; y: number } | null;
}

const STYLE_ID = 'sow-weapon-bar-hud-css';

const CSS = `
.wbh-root {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 18;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  color: #f4f7fb;
  user-select: none;
}
.wbh-root.hidden { display: none; }

/* 4-slot weapon bar + ammo cluster (bottom-right) */
.wbh-cluster {
  position: absolute;
  right: 22px;
  bottom: 22px;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
}

.wbh-ammo {
  display: none;
  align-items: baseline;
  gap: 8px;
  padding: 6px 12px;
  border-radius: 10px;
  background: rgba(12, 16, 24, 0.72);
  border: 1px solid rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(6px);
  font-variant-numeric: tabular-nums;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
}
.wbh-ammo.active { display: flex; }
.wbh-ammo .mag {
  font-size: 24px;
  font-weight: 800;
  letter-spacing: 0.02em;
  color: #ffffff;
}
.wbh-ammo.low .mag { color: #ffbe4d; }
.wbh-ammo.empty .mag { color: #ff5d5d; }
.wbh-ammo .dual-sep {
  font-size: 15px;
  opacity: 0.55;
  margin: 0 2px;
}
.wbh-ammo .reserve {
  font-size: 14px;
  font-weight: 600;
  color: rgba(244, 247, 251, 0.72);
}

.wbh-reload {
  display: none;
  flex-direction: column;
  align-items: flex-end;
  gap: 3px;
  width: 156px;
}
.wbh-reload.active { display: flex; }
.wbh-reload .label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #ffd166;
}
.wbh-reload .track {
  width: 100%;
  height: 5px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.18);
  overflow: hidden;
}
.wbh-reload .fill {
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, #ffd166, #ff9f1c);
  transform-origin: left center;
  transform: scaleX(0);
}

.wbh-bar {
  display: flex;
  align-items: flex-end;
  gap: 6px;
}
.wbh-swap-hint {
  align-self: center;
  padding: 3px 7px;
  border-radius: 6px;
  background: rgba(12, 16, 24, 0.65);
  border: 1px solid rgba(255, 255, 255, 0.14);
  font-size: 11px;
  font-weight: 700;
  color: rgba(244, 247, 251, 0.85);
}
.wbh-slot {
  position: relative;
  width: 68px;
  min-height: 54px;
  padding: 6px 6px 5px;
  border-radius: 10px;
  background: rgba(12, 16, 24, 0.68);
  border: 1px solid rgba(255, 255, 255, 0.15);
  backdrop-filter: blur(6px);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  gap: 3px;
  transition: transform 90ms ease, border-color 90ms ease, background 90ms ease;
}
.wbh-slot.empty { opacity: 0.45; }
.wbh-slot.active {
  transform: translateY(-4px);
  background: rgba(24, 34, 52, 0.88);
  border-color: #7ee787;
  box-shadow: 0 0 0 1px rgba(126, 231, 135, 0.45), 0 6px 18px rgba(0, 0, 0, 0.4);
}
.wbh-slot[data-rarity="uncommon"] { border-bottom: 2px solid #4ade80; }
.wbh-slot[data-rarity="rare"] { border-bottom: 2px solid #60a5fa; }
.wbh-slot[data-rarity="epic"] { border-bottom: 2px solid #c084fc; }
.wbh-slot[data-rarity="legendary"] { border-bottom: 2px solid #fbbf24; }
.wbh-slot .top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 10px;
  font-weight: 700;
  opacity: 0.85;
}
.wbh-slot .icon { font-size: 13px; line-height: 1; }
.wbh-slot .name {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.15;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* Dynamic crosshair reticle */
.wbh-crosshair {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 0;
  height: 0;
  display: none;
}
.wbh-crosshair.active { display: block; }
.wbh-blocked {
  position: absolute;
  left: 0;
  top: 0;
  width: 14px;
  height: 14px;
  margin: -7px 0 0 -7px;
  display: none;
  pointer-events: none;
}
.wbh-blocked.active { display: block; }
.wbh-blocked::before,
.wbh-blocked::after {
  content: '';
  position: absolute;
  left: 6px;
  top: 0;
  width: 2px;
  height: 14px;
  background: #ff5d5d;
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.9);
  transform: rotate(45deg);
}
.wbh-blocked::after { transform: rotate(-45deg); }
.wbh-crosshair .dot {
  position: absolute;
  left: -2px;
  top: -2px;
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.85);
}
.wbh-crosshair .tick {
  position: absolute;
  background: rgba(255, 255, 255, 0.9);
  box-shadow: 0 0 3px rgba(0, 0, 0, 0.85);
}
.wbh-crosshair .tick.t,
.wbh-crosshair .tick.b { left: -1px; width: 2px; height: 9px; }
.wbh-crosshair .tick.l,
.wbh-crosshair .tick.r { top: -1px; width: 9px; height: 2px; }
.wbh-crosshair.hit .tick,
.wbh-crosshair.hit .dot { background: #ffffff; box-shadow: 0 0 6px #ffffff; }
.wbh-crosshair.crit .tick,
.wbh-crosshair.crit .dot { background: #ff4d4f; box-shadow: 0 0 8px #ffb703; }

/* 2-stage sniper scope overlay */
.wbh-scope {
  position: absolute;
  inset: 0;
  display: none;
  background: radial-gradient(circle at center, transparent 0%, transparent 33%, rgba(4, 7, 12, 0.96) 35.5%);
}
.wbh-scope.active { display: block; }
.wbh-scope.stage-2 {
  background: radial-gradient(circle at center, transparent 0%, transparent 28%, rgba(2, 4, 8, 0.98) 30%);
}
.wbh-scope .hair-h,
.wbh-scope .hair-v {
  position: absolute;
  background: rgba(190, 255, 220, 0.65);
}
.wbh-scope .hair-h { left: 15%; right: 15%; top: 50%; height: 1px; }
.wbh-scope .hair-v { top: 10%; bottom: 10%; left: 50%; width: 1px; }
.wbh-scope .ring {
  position: absolute;
  left: 50%;
  top: 50%;
  width: 66vmin;
  height: 66vmin;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  border: 2px solid rgba(190, 255, 220, 0.35);
}
.wbh-scope.stage-2 .ring {
  width: 56vmin;
  height: 56vmin;
  border-color: rgba(255, 209, 102, 0.55);
}
.wbh-scope .badge {
  position: absolute;
  left: 50%;
  top: calc(50% + 26vmin);
  transform: translateX(-50%);
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(8, 12, 18, 0.8);
  border: 1px solid rgba(190, 255, 220, 0.35);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: #befcdc;
}
`;

function ensureStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.append(style);
}

function div(cls: string, text = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.className = cls;
  if (text) el.textContent = text;
  return el;
}

function defaultIcon(slot: WeaponSlotView): string {
  if (slot.icon) return slot.icon;
  if (slot.dualWield) return '🔫🔫';
  switch (slot.kind) {
    case 'gun': return '🔫';
    case 'staff': return '🪄';
    case 'melee': return '⚔️';
    default: return '·';
  }
}

interface SlotDom {
  el: HTMLDivElement;
  hint: HTMLDivElement;
  icon: HTMLDivElement;
  name: HTMLDivElement;
  lastKey: string;
}

/**
 * Self-contained DOM HUD for the 4-slot weapon bar, gun ammo (including Dual Wield), reload bar,
 * dynamic spread crosshair, and 2-stage sniper scope overlay. Reads plain view state only.
 */
export class WeaponBarHud {
  private readonly root: HTMLDivElement;
  private readonly ammoEl: HTMLDivElement;
  private readonly magEl: HTMLDivElement;
  private readonly reserveEl: HTMLDivElement;
  private readonly reloadEl: HTMLDivElement;
  private readonly reloadFill: HTMLDivElement;
  private readonly swapHintEl: HTMLDivElement;
  private readonly slots: SlotDom[] = [];
  private readonly crosshairEl: HTMLDivElement;
  private readonly blockedEl: HTMLDivElement;
  private lastBlocked = '';
  private readonly tickT: HTMLDivElement;
  private readonly tickB: HTMLDivElement;
  private readonly tickL: HTMLDivElement;
  private readonly tickR: HTMLDivElement;
  private readonly scopeEl: HTMLDivElement;
  private readonly scopeBadge: HTMLDivElement;

  private lastAmmoKey = '';
  private lastReloading = false;
  private lastReloadFrac = -1;
  private lastSwapHint = '';
  private lastCrosshairOn = false;
  private lastSpreadPx = -1;
  private lastHit = false;
  private lastCrit = false;
  private lastScope: 0 | 1 | 2 = 0;

  constructor(host: HTMLElement) {
    ensureStyles();
    this.root = div('wbh-root');

    // Sniper 2-stage scope overlay.
    this.scopeEl = div('wbh-scope');
    this.scopeBadge = div('badge', 'ZOOM 1');
    this.scopeEl.append(div('hair-h'), div('hair-v'), div('ring'), this.scopeBadge);

    // Dynamic crosshair.
    this.crosshairEl = div('wbh-crosshair');
    this.tickT = div('tick t');
    this.tickB = div('tick b');
    this.tickL = div('tick l');
    this.tickR = div('tick r');
    this.crosshairEl.append(div('dot'), this.tickT, this.tickB, this.tickL, this.tickR);

    // Bottom-right cluster: reload bar, ammo readout, 4-slot weapon bar.
    const cluster = div('wbh-cluster');
    this.reloadEl = div('wbh-reload');
    const track = div('track');
    this.reloadFill = div('fill');
    track.append(this.reloadFill);
    this.reloadEl.append(div('label', 'Reloading'), track);

    this.ammoEl = div('wbh-ammo');
    this.magEl = div('mag');
    this.reserveEl = div('reserve');
    this.ammoEl.append(this.magEl, this.reserveEl);

    const bar = div('wbh-bar');
    this.swapHintEl = div('wbh-swap-hint');
    bar.append(this.swapHintEl);
    for (let i = 0; i < 4; i++) {
      const el = div('wbh-slot empty');
      const top = div('top');
      const hint = div('hint', String(i + 1));
      const icon = div('icon', '·');
      top.append(hint, icon);
      const name = div('name', 'Empty');
      el.append(top, name);
      bar.append(el);
      this.slots.push({ el, hint, icon, name, lastKey: '' });
    }

    cluster.append(this.reloadEl, this.ammoEl, bar);
    this.blockedEl = div('wbh-blocked');
    this.root.append(this.scopeEl, this.crosshairEl, this.blockedEl, cluster);
    host.append(this.root);
  }

  setVisible(visible: boolean): void {
    this.root.classList.toggle('hidden', !visible);
  }

  /** Apply the latest view snapshot. Writes to the DOM only when a visible value changes. */
  update(s: WeaponBarHudState): void {
    // 1. Swap prompt (pad glyph vs Tab).
    const swapHint = s.device === 'gamepad' ? padGlyph(GUN_PAD.swapWeapon[0] ?? 'right', s.padStyle) : 'Tab';
    if (swapHint !== this.lastSwapHint) {
      this.lastSwapHint = swapHint;
      this.swapHintEl.textContent = swapHint;
    }

    // 2. Four weapon bar slots.
    for (let i = 0; i < 4; i++) {
      const slot = s.slots[i];
      const dom = this.slots[i];
      const active = i === s.activeSlot;
      const icon = defaultIcon(slot);
      const label = slot.name || 'Empty';
      const rarity = slot.rarity ?? '';
      const key = `${active ? 1 : 0}|${slot.kind}|${rarity}|${icon}|${label}`;
      if (key !== dom.lastKey) {
        dom.lastKey = key;
        dom.el.classList.toggle('active', active);
        dom.el.classList.toggle('empty', slot.kind === 'empty');
        if (rarity) dom.el.dataset.rarity = rarity;
        else delete dom.el.dataset.rarity;
        dom.icon.textContent = icon;
        dom.name.textContent = label;
      }
    }

    // 3. Ammo readout (supports single gun and Dual Wield L|R magazines).
    const ammoKey = s.ammo
      ? `${s.ammo.mag}/${s.ammo.magSize}/${s.ammo.reserve}/${s.ammo.offhandMag ?? ''}`
      : 'none';
    if (ammoKey !== this.lastAmmoKey) {
      this.lastAmmoKey = ammoKey;
      const on = !!s.ammo;
      this.ammoEl.classList.toggle('active', on);
      if (s.ammo) {
        const low = s.ammo.mag > 0 && s.ammo.mag <= Math.ceil(s.ammo.magSize * 0.25);
        const empty = s.ammo.mag <= 0 && (s.ammo.offhandMag === undefined || s.ammo.offhandMag <= 0);
        this.ammoEl.classList.toggle('low', low);
        this.ammoEl.classList.toggle('empty', empty);
        if (s.ammo.offhandMag !== undefined) {
          this.magEl.textContent = `${s.ammo.offhandMag} | ${s.ammo.mag}`;
        } else {
          this.magEl.textContent = String(s.ammo.mag);
        }
        this.reserveEl.textContent = `/ ${s.ammo.reserve}`;
      }
    }

    // 4. Reload progress indicator.
    if (s.reloading !== this.lastReloading) {
      this.lastReloading = s.reloading;
      this.reloadEl.classList.toggle('active', s.reloading);
    }
    if (s.reloading) {
      const f = Math.min(1, Math.max(0, s.reloadProgress));
      if (Math.abs(f - this.lastReloadFrac) > 1e-3) {
        this.lastReloadFrac = f;
        this.reloadFill.style.transform = `scaleX(${f.toFixed(3)})`;
      }
    } else if (this.lastReloadFrac !== 0) {
      this.lastReloadFrac = 0;
      this.reloadFill.style.transform = 'scaleX(0)';
    }

    // 5. Sniper 2-stage scope overlay.
    if (s.scopeZoom !== this.lastScope) {
      this.lastScope = s.scopeZoom;
      this.scopeEl.classList.toggle('active', s.scopeZoom > 0);
      this.scopeEl.classList.toggle('stage-2', s.scopeZoom === 2);
      if (s.scopeZoom > 0) this.scopeBadge.textContent = s.scopeZoom === 2 ? 'ZOOM 2×' : 'ZOOM 1×';
    }

    // 6. Dynamic crosshair reticle (hidden while sniper scope is active).
    const crossOn = s.showCrosshair && s.scopeZoom === 0;
    if (crossOn !== this.lastCrosshairOn) {
      this.lastCrosshairOn = crossOn;
      this.crosshairEl.classList.toggle('active', crossOn);
    }
    // A blocked barrel: a small red cross where the shot will really land.
    const b = s.showCrosshair && s.blocked ? `${Math.round(s.blocked.x)},${Math.round(s.blocked.y)}` : '';
    if (b !== this.lastBlocked) {
      this.lastBlocked = b;
      this.blockedEl.classList.toggle('active', b !== '');
      if (s.blocked && b) this.blockedEl.style.transform = `translate(${Math.round(s.blocked.x)}px, ${Math.round(s.blocked.y)}px)`;
    }
    if (crossOn) {
      const gapPx = Math.round(6 + Math.min(48, Math.max(0, s.spread) * 320));
      if (gapPx !== this.lastSpreadPx) {
        this.lastSpreadPx = gapPx;
        this.tickT.style.top = `${-(gapPx + 9)}px`;
        this.tickB.style.top = `${gapPx}px`;
        this.tickL.style.left = `${-(gapPx + 9)}px`;
        this.tickR.style.left = `${gapPx}px`;
      }
      const crit = s.critFlash > 0.01;
      const hit = !crit && s.hitFlash > 0.01;
      if (hit !== this.lastHit) {
        this.lastHit = hit;
        this.crosshairEl.classList.toggle('hit', hit);
      }
      if (crit !== this.lastCrit) {
        this.lastCrit = crit;
        this.crosshairEl.classList.toggle('crit', crit);
      }
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
