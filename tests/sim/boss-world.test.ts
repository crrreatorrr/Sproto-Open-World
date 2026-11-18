import { describe, expect, it } from 'vitest';
import { AFFIXES, CAMP_GENERATION_FLAG } from '../../src/content/packs/c4';
import { ENEMIES } from '../../src/content/enemies';
import { BTN, cmd, step, stepN } from './combatHelpers';
import { BOSSES, bossWorld, startFight, tickAlive, toPhase, until, type BossId } from './bossHelpers';
import { VILLAGE_Y } from './m3Helpers';
import { campMembers, flatSproutvale, standAt } from './m4Helpers';

/** A scripted fight: the same inputs every run, ending on the world's hash. */
async function replay(id: BossId, seed: number): Promise<number[]> {
  const { w, p, boss } = await bossWorld(id, seed);
  startFight(w, p, boss);
  const hashes: number[] = [];
  for (const phase of [2, 3] as const) {
    toPhase(w, p, boss, phase);
    for (let i = 0; i < 500; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      p.vitals!.stamina = p.vitals!.staminaMax;
      step(w, cmd({ camYaw: i / 40, move: { x: Math.sin(i / 30), y: 1 }, press: i % 45 === 0 ? BTN.light : 0 }));
    }
    hashes.push(w.hash());
  }
  w.dispose();
  return hashes;
}

describe('boss fights are deterministic', () => {
  it.each(BOSSES)('%s: the same inputs give the same hash', async (id) => {
    expect(await replay(id, 7)).toEqual(await replay(id, 7));
  }, 60000);

  it('a snapshot taken while the Burrowmother is underground replays to the same hash', async () => {
    const { w, p, boss } = await bossWorld('burrowmother');
    startFight(w, p, boss);
    toPhase(w, p, boss, 2);
    until(w, p, () => !!boss.boss!.under, 4000, 'burrow');
    const snap = w.snapshot();
    const run = () => {
      const me = w.playerEntity(0)!;
      for (let i = 0; i < 400; i++) tickAlive(w, me);
      return w.hash();
    };
    const first = run();
    w.restore(snap);
    expect(run()).toBe(first);
    w.dispose();
  }, 30000);
});

describe('the Quarry Gate', () => {
  const GATE = { x: 352, z: 414 };
  /** Walk at the gate from one side for a few seconds; true if the player came out on the other. */
  async function walkThrough(open: boolean, reload: boolean): Promise<boolean> {
    let { w, p } = await flatSproutvale();
    const gate = w.entities.find((e) => e.obstacle?.id === 'gate_quarry')!;
    if (open) w.world.flags['gate:quarry'] = 1;
    stepN(w, 2);
    if (reload) {
      const save = w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' });
      w.dispose();
      ({ w, p } = await flatSproutvale());
      w.applySave(save);
      stepN(w, 2);
    }
    const yaw = gate.tf.yaw;
    const n = { x: Math.sin(yaw), z: Math.cos(yaw) };
    standAt(w, GATE.x - n.x * 4, GATE.z - n.z * 4);
    for (let i = 0; i < 150; i++) {
      p.vitals!.hp = p.vitals!.hpMax;
      step(w, cmd({ camYaw: yaw, move: { x: 0, y: 1 } }));
    }
    const side = (p.tf.pos.x - GATE.x) * n.x + (p.tf.pos.z - GATE.z) * n.z;
    w.dispose();
    return side > 1.2;
  }

  it('blocks the ravine until it is opened', async () => {
    expect(await walkThrough(false, false)).toBe(false);
  }, 30000);

  it('lets the player through once open', async () => {
    expect(await walkThrough(true, false)).toBe(true);
  }, 30000);

  it('is still open after a save and a reload', async () => {
    expect(await walkThrough(true, true)).toBe(true);
  }, 30000);

  it('a fight that resets does not shut it again', async () => {
    const { w, p, boss } = await bossWorld('scrapjaw');
    w.world.flags['gate:quarry'] = 1;
    stepN(w, 2);
    const gate = w.entities.find((e) => e.obstacle?.id === 'gate_quarry')!;
    startFight(w, p, boss);
    w.teleportPlayer(0, { x: 256, y: VILLAGE_Y + 0.05, z: 58 });
    stepN(w, 2);
    expect(gate.obstacle!.broken).toBe(true);
    expect(w.physics.hasObstacle(gate.id)).toBe(false);
    w.dispose();
  }, 30000);
});

describe('camp affixes', () => {
  /** The camp's rolls over many rests: what each member is, as the save would bring it back. */
  const rolls = (w: Awaited<ReturnType<typeof flatSproutvale>>['w']) => campMembers(w, 'mill_yard').map((e) => e.brain!.affix ?? '-');

  it('come back the same after a reload', async () => {
    const a = await flatSproutvale();
    for (const gen of [0, 1, 2, 3, 4, 5, 6, 7]) {
      a.w.world.flags[CAMP_GENERATION_FLAG] = gen;
      const save = a.w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' });
      a.w.applySave(save);
      const before = rolls(a.w);
      const b = await flatSproutvale();
      b.w.applySave(save);
      expect(rolls(b.w), `generation ${gen}`).toEqual(before);
      b.w.dispose();
    }
    a.w.dispose();
  }, 60000);

  it('never compound: every roll leaves a member at its own numbers, full, and the right size', async () => {
    const { w } = await flatSproutvale();
    const camp = campMembers(w, 'mill_yard');
    const seen = new Set<string>();
    for (let gen = 0; gen < 24; gen++) {
      w.world.flags[CAMP_GENERATION_FLAG] = gen;
      w.applySave(w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' }));
      for (const e of camp) {
        const def = ENEMIES[e.brain!.def];
        const fx = e.brain!.affix ? AFFIXES[e.brain!.affix] : undefined;
        seen.add(e.brain!.affix ?? '-');
        expect(e.vitals!.hpMax).toBe(Math.round(def.hp * (fx?.hp ?? 1)));
        expect(e.vitals!.hp).toBe(e.vitals!.hpMax);
        expect(e.body!.radius).toBeCloseTo(def.body.radius * (fx?.scale ?? 1), 6);
        expect(e.view.scale ?? 1).toBe(fx?.scale ?? 1);
      }
      expect(camp.filter((e) => e.brain!.affix && AFFIXES[e.brain!.affix].champion).length).toBeLessThanOrEqual(1);
    }
    expect(seen.size).toBeGreaterThan(1);
    w.dispose();
  }, 60000);
});
