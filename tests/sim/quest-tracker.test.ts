import { describe, expect, it } from 'vitest';
import { QUESTS, type QuestOffer } from '../../src/content/quests';
import { worldLevel } from '../../src/content/world/level';
import { WORLD_CONTENT } from '../../src/content/world/worldContent';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { startQuest } from '../../src/sim/systems/rpg';
import { leadLine, nextLead, questLine, trackedQuest } from '../../src/ui/rpgText';
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
