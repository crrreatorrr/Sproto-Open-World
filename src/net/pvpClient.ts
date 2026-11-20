// Pure TypeScript PvP client with fixed 30 Hz input clock, client prediction,
// server reconciliation buffer, and remote snapshot interpolation.
// Zero Three.js, zero DOM, zero global clocks (injectable `clock` function).

import {
  CONTENT_FINGERPRINT,
  DT,
  INPUT_LIMITS,
  PVP_PROTOCOL_VERSION,
  PVP_SIM_VERSION,
  REWIND,
  sha256Hex,
  STALL_MS,
  STEP_MS,
  STOCK_GUNS,
} from '../sim/pvp/rules';
import {
  createMatch,
  movePlayer,
  normalizeWish,
  weaponTick,
  type PartialPvpWish,
  type PvpOutcome,
  type PvpPlayerState,
  type PvpReason,
  type PvpSnapshotPlayer,
  type PvpWish,
} from '../sim/pvp/sim';
import {
  encodeInput,
  OP,
  type PvpOpCode,
} from './pvpProtocol';

export const NET_TUNING = Object.freeze({
  leadStart: 2,
  leadMin: 1,
  leadMax: 12,
  maxTicksPerUpdate: 4,
  pingMs: 500,
  rttWindow: 5,
  rttMaxSampleMs: 2000,
  interpDelayMs: 100,
  extrapolateMs: 100,
  snapshotBuffer: 24,
  pendingMax: 64,
  snapErrorDistM: 2.0,
  blendDurationMs: 100,
});

export type ClientPhase = 'joining' | 'lobby' | 'live' | 'done';

export interface PvpTransportPacket {
  opCode: number;
  json: () => unknown;
  data?: Uint8Array;
}

export interface PvpTransport {
  send: (op: PvpOpCode, data: unknown) => void;
  onMessage?: (fn: (msg: PvpTransportPacket) => void) => () => void;
  onClose?: (fn: () => void) => () => void;
  onRejoin?: (fn: () => void) => () => void;
}

export interface ServerSnapshotMessage {
  tick: number;
  clockTick?: number;
  phase: 'live' | 'done';
  outcome?: PvpOutcome;
  winner?: 0 | 1 | null;
  reason?: PvpReason;
  graceMs?: number;
  players: [PvpSnapshotPlayer, PvpSnapshotPlayer];
  you?: {
    seat: 0 | 1;
    ackFrame: number;
    ackSeq: number;
    buffer?: number;
    late?: number;
    rttMs?: number;
    rewindCap?: number;
  };
}

export interface ClientResult {
  outcome: string;
  winner: 0 | 1 | null;
  reason: string | null;
  tick: number;
  stateHash: string | null;
  combatSeed?: string;
  combatVerified: boolean | null;
}

export interface SampledSnapshot {
  tick: number;
  mode: 'interp' | 'extrap' | 'hold';
  phase: 'live' | 'done';
  outcome: PvpOutcome;
  winner: 0 | 1 | null;
  reason: PvpReason;
  players: [PvpSnapshotPlayer, PvpSnapshotPlayer];
}

export interface PendingInput {
  frame: number;
  seq: number;
  wish: PvpWish;
}

export interface ReconciliationEvent {
  tick: number;
  ackFrame: number;
  errorM: number;
  snapped: boolean;
  replayed: number;
}

export interface PvpClientOptions {
  accountId: string;
  transport: PvpTransport;
  clock: () => number;
  interpDelayMs?: number;
  predict?: boolean;
  onChange?: () => void;
  onReconcile?: (ev: ReconciliationEvent) => void;
}

export interface PvpClient {
  readonly phase: () => ClientPhase;
  readonly seat: () => number;
  readonly rttMs: () => number | null;
  readonly result: () => ClientResult | null;
  readonly rejectReason: () => string | null;
  readonly pendingCount: () => number;
  readonly predictedLocal: () => PvpPlayerState | null;
  readonly renderOffset: () => { x: number; y: number; z: number };
  ready: () => void;
  resync: () => void;
  update: (now: number, buildWish: (frame: number) => PartialPvpWish) => number;
  sample: (now: number) => SampledSnapshot | null;
  handlePacket: (msg: PvpTransportPacket) => void;
}

const PHASE_RANK: Record<ClientPhase, number> = {
  joining: 0,
  lobby: 1,
  live: 2,
  done: 3,
};

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Convert fractional render tick to integer viewTick + 1/256 viewFrac. */
export function viewStamp(renderTick: number): { viewTick: number; viewFrac: number } {
  if (!Number.isFinite(renderTick) || renderTick <= 0) return { viewTick: 0, viewFrac: 0 };
  const viewTick = Math.floor(renderTick);
  const viewFrac = Math.min(REWIND.fracSteps - 1, Math.floor((renderTick - viewTick) * REWIND.fracSteps));
  return { viewTick, viewFrac };
}

/** Sample remote snapshot ring buffer with linear interpolation and bounded extrapolation. */
export function sampleAt(
  snaps: readonly ServerSnapshotMessage[],
  renderTick: number,
  maxExtrapTicks = NET_TUNING.extrapolateMs / STEP_MS,
): SampledSnapshot | null {
  if (snaps.length === 0) return null;
  const latest = snaps[snaps.length - 1];
  const first = snaps[0];

  if (!Number.isFinite(renderTick) || renderTick <= first.tick) {
    return {
      tick: first.tick,
      mode: 'hold',
      phase: latest.phase,
      outcome: latest.outcome ?? null,
      winner: latest.winner ?? null,
      reason: latest.reason ?? null,
      players: [{ ...first.players[0] }, { ...first.players[1] }],
    };
  }

  if (renderTick <= latest.tick) {
    for (let i = 0; i < snaps.length - 1; i++) {
      const left = snaps[i];
      const right = snaps[i + 1];
      if (left.tick <= renderTick && right.tick >= renderTick) {
        const span = right.tick - left.tick;
        const t = span <= 0 ? 1 : (renderTick - left.tick) / span;
        const blendPlayer = (p: PvpSnapshotPlayer, q: PvpSnapshotPlayer): PvpSnapshotPlayer => ({
          ...q,
          x: p.x + (q.x - p.x) * t,
          y: p.y + (q.y - p.y) * t,
          z: p.z + (q.z - p.z) * t,
          yaw: lerpAngle(p.yaw, q.yaw, t),
          pitch: p.pitch + (q.pitch - p.pitch) * t,
        });
        return {
          tick: Math.round(renderTick * 1000) / 1000,
          mode: 'interp',
          phase: latest.phase,
          outcome: latest.outcome ?? null,
          winner: latest.winner ?? null,
          reason: latest.reason ?? null,
          players: [
            blendPlayer(left.players[0], right.players[0]),
            blendPlayer(left.players[1], right.players[1]),
          ],
        };
      }
    }
  }

  const ahead = renderTick - latest.tick;
  const done = latest.phase === 'done';
  const mode: 'extrap' | 'hold' = done || ahead > maxExtrapTicks ? 'hold' : 'extrap';
  const ticks = mode === 'hold' ? (done ? 0 : maxExtrapTicks) : ahead;
  const dt = (ticks * STEP_MS) / 1000;
  const extrapPlayer = (p: PvpSnapshotPlayer): PvpSnapshotPlayer =>
    p.alive
      ? { ...p, x: p.x + p.vx * dt, z: p.z + p.vz * dt }
      : { ...p };

  return {
    tick: Math.round((latest.tick + ticks) * 1000) / 1000,
    mode,
    phase: latest.phase,
    outcome: latest.outcome ?? null,
    winner: latest.winner ?? null,
    reason: latest.reason ?? null,
    players: [extrapPlayer(latest.players[0]), extrapPlayer(latest.players[1])],
  };
}

function hydratePlayerFromSnapshot(snap: PvpSnapshotPlayer, prev: PvpPlayerState | null): PvpPlayerState {
  const base = prev
    ? { ...prev, mag: [prev.mag[0], prev.mag[1], prev.mag[2]] as [number, number, number] }
    : createMatch(1).players[snap.seat];
  base.seat = snap.seat;
  base.x = snap.x;
  base.y = snap.y;
  base.z = snap.z;
  base.vx = snap.vx;
  base.vy = snap.vy;
  base.vz = snap.vz;
  base.yaw = snap.yaw;
  base.pitch = snap.pitch;
  base.hp = snap.hp;
  base.shield = snap.shield;
  base.alive = snap.alive;
  base.slot = snap.slot;
  base.mag = [
    snap.mag?.[0] ?? STOCK_GUNS[0].stats.magSize,
    snap.mag?.[1] ?? STOCK_GUNS[1].stats.magSize,
    snap.mag?.[2] ?? STOCK_GUNS[2].stats.magSize,
  ];
  base.shells = snap.shells;
  base.sniper = snap.sniper;
  base.reloadT = snap.reloadT;
  base.fireCd = snap.fireCd;
  base.swapT = snap.swapT;
  base.grappleCd = snap.grappleCd;
  base.grappleMiss = snap.grappleMiss;
  base.grapple = snap.grapple ? { ...snap.grapple } : null;
  base.onGround = snap.y <= 0.001;
  return base;
}

export function createPvpClient(opts: PvpClientOptions): PvpClient {
  const {
    accountId,
    transport,
    clock,
    interpDelayMs = NET_TUNING.interpDelayMs,
    predict = true,
    onChange,
    onReconcile,
  } = opts;

  let phase: ClientPhase = 'joining';
  let seat = -1;
  let seq = 0;
  let result: ClientResult | null = null;
  let rejectReason: string | null = null;
  let combatCommit: string | null = null;
  let readied = false;

  // Clock synchronization & RTT
  const offsets: number[] = [];
  let clockOffset: number | null = null;
  const rtts: number[] = [];
  let rttMs: number | null = null;
  const pingsOut: number[] = [];
  let lastPingAt = -Infinity;
  let lastPong: { serverMs: number; at: number } | null = null;

  // Fixed 30 Hz input clock
  let inputAcc = 0;
  let lastUpdateAt: number | null = null;
  let lastFrame = -1;
  let lead: number = NET_TUNING.leadStart;
  let lastViewTick: number | null = null;

  // Snapshot buffer & client prediction/reconciliation buffer
  const snaps: ServerSnapshotMessage[] = [];
  const pending: PendingInput[] = [];
  let predicted: PvpPlayerState | null = null;
  let offsetErr = { x: 0, y: 0, z: 0 };

  function notify(): void {
    if (onChange) onChange();
  }

  function setPhase(next: ClientPhase): void {
    if (result) {
      phase = 'done';
      return;
    }
    if (PHASE_RANK[next] > PHASE_RANK[phase]) phase = next;
  }

  function estTick(now: number): number | null {
    return clockOffset === null ? null : (now + clockOffset) / STEP_MS;
  }

  function recordClockSample(serverTick: number, at: number): void {
    if (!Number.isFinite(serverTick)) return;
    offsets.push(serverTick * STEP_MS - at);
    if (offsets.length > 30) offsets.shift();
    clockOffset = Math.max(...offsets);
  }

  function sendHello(): void {
    transport.send(OP.HELLO, {
      accountId,
      protocol: PVP_PROTOCOL_VERSION,
      sim: PVP_SIM_VERSION,
      content: CONTENT_FINGERPRINT,
      interpMs: Math.round(interpDelayMs),
    });
  }

  function maybePing(now: number, force = false): void {
    if (seat < 0) return;
    if (!force && now - lastPingAt < NET_TUNING.pingMs) return;
    lastPingAt = now;
    const body: Record<string, unknown> = { t: now, interpMs: Math.round(interpDelayMs) };
    if (lastPong) {
      body.echo = lastPong.serverMs;
      body.hold = Math.max(0, now - lastPong.at);
    }
    pingsOut.push(now);
    if (pingsOut.length > 8) pingsOut.shift();
    transport.send(OP.PING, body);
  }

  function reconcileFromSnapshot(snap: ServerSnapshotMessage): void {
    if (!predict || seat < 0 || snap.phase === 'done' || result) return;
    const serverPlayer = snap.players[seat];
    if (!serverPlayer) return;

    const prevPos = predicted ? { x: predicted.x, y: predicted.y, z: predicted.z } : null;
    const ackFrame = snap.you && snap.you.seat === seat ? snap.you.ackFrame : snap.tick - 1;

    // Drop inputs already processed by the server.
    while (pending.length > 0 && pending[0].frame <= ackFrame) {
      pending.shift();
    }

    // Rebase on authoritative server snapshot and replay unacknowledged inputs.
    const rebased = hydratePlayerFromSnapshot(serverPlayer, predicted);
    for (let i = 0; i < pending.length; i++) {
      const item = pending[i];
      if (rebased.alive) {
        movePlayer(rebased, item.wish, DT);
        weaponTick(rebased, item.wish, DT);
      }
    }
    predicted = rebased;

    if (prevPos) {
      const dx = prevPos.x - rebased.x;
      const dy = prevPos.y - rebased.y;
      const dz = prevPos.z - rebased.z;
      const err = Math.hypot(dx, dy, dz);
      const snapped = err > NET_TUNING.snapErrorDistM;
      if (snapped) {
        offsetErr = { x: 0, y: 0, z: 0 };
      } else {
        offsetErr = { x: offsetErr.x + dx, y: offsetErr.y + dy, z: offsetErr.z + dz };
      }
      if (onReconcile) {
        onReconcile({
          tick: snap.tick,
          ackFrame,
          errorM: err,
          snapped,
          replayed: pending.length,
        });
      }
    }
  }

  function onWelcome(body: Record<string, unknown>): void {
    if (body.accountId !== accountId) return;
    if (typeof body.seat === 'number' && (body.seat === 0 || body.seat === 1)) {
      seat = body.seat;
    }
    if (typeof body.phase === 'string' && body.phase in PHASE_RANK) {
      setPhase(body.phase as ClientPhase);
    }
    if (typeof body.combatCommit === 'string') combatCommit = body.combatCommit;
    if (typeof body.lastSeq === 'number' && Number.isInteger(body.lastSeq) && body.lastSeq > seq) {
      seq = body.lastSeq;
    }
    rejectReason = null;
    if (readied && body.phase === 'lobby' && body.ready === false) {
      transport.send(OP.READY, { accountId });
    }
    maybePing(clock(), true);
    notify();
  }

  function onPong(body: Record<string, unknown>): void {
    if (typeof body.t !== 'number') return;
    const now = clock();
    const idx = pingsOut.indexOf(body.t);
    if (idx < 0) return;
    pingsOut.splice(idx, 1);
    const rtt = now - body.t;
    if (!(rtt >= 0) || rtt > NET_TUNING.rttMaxSampleMs) return;
    if (typeof body.serverMs === 'number' && Number.isFinite(body.serverMs)) {
      lastPong = { serverMs: body.serverMs, at: now };
    }
    rtts.push(rtt);
    if (rtts.length > NET_TUNING.rttWindow) rtts.shift();
    const sorted = [...rtts].sort((a, b) => a - b);
    rttMs = sorted[Math.floor((sorted.length - 1) / 2)];
    lead = Math.max(
      NET_TUNING.leadMin,
      Math.min(NET_TUNING.leadMax, Math.ceil(rttMs / STEP_MS) + 1),
    );
    if (body.phase === 'live' && typeof body.clockTick === 'number' && !result) {
      recordClockSample(body.clockTick, now);
    }
  }

  function onSnapshot(snap: ServerSnapshotMessage): void {
    if (!snap || !Array.isArray(snap.players)) return;
    const latest = snaps[snaps.length - 1];
    if (latest && snap.tick < latest.tick) return;
    if (latest && snap.tick === latest.tick) snaps.pop();
    snaps.push(snap);
    if (snaps.length > NET_TUNING.snapshotBuffer) snaps.shift();

    recordClockSample(snap.clockTick ?? snap.tick, clock());
    reconcileFromSnapshot(snap);

    if (snap.outcome && snap.phase === 'done' && !result) {
      result = {
        outcome: snap.outcome,
        winner: snap.winner ?? null,
        reason: snap.reason ?? null,
        tick: snap.tick,
        stateHash: null,
        combatVerified: null,
      };
    }
    setPhase(snap.phase);
    notify();
  }

  function onResult(body: Record<string, unknown>): void {
    const combatSeed = typeof body.combatSeed === 'string' ? body.combatSeed : undefined;
    const combatVerified =
      combatSeed !== undefined && combatCommit !== null
        ? sha256Hex(combatSeed) === combatCommit
        : null;
    result = {
      outcome: typeof body.outcome === 'string' ? body.outcome : 'done',
      winner: body.winner === 0 || body.winner === 1 ? body.winner : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
      tick: typeof body.tick === 'number' ? body.tick : 0,
      stateHash: typeof body.stateHash === 'string' ? body.stateHash : null,
      combatSeed,
      combatVerified,
    };
    phase = 'done';
    notify();
  }

  function handlePacket(msg: PvpTransportPacket): void {
    let body: Record<string, unknown> | null = null;
    if (msg.opCode !== OP.INPUT) {
      try {
        const parsed = msg.json();
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          body = parsed as Record<string, unknown>;
        }
      } catch {
        body = null;
      }
    }
    if (!body) return;

    if (msg.opCode === OP.WELCOME) {
      onWelcome(body);
    } else if (msg.opCode === OP.PHASE) {
      if (body.phase === 'live' && !result && lastFrame < 0) {
        const ct = typeof body.clockTick === 'number' ? body.clockTick : typeof body.tick === 'number' ? body.tick : 0;
        recordClockSample(ct, clock());
      }
      if (typeof body.phase === 'string' && body.phase in PHASE_RANK) {
        setPhase(body.phase as ClientPhase);
      }
      notify();
    } else if (msg.opCode === OP.SNAPSHOT) {
      onSnapshot(body as unknown as ServerSnapshotMessage);
    } else if (msg.opCode === OP.PONG) {
      onPong(body);
    } else if (msg.opCode === OP.RESULT) {
      onResult(body);
    } else if (msg.opCode === OP.REJECT) {
      if (body.accountId === undefined || body.accountId === accountId) {
        rejectReason = typeof body.reason === 'string' ? body.reason : 'rejected';
        if (typeof body.lastSeq === 'number' && Number.isInteger(body.lastSeq) && body.lastSeq > seq) {
          seq = body.lastSeq;
        }
        notify();
      }
    }
  }

  if (transport.onMessage) transport.onMessage(handlePacket);
  if (transport.onRejoin) {
    transport.onRejoin(() => {
      sendHello();
    });
  }

  sendHello();

  function sendOneInput(at: number, buildWish: (frame: number) => PartialPvpWish): boolean {
    if (phase !== 'live' || result) return false;
    const est = estTick(at);
    if (est === null) return false;
    const aim = Math.floor(est) + lead;
    const frame = lastFrame < 0 ? aim : lastFrame + 1;
    if (frame < 0 || frame > INPUT_LIMITS.maxFrame) return false;

    const rawWish = buildWish(frame);
    const seenTick = lastViewTick !== null ? lastViewTick : Math.max(0, est - interpDelayMs / STEP_MS);
    const view =
      rawWish.viewTick !== undefined
        ? { viewTick: rawWish.viewTick, viewFrac: rawWish.viewFrac ?? 0 }
        : viewStamp(seenTick);

    const nextSeq = seq + 1;
    const packet = encodeInput({
      seq: nextSeq,
      frame,
      yaw: rawWish.yaw ?? 0,
      pitch: rawWish.pitch ?? 0,
      moveX: rawWish.moveX ?? 0,
      moveZ: rawWish.moveZ ?? 0,
      slot: rawWish.slot ?? -1,
      fire: !!rawWish.fire,
      zoom: !!rawWish.zoom,
      sprint: !!rawWish.sprint,
      jump: !!rawWish.jump,
      dash: !!rawWish.dash,
      reload: !!rawWish.reload,
      slide: !!rawWish.slide,
      grapple: !!rawWish.grapple,
      viewTick: view.viewTick,
      viewFrac: view.viewFrac,
    });

    seq = nextSeq;
    lastFrame = frame;
    transport.send(OP.INPUT, packet);

    if (predict && seat >= 0) {
      if (!predicted) {
        const latest = snaps[snaps.length - 1];
        predicted = latest
          ? hydratePlayerFromSnapshot(latest.players[seat], null)
          : createMatch(1).players[seat];
      }
      const norm = normalizeWish(predicted, { ...rawWish, viewTick: view.viewTick, viewFrac: view.viewFrac }, frame);
      if (predicted.alive) {
        movePlayer(predicted, norm, DT);
        weaponTick(predicted, norm, DT);
      }
      pending.push({ frame, seq: nextSeq, wish: norm });
      if (pending.length > NET_TUNING.pendingMax) pending.shift();
    }

    return true;
  }

  return {
    phase: () => phase,
    seat: () => seat,
    rttMs: () => rttMs,
    result: () => result,
    rejectReason: () => rejectReason,
    pendingCount: () => pending.length,
    predictedLocal: () => predicted,
    renderOffset: () => ({ ...offsetErr }),

    ready(): void {
      readied = true;
      transport.send(OP.READY, { accountId });
    },

    resync(): void {
      transport.send(OP.RESYNC, { accountId });
    },

    update(now: number, buildWish: (frame: number) => PartialPvpWish): number {
      maybePing(now);
      if (lastUpdateAt === null) {
        lastUpdateAt = now;
        return 0;
      }
      const elapsed = Math.max(0, Math.min(STALL_MS, now - lastUpdateAt));
      lastUpdateAt = now;

      // Decay visual reconciliation blend offset smoothly over blendDurationMs.
      if (elapsed > 0) {
        const decay = Math.max(0, 1 - elapsed / NET_TUNING.blendDurationMs);
        offsetErr.x *= decay;
        offsetErr.y *= decay;
        offsetErr.z *= decay;
      }

      inputAcc += elapsed;
      let sent = 0;
      while (inputAcc >= STEP_MS && sent < NET_TUNING.maxTicksPerUpdate) {
        inputAcc -= STEP_MS;
        if (sendOneInput(now, buildWish)) sent += 1;
      }
      if (inputAcc > STEP_MS * NET_TUNING.maxTicksPerUpdate) {
        inputAcc = 0;
      }
      return sent;
    },

    sample(now: number): SampledSnapshot | null {
      const est = estTick(now);
      if (est === null) return snaps.length > 0 ? sampleAt(snaps, snaps[snaps.length - 1].tick) : null;
      const renderTick = est - interpDelayMs / STEP_MS;
      const sampled = sampleAt(snaps, renderTick);
      if (sampled) lastViewTick = sampled.tick;
      return sampled;
    },

    handlePacket,
  };
}
