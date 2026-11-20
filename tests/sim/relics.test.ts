import { describe, expect, it } from 'vitest';
import { BLOCK } from '../../src/content/combat';
import { relicMods } from '../../src/content/relics';
import { computeDamage, resolveHit, type HitInfo } from '../../src/sim/combat/hits';
import type { CombatCtx } from '../../src/sim/combat/playerCombat';
import { newProgress } from '../../src/sim/systems/rpg';
import {
  equipRelic, equipTotem, grantKeepsake, holdTotem, parryWindowTicks, proc, relicSlowTick, rollFrames, tickTotems,
} from '../../src/sim/systems/relics';
import type { Entity } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, combatWorld, hold, idle, ofType, press, step, stepN } from './combatHelpers';

function player(): Entity {
  return {
    id: 1, kind: 'player',
    tf: { pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
    progress: newProgress(['bolt']),
    vitals: { hp: 100, hpMax: 100, stamina: 100, staminaMax: 100, mana: 100, manaMax: 100, staminaDelay: 0 },
    view: { model: 'player' },
  } as Entity;
}

const ctx = (e: Entity, now = 0) => ({ now, entities: [e], events: [] as SimEvent[] });

describe('relic sockets', () => {
  it('earns a keepsake once and equips it into the first empty socket', () => {
    const e = player();
    const c = ctx(e);
    expect(grantKeepsake(c, e, 'relic_drowned_coins')).toBe(true);
    expect(grantKeepsake(c, e, 'relic_drowned_coins')).toBe(false);
    expect(c.events.filter((x) => x.type === 'itemGained')).toHaveLength(1);
    equipRelic(c, e, 'relic_drowned_coins');
    expect(e.progress!.relics!.sockets).toEqual(['relic_drowned_coins', null, null]);
    equipRelic(c, e, 'relic_drowned_coins');
    expect(e.progress!.relics!.sockets[0]).toBeNull();
  });

  it('swaps the one totem', () => {
    const e = player();
    const c = ctx(e);
    grantKeepsake(c, e, 'totem_elders_hearth');
    grantKeepsake(c, e, 'totem_field_warden');
    equipTotem(c, e, 'totem_elders_hearth');
    equipTotem(c, e, 'totem_field_warden');
    expect(e.progress!.relics!.totem).toBe('totem_field_warden');
    expect(c.events.some((x) => x.type === 'refused' && x.reason === 'Totem swapped.')).toBe(true);
  });

  it('lengthens the parry window and the roll when the relics are on', () => {
    const e = player();
    const c = ctx(e);
    grantKeepsake(c, e, 'relic_drowned_coins');
    grantKeepsake(c, e, 'relic_sprotos_stride');
    equipRelic(c, e, 'relic_drowned_coins');
    equipRelic(c, e, 'relic_sprotos_stride');
    expect(parryWindowTicks(e, 12)).toBe(16);
    expect(parryWindowTicks(e, 4)).toBe(4);
    grantKeepsake(c, e, 'relic_gatekeepers_grip');
    equipRelic(c, e, 'relic_gatekeepers_grip');
    expect(parryWindowTicks(e, 4)).toBe(8);
    expect(rollFrames(e, {}).iframeEnd).toBe(20);
    expect(rollFrames(e, { back: true }).iframeEnd).toBe(8);
  });
});

describe('placed totems', () => {
  it('plants on a held interact and heals inside the hearth', () => {
    const e = player();
    const c = ctx(e);
    grantKeepsake(c, e, 'totem_elders_hearth');
    equipTotem(c, e, 'totem_elders_hearth');
    e.vitals!.hp = 50;
    for (let i = 0; i < 18; i++) holdTotem({ ...c, now: i }, e, true, false);
    expect(e.placedTotem?.id).toBe('totem_elders_hearth');
    tickTotems([e], 20);
    expect(e.vitals!.hp).toBeGreaterThan(50);
    for (let i = 0; i < 20 * 60; i++) tickTotems([e], 30 + i);
    expect(e.placedTotem).toBeUndefined();
  });

  it('slows the world on odd ticks while Hopeglass is up, and only for one player', () => {
    const e = player();
    e.relicRun = { hopeglassUntil: 30, hopeglassReadyAt: 0, coopFreezeUntil: 0, rivetReadyAt: 0, briarReadyAt: 0, burnImmuneUntil: 0, holdTicks: 0, totemReadyAt: 0, lanternUntil: 0, chainSeen: -1 };
    expect(relicSlowTick([e], 1)).toBe(true);
    expect(relicSlowTick([e], 2)).toBe(false);
    expect(relicSlowTick([e], 30)).toBe(false);
    const other = player();
    other.id = 2;
    expect(relicSlowTick([e, other], 1)).toBe(false);
  });

  it('procs are deterministic', () => {
    expect(proc(4, 1, 2, 0)).toBe(false);
    expect(proc(4, 1, 2, 1)).toBe(true);
    expect(proc(4, 1, 2, 0.5)).toBe(proc(4, 1, 2, 0.5));
  });
});

/** Player 0 in a sandbox world, wearing `relics` (no fight, so the sockets aren't locked). */
async function wearing(...relics: string[]) {
  const { w, p } = await combatWorld();
  const c = { now: w.now, entities: w.entities, events: [] as SimEvent[] };
  for (const id of relics) {
    grantKeepsake(c, p, id);
    equipRelic(c, p, id);
  }
  return { w, p };
}

const blockAction = (p: Entity) => (p.combat!.action?.kind === 'block' ? p.combat!.action : null);

describe('Coins and the Grip lengthen the parry window, never open one', () => {
  const coins = relicMods(['relic_drowned_coins'], false).parryTicks;

  it('a fresh press opens the whole lengthened window', async () => {
    expect(coins).toBe(BLOCK.parryTicks + 4);
    const { w, p } = await wearing('relic_drowned_coins');
    step(w, press(BTN.block));
    expect(blockAction(p)).toMatchObject({ t: 0, parryTicks: coins });
    w.dispose();
  });

  it('block held through a roll rises with no window', async () => {
    const { w, p } = await wearing('relic_drowned_coins');
    step(w, press(BTN.dodge | BTN.block, { move: { x: 0, y: 1 } }));
    expect(p.combat!.action?.kind).toBe('dodge');
    let n = 0;
    while (p.combat!.action?.kind === 'dodge' && n++ < 120) step(w, hold(BTN.block));
    expect(blockAction(p)).toMatchObject({ t: 0, parryTicks: 0 });
    w.dispose();
  });

  it('block held through an attack recovery rises with no window', async () => {
    const { w, p } = await wearing('relic_drowned_coins', 'relic_gatekeepers_grip');
    step(w, press(BTN.light));
    step(w, press(BTN.block));
    expect(p.combat!.action?.kind).toBe('attack');
    let n = 0;
    while (p.combat!.action?.kind === 'attack' && n++ < 200) step(w, hold(BTN.block));
    expect(blockAction(p)).toMatchObject({ t: 0, parryTicks: 0 });
    w.dispose();
  });

  it('a press 14 ticks before the guard can rise keeps what is left of the lengthened window', async () => {
    for (const [relics, want] of [[[], 0], [['relic_drowned_coins'], coins - 14]] as const) {
      const { w, p } = await wearing(...relics);
      p.combat!.action = { kind: 'hitstun', t: 0, dur: 15, knockdown: false };
      step(w, press(BTN.block));
      stepN(w, 14, () => hold(BTN.block));
      expect(blockAction(p), relics.join() || 'no relic').toMatchObject({ t: 0, parryTicks: want });
      w.dispose();
    }
    expect(coins - 14).toBe(2);
  });

  it("a mashed press with the Grip gets the Grip's window, not the full one", async () => {
    const { w, p } = await wearing('relic_drowned_coins', 'relic_gatekeepers_grip');
    for (let i = 0; i < 3; i++) {
      step(w, press(BTN.block));
      step(w, idle());
    }
    step(w, press(BTN.block));
    expect(blockAction(p)).toMatchObject({ parryTicks: relicMods(['relic_gatekeepers_grip'], false).spamParryTicks });
    w.dispose();
  });

  /** The swinging dummy 1.5 m in front connects on world tick SWING_HIT (as in parry-mechanic). */
  const SWING_HIT = 54;
  /**
   * The dummy's swing, with block held from tick `blockFrom`. With `rise`, the player is in hitstun
   * until then, so the guard can't go up before tick `rise`. Reports what the blow met and the
   * window the guard rose with.
   */
  async function swungAt(relics: string[], blockFrom: number, rise?: number) {
    const { w, p } = await wearing(...relics);
    w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
    if (rise !== undefined) p.combat!.action = { kind: 'hitstun', t: 0, dur: rise + 1, knockdown: false };
    const evs = [];
    let window = -1;
    for (let i = w.now; i <= SWING_HIT; i++) {
      const before = p.combat!.action?.kind;
      for (const ev of step(w, i >= blockFrom ? hold(BTN.block) : idle())) evs.push({ tick: i, ev });
      const a = blockAction(p);
      if (a && before !== 'block') {
        if (rise !== undefined) expect(i, 'the guard rose on the tick asked for').toBe(rise);
        window = a.parryTicks;
      }
    }
    w.dispose();
    return { parried: ofType(evs, 'parry').length, blocked: ofType(evs, 'block').length, window };
  }
  const PARRY = { parried: 1, blocked: 0 };
  const BLOCKED = { parried: 0, blocked: 1 };

  it('with Coins a swing parries from a press 15 ticks before it lands; 16 is a plain block', async () => {
    expect(await swungAt(['relic_drowned_coins'], SWING_HIT - 15)).toMatchObject({ ...PARRY, window: coins });
    expect(await swungAt(['relic_drowned_coins'], SWING_HIT - 16)).toMatchObject({ ...BLOCKED, window: coins });
  });

  it('with Coins, block held all through a stagger is a plain block even when the guard rises just before the blow', async () => {
    // Held from the start; the guard goes up by itself 3 ticks before the blow (the old bug parried it).
    expect(await swungAt(['relic_drowned_coins'], 0, SWING_HIT - 3)).toEqual({ ...BLOCKED, window: 0 });
  });

  it('with Coins, a press 14 ticks before the guard can rise parries only in the 2 ticks left', async () => {
    // Up 1 tick before the blow: inside the 2 left. Up 2 before: the window has closed (the old bug gave 4).
    expect(await swungAt(['relic_drowned_coins'], SWING_HIT - 1 - 14, SWING_HIT - 1)).toEqual({ ...PARRY, window: 2 });
    expect(await swungAt(['relic_drowned_coins'], SWING_HIT - 2 - 14, SWING_HIT - 2)).toEqual({ ...BLOCKED, window: 2 });
    // Without Coins the same press has nothing left.
    expect(await swungAt([], SWING_HIT - 1 - 14, SWING_HIT - 1)).toEqual({ ...BLOCKED, window: 0 });
  });
});

describe('Surgebriar', () => {
  const ctxAt = (w: SimWorld, now: number): CombatCtx => ({ now, entities: w.entities, get: (id) => w.get(id), events: [], motion: new Map(), frozen: new Set() });
  const blow = (from: Entity): HitInfo => ({
    move: 'test', base: 40, kind: 'physical', poise: 0, hitstun: 0, knockdown: false, pushback: 0, hitstop: 0,
    unblockable: false, heavy: false, crit: false, mana: 0, from: { ...from.tf.pos }, projectile: false,
  });
  /** A tick on which Surgebriar's roll comes up for this player. */
  const lucky = (p: Entity) => {
    const chance = relicMods(['relic_surgebriar'], false).briarChance;
    for (let now = 1; now < 100000; now++) if (proc(now, p.id, 2, chance)) return now;
    throw new Error('no proc');
  };

  async function struck(def: string) {
    const { w, p } = await wearing('relic_surgebriar');
    const e = w.spawnEnemy(def, { x: 0, y: 0, z: 2 }, Math.PI);
    const info = blow(e);
    const full = computeDamage(e, p, info).damage;
    const hp = p.vitals!.hp = p.vitals!.hpMax = 1000;
    resolveHit(ctxAt(w, lucky(p)), e, p, info);
    const taken = hp - p.vitals!.hp;
    w.dispose();
    return { full, taken, boss: !!e.boss };
  }

  it("never softens a boss's blow", async () => {
    const r = await struck('scrapjaw');
    expect(r.boss).toBe(true);
    expect(r.taken).toBe(r.full);
  });

  it("can still soften an ordinary enemy's blow to block chip", async () => {
    const r = await struck('dummy_swing');
    expect(r.boss).toBe(false);
    expect(r.taken).toBe(Math.max(1, Math.round(r.full * BLOCK.chip)));
    expect(r.taken).toBeLessThan(r.full);
  });
});
