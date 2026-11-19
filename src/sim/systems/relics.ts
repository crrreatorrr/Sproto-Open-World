/**
 * Totems and relics at runtime: sockets, the placed totem, and the combat numbers the rest of
 * the sim asks for. Pure. Combat calls the small hooks; this file does not import them back.
 */
import { BLOCK, BUFFER, PLAYER_MOVES, ROLL } from '../../content/combat';
import { ENEMIES } from '../../content/enemies';
import { PLUNGE } from '../../content/packs/m7';
import { GEAR_LOCK_TICKS } from '../../content/progression';
import { QUESTS } from '../../content/quests';
import {
  BONUS_REWARDS, GEAR_LOCK_TEXT, HOPEGLASS_SLOWS_WORLD, KEEPSAKES, RELIC_SOCKETS, TOTEM_HOLD_TICKS,
  TOTEM_LIFE_TICKS, TOTEM_RECHARGE_TICKS, TOTEM_SWAPPED_TEXT, emptyRelics, isRelic, isTotem, keepsake,
  relicMods, totemMods, wonToast, type BonusReward, type RelicMods, type RelicProgress,
} from '../../content/relics';
import { fnv1a } from '../hash';
import type { Entity, PlacedTotem, RelicRuntime } from '../entity';
import type { SimEvent } from '../events';
import { flatDist } from '../combat/geometry';

const gearLocked = (e: Entity, now: number): boolean => !!e.combat && now - e.combat.targetedAt < GEAR_LOCK_TICKS && !e.progress?.atShrine;

interface Ctx {
  now: number;
  entities: readonly Entity[];
  events: SimEvent[];
}

const refuse = (ctx: Ctx, e: Entity, reason: string): void => {
  ctx.events.push({ type: 'refused', entity: e.id, action: 'equipRelic', reason });
};

export const relicProgress = (e: Entity): RelicProgress => {
  const p = e.progress!;
  return (p.relics ??= emptyRelics());
};

const runtime = (e: Entity): RelicRuntime => (e.relicRun ??= {
  hopeglassUntil: 0, hopeglassReadyAt: 0, coopFreezeUntil: 0, rivetReadyAt: 0, briarReadyAt: 0,
  burnImmuneUntil: 0, holdTicks: 0, totemReadyAt: 0, lanternUntil: 0, chainSeen: -1,
});

export const equippedRelics = (e: Entity): (string | null)[] => relicProgress(e).sockets;

const coopOf = (entities: readonly Entity[]): boolean => entities.filter((e) => e.kind === 'player').length > 1;

export const modsOf = (e: Entity, coop = false): RelicMods => relicMods(e.progress ? equippedRelics(e) : [], coop);

const owns = (r: RelicProgress, id: string): boolean => r.owned.includes(id);

export function grantKeepsake(ctx: Ctx, e: Entity, id: string): boolean {
  const def = keepsake(id);
  const r = e.progress ? relicProgress(e) : null;
  if (!def || !r || owns(r, id)) return false;
  r.owned.push(id);
  const first = def.kind === 'relic' && !r.introduced;
  if (first) r.introduced = true;
  ctx.events.push({ type: 'itemGained', entity: e.id, item: id, count: 1, keepsake: { kind: def.kind, first, text: wonToast(id, first) } });
  return true;
}

export function equipRelic(ctx: Ctx, e: Entity, id: string, socket?: number): void {
  const r = relicProgress(e);
  const def = keepsake(id);
  if (!def || def.kind !== 'relic' || !owns(r, id)) return refuse(ctx, e, "You don't have that.");
  if (gearLocked(e, ctx.now)) return refuse(ctx, e, GEAR_LOCK_TEXT);
  const at = r.sockets.indexOf(id);
  if (at >= 0 && socket === undefined) {
    r.sockets[at] = null;
    ctx.events.push({ type: 'relicEquipped', entity: e.id, item: null, socket: at });
    return;
  }
  const slot = socket ?? r.sockets.indexOf(null);
  if (slot < 0 || slot >= RELIC_SOCKETS) return refuse(ctx, e, 'All three relic sockets are full.');
  if (at >= 0) r.sockets[at] = null;
  r.sockets[slot] = id;
  ctx.events.push({ type: 'relicEquipped', entity: e.id, item: id, socket: slot });
}

export function clearRelic(ctx: Ctx, e: Entity, socket: number): void {
  const r = relicProgress(e);
  if (socket < 0 || socket >= r.sockets.length || !r.sockets[socket]) return;
  if (gearLocked(e, ctx.now)) return refuse(ctx, e, GEAR_LOCK_TEXT);
  r.sockets[socket] = null;
  ctx.events.push({ type: 'relicEquipped', entity: e.id, item: null, socket });
}

export function equipTotem(ctx: Ctx, e: Entity, id: string): void {
  const r = relicProgress(e);
  const def = keepsake(id);
  if (!def || def.kind !== 'totem' || !owns(r, id)) return refuse(ctx, e, "You don't have that.");
  if (gearLocked(e, ctx.now)) return refuse(ctx, e, GEAR_LOCK_TEXT);
  if (r.totem === id) {
    r.totem = null;
    ctx.events.push({ type: 'totemEquipped', entity: e.id, item: null, swapped: false });
    return;
  }
  const swapped = r.totem !== null;
  r.totem = id;
  if (swapped) ctx.events.push({ type: 'refused', entity: e.id, action: 'equipTotem', reason: TOTEM_SWAPPED_TEXT });
  ctx.events.push({ type: 'totemEquipped', entity: e.id, item: id, swapped });
}

/** Hold Interact with nothing else in reach to plant the equipped totem. */
export function holdTotem(ctx: Ctx, e: Entity, held: boolean, busy: boolean): void {
  const run = runtime(e);
  const r = e.progress ? relicProgress(e) : null;
  if (!held || busy || !r?.totem || e.combat?.action) {
    run.holdTicks = 0;
    return;
  }
  if (ctx.now < run.totemReadyAt) return;
  if (++run.holdTicks < TOTEM_HOLD_TICKS) return;
  run.holdTicks = 0;
  placeTotem(ctx, e, r.totem);
}

function placeTotem(ctx: Ctx, e: Entity, id: string): void {
  const def = keepsake(id);
  if (!def || def.kind !== 'totem') return;
  const run = runtime(e);
  const r = relicProgress(e);
  const pos = e.tf.pos;
  const life = id === 'totem_elders_seed' ? 10 * 60 : TOTEM_LIFE_TICKS;
  const placed: PlacedTotem = {
    id, age: 0, life, x: pos.x, y: pos.y, z: pos.z, drawn: false, reflectAt: ctx.now, splashed: false, lured: false, seeded: id === 'totem_elders_seed',
  };
  e.placedTotem = placed;
  run.totemReadyAt = ctx.now + TOTEM_RECHARGE_TICKS;
  if (id === 'totem_seekers_lantern') {
    run.lanternUntil = ctx.now + totemMods(id, false).lanternTicks;
    run.lanternAt = { x: pos.x, z: pos.z };
  }
  if (id === 'totem_elders_seed' && !r.seedSpent && e.progress) {
    const t = e.progress.tonics;
    if (t.charges < t.max) t.charges++;
    r.seedSpent = true;
  }
  if (id === 'totem_ember_quench_pail') splashPail(ctx, e, placed);
  if (id === 'totem_skylure_post') lureFlyer(ctx, e, placed);
  ctx.events.push({ type: 'totemPlaced', entity: e.id, item: id, pos: { x: pos.x, y: pos.y, z: pos.z } });
}

/** A shrine rest readies the totem and lets Elder's Seed refill a tonic again. */
export function onShrineRest(e: Entity, now: number): void {
  if (!e.progress) return;
  const r = relicProgress(e);
  r.seedSpent = false;
  runtime(e).totemReadyAt = now;
}

function splashPail(ctx: Ctx, _owner: Entity, placed: PlacedTotem): void {
  placed.splashed = true;
  for (const o of ctx.entities) {
    if (o.kind !== 'player' || flatDist(o.tf.pos, placed) > 6) continue;
    if (o.statuses?.burn) {
      delete o.statuses.burn;
      ctx.events.push({ type: 'statusEnd', entity: o.id, status: 'burn' });
    }
    runtime(o).burnImmuneUntil = ctx.now + 3 * 60;
  }
}

function lureFlyer(ctx: Ctx, _owner: Entity, placed: PlacedTotem): void {
  let best: Entity | null = null;
  let bestD = 30;
  for (const o of ctx.entities) {
    const def = o.brain ? ENEMIES[o.brain.def] : undefined;
    if (!def?.drake && def?.model !== 'drake') continue;
    if (o.combat?.action?.kind === 'dead') continue;
    const d = flatDist(o.tf.pos, placed);
    if (d < bestD) {
      best = o;
      bestD = d;
    }
  }
  if (!best?.brain) return;
  if (best.boss && best.boss.skylurePhase === best.boss.phase) return;
  best.brain.lowUntil = ctx.now + 2 * 60;
  if (best.boss) best.boss.skylurePhase = best.boss.phase;
  placed.lured = true;
}

/** Age placed totems, heal, and pull ordinary enemies toward a Field Warden. */
export function tickTotems(entities: readonly Entity[], now: number): void {
  for (const e of entities) {
    if (e.brain) e.brain.speedMul = 1;
  }
  for (const e of entities) {
    const placed = e.placedTotem;
    if (!placed) continue;
    placed.age++;
    if (placed.age >= placed.life) {
      delete e.placedTotem;
      continue;
    }
    const coop = coopOf(entities);
    if (placed.id === 'totem_elders_hearth' || (placed.id === 'totem_elders_seed' && placed.seeded)) {
      const radius = placed.id === 'totem_elders_hearth' ? 6 : 6;
      const perTick = (placed.id === 'totem_elders_seed' ? 0.01 : 0.01);
      for (const o of entities) {
        if (o.kind !== 'player' || !o.vitals || flatDist(o.tf.pos, placed) > radius) continue;
        o.vitals.hp = Math.min(o.vitals.hpMax, o.vitals.hp + o.vitals.hpMax * perTick / 60);
      }
    }
    if (placed.id === 'totem_field_warden' && !placed.drawn && placed.age <= 4 * 60) {
      for (const o of entities) {
        const def = o.brain ? ENEMIES[o.brain.def] : undefined;
        if (!o.brain || !def || def.elite || o.boss || o.kind === 'boss') continue;
        if (flatDist(o.tf.pos, placed) > 10) continue;
        o.brain.lure = { x: placed.x, z: placed.z, until: now + 8 };
      }
      if (placed.age === 4 * 60) placed.drawn = true;
    }
    if (placed.id === 'totem_earthspeaker_stake') {
      const mods = totemMods(placed.id, coop);
      for (const o of entities) {
        if (!o.brain || o.kind === 'player' || flatDist(o.tf.pos, placed) > 12) continue;
        o.brain.speedMul = mods.moveMul;
      }
    }
  }
}

/** True on ticks the world should not advance (Hopeglass). Solo: every other tick. Co-op: a short extra freeze. */
export function relicSlowTick(entities: readonly Entity[], now: number): boolean {
  const players = entities.filter((e) => e.kind === 'player');
  if (players.length !== 1) {
    return players.some((p) => (p.relicRun?.coopFreezeUntil ?? 0) > now);
  }
  const run = players[0].relicRun;
  if (!run || !HOPEGLASS_SLOWS_WORLD || now >= run.hopeglassUntil) return false;
  return now % 2 === 1;
}

export function onRelicParry(ctx: Ctx, player: Entity): void {
  const coop = coopOf(ctx.entities);
  const mods = modsOf(player, coop);
  if (!mods.hopeglass) return;
  const run = runtime(player);
  if (ctx.now < run.hopeglassReadyAt) return;
  run.hopeglassReadyAt = ctx.now + mods.hopeglass.cooldown;
  if (!coop && HOPEGLASS_SLOWS_WORLD) run.hopeglassUntil = ctx.now + mods.hopeglass.slowTicks;
  else run.coopFreezeUntil = ctx.now + mods.hopeglass.coopHitstop;
}

/** The parry window still open on this block, after Coins and the Grip. */
export function parryWindowTicks(e: Entity, action: { parryTicks: number }): number {
  const c = e.combat;
  if (!c) return action.parryTicks;
  const coop = false;
  const mods = modsOf(e, coop);
  const mashed = c.blockPressTicks <= BLOCK.spamParryTicks;
  const base = mashed ? BLOCK.spamParryTicks : BLOCK.parryTicks;
  const want = mashed ? mods.spamParryTicks : mods.parryTicks;
  return action.parryTicks + (want - base);
}

export function rollFrames(e: Entity, action: { back?: boolean }): { iframeStart: number; iframeEnd: number; perfectEnd: number } {
  const base = action.back ? { iframeStart: 2, iframeEnd: 8, perfectEnd: 5 } : { iframeStart: ROLL.iframeStart, iframeEnd: ROLL.iframeEnd, perfectEnd: ROLL.perfectEnd };
  if (action.back) return base;
  const mods = modsOf(e, false);
  return { iframeStart: base.iframeStart, iframeEnd: mods.iframeEnd, perfectEnd: mods.perfectEnd };
}

export const inRollFrames = (e: Entity, action: { back?: boolean; t: number } | null | undefined): boolean => {
  if (!action) return false;
  const f = rollFrames(e, action);
  return action.t >= f.iframeStart && action.t <= f.iframeEnd;
};

export const sprintDrain = (e: Entity): number => (e.progress ? modsOf(e).sprintPerSec : 0);

export const plungeRecoveryOf = (e: Entity): number => Math.max(1, Math.round(PLUNGE.recovery * (e.progress ? modsOf(e).plungeLagMul : 1)));

export function lengthenBuffer(e: Entity, now: number): void {
  const c = e.combat;
  if (!c || !e.progress) return;
  const mods = modsOf(e);
  const buf = c.buffer;
  if (buf && buf.action !== 'dodge' && !buf.relic) {
    buf.ttl += mods.attackBuffer - BUFFER.attackTicks;
    buf.relic = true;
  }
  if (c.comboUntil !== runtime(e).chainSeen) {
    if (c.comboUntil === now + BUFFER.chainGrace) c.comboUntil += mods.chainGrace - BUFFER.chainGrace;
    runtime(e).chainSeen = c.comboUntil ?? -1;
  }
}

/** Deterministic proc. The same tick, entity and salt always agree. */
export const proc = (now: number, id: number, salt: number, chance: number): boolean => {
  if (chance <= 0) return false;
  return ((fnv1a(`${salt}:${id}:${now}`) >>> 0) / 4294967296) < chance;
};

export function tryGuardCounter(ctx: Ctx, player: Entity, attacker: Entity, melee: boolean): boolean {
  if (!melee || !player.combat || !player.progress) return false;
  const mods = modsOf(player);
  const run = runtime(player);
  if (ctx.now < run.rivetReadyAt) return false;
  if (!proc(ctx.now, player.id, 1, mods.guardCounterChance)) return false;
  run.rivetReadyAt = ctx.now + mods.guardCounterCd;
  const def = PLAYER_MOVES.guardCounter;
  const dx = attacker.tf.pos.x - player.tf.pos.x;
  const dz = attacker.tf.pos.z - player.tf.pos.z;
  const d = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / d, z: dz / d };
  player.tf.yaw = Math.atan2(dir.x, dir.z);
  player.combat.action = {
    kind: 'attack', move: 'guardCounter', t: 0, clipT: def.entry, charge: 0, charging: false, charged: false, hit: [],
    lunge: 0, lungeDir: dir, lungeTarget: attacker.id, lungeLeft: def.lungeMax ?? 1.5,
  };
  player.combat.guardCounterUntil = 0;
  ctx.events.push({ type: 'swing', entity: player.id, move: 'guardCounter', heavy: true });
  return true;
}

export function tryBriar(ctx: Ctx, player: Entity, unblockable: boolean, boss: boolean): boolean {
  if (unblockable || boss || !player.progress) return false;
  const mods = modsOf(player);
  const run = runtime(player);
  if (ctx.now < run.briarReadyAt) return false;
  if (!proc(ctx.now, player.id, 2, mods.briarChance)) return false;
  run.briarReadyAt = ctx.now + mods.briarCd;
  return true;
}

export const burnBlocked = (e: Entity, now: number): boolean => now < (e.relicRun?.burnImmuneUntil ?? 0);

export const blockStaminaMul = (e: Entity): number => (e.progress ? modsOf(e).blockStaminaMul : 1);

/** A Turnstone in range that is ready to turn this shot around. */
export function turnstoneReady(entities: readonly Entity[], at: { x: number; y: number; z: number }, now: number, wardUp: boolean): Entity | null {
  if (wardUp) return null;
  for (const e of entities) {
    const placed = e.placedTotem;
    if (!placed || placed.id !== 'totem_turnstone' || now < placed.reflectAt) continue;
    if (flatDist(at, placed) <= 5 && Math.abs(at.y - placed.y) < 3) return e;
  }
  return null;
}

export function turnstoneSpent(e: Entity, now: number, coop: boolean): void {
  const placed = e.placedTotem;
  if (!placed) return;
  placed.reflectAt = now + totemMods(placed.id, coop).reflectEvery;
}

const stepIs = (e: Entity, quest: string, step: string): boolean => {
  const q = e.progress?.quests[quest];
  if (q?.status !== 'active') return false;
  return QUESTS[quest]?.steps[q.step]?.id === step;
};

const tagHits = (bonus: BonusReward, defId: string | undefined, tags: readonly string[] | undefined): boolean =>
  !!defId && (defId === bonus.tag || tags?.includes(bonus.tag) === true);

export function noteReflectKill(ctx: Ctx, e: Entity, victim: Entity, sourceMove: string | undefined): void {
  if (!e.progress) return;
  const r = relicProgress(e);
  const def = victim.brain ? ENEMIES[victim.brain.def] : undefined;
  for (const bonus of BONUS_REWARDS) {
    if (bonus.feat !== 'reflectKill' || !stepIs(e, bonus.quest, bonus.step)) continue;
    if (bonus.sourceMove && bonus.sourceMove !== sourceMove) continue;
    if (!tagHits(bonus, def?.id, def?.tags)) continue;
    r.bonus[bonus.id] = (r.bonus[bonus.id] ?? 0) + 1;
    if (r.bonus[bonus.id] >= bonus.count) grantKeepsake(ctx, e, bonus.id);
  }
}

export function notePerfectDodge(ctx: Ctx, e: Entity, attacker: Entity): void {
  if (!e.progress) return;
  const def = attacker.brain ? ENEMIES[attacker.brain.def] : undefined;
  if (def?.id !== 'hollow_giant' && !def?.tags?.includes('hollow_giant')) return;
  const r = relicProgress(e);
  r.giantDodges++;
  const bonus = BONUS_REWARDS.find((b) => b.feat === 'perfectDodge');
  if (bonus && r.giantDodges >= bonus.count && stepIs(e, bonus.quest, bonus.step)) grantKeepsake(ctx, e, bonus.id);
}

export function settleRelicBonuses(ctx: Ctx, e: Entity): void {
  if (!e.progress) return;
  const r = relicProgress(e);
  for (const bonus of BONUS_REWARDS) {
    if (owns(r, bonus.id) || !stepIs(e, bonus.quest, bonus.step)) continue;
    const n = bonus.feat === 'perfectDodge' ? r.giantDodges : (r.bonus[bonus.id] ?? 0);
    if (n >= bonus.count) grantKeepsake(ctx, e, bonus.id);
  }
  for (const ev of ctx.events) {
    if (ev.type !== 'death') continue;
    const dead = ctx.entities.find((x) => x.id === ev.entity);
    const def = dead?.brain ? ENEMIES[dead.brain.def] : undefined;
    if (def?.id === 'hollow_giant') r.giantDodges = 0;
  }
}

/** Fallback givers: the later quest's reward list names the id, and grant is earn-once. */
export const fallbackIds = (quest: string): string[] => BONUS_REWARDS.filter((b) => b.fallbackQuest === quest).map((b) => b.id);

/** Drop sockets and owned ids the catalog no longer has. */
export function reconcileRelics(r: RelicProgress): RelicProgress {
  const known = new Set(KEEPSAKES.map((k) => k.id));
  const owned = r.owned.filter((id) => known.has(id));
  const sockets = Array.from({ length: RELIC_SOCKETS }, (_, i) => {
    const id = r.sockets[i] ?? null;
    return id && owned.includes(id) && isRelic(id) ? id : null;
  });
  const totem = r.totem && owned.includes(r.totem) && isTotem(r.totem) ? r.totem : null;
  const bonus: Record<string, number> = {};
  for (const [id, n] of Object.entries(r.bonus)) if (known.has(id) && Number.isInteger(n) && n >= 0) bonus[id] = n;
  return { ...r, owned, sockets, totem, bonus };
}

export const validRelicProgress = (v: unknown): v is RelicProgress => {
  if (!v || typeof v !== 'object') return false;
  const r = v as RelicProgress;
  return Array.isArray(r.sockets) && r.sockets.length === RELIC_SOCKETS && r.sockets.every((x) => x === null || typeof x === 'string')
    && (r.totem === null || typeof r.totem === 'string') && Array.isArray(r.owned) && r.owned.every((x) => typeof x === 'string')
    && typeof r.seedSpent === 'boolean' && typeof r.introduced === 'boolean'
    && typeof r.giantDodges === 'number' && Number.isInteger(r.giantDodges) && r.giantDodges >= 0
    && !!r.bonus && typeof r.bonus === 'object';
};
