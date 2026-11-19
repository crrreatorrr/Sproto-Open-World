import { describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { BIG_COIN_ADD_BELOW, BIG_COIN_ADD_COUNT, BONUS_FLAGS, GATEKEEPER_STRING3_HOLD, PEST_CAMP, PEST_WAVE_SIZE } from '../../src/content/packs/encounterTune';
import { QUESTS } from '../../src/content/quests';
import type { SimEvent } from '../../src/sim/events';
import { newFight } from '../../src/sim/ai/tactics';
import { questPolish, type PolishCtx } from '../../src/sim/systems/encounters';
import type { Entity } from '../../src/sim/entity';
import { step } from './combatHelpers';
import { combatWorld } from './combatHelpers';
import { alive, campMembers, flatSproutvale } from './m4Helpers';

function polish(w: { now: number; entities: Entity[]; world: PolishCtx['world'] }, events: SimEvent[], spawn?: PolishCtx['spawnAdd']): { added: Entity[]; dropped: { item?: string }[] } {
  const added: Entity[] = [];
  const dropped: { item?: string }[] = [];
  questPolish({
    now: w.now,
    entities: w.entities,
    events,
    world: w.world,
    spawnAdd: spawn ?? ((def, pos, yaw) => {
      throw new Error(`unexpected add ${def} ${pos.x} ${yaw}`);
    }),
    spawnPickup: (_pos, pk) => dropped.push(pk),
  });
  return { added, dropped };
}

const hit = (attacker: number, target: number, extra: Partial<Extract<SimEvent, { type: 'hit' }>> = {}): SimEvent => ({
  type: 'hit', attacker, target, move: 'projectile', damage: 9, kind: 'physical', affinity: 'normal', crit: false, heavy: false,
  pos: { x: 0, y: 1, z: 0 }, hitstop: 3, reflected: true, sourceMove: 'coinBurst', ...extra,
});

describe('pest control waves', () => {
  it('orchard_south is 2 waves of 4, and the horn releases the second when the first falls', async () => {
    const { w } = await flatSproutvale();
    const wave = (n: number) => campMembers(w, PEST_CAMP).filter((e) => e.brain!.wave === n);
    expect(wave(1)).toHaveLength(PEST_WAVE_SIZE);
    expect(wave(2)).toHaveLength(0);

    for (const e of wave(1)) e.combat!.action = { kind: 'dead', t: 0 };
    const ev = step(w);
    expect(ev.some((e) => e.type === 'cue' && e.cue === 'horn')).toBe(true);
    expect(wave(2)).toHaveLength(PEST_WAVE_SIZE);
    expect(wave(2).every((e) => alive(e))).toBe(true);
    // One horn, not another the tick after.
    expect(step(w).some((e) => e.type === 'cue' && e.cue === 'horn')).toBe(false);
    w.dispose();
  });
});

describe('Big Coin add phase', () => {
  it('calls 2 Slingers at 50% HP and not a hit above it', async () => {
    const { w } = await combatWorld();
    const coin = w.spawnEnemy('big_coin', { x: 0, y: 0, z: 0 });
    const slingers = () => w.entities.filter((e) => e.brain?.def === 'slinger' && e.brain.summoned);

    coin.vitals!.hp = Math.floor(coin.vitals!.hpMax * BIG_COIN_ADD_BELOW) + 1;
    step(w);
    expect(slingers()).toHaveLength(0);
    expect(w.events.some((e) => e.type === 'cue' && e.cue === 'bell')).toBe(false);

    coin.vitals!.hp = Math.floor(coin.vitals!.hpMax * BIG_COIN_ADD_BELOW);
    const ev = step(w);
    expect(coin.vitals!.hp / coin.vitals!.hpMax).toBeLessThanOrEqual(BIG_COIN_ADD_BELOW);
    expect(slingers()).toHaveLength(BIG_COIN_ADD_COUNT);
    expect(ev.filter((e) => e.type === 'cue' && e.cue === 'bell')).toHaveLength(1);
    step(w);
    expect(slingers()).toHaveLength(BIG_COIN_ADD_COUNT);
    w.dispose();
  });
});

describe('Gatekeeper delayed swing', () => {
  it('holds the third swing for the tuned extra ticks', async () => {
    const { w, p } = await combatWorld();
    const g = w.spawnEnemy('gatekeeper', { x: 0, y: 0, z: 0 }, 0);
    p.tf.pos = { x: 0, y: 0, z: 2 };
    g.brain!.target = p.id;
    g.brain!.state = 'engage';
    g.brain!.fight = newFight(g);
    const move = ENEMIES.gatekeeper.moves.find((m) => m.id === 'string3')!;
    const prev = ENEMIES.gatekeeper.moves.find((m) => m.id === 'string2')!;
    expect(move.holdTicks).toBe(GATEKEEPER_STRING3_HOLD);
    g.combat!.action = {
      kind: 'attack', move: 'string2', t: prev.windup + prev.active + prev.recovery - 1, clipT: 0, charge: 0,
      charging: false, charged: false, hit: [], lunge: 0, lungeDir: { x: 0, z: 0 }, fired: 0,
    };
    const started = step(w);
    const telegraph = started.find((e) => e.type === 'telegraph' && e.move === 'string3');
    expect(telegraph).toMatchObject({ ticks: move.windup + GATEKEEPER_STRING3_HOLD });

    let ticks = 0;
    let swung = false;
    for (let i = 0; i < move.windup + GATEKEEPER_STRING3_HOLD + 4; i++) {
      ticks++;
      const ev = step(w);
      if (ev.some((e) => e.type === 'swing' && e.move === 'string3')) {
        swung = true;
        break;
      }
    }
    expect(swung).toBe(true);
    expect(ticks).toBe(move.windup + GATEKEEPER_STRING3_HOLD);
    w.dispose();
  });
});

describe('bonus feats', () => {
  it('counts reflected coins into Slingers, and a reflect kill only when the shot fells', async () => {
    const { w, p } = await combatWorld();
    const s = w.spawnEnemy('slinger', { x: 3, y: 0, z: 0 });
    p.progress!.quests.q_watchtower = { status: 'active', step: QUESTS.q_watchtower.steps.findIndex((x) => x.id === 'slingers'), progress: [0] };
    const connect = () => hit(p.id, s.id);
    polish(w, [connect(), connect()]);
    expect(w.world.flags[`${BONUS_FLAGS.watchtower}.n`]).toBe(2);
    expect(w.world.flags[BONUS_FLAGS.watchtower]).toBeUndefined();
    polish(w, [connect()]);
    expect(w.world.flags[BONUS_FLAGS.watchtower]).toBe(1);

    // A hit that is not a reflect does not count, and the gallery bonus wants the killing shot.
    const gun = w.spawnEnemy('rivet_gunner', { x: -3, y: 0, z: 0 });
    p.progress!.quests.q_iron_gallery = { status: 'active', step: QUESTS.q_iron_gallery.steps.findIndex((x) => x.id === 'gunners'), progress: [0, 0] };
    polish(w, [hit(p.id, gun.id, { reflected: false, sourceMove: 'charged_shot' })]);
    expect(w.world.flags[`${BONUS_FLAGS.gallery}.n`] ?? 0).toBe(0);
    polish(w, [hit(p.id, gun.id, { sourceMove: 'charged_shot' })]);
    expect(w.world.flags[`${BONUS_FLAGS.gallery}.n`] ?? 0).toBe(0);
    polish(w, [hit(p.id, gun.id, { sourceMove: 'charged_shot' }), { type: 'death', entity: gun.id, killer: p.id }]);
    expect(w.world.flags[`${BONUS_FLAGS.gallery}.n`]).toBe(1);
    polish(w, [hit(p.id, gun.id, { sourceMove: 'rivet_burst' }), { type: 'death', entity: gun.id, killer: p.id }]);
    expect(w.world.flags[`${BONUS_FLAGS.gallery}.n`]).toBe(1);
    polish(w, [hit(p.id, gun.id, { sourceMove: 'charged_shot' }), { type: 'death', entity: gun.id, killer: p.id }]);
    expect(w.world.flags[BONUS_FLAGS.gallery]).toBe(1);
    w.dispose();
  });

  it('counts 3 perfect dodges against the giant in one fight, and a death before that resets', async () => {
    const { w, p } = await combatWorld();
    const giant = w.spawnEnemy('hollow_giant', { x: 0, y: 0, z: 4 });
    giant.brain!.state = 'engage';
    giant.vitals!.hp = giant.vitals!.hpMax * 0.8;
    p.progress!.quests.q_hollow_giant = { status: 'active', step: QUESTS.q_hollow_giant.steps.findIndex((x) => x.id === 'giant'), progress: [0] };
    const dodge = (): SimEvent => ({ type: 'dodgePerfect', entity: p.id, attacker: giant.id });
    polish(w, [dodge(), dodge()]);
    expect(w.world.flags[`${BONUS_FLAGS.giant}.n`]).toBe(2);
    expect(w.world.flags[BONUS_FLAGS.giant]).toBeUndefined();

    giant.combat!.action = { kind: 'dead', t: 0 };
    polish(w, [{ type: 'death', entity: giant.id, killer: p.id }]);
    expect(w.world.flags[`${BONUS_FLAGS.giant}.n`] ?? 0).toBe(0);
    expect(w.world.flags[BONUS_FLAGS.giant]).toBeUndefined();

    giant.combat!.action = null;
    giant.brain!.state = 'engage';
    giant.vitals!.hp = giant.vitals!.hpMax * 0.5;
    polish(w, [dodge(), dodge(), dodge()]);
    expect(w.world.flags[BONUS_FLAGS.giant]).toBe(1);

    // A dodge against someone else in that fight does not count (flag already set; the counter stays).
    const grunt = w.spawnEnemy('grunt', { x: 2, y: 0, z: 2 });
    const before = w.world.flags[`${BONUS_FLAGS.giant}.n`];
    polish(w, [{ type: 'dodgePerfect', entity: p.id, attacker: grunt.id }]);
    expect(w.world.flags[`${BONUS_FLAGS.giant}.n`]).toBe(before);
    w.dispose();
  });
});

describe('habit flags', () => {
  it('counts a parry, and a perfect dodge as the one roll that started it', async () => {
    const { w, p } = await combatWorld();
    polish(w, [
      { type: 'dodge', entity: p.id },
      { type: 'dodgePerfect', entity: p.id, attacker: 1 },
    ]);
    expect(w.world.flags['habit.roll']).toBe(1);
    polish(w, [{ type: 'parry', attacker: 2, target: p.id, projectile: false, pos: { x: 0, y: 1, z: 0 }, stun: 75 }]);
    expect(w.world.flags['habit.parry']).toBe(1);
    for (let i = 0; i < 120; i++) polish(w, [{ type: 'dodge', entity: p.id }]);
    expect(w.world.flags['habit.roll']).toBe(99);
    w.dispose();
  });
});

describe('pumpkin carriers', () => {
  it('a hit knocks the pumpkin off and the Grunt runs for the next one', async () => {
    const { w, p } = await combatWorld();
    const a = w.spawnEnemy('grunt_orchard', { x: 0, y: 0, z: 2 });
    const b = w.spawnEnemy('grunt_orchard', { x: 4, y: 0, z: 2 });
    a.brain!.carry = 'stolen_pumpkin';
    a.brain!.carryHome = 'stolen_pumpkin';
    const { dropped } = polish(w, [hit(p.id, a.id, { move: 'light1', reflected: false, sourceMove: undefined })]);
    expect(dropped.map((d) => d.item)).toEqual(['stolen_pumpkin']);
    expect(a.brain!.carry).toBeUndefined();
    expect(a.brain!.fleeTo).toBe(b.id);
    w.dispose();
  });
});

describe('bonus flags grant the keepsakes (workstream C counts, B grants)', () => {
  it('the first tick a bonus flag is set, its keepsake is won, once', async () => {
    const { w, p } = await combatWorld();
    const gained = (ev: readonly SimEvent[], id: string) => ev.filter((e) => e.type === 'itemGained' && e.item === id).length;
    expect(gained(step(w), 'relic_drowned_coins')).toBe(0);
    w.world.flags[`${BONUS_FLAGS.watchtower}.n`] = 2;
    expect(gained(step(w), 'relic_drowned_coins')).toBe(0);
    w.world.flags[BONUS_FLAGS.watchtower] = 1;
    expect(gained(step(w), 'relic_drowned_coins')).toBe(1);
    expect(gained(step(w), 'relic_drowned_coins')).toBe(0);
    w.world.flags[BONUS_FLAGS.gallery] = 1;
    w.world.flags[BONUS_FLAGS.giant] = 1;
    const ev = step(w);
    expect(gained(ev, 'relic_elder_iron_rivet')).toBe(1);
    expect(gained(ev, 'relic_sprotos_stride')).toBe(1);
    expect(p.progress!.relics!.owned.filter((id) => id === 'relic_drowned_coins')).toHaveLength(1);
    w.dispose();
  });

  it('three reflected coins into Slingers, through the real tick, win the Coins', async () => {
    const { w, p } = await combatWorld();
    const s = w.spawnEnemy('slinger', { x: 3, y: 0, z: 0 });
    p.progress!.quests.q_watchtower = { status: 'active', step: QUESTS.q_watchtower.steps.findIndex((x) => x.id === 'slingers'), progress: [0] };
    let won = 0;
    for (let i = 0; i < 3; i++) {
      // A reflected coin connecting, as stepProjectiles reports it, then the rest of the tick.
      w.events.push(hit(p.id, s.id));
      polish(w, w.events.splice(0));
      won += step(w).filter((e) => e.type === 'itemGained' && e.item === 'relic_drowned_coins').length;
    }
    expect(w.world.flags[BONUS_FLAGS.watchtower]).toBe(1);
    expect(won).toBe(1);
    w.dispose();
  });
});
