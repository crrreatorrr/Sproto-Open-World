/**
 * Player combat data (plan §4.2–4.5). Timing comes from the clips (generated/playerMoveTiming.ts,
 * in clip ticks); this file holds only what is designed by hand. Pure data.
 */
import { PLAYER_HITBOXES, STAFF_CAPSULE_RADIUS } from './generated/playerHitboxes';
import { PLAYER_MOVE_TIMING, type PlayerClip } from './generated/playerMoveTiming';

export type DamageKind = 'physical' | 'arcane';
export type PlayerMoveId = 'light1' | 'light2' | 'light3' | 'heavy' | 'comboHeavy' | 'riposte' | 'rollAttack';

export interface PlayerMoveDef {
  id: PlayerMoveId;
  clip: PlayerClip;
  /** Clip tick the move starts at (combo heavy and riposte enter the heavy clip at its charge start). */
  entry: number;
  /** Motion value: damage = staff.damage × mv. */
  mv: number;
  /** Hitstun on a non-elite (ticks). */
  hitstun: number;
  knockdown?: boolean;
  /** Pushback on the target (m, over 6 ticks). */
  pushback: number;
  poise: number;
  stamina: number;
  /** Hit-stop on both sides when it connects (ticks). */
  hitstop: number;
  /** Mana gained when it connects. */
  mana: number;
  /** Clip tick from which light hits don't interrupt it. */
  hyperArmorFrom?: number;
  /** Always a critical hit. */
  crit?: boolean;
  /** Can be held at the charge window for the charged version. */
  chargeable?: boolean;
  /** What a light / heavy press chains into once `cancel` opens. */
  next?: { light?: PlayerMoveId; heavy?: PlayerMoveId };
}

/** Clip markers (clip ticks) for a clip: start, activeStart, activeEnd, cancel, end, … */
export function clipTiming(clip: PlayerClip): Readonly<Record<string, number>> {
  return PLAYER_MOVE_TIMING[clip] as Readonly<Record<string, number>>;
}

const HEAVY = PLAYER_MOVE_TIMING.attack_heavy;

/**
 * How far forward of the feet the staff reaches during a clip's active ticks (m): the furthest
 * forward point of the generated capsule, plus its radius. The lunge closes the gap to this.
 */
export function clipReach(clip: PlayerClip): number {
  let reach = 0;
  for (const box of PLAYER_HITBOXES[clip] ?? []) reach = Math.max(reach, box.a[2], box.b[2]);
  return reach + STAFF_CAPSULE_RADIUS;
}

export const PLAYER_MOVES: Record<PlayerMoveId, PlayerMoveDef> = {
  light1: { id: 'light1', clip: 'attack_light_1', entry: 0, mv: 1.0, hitstun: 20, pushback: 0.3, poise: 10, stamina: 8, hitstop: 3, mana: 4, next: { light: 'light2', heavy: 'comboHeavy' } },
  light2: { id: 'light2', clip: 'attack_light_2', entry: 0, mv: 1.1, hitstun: 20, pushback: 0.3, poise: 12, stamina: 8, hitstop: 3, mana: 4, next: { light: 'light3', heavy: 'comboHeavy' } },
  light3: { id: 'light3', clip: 'attack_light_3', entry: 0, mv: 1.6, hitstun: 45, knockdown: true, pushback: 2.0, poise: 30, stamina: 10, hitstop: 8, mana: 4, next: { light: 'light1', heavy: 'heavy' } },
  heavy: { id: 'heavy', clip: 'attack_heavy', entry: 0, mv: 2.2, hitstun: 28, pushback: 1.0, poise: 35, stamina: 18, hitstop: 6, mana: 8, hyperArmorFrom: HEAVY.chargeStart, chargeable: true, next: { light: 'light1', heavy: 'heavy' } },
  comboHeavy: { id: 'comboHeavy', clip: 'attack_heavy', entry: HEAVY.chargeStart, mv: 2.4, hitstun: 28, pushback: 1.0, poise: 40, stamina: 18, hitstop: 6, mana: 8, hyperArmorFrom: HEAVY.chargeStart, next: { light: 'light1', heavy: 'heavy' } },
  riposte: { id: 'riposte', clip: 'attack_heavy', entry: HEAVY.chargeStart, mv: 2.5, hitstun: 30, pushback: 1.5, poise: 80, stamina: 0, hitstop: 8, mana: 8, crit: true, hyperArmorFrom: HEAVY.chargeStart, next: { light: 'light1', heavy: 'heavy' } },
  rollAttack: { id: 'rollAttack', clip: 'attack_light_1', entry: 0, mv: 1.2, hitstun: 20, pushback: 0.4, poise: 12, stamina: 8, hitstop: 3, mana: 4, next: { light: 'light2', heavy: 'comboHeavy' } },
};

/** The charged heavy (held through the charge window for CHARGE.full ticks). */
export const CHARGED_HEAVY = { mv: 3.0, hitstun: 50, launch: true, pushback: 2.5, poise: 60, stamina: 24, hitstop: 8 } as const;

export const CHARGE = {
  /** Held ticks for the charged version. */
  full: 30,
  /** Most ticks the charge can be held before it releases by itself. */
  max: 60,
} as const;

export const ROLL = {
  ticks: 34,
  distance: 5,
  /** I-frames: move ticks [start, end]. */
  iframeStart: 3,
  iframeEnd: 17,
  /** A hit during these i-frame ticks is a perfect dodge. */
  perfectEnd: 9,
  stamina: 22,
  /** A light press from this tick becomes a roll attack. */
  attackFrom: 26,
  /** The roll clip is scrubbed onto ROLL.ticks. */
  clip: 'roll',
} as const;

export const BLOCK = {
  /** Block clip ticks (generated): raised by tick 7. */
  raised: PLAYER_MOVE_TIMING.block.raised,
  /** Parry window from the press (ticks). */
  parryTicks: 10,
  /** A block raised within this many ticks of the last one only parries for `spamParryTicks`. */
  spamWindow: 20,
  spamParryTicks: 4,
  /** Frontal arc that blocks (degrees). */
  arcDeg: 150,
  /** Damage that still gets through a block. */
  chip: 0.2,
  /** Stagger when the guard breaks at 0 stamina. */
  guardBreakTicks: 40,
  /** Parried melee attacker: stagger ticks (non-boss), hit-stop on both sides, mana gained. */
  parryStagger: 60,
  parryHitstop: 10,
  parryMana: 15,
  /** A heavy press within this many ticks of a parry is a riposte. */
  riposteWindow: 40,
  /** Reflected projectiles: speed and damage multiplier. */
  reflect: 1.5,
  /** Walking speed while blocking (fraction of run). */
  walkScale: 0.4,
} as const;

export const BUFFER = {
  attackTicks: 10,
  dodgeTicks: 6,
} as const;

export const HITSTOP_CAP = 10;

export const LUNGE = {
  /** How far inside the target's body the staff's reach should end up (m), so a swing connects. */
  overlap: 0.3,
  max: 1.5,
  /** Lunge without a target (m). */
  noTarget: 0.4,
} as const;

export const SOFT_TARGET = {
  meleeRange: 4,
  coneDeg: 60,
  /** Turn rate toward the soft target during startup (rad/s). */
  turnRate: (720 * Math.PI) / 180,
} as const;

export const LOCK = {
  acquireRange: 20,
  coneDeg: 70,
  breakRange: 28,
  /** Ticks without line of sight before the lock breaks. */
  losGraceTicks: 60,
  /** On the target's death, lock passes to the nearest enemy within this range. */
  passRange: 10,
} as const;

export const PLAYER_STATS = {
  hp: 120,
  stamina: 100,
  mana: 100,
  /** Stamina regen (per second) after `staminaDelay` ticks without spending (`dodgeDelay` after a roll). */
  staminaRegen: 45,
  staminaDelay: 30,
  dodgeDelay: 15,
  sprintCost: 12,
  manaRegen: 1.5,
  /** Hitstun from a normal enemy hit (ticks). */
  hitstun: 18,
  /** Ticks dead before respawning (sandbox). */
  respawnTicks: 120,
  defense: { physical: 0, arcane: 0 },
  level: 1,
} as const;

/** The starter staff (plan §4.6). Loot comes in M3. */
export const STAFFS = {
  staff_sproto: { damage: 20, spellPower: 1.0 },
} as const;

/** Mana gained per hit and from a perfect dodge (plan §4.5). */
export const MANA = { perfectDodge: 10 } as const;
