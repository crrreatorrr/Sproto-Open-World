import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DIALOGUE } from '../../src/content/dialogue';
import { ENEMIES } from '../../src/content/enemies';
import { ITEMS } from '../../src/content/items';
import { DROPS } from '../../src/content/loot';
import { NPCS } from '../../src/content/npcs';
import { OBJECTS } from '../../src/content/objects';
import { xpForLevel } from '../../src/content/progression';
import { QUESTS, type Effect } from '../../src/content/quests';
import { SPELLS } from '../../src/content/spells';
import { cellOf } from '../../src/content/world/format';
import { SPROUTVALE_CONTENT as C } from '../../src/content/world/sproutvaleContent';

/** M4 content checks (plan §6, §8): placements, camp rules, quest references, rewards, the XP curve. */
const marks: { id: string; kind: string; at: [number, number]; clear?: number }[] = JSON.parse(readFileSync('world-src/sproutvale/placements.json', 'utf8')).marks;
const markById = new Map(marks.map((m) => [m.id, m]));
const camps = C.camps ?? [];

describe('placements', () => {
  it('the world map image the Map tab shows is committed (the bake leaves it alone, so a merge can lose it)', () => {
    expect(existsSync('public/world/sproutvale/map.webp')).toBe(true);
  });

  it('every villager, chest, object, camp and camp member has a mark at its position (so props keep off it)', () => {
    const want: [string, number, number][] = [
      ...C.npcs.map((n): [string, number, number] => [n.id, n.pos[0], n.pos[2]]),
      ...C.chests.map((c): [string, number, number] => [c.id, c.pos[0], c.pos[2]]),
      ...(C.objects ?? []).map((o): [string, number, number] => [o.id, o.pos[0], o.pos[2]]),
      ...camps.map((c): [string, number, number] => [c.id, c.pos[0], c.pos[2]]),
      ...camps.flatMap((c) => c.members.map((m, i): [string, number, number] => [`${c.id}#${i}`, c.pos[0] + m.at[0], c.pos[2] + m.at[1]])),
    ];
    for (const [id, x, z] of want) {
      const m = markById.get(id);
      expect(m, id).toBeDefined();
      expect(m!.at[0], id).toBeCloseTo(x, 1);
      expect(m!.at[1], id).toBeCloseTo(z, 1);
    }
  });

  it('nothing is placed on a hand-placed prop (a capsule set down there would stand on top of it), except the beacon', () => {
    const src = JSON.parse(readFileSync('world-src/sproutvale/placements.json', 'utf8'));
    const radius = (key: string, scale: number) => {
      const c = src.kinds[key]?.collider;
      if (!c || c.kind === 'none') return 0;
      return (c.kind === 'cylinder' ? c.radius : Math.hypot(c.half[0], c.half[2])) * scale;
    };
    const props = src.place.filter((p: { key?: string }) => p.key).map((p: { key: string; at: [number, number]; scale?: number }) => ({ key: p.key, at: p.at, r: radius(p.key, p.scale ?? 1) }));
    for (const m of marks) {
      if (m.kind === 'camp' || m.kind === 'playerStart' || m.id === 'watchtower_beacon') continue;
      for (const p of props) expect(Math.hypot(m.at[0] - p.at[0], m.at[1] - p.at[1]), `${m.id} on ${p.key}`).toBeGreaterThan(p.r + 0.6);
    }
  });

  it('every placement is inside the soft wall (8 m in from the border)', () => {
    const all = [...C.npcs, ...C.chests, ...(C.objects ?? []), ...camps.flatMap((c) => c.members.map((m) => ({ pos: [c.pos[0] + m.at[0], 0, c.pos[2] + m.at[1]] })))];
    for (const p of all) for (const v of [p.pos[0], p.pos[2]]) expect(v > 8 && v < 504).toBe(true);
  });
});

describe('camps (plan §6.5)', () => {
  it('about 60 enemies in the area', () => {
    const n = camps.reduce((k, c) => k + c.members.length, 0);
    expect(n).toBeGreaterThanOrEqual(55);
    // The second Pest Control wave is four more Grunts. They are not in the world until the horn.
    expect(n).toBeLessThanOrEqual(80);
  });

  it('camps are at least 60 m apart', () => {
    for (let i = 0; i < camps.length; i++) {
      for (let j = i + 1; j < camps.length; j++) {
        const d = Math.hypot(camps[i].pos[0] - camps[j].pos[0], camps[i].pos[2] - camps[j].pos[2]);
        expect(d, `${camps[i].id} ↔ ${camps[j].id}`).toBeGreaterThanOrEqual(60);
      }
    }
  });

  it('no Active ring (3 × 3 cells) ever holds more than 4 elite-tier characters (plan §3.5)', () => {
    const elites = camps.flatMap((c) => c.members.filter((m) => ENEMIES[m.def].elite).map((m) => cellOf(c.pos[0] + m.at[0], c.pos[2] + m.at[1])));
    for (let cx = 0; cx < 8; cx++) {
      for (let cz = 0; cz < 8; cz++) {
        const n = elites.filter(([x, z]) => Math.abs(x - cx) <= 1 && Math.abs(z - cz) <= 1).length;
        expect(n, `ring around (${cx}, ${cz})`).toBeLessThanOrEqual(4);
      }
    }
  });

  it('every camp member is a known enemy with a full profile, and uniques are unique', () => {
    const uniques: string[] = [];
    for (const c of camps) {
      for (const m of c.members) {
        const def = ENEMIES[m.def];
        expect(def, m.def).toBeDefined();
        expect(Object.keys(def.profile.damage).sort()).toEqual(['arcane', 'physical']);
        expect(Object.keys(def.profile.status).sort()).toEqual(['burn', 'chill', 'shock']);
        if (m.unique) uniques.push(m.unique);
      }
    }
    expect(new Set(uniques).size).toBe(uniques.length);
    expect(uniques.sort()).toEqual(['big_coin', 'gatekeeper']);
  });

  it('a move chain only names moves that exist', () => {
    for (const def of Object.values(ENEMIES)) {
      for (const m of def.moves) if (m.followUp) expect(def.moves.some((x) => x.id === m.followUp), `${def.id}.${m.id}`).toBe(true);
      expect(def.moves.some((m) => !m.chainOnly) || def.moves.length === 0, def.id).toBe(true);
    }
  });
});

describe('quests (plan §6.2, §6.3)', () => {
  const placeIds = new Set([...C.chests.map((c) => c.id), ...(C.objects ?? []).map((o) => o.id), ...C.shrines.map((s) => s.id)]);
  const triggerIds = new Set(C.triggers.map((t) => t.id));
  const npcIds = new Set(C.npcs.map((n) => n.id));
  const campDefs = camps.flatMap((c) => c.members.map((m) => ENEMIES[m.def])).concat(C.enemies.map((e) => ENEMIES[e.def]));
  const obtainable = new Set<string>([
    ...C.chests.flatMap((c) => c.chest.items.map((i) => i.item)),
    ...Object.values(DROPS).flatMap((d) => (d.items ?? []).map((i) => i.item)),
    ...camps.flatMap((c) => c.members.flatMap((m) => (m.carry ? [m.carry] : []))),
    ...Object.values(QUESTS).flatMap((q) => q.steps.flatMap((s) => (s.onComplete ?? []).flatMap((e) => ('give' in e ? [e.give] : [])))),
    ...Object.values(OBJECTS).flatMap((o) => (o.effects ?? []).flatMap((e) => ('give' in e ? [e.give] : []))),
  ]);

  for (const q of Object.values(QUESTS)) {
    it(`${q.id}: every reference exists`, () => {
      expect(npcIds.has(q.giver), `giver ${q.giver}`).toBe(true);
      for (const s of q.steps) {
        for (const o of s.objectives) {
          if (o.kind === 'talk') {
            expect(npcIds.has(o.npc), o.npc).toBe(true);
            if (o.node) expect(DIALOGUE[NPCS[o.npc].dialogue].nodes[o.node], `${o.npc}.${o.node}`).toBeDefined();
          } else if (o.kind === 'interact') expect(placeIds.has(o.object), o.object).toBe(true);
          else if (o.kind === 'reach') expect(triggerIds.has(o.trigger), o.trigger).toBe(true);
          else if (o.kind === 'collect') expect(obtainable.has(o.item), o.item).toBe(true);
          else if (o.kind === 'kill') {
            const n = campDefs.filter((d) => d.id === o.tag || d.tags?.includes(o.tag)).length;
            expect(n, `${o.tag} in the world`).toBeGreaterThanOrEqual(o.count);
          }
        }
        if (s.marker) expect(npcIds.has(s.marker) || placeIds.has(s.marker) || triggerIds.has(s.marker), s.marker).toBe(true);
      }
      for (const fx of [...q.rewards, ...q.steps.flatMap((s) => s.onComplete ?? [])]) {
        if ('give' in fx) expect(ITEMS[fx.give], fx.give).toBeDefined();
        if ('learnSpell' in fx) expect(SPELLS[fx.learnSpell], fx.learnSpell).toBeDefined();
      }
    });

    it(`${q.id}: its giver's dialogue offers it`, () => {
      const graph = DIALOGUE[NPCS[q.giver].dialogue];
      const starts = Object.values(graph.nodes).flatMap((n) => [...(n.do ?? []), ...(n.choices ?? []).flatMap((c) => c.do ?? [])]);
      expect(starts.some((fx) => 'startQuest' in fx && fx.startQuest === q.id)).toBe(true);
    });
  }

  it('nothing is given twice (quest rewards, chests, objects)', () => {
    const given: string[] = [];
    const add = (fx: Effect) => {
      if ('give' in fx && !ITEMS[fx.give].stacks) given.push(fx.give);
      if ('learnSpell' in fx) given.push(`spell:${fx.learnSpell}`);
    };
    for (const q of Object.values(QUESTS)) for (const fx of [...q.rewards, ...q.steps.flatMap((s) => s.onComplete ?? [])]) add(fx);
    for (const o of Object.values(OBJECTS)) for (const fx of o.effects ?? []) add(fx);
    for (const c of C.chests) for (const i of c.chest.items) if (!ITEMS[i.item].stacks) given.push(i.item);
    expect(given.filter((g, i) => given.indexOf(g) !== i)).toEqual([]);
  });
});

describe('the XP curve at the Quarry Gate (plan §5)', () => {
  const xpOf = (id: string) => ENEMIES[id].xp;
  const questXp = (id: string) => QUESTS[id].rewards.reduce((k, fx) => k + ('xp' in fx ? fx.xp : 0), 0);
  const campXp = (id: string) => camps.find((c) => c.id === id)!.members.reduce((k, m) => k + xpOf(m.def), 0);
  const levelAt = (xp: number) => {
    let l = 1;
    while (xpForLevel(l + 1) <= xp) l++;
    return l;
  };
  // The main path: the quests, the kills they ask for, and the camps you must pass on the way.
  const main =
    questXp('q_wake_up') + 3 * xpOf('dummy_straw') +
    questXp('q_pest_control') + 8 * xpOf('grunt') +
    questXp('q_watchtower') + 5 * xpOf('slinger') +
    questXp('q_thornwood') + xpOf('gatekeeper') +
    campXp('thorn_wisp_a') + campXp('quarry_ravine');
  // The side quests and what they ask for: about 8 more Orchard Grunts for the pumpkins, the mill.
  const side = questXp('q_pumpkins') + 8 * xpOf('grunt_orchard') + questXp('q_mill') + campXp('mill_yard') + questXp('q_relics');

  it('the main path reaches the gate at level 6', () => {
    expect(levelAt(main), `${main} XP`).toBe(6);
  });

  it('the side content adds a level: 7 at the gate', () => {
    expect(levelAt(main + side), `${main + side} XP`).toBe(7);
  });
});
