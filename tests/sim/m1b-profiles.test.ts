import { describe, expect, it } from 'vitest';
import type { DamageKind } from '../../src/content/combat';
import { AFFINITY_MULT, ENEMIES } from '../../src/content/enemies';
import { resolveHit, type HitInfo } from '../../src/sim/combat/hits';
import { BTN, combatWorld, forceEnemyAttack, hitsOn, hold, idle, lookahead, ofType, press, stepN } from './combatHelpers';
import { ctxOf } from './m1bHelpers';

/**
 * The M1b acceptance test for the weakness and resistance model (plan §4.6, owner's answer 3):
 * damage and poise damage are ×1.5 weak, ×1 normal, ×0.5 resist, exactly per each archetype's
 * profile; nothing is immune; reflected projectiles keep their kind.
 */

const ARCHETYPES = ['grunt', 'slinger', 'wisp', 'brute'] as const;
const KINDS: DamageKind[] = ['physical', 'arcane'];
const AFFINITIES = ['weak', 'normal', 'resist'];

const info = (over: Partial<HitInfo>): HitInfo => ({
  move: 'test', base: 20, kind: 'physical', poise: 8, hitstun: 0, knockdown: false, pushback: 0, hitstop: 0,
  unblockable: true, heavy: false, crit: false, mana: 0, from: { x: 0, y: 0, z: 0 }, projectile: true, ...over,
});

describe('profiles (plan §4.6, §4.9)', () => {
  it('match the §4.9 table', () => {
    expect(ENEMIES.grunt.profile).toEqual({ damage: { physical: 'normal', arcane: 'normal' }, status: { burn: 'weak', chill: 'normal', shock: 'normal' } });
    expect(ENEMIES.slinger.profile).toEqual({ damage: { physical: 'weak', arcane: 'resist' }, status: { burn: 'normal', chill: 'normal', shock: 'weak' } });
    expect(ENEMIES.brute.profile).toEqual({ damage: { physical: 'normal', arcane: 'resist' }, status: { burn: 'resist', chill: 'weak', shock: 'normal' } });
    expect(ENEMIES.wisp.profile).toEqual({ damage: { physical: 'resist', arcane: 'weak' }, status: { burn: 'normal', chill: 'resist', shock: 'weak' } });
    expect(AFFINITY_MULT).toEqual({ weak: 1.5, normal: 1, resist: 0.5 });
  });

  it('every enemy has a full profile and nothing is immune', () => {
    for (const [id, def] of Object.entries(ENEMIES)) {
      expect(Object.keys(def.profile.damage).sort(), id).toEqual(['arcane', 'physical']);
      expect(Object.keys(def.profile.status).sort(), id).toEqual(['burn', 'chill', 'shock']);
      for (const a of [...Object.values(def.profile.damage), ...Object.values(def.profile.status)]) expect(AFFINITIES, `${id}: ${a}`).toContain(a);
    }
  });

  it('across the four archetypes there is a physical resist, an arcane resist, and every status is a weakness somewhere', () => {
    const defs = ARCHETYPES.map((a) => ENEMIES[a]);
    expect(defs.some((d) => d.profile.damage.physical === 'resist')).toBe(true);
    expect(defs.some((d) => d.profile.damage.arcane === 'resist')).toBe(true);
    for (const s of ['burn', 'chill', 'shock'] as const) expect(defs.some((d) => d.profile.status[s] === 'weak'), s).toBe(true);
  });
});

describe('profile multipliers on damage and poise damage (M1b acceptance)', () => {
  for (const id of ARCHETYPES) {
    for (const kind of KINDS) {
      for (const projectile of [true, false]) {
        const aff = ENEMIES[id].profile.damage[kind];
        it(`${id} × ${kind} ${projectile ? 'projectile' : 'melee'}: ${aff} ×${AFFINITY_MULT[aff]}`, async () => {
          const { w, p } = await combatWorld();
          const e = w.spawnEnemy(id, { x: 0, y: 0, z: 40 }, Math.PI);
          p.combat!.level = e.combat!.level; // no level multiplier
          const ctx = ctxOf(w);
          resolveHit(ctx, p, e, info({ kind, projectile, from: { ...p.tf.pos } }));
          const k = AFFINITY_MULT[aff];
          const hit = ctx.events.find((x) => x.type === 'hit');
          expect(hit).toMatchObject({ damage: Math.round(20 * k), kind, affinity: aff });
          expect(e.vitals!.hp).toBe(ENEMIES[id].hp - Math.round(20 * k));
          expect(e.combat!.poise).toBe(ENEMIES[id].poise - 8 * k);
          w.dispose();
        });
      }
    }
  }

  it('in play: a staff light deals 20 × the physical multiplier (level 1 vs the level-2 Brute: ×0.95)', async () => {
    const want = { grunt: 20, slinger: 30, wisp: 10, brute: 19 };
    for (const id of ARCHETYPES) {
      const { w } = await combatWorld();
      const e = w.spawnEnemy(id, { x: 0, y: 0, z: 1.5 }, Math.PI);
      // Held in place (a Slinger or Wisp this close backs straight off; staggers carry no multiplier).
      e.combat!.action = { kind: 'stagger', t: 0, dur: 9999 };
      const evs = stepN(w, 20, (i) => (i === 0 ? press(BTN.light) : idle()));
      expect(hitsOn(evs, e.id).map((x) => [x.ev.move, x.ev.damage, x.ev.affinity]), id).toEqual([['light1', want[id], ENEMIES[id].profile.damage.physical]]);
      w.dispose();
    }
  });

  it('in play: an Arcane Bolt deals 12 × the arcane multiplier', async () => {
    const want = { grunt: 12, slinger: 6, wisp: 18, brute: 6 }; // brute: 12 × 0.5 × 0.95 = 5.7
    for (const id of ARCHETYPES) {
      const { w } = await combatWorld();
      const e = w.spawnEnemy(id, { x: 0, y: 0, z: 5 }, Math.PI);
      const evs = stepN(w, 20, (i) => (i === 0 ? press(BTN.spell1) : idle()));
      expect(hitsOn(evs, e.id).map((x) => [x.ev.move, x.ev.damage, x.ev.affinity]), id).toEqual([['bolt', want[id], ENEMIES[id].profile.damage.arcane]]);
      w.dispose();
    }
  });
});

describe('reflected projectiles keep their kind (plan §4.6)', () => {
  it("a parried Homing Hex flies back arcane and hits the Wisp's arcane weakness: 12 × 1.5 (reflect) × 1.5 (weak) = 27", async () => {
    const { w, p } = await combatWorld();
    const wisp = w.spawnEnemy('wisp', { x: 0, y: 0, z: 7 }, Math.PI);
    forceEnemyAttack(wisp, 'homingHex');
    // When would the hex hit the player? Raise the block 4 ticks before that and hold it.
    const arrive = lookahead(w, (ev) => ev.some((e) => e.type === 'hit' && e.target === p.id), 200);
    stepN(w, arrive - 4);
    const fired = w.entities.find((e) => e.projectile && e.projectile.owner === wisp.id)!;
    expect(fired.projectile!.kind).toBe('arcane');
    // Hold the Wisp still so the straight return flight can't miss it.
    wisp.combat!.action = { kind: 'stagger', t: 0, dur: 9999 };
    const evs = stepN(w, 80, (i) => (i === 0 ? press(BTN.block) : hold(BTN.block)));
    expect(ofType(evs, 'parry').map((x) => [x.ev.target, x.ev.projectile])).toEqual([[p.id, true]]);
    expect(hitsOn(evs, p.id).length).toBe(0);
    expect(hitsOn(evs, wisp.id).map((x) => [x.ev.attacker, x.ev.kind, x.ev.affinity, x.ev.damage])).toEqual([[p.id, 'arcane', 'weak', 27]]);
    w.dispose();
  });

  it('a parried coin flies back physical: on its Slinger (physical weak) 6 × 1.5 × 1.5 = 13.5 → 14', async () => {
    const { w, p } = await combatWorld();
    const s = w.spawnEnemy('slinger', { x: 0, y: 0, z: 9 }, Math.PI);
    s.brain!.cooldowns.coinBomb = 9999;
    forceEnemyAttack(s, 'coinBurst');
    const arrive = lookahead(w, (ev) => ev.some((e) => e.type === 'hit' && e.target === p.id), 200);
    stepN(w, arrive - 4);
    const evs = stepN(w, 3, (i) => (i === 0 ? press(BTN.block) : hold(BTN.block)));
    // Then hold the Slinger still so the first reflected coin's return flight can't miss.
    s.combat!.action = { kind: 'stagger', t: 0, dur: 9999 };
    evs.push(...stepN(w, 60, () => hold(BTN.block)));
    expect(ofType(evs, 'parry').length).toBeGreaterThan(0);
    const back = hitsOn(evs, s.id);
    expect(back.length).toBeGreaterThan(0);
    for (const h of back) expect([h.ev.attacker, h.ev.kind, h.ev.affinity, h.ev.damage]).toEqual([p.id, 'physical', 'weak', 14]);
    w.dispose();
  });
});
