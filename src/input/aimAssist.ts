/**
 * Gamepad-only aim assist, ported from Sproto Shooter (`src/input/aimAssist.js`):
 * - Stick look slowdown while the reticle is near an enemy.
 * - Gentle ADS drift toward the enemy's head while aiming.
 *
 * Pure: reads `ReadonlySimView` or plain target snapshots, never mutates sim state.
 * Keyboard and mouse always receive zero adjustment (`slow = 1, dYaw = 0, dPitch = 0`).
 */
import type { Vec3 } from '../sim/math';
import type { ReadonlySimView } from '../sim/view';

export type AimInputDevice = 'gamepad' | 'kbm';

export interface AimAssistConfig {
  enabled: boolean;
  strength: number;
  /** Maximum assist range (m), also capped by the equipped gun's reach. */
  maxRange: number;
  minRange: number;
  /** Assist cone: target radius + margin (m), clamped between minConeDeg and maxConeDeg. */
  marginM: number;
  minConeDeg: number;
  maxConeDeg: number;
  /** Fraction of stick look speed removed at target centre while hip-firing / ADS. */
  slowHip: number;
  slowAds: number;
  minSlow: number;
  /** Head pull speed (deg/s) at cone centre while ADS. */
  pullDegPerSec: number;
  /** Share of pull applied when the player gives no stick or move input. */
  pullIdleScale: number;
}

export const AIM_ASSIST: Readonly<AimAssistConfig> = {
  enabled: true,
  strength: 1,
  maxRange: 80,
  minRange: 0.75,
  marginM: 0.6,
  minConeDeg: 2.5,
  maxConeDeg: 9,
  slowHip: 0.35,
  slowAds: 0.5,
  minSlow: 0.25,
  pullDegPerSec: 7,
  pullIdleScale: 0.35,
};

export interface AimAssistTarget {
  center: Readonly<Vec3>;
  head: Readonly<Vec3>;
  r: number;
  entityId?: number;
}

export interface AimAssistInput {
  eye: Readonly<Vec3>;
  yaw: number;
  pitch: number;
  targets: readonly AimAssistTarget[];
  /** True while ADS or scoped. */
  aiming: boolean;
  /** 0..1, how hard the player is steering (look or move stick). */
  input: number;
  /** Frame delta in seconds. */
  dt: number;
  /** Active input device; 'kbm' always receives zero adjustment. */
  device?: AimInputDevice;
  /** Player's "Aim assist" setting (0 = off, default 1). */
  aimAssistStrength?: number;
  /** Equipped gun's reach in metres (caps `cfg.maxRange` when > 0). */
  range?: number;
}

export interface AimAssistResult {
  /** Multiplier on right-stick look speed (1 = normal, < 1 = slowed near target). */
  slow: number;
  /** Yaw drift to add this frame (radians). */
  dYaw: number;
  /** Pitch drift to add this frame (radians). */
  dPitch: number;
  /** Index into `targets` of the assisted target, or -1 when none. */
  target: number;
}

const DEG_TO_RAD = Math.PI / 180;
const deg = (d: number): number => d * DEG_TO_RAD;

function angleWrap(a: number): number {
  let r = a % (Math.PI * 2);
  if (r > Math.PI) r -= Math.PI * 2;
  if (r < -Math.PI) r += Math.PI * 2;
  return r;
}

/**
 * Extract aim-assist targets from the sim's read-only view: every live enemy or boss's body centre
 * and head height. Reuses `out` when provided.
 */
export function assistTargetsFromView(view: ReadonlySimView, out: AimAssistTarget[] = []): AimAssistTarget[] {
  out.length = 0;
  for (const e of view.entities) {
    if (e.kind !== 'enemy' && e.kind !== 'boss') continue;
    if (e.combat?.action?.kind === 'dead') continue;
    if (e.vitals && e.vitals.hp <= 0) continue;
    const radius = e.body?.radius ?? 0.45;
    const height = e.body?.height ?? 1.8;
    const { x, y, z } = e.tf.pos;
    const center: Vec3 = { x, y: y + height * 0.5, z };
    const head: Vec3 = { x, y: y + Math.max(height * 0.5, height - radius * 0.8), z };
    out.push({ center, head, r: Math.max(radius, height * 0.35), entityId: e.id });
  }
  return out;
}

/**
 * Yaw and pitch looking from `eye` toward `p`, matching `CameraRig`'s convention
 * (`forward = (sin(yaw)*cos(pitch), sin(pitch), cos(yaw)*cos(pitch))`).
 */
export function lookAngles(eye: Readonly<Vec3>, p: Readonly<Vec3>): { yaw: number; pitch: number; dist: number } {
  const dx = p.x - eye.x;
  const dy = p.y - eye.y;
  const dz = p.z - eye.z;
  return {
    yaw: Math.atan2(dx, dz),
    pitch: Math.atan2(dy, Math.hypot(dx, dz)),
    dist: Math.hypot(dx, dy, dz),
  };
}

function angErr(yaw: number, pitch: number, a: { yaw: number; pitch: number }): { err: number; dYaw: number; dPitch: number } {
  const dYaw = angleWrap(a.yaw - yaw);
  const dPitch = a.pitch - pitch;
  return { err: Math.hypot(dYaw * Math.cos(a.pitch), dPitch), dYaw, dPitch };
}

/**
 * Compute one frame of controller-only aim assist.
 * Returns `{ slow: 1, dYaw: 0, dPitch: 0, target: -1 }` whenever `device === 'kbm'` or
 * `aimAssistStrength <= 0`.
 */
export function aimAssist(o: AimAssistInput, cfg: Readonly<AimAssistConfig> = AIM_ASSIST): AimAssistResult {
  const none: AimAssistResult = { slow: 1, dYaw: 0, dPitch: 0, target: -1 };
  if (o.device === 'kbm') return none;
  const k = (o.aimAssistStrength ?? 1) * cfg.strength;
  if (!cfg.enabled || !(k > 0) || o.targets.length === 0) return none;

  const maxRange = Math.min(cfg.maxRange, o.range !== undefined && o.range > 0 ? o.range : cfg.maxRange);
  let best = -1;
  let bestScore = 1;
  let bestHead: { err: number; dYaw: number; dPitch: number; cone: number } | null = null;

  for (let i = 0; i < o.targets.length; i++) {
    const t = o.targets[i]!;
    const c = lookAngles(o.eye, t.center);
    if (c.dist < cfg.minRange || c.dist > maxRange) continue;
    const cone = Math.min(deg(cfg.maxConeDeg), Math.max(deg(cfg.minConeDeg), Math.atan((t.r + cfg.marginM) / c.dist)));
    const h = lookAngles(o.eye, t.head);
    const ec = angErr(o.yaw, o.pitch, c);
    const eh = angErr(o.yaw, o.pitch, h);
    const score = Math.min(ec.err, eh.err) / cone;
    if (score < bestScore) {
      bestScore = score;
      best = i;
      bestHead = { ...eh, cone };
    }
  }

  if (best < 0 || !bestHead) return none;

  const close = 1 - bestScore;
  const slow = Math.max(cfg.minSlow, 1 - k * (o.aiming ? cfg.slowAds : cfg.slowHip) * close);
  if (!o.aiming || bestHead.err < 1e-5) return { slow, dYaw: 0, dPitch: 0, target: best };

  const steering = Math.min(1, Math.max(0, o.input || 0));
  const rate = deg(cfg.pullDegPerSec) * k * close * (cfg.pullIdleScale + (1 - cfg.pullIdleScale) * steering);
  const step = Math.min(bestHead.err, rate * Math.max(0, o.dt || 0));
  const f = step / bestHead.err;
  return { slow, dYaw: bestHead.dYaw * f, dPitch: bestHead.dPitch * f, target: best };
}
