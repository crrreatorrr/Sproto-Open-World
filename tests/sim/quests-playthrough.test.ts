import { describe, expect, it } from 'vitest';
import { ITEMS } from '../../src/content/items';
import { NPCS } from '../../src/content/npcs';
import { QUESTS } from '../../src/content/quests';
import { SPELLS } from '../../src/content/spells';
import { SPROUTVALE_CONTENT as C } from '../../src/content/world/sproutvaleContent';
import { migrate } from '../../src/save/migrations';
import type { SimWorld } from '../../src/sim/SimWorld';
import { bakedWorld, buy, die, hunt, playQuest, prog, reload, rest, statusOf, talk, tick, use } from './quests-helpers';

/** The order a player meets them in: every quest in the game, from a fresh save. */
const ORDER = [
  'q_wake_up', 'q_pest_control', 'q_pumpkins', 'q_watchtower', 'q_mill', 'q_relics', 'q_rivet_volley', 'q_lens_flare', 'q_iron_gallery',
  'q_pumpkin_strength', 'q_thornwood', 'q_hollow_giant', 'q_scrapjaw', 'q_elders_garden', 'q_weavers_thorns', 'q_tremors', 'q_deep_seam',
  'q_smoke_hills', 'q_bait', 'q_skyfire',
];
/** The side jobs nobody gates, taken before the Elder has said a word. */
const SIDE_JOBS_FIRST = ['q_mill', 'q_relics', 'q_pumpkins', ...ORDER.filter((q) => !['q_mill', 'q_relics', 'q_pumpkins'].includes(q))];

async function playAll(opts: { order?: string[]; first?: (w: SimWorld) => void; onStep?: (w: SimWorld) => Promise<SimWorld> } = {}): Promise<SimWorld> {
  let w = await bakedWorld();
  opts.first?.(w);
  for (const id of opts.order ?? ORDER) {
    // A quest that follows on from another has started by itself.
    if (!statusOf(w, id)) talk(w, QUESTS[id].giver, id);
    expect(statusOf(w, id), `${id} was offered`).toBeDefined();
    w = await playQuest(w, id, opts.onStep);
    tick(w);
  }
  return w;
}

const expectAllDone = (w: SimWorld) => {
  for (const id of ORDER) expect(statusOf(w, id), id).toBe('complete');
};

describe('every quest, start to finish, on the baked world', () => {
  it('the list above is every quest there is', () => {
    expect([...ORDER].sort()).toEqual(Object.keys(QUESTS).sort());
  });

  it('a fresh save finishes all of them and ends up with every reward', async () => {
    const w = await playAll();
    expectAllDone(w);
    const p = prog(w);
    for (const spell of ['bolt', 'blast', 'chainZap', 'mirrorWard', 'staticSnare', 'vinePull', 'healingBloom', 'brambleWall', 'emberBreath', 'sproutSurge']) expect(p.spells, spell).toContain(spell);
    for (const item of ['staff_gourd', 'staff_moonward', 'staff_shooter', 'staff_fighter', 'staff_fighters_might', 'robe_warden', 'robe_moleskin', 'charm_scholars_knot', 'charm_ember_heart', 'charm_seam_lamp', 'charm_drake_scale', 'charm_skyfire_heart']) {
      expect(p.inventory[item], item).toBe(1);
    }
    // The finished game is a save the game will load.
    expect(() => migrate(JSON.parse(JSON.stringify(w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' }))))).not.toThrow();
    w.dispose();
  }, 300_000);

  it('saving and reloading after everything you do changes nothing', async () => {
    // A new seed each time: the loot rolls restart with a world, and this run reloads after every kill.
    let seed = 1;
    const w = await playAll({ onStep: (x) => reload(x, ++seed) });
    expectAllDone(w);
    expect(seed, 'reloads').toBeGreaterThan(50);
    w.dispose();
  }, 600_000);

  it('falling after everything you do changes nothing', async () => {
    const w = await playAll({
      onStep: async (x) => {
        die(x);
        return x;
      },
    });
    expectAllDone(w);
    w.dispose();
  }, 600_000);

  it('the side jobs can come before the main chain', async () => {
    const w = await playAll({ order: SIDE_JOBS_FIRST });
    expectAllDone(w);
    w.dispose();
  }, 300_000);

  it('everything done early still counts: chests, objects and uniques before any quest asks for them', async () => {
    const w = await playAll({
      first: (x) => {
        hunt(x, 'gatekeeper');
        hunt(x, 'big_coin');
        for (const c of C.chests) use(x, c.id);
        for (const o of ['watchtower_beacon', 'mill_lever', 'mill_lens', 'frost_tome']) use(x, o);
        for (const s of C.shrines) rest(x, s.id);
      },
    });
    expectAllDone(w);
    w.dispose();
  }, 300_000);

  it('every power and staff the plan promises can be had (Alien Ray waits for area 2)', async () => {
    const w = await playAll();
    use(w, 'frost_tome');
    use(w, 'chest_thornwood');
    prog(w).sprouts += 1000;
    buy(w, 'tome_seeker_swarm');
    buy(w, 'staff_nobu');
    const p = prog(w);
    expect([...p.spells].sort()).toEqual(Object.keys(SPELLS).sort());
    const staffs = Object.values(ITEMS).filter((i) => i.kind === 'staff' && i.id !== 'staff_alien_ray');
    for (const s of staffs) expect(p.inventory[s.id], s.id).toBeGreaterThan(0);
    w.dispose();
  }, 300_000);

  it('every villager still has something to say when it is all over', async () => {
    const w = await playAll();
    for (const npc of Object.keys(NPCS)) if (w.locate(npc)) talk(w, npc);
    w.dispose();
  }, 300_000);
});
