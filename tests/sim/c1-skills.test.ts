import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import {
  PERKS, SKILL_EFFECT, SKILL_IDS, SKILL_MAX_RANK, hasPerk, noSkills, protectionMult, type SkillId,
} from '../../src/content/progression';
import { SPELLS, WOVEN } from '../../src/content/spells';
import type { UiAction } from '../../src/sim/commands';
import { spellCost, spellPower } from '../../src/sim/combat/spells';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { applyEffects } from '../../src/sim/systems/rpg';
import { BTN, combatWorld, hitsOn, hold, idle, press, step, stepN } from './combatHelpers';
import { evs, interact, rpgCtx, standBy, tick1, ui, village } from './m3Helpers';

/** C1 (expansion plan §7): the Magic and Combat skill tree, its perks, spending and respec. */

const spend = (skill: SkillId, n = 1): UiAction[] => Array.from({ length: n }, () => ({ kind: 'spendSkill', skill }) as const);

/** Set ranks directly (test setup) and re-derive stats through a zero-point spend refusal-free path. */
function withRanks(w: SimWorld, p: Entity, ranks: Partial<Record<SkillId, number>>): void {
  const total = Object.values(ranks).reduce((a, b) => a + (b ?? 0), 0);
  p.progress!.points = total;
  const acts: UiAction[] = [];
  for (const [k, n] of Object.entries(ranks)) acts.push(...spend(k as SkillId, n ?? 0));
  step(w, ui(acts));
}

/** light1 on a 0-defense level-1 dummy 1.5 m ahead: its damage. */
function light1On(w: SimWorld, p: Entity): number {
  const d = w.spawnEnemy('dummy_passive', { x: p.tf.pos.x, y: p.tf.pos.y, z: p.tf.pos.z + 1.5 }, Math.PI);
  p.tf.yaw = 0;
  const out = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
  return hitsOn(out, d.id)[0].ev.damage;
}

describe('spendSkill: anywhere, validated by the sim', () => {
  it('spends a point anywhere (no shrine needed): rank up, point down, event', async () => {
    const { w, prog } = await village();
    prog().points = 3;
    expect(prog().atShrine).toBeNull();
    const e = tick1(w, ui(spend('attack', 2)));
    expect(evs(e, 'skillSpent').map((x) => [x.skill, x.rank])).toEqual([['attack', 1], ['attack', 2]]);
    expect(prog().skills.attack).toBe(2);
    expect(prog().points).toBe(1);
    w.dispose();
  });

  it('refused with no points: nothing changes', async () => {
    const { w, prog } = await village();
    const e = tick1(w, ui(spend('defense')));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'spendSkill', reason: 'No skill points to spend.' }]);
    expect(prog().skills).toEqual(noSkills());
    w.dispose();
  });

  it(`refused at rank ${SKILL_MAX_RANK}: the point is kept`, async () => {
    const { w, prog } = await village();
    prog().points = 12;
    const e = tick1(w, ui(spend('stamina', 11)));
    expect(evs(e, 'skillSpent').length).toBe(10);
    expect(evs(e, 'refused')).toMatchObject([{ action: 'spendSkill', reason: 'That skill is at its highest rank.' }]);
    expect(prog().skills.stamina).toBe(10);
    expect(prog().points).toBe(2);
    w.dispose();
  });

  it('an unknown skill is refused', async () => {
    const { w, prog } = await village();
    prog().points = 1;
    const e = tick1(w, ui([{ kind: 'spendSkill', skill: 'might' as SkillId }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'spendSkill' }]);
    expect(prog().points).toBe(1);
    w.dispose();
  });

  it('boss skill points: the skillPoints effect adds to the pool', async () => {
    const { w, p, prog } = await village();
    const events: ReturnType<typeof rpgCtx>['events'] = [];
    applyEffects(rpgCtx(w, events), p, [{ skillPoints: 1 }]);
    expect(prog().points).toBe(1);
    expect(evs(events, 'skillPoints')).toMatchObject([{ amount: 1, total: 1 }]);
    w.dispose();
  });
});

describe('each skill’s effect (expansion plan §7.2)', () => {
  it('Spell Power: spell damage ×(1 + 0.04 · rank)', async () => {
    const { w, p } = await combatWorld();
    const base = spellPower('bolt', false, p);
    expect(base).toBeCloseTo(20 * SPELLS.bolt.mv, 9);
    withRanks(w, p, { spellPower: 5 });
    expect(spellPower('bolt', false, p)).toBeCloseTo(base * 1.2, 9);
    expect(spellPower('blast', true, p)).toBeCloseTo(20 * SPELLS.blast.mv * 1.2 * WOVEN.damage, 9);
    w.dispose();
  });

  it('Protection: a multiplier protection spells read; Frost Nova pushes 8% farther per rank', async () => {
    expect(protectionMult(undefined)).toBe(1);
    expect(protectionMult({ ...noSkills(), protection: 5 })).toBeCloseTo(1.4, 9);
    const push = async (ranks: number) => {
      const { w, p } = await combatWorld();
      withRanks(w, p, { protection: ranks });
      p.combat!.cooldowns = {};
      const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 2 }, Math.PI);
      step(w, press(BTN.spell3));
      for (let i = 0; i < SPELLS.frostNova.release + 1 && !g.combat!.push; i++) step(w);
      const pu = g.combat!.push!;
      w.dispose();
      return Math.hypot(pu.x, pu.z) * 6; // m per tick over the push's 6 ticks
    };
    const base = await push(0);
    expect(base).toBeCloseTo(SPELLS.frostNova.nova!.push, 6);
    expect(await push(5)).toBeCloseTo(base * 1.4, 6);
  });

  it('Focus: +5 max mana per rank and +3% mana regen per rank', async () => {
    const { w, p } = await combatWorld();
    withRanks(w, p, { focus: 4 });
    expect(p.vitals!.manaMax).toBe(PLAYER_STATS.mana + 20);
    p.vitals!.mana = 0;
    step(w);
    expect(p.vitals!.mana).toBeCloseTo(PLAYER_STATS.manaRegen * (1 / 60) * (1 + 4 * SKILL_EFFECT.focusRegen), 9);
    w.dispose();
  });

  it("Attack: a light's damage ×(1 + 0.04 · rank) — light1 20 → 24 at rank 5", async () => {
    const { w, p } = await combatWorld();
    withRanks(w, p, { attack: 5 });
    expect(light1On(w, p)).toBe(24);
    w.dispose();
  });

  it('Defense: +1 defense (both kinds) and +10 max HP per rank', async () => {
    const { w, p } = await combatWorld();
    withRanks(w, p, { defense: 3 });
    expect(p.combat!.defense).toEqual({ physical: 3, arcane: 3 });
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 30);
    expect(p.vitals!.hp).toBe(PLAYER_STATS.hp + 30); // growing a maximum grows the current value
    w.dispose();
  });

  it('Stamina: +5 max stamina per rank', async () => {
    const { w, p } = await combatWorld();
    withRanks(w, p, { stamina: 2 });
    expect(p.vitals!.staminaMax).toBe(PLAYER_STATS.stamina + 10);
    w.dispose();
  });
});

describe('milestone perks at branch totals 10 and 20', () => {
  it('a perk event when a branch reaches 10 and 20; split builds get nothing', async () => {
    const { w, p } = await combatWorld();
    p.progress!.points = 30;
    const e1 = step(w, ui([...spend('spellPower', 5), ...spend('attack', 5), ...spend('focus', 4)]));
    expect(evs(e1, 'perk')).toEqual([]);
    const e2 = step(w, ui(spend('protection')));
    expect(evs(e2, 'perk')).toMatchObject([{ perk: 'magic10' }]);
    const e3 = step(w, ui([...spend('protection', 9), ...spend('focus', 1)]));
    expect(evs(e3, 'perk')).toMatchObject([{ perk: 'magic20' }]);
    expect(hasPerk(p.progress!.skills, 'combat10')).toBe(false);
    expect(Object.values(PERKS).map((x) => x.at)).toEqual([10, 20, 10, 20, 10, 20]);
    w.dispose();
  });

  it('Magic 10: woven casts cost 15% less mana (plain casts full price)', async () => {
    const { w, p } = await combatWorld();
    expect(spellCost(p, 'blast', true)).toBe(30);
    withRanks(w, p, { spellPower: 10 });
    expect(spellCost(p, 'blast', true)).toBeCloseTo(25.5, 9);
    expect(spellCost(p, 'blast', false)).toBe(30);
    // In the sim: a woven Blast right after a hit.
    p.combat!.cooldowns = {};
    p.combat!.lastHitTick = w.now;
    const mana = p.vitals!.mana;
    const e = step(w, press(BTN.spell2));
    expect(evs(e, 'castStart')).toMatchObject([{ spell: 'blast', woven: true }]);
    // 25.5 spent, less this tick's regen.
    expect(p.vitals!.mana).toBeLessThan(mana - 25);
    expect(p.vitals!.mana).toBeGreaterThan(mana - 26);
    w.dispose();
  });

  it('Magic 20: a protection spell (Frost Nova) also cleanses one status; without it, nothing', async () => {
    const run = async (perk: boolean) => {
      const { w, p } = await combatWorld();
      if (perk) withRanks(w, p, { protection: 10, spellPower: 10 });
      p.combat!.cooldowns = {};
      p.statuses = { burn: { ticks: 300, perTick: 0.01, source: p.id }, chill: { ticks: 300, stacks: 1 } };
      step(w, press(BTN.spell3));
      const out = stepN(w, SPELLS.frostNova.release + 2);
      const s = { ...p.statuses };
      w.dispose();
      return { s, cleanse: out.filter((x) => x.ev.type === 'cleanse').map((x) => x.ev) };
    };
    const off = await run(false);
    expect(off.s.burn && off.s.chill).toBeTruthy();
    const on = await run(true);
    expect(on.s.burn).toBeUndefined();
    expect(on.s.chill).toBeTruthy();
    expect(on.cleanse).toMatchObject([{ status: 'burn' }]);
  });

  /** The swinging dummy 1.5 m ahead connects on world tick SWING_HIT (tests/sim/combat-block.test.ts). */
  const SWING_HIT = 54;

  it('Combat 10: a parry restores 5% HP', async () => {
    const parried = async (perk: boolean) => {
      const { w, p } = await combatWorld();
      if (perk) withRanks(w, p, { attack: 10 });
      w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
      const t0 = w.now;
      p.vitals!.hp = 50;
      let parry = false;
      while (w.now - t0 <= SWING_HIT) parry = step(w, w.now - t0 >= SWING_HIT - 5 ? hold(BTN.block) : idle()).some((x) => x.type === 'parry') || parry;
      const out = { parry, hp: p.vitals!.hp, max: p.vitals!.hpMax };
      w.dispose();
      return out;
    };
    const off = await parried(false);
    expect(off.parry).toBe(true);
    expect(off.hp).toBeCloseTo(50, 0);
    const on = await parried(true);
    expect(on.parry).toBe(true);
    expect(on.hp - off.hp).toBeCloseTo(on.max * 0.05, 6);
  });

  it("Combat 20: you can't be knocked out of an attack (a hit lands, the swing goes on)", async () => {
    const hitDuring = async (perk: boolean) => {
      // Facing away from the swinging dummy: a light that whiffs, started so it's mid-swing at the hit.
      const { w, p } = await combatWorld({ yaw: Math.PI });
      if (perk) withRanks(w, p, { attack: 10, defense: 10 });
      w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
      const t0 = w.now;
      let hit = false;
      let kind: string | null = null;
      while (w.now - t0 <= SWING_HIT) {
        const ev = step(w, w.now - t0 === SWING_HIT - 4 ? press(BTN.light) : idle());
        if (ev.some((x) => x.type === 'hit' && x.target === p.id)) {
          hit = true;
          kind = p.combat!.action?.kind ?? null;
        }
      }
      w.dispose();
      return { hit, kind };
    };
    const off = await hitDuring(false);
    expect(off).toEqual({ hit: true, kind: 'hitstun' });
    const on = await hitDuring(true);
    expect(on).toEqual({ hit: true, kind: 'attack' });
  });
});

describe('respecSkills: only at a shrine, for 100 × level Sprouts', () => {
  it('refused away from a shrine: nothing changes', async () => {
    const { w, prog } = await village();
    prog().points = 2;
    prog().sprouts = 1000;
    tick1(w, ui(spend('attack', 2)));
    const e = tick1(w, ui([{ kind: 'respecSkills' }]));
    expect(evs(e, 'refused')).toMatchObject([{ action: 'respecSkills', reason: 'Reset your skills at a shrine.' }]);
    expect(prog().skills.attack).toBe(2);
    expect(prog().sprouts).toBe(1000);
    w.dispose();
  });

  async function atShrine() {
    const v = await village();
    standBy(v.w, 'shrine_first_light');
    tick1(v.w, interact());
    expect(v.prog().atShrine).toBe('shrine_first_light');
    return v;
  }

  it('at a shrine: refunds every rank into points and charges 100 × level', async () => {
    const { w, p, prog } = await atShrine();
    prog().level = 4;
    prog().points = 6;
    prog().sprouts = 450;
    tick1(w, ui([...spend('defense', 3), ...spend('focus', 2)]));
    expect(p.vitals!.hpMax).toBe(PLAYER_STATS.hp + 30 + 12 * 3);
    const e = tick1(w, ui([{ kind: 'respecSkills' }]));
    expect(evs(e, 'skillsReset')).toMatchObject([{ refunded: 5, cost: 400 }]);
    expect(prog().skills).toEqual(noSkills());
    expect(prog().points).toBe(6);
    expect(prog().sprouts).toBe(50);
    expect(p.combat!.defense).toEqual({ physical: 0, arcane: 0 });
    w.dispose();
  });

  it('at a shrine: refused without the Sprouts, or with nothing spent', async () => {
    const { w, prog } = await atShrine();
    expect(evs(tick1(w, ui([{ kind: 'respecSkills' }])), 'refused')).toMatchObject([{ reason: 'No skill points spent yet.' }]);
    prog().points = 1;
    prog().sprouts = 99;
    tick1(w, ui(spend('attack')));
    expect(evs(tick1(w, ui([{ kind: 'respecSkills' }])), 'refused')).toMatchObject([{ reason: 'Resetting costs 100 Sprouts.' }]);
    expect(prog().skills.attack).toBe(1);
    w.dispose();
  });

  it('every skill id is covered by the tree', () => {
    expect([...SKILL_IDS].sort()).toEqual(['attack', 'defense', 'focus', 'handling', 'logistics', 'marksmanship', 'protection', 'spellPower', 'stamina']);
  });
});
