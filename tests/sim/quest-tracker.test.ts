import { describe, expect, it } from 'vitest';
import { QUESTS, type QuestOffer } from '../../src/content/quests';
import { worldLevel } from '../../src/content/world/level';
import { WORLD_CONTENT } from '../../src/content/world/worldContent';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { startQuest } from '../../src/sim/systems/rpg';
import { mapQuest } from '../../src/ui/mapTab';
import { leadLine, nextLead, questLine, questPlaces, questSteps, trackedQuest } from '../../src/ui/rpgText';
import { step } from './combatHelpers';
import { choose, interact, standBy } from './m3Helpers';
import { flatSproutvale } from './m4Helpers';

/** Every quest reaches the tracker, the compass and the map; "Find a quest" only offers what can be taken. */

async function placed(): Promise<SimWorld> {
  await initPhysics();
  const w = new SimWorld(worldLevel({ id: 'sproutvale', playerStart: { pos: [256, 30, 58], yaw: 0 } }), 1);
  w.spawnPlayer(0);
  // Cave steps point at levers, the vault and the hidden door, which live on the joined world.
  w.populateWorld(WORLD_CONTENT);
  return w;
}

const take = (w: SimWorld, npc: string) => {
  standBy(w, npc);
  step(w, interact());
  for (let i = 0; i < 6 && w.playerEntity(0)!.progress!.dialogue; i++) step(w, choose(0));
};

describe('every quest shows where to go', () => {
  const steps = Object.values(QUESTS).flatMap((q) => q.steps.map((s, i) => [q.id, i, s.id] as const));

  it.each(steps)('%s step %i (%s) has tracker text and a compass target on the map', async (id, i) => {
    const w = await placed();
    const def = QUESTS[id];
    const line = questLine(id, { status: 'active', step: i, progress: def.steps[i].objectives.map(() => 0) })!;
    expect(line.title).toBe(def.title);
    expect(line.step.length).toBeGreaterThan(0);
    // Side-quest searches are found in the world (footprints, shimmer, scorch, carriers), not by the compass.
    if (def.steps[i].clue) expect(line.marker).toBeNull();
    else {
      expect(line.marker).not.toBeNull();
      expect(w.view().locate(line.marker!), line.marker!).not.toBeNull();
    }
    w.dispose();
  });

  it.each(steps)('%s step %i (%s) pins a real place on the map, clue steps too', async (id, i) => {
    const w = await placed();
    const def = QUESTS[id];
    const places = questPlaces(id, { status: 'active', step: i, progress: def.steps[i].objectives.map(() => 0) });
    expect(places.length).toBeGreaterThan(0);
    for (const p of places) {
      expect(w.view().locate(p.id), p.id).not.toBeNull();
      expect(p.name, p.id).not.toMatch(/_/);
    }
    w.dispose();
  });

  it.each(Object.values(QUESTS).map((q) => q.id))('%s lists all its steps for the map', (id) => {
    const def = QUESTS[id];
    const mid = Math.min(1, def.steps.length - 1);
    const list = questSteps(id, { status: 'active', step: mid, progress: def.steps[mid].objectives.map(() => 0) });
    expect(list.map((s) => s.text)).toEqual(def.steps.map((s) => s.text));
    expect(list.map((s) => s.state)).toEqual(def.steps.map((_, j) => (j < mid ? 'done' : j === mid ? 'current' : 'todo')));
    expect(questSteps(id, { status: 'complete', step: def.steps.length, progress: [] }).every((s) => s.state === 'done')).toBe(true);
  });

  it.each(Object.values(QUESTS).map((q) => q.id))('%s goes on the tracker the moment it starts', async (id) => {
    const { w } = await flatSproutvale();
    const p = w.playerEntity(0)!.progress!;
    // Another quest is on the tracker already.
    const other = id === 'q_relics' ? 'q_mill' : 'q_relics';
    p.quests[other] = { status: 'active', step: 0, progress: QUESTS[other].steps[0].objectives.map(() => 0) };
    p.tracked = other;
    startQuest({ now: 0, entities: w.entities, events: [], world: w.view().world as never, rng: null as never, spawnPickup: () => undefined }, w.playerEntity(0)!, id);
    expect(trackedQuest(p)?.id).toBe(id);
    w.dispose();
  });
});

describe('Find a quest', () => {
  const offered = (w: SimWorld) => w.view().questOffers(0).map((o) => o.quest);

  it('offers only quests a giver would hand over now', async () => {
    const { w } = await flatSproutvale();
    expect(offered(w)).toContain('q_wake_up');
    expect(offered(w)).toContain('q_relics');
    expect(offered(w)).not.toContain('q_thornwood'); // the Watchtower comes first
    w.dispose();
  });

  it('a quest leaves the offers once it is taken, and never comes back when finished', async () => {
    const { w } = await flatSproutvale();
    take(w, 'collector_pepe');
    expect(w.playerEntity(0)!.progress!.quests.q_relics.status).toBe('active');
    expect(offered(w)).not.toContain('q_relics');
    w.playerEntity(0)!.progress!.quests.q_relics.status = 'complete';
    expect(offered(w)).not.toContain('q_relics');
    w.dispose();
  });

  it('a quest opens up once what it needs is done', async () => {
    const { w } = await flatSproutvale();
    const p = w.playerEntity(0)!.progress!;
    p.quests.q_watchtower = { status: 'complete', step: QUESTS.q_watchtower.steps.length, progress: [] };
    expect(offered(w)).toContain('q_thornwood');
    w.dispose();
  });

  it('every offer can really be taken from its giver', async () => {
    const { w } = await flatSproutvale();
    for (const { quest, npc } of w.view().questOffers(0)) {
      const { w: fresh } = await flatSproutvale();
      take(fresh, npc);
      expect(fresh.playerEntity(0)!.progress!.quests[quest]?.status, `${quest} from ${npc}`).toBe('active');
      fresh.dispose();
    }
    w.dispose();
  });

  it('leads to the nearest, then the next nearest, and round again', () => {
    const at: Record<string, { x: number; z: number }> = { a: { x: 10, z: 0 }, b: { x: 30, z: 0 }, c: { x: 20, z: 0 } };
    const offers: QuestOffer[] = [{ quest: 'q_a', npc: 'a' }, { quest: 'q_b', npc: 'b' }, { quest: 'q_c', npc: 'c' }];
    const next = (cur: QuestOffer | null) => nextLead(offers, { x: 0, z: 0 }, (id) => at[id] ?? null, cur);
    const first = next(null)!;
    const second = next(first)!;
    const third = next(second)!;
    expect([first.npc, second.npc, third.npc]).toEqual(['a', 'c', 'b']);
    expect(next(third)!.npc).toBe('a');
    expect(nextLead([], { x: 0, z: 0 }, () => null, null)).toBeNull();
  });

  it('the tracker names who to talk to, and the compass points at them', () => {
    expect(leadLine({ quest: 'q_relics', npc: 'collector_pepe' })).toMatchObject({ title: 'Lost Relics', step: 'Talk to Collector Pepe to take this quest.', marker: 'collector_pepe', lines: [] });
  });
});

describe('Lost Relics on the map', () => {
  it('pins all three relic chests, and drops each one once it is opened', () => {
    const at = (progress: number[]) => questPlaces('q_relics', { status: 'active', step: 0, progress });
    expect(at([0, 0, 0]).map((p) => p.id)).toEqual(['relic_mill', 'relic_rootarch', 'relic_beanstalk']);
    expect(at([0, 0, 0])[0].name).toBe('Relic chest by the mill waterfall');
    expect(at([1, 0, 1]).map((p) => p.id)).toEqual(['relic_rootarch']);
    // With the chests found, the step after sends you back to the Collector.
    expect(questPlaces('q_relics', { status: 'active', step: 1, progress: [0] })).toEqual([{ id: 'collector_pepe', name: 'Collector Pepe' }]);
  });

  it('the map follows the tracked quest, with its steps and the chests still to find', () => {
    const p = { quests: { q_relics: { status: 'active' as const, step: 0, progress: [1, 0, 0] } }, tracked: 'q_relics' } as never;
    const q = mapQuest(p, null)!;
    expect(q.title).toBe('Lost Relics');
    expect(q.steps.map((s) => s.state)).toEqual(['current', 'todo']);
    expect(q.steps[0].lines).toEqual([
      { text: 'Relic chest by the mill waterfall', done: true },
      { text: 'Relic chest under the root arch', done: false },
      { text: 'Relic chest at the Beanstalk', done: false },
    ]);
    expect(q.places.map((pl) => pl.id)).toEqual(['relic_rootarch', 'relic_beanstalk']);
  });

  it('a quest not yet taken pins its giver', () => {
    const q = mapQuest({ quests: {}, tracked: null } as never, { quest: 'q_relics', npc: 'collector_pepe' })!;
    expect(q.places).toEqual([{ id: 'collector_pepe', name: 'Collector Pepe' }]);
    expect(q.steps).toEqual([{ text: 'Talk to Collector Pepe to take this quest.', state: 'current', lines: [] }]);
  });
});
