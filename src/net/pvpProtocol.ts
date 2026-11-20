// Pure wire protocol for Free & Wager 1v1 PvP.
// Zero Three.js, zero DOM — safe in browser, Node, and Nakama Goja ES2020.

import {
  CONTENT_FINGERPRINT,
  GAME_ID,
  INPUT_LIMITS,
  MATCH_NAME,
  matchmakerQuery,
  PVP_PROTOCOL_VERSION,
  PVP_SIM_VERSION,
  REWIND,
  type PvpMode,
} from '../sim/pvp/rules';

export const OP = Object.freeze({
  HELLO: 1,
  WELCOME: 2,
  REJECT: 3,
  READY: 4,
  PHASE: 5,
  INPUT: 6,
  SNAPSHOT: 7,
  RESULT: 8,
  RESYNC: 9,
  PING: 10,
  PONG: 11,
} as const);

export type PvpOpCode = (typeof OP)[keyof typeof OP];

export const PROTOCOL = PVP_PROTOCOL_VERSION;
export const SIM_VERSION = PVP_SIM_VERSION;
export const CONTENT = CONTENT_FINGERPRINT;
export const PVP_GAME_ID = GAME_ID;
export const PVP_MATCH_NAME = MATCH_NAME;
export const FRAME_BYTES = INPUT_LIMITS.frameBytes;

const ID_RE = /^[A-Za-z0-9_.:@|-]{1,80}$/;

/** Client-supplied keys that are always hostile (server-authoritative economy/outcome/cheat fields). */
export const HOSTILE_FIELDS: ReadonlySet<string> = new Set([
  'winner',
  'result',
  'settle',
  'earn',
  'earnTickets',
  'stake',
  'wager',
  'tickets',
  'god',
  'godMode',
  'debug',
  'refund',
]);

export function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length <= INPUT_LIMITS.maxIdLength && ID_RE.test(value);
}

/**
 * Recursively inspect a client payload for hostile fields.
 * Returns null if clean, or a rejection reason ('malformed' | 'client_result').
 */
export function hostileReason(body: unknown, depth = 0): string | null {
  if (depth > 8) return 'malformed';
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return depth === 0 ? 'malformed' : null;
  }
  const obj = body as Record<string, unknown>;
  const keys = Object.keys(obj);
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    if (HOSTILE_FIELDS.has(key)) return 'client_result';
    const val = obj[key];
    if (val && typeof val === 'object') {
      if (Array.isArray(val)) {
        for (let j = 0; j < val.length; j++) {
          const item = val[j];
          if (item && typeof item === 'object') {
            const nested = hostileReason(item, depth + 1);
            if (nested) return nested;
          }
        }
      } else {
        const nested = hostileReason(val, depth + 1);
        if (nested) return nested;
      }
    }
  }
  return null;
}

export type SanitizeResult =
  | { ok: true; body: Record<string, unknown> }
  | { ok: false; reason: string };

/** Validate and reject any client message containing hostile fields or non-object shape. */
export function sanitizeClientMessage(body: unknown): SanitizeResult {
  const reason = hostileReason(body);
  if (reason !== null) return { ok: false, reason };
  return { ok: true, body: body as Record<string, unknown> };
}

export function versionsMatch(body: Record<string, unknown> | null | undefined): boolean {
  return !!body
    && body.protocol === PVP_PROTOCOL_VERSION
    && body.sim === PVP_SIM_VERSION
    && body.content === CONTENT_FINGERPRINT;
}

export function bytesToAscii(data: string | Uint8Array | ArrayLike<number> | null | undefined): string {
  if (typeof data === 'string') return data;
  if (!data || typeof data.length !== 'number') return '';
  let out = '';
  for (let i = 0; i < data.length; i++) out += String.fromCharCode(data[i]);
  return out;
}

export function parseJsonBody(data: string | Uint8Array | ArrayLike<number> | null | undefined): SanitizeResult {
  try {
    const raw = JSON.parse(bytesToAscii(data) || '{}') as unknown;
    return sanitizeClientMessage(raw);
  } catch {
    return { ok: false, reason: 'malformed' };
  }
}

// ---------------------------------------------------------------------------
// 18-byte binary input codec
// ---------------------------------------------------------------------------

const BUTTONS = Object.freeze([
  'fire',
  'zoom',
  'sprint',
  'jump',
  'dash',
  'reload',
  'slide',
  'grapple',
] as const);

export class PvpInputError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(reason);
    this.name = 'PvpInputError';
    this.reason = reason;
  }
}

export interface EncodableInput {
  seq: number;
  frame: number;
  yaw?: number;
  pitch?: number;
  moveX?: number;
  moveZ?: number;
  slot?: number;
  fire?: boolean;
  zoom?: boolean;
  sprint?: boolean;
  jump?: boolean;
  dash?: boolean;
  reload?: boolean;
  slide?: boolean;
  grapple?: boolean;
  viewTick?: number;
  viewFrac?: number;
}

export interface DecodedInput {
  seq: number;
  frame: number;
  viewTick: number;
  viewFrac: number;
  yaw: number;
  pitch: number;
  moveX: number;
  moveZ: number;
  slot: number;
  fire: boolean;
  zoom: boolean;
  sprint: boolean;
  jump: boolean;
  dash: boolean;
  reload: boolean;
  slide: boolean;
  grapple: boolean;
}

function fail(reason: string): never {
  throw new PvpInputError(reason);
}

function quantYaw(yaw: number): number {
  if (typeof yaw !== 'number' || !Number.isFinite(yaw)) fail('nan');
  if (Math.abs(yaw) > 1e6) fail('malformed');
  const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
  return Math.max(-32767, Math.min(32767, Math.round((wrapped / Math.PI) * 32767)));
}

function quantPitch(pitch: number): number {
  if (typeof pitch !== 'number' || !Number.isFinite(pitch)) fail('nan');
  if (pitch < -Math.PI / 2 - 1e-4 || pitch > Math.PI / 2 + 1e-4) fail('malformed');
  const clamped = Math.max(-1.5, Math.min(1.5, pitch));
  return Math.round((clamped / 1.5) * 32767);
}

function quantMove(v: number): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail('nan');
  if (v < -1 - 1e-6 || v > 1 + 1e-6) fail('malformed');
  const c = Math.max(-1, Math.min(1, v));
  return Math.max(-127, Math.min(127, Math.round(c * 127)));
}

export function encodeInput(wish: EncodableInput): Uint8Array {
  if (!wish || typeof wish !== 'object') fail('malformed');
  if (typeof wish.seq !== 'number' || !Number.isFinite(wish.seq)) fail('nan');
  if (!Number.isInteger(wish.seq) || wish.seq < 1 || wish.seq > 0xffffffff) fail('sequence');
  if (typeof wish.frame !== 'number' || !Number.isFinite(wish.frame)) fail('nan');
  if (!Number.isInteger(wish.frame) || wish.frame < 0 || wish.frame > INPUT_LIMITS.maxFrame) fail('frame');

  const slot = wish.slot ?? -1;
  if (typeof slot !== 'number' || !Number.isFinite(slot)) fail('nan');
  if (!Number.isInteger(slot) || slot < -1 || slot > 2) fail('malformed');

  let back = 0;
  if (wish.viewTick !== undefined) {
    if (typeof wish.viewTick !== 'number' || !Number.isFinite(wish.viewTick)) fail('nan');
    back = wish.frame - Math.floor(wish.viewTick);
  }
  back = Math.max(0, Math.min(REWIND.maxBack, wish.frame, back));

  let frac = 0;
  if (wish.viewFrac !== undefined) {
    if (typeof wish.viewFrac !== 'number' || !Number.isFinite(wish.viewFrac)) fail('nan');
    frac = Math.max(0, Math.min(REWIND.fracSteps - 1, Math.floor(wish.viewFrac)));
  }

  let buttons = 0;
  for (let i = 0; i < BUTTONS.length; i++) {
    if (wish[BUTTONS[i]]) buttons |= 1 << i;
  }

  const buf = new Uint8Array(FRAME_BYTES);
  const view = new DataView(buf.buffer);
  view.setUint32(0, wish.seq, true);
  view.setInt32(4, wish.frame, true);
  view.setInt16(8, quantYaw(wish.yaw ?? 0), true);
  view.setInt16(10, quantPitch(wish.pitch ?? 0), true);
  view.setInt8(12, quantMove(wish.moveX ?? 0));
  view.setInt8(13, quantMove(wish.moveZ ?? 0));
  view.setUint8(14, buttons);
  view.setInt8(15, slot);
  view.setUint8(16, back);
  view.setUint8(17, frac);
  return buf;
}

export function decodeInput(buf: Uint8Array): DecodedInput {
  if (!(buf instanceof Uint8Array) || buf.length !== FRAME_BYTES) fail('malformed');
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const seq = view.getUint32(0, true);
  const frame = view.getInt32(4, true);
  if (seq < 1) fail('sequence');
  if (frame < 0 || frame > INPUT_LIMITS.maxFrame) fail('frame');

  const yawQ = view.getInt16(8, true);
  const pitchQ = view.getInt16(10, true);
  if (yawQ < -32767 || yawQ > 32767 || pitchQ < -32767 || pitchQ > 32767) fail('malformed');

  const moveX = view.getInt8(12);
  const moveZ = view.getInt8(13);
  const buttons = view.getUint8(14);
  const slot = view.getInt8(15);
  if (slot < -1 || slot > 2) fail('malformed');

  const back = view.getUint8(16);
  const viewFrac = view.getUint8(17);

  return {
    seq,
    frame,
    viewTick: Math.max(0, frame - back),
    viewFrac,
    yaw: (yawQ / 32767) * Math.PI,
    pitch: (pitchQ / 32767) * 1.5,
    moveX: moveX / 127,
    moveZ: moveZ / 127,
    slot,
    fire: (buttons & (1 << 0)) !== 0,
    zoom: (buttons & (1 << 1)) !== 0,
    sprint: (buttons & (1 << 2)) !== 0,
    jump: (buttons & (1 << 3)) !== 0,
    dash: (buttons & (1 << 4)) !== 0,
    reload: (buttons & (1 << 5)) !== 0,
    slide: (buttons & (1 << 6)) !== 0,
    grapple: (buttons & (1 << 7)) !== 0,
  };
}

// ---------------------------------------------------------------------------
// Matchmaker query & ticket builder
// ---------------------------------------------------------------------------

export interface MatchmakerTicketProps {
  query: string;
  minCount: number;
  maxCount: number;
  stringProperties: {
    game: string;
    mode: PvpMode;
    protocol: string;
    sim: string;
    content: string;
  };
}

export function buildMatchmakerQuery(mode: PvpMode = 'free', fingerprint = CONTENT_FINGERPRINT): string {
  return matchmakerQuery(mode, fingerprint);
}

export function matchmakerProps(
  mode: PvpMode = 'free',
  fingerprint = CONTENT_FINGERPRINT,
): MatchmakerTicketProps {
  return {
    query: buildMatchmakerQuery(mode, fingerprint),
    minCount: 2,
    maxCount: 2,
    stringProperties: {
      game: GAME_ID,
      mode,
      protocol: String(PVP_PROTOCOL_VERSION),
      sim: String(PVP_SIM_VERSION),
      content: fingerprint,
    },
  };
}
