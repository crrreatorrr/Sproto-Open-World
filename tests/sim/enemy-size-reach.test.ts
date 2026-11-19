import { describe, expect, it } from 'vitest';
import { SANDBOX } from '../../src/content/sandbox';
import { ENEMIES, type EnemyDef, type EnemyMoveDef } from '../../src/content/enemies';
import { ENEMY_SIZES, affixedMove, scaleEnemy } from '../../src/content/enemyScale';
import { AFFIXES, C4_ENEMIES } from '../../src/content/packs/c4';
import { BURROWMOTHER } from '../../src/content/packs/c5';
import { DRAKE } from '../../src/content/packs/c6';
import { SCRAPJAW } from '../../src/content/packs/m5';
import { MOVE, PLAYER_BODY, TICK_HZ } from '../../src/content/tuning';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import { yawTo } from '../../src/sim/combat/geometry';
import type { Entity } from '../../src/sim/entity';
import { applyAffix } from '../../src/sim/systems/affixes';
import { BTN, cmd, combatWorld, forceEnemyAttack, hitsOn, idle, press, step, stepN, teleport, type TickEvents } from './combatHelpers';

/** Heights (m) the enemies were authored at: what "bigger" is measured against. */
const AUTHORED: Record<string, { height: number; radius: number }> = {
  brute: { height: 2.4, radius: 0.75 },
  // Cave copies. Authored size is the base's, before the shared 1.5 scale.
  rd_brute: { height: 2.4, radius: 0.75 },
  gatekeeper: { height: 3.2, radius: 1 },
  rivet_gunner: { height: 2, radius: 0.45 },
  lens_warden: { height: 2.1, radius: 0.5 },
  bramble_colossus: { height: 3.84, radius: 1.2 },
  hollow_giant: { height: 4.8, radius: 1.5 },
  deep_warden: { height: 4.8, radius: 1.5 },
  scrapjaw: { height: 5.4, radius: 1.8 },
  burrowmother: { height: 5, radius: 2 },
  skyfire_drake: { height: 5, radius: 2.4 },
};
const STRONG = Object.keys(AUTHORED);
const BOSSES = ['scrapjaw', 'burrowmother', 'skyfire_drake'];
const GROUND_FIGHTERS = STRONG.filter((id) => id !== 'skyfire_drake');
/** An empty yard: nothing in the way of a capsule this size. */
const YARD = { ...SANDBOX, enemies: [], shapes: [], ground: { size: 400, color: 0 } };

/** Is this a blow struck with the body (as opposed to a shot, a circle on the ground, a roar or a rush)? */
const melee = (m: EnemyMoveDef) => !m.projectile && !m.area && !m.noHit && !m.charge && !m.dive && !m.burrow;

/** Ready to be hit: awake, above ground and in the fight. */
function wake(e: Entity): void {
  if (e.boss) {
    e.boss.state = 'fight';
    delete e.boss.under;
  }
  e.brain!.timer = 9999;
}

/** Held still for the swing: a ranged elite would otherwise back away from it. */
const holdStill = (e: Entity) => {
  e.combat!.action = { kind: 'stagger', t: 0, dur: 9999 };
};

describe('how big they are', () => {
  it('every elite and boss is in the table, and nothing else is', () => {
    const strong = Object.values(ENEMIES).filter((d) => d.elite || d.boss).map((d) => d.id).sort();
    expect(Object.keys(ENEMY_SIZES).sort()).toEqual(strong);
    expect(STRONG.slice().sort()).toEqual(strong);
  });

  it('elites stand about 1.5×, bosses 1.6× to 2×, and all of them over the 1.8 m player', () => {
    for (const id of STRONG) {
      const k = ENEMIES[id].body.height / AUTHORED[id].height;
      if (BOSSES.includes(id)) expect(k, id).toBeGreaterThanOrEqual(1.6);
      if (BOSSES.includes(id)) expect(k, id).toBeLessThanOrEqual(2);
      else expect(k, id).toBeCloseTo(1.5, 5);
      expect(ENEMIES[id].body.height, id).toBeGreaterThanOrEqual(PLAYER_BODY.height * 1.6);
      expect(ENEMIES[id].body.radius / AUTHORED[id].radius, id).toBeCloseTo(k, 5);
    }
  });

  it('ordinary enemies keep their size', () => {
    const sizes: Record<string, [number, number]> = { grunt: [0.35, 1.3], slinger: [0.35, 1.85], wisp: [0.4, 1.9], grunt_vet: [0.35, 1.3], big_coin: [0.5, 2.3], bramble_thrall: [0.35, 1.3], dummy_passive: [0.4, 1.8] };
    for (const [id, [radius, height]] of Object.entries(sizes)) expect(ENEMIES[id].body, id).toEqual({ radius, height });
    expect(ENEMIES.grunt.size).toBeUndefined();
  });
});

describe('scaleEnemy', () => {
  const pairs: [string, EnemyDef][] = [['scrapjaw', SCRAPJAW], ['burrowmother', BURROWMOTHER], ['skyfire_drake', DRAKE], ['hollow_giant', C4_ENEMIES.hollow_giant], ['rivet_gunner', C4_ENEMIES.rivet_gunner]];

  it('leaves damage, health, poise, speed and timing exactly alone', () => {
    for (const [id, base] of pairs) {
      const big = ENEMIES[id];
      for (const key of ['hp', 'poise', 'moveSpeed', 'turnRate', 'staggerTicks', 'level', 'xp', 'aggroRange', 'leashRange'] as const) expect(big[key], `${id}.${key}`).toBe(base[key]);
      expect(big.defense, id).toEqual(base.defense);
      big.moves.forEach((m, i) => {
        const b = base.moves[i];
        for (const key of ['damage', 'poise', 'windup', 'active', 'recovery', 'cooldown', 'weight', 'hitstop', 'knockback'] as const) expect(m[key], `${id}.${m.id}.${key}`).toBe(b[key]);
        expect(m.charge, `${id}.${m.id}`).toEqual(b.charge);
        expect(m.projectile, `${id}.${m.id}`).toEqual(b.projectile);
      });
    }
  });

  it('grows everything measured on the body by the same factor', () => {
    for (const [id, base] of pairs) {
      const k = ENEMY_SIZES[id];
      const big = ENEMIES[id];
      big.moves.forEach((m, i) => {
        const b = base.moves[i];
        expect(m.hitbox.forward, `${id}.${m.id}`).toBeCloseTo(b.hitbox.forward * k, 6);
        expect(m.hitbox.up, `${id}.${m.id}`).toBeCloseTo(b.hitbox.up * k, 6);
        expect(m.hitbox.radius, `${id}.${m.id}`).toBeCloseTo(b.hitbox.radius * k, 6);
        if (b.sweep) expect(m.sweep!.forward, `${id}.${m.id}`).toBeCloseTo(b.sweep.forward * k, 6);
        if (b.shove) expect(m.shove!.distance, `${id}.${m.id}`).toBeCloseTo(b.shove.distance * k, 6);
        if (melee(b)) expect(m.range, `${id}.${m.id}`).toBeCloseTo(b.range * k, 6);
      });
      base.weakSpots?.forEach((s, i) => expect(big.weakSpots![i].up, id).toBeCloseTo(s.up * k, 6));
      if (base.lockPoint) expect(big.lockPoint!.up, id).toBeCloseTo(base.lockPoint.up * k, 6);
    }
  });

  it('thrown moves keep the distance from its skin to the player', () => {
    for (const [id, base] of pairs) {
      const grew = ENEMIES[id].body.radius - base.body.radius;
      ENEMIES[id].moves.forEach((m, i) => {
        const b = base.moves[i];
        if (!melee(b) && b.range > 0) expect(m.range, `${id}.${m.id}`).toBeCloseTo(b.range + grew, 6);
        if (b.minRange !== undefined) expect(m.minRange, `${id}.${m.id}`).toBeCloseTo(b.minRange + grew, 6);
      });
    }
  });

  it('never shrinks a circle, and a sprint from its centre always clears it inside the wind-up', () => {
    for (const id of STRONG) {
      for (const m of ENEMIES[id].moves) {
        if (!m.area) continue;
        // From a standstill: the sprint has to build up to speed like the player's does.
        const top = MOVE.sprintSpeed, seconds = m.windup / TICK_HZ;
        const run = top * seconds - (top * top) / (2 * MOVE.accel);
        expect(m.area.radius + PLAYER_BODY.radius, `${id}.${m.id}`).toBeLessThan(run);
      }
    }
  });

  it('is its own inverse in shape: scaling by 1 changes no measurement', () => {
    const same = scaleEnemy(SCRAPJAW, 1);
    expect(same.body).toEqual(SCRAPJAW.body);
    expect(same.moves.map((m) => m.hitbox)).toEqual(SCRAPJAW.moves.map((m) => m.hitbox));
  });
});

describe('the player can reach them', () => {
  for (const id of GROUND_FIGHTERS) {
    it(`${id}: walking up to it and swinging the staff connects, from the front and from behind`, async () => {
      for (const side of [0, Math.PI]) {
        const { w, p } = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: 0 } });
        const e = w.spawnEnemy(id, { x: 0, y: 0, z: 0 }, side);
        wake(e);
        const start = e.body!.radius + 2.5;
        teleport(w, p, { x: Math.sin(side) * start, y: 0, z: Math.cos(side) * start });
        const toEnemy = yawTo(p.tf.pos, e.tf.pos);
        // Walk into its capsule, then swing.
        const events: TickEvents[] = stepN(w, 150, (i) => {
          p.vitals!.hp = p.vitals!.hpMax;
          holdStill(e);
          return i < 90 ? cmd({ camYaw: toEnemy, move: { x: 0, y: 1 } }) : i % 24 === 0 ? press(BTN.light, { camYaw: toEnemy }) : cmd({ camYaw: toEnemy });
        });
        expect(hitsOn(events, e.id).length, `${id} from ${side === 0 ? 'the front' : 'behind'}`).toBeGreaterThan(0);
        w.dispose();
      }
    }, 30_000);
  }

  it('skyfire_drake: broken and gliding low, the staff reaches it', async () => {
    const { w, p } = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: 0 } });
    const d = w.spawnEnemy('skyfire_drake', { x: 0, y: 0, z: 0 }, 0);
    d.boss!.state = 'fight';
    d.combat!.team = 'enemy';
    d.combat!.action = { kind: 'stagger', t: 0, dur: ENEMIES.skyfire_drake.staggerTicks, reason: 'broken' };
    const glide = ENEMIES.skyfire_drake.drake!.glide;
    stepN(w, glide.descendTicks + 10, () => idle());
    expect(d.boss!.flight!.mode).toBe('glide');
    expect(d.tf.pos.y).toBeLessThan(glide.height + 0.5);
    // Run alongside it and swing.
    const events = stepN(w, 240, (i) => {
      p.vitals!.hp = p.vitals!.hpMax;
      // As far in under its belly as the player's capsule can walk.
      const r = d.body!.radius;
      const belly = d.tf.pos.y + r;
      const head = PLAYER_BODY.height - PLAYER_BODY.radius;
      const gap = Math.sqrt(Math.max(0, (r + PLAYER_BODY.radius) ** 2 - (belly - head) ** 2)) + 0.05;
      teleport(w, p, { x: d.tf.pos.x + gap, y: 0, z: d.tf.pos.z });
      const at = yawTo(p.tf.pos, d.tf.pos);
      p.tf.yaw = at;
      return i % 24 === 0 ? press(BTN.light, { camYaw: at }) : cmd({ camYaw: at });
    });
    expect(hitsOn(events, d.id).length).toBeGreaterThan(0);
    w.dispose();
  }, 30_000);

  it('the back weak spot opens within the staff\'s reach of a stunned boss', () => {
    for (const id of ['scrapjaw', 'burrowmother']) {
      const def = ENEMIES[id];
      const [spot] = def.weakSpots!;
      // Stood right behind it: the sphere comes down to where a swing passes.
      expect(spot.up - spot.radius, id).toBeLessThan(1.6);
      expect(Math.abs(spot.forward) - spot.radius, id).toBeLessThan(def.body.radius);
    }
  });

  it('lock-on aims at the chest, not the knees', () => {
    for (const id of STRONG) {
      const def = ENEMIES[id];
      const up = def.lockPoint?.up ?? def.body.height * 0.6;
      expect(up / def.body.height, id).toBeGreaterThan(0.5);
      expect(up / def.body.height, id).toBeLessThan(0.7);
    }
  });
});

describe('their attacks line up with their bodies', () => {
  for (const id of GROUND_FIGHTERS) {
    it(`${id}: every blow starts at its body and lands on a player standing in front of it`, async () => {
      const def = ENEMIES[id];
      for (const move of def.moves.filter(melee)) {
        // The sphere touches the body it comes out of: nothing swings from thin air.
        expect(move.hitbox.forward - move.hitbox.radius, `${id}.${move.id}`).toBeLessThanOrEqual(def.body.radius + 1e-6);
        // Standing touching it, and at 70% of the range it picks the move from.
        for (const gap of [def.body.radius + PLAYER_BODY.radius + 0.1, move.range * 0.7 + PLAYER_BODY.radius]) {
          const { w, p } = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: Math.max(gap, def.body.radius + PLAYER_BODY.radius + 0.1) } });
          const e = w.spawnEnemy(id, { x: 0, y: 0, z: 0 }, 0);
          wake(e);
          forceEnemyAttack(e, move.id);
          const events = stepN(w, move.windup + move.active + 2);
          expect(hitsOn(events, p.id).length, `${id}.${move.id} at ${gap.toFixed(1)} m`).toBeGreaterThan(0);
          w.dispose();
        }
      }
    }, 60_000);
  }

  it('shots leave from high on the body, aimed down at the player', () => {
    for (const id of STRONG) {
      for (const m of ENEMIES[id].moves.filter((x) => x.projectile)) {
        expect(m.hitbox.up, `${id}.${m.id}`).toBeGreaterThan(PLAYER_BODY.height * 0.8);
        expect(m.hitbox.up, `${id}.${m.id}`).toBeLessThan(ENEMIES[id].body.height);
      }
    }
  });
});

describe('boss fights at the new size', () => {
  it('each boss fits inside its arena with room to cross it', () => {
    for (const id of BOSSES) {
      const def = ENEMIES[id];
      expect(def.boss!.arenaRadius, id).toBeGreaterThan(def.body.radius * 4);
    }
  });

  it('a boss can pass behind every pillar, between any two and around the centre', () => {
    const obstacles = SPROUTVALE_CONTENT.obstacles ?? [];
    const arenas = [{ id: 'scrapjaw', tag: 'quarry_pillar_' }, { id: 'burrowmother', tag: 'seam_pillar_' }];
    for (const { id, tag } of arenas) {
      const def = ENEMIES[id];
      const home = SPROUTVALE_CONTENT.enemies.find((e) => e.def === id)!.pos;
      const pillars = obstacles.filter((o) => o.id.startsWith(tag));
      expect(pillars.length, id).toBeGreaterThanOrEqual(3);
      const wide = def.body.radius * 2;
      pillars.forEach((a, i) => {
        if (a.shape.kind !== 'cylinder') throw new Error('a round pillar');
        const ring = Math.hypot(a.pos[0] - home[0], a.pos[2] - home[2]);
        expect(def.boss!.arenaRadius - ring - a.shape.radius, `${a.id} to the wall`).toBeGreaterThan(wide);
        expect(ring - a.shape.radius, `${a.id} to the centre`).toBeGreaterThan(def.body.radius);
        for (const b of pillars.slice(i + 1)) expect(Math.hypot(a.pos[0] - b.pos[0], a.pos[2] - b.pos[2]) - a.shape.radius * 2, `${a.id} to ${b.id}`).toBeGreaterThan(wide);
      });
    }
  });

  it('the Burrowmother digs in, comes up inside the arena and throws the player clear of her body', async () => {
    const { w, p } = await combatWorld({ level: YARD, pos: { x: 6, y: 0, z: 0 } });
    const b = w.spawnEnemy('burrowmother', { x: 0, y: 0, z: 0 }, 0);
    wake(b);
    b.boss!.phase = 2;
    b.brain!.timer = 0;
    const def = ENEMIES.burrowmother;
    forceEnemyAttack(b, 'burrow_sink');
    const sink = def.moves.find((m) => m.id === 'burrow_sink')!;
    const rise = def.moves.find((m) => m.id === 'burrow_rise')!;
    let wentUnder = false;
    for (let i = 0; i < sink.windup + sink.active + rise.windup + 20; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      step(w);
      wentUnder ||= !!b.boss!.under;
    }
    expect(wentUnder).toBe(true);
    expect(b.boss!.under).toBeUndefined();
    expect(w.physics.hasCharacter(b.id)).toBe(true);
    expect(Math.hypot(b.tf.pos.x, b.tf.pos.z)).toBeLessThanOrEqual(def.boss!.arenaRadius - def.body.radius + 1e-6);
    // She came up where the player stood: they end up outside her, not inside her.
    expect(Math.hypot(p.tf.pos.x - b.tf.pos.x, p.tf.pos.z - b.tf.pos.z)).toBeGreaterThan(def.body.radius * 0.95);
    w.dispose();
  }, 30_000);

  it('the Drake flies its whole fight inside the arena wall, and its dives stay on the field', async () => {
    const { w, p } = await combatWorld({ level: YARD, pos: { x: 8, y: 0, z: 8 } });
    const d = w.spawnEnemy('skyfire_drake', { x: 0, y: 0, z: 0 }, 0);
    d.boss!.state = 'fight';
    d.combat!.team = 'enemy';
    d.boss!.phase = 3;
    const def = ENEMIES.skyfire_drake;
    const limit = def.boss!.arenaRadius - def.body.radius * 0.6;
    let dives = 0;
    let lowest = Infinity;
    for (let i = 0; i < 3600; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      d.vitals!.hp = d.vitals!.hpMax * 0.2;
      step(w);
      expect(Math.hypot(d.tf.pos.x, d.tf.pos.z), `tick ${i}`).toBeLessThanOrEqual(limit);
      const lane = d.boss!.flight?.lane;
      if (lane) {
        dives++;
        for (const [x, z] of [[lane.ax, lane.az], [lane.bx, lane.bz]]) expect(Math.hypot(x, z), `tick ${i}`).toBeLessThanOrEqual(def.boss!.arenaRadius - def.drake!.arenaMargin + 1e-6);
      }
      lowest = Math.min(lowest, d.tf.pos.y);
    }
    expect(dives).toBeGreaterThan(0);
    // A dive comes down to the field, belly clear of the ground.
    expect(lowest).toBeGreaterThan(0);
    expect(lowest).toBeLessThan(def.drake!.altitude[0]);
    w.dispose();
  }, 60_000);

  it('the Drake still flies well clear of the player\'s head, with its chest where spells were tuned to reach', () => {
    const [lo, hi] = ENEMIES.skyfire_drake.drake!.altitude;
    const chest = (alt: number, h: number) => alt + h * 0.55;
    expect(lo).toBeGreaterThan(PLAYER_BODY.height * 4);
    expect(chest(lo, ENEMIES.skyfire_drake.body.height)).toBeCloseTo(chest(DRAKE.drake!.altitude[0], DRAKE.body.height), 5);
    expect(chest(hi, ENEMIES.skyfire_drake.body.height)).toBeCloseTo(chest(DRAKE.drake!.altitude[1], DRAKE.body.height), 5);
  });
});

describe('the Colossal affix', () => {
  it('is bigger than a plain elite multiplier and counts as elite', () => {
    expect(AFFIXES.colossal.scale).toBeGreaterThanOrEqual(1.5);
    expect(AFFIXES.colossal.elite).toBe(true);
  });

  it('grows a Grunt\'s swing with its body, so the blow lands where it is drawn', async () => {
    const k = AFFIXES.colossal.scale!;
    const swipe = ENEMIES.grunt.moves.find((m) => m.id === 'swipe')!;
    expect(affixedMove(swipe, k).hitbox.forward).toBeCloseTo(swipe.hitbox.forward * k, 6);
    expect(affixedMove(swipe, k).hitbox.radius).toBeCloseTo(swipe.hitbox.radius * k, 6);
    expect(affixedMove(swipe, 1)).toBe(swipe);
    expect(affixedMove(swipe, k)).toBe(affixedMove(swipe, k));

    // Just past where a plain Grunt's swipe stops, a Colossal one's still connects.
    const gap = swipe.hitbox.forward + swipe.hitbox.radius + PLAYER_BODY.radius + 0.3;
    const plain = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: gap } });
    const g = plain.w.spawnEnemy('grunt', { x: 0, y: 0, z: 0 }, 0);
    forceEnemyAttack(g, 'swipe');
    expect(hitsOn(stepN(plain.w, swipe.windup + swipe.active + 2), plain.p.id).length).toBe(0);
    plain.w.dispose();

    const big = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: gap } });
    const c = big.w.spawnEnemy('grunt', { x: 0, y: 0, z: 0 }, 0);
    expect(applyAffix(c, 'colossal')).toBe(true);
    big.w.physics.addCharacter(c.id, c.body!, c.tf.pos);
    expect(c.body!.height).toBeCloseTo(ENEMIES.grunt.body.height * k, 6);
    forceEnemyAttack(c, 'swipe');
    expect(hitsOn(stepN(big.w, swipe.windup + swipe.active + 2), big.p.id).length).toBe(1);
    big.w.dispose();
  }, 30_000);
});
