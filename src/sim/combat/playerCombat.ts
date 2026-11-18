import {
  AIM, BLOCK, BUFFER, CHARGE, LUNGE, PLAYER_MOVES, PLAYER_STATS, ROLL, SOFT_TARGET, SWING_STEER, clipReach, clipTiming, type PlayerMoveDef, type PlayerMoveId,
} from '../../content/combat';
import { TONIC } from '../../content/items';
import { TRAIT } from '../../content/packs/c2';
import { POWER } from '../../content/packs/c3';
import { BACKSTEP, dodgeFrames } from '../../content/packs/m7';
import { CAST_WALK_SCALE } from '../../content/spells';
import { charmOf } from '../systems/rpg';
import { slotSpell } from '../systems/loadout';
import { DT, MOVE } from '../../content/tuning';
import { BTN, idleInput, type CommandMap, type InputCommand } from '../commands';
import type { Action, Buffered, BufferedAction, Entity } from '../entity';
import type { SimEvent } from '../events';
import { turnToward, wrapAngle } from '../math';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import { aimSwingDir, resolveAim } from './aim';
import { angleTo, flatDist, yawTo } from './geometry';
import { advancePlunge, plungeCancels, plungeMotion, tryPlunge } from './plunge';
import { advanceCast, castFacing, startCast, type SpawnSpellProjectile } from './spells';
import { brawlerChains, tryBlink } from './staffTraits';

/** Per-tick motion an action asks for: planar velocity (m/s), and whether input steers it. */
export interface Motion {
  vx: number;
  vz: number;
  /** Input still moves the entity (blocking walk), scaled by this. 0 = input ignored. */
  inputScale: number;
  /** Face this yaw while moving freely (lock-on strafing). */
  faceYaw?: number;
}

export interface CombatCtx {
  now: number;
  entities: readonly Entity[];
  get(id: number): Entity | undefined;
  events: SimEvent[];
  motion: Map<number, Motion>;
  /** Entities frozen by hit-stop this tick. */
  frozen: Set<number>;
}

/** World-space wish direction from a command (camera-relative stick), magnitude 0..1. */
export function wishDir(cmd: InputCommand): { x: number; z: number; mag: number } {
  const sy = Math.sin(cmd.camYaw), cy = Math.cos(cmd.camYaw);
  let mx = cmd.move.x, my = cmd.move.y;
  const len = Math.hypot(mx, my);
  const mag = Math.min(1, len);
  if (len > 1e-4) {
    mx = (mx / len) * mag;
    my = (my / len) * mag;
  }
  return { x: -cy * mx + sy * my, z: sy * mx + cy * my, mag };
}

export function inHitstopOrStun(a: Action | null): boolean {
  return a?.kind === 'hitstun' || a?.kind === 'stagger' || a?.kind === 'frozen' || a?.kind === 'dead';
}

/** Is the entity invulnerable this tick (roll or backstep i-frames, or a blink)? */
export function iframes(a: Action | null): boolean {
  return a?.kind === 'blink' || (a?.kind === 'dodge' && a.t >= dodgeFrames(a).iframeStart && a.t <= dodgeFrames(a).iframeEnd);
}

/** Light attacks a spell may cancel from activeEnd (plan §4.4: never a heavy). */
const LIGHTS = new Set<string>(['light1', 'light2', 'light3', 'light4', 'rollAttack', 'sprintLight', 'counterLight']);
const SPELL_BUTTONS = [BTN.spell1, BTN.spell2, BTN.spell3, BTN.spell4] as const;

/** Player moves: buffer presses, advance the current action, start the next one (plan §4.2–4.4). */
export function playerCombat(ctx: CombatCtx, commands: CommandMap, physics: PhysicsWorld, spawn: SpawnSpellProjectile): void {
  for (const p of ctx.entities) {
    const c = p.combat;
    const v = p.vitals;
    if (!c || !v || p.owner === undefined || p.kind !== 'player') continue;
    const cmd = commands.get(p.owner) ?? idleInput(p.tf.yaw);
    const frozen = ctx.frozen.has(p.id);

    if (c.action?.kind === 'dead') {
      if (!frozen) c.action.t++;
      continue;
    }

    noteBlockPress(p, cmd, ctx);
    bufferPresses(p, cmd, frozen);
    if (frozen) {
      // Hit-stop: nothing advances (action, buffer clock), but presses were recorded above.
      ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: 0 });
      continue;
    }

    for (const k of Object.keys(c.cooldowns) as (keyof typeof c.cooldowns)[]) if (c.cooldowns[k]! > 0) c.cooldowns[k]!--;
    if (c.action?.kind === 'cast') advanceCast(ctx, p, cmd, physics, spawn);
    else if (c.action?.kind === 'plunge') advancePlunge(ctx, p, physics);
    else advance(p, cmd, ctx);
    tryConsume(p, cmd, ctx, physics);
    updateBlock(p, cmd, ctx);
    tickBuffer(c);
    setMotion(p, cmd, ctx);
  }
}

/**
 * The parry window runs from the moment block goes down, even if the guard can't rise yet (a press
 * late in a recovery still counts). Mashing it shortens the window.
 */
function noteBlockPress(p: Entity, cmd: InputCommand, ctx: CombatCtx): void {
  const c = p.combat!;
  const held = (cmd.held & BTN.block) !== 0;
  if (held && !c.blockHeld) {
    c.blockPressTicks = ctx.now - c.lastBlockTick < BLOCK.spamWindow ? BLOCK.spamParryTicks : BLOCK.parryTicks;
    c.lastBlockTick = ctx.now;
  }
  c.blockHeld = held;
}

function bufferPresses(p: Entity, cmd: InputCommand, frozen: boolean): void {
  const c = p.combat!;
  if (inHitstopOrStun(c.action)) return; // presses during hitstun or stagger are dropped
  let pressed: BufferedAction | null = null;
  // Dodge wins a same-tick tie: it is never replaced by an attack pressed in the same tick.
  if (cmd.pressed & BTN.dodge) pressed = 'dodge';
  else if (cmd.pressed & BTN.heavy) pressed = 'heavy';
  else if (cmd.pressed & BTN.light) pressed = 'light';
  else {
    const i = SPELL_BUTTONS.findIndex((b) => (cmd.pressed & b) !== 0);
    if (i >= 0) pressed = `spell${i + 1}` as BufferedAction;
  }
  if (!pressed) return;
  const a = c.action;
  let untilCancel = false;
  if (pressed !== 'dodge' && a?.kind === 'attack') {
    const def = PLAYER_MOVES[a.move as PlayerMoveId];
    // Presses are read before this tick's advance: unless frozen, the action is about to be on clipT + 1.
    const clipNow = frozen ? a.clipT : a.clipT + 1;
    if (def && clipNow >= clipTiming(def.clip).activeStart - BUFFER.earlyHold) untilCancel = true;
  }
  c.buffer = { action: pressed, ttl: pressed === 'dodge' ? BUFFER.dodgeTicks : BUFFER.attackTicks, untilCancel } satisfies Buffered;
}

function tickBuffer(c: NonNullable<Entity['combat']>): void {
  const b = c.buffer;
  if (!b || b.untilCancel) return;
  b.ttl--;
  if (b.ttl <= 0) c.buffer = null;
}

function advance(p: Entity, cmd: InputCommand, ctx: CombatCtx): void {
  const c = p.combat!;
  const a = c.action;
  if (!a) return;
  switch (a.kind) {
    case 'attack': {
      const def = PLAYER_MOVES[a.move as PlayerMoveId];
      const tm = clipTiming(def.clip);
      const heavyHeld = (cmd.held & BTN.heavy) !== 0;
      if (a.charging) {
        a.charge++;
        if (!heavyHeld || a.charge >= CHARGE.max) {
          a.charging = false;
          a.charged = a.charge >= CHARGE.full;
        }
        a.t++;
        // The clip holds at the end of the charge window while charging.
        if (a.clipT < tm.chargeEnd - 1) a.clipT++;
        return;
      }
      a.t++;
      // A faster move covers two clip ticks on some sim ticks, so the clip stays on whole ticks.
      const steps = def.rate ? Math.floor(a.t * def.rate) - Math.floor((a.t - 1) * def.rate) : 1;
      for (let i = 0; i < steps; i++) {
        a.clipT++;
        if (def.chargeable && heavyHeld && a.clipT === tm.chargeStart && a.charge === 0) a.charging = true;
        if (a.clipT === tm.activeStart) ctx.events.push({ type: 'swing', entity: p.id, move: a.move, heavy: def.mv >= 2 });
        if (a.clipT >= tm.end) {
          c.action = null;
          c.comboFrom = a.move as PlayerMoveId;
          c.comboUntil = ctx.now + BUFFER.chainGrace;
          return;
        }
      }
      return;
    }
    case 'dodge':
      a.t++;
      if (a.t >= dodgeFrames(a).ticks) c.action = null;
      return;
    case 'blink':
      a.t++;
      if (a.t >= TRAIT.blink.ticks) c.action = null;
      return;
    case 'block':
      a.t++;
      return;
    case 'drink': {
      // A Sprout Tonic: heal over TONIC.healTicks, locked until TONIC.lockTicks (punishable).
      a.t++;
      const v = p.vitals!;
      if (a.t <= TONIC.healTicks) v.hp = Math.min(v.hpMax, v.hp + a.healPerTick);
      if (a.t >= TONIC.lockTicks) c.action = null;
      return;
    }
    case 'hitstun':
    case 'stagger':
      a.t++;
      if (a.t >= a.dur) c.action = null;
      return;
    default:
      return;
  }
}

/** Use the buffered press on the first tick it is legal. */
function tryConsume(p: Entity, cmd: InputCommand, ctx: CombatCtx, physics: PhysicsWorld): void {
  const c = p.combat!;
  const b = c.buffer;
  if (!b) return;
  const a = c.action;
  if (b.action === 'dodge') {
    const legal = !a || a.kind === 'block' || (a.kind === 'plunge' && plungeCancels(a)) || (a.kind === 'attack' && a.clipT >= dodgeCancelFrom(a));
    if (!legal) return;
    c.buffer = null;
    if (p.vitals!.stamina <= 0) {
      ctx.events.push({ type: 'noStamina', entity: p.id });
      return;
    }
    startRoll(p, cmd, ctx, physics);
    return;
  }
  if (b.action.startsWith('spell')) {
    // Spells: from free, from a block, or cancelling a light's recovery from activeEnd.
    const legal = !a || a.kind === 'block' || (a.kind === 'attack' && LIGHTS.has(a.move as string) && a.clipT >= clipTiming(PLAYER_MOVES[a.move as PlayerMoveId].clip).activeEnd);
    if (!legal) return;
    c.buffer = null;
    // The loadout decides what each slot casts (expansion plan §1.4).
    const slot = Number(b.action.slice(5)) - 1;
    const spell = slotSpell(p, slot);
    if (spell) startCast(ctx, p, spell);
    else ctx.events.push({ type: 'refused', entity: p.id, action: 'cast', reason: `No power in slot ${slot + 1}. Equip one in the Powers tab.` });
    return;
  }
  // A heavy pressed while falling from a height is a plunge attack.
  if (b.action === 'heavy' && !a && !p.riding && tryPlunge(ctx, p, physics)) {
    c.buffer = null;
    return;
  }
  // Light or heavy.
  let move: PlayerMoveId | null;
  const counter = counterMove(p, b.action, ctx);
  // A riposte or guard counter on offer beats every other heavy: the player earned it with the guard.
  const reply = b.action !== 'heavy' ? null : ctx.now < c.riposteUntil ? 'riposte' : ctx.now < c.guardCounterUntil ? 'guardCounter' : null;
  if (reply && (!a || a.kind === 'block')) {
    move = reply;
  } else if (counter && (!a || a.kind === 'block' || (a.kind === 'dodge' && a.t > dodgeFrames(a).perfectEnd))) {
    move = counter;
  } else if (!a || a.kind === 'block') {
    move = (a ? null : freeOpener(p, b.action, ctx)) ?? (b.action === 'light' ? 'light1' : 'heavy');
  } else if (a.kind === 'attack') {
    if (a.clipT < chainFrom(a)) return;
    move = chainMove(p, a.move as PlayerMoveId, b.action);
    if (b.action === 'heavy' && ctx.now < c.riposteUntil) move = 'riposte';
  } else if (a.kind === 'dodge') {
    if (a.t < dodgeFrames(a).attackFrom) return;
    move = b.action === 'light' ? 'rollAttack' : 'heavy';
  } else if (a.kind === 'plunge') {
    if (!plungeCancels(a)) return;
    move = b.action === 'light' ? 'light1' : 'heavy';
  } else return;
  if (!move) return;
  c.buffer = null;
  if (p.vitals!.stamina <= 0) {
    ctx.events.push({ type: 'noStamina', entity: p.id });
    return;
  }
  startAttack(p, move, cmd, ctx, physics);
}

type AttackAction = Extract<Action, { kind: 'attack' }>;

/** The clip tick a dodge may cancel this swing from: its active frames always play out, a whiff longer. */
function dodgeCancelFrom(a: AttackAction): number {
  const def = PLAYER_MOVES[a.move as PlayerMoveId];
  return clipTiming(def.clip).activeEnd + (a.connected ? 0 : (def.whiffLock ?? 0));
}

/** The clip tick the next attack of the string may start from: a little sooner when this one connected. */
function chainFrom(a: AttackAction): number {
  const tm = clipTiming(PLAYER_MOVES[a.move as PlayerMoveId].clip);
  return a.connected ? Math.max(tm.activeEnd, tm.cancel - BUFFER.hitChainEarly) : tm.cancel;
}

/** What a press chains into from `from`. */
function chainMove(p: Entity, from: PlayerMoveId, press: BufferedAction): PlayerMoveId | null {
  const next = PLAYER_MOVES[from].next;
  return (press === 'light' ? (brawlerChains(p, from) ? 'light4' : next?.light) : next?.heavy) ?? null;
}

/** The counter a press becomes just after a perfect dodge (a riposte, when one is open, goes first). */
function counterMove(p: Entity, press: BufferedAction, ctx: CombatCtx): PlayerMoveId | null {
  const c = p.combat!;
  if (ctx.now >= (c.counterUntil ?? 0) || (press === 'heavy' && ctx.now < c.riposteUntil)) return null;
  return press === 'light' ? 'counterLight' : 'counterHeavy';
}

/** Is the player on foot and running at sprint pace (or just letting go of it)? */
function carriesSprint(p: Entity): boolean {
  const l = p.loco;
  return !p.riding && !!l?.grounded && (l.sprinting || l.speed > MOVE.runSpeed + LUNGE.sprintCarry);
}

/** An attack from free: out of a sprint, or the next hit of the string that has only just finished. */
function freeOpener(p: Entity, press: BufferedAction, ctx: CombatCtx): PlayerMoveId | null {
  const c = p.combat!;
  if (press === 'heavy' && ctx.now < c.riposteUntil) return null;
  if (carriesSprint(p)) return press === 'light' ? 'sprintLight' : 'sprintHeavy';
  return c.comboFrom && ctx.now < (c.comboUntil ?? 0) ? chainMove(p, c.comboFrom, press) : null;
}

/** The clip tick a move's lunge stops at: a driving strike carries on through its active frames. */
const lungeEnd = (def: PlayerMoveDef): number => {
  const tm = clipTiming(def.clip);
  return def.drive ? tm.activeEnd : tm.activeStart;
};

/** Sim ticks from clip tick `from` until the lunge stops. */
const lungeTicks = (def: PlayerMoveDef, from: number): number => Math.max(1, Math.ceil((lungeEnd(def) - from) / (def.rate ?? 1)));

/** Sim ticks from clip tick `from` until a lunge at a target should be in reach: a driving strike arrives mid-swing. */
function closeTicks(def: PlayerMoveDef, from: number): number {
  const tm = clipTiming(def.clip);
  const by = def.drive ? Math.ceil((tm.activeStart + tm.activeEnd) / 2) : tm.activeStart;
  return Math.max(1, Math.ceil((by - from) / (def.rate ?? 1)));
}

/** How far from the target's centre the swing should stop: its body, less the staff's real reach. */
const lungeGap = (def: PlayerMoveDef, target: Entity, d: number): number => d - (target.body?.radius ?? 0) - clipReach(def.clip) + LUNGE.overlap;

/** Best enemy for a soft target: locked target, else the nearest in a cone of the input or facing. */
function softTarget(p: Entity, cmd: InputCommand, ctx: CombatCtx, swing?: { x: number; z: number }, onCrosshair?: Entity | null): Entity | null {
  const c = p.combat!;
  if (c.lock !== null) {
    const t = ctx.get(c.lock);
    if (t && t.combat?.action?.kind !== 'dead') return t;
  }
  if (swing) return crosshairTarget(p, ctx, swing, onCrosshair ?? null);
  const w = wishDir(cmd);
  const yaw = w.mag > 0.2 ? Math.atan2(w.x, w.z) : p.tf.yaw;
  let best: Entity | null = null;
  let bestScore = Infinity;
  const half = (SOFT_TARGET.coneDeg * Math.PI) / 360;
  for (const e of ctx.entities) {
    if (!e.combat || e.combat.team === c.team || !e.body || e.combat.action?.kind === 'dead') continue;
    const d = flatDist(p.tf.pos, e.tf.pos) - e.body.radius;
    if (d > SOFT_TARGET.meleeRange) continue;
    const ang = angleTo(p.tf.pos, yaw, e.tf.pos);
    if (ang > half && d > 1.2) continue; // very close enemies count from any angle
    const score = d + ang * 2;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** The enemy a swing at the crosshair goes for: the one under it, else the best in a cone around it. */
function crosshairTarget(p: Entity, ctx: CombatCtx, swing: { x: number; z: number }, onCrosshair: Entity | null): Entity | null {
  const inReach = (e: Entity) => flatDist(p.tf.pos, e.tf.pos) - e.body!.radius <= SOFT_TARGET.meleeRange;
  if (onCrosshair && inReach(onCrosshair)) return onCrosshair;
  const yaw = Math.atan2(swing.x, swing.z);
  const half = (AIM.meleeConeDeg * Math.PI) / 360;
  let best: Entity | null = null;
  let bestScore = Infinity;
  for (const e of ctx.entities) {
    if (!e.combat || e.combat.team === p.combat!.team || !e.body || e.combat.action?.kind === 'dead' || !inReach(e)) continue;
    const ang = angleTo(p.tf.pos, yaw, e.tf.pos);
    if (ang > half) continue;
    const score = flatDist(p.tf.pos, e.tf.pos) + ang * 2;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

function startAttack(p: Entity, move: PlayerMoveId, cmd: InputCommand, ctx: CombatCtx, physics: PhysicsWorld): void {
  const c = p.combat!;
  const v = p.vitals!;
  const def = PLAYER_MOVES[move];
  v.stamina = Math.max(0, v.stamina - def.stamina);
  v.staminaDelay = PLAYER_STATS.staminaDelay;
  // A riposte goes for the enemy the parry stunned, whatever else is near.
  const stunned = move === 'riposte' && c.riposteTarget !== null ? ctx.get(c.riposteTarget) : undefined;
  if (move === 'riposte') c.riposteUntil = 0;
  c.guardCounterUntil = 0;
  if (move === 'counterLight' || move === 'counterHeavy') c.counterUntil = 0;
  // Committed: the stun holds through the swing's last active tick (brains run before hits land).
  const stun = stunned?.combat?.action;
  if (stun?.kind === 'stagger' && (stun.reason === 'parried' || stun.reason === 'broken')) stun.dur = Math.max(stun.dur, stun.t + BLOCK.riposteReach + 1);
  const w = wishDir(cmd);
  // Pushing the stick swings that way; with the stick at rest the swing goes to the screen's centre.
  const aimed = cmd.aim && w.mag <= 0.2 ? resolveAim(ctx.entities, physics, p, cmd.aim) : null;
  const swing = cmd.aim && aimed ? aimSwingDir(p, cmd.aim, aimed.point) : undefined;
  const inReach = stunned?.body && stunned.combat?.action?.kind !== 'dead' && flatDist(p.tf.pos, stunned.tf.pos) - stunned.body.radius <= SOFT_TARGET.meleeRange;
  const target = inReach ? stunned! : softTarget(p, cmd, ctx, swing, aimed?.target);
  let dir = swing ?? { x: Math.sin(p.tf.yaw), z: Math.cos(p.tf.yaw) };
  if (target) {
    const dx = target.tf.pos.x - p.tf.pos.x, dz = target.tf.pos.z - p.tf.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 1e-4) dir = { x: dx / d, z: dz / d };
  } else if (!swing && w.mag > 0.2) {
    dir = { x: w.x / w.mag, z: w.z / w.mag };
    p.tf.yaw = Math.atan2(dir.x, dir.z); // attacks go where you push, without a target
  }
  // Aimed swings turn to the crosshair at once: the hit must land where the player is looking.
  if (swing) p.tf.yaw = p.tf.prevYaw = Math.atan2(dir.x, dir.z);
  c.action = {
    kind: 'attack', move, t: 0, clipT: def.entry, charge: 0, charging: false, charged: false, hit: [],
    // With a target the lunge is worked out tick by tick (setMotion), so it follows a moving enemy.
    lunge: target ? 0 : freeLunge(def, def.entry),
    lungeDir: dir,
    ...(target ? { lungeTarget: target.id, lungeLeft: def.lungeMax ?? LUNGE.max } : {}),
  };
}

/** Metres per tick of a swing with nobody to lunge at. */
const freeLunge = (def: PlayerMoveDef, from: number): number => (def.drive ?? LUNGE.noTarget) / lungeTicks(def, from);

/**
 * The swing's wind-up: the stick turns it, a soft target pulls it round, and the lunge closes on where
 * the target is now. Returns the metres to travel this tick. Nothing here runs once the swing is active.
 */
function steerSwing(p: Entity, a: AttackAction, def: PlayerMoveDef, cmd: InputCommand, ctx: CombatCtx): number {
  const c = p.combat!;
  const startup = a.clipT < clipTiming(def.clip).activeStart;
  let target = a.lungeTarget !== undefined ? ctx.get(a.lungeTarget) : undefined;
  if (target?.combat?.action?.kind === 'dead') target = undefined;
  const w = wishDir(cmd);
  // In the saddle the stick steers the bull, not the swing.
  if (startup && c.lock === null && !p.riding && w.mag > SWING_STEER.minStick) {
    const stick = Math.atan2(w.x, w.z);
    const release = (SWING_STEER.releaseDeg * Math.PI) / 180;
    if (target && Math.abs(wrapAngle(yawTo(p.tf.pos, target.tf.pos) - stick)) > release) target = undefined;
    if (!target) {
      const yaw = turnToward(Math.atan2(a.lungeDir.x, a.lungeDir.z), stick, SWING_STEER.turnRate * DT);
      a.lungeDir = { x: Math.sin(yaw), z: Math.cos(yaw) };
    }
  }
  if (a.lungeTarget !== undefined && !target) {
    // The target is gone (dead, or steered away from): carry on as a swing with nobody to lunge at.
    delete a.lungeTarget;
    delete a.lungeLeft;
    a.lunge = freeLunge(def, a.clipT);
  }
  if (!target) return a.lunge;
  const dx = target.tf.pos.x - p.tf.pos.x, dz = target.tf.pos.z - p.tf.pos.z;
  const d = Math.hypot(dx, dz);
  if (startup && d > 1e-4) a.lungeDir = { x: dx / d, z: dz / d };
  const left = a.lungeLeft ?? 0;
  const step = Math.max(0, Math.min(left, lungeGap(def, target, d))) / closeTicks(def, a.clipT);
  a.lungeLeft = left - step;
  return step;
}

function startRoll(p: Entity, cmd: InputCommand, ctx: CombatCtx, physics: PhysicsWorld): void {
  const c = p.combat!;
  const v = p.vitals!;
  // Quick Step makes rolls and backsteps cheaper.
  const k = p.progress ? (charmOf(p.progress)?.dodgeStamina ?? 1) : 1;
  const w = wishDir(cmd);
  const neutral = w.mag <= 0.2;
  const dir = neutral ? { x: Math.sin(p.tf.yaw), z: Math.cos(p.tf.yaw) } : { x: w.x / w.mag, z: w.z / w.mag };
  p.tf.yaw = Math.atan2(dir.x, dir.z);
  const blinked = tryBlink(ctx, p, cmd, dir, physics);
  const back = neutral && !blinked;
  v.stamina = Math.max(0, v.stamina - (back ? BACKSTEP.stamina : ROLL.stamina) * k);
  v.staminaDelay = PLAYER_STATS.dodgeDelay;
  if (blinked) return;
  if (back) {
    // No direction: hop straight back, still facing the lock target if there is one.
    const lock = c.lock !== null ? ctx.get(c.lock) : undefined;
    if (lock) p.tf.yaw = yawTo(p.tf.pos, lock.tf.pos);
    c.action = { kind: 'dodge', t: 0, dir: { x: -Math.sin(p.tf.yaw), z: -Math.cos(p.tf.yaw) }, back: true };
  } else c.action = { kind: 'dodge', t: 0, dir };
  ctx.events.push({ type: 'dodge', entity: p.id });
}

function updateBlock(p: Entity, cmd: InputCommand, ctx: CombatCtx): void {
  const c = p.combat!;
  const held = (cmd.held & BTN.block) !== 0;
  if (c.action?.kind === 'block') {
    if (!held) c.action = null;
    return;
  }
  if (!held || c.action) return;
  // What is left of the press's window: nothing when block was simply held until the guard could rise.
  c.action = { kind: 'block', t: 0, parryTicks: Math.max(0, c.blockPressTicks - (ctx.now - c.lastBlockTick)) };
}

function setMotion(p: Entity, cmd: InputCommand, ctx: CombatCtx): void {
  const c = p.combat!;
  const a = c.action;
  const lockT = c.lock !== null ? ctx.get(c.lock) : undefined;
  const faceLock = lockT ? yawTo(p.tf.pos, lockT.tf.pos) : undefined;
  if (!a) {
    // Free: locomotion steers. Locked on (and not sprinting), face the target and strafe.
    const sprint = (cmd.held & BTN.sprint) !== 0;
    ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: 1, faceYaw: sprint ? undefined : faceLock });
    return;
  }
  switch (a.kind) {
    case 'attack': {
      const def = PLAYER_MOVES[a.move as PlayerMoveId];
      const tm = clipTiming(def.clip);
      let vx = 0, vz = 0;
      if (a.clipT < lungeEnd(def) && !a.charging && !a.connected) {
        const step = steerSwing(p, a, def, cmd, ctx);
        vx = (a.lungeDir.x * step) / DT;
        vz = (a.lungeDir.z * step) / DT;
        if (a.clipT < tm.activeStart) {
          // Turn toward the target during startup (720°/s), or the lock.
          const target = c.lock !== null ? ctx.get(c.lock) : undefined;
          const want = target ? yawTo(p.tf.pos, target.tf.pos) : Math.atan2(a.lungeDir.x, a.lungeDir.z);
          p.tf.yaw = turnToward(p.tf.yaw, want, SOFT_TARGET.turnRate * DT);
        }
      } else if (a.charging && cmd.aim && c.lock === null) {
        // A charging heavy turns with the stick, else follows the screen's centre, until released.
        const w = wishDir(cmd);
        const to = w.mag > 0.2 ? w : cmd.aim.dir;
        const f = Math.hypot(to.x, to.z);
        if (f > 1e-3) {
          a.lungeDir = { x: to.x / f, z: to.z / f };
          p.tf.yaw = turnToward(p.tf.yaw, Math.atan2(a.lungeDir.x, a.lungeDir.z), SOFT_TARGET.turnRate * DT);
        }
      }
      ctx.motion.set(p.id, { vx, vz, inputScale: 0 });
      return;
    }
    case 'dodge': {
      // Speed profile (1 − x²) over the move, scaled so the whole of it covers its distance.
      const f = dodgeFrames(a);
      const x = a.t / f.ticks;
      const speed = (f.distance / (f.ticks * DT)) * 1.5 * Math.max(0, 1 - x * x);
      ctx.motion.set(p.id, { vx: a.dir.x * speed, vz: a.dir.z * speed, inputScale: 0 });
      return;
    }
    case 'plunge':
      ctx.motion.set(p.id, plungeMotion(p, a, wishDir(cmd), faceLock));
      return;
    case 'block':
      ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: BLOCK.walkScale, faceYaw: faceLock ?? p.tf.yaw });
      return;
    case 'drink':
      ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: 0.35, faceYaw: p.tf.yaw });
      return;
    case 'cast':
      // Holding a breath: a slow walk, turning with the stick (or kept on the lock).
      if (a.channel) {
        ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: POWER.ember.walkScale, faceYaw: faceLock });
        return;
      }
      // Spells are upper body: walk slowly, facing the spell's target while it winds up.
      ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: CAST_WALK_SCALE, faceYaw: castFacing(ctx, p, cmd) ?? faceLock ?? p.tf.yaw });
      return;
    default:
      ctx.motion.set(p.id, { vx: 0, vz: 0, inputScale: 0 });
  }
}
