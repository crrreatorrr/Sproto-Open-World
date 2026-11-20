import { describe, expect, it } from 'vitest';
import {
  ARENA_R,
  ARENA_SOLIDS,
  ARENA_WALL_H,
  arenaHook,
  arenaOccludes,
  clampToArenaBounds,
  pushOutOfPillars,
} from '../../src/sim/pvp/arena';
import {
  CONTENT_FINGERPRINT,
  LEAD_IN_TICKS,
  MATCH_SECONDS,
  MATCH_TICKS,
  PVP_PROTOCOL_VERSION,
  PVP_SIM_VERSION,
  PVP_TUNING,
  REWIND,
  STOCK_LOADOUT,
  TICK_HZ,
  WAGER,
} from '../../src/sim/pvp/rules';
import {
  createMatch,
  dirFromYawPitch,
  replayMatch,
  scriptedMatch,
  snapshot,
  stateHash,
  stateSha256,
  stepMatch,
  yawTo,
  type PvpShotEvent,
} from '../../src/sim/pvp/sim';
import {
  buildMatchmakerQuery,
  decodeInput,
  encodeInput,
  hostileReason,
  matchmakerProps,
  OP,
  sanitizeClientMessage,
} from '../../src/net/pvpProtocol';
import {
  createPvpClient,
  sampleAt,
  type PvpTransport,
  type PvpTransportPacket,
  type ServerSnapshotMessage,
} from '../../src/net/pvpClient';

describe('PvP rules & constants (Sim v3)', () => {
  it('exposes required protocol, sim v3 (no Second Wind), rewind, loadout and wager constants', () => {
    expect(TICK_HZ).toBe(30);
    expect(MATCH_SECONDS).toBe(90);
    expect(MATCH_TICKS).toBe(2700);
    expect(LEAD_IN_TICKS).toBe(9);
    expect(PVP_PROTOCOL_VERSION).toBe(2);
    expect(PVP_SIM_VERSION).toBe(3);
    expect(REWIND.historyTicks).toBe(12);
    expect(REWIND.maxTicks).toBe(10);
    expect(STOCK_LOADOUT).toEqual(['mg', 'shotgun', 'sniper']);
    expect(WAGER).toEqual({ stake: 10, pot: 20, fee: 0, stallMs: 10_000 });
    expect(CONTENT_FINGERPRINT).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('PvP sim determinism', () => {
  it('produces identical stateHash and stateSha256 across two runs of a scripted 1v1 match', () => {
    const script = scriptedMatch(7, 180);
    const runA = replayMatch(script);
    const runB = replayMatch(script);

    expect(runA.tick).toBeGreaterThan(0);
    expect(stateHash(runA)).toBe(stateHash(runB));
    expect(stateSha256(runA)).toBe(stateSha256(runB));
    expect(snapshot(runA)).toEqual(snapshot(runB));
  });

  it('supports split-seed (spawnSeed + string combatSeed) deterministically', () => {
    const script = scriptedMatch(42, 60);
    const runA = replayMatch({ spawnSeed: 42, combatSeed: 'deadbeef0123456789abcdef01234567', inputs: script.inputs });
    const runB = replayMatch({ spawnSeed: 42, combatSeed: 'deadbeef0123456789abcdef01234567', inputs: script.inputs });
    const runDiff = replayMatch({ spawnSeed: 42, combatSeed: 'ffffffffffffffffffffffffffffffff', inputs: script.inputs });

    expect(stateHash(runA)).toBe(stateHash(runB));
    expect(stateHash(runA)).not.toBe(stateHash(runDiff));
  });
});

describe('PvP lag-compensated rewind hit detection', () => {
  it('hits a target at its 5-tick-old position with rewind=5 and misses with rewind=0', () => {
    // Setup two identical matches where seat 0 switches to sniper (0 ADS spread) and aims at seat 1's initial position.
    const setup = () => {
      const s = createMatch(1, 99);
      // Place seat 0 at (0, 0, 10) facing -Z toward seat 1 at (0, 0, -10).
      s.players[0].x = 0;
      s.players[0].z = 10;
      s.players[1].x = 0;
      s.players[1].z = -10;
      const aimYaw = yawTo(s.players[0], s.players[1]);
      s.players[0].yaw = aimYaw;
      s.players[0].slot = 2; // sniper (adsSpread = 0)
      s.players[0].swapT = 0;
      s.players[1].yaw = yawTo(s.players[1], s.players[0]);
      // Record initial tick 0 history at (0, 0, -10).
      s.hist[1][0] = { t: 0, x: 0, y: 0, z: -10, alive: true, invuln: 0 };

      // Advance 1 tick stationary so tick 1 history is also at x=0, then strafe seat 1 away for 5 ticks.
      stepMatch(s, [{ yaw: aimYaw }, { yaw: s.players[1].yaw }]);
      for (let i = 0; i < 5; i++) {
        stepMatch(s, [
          { yaw: aimYaw, zoom: true },
          { yaw: s.players[1].yaw, moveX: 1, sprint: true },
        ]);
      }
      // Seat 1 has moved well off x=0 by tick 6.
      expect(Math.abs(s.players[1].x)).toBeGreaterThan(0.8);
      return { s, aimYaw };
    };

    // With rewind = 5 (targeting tick 1 position at x=0): HIT!
    const withRewind = setup();
    const eventsRewind: PvpShotEvent[] = [];
    stepMatch(
      withRewind.s,
      [{ yaw: withRewind.aimYaw, pitch: 0, fire: true, zoom: true, rewind: 5, viewFrac: 0 }, { yaw: withRewind.s.players[1].yaw }],
      eventsRewind,
    );
    expect(eventsRewind.length).toBe(1);
    expect(eventsRewind[0].hits).toBe(1);
    expect(eventsRewind[0].dmg).toBeGreaterThan(0);

    // With rewind = 0 (targeting current tick position): MISS!
    const noRewind = setup();
    const eventsNoRewind: PvpShotEvent[] = [];
    stepMatch(
      noRewind.s,
      [{ yaw: noRewind.aimYaw, pitch: 0, fire: true, zoom: true, rewind: 0, viewFrac: 0 }, { yaw: noRewind.s.players[1].yaw }],
      eventsNoRewind,
    );
    expect(eventsNoRewind.length).toBe(1);
    expect(eventsNoRewind[0].hits).toBe(0);
    expect(eventsNoRewind[0].dmg).toBe(0);
  });
});

describe('PvP immediate KO at 0 HP (no Second Wind)', () => {
  it('immediately ends the match with outcome=ko when a player reaches 0 HP', () => {
    const s = createMatch(1, 123);
    s.players[0].x = 0;
    s.players[0].z = 10;
    s.players[1].x = 0;
    s.players[1].z = 0;
    const aimYaw = yawTo(s.players[0], s.players[1]);
    s.players[0].yaw = aimYaw;
    s.players[0].slot = 2; // sniper (85 dmg = 85,000 milli-HP)
    s.players[0].swapT = 0;

    // Lower seat 1 to 0 shield and 50,000 milli-HP so a single sniper shot kills immediately.
    s.players[1].shield = 0;
    s.players[1].hp = 50_000;
    s.hist[0][0] = { t: 0, x: s.players[0].x, y: 0, z: s.players[0].z, alive: true, invuln: 0 };
    s.hist[1][0] = { t: 0, x: s.players[1].x, y: 0, z: s.players[1].z, alive: true, invuln: 0 };

    stepMatch(s, [
      { yaw: aimYaw, pitch: 0, fire: true, zoom: true },
      { yaw: s.players[1].yaw },
    ]);

    expect(s.players[1].hp).toBe(0);
    expect(s.players[1].alive).toBe(false);
    expect(s.phase).toBe('done');
    expect(s.outcome).toBe('ko');
    expect(s.winner).toBe(0);
    expect(s.reason).toBe('ko');
    expect('downed' in s.players[1]).toBe(false);
  });

  it('scores a draw (double_ko) when both seats reach 0 HP on the same tick', () => {
    const s = createMatch(1, 555);
    s.players[0].x = 0;
    s.players[0].z = 10;
    s.players[1].x = 0;
    s.players[1].z = 0;
    const yaw0 = yawTo(s.players[0], s.players[1]);
    const yaw1 = yawTo(s.players[1], s.players[0]);
    for (const p of s.players) {
      p.slot = 2;
      p.swapT = 0;
      p.shield = 0;
      p.hp = 40_000;
    }
    s.hist[0][0] = { t: 0, x: s.players[0].x, y: 0, z: s.players[0].z, alive: true, invuln: 0 };
    s.hist[1][0] = { t: 0, x: s.players[1].x, y: 0, z: s.players[1].z, alive: true, invuln: 0 };

    stepMatch(s, [
      { yaw: yaw0, pitch: 0, fire: true, zoom: true },
      { yaw: yaw1, pitch: 0, fire: true, zoom: true },
    ]);

    expect(s.phase).toBe('done');
    expect(s.outcome).toBe('draw');
    expect(s.winner).toBeNull();
    expect(s.reason).toBe('double_ko');
  });
});

describe('PvP protocol & hostile-field sanitizer', () => {
  it('defines all 11 opcodes and rejects hostile client fields (top-level and nested)', () => {
    expect(Object.keys(OP)).toHaveLength(11);
    expect(OP).toEqual({
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
    });

    const hostileKeys = ['winner', 'result', 'settle', 'earn', 'wager', 'tickets', 'godMode'];
    for (const key of hostileKeys) {
      expect(hostileReason({ accountId: 'u1', [key]: 1 })).toBe('client_result');
      expect(sanitizeClientMessage({ nested: { [key]: true } })).toEqual({ ok: false, reason: 'client_result' });
    }

    expect(sanitizeClientMessage({ accountId: 'u1', protocol: 2, sim: 3 })).toEqual({
      ok: true,
      body: { accountId: 'u1', protocol: 2, sim: 3 },
    });
  });

  it('builds matchmaker queries for sproto-open-world free and wager modes', () => {
    const free = matchmakerProps('free');
    expect(free.stringProperties).toEqual({
      game: 'sproto-open-world',
      mode: 'free',
      protocol: '2',
      sim: '3',
      content: CONTENT_FINGERPRINT,
    });
    expect(free.query).toBe(buildMatchmakerQuery('free'));
    expect(free.query).toContain('+properties.game:sproto-open-world');
    expect(free.query).toContain('+properties.mode:free');

    const wager = matchmakerProps('wager');
    expect(wager.stringProperties.mode).toBe('wager');
    expect(wager.query).toContain('+properties.mode:wager');
  });

  it('round-trips binary 18-byte input frames cleanly', () => {
    const encoded = encodeInput({
      seq: 42,
      frame: 120,
      yaw: 1.25,
      pitch: -0.4,
      moveX: 0.5,
      moveZ: -1,
      slot: 2,
      fire: true,
      zoom: true,
      grapple: true,
      viewTick: 115,
      viewFrac: 128,
    });
    expect(encoded.byteLength).toBe(18);
    const decoded = decodeInput(encoded);
    expect(decoded.seq).toBe(42);
    expect(decoded.frame).toBe(120);
    expect(decoded.viewTick).toBe(115);
    expect(decoded.viewFrac).toBe(128);
    expect(decoded.slot).toBe(2);
    expect(decoded.fire).toBe(true);
    expect(decoded.zoom).toBe(true);
    expect(decoded.grapple).toBe(true);
    expect(decoded.jump).toBe(false);
    expect(decoded.yaw).toBeCloseTo(1.25, 3);
    expect(decoded.pitch).toBeCloseTo(-0.4, 3);
  });
});

describe('PvP arena bounds, pillar collisions & grapple raycasts', () => {
  it('pushes players out of all 4 symmetric pillars at (±14, ±14)', () => {
    expect(ARENA_SOLIDS).toHaveLength(4);
    for (const pillar of ARENA_SOLIDS) {
      const cx = (pillar.min[0] + pillar.max[0]) / 2;
      const cz = (pillar.min[2] + pillar.max[2]) / 2;
      const pos = { x: cx + 0.2, y: 0, z: cz + 0.1 };
      pushOutOfPillars(pos, PVP_TUNING.playerRadius, PVP_TUNING.playerHeight);
      const outsideX = pos.x <= pillar.min[0] - PVP_TUNING.playerRadius + 1e-3 || pos.x >= pillar.max[0] + PVP_TUNING.playerRadius - 1e-3;
      const outsideZ = pos.z <= pillar.min[2] - PVP_TUNING.playerRadius + 1e-3 || pos.z >= pillar.max[2] + PVP_TUNING.playerRadius - 1e-3;
      expect(outsideX || outsideZ).toBe(true);
    }
  });

  it('clamps players inside ARENA_R - playerRadius and cancels outward radial velocity', () => {
    const pos = { x: 60, z: 0 };
    const vel = { vx: 10, vz: 2 };
    clampToArenaBounds(pos, vel, PVP_TUNING.playerRadius);
    expect(Math.hypot(pos.x, pos.z)).toBeCloseTo(ARENA_R - PVP_TUNING.playerRadius, 4);
    expect(vel.vx).toBeCloseTo(0, 4);
    expect(vel.vz).toBeCloseTo(2, 4);
  });

  it('hooks pillars and circular boundary wall, and detects pillar occlusion', () => {
    // From (0, 2, 14) aiming +X toward NE pillar at (14, 14)
    const hitPillar = arenaHook({ x: 0, y: 2, z: 14 }, { x: 1, y: 0, z: 0 }, 16);
    expect(hitPillar).not.toBeNull();
    expect(hitPillar!.id).toBe('ne');
    expect(arenaOccludes({ x: 0, y: 2, z: 14 }, { x: 1, y: 0, z: 0 }, 20, null)).toBe(true);

    // From (35, 2, 0) aiming +X toward circular boundary wall at x = 45 (within ARENA_WALL_H = 12)
    const hitWall = arenaHook({ x: 35, y: 2, z: 0 }, { x: 1, y: 0, z: 0 }, 16);
    expect(hitWall).not.toBeNull();
    expect(hitWall!.id).toBe('wall');
    expect(hitWall!.y).toBeLessThanOrEqual(ARENA_WALL_H);
    expect(dirFromYawPitch(0, 0).z).toBeCloseTo(-1, 6);
  });
});

describe('PvP client 30 Hz input clock, prediction & reconciliation', () => {
  it('sends fixed 30 Hz inputs, predicts locally, and reconciles against authoritative snapshots', () => {
    let now = 1000;
    const sent: Array<{ op: number; data: unknown }> = [];
    let onMsg: ((msg: PvpTransportPacket) => void) | null = null;

    const transport: PvpTransport = {
      send(op, data) {
        sent.push({ op, data });
      },
      onMessage(fn) {
        onMsg = fn;
        return () => {};
      },
    };

    let reconciled = 0;
    const client = createPvpClient({
      accountId: 'player-a',
      transport,
      clock: () => now,
      onReconcile: () => { reconciled += 1; },
    });

    expect(sent[0].op).toBe(OP.HELLO);

    // Deliver WELCOME + PHASE(live)
    onMsg!({ opCode: OP.WELCOME, json: () => ({ accountId: 'player-a', seat: 0, phase: 'lobby' }) });
    onMsg!({ opCode: OP.PHASE, json: () => ({ phase: 'live', clockTick: 0 }) });
    expect(client.phase()).toBe('live');
    expect(client.seat()).toBe(0);

    // Advance 101ms -> 3 full ticks at 30 Hz (3 * 33.333ms)
    client.update(now, () => ({ moveZ: 1, yaw: 0 }));
    now += 101;
    const ticksSent = client.update(now, () => ({ moveZ: 1, yaw: 0 }));
    expect(ticksSent).toBe(3);
    expect(client.pendingCount()).toBe(3);

    // Authoritative snapshot acking frame 5 (first predicted frame: est=3 + lead=2) -> reconciles and trims pending buffer
    const m = createMatch(1);
    const s0 = snapshot(m);
    const snapMsg: ServerSnapshotMessage = {
      tick: 6,
      clockTick: 6,
      phase: 'live',
      players: s0.players,
      you: { seat: 0, ackFrame: 5, ackSeq: 1 },
    };
    onMsg!({ opCode: OP.SNAPSHOT, json: () => snapMsg });
    expect(reconciled).toBe(1);
    expect(client.pendingCount()).toBe(2);

    // Snapshot interpolation sanity
    const snapMsg2: ServerSnapshotMessage = {
      ...snapMsg,
      tick: 7,
      clockTick: 7,
      players: [{ ...s0.players[0], x: s0.players[0].x + 2 }, s0.players[1]],
    };
    const interp = sampleAt([snapMsg, snapMsg2], 6.5);
    expect(interp).not.toBeNull();
    expect(interp!.mode).toBe('interp');
    expect(interp!.players[0].x).toBeCloseTo(s0.players[0].x + 1, 4);
  });
});
