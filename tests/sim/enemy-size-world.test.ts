import fs from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { ENEMIES } from '../../src/content/enemies';
import { ENEMY_SIZES } from '../../src/content/enemyScale';
import { AFFIXES, CAMP_AFFIX_POOLS } from '../../src/content/packs/c4';
import { cellColliders, decodeCellBin, sampleHeight } from '../../src/content/world/codec';
import { CELL_SIZE, cellOf, type CellColliders, type CellData, type ColliderShape, type RegionManifest } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT as C } from '../../src/content/world/sproutvaleContent';
import { idleInput } from '../../src/sim/commands';
import type { Entity } from '../../src/sim/entity';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/** The scaled enemies in the real baked Sproutvale: nobody starts stuck, and every boss can walk its arena. */
const PUBLIC = 'public/world/sproutvale';
const manifest: RegionManifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'region.json'), 'utf8'));
const cells = new Map<string, CellColliders>();

const strong = (def: string) => def in ENEMY_SIZES;
const cellAt = (x: number, z: number) => {
  const [cx, cz] = cellOf(x, z);
  return cells.get(`${cx},${cz}`)!;
};
const groundAt = (x: number, z: number) => {
  const c = cellAt(x, z);
  return sampleHeight(c.heights, c.cx, c.cz, x, z);
};

/** Every prop collider close enough to matter around (x, z). */
function shapesNear(x: number, z: number, reach: number): ColliderShape[] {
  const out: ColliderShape[] = [];
  for (const c of cells.values()) {
    const mx = (c.cx + 0.5) * CELL_SIZE, mz = (c.cz + 0.5) * CELL_SIZE;
    if (Math.abs(mx - x) > CELL_SIZE + reach || Math.abs(mz - z) > CELL_SIZE + reach) continue;
    out.push(...c.shapes);
  }
  return out;
}

/** The gap (m) between an upright capsule's axis and a prop's side, less the capsule's radius. */
function clearance(x: number, z: number, radius: number, s: ColliderShape): number {
  const dx = x - s.pos[0], dz = z - s.pos[2];
  if (s.kind === 'cylinder') return Math.hypot(dx, dz) - s.radius - radius;
  const c = Math.cos(s.yaw), n = Math.sin(s.yaw);
  const lx = Math.abs(c * dx - n * dz) - s.half[0], lz = Math.abs(n * dx + c * dz) - s.half[2];
  return Math.hypot(Math.max(lx, 0), Math.max(lz, 0)) + Math.min(Math.max(lx, lz), 0) - radius;
}

async function realWorld(): Promise<SimWorld> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [256, 30, 58], yaw: 0 } }), 1);
  w.spawnPlayer(0);
  for (const c of cells.values()) w.loadCell(c);
  // Built a few colliders per tick: give it all the ticks it takes.
  for (let i = 0; i < 2400; i++) w.tick(new Map([[0, idleInput(0)]]));
  w.populateWorld(C);
  for (let i = 0; i < 30; i++) w.tick(new Map([[0, idleInput(0)]]));
  return w;
}

/** Walk the capsule along (dx, dz) for `ticks` under gravity. Returns how far it got. */
function walk(w: SimWorld, e: Entity, dx: number, dz: number, ticks: number): number {
  const from = { ...e.tf.pos };
  const p = { ...e.tf.pos };
  for (let i = 0; i < ticks; i++) {
    const m = w.physics.moveCharacter(e.id, p, { x: dx / 60, y: -0.15, z: dz / 60 }).moved;
    p.x += m.x;
    p.y += m.y;
    p.z += m.z;
  }
  w.physics.teleport(e.id, e.tf.pos);
  return Math.hypot(p.x - from.x, p.z - from.z);
}

beforeAll(() => {
  for (const c of manifest.cells) {
    const data: CellData = JSON.parse(fs.readFileSync(path.join('public', c.json), 'utf8'));
    const { heights } = decodeCellBin(fs.readFileSync(path.join('public', c.bin)), manifest.heightRange);
    cells.set(`${c.cx},${c.cz}`, cellColliders(data, heights, manifest));
  }
});

describe('scaled enemies in the baked world', () => {
  const placed = (C.camps ?? []).flatMap((c) => c.members.map((m) => ({ id: `${c.id}/${m.def}`, def: m.def, x: c.pos[0] + m.at[0], z: c.pos[2] + m.at[1], camp: c.id })));

  it('no strong camp member starts inside a prop', () => {
    const stuck: string[] = [];
    for (const m of placed.filter((p) => strong(p.def))) {
      const r = ENEMIES[m.def].body.radius;
      const y = groundAt(m.x, m.z), top = y + ENEMIES[m.def].body.height;
      for (const s of shapesNear(m.x, m.z, r)) {
        const lo = s.pos[1] - (s.kind === 'cylinder' ? s.height : s.half[1] * 2) / 2, hi = lo + (s.kind === 'cylinder' ? s.height : s.half[1] * 2);
        if (hi < y + 0.3 || lo > top) continue;
        const gap = clearance(m.x, m.z, r, s);
        if (gap < 0) stuck.push(`${m.id} overlaps a ${s.kind} at ${s.pos.map((v) => v.toFixed(1))} by ${(-gap).toFixed(2)} m`);
      }
    }
    expect(stuck).toEqual([]);
  });

  it('camp members never start inside each other, a Colossal champion included', () => {
    const k = AFFIXES.colossal.scale!;
    const clash: string[] = [];
    for (const camp of C.camps ?? []) {
      const big = CAMP_AFFIX_POOLS[camp.id]?.includes('colossal');
      const r = (d: string) => ENEMIES[d].body.radius * (big && !ENEMIES[d].elite ? k : 1);
      camp.members.forEach((a, i) => camp.members.slice(i + 1).forEach((b) => {
        if (Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < r(a.def) + r(b.def)) clash.push(`${camp.id}: ${a.def} and ${b.def}`);
      }));
    }
    expect(clash).toEqual([]);
  });

  it('every strong enemy stands on the terrain and can walk away from where it starts', async () => {
    const w = await realWorld();
    const bad: string[] = [];
    const fighters = w.entities.filter((x) => x.brain && strong(x.brain.def) && x.brain.camp);
    expect(fighters.length).toBe(placed.filter((p) => strong(p.def)).length);
    for (const e of fighters) {
      const ground = groundAt(e.tf.pos.x, e.tf.pos.z);
      if (Math.abs(e.tf.pos.y - ground) > 1.2) bad.push(`${e.brain!.camp}: stands at ${e.tf.pos.y.toFixed(1)} on ground ${ground.toFixed(1)}`);
      const ways = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => walk(w, e, Math.sin((i * Math.PI) / 4) * 3, Math.cos((i * Math.PI) / 4) * 3, 60));
      // Open ground on at least three sides: it can turn to face anyone who comes for it.
      if (ways.filter((d) => d > 1.5).length < 3) bad.push(`${e.brain!.camp}: boxed in, walks ${ways.map((d) => d.toFixed(1))}`);
    }
    w.dispose();
    expect(bad).toEqual([]);
  }, 120_000);

  for (const id of ['scrapjaw', 'burrowmother']) {
    it(`${id} can walk all the way round its arena, behind the pillars too`, async () => {
      const w = await realWorld();
      const boss = w.entities.find((e) => e.brain?.def === id)!;
      if (!w.physics.hasCharacter(boss.id)) w.physics.addCharacter(boss.id, boss.body!, boss.tf.pos);
      const home = boss.brain!.home;
      const walkRadius = ENEMIES[id].boss!.arenaRadius - boss.body!.radius - 0.1;
      // Up onto the circle first, then once round it, chasing a point that only moves on when reached.
      const p = { x: home.x + walkRadius, y: boss.tf.pos.y, z: home.z };
      p.y = groundAt(p.x, p.z) + 0.05;
      w.physics.teleport(boss.id, p);
      let angle = Math.PI / 2;
      const start = angle;
      let ticks = 0;
      while (angle < start + Math.PI * 2 && ticks < 6000) {
        ticks++;
        const tx = home.x + Math.sin(angle) * walkRadius, tz = home.z + Math.cos(angle) * walkRadius;
        const dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz);
        if (d < 1.2) {
          angle += 0.08;
          continue;
        }
        const m = w.physics.moveCharacter(boss.id, p, { x: (dx / d) * 0.06, y: -0.15, z: (dz / d) * 0.06 }).moved;
        p.x += m.x;
        p.y += m.y;
        p.z += m.z;
      }
      w.dispose();
      expect(angle, `got ${(((angle - start) * 180) / Math.PI).toFixed(0)}° round in ${ticks} ticks`).toBeGreaterThanOrEqual(start + Math.PI * 2);
    }, 120_000);
  }
});
