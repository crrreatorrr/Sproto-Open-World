/**
 * Quest-polish encounter beats (the plan's mechanics): Grunt waves, Big Coin's adds, bonus feats,
 * pumpkin knock-offs, and the small world cues. Dialogue text and the relic items live in the
 * other workstreams; this file raises the flags and cues they hook.
 */
import { ENEMIES } from '../../content/enemies';
import { SHRINE_HUM_M, TREMOR_AT, TREMOR_EVERY, TREMOR_RADIUS } from '../../content/packs/encounterTune';
import { QUESTS, type Objective } from '../../content/quests';
import { flatDist } from '../combat/geometry';
import type { Entity, WorldState } from '../entity';
import type { SimEvent } from '../events';
import type { Vec3 } from '../math';
import { countFor } from './rpg';

const PICKUP_LIFE = 60 * 60;
const HABIT_CAP = 99;

export interface PolishCtx {
  now: number;
  entities: readonly Entity[];
  events: SimEvent[];
  world: WorldState;
  spawnAdd(def: string, pos: Vec3, yaw: number): Entity;
  spawnPickup(pos: Vec3, pickup: NonNullable<Entity['pickup']>): void;
}

const tagged = (e: Entity, tag: string | undefined): boolean => {
  if (!tag || !e.brain) return false;
  const def = ENEMIES[e.brain.def];
  return !!def && (def.id === tag || !!def.tags?.includes(tag));
};

const dead = (e: Entity) => e.combat?.action?.kind === 'dead';

/** Waves, adds, feats, carriers and cues for one tick. Safe to call with a hand-built event list. */
export function questPolish(ctx: PolishCtx): void {
  callAdds(ctx);
  knockPumpkins(ctx);
  bonusFeats(ctx);
  habits(ctx);
  worldCues(ctx);
}

function callAdds(ctx: PolishCtx): void {
  const player = ctx.entities.find((e) => e.kind === 'player' && !dead(e));
  for (const e of [...ctx.entities]) {
    const b = e.brain;
    const v = e.vitals;
    if (!b || !v || b.called || dead(e)) continue;
    const adds = ENEMIES[b.def].adds;
    if (!adds || v.hp / v.hpMax > adds.below) continue;
    b.called = true;
    for (let i = 0; i < adds.count; i++) {
      const a = e.tf.yaw + Math.PI / 2 + (i / Math.max(1, adds.count - 1)) * Math.PI;
      const at = { x: e.tf.pos.x + Math.sin(a) * 4, y: e.tf.pos.y, z: e.tf.pos.z + Math.cos(a) * 4 };
      const g = ctx.spawnAdd(adds.def, at, e.tf.yaw);
      g.brain!.summoned = true;
      g.brain!.state = 'engage';
      if (player) g.brain!.target = player.id;
    }
    ctx.events.push({ type: 'cue', cue: adds.cue, entity: e.id, pos: { ...e.tf.pos } });
  }
}

function knockPumpkins(ctx: PolishCtx): void {
  for (const ev of ctx.events) {
    if (ev.type !== 'hit') continue;
    const foe = ctx.entities.find((e) => e.id === ev.target);
    const item = foe?.brain?.carry;
    if (!foe?.brain || !item || dead(foe)) continue;
    foe.brain.carry = undefined;
    ctx.spawnPickup({ x: foe.tf.pos.x, y: foe.tf.pos.y + 0.4, z: foe.tf.pos.z }, { kind: 'item', item, amount: 1, life: PICKUP_LIFE });
    const next = ctx.entities.find((e) => e !== foe && e.brain && !e.brain.held && !dead(e) && tagged(e, 'grunt'));
    if (next) foe.brain.fleeTo = next.id;
  }
}

function bonusFeats(ctx: PolishCtx): void {
  for (const player of ctx.entities) {
    const p = player.progress;
    if (!p) continue;
    for (const [id, q] of Object.entries(p.quests)) {
      if (q.status !== 'active') continue;
      const step = QUESTS[id]?.steps[q.step];
      const bonus = step?.bonus;
      if (!bonus || ctx.world.flags[bonus.flag]) continue;
      const o = bonus.objective;
      const key = `${bonus.flag}.n`;
      if (o.kind === 'feat' && o.perFight) perFight(ctx, player, o, key, bonus.flag);
      else {
        const add = countFor(o, ctx.events, player, ctx.entities);
        if (add) ctx.world.flags[key] = (ctx.world.flags[key] ?? 0) + add;
        const need = o.kind === 'kill' || o.kind === 'collect' || o.kind === 'feat' ? o.count : 1;
        if ((ctx.world.flags[key] ?? 0) >= need) ctx.world.flags[bonus.flag] = 1;
      }
    }
  }
}

function perFight(ctx: PolishCtx, player: Entity, o: Objective, key: string, flag: string): void {
  if (o.kind !== 'feat' || !o.against) return;
  for (const foe of ctx.entities) {
    if (!tagged(foe, o.against) || !foe.brain || !foe.vitals) continue;
    const died = ctx.events.some((ev) => ev.type === 'death' && (ev.entity === foe.id || ev.entity === player.id));
    let n = foe.brain.dodges ?? 0;
    for (const ev of ctx.events) if (ev.type === 'dodgePerfect' && ev.entity === player.id && ev.attacker === foe.id) n++;
    foe.brain.dodges = n;
    if (n >= o.count) {
      ctx.world.flags[key] = n;
      ctx.world.flags[flag] = 1;
      continue;
    }
    const full = foe.vitals.hp >= foe.vitals.hpMax;
    if (died || (foe.brain.state !== 'engage' && full)) {
      foe.brain.dodges = 0;
      ctx.world.flags[key] = 0;
    } else ctx.world.flags[key] = n;
  }
}

function bump(world: WorldState, flag: string): void {
  world.flags[flag] = Math.min(HABIT_CAP, (world.flags[flag] ?? 0) + 1);
}

function habits(ctx: PolishCtx): void {
  const player = ctx.entities.find((e) => e.progress);
  if (!player) return;
  for (const ev of ctx.events) {
    if (ev.type === 'parry' && ev.target === player.id) bump(ctx.world, 'habit.parry');
    // The roll already emitted `dodge`. A perfect dodge is that same roll, not a second one.
    else if (ev.type === 'dodge' && ev.entity === player.id) bump(ctx.world, 'habit.roll');
    else if (ev.type === 'hit' && ev.attacker === player.id && ev.move === 'light3' && !ctx.world.flags['react.broccoli.combo']) {
      ctx.world.flags['react.broccoli.combo'] = 1;
      ctx.events.push({ type: 'cue', cue: 'react', entity: player.id, hook: 'farmer_broccoli' });
    } else if (ev.type === 'questComplete' && ev.entity === player.id) {
      if (ev.quest === 'q_hollow_giant') ctx.world.flags['react.giant.down'] = 1;
      if (ev.quest === 'q_deep_seam') ctx.world.flags['react.burrow.down'] = 1;
    } else if (ev.type === 'bossPhase') {
      const boss = ctx.entities.find((e) => e.id === ev.boss);
      if (boss?.brain?.def === 'burrowmother') ctx.events.push({ type: 'cue', cue: 'roar', entity: boss.id, pos: { ...boss.tf.pos } });
    }     else if (ev.type === 'talk' && ev.entity === player.id && minersTold(player, ctx.events)) ctx.world.flags['odo.pillar'] = 1;
  }
  // A Gunner's charged shot whines while it winds up, louder as the tick closes.
  for (const e of ctx.entities) {
    const a = e.combat?.action;
    if (a?.kind !== 'attack' || !e.brain) continue;
    const move = ENEMIES[e.brain.def].moves.find((m) => m.id === a.move);
    if (move?.cue !== 'whine' || a.t >= move.windup || a.t % 10 !== 0) continue;
    ctx.events.push({ type: 'cue', cue: 'whine', entity: e.id, frac: move.windup ? a.t / move.windup : 0 });
  }
}

/** All three miners have been asked, counting a talk that lands on this tick. Old Odo's extra line waits on the flag. */
function minersTold(player: Entity, events: readonly SimEvent[]): boolean {
  const q = player.progress?.quests.q_tremors;
  if (!q) return false;
  const step = QUESTS.q_tremors?.steps[Math.min(q.step, (QUESTS.q_tremors?.steps.length ?? 1) - 1)];
  if (!step || q.status === 'complete' || step.id !== 'miners') return q.step > 0 || q.status === 'complete';
  return step.objectives.every((o, i) => {
    if (o.kind !== 'talk') return (q.progress[i] ?? 0) >= 1;
    if ((q.progress[i] ?? 0) >= 1) return true;
    return events.some((ev) => ev.type === 'talk' && ev.entity === player.id && ev.npc === o.npc && (!o.node || ev.node === o.node));
  });
}

function worldCues(ctx: PolishCtx): void {
  const player = ctx.entities.find((e) => e.kind === 'player' && e.progress && !dead(e));
  if (!player?.progress) return;
  const garden = player.progress.quests.q_elders_garden;
  if (garden?.status === 'active' && QUESTS.q_elders_garden?.steps[garden.step]?.id === 'shrines') {
    const shrines = ctx.entities.filter((e) => e.interactable?.kind === 'shrine');
    for (const s of shrines) {
      const id = s.interactable!.id;
      const d = flatDist(player.tf.pos, s.tf.pos);
      const band = d < SHRINE_HUM_M / 3 ? 3 : d < (SHRINE_HUM_M * 2) / 3 ? 2 : d < SHRINE_HUM_M ? 1 : 0;
      const key = `hum.${id}`;
      if (band === 0) {
        if (ctx.world.flags[key]) ctx.world.flags[key] = 0;
        continue;
      }
      if ((ctx.world.flags[key] ?? 0) >= band) continue;
      ctx.world.flags[key] = band;
      const others = shrines.filter((o) => o !== s && (ctx.world.flags[`hum.${o.interactable!.id}`] ?? 0) >= 3).length;
      ctx.events.push({ type: 'cue', cue: band === 3 && others >= 2 ? 'chord' : 'hum', entity: s.id, frac: band / 3, pos: { ...s.tf.pos } });
    }
  }
  const tremors = player.progress.quests.q_tremors;
  if (tremors?.status === 'active' && ctx.now % TREMOR_EVERY === 0) {
    const dx = player.tf.pos.x - TREMOR_AT[0];
    const dz = player.tf.pos.z - TREMOR_AT[1];
    if (dx * dx + dz * dz <= TREMOR_RADIUS * TREMOR_RADIUS) ctx.events.push({ type: 'cue', cue: 'tremor', entity: player.id, pos: { ...player.tf.pos } });
  }
}
