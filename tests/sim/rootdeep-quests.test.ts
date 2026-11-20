import { beforeEach, describe, expect, it } from 'vitest';
import { QUESTS } from '../../src/content/quests';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { bakedWorld, hunt, playQuest, prog, reach, statusOf, talk as endTalk, use } from './quests-helpers';

/**
 * Rootdeep Quest 6: Collector Pepe offers the map only after Lost Relics, the hidden door has no
 * compass marker, and the chain plays through to Rootcleaver and back.
 *
 * `talk()` in the helpers plays a conversation out to the end, so the node it opened is gone.
 * These tests remember the entry node, which is the line Pepe actually started on.
 */

let world: SimWorld;
let entryNode: string | undefined;

function talk(w: SimWorld, npc: string, start?: string): void {
  const events = endTalk(w, npc, start);
  const opened = events.find((e): e is Extract<SimEvent, { type: 'talk' }> => e.type === 'talk' && e.npc === npc);
  entryNode = opened?.node;
}

function node(_w: SimWorld): string | undefined {
  return entryNode;
}

function finishQuest(w: SimWorld, id: string): void {
  const def = QUESTS[id];
  prog(w).quests[id] = { status: 'complete', step: def.steps.length, progress: [] };
}

function setStep(w: SimWorld, id: string, stepId: string): void {
  const def = QUESTS[id];
  const step = def.steps.findIndex((s) => s.id === stepId);
  if (step < 0) throw new Error(`${id} has no step ${stepId}`);
  prog(w).quests[id] = { status: 'active', step, progress: def.steps[step].objectives.map(() => 0) };
}

/** Lost Relics is done, the map is taken, and the diggers are driven off. The door is not used. */
function playToDoor(w: SimWorld): void {
  finishQuest(w, 'q_relics');
  talk(w, 'collector_pepe', 'q_collectors_map');
  reach(w, 'old_hedge_wall');
  for (let i = 0; i < 4; i++) hunt(w, 'rootdeep_digger');
  const q = prog(w).quests.q_collectors_map;
  if (!q || q.status !== 'active' || QUESTS.q_collectors_map.steps[q.step]?.id !== 'door') {
    throw new Error(`expected the hidden-door step, got ${q?.status} step ${q?.step}`);
  }
}

function useDoor(w: SimWorld): void {
  use(w, 'rd_surface_hedge_north');
}

/** From Pepe's map offer, through the cave, to handing Rootcleaver's news back. */
async function playRootdeep(w: SimWorld): Promise<SimWorld> {
  finishQuest(w, 'q_relics');
  talk(w, 'collector_pepe', 'q_collectors_map');
  await playQuest(w, 'q_collectors_map');
  if (statusOf(w, 'q_rootdeep') !== 'active') throw new Error('the door did not start The Rootdeep');
  return playQuest(w, 'q_rootdeep');
}

describe("Collector Pepe's two quests", () => {
  beforeEach(async () => {
    world = await bakedWorld();
    entryNode = undefined;
  });

  it('offers nothing new until Lost Relics is finished', () => {
    const w = world;
    talk(w, 'collector_pepe');
    expect(node(w)).toBe('offer');
    w.dispose();
  });

  it('offers the map once Lost Relics is finished', () => {
    const w = world;
    finishQuest(w, 'q_relics');
    talk(w, 'collector_pepe');
    expect(node(w)).toBe('map_offer');
    w.dispose();
  });

  it('still lets you hand in Lost Relics first', () => {
    const w = world;
    setStep(w, 'q_relics', 'return');
    talk(w, 'collector_pepe');
    expect(node(w)).toBe('relics_done');
    w.dispose();
  });

  it('gives no marker on the step that finds the hidden door', () => {
    expect(QUESTS.q_collectors_map.steps.find((s) => s.id === 'door')!.marker).toBeUndefined();
    world.dispose();
  });

  it('starts The Rootdeep when you go through the hidden door', () => {
    const w = world;
    playToDoor(w);
    useDoor(w);
    expect(prog(w).quests.q_collectors_map.status).toBe('complete');
    expect(prog(w).quests.q_rootdeep.status).toBe('active');
    expect(prog(w).inventory.seal_shard ?? 0).toBe(0);
    w.dispose();
  });

  it('plays from Collector Pepe to Rootcleaver and back', async () => {
    const w = world;
    await playRootdeep(w);
    expect(prog(w).inventory.staff_rootcleaver).toBe(1);
    expect(prog(w).quests.q_rootdeep.status).toBe('complete');
    w.dispose();
  }, 120_000);
});
