// Free & Wager 1v1 PvP rules, stock loadout, deterministic hashing, and content fingerprint.
// 100% pure TypeScript — zero Three.js, Rapier, DOM, Math.random, or timers.

import { ARENA_R, ARENA_SOLIDS, ARENA_WALL_H } from './arena';

export const GAME_ID = 'sproto-open-world';
export const MATCH_NAME = 'sproto_open_world_pvp';
export const STAGE_ID = 'arena';

export const TICK_HZ = 30;
export const DT = 1 / TICK_HZ;
export const STEP_MS = 1000 / TICK_HZ;
export const MATCH_SECONDS = 90;
export const MATCH_TICKS = MATCH_SECONDS * TICK_HZ; // 2700
export const LEAD_IN_TICKS = 9;

export const PVP_PROTOCOL_VERSION = 2;
/** Sim 3: Second Wind eliminated — 0 HP scores an immediate KO. */
export const PVP_SIM_VERSION = 3;

export const SEATS = 2;
export const SPAWN_RADIUS = 16;
export const READY_MS = 30_000;
export const STALL_MS = 10_000;
export const MAX_MATCH_MS = 10 * 60 * 1000;
export const HASH_EVERY_TICKS = TICK_HZ;

export const REWIND = Object.freeze({
  historyTicks: 12,
  maxTicks: 10,
  maxBack: 255,
  fracSteps: 256,
  interpMs: 100,
  interpMinMs: 50,
  interpMaxMs: 150,
  extraTicks: 2,
  rttWindow: 8,
  maxRttMs: 1000,
  pongMemory: 4,
  maxBackStep: 2,
});

export const STOCK_LOADOUT = Object.freeze(['mg', 'shotgun', 'sniper'] as const);
export type StockGunId = (typeof STOCK_LOADOUT)[number];

export const WAGER = Object.freeze({
  stake: 10,
  pot: 20,
  fee: 0,
  stallMs: 10_000,
});

export const INPUT_LIMITS = Object.freeze({
  maxFramesPerSecond: 45,
  maxFramesPerCursor: 9,
  futureFrames: 8,
  holdTicks: 3,
  catchUpTicks: 4,
  maxPingsPerSecond: 10,
  maxHelloPerSecond: 2,
  maxReadyPerSecond: 2,
  frameBytes: 18,
  maxFrame: 1_000_000,
  maxIdLength: 80,
  maxNameLength: 32,
  maxLeadInTicks: 90,
});

export const REPLAY_LIMITS = Object.freeze({
  maxTicks: MATCH_TICKS,
  maxBytes: 512 * 1024,
});

export const PVP_TUNING = Object.freeze({
  arenaRadius: ARENA_R,
  arenaWallH: ARENA_WALL_H,
  spawnRadius: SPAWN_RADIUS,
  eyeHeight: 1.6,
  slideEye: 0.72,
  playerRadius: 0.4,
  playerHeight: 1.8,
  walkSpeed: 6.5,
  sprintSpeed: 9.5,
  groundAccel: 60,
  friction: 10,
  airAccel: 18,
  gravity: 22,
  jumpVel: 8.0,
  doubleJumpVel: 7.0,
  coyote: 0.1,
  jumpBuffer: 0.1,
  slideMinSpeed: 4.2,
  slideBoost: 16,
  slideCruise: 8,
  slideDrag: 2.4,
  slideTime: 0.7,
  slideCd: 0.22,
  slideStamina: 0.14,
  staminaSprint: 4.5,
  staminaRegenDelay: 0.55,
  staminaRegen: 1.7,
  staminaRefill: 0.28,
  dashSpeed: 24,
  dashTime: 0.15,
  dashCd: 2.0,
  dashInvuln: 0.12,
  dashEndScale: 0.45,
  grappleRange: 16,
  grappleCd: 6,
  grapplePull: 54,
  grappleSpeed: 12.5,
  grappleReleaseSpeed: 8.5,
  grappleArrive: 1.35,
  grappleOrigin: 0.9,
  maxHp: 100,
  maxShield: 50,
  shieldDelay: 3.0,
  shieldRegen: 25,
  pitchLimit: 1.5,
  critHitMult: 1.5,
});

export interface StockGunRange {
  readonly full: number;
  readonly max: number;
  readonly min: number;
}

export interface StockGunStats {
  readonly damage: number;
  readonly fireRate: number;
  readonly spread: number;
  readonly adsSpread: number;
  readonly magSize: number;
  readonly reloadTime: number;
  readonly critChance: number;
  readonly pellets: number;
  readonly swapTime: number;
}

export interface StockGunSpec {
  readonly id: StockGunId;
  readonly name: string;
  readonly ammoType: 'bullets' | 'shells' | 'sniper';
  readonly infiniteReserve: boolean;
  readonly range: StockGunRange;
  readonly stats: StockGunStats;
}

/** Fixed stock loadout (Ol' Reliable common stats) shared equally by both seats. */
export const STOCK_GUNS: readonly StockGunSpec[] = Object.freeze([
  Object.freeze({
    id: 'mg' as const,
    name: 'Machine Gun',
    ammoType: 'bullets' as const,
    infiniteReserve: true,
    range: Object.freeze({ full: 30, max: 75, min: 0.5 }),
    stats: Object.freeze({
      damage: 9,
      fireRate: 10,
      spread: 0.84,
      adsSpread: 0.315,
      magSize: 36,
      reloadTime: 2.75,
      critChance: 0.05,
      pellets: 1,
      swapTime: 0.5,
    }),
  }),
  Object.freeze({
    id: 'shotgun' as const,
    name: 'Shotgun',
    ammoType: 'shells' as const,
    infiniteReserve: false,
    range: Object.freeze({ full: 7, max: 16, min: 0.3 }),
    stats: Object.freeze({
      damage: 8,
      fireRate: 1.2,
      spread: 4.2,
      adsSpread: 3.15,
      magSize: 6,
      reloadTime: 2.64,
      critChance: 0.03,
      pellets: 9,
      swapTime: 0.5,
    }),
  }),
  Object.freeze({
    id: 'sniper' as const,
    name: 'Sniper',
    ammoType: 'sniper' as const,
    infiniteReserve: false,
    range: Object.freeze({ full: 120, max: 150, min: 1 }),
    stats: Object.freeze({
      damage: 85,
      fireRate: 0.8,
      spread: 2.1,
      adsSpread: 0,
      magSize: 4,
      reloadTime: 2.86,
      critChance: 0.08,
      pellets: 1,
      swapTime: 0.6,
    }),
  }),
]);

export const RESERVE = Object.freeze({
  shells: 24,
  sniper: 12,
});

/** Hitscan range falloff multiplier in [min, 1], or 0 beyond max range. */
export function rangeFalloff(range: StockGunRange, dist: number): number {
  if (dist > range.max) return 0;
  if (dist <= range.full) return 1;
  const span = range.max - range.full;
  if (span <= 0) return range.min;
  const t = (dist - range.full) / span;
  return 1 - t * (1 - range.min);
}

// ---------------------------------------------------------------------------
// Pure deterministic canonical JSON, FNV-1a, and FIPS 180-4 SHA-256
// ---------------------------------------------------------------------------

export function stableStringify(value: unknown): string {
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'number') return Number.isFinite(value as number) ? JSON.stringify(value) : 'null';
  if (t === 'string' || t === 'boolean') return JSON.stringify(value);
  if (t !== 'object') return 'null';
  if (Array.isArray(value)) {
    let s = '[';
    for (let i = 0; i < value.length; i++) {
      if (i > 0) s += ',';
      s += stableStringify(value[i]);
    }
    return s + ']';
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  let s = '{';
  let n = 0;
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    const v = obj[k];
    if (v === undefined) continue;
    if (n++ > 0) s += ',';
    s += JSON.stringify(k) + ':' + stableStringify(v);
  }
  return s + '}';
}

export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function quantizeForHash(value: unknown): unknown {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return 0;
    return Math.round(value * 1_000_000);
  }
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const arr = new Array<unknown>(value.length);
    for (let i = 0; i < value.length; i++) arr[i] = quantizeForHash(value[i]);
    return arr;
  }
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    if (k === 'events') continue;
    out[k] = quantizeForHash(obj[k]);
  }
  return out;
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function utf8Bytes(text: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < text.length; i++) {
    let c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i += 1;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** Pure JS SHA-256 (FIPS 180-4) over UTF-8 string, returning 64 lowercase hex chars. */
export function sha256Hex(text: string): string {
  const bytes = utf8Bytes(String(text));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const high = Math.floor(bitLength / 0x100000000);
  bytes.push((high >>> 24) & 255, (high >>> 16) & 255, (high >>> 8) & 255, high & 255);
  bytes.push((bitLength >>> 24) & 255, (bitLength >>> 16) & 255, (bitLength >>> 8) & 255, bitLength & 255);

  const h = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const w = new Array<number>(64);

  for (let at = 0; at < bytes.length; at += 64) {
    for (let i = 0; i < 16; i++) {
      const j = at + i * 4;
      w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) | 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let [a, b, c, d, e, f, g, k] = h;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (k + S1 + ch + SHA256_K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      k = g; g = f; f = e;
      e = (d + t1) | 0;
      d = c; c = b; b = a;
      a = (t1 + t2) | 0;
    }
    h[0] = (h[0] + a) | 0;
    h[1] = (h[1] + b) | 0;
    h[2] = (h[2] + c) | 0;
    h[3] = (h[3] + d) | 0;
    h[4] = (h[4] + e) | 0;
    h[5] = (h[5] + f) | 0;
    h[6] = (h[6] + g) | 0;
    h[7] = (h[7] + k) | 0;
  }

  let out = '';
  for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, '0');
  return out;
}

export const LOADOUT_HASH = fnv1a(stableStringify(STOCK_GUNS));

export function contentBody() {
  return {
    game: GAME_ID,
    protocol: PVP_PROTOCOL_VERSION,
    sim: PVP_SIM_VERSION,
    stage: STAGE_ID,
    tickHz: TICK_HZ,
    matchTicks: MATCH_TICKS,
    leadInTicks: LEAD_IN_TICKS,
    secondWind: false,
    tuning: PVP_TUNING,
    stockLoadout: STOCK_LOADOUT,
    guns: STOCK_GUNS,
    reserve: RESERVE,
    rewind: REWIND,
    wager: WAGER,
    arenaSolids: ARENA_SOLIDS,
    arenaWallH: ARENA_WALL_H,
  };
}

export function contentFingerprint(): string {
  return fnv1a(stableStringify(contentBody()));
}

export const CONTENT_FINGERPRINT = contentFingerprint();

export type PvpMode = 'free' | 'wager';

export function matchmakerQuery(mode: PvpMode = 'free', fingerprint = CONTENT_FINGERPRINT): string {
  return `+properties.game:${GAME_ID} +properties.mode:${mode} +properties.protocol:${PVP_PROTOCOL_VERSION} +properties.sim:${PVP_SIM_VERSION} +properties.content:${fingerprint}`;
}
