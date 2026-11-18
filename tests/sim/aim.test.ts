import { describe, expect, it } from 'vitest';
import { BTN, idleInput, type AimRay, type InputCommand } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { combatWorld, step } from './combatHelpers';
import { SANDBOX } from '../../src/content/sandbox';

/** Aiming at the centre of the screen: the camera's ray decides where spells and resting swings go. */
const level = { ...SANDBOX, enemies: [] };
const world = () => combatWorld({ level });

/** A camera 4.6 m behind and 1.95 m above the player at the origin, looking at `to`. */
function rayTo(to: { x: number; y: number; z: number }): AimRay {
  const from = { x: 0, y: 1.95, z: -4.6 };
  const d = { x: to.x - from.x, y: to.y - from.y, z: to.z - from.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { from, dir: { x: d.x / l, y: d.y / l, z: d.z / l } };
}
const chest = (e: Entity) => ({ x: e.tf.pos.x, y: e.tf.pos.y + 1, z: e.tf.pos.z });
function cmd(aim: AimRay, press = 0, move = { x: 0, y: 0 }): InputCommand {
  return { ...idleInput(0), aim, pressed: press, held: press, move };
}
function castBolt(w: SimWorld, aim: AimRay): Entity {
  step(w, cmd(aim, BTN.spell1));
  for (let i = 0; i < 40; i++) {
    step(w, cmd(aim));
    const b = w.entities.find((e) => e.projectile);
    if (b) return b;
  }
  throw new Error('no bolt');
}

describe('spells go to the centre of the screen', () => {
  it('a bolt with no enemy under the crosshair flies to the spot on the ground the camera looks at', async () => {
    const { w } = await world();
    const point = { x: 9, y: 0, z: 14 };
    const b = castBolt(w, rayTo(point));
    const v = b.tf.vel, d = { x: point.x - b.tf.pos.x, y: point.y - b.tf.pos.y, z: point.z - b.tf.pos.z };
    const dl = Math.hypot(d.x, d.y, d.z), vl = Math.hypot(v.x, v.y, v.z);
    expect((v.x * d.x + v.y * d.y + v.z * d.z) / (dl * vl)).toBeGreaterThan(0.999);
    w.dispose();
  });

  it('the enemy under the crosshair is hit, not the one the player faces', async () => {
    const { w } = await world();
    const ahead = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 8 }, Math.PI);
    const side = w.spawnEnemy('dummy_passive', { x: 7, y: 0, z: 8 }, Math.PI);
    const aim = rayTo(chest(side));
    castBolt(w, aim);
    let hit: number | null = null;
    for (let i = 0; i < 120 && hit === null; i++) for (const e of step(w, cmd(aim))) if (e.type === 'hit') hit = e.target;
    expect(hit).toBe(side.id);
    expect(ahead.vitals!.hp).toBe(ahead.vitals!.hpMax);
    w.dispose();
  });

  it('an enemy between the camera and the player can not be aimed at', async () => {
    const { w, p } = await world();
    const behind = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: -2.5 }, 0);
    expect(w.view().aimTarget(0, rayTo({ x: 0, y: 1, z: 10 }))).toBeNull();
    expect(behind.id).not.toBe(p.id);
    w.dispose();
  });

  it('a near miss counts, a clear miss does not', async () => {
    const { w } = await world();
    const e = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 12 }, Math.PI);
    expect(w.view().aimTarget(0, rayTo({ x: e.body!.radius + 0.3, y: 1, z: 12 }))).toBe(e.id);
    expect(w.view().aimTarget(0, rayTo({ x: 3, y: 1, z: 12 }))).toBeNull();
    w.dispose();
  });
});

describe('melee (soulslike: the stick first, then the screen)', () => {
  it('with the stick at rest, a swing turns to the centre of the screen', async () => {
    const { w, p } = await world();
    step(w, cmd(rayTo({ x: 10, y: 1, z: -4.6 }), BTN.light));
    expect(p.combat!.action?.kind).toBe('attack');
    expect(Math.sin(p.tf.yaw)).toBeGreaterThan(0.95);
    w.dispose();
  });

  it('pushing the stick swings that way, whatever the camera looks at', async () => {
    const { w, p } = await world();
    step(w, cmd(rayTo({ x: 0, y: 1, z: 10 }), BTN.light, { x: -1, y: 0 }));
    expect(p.combat!.action?.kind).toBe('attack');
    expect(Math.abs(Math.sin(p.tf.yaw))).toBeGreaterThan(0.95);
    expect(Math.abs(Math.cos(p.tf.yaw))).toBeLessThan(0.3);
    w.dispose();
  });

  it('a hard lock still wins over the crosshair', async () => {
    const { w, p } = await world();
    const e = w.spawnEnemy('dummy_passive', { x: 0, y: 0, z: 3 }, Math.PI);
    p.combat!.lock = e.id;
    step(w, cmd(rayTo({ x: 10, y: 1, z: -4.6 }), BTN.light));
    const a = p.combat!.action;
    expect(a?.kind === 'attack' && a.lungeDir.z).toBeGreaterThan(0.95);
    w.dispose();
  });

  it('the same aimed commands replay to the same hash', async () => {
    const run = async () => {
      const { w } = await world();
      w.spawnEnemy('dummy_passive', { x: 2, y: 0, z: 3 }, Math.PI);
      for (let i = 0; i < 180; i++) step(w, cmd(rayTo({ x: Math.sin(i / 20) * 6, y: 1, z: 6 }), i % 40 === 0 ? BTN.light : i % 40 === 20 ? BTN.spell1 : 0));
      const h = w.hash();
      w.dispose();
      return h;
    };
    expect(await run()).toBe(await run());
  });
});
