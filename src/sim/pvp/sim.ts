// Pure deterministic 30 Hz Free 1v1 PvP simulation (Sim v3 — no Second Wind).
// Zero Three.js, zero Rapier, zero DOM, zero Math.random, zero timers.
// Runs identically in browser and Nakama Goja ES2020.

import {
  arenaHook,
  arenaOccludes,
  clampToArenaBounds,
  firstArenaSolid,
  pillarGroundHeight,
  pushOutOfPillars,
  type Vec3,
} from './arena';
import {
  DT,
  fnv1a,
  MATCH_TICKS,
  PVP_TUNING as T,
  quantizeForHash,
  rangeFalloff,
  RESERVE,
  REWIND,
  sha256Hex,
  SPAWN_RADIUS,
  stableStringify,
  STAGE_ID,
  STOCK_GUNS,
} from './rules';

const MAX_HP = T.maxHp * 1000;
const MAX_SHIELD = T.maxShield * 1000;
const DEG2RAD = Math.PI / 180;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

export interface GrappleAnchor {
  x: number;
  y: number;
  z: number;
  id: string;
}

export interface HistoryEntry {
  t: number;
  x: number;
  y: number;
  z: number;
  alive: boolean;
  invuln: number;
}

export interface PvpPlayerState {
  seat: 0 | 1;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  hp: number;
  shield: number;
  shieldDelay: number;
  alive: boolean;
  onGround: boolean;
  invuln: number;
  stamina: number;
  staminaDelay: number;
  staminaLock: boolean;
  dashT: number;
  dashCd: number;
  dashX: number;
  dashZ: number;
  slideT: number;
  slideCd: number;
  coyoteT: number;
  jumpBufferT: number;
  jumpsLeft: number;
  zooming: boolean;
  zoomCancelled: boolean;
  grappleCd: number;
  grapple: GrappleAnchor | null;
  grappleMiss: boolean;
  slot: number;
  mag: [number, number, number];
  shells: number;
  sniper: number;
  fireCd: number;
  reloadT: number;
  swapT: number;
  rng: RngState;
}

export type PvpPhase = 'live' | 'done';
export type PvpOutcome = 'ko' | 'time' | 'draw' | null;
export type PvpReason = 'ko' | 'double_ko' | 'time' | null;

export interface PvpMatchState {
  spawnSeed: number;
  stage: string;
  tick: number;
  phase: PvpPhase;
  outcome: PvpOutcome;
  winner: 0 | 1 | null;
  reason: PvpReason;
  players: [PvpPlayerState, PvpPlayerState];
  hist: [Array<HistoryEntry | null>, Array<HistoryEntry | null>];
}

export interface PvpWish {
  yaw: number;
  pitch: number;
  moveX: number;
  moveZ: number;
  fire: boolean;
  zoom: boolean;
  sprint: boolean;
  jump: boolean;
  dash: boolean;
  reload: boolean;
  slide: boolean;
  crouch: boolean;
  grapple: boolean;
  slot: number;
  rewind: number;
  viewTick?: number;
  viewFrac: number;
}

export type PartialPvpWish = Partial<PvpWish>;

export interface PvpShotEvent {
  tick: number;
  shooter: 0 | 1;
  dmg: number;
  pellets: number;
  hits: number;
  rewind: number;
  viewFrac: number;
}

export interface PvpSnapshotPlayer {
  seat: 0 | 1;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  hp: number;
  shield: number;
  alive: boolean;
  slot: number;
  mag: [number, number, number];
  shells: number;
  sniper: number;
  reloadT: number;
  fireCd: number;
  swapT: number;
  grappleCd: number;
  grappleMiss: boolean;
  grapple: GrappleAnchor | null;
}

export interface PvpSnapshot {
  tick: number;
  hash: string;
  publicHash: string;
  phase: PvpPhase;
  outcome: PvpOutcome;
  winner: 0 | 1 | null;
  reason: PvpReason;
  players: [PvpSnapshotPlayer, PvpSnapshotPlayer];
}

export interface RewoundTarget {
  x: number;
  y: number;
  z: number;
  invuln: number;
  base: number;
  rewind: number;
  viewFrac: number;
}

// ---------------------------------------------------------------------------
// Pure deterministic math & sfc32 RNG
// ---------------------------------------------------------------------------

function q4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function dirFromYawPitch(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return {
    x: -Math.sin(yaw) * cp,
    y: Math.sin(pitch),
    z: -Math.cos(yaw) * cp,
  };
}

export function yawTo(from: { x: number; z: number }, to: { x: number; z: number }): number {
  return Math.atan2(-(to.x - from.x), -(to.z - from.z));
}

function hashSeed(n: number): [number, number, number, number] {
  let s = (n >>> 0) || 0x9e3779b9;
  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    s = (s + 0x9e3779b9) >>> 0;
    let z = s;
    z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
    z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
    out[i] = (z ^ (z >>> 16)) >>> 0;
  }
  return out;
}

export function nextU32(r: RngState): number {
  r.a >>>= 0;
  r.b >>>= 0;
  r.c >>>= 0;
  r.d >>>= 0;
  const t = (r.a + r.b) >>> 0;
  r.a = r.b ^ (r.b >>> 9);
  r.b = (r.c + (r.c << 3)) >>> 0;
  r.c = (r.c << 21) | (r.c >>> 11);
  r.d = (r.d + 1) >>> 0;
  const res = (t + r.d) >>> 0;
  r.c = (r.c + res) >>> 0;
  return res;
}

export function randFloat(r: RngState): number {
  return nextU32(r) / 4294967296;
}

export function createRng(seed: number): RngState {
  const [a, b, c, d] = hashSeed(seed);
  const r: RngState = { a, b, c, d };
  for (let i = 0; i < 12; i++) nextU32(r);
  return r;
}

/** Four 32-bit words of sfc32 state derived from SHA-256 of the secret combat seed. */
export function combatRngWords(combatSeed: string): [number, number, number, number] {
  const digest = sha256Hex(`sproto-open-world:pvp:combat:${combatSeed}`);
  return [
    parseInt(digest.slice(0, 8), 16) >>> 0,
    parseInt(digest.slice(8, 16), 16) >>> 0,
    parseInt(digest.slice(16, 24), 16) >>> 0,
    parseInt(digest.slice(24, 32), 16) >>> 0,
  ];
}

function combatRng(combatSeed: number | string): RngState {
  if (typeof combatSeed !== 'string') return createRng((Number(combatSeed) >>> 0) || 1);
  const [a, b, c, d] = combatRngWords(combatSeed);
  const r: RngState = { a, b, c, d: d || 1 };
  for (let i = 0; i < 12; i++) nextU32(r);
  return r;
}

// ---------------------------------------------------------------------------
// Capsule hit detection
// ---------------------------------------------------------------------------

function raySphere(o: Vec3, d: Vec3, c: Vec3, r: number): number {
  const ox = o.x - c.x;
  const oy = o.y - c.y;
  const oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z;
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = -b - s;
  if (t < 0) t = -b + s;
  return t >= 0 ? t : -1;
}

/** Vertical capsule ray intersection. Returns distance along a unit ray, or -1. */
export function rayCapsule(
  o: Vec3,
  d: Vec3,
  cx: number,
  cz: number,
  y0: number,
  y1: number,
  r: number,
): number {
  const a0 = y0 + r;
  const a1 = Math.max(a0, y1 - r);
  let best = -1;
  const ox = o.x - cx;
  const oz = o.z - cz;
  const A = d.x * d.x + d.z * d.z;
  if (A > 1e-9) {
    const B = ox * d.x + oz * d.z;
    const C = ox * ox + oz * oz - r * r;
    const disc = B * B - A * C;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      const roots = [(-B - s) / A, (-B + s) / A];
      for (let i = 0; i < 2; i++) {
        const t = roots[i];
        if (t < 0) continue;
        const y = o.y + d.y * t;
        if (y >= a0 && y <= a1) {
          best = t;
          break;
        }
      }
    }
  }
  const caps = [a0, a1];
  for (let i = 0; i < 2; i++) {
    const t = raySphere(o, d, { x: cx, y: caps[i], z: cz }, r);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Match creation & history ring
// ---------------------------------------------------------------------------

export function spawnsFor(seed: number): [Vec3, Vec3] {
  const angle = ((seed >>> 0) % 360) * DEG2RAD;
  const x = q4(Math.cos(angle) * SPAWN_RADIUS);
  const z = q4(Math.sin(angle) * SPAWN_RADIUS);
  return [
    { x, y: 0, z },
    { x: q4(-x), y: 0, z: q4(-z) },
  ];
}

function makePlayer(seat: 0 | 1, pos: Vec3, yaw: number, rng: RngState): PvpPlayerState {
  return {
    seat,
    x: pos.x,
    y: 0,
    z: pos.z,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: q4(yaw),
    pitch: 0,
    hp: MAX_HP,
    shield: MAX_SHIELD,
    shieldDelay: 0,
    alive: true,
    onGround: true,
    invuln: 0,
    stamina: 1,
    staminaDelay: 0,
    staminaLock: false,
    dashT: 0,
    dashCd: 0,
    dashX: 0,
    dashZ: 0,
    slideT: 0,
    slideCd: 0,
    coyoteT: 0,
    jumpBufferT: 0,
    jumpsLeft: 2,
    zooming: false,
    zoomCancelled: false,
    grappleCd: 0,
    grapple: null,
    grappleMiss: false,
    slot: 0,
    mag: [
      STOCK_GUNS[0].stats.magSize,
      STOCK_GUNS[1].stats.magSize,
      STOCK_GUNS[2].stats.magSize,
    ],
    shells: RESERVE.shells,
    sniper: RESERVE.sniper,
    fireCd: 0,
    reloadT: 0,
    swapT: 0,
    rng: { a: rng.a, b: rng.b, c: rng.c, d: rng.d },
  };
}

function recordHistory(state: PvpMatchState, tick: number): void {
  const idx = tick % REWIND.historyTicks;
  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    state.hist[i][idx] = { t: tick, x: p.x, y: p.y, z: p.z, alive: p.alive, invuln: p.invuln };
  }
}

function histAt(state: PvpMatchState, seat: 0 | 1, tick: number): HistoryEntry | null {
  if (tick < 0) return null;
  const entry = state.hist[seat][tick % REWIND.historyTicks];
  return entry && entry.t === tick ? entry : null;
}

/**
 * Create a new Free/Wager 1v1 PvP match state.
 * `spawnSeed` (public) determines symmetric spawn angles; `combatSeed` (secret until RESULT)
 * seeds the 128-bit sfc32 combat RNG.
 */
export function createMatch(spawnSeed: number, combatSeed: number | string = spawnSeed): PvpMatchState {
  const n = spawnSeed >>> 0;
  const rng = combatRng(combatSeed);
  const points = spawnsFor(n);
  const yaw0 = yawTo(points[0], points[1]);
  const yaw1 = yawTo(points[1], points[0]);
  const hist0 = new Array<HistoryEntry | null>(REWIND.historyTicks).fill(null);
  const hist1 = new Array<HistoryEntry | null>(REWIND.historyTicks).fill(null);
  const state: PvpMatchState = {
    spawnSeed: n,
    stage: STAGE_ID,
    tick: 0,
    phase: 'live',
    outcome: null,
    winner: null,
    reason: null,
    players: [
      makePlayer(0, points[0], yaw0, rng),
      makePlayer(1, points[1], yaw1, rng),
    ],
    hist: [hist0, hist1],
  };
  recordHistory(state, 0);
  return state;
}

/** Interpolated target capsule from the 12-tick history ring. */
export function rewoundTarget(
  state: PvpMatchState,
  seat: 0 | 1,
  frame: number,
  rewind: number,
  viewFrac: number,
): RewoundTarget {
  const base = frame - rewind;
  const a = histAt(state, seat, base) ?? histAt(state, seat, frame + 1)!;
  const b = histAt(state, seat, base + 1) ?? a;
  const t = viewFrac / REWIND.fracSteps;
  return {
    x: q4(a.x + (b.x - a.x) * t),
    y: q4(a.y + (b.y - a.y) * t),
    z: q4(a.z + (b.z - a.z) * t),
    invuln: a.invuln,
    base,
    rewind,
    viewFrac,
  };
}

/** Query interpolated history position for a seat at fractional tick `at`, or null if evicted. */
export function historyAt(
  state: PvpMatchState,
  seat: 0 | 1,
  at: number,
): { x: number; y: number; z: number; invuln: number; alive: boolean } | null {
  const base = Math.floor(at);
  const a = histAt(state, seat, base);
  if (!a) return null;
  const b = histAt(state, seat, base + 1) ?? a;
  const t = at - base;
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
    invuln: a.invuln,
    alive: a.alive,
  };
}

// ---------------------------------------------------------------------------
// Wish normalization
// ---------------------------------------------------------------------------

function viewOf(wish: PartialPvpWish, tick: number): { back: number; frac: number } {
  let back = 0;
  if (typeof wish.rewind === 'number' && Number.isInteger(wish.rewind)) {
    back = wish.rewind;
  } else if (typeof wish.viewTick === 'number' && Number.isInteger(wish.viewTick)) {
    back = tick - wish.viewTick;
  }
  let frac =
    typeof wish.viewFrac === 'number' && Number.isInteger(wish.viewFrac)
      ? Math.max(0, Math.min(REWIND.fracSteps - 1, wish.viewFrac))
      : 0;
  if (back < 0) {
    back = 0;
    frac = 0;
  }
  if (back > REWIND.maxTicks) {
    back = REWIND.maxTicks;
    frac = 0;
  }
  if (back > tick) {
    back = tick;
    frac = 0;
  }
  return { back, frac };
}

export function normalizeWish(
  player: PvpPlayerState,
  raw: PartialPvpWish | null | undefined,
  tick = 0,
): PvpWish {
  const wish = raw ?? {};
  const num = (v: unknown, fallback: number): number =>
    typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  let slot = -1;
  if (typeof wish.slot === 'number' && Number.isInteger(wish.slot) && wish.slot >= 0 && wish.slot <= 2) {
    slot = wish.slot;
  }
  const view = viewOf(wish, tick);
  return {
    yaw: num(wish.yaw, player.yaw),
    pitch: Math.max(-T.pitchLimit, Math.min(T.pitchLimit, num(wish.pitch, player.pitch))),
    moveX: Math.max(-1, Math.min(1, num(wish.moveX, 0))),
    moveZ: Math.max(-1, Math.min(1, num(wish.moveZ, 0))),
    fire: !!wish.fire,
    zoom: !!wish.zoom,
    sprint: !!wish.sprint,
    jump: !!wish.jump,
    dash: !!wish.dash,
    reload: !!wish.reload,
    slide: !!wish.slide,
    crouch: !!wish.crouch,
    grapple: !!wish.grapple,
    slot,
    rewind: view.back,
    viewFrac: view.frac,
  };
}

// ---------------------------------------------------------------------------
// Movement, grapple, and collision (shared with client prediction)
// ---------------------------------------------------------------------------

function eyeOf(p: PvpPlayerState): Vec3 {
  return { x: p.x, y: p.y + (p.slideT > 0 ? T.slideEye : T.eyeHeight), z: p.z };
}

function clampSpeed3(vx: number, vy: number, vz: number, limit: number): [number, number, number] {
  const s = Math.hypot(vx, vy, vz);
  if (s > limit && s > 0) {
    const k = limit / s;
    return [vx * k, vy * k, vz * k];
  }
  return [vx, vy, vz];
}

function releaseGrapple(p: PvpPlayerState): void {
  if (!p.grapple) return;
  const [vx, vy, vz] = clampSpeed3(p.vx, p.vy, p.vz, T.grappleReleaseSpeed);
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
  p.grapple = null;
}

function tickGrapple(p: PvpPlayerState, wish: PvpWish, dt: number): void {
  if (p.grappleCd > 0) p.grappleCd = Math.max(0, p.grappleCd - dt);
  if (!wish.grapple) {
    releaseGrapple(p);
    return;
  }
  if (!p.grapple) {
    if (p.grappleCd > 0) return;
    const hit = arenaHook(eyeOf(p), dirFromYawPitch(p.yaw, p.pitch), T.grappleRange);
    p.grappleCd = T.grappleCd;
    if (!hit) {
      p.grappleMiss = true;
      return;
    }
    p.grappleMiss = false;
    p.grapple = { x: hit.x, y: hit.y, z: hit.z, id: hit.id };
  }
  const hook = p.grapple;
  const eye = eyeOf(p);
  const ex = hook.x - eye.x;
  const ey = hook.y - eye.y;
  const ez = hook.z - eye.z;
  const ed = Math.hypot(ex, ey, ez) || 1;
  if (arenaOccludes(eye, { x: ex / ed, y: ey / ed, z: ez / ed }, ed - 0.35, hook.id)) {
    releaseGrapple(p);
    return;
  }
  const dx = hook.x - p.x;
  const dy = hook.y - (p.y + T.grappleOrigin);
  const dz = hook.z - p.z;
  const dist = Math.hypot(dx, dy, dz) || 1;
  if (dist < T.grappleArrive) {
    releaseGrapple(p);
    return;
  }
  const pull = T.grapplePull * dt;
  const [vx, vy, vz] = clampSpeed3(
    p.vx + (dx / dist) * pull,
    p.vy + (dy / dist) * pull,
    p.vz + (dz / dist) * pull,
    T.grappleSpeed,
  );
  p.vx = vx;
  p.vy = vy;
  p.vz = vz;
}

/**
 * Pure movement step for one player and one tick.
 * Shared identically by the authoritative sim and client prediction.
 */
export function movePlayer(p: PvpPlayerState, wish: PvpWish, dt: number): void {
  p.yaw = q4(wish.yaw);
  p.pitch = q4(Math.max(-T.pitchLimit, Math.min(T.pitchLimit, wish.pitch)));

  if (wish.slot >= 0 && wish.slot !== p.slot) {
    p.slot = wish.slot;
    p.reloadT = 0;
    p.swapT = STOCK_GUNS[p.slot].stats.swapTime;
  }

  p.invuln = Math.max(0, p.invuln - dt);
  p.dashCd = Math.max(0, p.dashCd - dt);
  p.slideCd = Math.max(0, p.slideCd - dt);

  // Forward / right basis from yaw
  const fwdX = -Math.sin(p.yaw);
  const fwdZ = -Math.cos(p.yaw);
  const rightX = Math.cos(p.yaw);
  const rightZ = -Math.sin(p.yaw);

  let wishX = rightX * wish.moveX + fwdX * wish.moveZ;
  let wishZ = rightZ * wish.moveX + fwdZ * wish.moveZ;
  const wishLen = Math.hypot(wishX, wishZ);
  if (wishLen > 1) {
    wishX /= wishLen;
    wishZ /= wishLen;
  }

  // Sprint & stamina
  const wantsSprint = wish.sprint && wishLen > 0.1 && p.onGround && !p.staminaLock && p.slideT <= 0;
  if (wantsSprint) {
    p.zoomCancelled = true;
    p.zooming = false;
    p.stamina = Math.max(0, p.stamina - dt / T.staminaSprint);
    p.staminaDelay = T.staminaRegenDelay;
    if (p.stamina <= 0) p.staminaLock = true;
  } else {
    if (!wish.zoom) p.zoomCancelled = false;
    p.zooming = wish.zoom && !p.zoomCancelled;
    if (p.staminaDelay > 0) {
      p.staminaDelay = Math.max(0, p.staminaDelay - dt);
    } else if (p.stamina < 1) {
      p.stamina = Math.min(1, p.stamina + dt / T.staminaRegen);
      if (p.staminaLock && p.stamina >= T.staminaRefill) p.staminaLock = false;
    }
  }

  // Dash initiation
  if (wish.dash && p.dashCd <= 0 && p.dashT <= 0) {
    const dx = wishLen > 0.1 ? wishX / wishLen : fwdX;
    const dz = wishLen > 0.1 ? wishZ / wishLen : fwdZ;
    p.dashX = dx;
    p.dashZ = dz;
    p.dashT = T.dashTime;
    p.dashCd = T.dashCd;
    p.invuln = Math.max(p.invuln, T.dashInvuln);
    p.slideT = 0;
  }

  // Slide initiation
  const horizSpeed = Math.hypot(p.vx, p.vz);
  if (wish.slide && p.onGround && p.slideT <= 0 && p.slideCd <= 0 && horizSpeed >= T.slideMinSpeed && p.stamina >= T.slideStamina) {
    p.slideT = T.slideTime;
    p.stamina = Math.max(0, p.stamina - T.slideStamina);
    p.staminaDelay = T.staminaRegenDelay;
    const dirX = horizSpeed > 0.01 ? p.vx / horizSpeed : fwdX;
    const dirZ = horizSpeed > 0.01 ? p.vz / horizSpeed : fwdZ;
    const boost = Math.max(horizSpeed, T.slideBoost);
    p.vx = dirX * boost;
    p.vz = dirZ * boost;
  }

  // Horizontal velocity update
  if (p.dashT > 0) {
    p.vx = p.dashX * T.dashSpeed;
    p.vz = p.dashZ * T.dashSpeed;
    p.dashT = Math.max(0, p.dashT - dt);
    if (p.dashT === 0) {
      p.vx *= T.dashEndScale;
      p.vz *= T.dashEndScale;
    }
  } else if (p.slideT > 0) {
    p.slideT = Math.max(0, p.slideT - dt);
    const sp = Math.hypot(p.vx, p.vz);
    if (sp > T.slideCruise) {
      const nextSp = Math.max(T.slideCruise, sp - T.slideDrag * dt * sp);
      p.vx = (p.vx / sp) * nextSp;
      p.vz = (p.vz / sp) * nextSp;
    }
    if (p.slideT === 0 || !p.onGround) {
      p.slideT = 0;
      p.slideCd = T.slideCd;
    }
  } else {
    const maxSpeed = wantsSprint ? T.sprintSpeed : T.walkSpeed;
    const targetVx = wishX * maxSpeed;
    const targetVz = wishZ * maxSpeed;
    if (p.onGround) {
      const accel = wishLen > 0.05 ? T.groundAccel : T.friction;
      const alpha = Math.min(1, accel * dt);
      p.vx += (targetVx - p.vx) * alpha;
      p.vz += (targetVz - p.vz) * alpha;
    } else {
      const alpha = Math.min(1, T.airAccel * dt);
      p.vx += (targetVx - p.vx) * alpha;
      p.vz += (targetVz - p.vz) * alpha;
    }
  }

  // Jump / double-jump / coyote / jump buffer
  if (p.onGround) {
    p.coyoteT = T.coyote;
    p.jumpsLeft = 2;
  } else {
    p.coyoteT = Math.max(0, p.coyoteT - dt);
  }
  if (wish.jump) {
    p.jumpBufferT = T.jumpBuffer;
  } else {
    p.jumpBufferT = Math.max(0, p.jumpBufferT - dt);
  }
  if (p.jumpBufferT > 0) {
    if (p.coyoteT > 0) {
      p.vy = T.jumpVel;
      p.onGround = false;
      p.coyoteT = 0;
      p.jumpBufferT = 0;
      p.jumpsLeft = 1;
      p.slideT = 0;
    } else if (p.jumpsLeft > 0) {
      p.vy = T.doubleJumpVel;
      p.jumpBufferT = 0;
      p.jumpsLeft -= 1;
    }
  }

  // Gravity & grapple
  p.vy -= T.gravity * dt;
  tickGrapple(p, wish, dt);

  // Integrate & resolve arena solids + floor + circular wall
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.z += p.vz * dt;

  const height = p.slideT > 0 ? 1.0 : T.playerHeight;
  pushOutOfPillars(p, T.playerRadius, height);

  const floorY = pillarGroundHeight(p.x, p.z, T.playerRadius, p.y);
  if (p.y <= floorY) {
    p.y = floorY;
    if (p.vy < 0) p.vy = 0;
    p.onGround = true;
  } else {
    p.onGround = false;
  }

  clampToArenaBounds(p, p, T.playerRadius);
}

function separatePlayers(players: [PvpPlayerState, PvpPlayerState]): void {
  const a = players[0];
  const b = players[1];
  let dx = b.x - a.x;
  let dz = b.z - a.z;
  let dist = Math.hypot(dx, dz);
  const min = T.playerRadius * 2;
  if (dist >= min) return;
  if (dist < 1e-6) {
    dx = 1;
    dz = 0;
    dist = 1;
  }
  const push = (min - dist) / 2;
  const nx = dx / dist;
  const nz = dz / dist;
  a.x -= nx * push;
  a.z -= nz * push;
  b.x += nx * push;
  b.z += nz * push;
}

function snapPlayer(p: PvpPlayerState): void {
  p.x = q4(p.x);
  p.y = q4(p.y);
  p.z = q4(p.z);
  p.vx = q4(p.vx);
  p.vy = q4(p.vy);
  p.vz = q4(p.vz);
  p.yaw = q4(p.yaw);
  p.pitch = q4(p.pitch);
  p.fireCd = q4(Math.max(0, p.fireCd));
  p.reloadT = q4(Math.max(0, p.reloadT));
  p.swapT = q4(Math.max(0, p.swapT));
  p.dashT = q4(Math.max(0, p.dashT));
  p.dashCd = q4(Math.max(0, p.dashCd));
  p.invuln = q4(Math.max(0, p.invuln));
  p.shieldDelay = q4(Math.max(0, p.shieldDelay));
  p.stamina = q4(Math.max(0, p.stamina));
  p.staminaDelay = q4(Math.max(0, p.staminaDelay));
  p.slideT = q4(Math.max(0, p.slideT));
  p.slideCd = q4(Math.max(0, p.slideCd));
  p.coyoteT = q4(Math.max(0, p.coyoteT));
  p.jumpBufferT = q4(Math.max(0, p.jumpBufferT));
  p.jumpsLeft = Math.max(0, Math.round(p.jumpsLeft));
  p.grappleCd = q4(Math.max(0, p.grappleCd));
  if (p.grapple) {
    p.grapple.x = q4(p.grapple.x);
    p.grapple.y = q4(p.grapple.y);
    p.grapple.z = q4(p.grapple.z);
  }
}

// ---------------------------------------------------------------------------
// Weapons, hitscan, damage & immediate KO (NO Second Wind)
// ---------------------------------------------------------------------------

function reserveOf(p: PvpPlayerState, ammoType: 'bullets' | 'shells' | 'sniper'): number {
  if (ammoType === 'shells') return p.shells;
  if (ammoType === 'sniper') return p.sniper;
  return 0;
}

function takeReserve(p: PvpPlayerState, ammoType: 'bullets' | 'shells' | 'sniper', n: number): void {
  if (ammoType === 'shells') p.shells -= n;
  else if (ammoType === 'sniper') p.sniper -= n;
}

function canReload(p: PvpPlayerState, slot: number): boolean {
  const gun = STOCK_GUNS[slot];
  return gun.infiniteReserve || reserveOf(p, gun.ammoType) > 0;
}

function finishReload(p: PvpPlayerState): void {
  const gun = STOCK_GUNS[p.slot];
  const need = gun.stats.magSize - p.mag[p.slot];
  if (need <= 0) return;
  const got = gun.infiniteReserve ? need : Math.min(need, reserveOf(p, gun.ammoType));
  if (!gun.infiniteReserve) takeReserve(p, gun.ammoType, got);
  p.mag[p.slot] += got;
}

/**
 * Pure weapon timer, reload, and magazine step (does not touch RNG).
 * Returns true if the weapon fires on this tick.
 */
export function weaponTick(p: PvpPlayerState, wish: PvpWish, dt: number): boolean {
  p.fireCd = Math.max(0, p.fireCd - dt);
  p.swapT = Math.max(0, p.swapT - dt);
  if (p.reloadT > 0) {
    p.reloadT = Math.max(0, p.reloadT - dt);
    if (p.reloadT === 0) finishReload(p);
    return false;
  }
  const gun = STOCK_GUNS[p.slot];
  if (wish.reload && p.mag[p.slot] < gun.stats.magSize && canReload(p, p.slot)) {
    p.reloadT = gun.stats.reloadTime;
    return false;
  }
  if (!wish.fire || p.swapT > 0 || p.fireCd > 0) return false;
  if (p.mag[p.slot] <= 0) {
    if (canReload(p, p.slot)) p.reloadT = gun.stats.reloadTime;
    return false;
  }
  p.mag[p.slot] -= 1;
  p.fireCd = 1 / gun.stats.fireRate;
  if (p.mag[p.slot] <= 0 && canReload(p, p.slot)) p.reloadT = gun.stats.reloadTime;
  return true;
}

/** Hitscan pellet trace against a rewound target capsule, checking pillar occlusion and falloff. */
export function traceShots(p: PvpPlayerState, target: Vec3, wish: PvpWish): number[] {
  const hits: number[] = [];
  const gun = STOCK_GUNS[p.slot];
  const pellets = gun.stats.pellets;
  const zoom = p.zoomCancelled ? false : wish.zoom;
  const spreadRad = (zoom ? gun.stats.adsSpread : gun.stats.spread) * DEG2RAD;
  const eye = eyeOf(p);

  for (let i = 0; i < pellets; i++) {
    const jy = (randFloat(p.rng) - 0.5) * spreadRad;
    const jp = (randFloat(p.rng) - 0.5) * spreadRad;
    const dir = dirFromYawPitch(p.yaw + jy, p.pitch + jp);
    const dist = rayCapsule(eye, dir, target.x, target.z, target.y, target.y + T.playerHeight, T.playerRadius);
    if (dist < 0) continue;
    const cover = firstArenaSolid(eye, dir, dist, null);
    if (cover && cover.t < dist) continue;
    const fall = rangeFalloff(gun.range, dist);
    if (fall <= 0) continue;
    let dmg = gun.stats.damage * fall;
    if (randFloat(p.rng) < gun.stats.critChance) {
      dmg *= T.critHitMult;
    }
    hits.push(Math.max(0, Math.round(dmg * 1000)));
  }
  return hits;
}

/**
 * Apply hit damage (in milli-HP) to shield then HP.
 * Sim v3: NO Second Wind — reaching 0 HP immediately eliminates the player (alive = false).
 */
function applyHits(target: PvpPlayerState, hits: number[], invuln: number): number {
  if (!target.alive || invuln > 0 || hits.length === 0) return 0;
  let total = 0;
  for (let i = 0; i < hits.length; i++) {
    total += hits[i];
    let left = hits[i];
    const absorb = Math.min(target.shield, left);
    target.shield -= absorb;
    left -= absorb;
    target.hp -= left;
    target.shieldDelay = T.shieldDelay;
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.vx = 0;
      target.vy = 0;
      target.vz = 0;
      target.grapple = null;
      break;
    }
  }
  return total;
}

function regenShield(p: PvpPlayerState, dt: number): void {
  if (!p.alive) return;
  p.shieldDelay = Math.max(0, p.shieldDelay - dt);
  if (p.shieldDelay <= 0 && p.shield < MAX_SHIELD) {
    p.shield = Math.min(MAX_SHIELD, p.shield + Math.round(T.shieldRegen * dt * 1000));
  }
}

function finishMatch(
  state: PvpMatchState,
  outcome: PvpOutcome,
  winner: 0 | 1 | null,
  reason: PvpReason,
): PvpMatchState {
  state.phase = 'done';
  state.outcome = outcome;
  state.winner = winner;
  state.reason = reason;
  return state;
}

function resolveMatch(state: PvpMatchState): PvpMatchState {
  const a = state.players[0];
  const b = state.players[1];
  if (a.hp <= 0) {
    a.hp = 0;
    a.alive = false;
    a.vx = 0;
    a.vy = 0;
    a.vz = 0;
  }
  if (b.hp <= 0) {
    b.hp = 0;
    b.alive = false;
    b.vx = 0;
    b.vy = 0;
    b.vz = 0;
  }
  if (!a.alive && !b.alive) return finishMatch(state, 'draw', null, 'double_ko');
  if (!a.alive) return finishMatch(state, 'ko', 1, 'ko');
  if (!b.alive) return finishMatch(state, 'ko', 0, 'ko');
  if (state.tick >= MATCH_TICKS) {
    const sa = a.hp + a.shield;
    const sb = b.hp + b.shield;
    if (sa === sb) return finishMatch(state, 'draw', null, 'time');
    return finishMatch(state, 'time', sa > sb ? 0 : 1, 'time');
  }
  return state;
}

// ---------------------------------------------------------------------------
// Main step, hashing, snapshots, and replay
// ---------------------------------------------------------------------------

/** Advance the PvP match by exactly one 30 Hz tick. */
export function stepMatch(
  state: PvpMatchState,
  wishes: readonly [PartialPvpWish | null | undefined, PartialPvpWish | null | undefined] | null | undefined,
  events: PvpShotEvent[] | null = null,
): PvpMatchState {
  if (state.phase === 'done') return state;
  const frame = state.tick;
  const wish: [PvpWish, PvpWish] = [
    normalizeWish(state.players[0], wishes?.[0], frame),
    normalizeWish(state.players[1], wishes?.[1], frame),
  ];

  for (let i = 0; i < 2; i++) {
    if (state.players[i].alive) movePlayer(state.players[i], wish[i], DT);
  }
  separatePlayers(state.players);
  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    pushOutOfPillars(p, T.playerRadius, p.slideT > 0 ? 1.0 : T.playerHeight);
    clampToArenaBounds(p, p, T.playerRadius);
    snapPlayer(p);
  }

  // Record this tick's post-movement positions so rewind=0 interpolates toward current tick.
  recordHistory(state, frame + 1);

  const seen: [RewoundTarget, RewoundTarget] = [
    rewoundTarget(state, 1, frame, wish[0].rewind, wish[0].viewFrac),
    rewoundTarget(state, 0, frame, wish[1].rewind, wish[1].viewFrac),
  ];

  const fired: [boolean, boolean] = [false, false];
  const hits: [number[], number[]] = [[], []];
  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    if (!p.alive || !weaponTick(p, wish[i], DT)) continue;
    fired[i] = true;
    hits[i] = traceShots(p, seen[i], wish[i]);
  }

  const dealt: [number, number] = [
    applyHits(state.players[1], hits[0], seen[0].invuln),
    applyHits(state.players[0], hits[1], seen[1].invuln),
  ];

  if (events) {
    for (let i = 0; i < 2; i++) {
      if (!fired[i]) continue;
      events.push({
        tick: frame,
        shooter: i as 0 | 1,
        dmg: dealt[i],
        pellets: STOCK_GUNS[state.players[i].slot].stats.pellets,
        hits: hits[i].length,
        rewind: wish[i].rewind,
        viewFrac: wish[i].viewFrac,
      });
    }
  }

  for (let i = 0; i < 2; i++) {
    const p = state.players[i];
    snapPlayer(p);
    regenShield(p, DT);
    snapPlayer(p);
  }

  state.tick += 1;
  resolveMatch(state);
  recordHistory(state, state.tick);
  return state;
}

/** Deterministic FNV-1a state hash over quantized canonical state (includes combat RNG). */
export function stateHash(state: PvpMatchState): string {
  return fnv1a(stableStringify(quantizeForHash(state)));
}

/** Public state hash omitting each player's secret combat RNG state. */
export function publicStateHash(state: PvpMatchState): string {
  const scrubbed = {
    ...state,
    players: state.players.map((p) => {
      const { rng: _rng, ...rest } = p;
      return rest;
    }),
  };
  return fnv1a(stableStringify(quantizeForHash(scrubbed)));
}

/** Canonical SHA-256 settlement hash of the quantized state. */
export function stateSha256(state: PvpMatchState): string {
  return sha256Hex(stableStringify(quantizeForHash(state)));
}

/** Network-ready snapshot of the match state (never exposes secret RNG). */
export function snapshot(state: PvpMatchState): PvpSnapshot {
  const players: [PvpSnapshotPlayer, PvpSnapshotPlayer] = [
    snapshotPlayer(state.players[0]),
    snapshotPlayer(state.players[1]),
  ];
  return {
    tick: state.tick,
    hash: stateHash(state),
    publicHash: publicStateHash(state),
    phase: state.phase,
    outcome: state.outcome,
    winner: state.winner,
    reason: state.reason,
    players,
  };
}

function snapshotPlayer(p: PvpPlayerState): PvpSnapshotPlayer {
  return {
    seat: p.seat,
    x: p.x,
    y: p.y,
    z: p.z,
    vx: p.vx,
    vy: p.vy,
    vz: p.vz,
    yaw: p.yaw,
    pitch: p.pitch,
    hp: p.hp,
    shield: p.shield,
    alive: p.alive,
    slot: p.slot,
    mag: [p.mag[0], p.mag[1], p.mag[2]],
    shells: p.shells,
    sniper: p.sniper,
    reloadT: p.reloadT,
    fireCd: p.fireCd,
    swapT: p.swapT,
    grappleCd: p.grappleCd,
    grappleMiss: p.grappleMiss,
    grapple: p.grapple ? { x: p.grapple.x, y: p.grapple.y, z: p.grapple.z, id: p.grapple.id } : null,
  };
}

/** Symmetric scripted duel generator for cross-runtime determinism checks. */
export function scriptedMatch(
  seed = 7,
  ticks = 180,
): { seed: number; inputs: Array<[PartialPvpWish, PartialPvpWish]> } {
  const probe = createMatch(seed);
  const yaws: [number, number] = [probe.players[0].yaw, probe.players[1].yaw];
  const inputs: Array<[PartialPvpWish, PartialPvpWish]> = [];
  for (let i = 0; i < ticks; i++) {
    inputs.push([
      { yaw: yaws[0], pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, slot: 0 },
      { yaw: yaws[1], pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, slot: 0 },
    ]);
  }
  return { seed, inputs };
}

/** Replay a match from seed(s) and an input array. */
export function replayMatch(body: {
  seed?: number;
  spawnSeed?: number;
  combatSeed?: number | string;
  inputs?: ReadonlyArray<[PartialPvpWish | null | undefined, PartialPvpWish | null | undefined]>;
}): PvpMatchState {
  const spawn = body.spawnSeed ?? body.seed ?? 1;
  const combat = body.combatSeed ?? spawn;
  const state = createMatch(spawn >>> 0, typeof combat === 'string' ? combat : combat >>> 0);
  const inputs = Array.isArray(body.inputs) ? body.inputs : [];
  for (let i = 0; i < inputs.length; i++) {
    stepMatch(state, inputs[i]);
    if (state.phase === 'done') break;
  }
  return state;
}
