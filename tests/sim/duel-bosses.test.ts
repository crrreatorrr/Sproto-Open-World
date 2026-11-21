import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/assets/manifest';
import { ENEMIES, enemyStage } from '../../src/content/enemies';
import { DROPS } from '../../src/content/loot';
import { DUEL_BOSS_ENEMIES, DUEL_BOSS_IDS } from '../../src/content/packs/duelBosses';
import { OVERWORLD_MIX_CAMPS } from '../../src/content/packs/overworldMix';
import { SANDBOX } from '../../src/content/sandbox';
import { idleInput } from '../../src/sim/commands';
import type { SimEvent } from '../../src/sim/events';
import { combatWorld, step, teleport } from './combatHelpers';

/** An empty yard: nothing in the way of a boss. */
const YARD = { ...SANDBOX, enemies: [], shapes: [], ground: { size: 400, color: 0 } };
/** Every boss that changes with its phases: the two that were here, and the imports. */
const STAGED_BOSSES = ['mega_tinubu', 'hex_sahil', ...DUEL_BOSS_IDS];
/** The models the rigs' clips come with. */
const CLIPS: Record<string, readonly string[]> = Object.fromEntries(Object.entries(MODELS).map(([k, m]) => [k, 'clips' in m ? m.clips : []]));

describe('stages of the Duel and Shooter bosses', () => {
  it('every staged enemy names models the game has, one per stage, starting on the first', () => {
    for (const def of Object.values(ENEMIES)) {
      for (const m of def.stageModels ?? []) expect(m in MODELS, `${def.id}: ${m}`).toBe(true);
      if (!def.stageScale) continue;
      expect(def.stageScale.length, def.id).toBe(3);
      if (def.stageModels) {
        expect(def.stageModels.length, def.id).toBe(3);
        expect(def.model, def.id).toBe(def.stageModels[0]);
      }
      // Each stage is at least as big as the one before, and none is far from the body it is fought on.
      for (let i = 1; i < 3; i++) expect(def.stageScale[i], def.id).toBeGreaterThanOrEqual(def.stageScale[i - 1]);
      expect(def.stageScale[0], def.id).toBeGreaterThanOrEqual(0.7);
      expect(def.stageScale[2], def.id).toBeLessThanOrEqual(1.2);
    }
  });

  it('every Duel boss has all three of its stages, and every Shooter boss grows', () => {
    const stages = (id: string) => ENEMIES[id].stageModels;
    expect(stages('hex_sahil')).toEqual(['sahil_stage1', 'sahil_stage2', 'sahil_stage3']);
    expect(stages('duel_obama')).toEqual(['slinger', 'slinger_vet', 'obama_stage3']);
    expect(stages('duel_midget')).toEqual(['grunt', 'grunt_vet', 'midget_stage3']);
    expect(stages('broccoli_head')).toEqual(['broccoli_stage1', 'broccoli_stage2', 'broccoli_stage3']);
    expect(stages('glowie')).toEqual(['agent_stage1', 'agent_stage2', 'agent_stage3']);
    expect(stages('mega_tinubu')).toEqual(['tinubu_stage1', 'tinubu_stage2', 'tinubu_stage3']);
    for (const id of ['scrapjaw', 'burrowmother', 'skyfire_drake', 'blue_monster', 'sproto_beast']) expect(ENEMIES[id].stageScale?.[2], id).toBeGreaterThan(1);
  });

  it('a boss shows the stage of its phase; anyone else steps at two thirds and one third of its health', () => {
    const boss = ENEMIES.broccoli_head, midget = ENEMIES.duel_midget;
    expect([1, 2, 3].map((p) => enemyStage(boss, p, 1))).toEqual([0, 1, 2]);
    expect([1, 0.67, 0.66, 0.34, 0.33, 0].map((hp) => enemyStage(midget, undefined, hp))).toEqual([0, 0, 1, 1, 2, 2]);
    // The Shooter's ordinary enemies list their kind's models but never change.
    expect(enemyStage(ENEMIES.midget_swarmer, undefined, 0.1)).toBe(0);
    expect(enemyStage(ENEMIES.grunt, 3, 0.1)).toBe(0);
  });

  it('every attack plays a clip its model has, on every stage', () => {
    for (const def of Object.values(DUEL_BOSS_ENEMIES)) {
      for (const model of def.stageModels ?? [def.model]) {
        for (const m of def.moves) if (m.clip) expect(CLIPS[model], `${def.id}.${m.id} on ${model}`).toContain(m.clip);
      }
      expect(def.moves.some((m) => m.clip && !m.noHit), def.id).toBe(true);
    }
  });

  it('each has loot, a place in the world, and phase moves that exist', () => {
    for (const def of Object.values(DUEL_BOSS_ENEMIES)) {
      expect(DROPS[def.id], def.id).toBeDefined();
      for (const m of def.moves) if (m.followUp) expect(def.moves.some((x) => x.id === m.followUp), `${def.id}.${m.id}`).toBe(true);
      if (!def.boss) continue;
      expect(def.moves.some((m) => m.id === def.boss!.roar), def.id).toBe(true);
      expect(def.boss.summon.def in ENEMIES, def.id).toBe(true);
      // Something to do in every phase, up close and from range.
      for (const phase of [1, 2, 3]) {
        const usable = def.moves.filter((m) => !m.chainOnly && (!m.phases || m.phases.includes(phase)));
        expect(usable.some((m) => m.range <= 6), `${def.id} phase ${phase} close`).toBe(true);
        expect(usable.some((m) => m.range >= 12), `${def.id} phase ${phase} far`).toBe(true);
      }
    }
    for (const id of DUEL_BOSS_IDS) {
      const camps = OVERWORLD_MIX_CAMPS.filter((c) => c.members.some((m) => m.def === id));
      expect(camps.length, id).toBe(1);
      expect(camps[0].isWorldBoss, id).toBe(true);
      expect(camps[0].members.find((m) => m.def === id)!.unique, id).toBeTruthy();
      const lv = ENEMIES[id].level;
      expect(lv >= camps[0].levelRange[0] && lv <= camps[0].levelRange[1], id).toBe(true);
    }
    for (const id of ['floret_sprout', 'glowie_agent']) expect(OVERWORLD_MIX_CAMPS.some((c) => !c.isWorldBoss && c.members.some((m) => m.def === id)), id).toBe(true);
  });
});

describe('their fights', () => {
  it.each(STAGED_BOSSES)('%s: starts, turns through three phases with its attacks, and falls', async (id) => {
    const { w, p } = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: 9 } });
    const def = ENEMIES[id];
    const boss = w.spawnEnemy(id, { x: 0, y: 0, z: 0 }, 0);
    const events: SimEvent[] = [];
    const used = new Set<string>();
    let shots = 0;
    const tick = () => {
      p.vitals!.hp = p.vitals!.hpMax;
      // The player stays put, in front of it: hits and shoves may not carry them out of the fight.
      if (Math.hypot(p.tf.pos.x, p.tf.pos.z - 9) > 6) teleport(w, p, { x: 0, y: 0, z: 9 });
      const evs = step(w, idleInput(p.tf.yaw));
      events.push(...evs);
      const a = boss.combat?.action;
      if (a?.kind === 'attack') used.add(a.move);
      shots = Math.max(shots, w.entities.filter((e) => e.projectile && e.projectile.owner === boss.id).length);
    };
    for (let i = 0; i < 900 && boss.boss!.state !== 'fight'; i++) tick();
    expect(boss.boss!.state, 'the fight starts').toBe('fight');
    expect(boss.boss!.phase).toBe(1);
    for (let i = 0; i < 900; i++) tick();
    for (const phase of [2, 3] as const) {
      boss.vitals!.hp = boss.vitals!.hpMax * (phase === 2 ? def.boss!.phase2 : def.boss!.phase3) - 1;
      for (let i = 0; i < 1200 && boss.boss!.phase !== phase; i++) tick();
      expect(boss.boss!.phase, `phase ${phase}`).toBe(phase);
      for (let i = 0; i < 900; i++) tick();
    }
    expect(events.filter((e) => e.type === 'bossPhase').map((e) => (e as { phase: number }).phase)).toEqual([2, 3]);
    expect(used.has(def.boss!.roar), 'it roars').toBe(true);
    // It fights with more than one move, and whatever it throws leaves its hand.
    expect([...used].filter((m) => m !== def.boss!.roar).length, [...used].join(',')).toBeGreaterThanOrEqual(2);
    if (def.moves.some((m) => m.projectile && used.has(m.id))) expect(shots).toBeGreaterThan(0);
    expect(events.some((e) => e.type === 'bossSummon')).toBe(true);
    const adds = w.entities.filter((e) => e.brain?.summoned);
    expect(adds.length).toBeGreaterThan(0);
    expect(adds.every((e) => e.brain!.def === def.boss!.summon.def)).toBe(true);

    boss.vitals!.hp = 0.5;
    boss.statuses = { burn: { ticks: 60, perTick: 5, source: p.id } };
    for (let i = 0; i < 300 && boss.combat?.action?.kind !== 'dead'; i++) tick();
    expect(boss.combat?.action?.kind).toBe('dead');
    // Its adds fall with it.
    expect(w.entities.filter((e) => e.brain?.summoned && e.combat?.action?.kind !== 'dead')).toEqual([]);
    w.dispose();
  }, 60_000);

  it('The Midget comes in the moment Bitcoin Obama\'s fight starts', async () => {
    const { w, p } = await combatWorld({ level: YARD, pos: { x: 0, y: 0, z: 9 } });
    const boss = w.spawnEnemy('duel_obama', { x: 0, y: 0, z: 0 }, 0);
    for (let i = 0; i < 900 && !w.entities.some((e) => e.brain?.def === 'duel_midget'); i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      step(w, idleInput(p.tf.yaw));
    }
    expect(boss.boss!.state).toBe('fight');
    expect(boss.vitals!.hp).toBe(boss.vitals!.hpMax);
    const midget = w.entities.find((e) => e.brain?.def === 'duel_midget')!;
    expect(midget.brain!.target).toBe(p.id);
    expect(midget.boss).toBeUndefined();
    w.dispose();
  });
});
