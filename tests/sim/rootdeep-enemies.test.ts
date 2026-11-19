import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import { BTN, idleInput } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimSnapshot, SimWorld } from '../../src/sim/SimWorld';
import { combatWorld, stepN } from './combatHelpers';
import { bakedWorld, prog, rest, slay, tick, use } from './quests-helpers';

/**
 * Rootdeep Quest 5: a cave enemy does not see through rock, the vault stays shut until all three
 * levers are pulled, the Deep Warden does not come back, and the chest pays Rootcleaver once.
 */

const yard = (shapes: LevelDef['shapes']): LevelDef => ({ ...SANDBOX, enemies: [], shapes, ground: { size: 80, color: 0 } });

/**
 * Flat ground, the player at the origin and one enemy `dist` metres north, inside a 14 m aggro
 * range. The wall test puts a solid 4 m box across the gap. Level shapes are stepped when the
 * physics world is built, and one more step here makes the raycast see the wall before any brain
 * tick: otherwise the first tick engages and the chase keeps the target.
 */
async function level(def: string, dist: number, wall: boolean): Promise<{ w: SimWorld; e: Entity }> {
  const shapes: LevelDef['shapes'] = wall ? [{ kind: 'box', pos: [0, 2, dist / 2], half: [8, 2, 0.4] }] : [];
  const { w } = await combatWorld({ pos: { x: 0, y: 0, z: 0 }, level: yard(shapes) });
  w.physics.step();
  const e = w.spawnEnemy(def, { x: 0, y: 0, z: dist }, Math.PI);
  return { w, e };
}

const hurt = (e: Entity) => {
  e.vitals!.hp = e.vitals!.hpMax - 1;
};

const byDef = (w: SimWorld, def: string) => w.entities.find((e) => e.brain?.def === def);

describe('cave enemies and sight', () => {
  it('does not notice a player behind a wall', async () => {
    const { w, e } = await level('rd_grunt', 10, true);
    stepN(w, 60);
    expect(e.brain!.target).toBeNull();
    w.dispose();
  });

  it('notices a player in plain sight', async () => {
    const { w, e } = await level('rd_grunt', 10, false);
    stepN(w, 60);
    expect(e.brain!.target).not.toBeNull();
    w.dispose();
  });

  it('still chases someone who hurt it from behind a wall', async () => {
    const { w, e } = await level('rd_grunt', 10, true);
    hurt(e);
    stepN(w, 10);
    expect(e.brain!.target).not.toBeNull();
    w.dispose();
  });

  it('leaves surface enemies exactly as they were', () => {
    expect(ENEMIES.grunt.needsSight).toBeUndefined();
    expect(ENEMIES.brute.needsSight).toBeUndefined();
  });
});

describe('the vault gate, the Deep Warden and the chest', () => {
  let w: SimWorld;
  let fresh: SimSnapshot;

  beforeAll(async () => {
    w = await bakedWorld();
    fresh = w.snapshot();
  }, 120_000);

  beforeEach(() => {
    w.restore(fresh);
  });

  afterAll(() => w?.dispose());

  it('keeps the vault gate shut until all three levers are pulled', () => {
    use(w, 'rootdeep_lever_a');
    use(w, 'rootdeep_lever_b');
    use(w, 'rootdeep_vault_lock');
    expect(w.world.flags['gate:rootdeep_vault']).toBeUndefined();
    expect(w.world.flags['used:rootdeep_vault_lock']).toBeUndefined();
    use(w, 'rootdeep_lever_c');
    use(w, 'rootdeep_vault_lock');
    expect(w.world.flags['gate:rootdeep_vault']).toBe(1);
  });

  it('never brings the Deep Warden back after a rest', () => {
    const e = byDef(w, 'deep_warden');
    expect(e).toBeDefined();
    slay(w, e!, true);
    // A unique's body is removed after it has lain there; the rest must not put one back.
    for (let i = 0; i < 400 && byDef(w, 'deep_warden'); i++) tick(w);
    expect(byDef(w, 'deep_warden')).toBeUndefined();
    rest(w, 'shrine_rootdeep_lantern');
    expect(byDef(w, 'deep_warden')).toBeUndefined();
    expect(w.world.killedUniques).toContain('deep_warden');
  });

  it('gives Rootcleaver from the vault chest once', () => {
    const warden = byDef(w, 'deep_warden');
    if (warden) slay(w, warden, true);
    const before = prog(w).sprouts;
    use(w, 'chest_rootdeep_vault');
    expect(prog(w).inventory.staff_rootcleaver).toBe(1);
    expect(prog(w).sprouts - before).toBe(250);
    const yaw = w.playerEntity(0)!.tf.yaw;
    const again = idleInput(yaw);
    again.pressed = again.held = BTN.interact;
    tick(w, again);
    expect(prog(w).inventory.staff_rootcleaver).toBe(1);
    expect(prog(w).sprouts - before).toBe(250);
  });
});
