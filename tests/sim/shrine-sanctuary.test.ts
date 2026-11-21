import { describe, expect, it } from 'vitest';
import type { RegionContent } from '../../src/content/world/sproutvaleContent';
import { resolveHit, type HitInfo } from '../../src/sim/combat/hits';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { SANCTUARY_RADIUS } from '../../src/sim/systems/sanctuary';
import { combatWorld, step } from './combatHelpers';

const SHRINE: RegionContent = { npcs: [], shrines: [{ id: 'shrine_test', pos: [0, 0, 0], yaw: 0 }], chests: [], enemies: [], triggers: [] };

function put(w: SimWorld, e: Entity, x: number, z: number): void {
  e.tf.pos = { x, y: 0, z };
  e.tf.prevPos = { ...e.tf.pos };
  w.physics.teleport(e.id, e.tf.pos);
}

const fromShrine = (e: Entity) => Math.hypot(e.tf.pos.x, e.tf.pos.z);

describe('a shrine is safe ground', () => {
  it('without a shrine, the same Grunt reaches the player and hurts them', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 2 } });
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 14 }, Math.PI);
    for (let i = 0; i < 900 && p.vitals!.hp === p.vitals!.hpMax; i++) step(w);
    expect(p.vitals!.hp).toBeLessThan(p.vitals!.hpMax);
    expect(fromShrine(g)).toBeLessThan(SANCTUARY_RADIUS);
    w.dispose();
  });

  it('an enemy does not notice a player standing by a shrine, or walk up to them', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 2 } });
    w.populateWorld(SHRINE);
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 14 }, Math.PI);
    let nearest = Infinity;
    for (let i = 0; i < 900; i++) {
      step(w);
      nearest = Math.min(nearest, fromShrine(g));
      expect(g.brain!.target).toBeNull();
    }
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    expect(nearest).toBeGreaterThan(SANCTUARY_RADIUS);
    w.dispose();
  });

  it('an enemy already chasing gives up at the edge and goes home', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 12 } });
    w.populateWorld(SHRINE);
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 20 }, Math.PI);
    for (let i = 0; i < 300 && g.brain!.state !== 'engage'; i++) step(w);
    expect(g.brain!.state).toBe('engage');
    put(w, p, 0, 1);
    const hp = p.vitals!.hp;
    let nearest = Infinity;
    for (let i = 0; i < 900; i++) {
      step(w);
      nearest = Math.min(nearest, fromShrine(g));
    }
    expect(p.vitals!.hp).toBe(hp);
    expect(nearest).toBeGreaterThan(SANCTUARY_RADIUS - 0.5);
    expect(g.brain!.state).toBe('idle');
    w.dispose();
  });

  it('an enemy standing on the ground is walked off it', async () => {
    const { w } = await combatWorld({ pos: { x: 0, y: 0, z: 2 } });
    w.populateWorld(SHRINE);
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 14 }, Math.PI);
    put(w, g, 0, 4);
    g.brain!.home = { x: 30, y: 0, z: 0 };
    for (let i = 0; i < 120; i++) step(w);
    expect(fromShrine(g)).toBeGreaterThanOrEqual(SANCTUARY_RADIUS - 0.1);
    w.dispose();
  });

  it('ranged attacks do not reach in: no shot is aimed, and one already flying does nothing', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 12 } });
    w.populateWorld(SHRINE);
    w.spawnEnemy('dummy_shooter', { x: 0, y: 0, z: 22 }, Math.PI);
    // Out in the open the shooter does hit.
    for (let i = 0; i < 600 && p.vitals!.hp === p.vitals!.hpMax; i++) step(w);
    expect(p.vitals!.hp).toBeLessThan(p.vitals!.hpMax);
    // Wait for a shot in the air, then step onto the shrine's ground in its path.
    for (let i = 0; i < 600 && !w.entities.some((e) => e.projectile); i++) step(w);
    expect(w.entities.some((e) => e.projectile)).toBe(true);
    put(w, p, 0, 7);
    const hp = p.vitals!.hp;
    let fired = 0;
    for (let i = 0; i < 900; i++) {
      for (const ev of step(w)) if (ev.type === 'fire') fired++;
    }
    expect(p.vitals!.hp).toBe(hp);
    expect(fired).toBe(0);
    w.dispose();
  });

  it('a player on the ground can still hurt an enemy outside it', async () => {
    const { w, p } = await combatWorld({ pos: { x: 0, y: 0, z: 2 } });
    w.populateWorld(SHRINE);
    const g = w.spawnEnemy('grunt', { x: 0, y: 0, z: 14 }, Math.PI);
    const out = resolveHit({ now: w.now, entities: w.entities, get: (id) => w.entities.find((e) => e.id === id), events: [], motion: new Map(), frozen: new Set() }, p, g, {
      move: 'light1', base: 10, kind: 'physical', poise: 5, from: { ...p.tf.pos },
    } as HitInfo);
    expect(out).toBe('hit');
    expect(g.vitals!.hp).toBeLessThan(g.vitals!.hpMax);
    w.dispose();
  });
});
