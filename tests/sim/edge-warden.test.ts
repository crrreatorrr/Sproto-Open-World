import { describe, expect, it } from 'vitest';
import { EDGE_WARDEN as W } from '../../src/content/packs/edge';
import { TICK_HZ } from '../../src/content/tuning';
import { CELL_RES, type CellColliders } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { edgeDistance } from '../../src/sim/systems/edgeWarden';
import { step } from './combatHelpers';
import { ui } from './m3Helpers';

/**
 * The Edge Warden (far-view plan §3.10): a dragon that appears when a player nears the world's edge,
 * warns, then fires without stopping. It can't be hurt, and its burn kills from full health.
 */

const Y = 13.5;
const EDGE = { minX: 0, minZ: 0, maxX: 512, maxZ: 512 };
const SECOND = TICK_HZ;

/** A flat 512 m square world whose rectangle is the world's edge, the player standing at (x, z). */
async function world(x: number, z: number, edge: typeof EDGE | null = EDGE, seed = 1): Promise<{ w: SimWorld; p: Entity }> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'edge', playerStart: { pos: [256, Y + 0.05, 256], yaw: 0 } }, edge ?? undefined), seed);
  const p = w.spawnPlayer(0);
  for (let cx = 0; cx < 8; cx++) {
    for (let cz = 0; cz < 8; cz++) w.loadCell({ cx, cz, heights: new Float32Array(CELL_RES * CELL_RES).fill(Y), shapes: [] } as CellColliders);
  }
  while (!w.cellReady(7, 7) || !w.cellReady(0, 0)) step(w);
  w.teleportPlayer(0, { x, y: Y + 0.05, z });
  return { w, p };
}

const wardens = (w: SimWorld) => w.entities.filter((e) => e.warden);
const shots = (w: SimWorld) => w.entities.filter((e) => e.projectile && wardens(w).some((d) => d.id === e.projectile!.owner));
const dead = (e: Entity) => e.combat?.action?.kind === 'dead';

function run(w: SimWorld, ticks: number, each?: (w: SimWorld) => void): SimEvent[] {
  const out: SimEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    out.push(...step(w));
    each?.(w);
  }
  return out;
}

describe('the Edge Warden', () => {
  it('measures the distance to the nearest edge, and sees a fast flier coming', () => {
    expect(edgeDistance(EDGE, { x: 256, y: 0, z: 256 }, { x: 0, y: 0, z: 0 })).toBe(256);
    expect(edgeDistance(EDGE, { x: 10, y: 0, z: 256 }, { x: 0, y: 0, z: 0 })).toBe(10);
    expect(edgeDistance(EDGE, { x: 256, y: 0, z: 500 }, { x: 0, y: 0, z: 0 })).toBe(12);
    // 100 m inside, flying out at 40 m/s: it counts as where they will be in a moment.
    expect(edgeDistance(EDGE, { x: 100, y: 0, z: 256 }, { x: -40, y: 0, z: 0 })).toBeLessThanOrEqual(W.warn);
    // Flying inland from the same place counts as where they are.
    expect(edgeDistance(EDGE, { x: 100, y: 0, z: 256 }, { x: 40, y: 0, z: 0 })).toBe(100);
    // Outside the rectangle (the Rootdeep, far to the east): no edge to guard.
    expect(edgeDistance(EDGE, { x: 4200, y: 0, z: 100 }, { x: 0, y: 0, z: 0 })).toBe(Infinity);
  });

  it('stays away from a player who keeps clear of the edge', async () => {
    const { w } = await world(W.warn + 20, 256);
    const ev = run(w, 10 * SECOND);
    expect(wardens(w)).toHaveLength(0);
    expect(ev.some((e) => e.type === 'edgeWarden')).toBe(false);
    w.dispose();
  });

  it('appears at the warning distance, and holds its fire through the grace', async () => {
    const { w, p } = await world(W.warn - 2, 256);
    const ev = run(w, 3);
    expect(wardens(w)).toHaveLength(1);
    expect(ev.filter((e) => e.type === 'edgeWarden')).toEqual([{ type: 'edgeWarden', entity: p.id, warden: wardens(w)[0].id, phase: 'appear' }]);
    // Right at the edge, and still nothing is fired until the grace is over.
    w.teleportPlayer(0, { x: 3, y: Y + 0.05, z: 256 });
    run(w, W.graceTicks - 10, (s) => expect(shots(s)).toHaveLength(0));
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('only watches a player in the warning band who never enters the strike band', async () => {
    const { w, p } = await world(W.strike + 4, 256);
    run(w, W.graceTicks + 10 * SECOND, (s) => expect(shots(s)).toHaveLength(0));
    expect(wardens(w)).toHaveLength(1);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('fires a lot once the grace is over, and kills a player who stays', async () => {
    const { w, p } = await world(4, 256);
    // It leaves once the player is dead, so its id is noted while it is here.
    const ids = new Set<number>();
    const ev = run(w, W.graceTicks + 12 * SECOND, (s) => wardens(s).forEach((d) => ids.add(d.id)));
    const fired = ev.filter((e) => e.type === 'fire' && ids.has(e.entity)).length;
    // Three fireballs take a full bar (40% each); it stops when the player is down.
    expect(fired).toBeGreaterThanOrEqual(3);
    expect(ev.some((e) => e.type === 'edgeWarden' && e.phase === 'strike')).toBe(true);
    expect(ev.some((e) => e.type === 'death' && e.entity === p.id)).toBe(true);
    w.dispose();
  });

  it('its burn takes all of a full health bar, and a ward cannot turn it', async () => {
    const { w, p } = await world(4, 256);
    let burn: Entity | undefined;
    run(w, W.graceTicks + W.burnEvery + W.burnTelegraph + 2 * SECOND, (s) => {
      burn ??= shots(s).find((e) => e.projectile!.unstoppable);
      // Kept alive through the barrage, so the burn is what this test sees.
      if (!burn) p.vitals!.hp = p.vitals!.hpMax;
    });
    expect(burn).toBeDefined();
    expect(burn!.projectile!.hpFrac).toBe(1);
    w.dispose();
  });

  it("can't be hurt: it has no health, no body and no combat state to hit", async () => {
    const { w } = await world(4, 256);
    run(w, 30);
    const d = wardens(w)[0];
    expect(d.vitals).toBeUndefined();
    expect(d.combat).toBeUndefined();
    expect(d.body).toBeUndefined();
    expect(d.brain).toBeUndefined();
    w.dispose();
  });

  it('breaks off and leaves when the player goes back inland', async () => {
    const { w, p } = await world(W.warn - 2, 256);
    run(w, 60);
    expect(wardens(w)).toHaveLength(1);
    w.teleportPlayer(0, { x: W.leave + 30, y: Y + 0.05, z: 256 });
    const ev = run(w, 8 * SECOND);
    expect(ev.some((e) => e.type === 'edgeWarden' && e.phase === 'leave')).toBe(true);
    expect(wardens(w)).toHaveLength(0);
    expect(shots(w)).toHaveLength(0);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('does not flicker between the warning and the leaving distance', async () => {
    const { w } = await world(W.warn - 2, 256);
    run(w, 60);
    w.teleportPlayer(0, { x: (W.warn + W.leave) / 2, y: Y + 0.05, z: 256 });
    const ev = run(w, 6 * SECOND);
    expect(ev.some((e) => e.type === 'edgeWarden')).toBe(false);
    expect(wardens(w)).toHaveLength(1);
    w.dispose();
  });

  it('only knocks a god about', async () => {
    const { w, p } = await world(4, 256);
    step(w, ui([{ kind: 'godMode', on: true }]));
    const ev = run(w, W.graceTicks + 12 * SECOND);
    expect(ev.some((e) => e.type === 'hit' && e.target === p.id)).toBe(true);
    expect(dead(p)).toBe(false);
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('never comes to a world that has no edge set, or to a player outside it', async () => {
    const bare = await world(4, 256, null);
    run(bare.w, 5 * SECOND);
    expect(wardens(bare.w)).toHaveLength(0);
    bare.w.dispose();
    // The same world, its edge drawn elsewhere: the player is outside it (as in the Rootdeep).
    const out = await world(4, 256, { minX: 1000, minZ: 0, maxX: 1512, maxZ: 512 });
    run(out.w, 5 * SECOND);
    expect(wardens(out.w)).toHaveLength(0);
    out.w.dispose();
  });

  it('runs the same way twice, and survives a snapshot', async () => {
    const a = await world(4, 256, EDGE, 7);
    const b = await world(4, 256, EDGE, 7);
    run(a.w, W.graceTicks + 2 * SECOND);
    run(b.w, W.graceTicks + 2 * SECOND);
    expect(a.w.hash()).toBe(b.w.hash());
    b.w.restore(a.w.snapshot());
    run(a.w, 3 * SECOND);
    run(b.w, 3 * SECOND);
    expect(a.w.hash()).toBe(b.w.hash());
    a.w.dispose();
    b.w.dispose();
  });
});
