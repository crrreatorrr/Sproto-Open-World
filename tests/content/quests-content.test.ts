import { describe, expect, it } from 'vitest';
import { STAFF_TO_GUN } from '../../src/content/classes';
import { DIALOGUE } from '../../src/content/dialogue';
import { ENEMIES } from '../../src/content/enemies';
import { INVENTORY_CAP, ITEMS } from '../../src/content/items';
import { DROPS } from '../../src/content/loot';
import { QUESTS } from '../../src/content/quests';
import { WORLD_CONTENT as C } from '../../src/content/world/worldContent';

/** Quest content that a run through the game can't vouch for on its own. */
describe('dialogue graphs', () => {
  for (const g of Object.values(DIALOGUE)) {
    it(`${g.id}: always has an answer, and every line leads somewhere that exists`, () => {
      expect(g.entry.at(-1)!.if, 'the last entry rule is the default').toBeUndefined();
      for (const r of g.entry) expect(g.nodes[r.node], r.node).toBeDefined();
      for (const [id, n] of Object.entries(g.nodes)) {
        if (n.next) expect(g.nodes[n.next], `${id} → ${n.next}`).toBeDefined();
        for (const c of n.choices ?? []) if (c.next) expect(g.nodes[c.next], `${id} → ${c.next}`).toBeDefined();
        // A node whose every choice is hidden could never be left.
        if (n.choices?.length) expect(n.choices.some((c) => !c.if), `${id} has a choice that is always open`).toBe(true);
      }
    });
  }
});

describe('quest steps', () => {
  /** Where each enemy stands. */
  const standing = [
    ...C.enemies.map((e) => ({ def: e.def, x: e.pos[0], z: e.pos[2] })),
    ...(C.camps ?? []).flatMap((c) => c.members.map((m) => ({ def: m.def, x: c.pos[0] + m.at[0], z: c.pos[2] + m.at[1] }))),
  ];
  const places = new Map<string, readonly number[]>([...C.triggers, ...C.npcs, ...C.chests, ...(C.objects ?? []), ...C.shrines].map((p) => [p.id, p.pos]));
  const droppers = (item: string) => Object.entries(DROPS).filter(([, d]) => d.items?.some((i) => i.item === item)).map(([id]) => id);
  const isTag = (def: string, tag: string) => def === tag || !!ENEMIES[def].tags?.includes(tag);

  it('a hunt\'s marker points at the enemies it asks for (within 60 m of the nearest)', () => {
    for (const q of Object.values(QUESTS)) {
      for (const s of q.steps) {
        if (!s.marker) continue;
        for (const o of s.objectives) {
          const from = o.kind === 'kill' ? standing.filter((e) => isTag(e.def, o.tag)) : o.kind === 'collect' ? standing.filter((e) => droppers(o.item).includes(e.def)) : [];
          if (!from.length) continue;
          const at = places.get(s.marker)!;
          const nearest = Math.min(...from.map((e) => Math.hypot(e.x - at[0], e.z - at[2])));
          expect(nearest, `${q.id}/${s.id} → ${s.marker}`).toBeLessThanOrEqual(60);
        }
      }
    }
  });
});

describe('the bags', () => {
  it('can never fill: there are fewer kinds of item a class can own than slots, so no quest item is ever refused', () => {
    // A Wizard is never handed a gun; a gun class gets a gun in place of each STAFF_TO_GUN staff.
    const all = Object.values(ITEMS);
    const wizard = all.filter((i) => !i.gun);
    const gunner = all.filter((i) => !Object.hasOwn(STAFF_TO_GUN, i.id));
    expect(wizard.length).toBeLessThanOrEqual(INVENTORY_CAP);
    expect(gunner.length).toBeLessThanOrEqual(INVENTORY_CAP);
  });
});
