"use strict";
var SprotoShooterPvp = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/sim/pvp/export.ts
  var export_exports = {};
  __export(export_exports, {
    CONTENT_FINGERPRINT: () => CONTENT_FINGERPRINT,
    INPUT_LIMITS: () => INPUT_LIMITS,
    LEAD_IN_TICKS: () => LEAD_IN_TICKS,
    LOADOUT_HASH: () => LOADOUT_HASH,
    MATCH_SECONDS: () => MATCH_SECONDS,
    MATCH_TICKS: () => MATCH_TICKS,
    OP: () => OP,
    PVP_PROTOCOL_VERSION: () => PVP_PROTOCOL_VERSION,
    PVP_SIM_VERSION: () => PVP_SIM_VERSION,
    REWIND: () => REWIND,
    SOURCE_COMMIT: () => SOURCE_COMMIT,
    STOCK_GUNS: () => STOCK_GUNS,
    STOCK_LOADOUT: () => STOCK_LOADOUT,
    TICK_HZ: () => TICK_HZ,
    WAGER: () => WAGER,
    buildMatchmakerQuery: () => buildMatchmakerQuery,
    createMatch: () => createMatch,
    decodeInput: () => decodeInput,
    encodeInput: () => encodeInput,
    historyAt: () => historyAt,
    hostileReason: () => hostileReason,
    matchmakerProps: () => matchmakerProps,
    publicStateHash: () => publicStateHash,
    replayMatch: () => replayMatch,
    rewoundTarget: () => rewoundTarget,
    rules: () => rules,
    sanitizeClientMessage: () => sanitizeClientMessage,
    scriptedMatch: () => scriptedMatch,
    sha256Hex: () => sha256Hex,
    snapshot: () => snapshot,
    stateHash: () => stateHash,
    stateSha256: () => stateSha256,
    stepMatch: () => stepMatch,
    validId: () => validId,
    versionsMatch: () => versionsMatch
  });

  // src/sim/pvp/arena.ts
  var ARENA_R = 45;
  var ARENA_WALL_H = 12;
  var PILLAR_HALF = 1.1;
  var PILLAR_H = 10;
  function makeBox(id, x, z, hx, hy, hz) {
    return Object.freeze({
      id,
      kind: "box",
      min: Object.freeze([x - hx, 0, z - hz]),
      max: Object.freeze([x + hx, hy, z + hz])
    });
  }
  var ARENA_SOLIDS = Object.freeze([
    makeBox("ne", 14, 14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
    makeBox("nw", -14, 14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
    makeBox("se", 14, -14, PILLAR_HALF, PILLAR_H, PILLAR_HALF),
    makeBox("sw", -14, -14, PILLAR_HALF, PILLAR_H, PILLAR_HALF)
  ]);
  function rayBox(origin, dir, box, maxDist) {
    let tmin = 0;
    let tmax = maxDist;
    const ox = origin.x;
    const dx = dir.x;
    if (Math.abs(dx) < 1e-9) {
      if (ox < box.min[0] || ox > box.max[0]) return -1;
    } else {
      const inv = 1 / dx;
      let t1 = (box.min[0] - ox) * inv;
      let t2 = (box.max[0] - ox) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    const oy = origin.y;
    const dy = dir.y;
    if (Math.abs(dy) < 1e-9) {
      if (oy < box.min[1] || oy > box.max[1]) return -1;
    } else {
      const inv = 1 / dy;
      let t1 = (box.min[1] - oy) * inv;
      let t2 = (box.max[1] - oy) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    const oz = origin.z;
    const dz = dir.z;
    if (Math.abs(dz) < 1e-9) {
      if (oz < box.min[2] || oz > box.max[2]) return -1;
    } else {
      const inv = 1 / dz;
      let t1 = (box.min[2] - oz) * inv;
      let t2 = (box.max[2] - oz) * inv;
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
    return tmin >= 0 && tmin <= maxDist ? tmin : -1;
  }
  function firstArenaSolid(origin, dir, maxDist, ignoreId = null) {
    let bestT = maxDist + 1;
    let bestId = null;
    for (let i = 0; i < ARENA_SOLIDS.length; i++) {
      const solid = ARENA_SOLIDS[i];
      if (ignoreId !== null && solid.id === ignoreId) continue;
      const t = rayBox(origin, dir, solid, maxDist);
      if (t >= 0 && t < bestT) {
        bestT = t;
        bestId = solid.id;
      }
    }
    if (bestId === null) return null;
    return {
      t: bestT,
      x: origin.x + dir.x * bestT,
      y: origin.y + dir.y * bestT,
      z: origin.z + dir.z * bestT,
      id: bestId
    };
  }
  function rayArenaWall(origin, dir, maxDist) {
    const a = dir.x * dir.x + dir.z * dir.z;
    if (a < 1e-8) return null;
    const b = origin.x * dir.x + origin.z * dir.z;
    const c = origin.x * origin.x + origin.z * origin.z - ARENA_R * ARENA_R;
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const t = (-b + Math.sqrt(disc)) / a;
    if (!(t >= 0.4) || t > maxDist) return null;
    const y = origin.y + dir.y * t;
    if (y < 0 || y > ARENA_WALL_H) return null;
    return {
      t,
      x: origin.x + dir.x * t,
      y,
      z: origin.z + dir.z * t,
      id: "wall"
    };
  }
  function arenaHook(origin, dir, maxDist) {
    let best = firstArenaSolid(origin, dir, maxDist, null);
    const wall = rayArenaWall(origin, dir, maxDist);
    if (wall && (!best || wall.t < best.t)) best = wall;
    return best;
  }
  function arenaOccludes(origin, dir, maxDist, ignoreId = null) {
    if (maxDist <= 0) return false;
    return firstArenaSolid(origin, dir, maxDist, ignoreId) !== null;
  }
  function pushCircleOutOfBox(x, z, box, radius) {
    const cx = Math.max(box.min[0], Math.min(x, box.max[0]));
    const cz = Math.max(box.min[2], Math.min(z, box.max[2]));
    const dx = x - cx;
    const dz = z - cz;
    const dist = Math.hypot(dx, dz);
    if (dist >= radius) return null;
    if (dist < 1e-6) {
      const left = x - box.min[0];
      const right = box.max[0] - x;
      const back = z - box.min[2];
      const fwd = box.max[2] - z;
      const m = Math.min(left, right, back, fwd);
      const pad = radius + 1e-4;
      if (m === left) return { x: box.min[0] - pad, z };
      if (m === right) return { x: box.max[0] + pad, z };
      if (m === back) return { x, z: box.min[2] - pad };
      return { x, z: box.max[2] + pad };
    }
    const k = (radius - dist) / dist + 1e-4;
    return { x: x + dx * k, z: z + dz * k };
  }
  function pushOutOfPillars(pos, radius, height) {
    const feet = pos.y;
    const head = feet + height;
    const step = 0.4;
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < ARENA_SOLIDS.length; i++) {
        const s = ARENA_SOLIDS[i];
        if (s.max[1] <= feet + step + 0.02) continue;
        if (head <= s.min[1] + 0.01 || feet + step >= s.max[1]) continue;
        const next = pushCircleOutOfBox(pos.x, pos.z, s, radius);
        if (!next) continue;
        pos.x = next.x;
        pos.z = next.z;
      }
    }
  }
  function clampToArenaBounds(pos, vel, radius) {
    const r = Math.hypot(pos.x, pos.z);
    const maxR = ARENA_R - radius;
    if (r > maxR && r > 0) {
      const nx = pos.x / r;
      const nz = pos.z / r;
      pos.x = nx * maxR;
      pos.z = nz * maxR;
      const vr = vel.vx * nx + vel.vz * nz;
      if (vr > 0) {
        vel.vx -= nx * vr;
        vel.vz -= nz * vr;
      }
    }
  }
  function pillarGroundHeight(x, z, radius, feetY, stepHeight = 0.4) {
    let best = 0;
    for (let i = 0; i < ARENA_SOLIDS.length; i++) {
      const s = ARENA_SOLIDS[i];
      if (s.max[1] > feetY + stepHeight) continue;
      const cx = Math.max(s.min[0], Math.min(x, s.max[0]));
      const cz = Math.max(s.min[2], Math.min(z, s.max[2]));
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz <= radius * radius) {
        if (s.max[1] > best) best = s.max[1];
      }
    }
    return best;
  }

  // src/sim/pvp/rules.ts
  var GAME_ID = "sproto-open-world";
  var MATCH_NAME = "sproto_open_world_pvp";
  var STAGE_ID = "arena";
  var TICK_HZ = 30;
  var DT = 1 / TICK_HZ;
  var STEP_MS = 1e3 / TICK_HZ;
  var MATCH_SECONDS = 90;
  var MATCH_TICKS = MATCH_SECONDS * TICK_HZ;
  var LEAD_IN_TICKS = 9;
  var PVP_PROTOCOL_VERSION = 2;
  var PVP_SIM_VERSION = 3;
  var SEATS = 2;
  var SPAWN_RADIUS = 16;
  var READY_MS = 3e4;
  var STALL_MS = 1e4;
  var MAX_MATCH_MS = 10 * 60 * 1e3;
  var REWIND = Object.freeze({
    historyTicks: 12,
    maxTicks: 10,
    maxBack: 255,
    fracSteps: 256,
    interpMs: 100,
    interpMinMs: 50,
    interpMaxMs: 150,
    extraTicks: 2,
    rttWindow: 8,
    maxRttMs: 1e3,
    pongMemory: 4,
    maxBackStep: 2
  });
  var STOCK_LOADOUT = Object.freeze(["mg", "shotgun", "sniper"]);
  var WAGER = Object.freeze({
    stake: 10,
    pot: 20,
    fee: 0,
    stallMs: 1e4
  });
  var INPUT_LIMITS = Object.freeze({
    maxFramesPerSecond: 45,
    maxFramesPerCursor: 9,
    futureFrames: 8,
    holdTicks: 3,
    catchUpTicks: 4,
    maxPingsPerSecond: 10,
    maxHelloPerSecond: 2,
    maxReadyPerSecond: 2,
    frameBytes: 18,
    maxFrame: 1e6,
    maxIdLength: 80,
    maxNameLength: 32,
    maxLeadInTicks: 90
  });
  var REPLAY_LIMITS = Object.freeze({
    maxTicks: MATCH_TICKS,
    maxBytes: 512 * 1024
  });
  var PVP_TUNING = Object.freeze({
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
    jumpVel: 8,
    doubleJumpVel: 7,
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
    dashCd: 2,
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
    shieldDelay: 3,
    shieldRegen: 25,
    pitchLimit: 1.5,
    critHitMult: 1.5
  });
  var STOCK_GUNS = Object.freeze([
    Object.freeze({
      id: "mg",
      name: "Machine Gun",
      ammoType: "bullets",
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
        swapTime: 0.5
      })
    }),
    Object.freeze({
      id: "shotgun",
      name: "Shotgun",
      ammoType: "shells",
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
        swapTime: 0.5
      })
    }),
    Object.freeze({
      id: "sniper",
      name: "Sniper",
      ammoType: "sniper",
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
        swapTime: 0.6
      })
    })
  ]);
  var RESERVE = Object.freeze({
    shells: 24,
    sniper: 12
  });
  function rangeFalloff(range, dist) {
    if (dist > range.max) return 0;
    if (dist <= range.full) return 1;
    const span = range.max - range.full;
    if (span <= 0) return range.min;
    const t = (dist - range.full) / span;
    return 1 - t * (1 - range.min);
  }
  function stableStringify(value) {
    if (value === null) return "null";
    const t = typeof value;
    if (t === "number") return Number.isFinite(value) ? JSON.stringify(value) : "null";
    if (t === "string" || t === "boolean") return JSON.stringify(value);
    if (t !== "object") return "null";
    if (Array.isArray(value)) {
      let s2 = "[";
      for (let i = 0; i < value.length; i++) {
        if (i > 0) s2 += ",";
        s2 += stableStringify(value[i]);
      }
      return s2 + "]";
    }
    const obj = value;
    const keys = Object.keys(obj).sort();
    let s = "{";
    let n = 0;
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      const v = obj[k];
      if (v === void 0) continue;
      if (n++ > 0) s += ",";
      s += JSON.stringify(k) + ":" + stableStringify(v);
    }
    return s + "}";
  }
  function fnv1a(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
  }
  function quantizeForHash(value) {
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return 0;
      return Math.round(value * 1e6);
    }
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const arr = new Array(value.length);
      for (let i = 0; i < value.length; i++) arr[i] = quantizeForHash(value[i]);
      return arr;
    }
    const obj = value;
    const out = {};
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (k === "events") continue;
      out[k] = quantizeForHash(obj[k]);
    }
    return out;
  }
  var SHA256_K = [
    1116352408,
    1899447441,
    3049323471,
    3921009573,
    961987163,
    1508970993,
    2453635748,
    2870763221,
    3624381080,
    310598401,
    607225278,
    1426881987,
    1925078388,
    2162078206,
    2614888103,
    3248222580,
    3835390401,
    4022224774,
    264347078,
    604807628,
    770255983,
    1249150122,
    1555081692,
    1996064986,
    2554220882,
    2821834349,
    2952996808,
    3210313671,
    3336571891,
    3584528711,
    113926993,
    338241895,
    666307205,
    773529912,
    1294757372,
    1396182291,
    1695183700,
    1986661051,
    2177026350,
    2456956037,
    2730485921,
    2820302411,
    3259730800,
    3345764771,
    3516065817,
    3600352804,
    4094571909,
    275423344,
    430227734,
    506948616,
    659060556,
    883997877,
    958139571,
    1322822218,
    1537002063,
    1747873779,
    1955562222,
    2024104815,
    2227730452,
    2361852424,
    2428436474,
    2756734187,
    3204031479,
    3329325298
  ];
  function utf8Bytes(text) {
    const out = [];
    for (let i = 0; i < text.length; i++) {
      let c = text.charCodeAt(i);
      if (c >= 55296 && c <= 56319 && i + 1 < text.length) {
        const d = text.charCodeAt(i + 1);
        if (d >= 56320 && d <= 57343) {
          c = 65536 + (c - 55296 << 10) + (d - 56320);
          i += 1;
        }
      }
      if (c < 128) out.push(c);
      else if (c < 2048) out.push(192 | c >> 6, 128 | c & 63);
      else if (c < 65536) out.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      else out.push(240 | c >> 18, 128 | c >> 12 & 63, 128 | c >> 6 & 63, 128 | c & 63);
    }
    return out;
  }
  function rotr(x, n) {
    return x >>> n | x << 32 - n;
  }
  function sha256Hex(text) {
    const bytes = utf8Bytes(String(text));
    const bitLength = bytes.length * 8;
    bytes.push(128);
    while (bytes.length % 64 !== 56) bytes.push(0);
    const high = Math.floor(bitLength / 4294967296);
    bytes.push(high >>> 24 & 255, high >>> 16 & 255, high >>> 8 & 255, high & 255);
    bytes.push(bitLength >>> 24 & 255, bitLength >>> 16 & 255, bitLength >>> 8 & 255, bitLength & 255);
    const h = [
      1779033703,
      3144134277,
      1013904242,
      2773480762,
      1359893119,
      2600822924,
      528734635,
      1541459225
    ];
    const w = new Array(64);
    for (let at = 0; at < bytes.length; at += 64) {
      for (let i = 0; i < 16; i++) {
        const j = at + i * 4;
        w[i] = bytes[j] << 24 | bytes[j + 1] << 16 | bytes[j + 2] << 8 | bytes[j + 3] | 0;
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ w[i - 15] >>> 3;
        const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ w[i - 2] >>> 10;
        w[i] = w[i - 16] + s0 + w[i - 7] + s1 | 0;
      }
      let [a, b, c, d, e, f, g, k] = h;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = e & f ^ ~e & g;
        const t1 = k + S1 + ch + SHA256_K[i] + w[i] | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = a & b ^ a & c ^ b & c;
        const t2 = S0 + maj | 0;
        k = g;
        g = f;
        f = e;
        e = d + t1 | 0;
        d = c;
        c = b;
        b = a;
        a = t1 + t2 | 0;
      }
      h[0] = h[0] + a | 0;
      h[1] = h[1] + b | 0;
      h[2] = h[2] + c | 0;
      h[3] = h[3] + d | 0;
      h[4] = h[4] + e | 0;
      h[5] = h[5] + f | 0;
      h[6] = h[6] + g | 0;
      h[7] = h[7] + k | 0;
    }
    let out = "";
    for (let i = 0; i < 8; i++) out += (h[i] >>> 0).toString(16).padStart(8, "0");
    return out;
  }
  var LOADOUT_HASH = fnv1a(stableStringify(STOCK_GUNS));
  function contentBody() {
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
      arenaWallH: ARENA_WALL_H
    };
  }
  function contentFingerprint() {
    return fnv1a(stableStringify(contentBody()));
  }
  var CONTENT_FINGERPRINT = contentFingerprint();
  function matchmakerQuery(mode = "free", fingerprint = CONTENT_FINGERPRINT) {
    return `+properties.game:${GAME_ID} +properties.mode:${mode} +properties.protocol:${PVP_PROTOCOL_VERSION} +properties.sim:${PVP_SIM_VERSION} +properties.content:${fingerprint}`;
  }

  // src/sim/pvp/sim.ts
  var MAX_HP = PVP_TUNING.maxHp * 1e3;
  var MAX_SHIELD = PVP_TUNING.maxShield * 1e3;
  var DEG2RAD = Math.PI / 180;
  function q4(n) {
    return Math.round(n * 1e4) / 1e4;
  }
  function dirFromYawPitch(yaw, pitch) {
    const cp = Math.cos(pitch);
    return {
      x: -Math.sin(yaw) * cp,
      y: Math.sin(pitch),
      z: -Math.cos(yaw) * cp
    };
  }
  function yawTo(from, to) {
    return Math.atan2(-(to.x - from.x), -(to.z - from.z));
  }
  function hashSeed(n) {
    let s = n >>> 0 || 2654435769;
    const out = [0, 0, 0, 0];
    for (let i = 0; i < 4; i++) {
      s = s + 2654435769 >>> 0;
      let z = s;
      z = Math.imul(z ^ z >>> 16, 2246822507) >>> 0;
      z = Math.imul(z ^ z >>> 13, 3266489909) >>> 0;
      out[i] = (z ^ z >>> 16) >>> 0;
    }
    return out;
  }
  function nextU32(r) {
    r.a >>>= 0;
    r.b >>>= 0;
    r.c >>>= 0;
    r.d >>>= 0;
    const t = r.a + r.b >>> 0;
    r.a = r.b ^ r.b >>> 9;
    r.b = r.c + (r.c << 3) >>> 0;
    r.c = r.c << 21 | r.c >>> 11;
    r.d = r.d + 1 >>> 0;
    const res = t + r.d >>> 0;
    r.c = r.c + res >>> 0;
    return res;
  }
  function randFloat(r) {
    return nextU32(r) / 4294967296;
  }
  function createRng(seed) {
    const [a, b, c, d] = hashSeed(seed);
    const r = { a, b, c, d };
    for (let i = 0; i < 12; i++) nextU32(r);
    return r;
  }
  function combatRngWords(combatSeed) {
    const digest = sha256Hex(`sproto-open-world:pvp:combat:${combatSeed}`);
    return [
      parseInt(digest.slice(0, 8), 16) >>> 0,
      parseInt(digest.slice(8, 16), 16) >>> 0,
      parseInt(digest.slice(16, 24), 16) >>> 0,
      parseInt(digest.slice(24, 32), 16) >>> 0
    ];
  }
  function combatRng(combatSeed) {
    if (typeof combatSeed !== "string") return createRng(Number(combatSeed) >>> 0 || 1);
    const [a, b, c, d] = combatRngWords(combatSeed);
    const r = { a, b, c, d: d || 1 };
    for (let i = 0; i < 12; i++) nextU32(r);
    return r;
  }
  function raySphere(o, d, c, r) {
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
  function rayCapsule(o, d, cx, cz, y0, y1, r) {
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
  function spawnsFor(seed) {
    const angle = (seed >>> 0) % 360 * DEG2RAD;
    const x = q4(Math.cos(angle) * SPAWN_RADIUS);
    const z = q4(Math.sin(angle) * SPAWN_RADIUS);
    return [
      { x, y: 0, z },
      { x: q4(-x), y: 0, z: q4(-z) }
    ];
  }
  function makePlayer(seat, pos, yaw, rng) {
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
        STOCK_GUNS[2].stats.magSize
      ],
      shells: RESERVE.shells,
      sniper: RESERVE.sniper,
      fireCd: 0,
      reloadT: 0,
      swapT: 0,
      rng: { a: rng.a, b: rng.b, c: rng.c, d: rng.d }
    };
  }
  function recordHistory(state, tick) {
    const idx = tick % REWIND.historyTicks;
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      state.hist[i][idx] = { t: tick, x: p.x, y: p.y, z: p.z, alive: p.alive, invuln: p.invuln };
    }
  }
  function histAt(state, seat, tick) {
    if (tick < 0) return null;
    const entry = state.hist[seat][tick % REWIND.historyTicks];
    return entry && entry.t === tick ? entry : null;
  }
  function createMatch(spawnSeed, combatSeed = spawnSeed) {
    const n = spawnSeed >>> 0;
    const rng = combatRng(combatSeed);
    const points = spawnsFor(n);
    const yaw0 = yawTo(points[0], points[1]);
    const yaw1 = yawTo(points[1], points[0]);
    const hist0 = new Array(REWIND.historyTicks).fill(null);
    const hist1 = new Array(REWIND.historyTicks).fill(null);
    const state = {
      spawnSeed: n,
      stage: STAGE_ID,
      tick: 0,
      phase: "live",
      outcome: null,
      winner: null,
      reason: null,
      players: [
        makePlayer(0, points[0], yaw0, rng),
        makePlayer(1, points[1], yaw1, rng)
      ],
      hist: [hist0, hist1]
    };
    recordHistory(state, 0);
    return state;
  }
  function rewoundTarget(state, seat, frame, rewind, viewFrac) {
    const base = frame - rewind;
    const a = histAt(state, seat, base) ?? histAt(state, seat, frame + 1);
    const b = histAt(state, seat, base + 1) ?? a;
    const t = viewFrac / REWIND.fracSteps;
    return {
      x: q4(a.x + (b.x - a.x) * t),
      y: q4(a.y + (b.y - a.y) * t),
      z: q4(a.z + (b.z - a.z) * t),
      invuln: a.invuln,
      base,
      rewind,
      viewFrac
    };
  }
  function historyAt(state, seat, at) {
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
      alive: a.alive
    };
  }
  function viewOf(wish, tick) {
    let back = 0;
    if (typeof wish.rewind === "number" && Number.isInteger(wish.rewind)) {
      back = wish.rewind;
    } else if (typeof wish.viewTick === "number" && Number.isInteger(wish.viewTick)) {
      back = tick - wish.viewTick;
    }
    let frac = typeof wish.viewFrac === "number" && Number.isInteger(wish.viewFrac) ? Math.max(0, Math.min(REWIND.fracSteps - 1, wish.viewFrac)) : 0;
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
  function normalizeWish(player, raw, tick = 0) {
    const wish = raw ?? {};
    const num = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
    let slot = -1;
    if (typeof wish.slot === "number" && Number.isInteger(wish.slot) && wish.slot >= 0 && wish.slot <= 2) {
      slot = wish.slot;
    }
    const view = viewOf(wish, tick);
    return {
      yaw: num(wish.yaw, player.yaw),
      pitch: Math.max(-PVP_TUNING.pitchLimit, Math.min(PVP_TUNING.pitchLimit, num(wish.pitch, player.pitch))),
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
      viewFrac: view.frac
    };
  }
  function eyeOf(p) {
    return { x: p.x, y: p.y + (p.slideT > 0 ? PVP_TUNING.slideEye : PVP_TUNING.eyeHeight), z: p.z };
  }
  function clampSpeed3(vx, vy, vz, limit) {
    const s = Math.hypot(vx, vy, vz);
    if (s > limit && s > 0) {
      const k = limit / s;
      return [vx * k, vy * k, vz * k];
    }
    return [vx, vy, vz];
  }
  function releaseGrapple(p) {
    if (!p.grapple) return;
    const [vx, vy, vz] = clampSpeed3(p.vx, p.vy, p.vz, PVP_TUNING.grappleReleaseSpeed);
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.grapple = null;
  }
  function tickGrapple(p, wish, dt) {
    if (p.grappleCd > 0) p.grappleCd = Math.max(0, p.grappleCd - dt);
    if (!wish.grapple) {
      releaseGrapple(p);
      return;
    }
    if (!p.grapple) {
      if (p.grappleCd > 0) return;
      const hit = arenaHook(eyeOf(p), dirFromYawPitch(p.yaw, p.pitch), PVP_TUNING.grappleRange);
      p.grappleCd = PVP_TUNING.grappleCd;
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
    const dy = hook.y - (p.y + PVP_TUNING.grappleOrigin);
    const dz = hook.z - p.z;
    const dist = Math.hypot(dx, dy, dz) || 1;
    if (dist < PVP_TUNING.grappleArrive) {
      releaseGrapple(p);
      return;
    }
    const pull = PVP_TUNING.grapplePull * dt;
    const [vx, vy, vz] = clampSpeed3(
      p.vx + dx / dist * pull,
      p.vy + dy / dist * pull,
      p.vz + dz / dist * pull,
      PVP_TUNING.grappleSpeed
    );
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
  }
  function movePlayer(p, wish, dt) {
    p.yaw = q4(wish.yaw);
    p.pitch = q4(Math.max(-PVP_TUNING.pitchLimit, Math.min(PVP_TUNING.pitchLimit, wish.pitch)));
    if (wish.slot >= 0 && wish.slot !== p.slot) {
      p.slot = wish.slot;
      p.reloadT = 0;
      p.swapT = STOCK_GUNS[p.slot].stats.swapTime;
    }
    p.invuln = Math.max(0, p.invuln - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.slideCd = Math.max(0, p.slideCd - dt);
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
    const wantsSprint = wish.sprint && wishLen > 0.1 && p.onGround && !p.staminaLock && p.slideT <= 0;
    if (wantsSprint) {
      p.zoomCancelled = true;
      p.zooming = false;
      p.stamina = Math.max(0, p.stamina - dt / PVP_TUNING.staminaSprint);
      p.staminaDelay = PVP_TUNING.staminaRegenDelay;
      if (p.stamina <= 0) p.staminaLock = true;
    } else {
      if (!wish.zoom) p.zoomCancelled = false;
      p.zooming = wish.zoom && !p.zoomCancelled;
      if (p.staminaDelay > 0) {
        p.staminaDelay = Math.max(0, p.staminaDelay - dt);
      } else if (p.stamina < 1) {
        p.stamina = Math.min(1, p.stamina + dt / PVP_TUNING.staminaRegen);
        if (p.staminaLock && p.stamina >= PVP_TUNING.staminaRefill) p.staminaLock = false;
      }
    }
    if (wish.dash && p.dashCd <= 0 && p.dashT <= 0) {
      const dx = wishLen > 0.1 ? wishX / wishLen : fwdX;
      const dz = wishLen > 0.1 ? wishZ / wishLen : fwdZ;
      p.dashX = dx;
      p.dashZ = dz;
      p.dashT = PVP_TUNING.dashTime;
      p.dashCd = PVP_TUNING.dashCd;
      p.invuln = Math.max(p.invuln, PVP_TUNING.dashInvuln);
      p.slideT = 0;
    }
    const horizSpeed = Math.hypot(p.vx, p.vz);
    if (wish.slide && p.onGround && p.slideT <= 0 && p.slideCd <= 0 && horizSpeed >= PVP_TUNING.slideMinSpeed && p.stamina >= PVP_TUNING.slideStamina) {
      p.slideT = PVP_TUNING.slideTime;
      p.stamina = Math.max(0, p.stamina - PVP_TUNING.slideStamina);
      p.staminaDelay = PVP_TUNING.staminaRegenDelay;
      const dirX = horizSpeed > 0.01 ? p.vx / horizSpeed : fwdX;
      const dirZ = horizSpeed > 0.01 ? p.vz / horizSpeed : fwdZ;
      const boost = Math.max(horizSpeed, PVP_TUNING.slideBoost);
      p.vx = dirX * boost;
      p.vz = dirZ * boost;
    }
    if (p.dashT > 0) {
      p.vx = p.dashX * PVP_TUNING.dashSpeed;
      p.vz = p.dashZ * PVP_TUNING.dashSpeed;
      p.dashT = Math.max(0, p.dashT - dt);
      if (p.dashT === 0) {
        p.vx *= PVP_TUNING.dashEndScale;
        p.vz *= PVP_TUNING.dashEndScale;
      }
    } else if (p.slideT > 0) {
      p.slideT = Math.max(0, p.slideT - dt);
      const sp = Math.hypot(p.vx, p.vz);
      if (sp > PVP_TUNING.slideCruise) {
        const nextSp = Math.max(PVP_TUNING.slideCruise, sp - PVP_TUNING.slideDrag * dt * sp);
        p.vx = p.vx / sp * nextSp;
        p.vz = p.vz / sp * nextSp;
      }
      if (p.slideT === 0 || !p.onGround) {
        p.slideT = 0;
        p.slideCd = PVP_TUNING.slideCd;
      }
    } else {
      const maxSpeed = wantsSprint ? PVP_TUNING.sprintSpeed : PVP_TUNING.walkSpeed;
      const targetVx = wishX * maxSpeed;
      const targetVz = wishZ * maxSpeed;
      if (p.onGround) {
        const accel = wishLen > 0.05 ? PVP_TUNING.groundAccel : PVP_TUNING.friction;
        const alpha = Math.min(1, accel * dt);
        p.vx += (targetVx - p.vx) * alpha;
        p.vz += (targetVz - p.vz) * alpha;
      } else {
        const alpha = Math.min(1, PVP_TUNING.airAccel * dt);
        p.vx += (targetVx - p.vx) * alpha;
        p.vz += (targetVz - p.vz) * alpha;
      }
    }
    if (p.onGround) {
      p.coyoteT = PVP_TUNING.coyote;
      p.jumpsLeft = 2;
    } else {
      p.coyoteT = Math.max(0, p.coyoteT - dt);
    }
    if (wish.jump) {
      p.jumpBufferT = PVP_TUNING.jumpBuffer;
    } else {
      p.jumpBufferT = Math.max(0, p.jumpBufferT - dt);
    }
    if (p.jumpBufferT > 0) {
      if (p.coyoteT > 0) {
        p.vy = PVP_TUNING.jumpVel;
        p.onGround = false;
        p.coyoteT = 0;
        p.jumpBufferT = 0;
        p.jumpsLeft = 1;
        p.slideT = 0;
      } else if (p.jumpsLeft > 0) {
        p.vy = PVP_TUNING.doubleJumpVel;
        p.jumpBufferT = 0;
        p.jumpsLeft -= 1;
      }
    }
    p.vy -= PVP_TUNING.gravity * dt;
    tickGrapple(p, wish, dt);
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.z += p.vz * dt;
    const height = p.slideT > 0 ? 1 : PVP_TUNING.playerHeight;
    pushOutOfPillars(p, PVP_TUNING.playerRadius, height);
    const floorY = pillarGroundHeight(p.x, p.z, PVP_TUNING.playerRadius, p.y);
    if (p.y <= floorY) {
      p.y = floorY;
      if (p.vy < 0) p.vy = 0;
      p.onGround = true;
    } else {
      p.onGround = false;
    }
    clampToArenaBounds(p, p, PVP_TUNING.playerRadius);
  }
  function separatePlayers(players) {
    const a = players[0];
    const b = players[1];
    let dx = b.x - a.x;
    let dz = b.z - a.z;
    let dist = Math.hypot(dx, dz);
    const min = PVP_TUNING.playerRadius * 2;
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
  function snapPlayer(p) {
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
  function reserveOf(p, ammoType) {
    if (ammoType === "shells") return p.shells;
    if (ammoType === "sniper") return p.sniper;
    return 0;
  }
  function takeReserve(p, ammoType, n) {
    if (ammoType === "shells") p.shells -= n;
    else if (ammoType === "sniper") p.sniper -= n;
  }
  function canReload(p, slot) {
    const gun = STOCK_GUNS[slot];
    return gun.infiniteReserve || reserveOf(p, gun.ammoType) > 0;
  }
  function finishReload(p) {
    const gun = STOCK_GUNS[p.slot];
    const need = gun.stats.magSize - p.mag[p.slot];
    if (need <= 0) return;
    const got = gun.infiniteReserve ? need : Math.min(need, reserveOf(p, gun.ammoType));
    if (!gun.infiniteReserve) takeReserve(p, gun.ammoType, got);
    p.mag[p.slot] += got;
  }
  function weaponTick(p, wish, dt) {
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
  function traceShots(p, target, wish) {
    const hits = [];
    const gun = STOCK_GUNS[p.slot];
    const pellets = gun.stats.pellets;
    const zoom = p.zoomCancelled ? false : wish.zoom;
    const spreadRad = (zoom ? gun.stats.adsSpread : gun.stats.spread) * DEG2RAD;
    const eye = eyeOf(p);
    for (let i = 0; i < pellets; i++) {
      const jy = (randFloat(p.rng) - 0.5) * spreadRad;
      const jp = (randFloat(p.rng) - 0.5) * spreadRad;
      const dir = dirFromYawPitch(p.yaw + jy, p.pitch + jp);
      const dist = rayCapsule(eye, dir, target.x, target.z, target.y, target.y + PVP_TUNING.playerHeight, PVP_TUNING.playerRadius);
      if (dist < 0) continue;
      const cover = firstArenaSolid(eye, dir, dist, null);
      if (cover && cover.t < dist) continue;
      const fall = rangeFalloff(gun.range, dist);
      if (fall <= 0) continue;
      let dmg = gun.stats.damage * fall;
      if (randFloat(p.rng) < gun.stats.critChance) {
        dmg *= PVP_TUNING.critHitMult;
      }
      hits.push(Math.max(0, Math.round(dmg * 1e3)));
    }
    return hits;
  }
  function applyHits(target, hits, invuln) {
    if (!target.alive || invuln > 0 || hits.length === 0) return 0;
    let total = 0;
    for (let i = 0; i < hits.length; i++) {
      total += hits[i];
      let left = hits[i];
      const absorb = Math.min(target.shield, left);
      target.shield -= absorb;
      left -= absorb;
      target.hp -= left;
      target.shieldDelay = PVP_TUNING.shieldDelay;
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
  function regenShield(p, dt) {
    if (!p.alive) return;
    p.shieldDelay = Math.max(0, p.shieldDelay - dt);
    if (p.shieldDelay <= 0 && p.shield < MAX_SHIELD) {
      p.shield = Math.min(MAX_SHIELD, p.shield + Math.round(PVP_TUNING.shieldRegen * dt * 1e3));
    }
  }
  function finishMatch(state, outcome, winner, reason) {
    state.phase = "done";
    state.outcome = outcome;
    state.winner = winner;
    state.reason = reason;
    return state;
  }
  function resolveMatch(state) {
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
    if (!a.alive && !b.alive) return finishMatch(state, "draw", null, "double_ko");
    if (!a.alive) return finishMatch(state, "ko", 1, "ko");
    if (!b.alive) return finishMatch(state, "ko", 0, "ko");
    if (state.tick >= MATCH_TICKS) {
      const sa = a.hp + a.shield;
      const sb = b.hp + b.shield;
      if (sa === sb) return finishMatch(state, "draw", null, "time");
      return finishMatch(state, "time", sa > sb ? 0 : 1, "time");
    }
    return state;
  }
  function stepMatch(state, wishes, events = null) {
    if (state.phase === "done") return state;
    const frame = state.tick;
    const wish = [
      normalizeWish(state.players[0], wishes?.[0], frame),
      normalizeWish(state.players[1], wishes?.[1], frame)
    ];
    for (let i = 0; i < 2; i++) {
      if (state.players[i].alive) movePlayer(state.players[i], wish[i], DT);
    }
    separatePlayers(state.players);
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      pushOutOfPillars(p, PVP_TUNING.playerRadius, p.slideT > 0 ? 1 : PVP_TUNING.playerHeight);
      clampToArenaBounds(p, p, PVP_TUNING.playerRadius);
      snapPlayer(p);
    }
    recordHistory(state, frame + 1);
    const seen = [
      rewoundTarget(state, 1, frame, wish[0].rewind, wish[0].viewFrac),
      rewoundTarget(state, 0, frame, wish[1].rewind, wish[1].viewFrac)
    ];
    const fired = [false, false];
    const hits = [[], []];
    for (let i = 0; i < 2; i++) {
      const p = state.players[i];
      if (!p.alive || !weaponTick(p, wish[i], DT)) continue;
      fired[i] = true;
      hits[i] = traceShots(p, seen[i], wish[i]);
    }
    const dealt = [
      applyHits(state.players[1], hits[0], seen[0].invuln),
      applyHits(state.players[0], hits[1], seen[1].invuln)
    ];
    if (events) {
      for (let i = 0; i < 2; i++) {
        if (!fired[i]) continue;
        events.push({
          tick: frame,
          shooter: i,
          dmg: dealt[i],
          pellets: STOCK_GUNS[state.players[i].slot].stats.pellets,
          hits: hits[i].length,
          rewind: wish[i].rewind,
          viewFrac: wish[i].viewFrac
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
  function stateHash(state) {
    return fnv1a(stableStringify(quantizeForHash(state)));
  }
  function publicStateHash(state) {
    const scrubbed = {
      ...state,
      players: state.players.map((p) => {
        const { rng: _rng, ...rest } = p;
        return rest;
      })
    };
    return fnv1a(stableStringify(quantizeForHash(scrubbed)));
  }
  function stateSha256(state) {
    return sha256Hex(stableStringify(quantizeForHash(state)));
  }
  function snapshot(state) {
    const players = [
      snapshotPlayer(state.players[0]),
      snapshotPlayer(state.players[1])
    ];
    return {
      tick: state.tick,
      hash: stateHash(state),
      publicHash: publicStateHash(state),
      phase: state.phase,
      outcome: state.outcome,
      winner: state.winner,
      reason: state.reason,
      players
    };
  }
  function snapshotPlayer(p) {
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
      grapple: p.grapple ? { x: p.grapple.x, y: p.grapple.y, z: p.grapple.z, id: p.grapple.id } : null
    };
  }
  function scriptedMatch(seed = 7, ticks = 180) {
    const probe = createMatch(seed);
    const yaws = [probe.players[0].yaw, probe.players[1].yaw];
    const inputs = [];
    for (let i = 0; i < ticks; i++) {
      inputs.push([
        { yaw: yaws[0], pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, slot: 0 },
        { yaw: yaws[1], pitch: 0, moveX: 0, moveZ: 1, fire: true, zoom: true, slot: 0 }
      ]);
    }
    return { seed, inputs };
  }
  function replayMatch(body) {
    const spawn = body.spawnSeed ?? body.seed ?? 1;
    const combat = body.combatSeed ?? spawn;
    const state = createMatch(spawn >>> 0, typeof combat === "string" ? combat : combat >>> 0);
    const inputs = Array.isArray(body.inputs) ? body.inputs : [];
    for (let i = 0; i < inputs.length; i++) {
      stepMatch(state, inputs[i]);
      if (state.phase === "done") break;
    }
    return state;
  }

  // src/net/pvpProtocol.ts
  var OP = Object.freeze({
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
    PONG: 11
  });
  var FRAME_BYTES = INPUT_LIMITS.frameBytes;
  var ID_RE = /^[A-Za-z0-9_.:@|-]{1,80}$/;
  var HOSTILE_FIELDS = /* @__PURE__ */ new Set([
    "winner",
    "result",
    "settle",
    "earn",
    "earnTickets",
    "stake",
    "wager",
    "tickets",
    "god",
    "godMode",
    "debug",
    "refund"
  ]);
  function validId(value) {
    return typeof value === "string" && value.length <= INPUT_LIMITS.maxIdLength && ID_RE.test(value);
  }
  function hostileReason(body, depth = 0) {
    if (depth > 8) return "malformed";
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return depth === 0 ? "malformed" : null;
    }
    const obj = body;
    const keys = Object.keys(obj);
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      if (HOSTILE_FIELDS.has(key)) return "client_result";
      const val = obj[key];
      if (val && typeof val === "object") {
        if (Array.isArray(val)) {
          for (let j = 0; j < val.length; j++) {
            const item = val[j];
            if (item && typeof item === "object") {
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
  function sanitizeClientMessage(body) {
    const reason = hostileReason(body);
    if (reason !== null) return { ok: false, reason };
    return { ok: true, body };
  }
  function versionsMatch(body) {
    return !!body && body.protocol === PVP_PROTOCOL_VERSION && body.sim === PVP_SIM_VERSION && body.content === CONTENT_FINGERPRINT;
  }
  var BUTTONS = Object.freeze([
    "fire",
    "zoom",
    "sprint",
    "jump",
    "dash",
    "reload",
    "slide",
    "grapple"
  ]);
  var PvpInputError = class extends Error {
    constructor(reason) {
      super(reason);
      __publicField(this, "reason");
      this.name = "PvpInputError";
      this.reason = reason;
    }
  };
  function fail(reason) {
    throw new PvpInputError(reason);
  }
  function quantYaw(yaw) {
    if (typeof yaw !== "number" || !Number.isFinite(yaw)) fail("nan");
    if (Math.abs(yaw) > 1e6) fail("malformed");
    const wrapped = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    return Math.max(-32767, Math.min(32767, Math.round(wrapped / Math.PI * 32767)));
  }
  function quantPitch(pitch) {
    if (typeof pitch !== "number" || !Number.isFinite(pitch)) fail("nan");
    if (pitch < -Math.PI / 2 - 1e-4 || pitch > Math.PI / 2 + 1e-4) fail("malformed");
    const clamped = Math.max(-1.5, Math.min(1.5, pitch));
    return Math.round(clamped / 1.5 * 32767);
  }
  function quantMove(v) {
    if (typeof v !== "number" || !Number.isFinite(v)) fail("nan");
    if (v < -1 - 1e-6 || v > 1 + 1e-6) fail("malformed");
    const c = Math.max(-1, Math.min(1, v));
    return Math.max(-127, Math.min(127, Math.round(c * 127)));
  }
  function encodeInput(wish) {
    if (!wish || typeof wish !== "object") fail("malformed");
    if (typeof wish.seq !== "number" || !Number.isFinite(wish.seq)) fail("nan");
    if (!Number.isInteger(wish.seq) || wish.seq < 1 || wish.seq > 4294967295) fail("sequence");
    if (typeof wish.frame !== "number" || !Number.isFinite(wish.frame)) fail("nan");
    if (!Number.isInteger(wish.frame) || wish.frame < 0 || wish.frame > INPUT_LIMITS.maxFrame) fail("frame");
    const slot = wish.slot ?? -1;
    if (typeof slot !== "number" || !Number.isFinite(slot)) fail("nan");
    if (!Number.isInteger(slot) || slot < -1 || slot > 2) fail("malformed");
    let back = 0;
    if (wish.viewTick !== void 0) {
      if (typeof wish.viewTick !== "number" || !Number.isFinite(wish.viewTick)) fail("nan");
      back = wish.frame - Math.floor(wish.viewTick);
    }
    back = Math.max(0, Math.min(REWIND.maxBack, wish.frame, back));
    let frac = 0;
    if (wish.viewFrac !== void 0) {
      if (typeof wish.viewFrac !== "number" || !Number.isFinite(wish.viewFrac)) fail("nan");
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
  function decodeInput(buf) {
    if (!(buf instanceof Uint8Array) || buf.length !== FRAME_BYTES) fail("malformed");
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const seq = view.getUint32(0, true);
    const frame = view.getInt32(4, true);
    if (seq < 1) fail("sequence");
    if (frame < 0 || frame > INPUT_LIMITS.maxFrame) fail("frame");
    const yawQ = view.getInt16(8, true);
    const pitchQ = view.getInt16(10, true);
    if (yawQ < -32767 || yawQ > 32767 || pitchQ < -32767 || pitchQ > 32767) fail("malformed");
    const moveX = view.getInt8(12);
    const moveZ = view.getInt8(13);
    const buttons = view.getUint8(14);
    const slot = view.getInt8(15);
    if (slot < -1 || slot > 2) fail("malformed");
    const back = view.getUint8(16);
    const viewFrac = view.getUint8(17);
    return {
      seq,
      frame,
      viewTick: Math.max(0, frame - back),
      viewFrac,
      yaw: yawQ / 32767 * Math.PI,
      pitch: pitchQ / 32767 * 1.5,
      moveX: moveX / 127,
      moveZ: moveZ / 127,
      slot,
      fire: (buttons & 1 << 0) !== 0,
      zoom: (buttons & 1 << 1) !== 0,
      sprint: (buttons & 1 << 2) !== 0,
      jump: (buttons & 1 << 3) !== 0,
      dash: (buttons & 1 << 4) !== 0,
      reload: (buttons & 1 << 5) !== 0,
      slide: (buttons & 1 << 6) !== 0,
      grapple: (buttons & 1 << 7) !== 0
    };
  }
  function buildMatchmakerQuery(mode = "free", fingerprint = CONTENT_FINGERPRINT) {
    return matchmakerQuery(mode, fingerprint);
  }
  function matchmakerProps(mode = "free", fingerprint = CONTENT_FINGERPRINT) {
    return {
      query: buildMatchmakerQuery(mode, fingerprint),
      minCount: 2,
      maxCount: 2,
      stringProperties: {
        game: GAME_ID,
        mode,
        protocol: String(PVP_PROTOCOL_VERSION),
        sim: String(PVP_SIM_VERSION),
        content: fingerprint
      }
    };
  }

  // src/sim/pvp/export.ts
  var SOURCE_COMMIT = "d6d96cf73a5cfba1f3b7a6e65a0d16481aec176b";
  var rules = Object.freeze({
    GAME_ID,
    MATCH_NAME,
    STAGE_ID,
    TICK_HZ,
    DT,
    STEP_MS,
    MATCH_SECONDS,
    MATCH_TICKS,
    LEAD_IN_TICKS,
    PVP_PROTOCOL_VERSION,
    PVP_SIM_VERSION,
    SEATS,
    SPAWN_RADIUS,
    READY_MS,
    STALL_MS,
    REWIND,
    STOCK_LOADOUT,
    STOCK_GUNS,
    RESERVE,
    WAGER,
    INPUT_LIMITS,
    REPLAY_LIMITS,
    PVP_TUNING,
    ARENA_R,
    ARENA_WALL_H,
    PILLAR_HALF,
    PILLAR_H,
    ARENA_SOLIDS,
    CONTENT_FINGERPRINT,
    LOADOUT_HASH
  });
  return __toCommonJS(export_exports);
})();
globalThis.SprotoShooterPvp = SprotoShooterPvp;
