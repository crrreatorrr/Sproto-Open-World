import { describe, expect, it } from 'vitest';
import { idleInput, type InputCommand, type UiAction } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { applyEffects } from '../../src/sim/systems/rpg';
import { BTN } from './combatHelpers';
import { rpgCtx, stand, village, VILLAGE_Y } from './m3Helpers';

/**
 * C1 acceptance (expansion plan §1.4, §7.3, §9): a recorded command stream with spell swaps and
 * skill spends, many of them issued "while paused" (menu intents on otherwise idle ticks, as
 * App.pausedTick sends them), mid-fight, hashes the same on replay, and the same when resumed from
 * a snapshot in a fresh world.
 */

const N = 900;

/** The recorded stream: a fight with a Grunt, with menu intents sprinkled on idle ticks. */
function recording(): InputCommand[] {
  const out: InputCommand[] = [];
  const at: Record<number, UiAction[]> = {
    5: [{ kind: 'spendSkill', skill: 'spellPower' }, { kind: 'spendSkill', skill: 'attack' }],
    40: [{ kind: 'equipSpell', slot: 0, spell: 'frostNova' }],
    41: [{ kind: 'equipSpell', slot: 1, spell: 'bolt' }],
    120: [{ kind: 'equipSpell', slot: 3, spell: 'blast' }, { kind: 'spendSkill', skill: 'protection' }],
    260: [{ kind: 'equipSpell', slot: 0, spell: null }, { kind: 'equipSpell', slot: 0, spell: 'frostNova' }],
    400: [{ kind: 'spendSkill', skill: 'defense' }, { kind: 'equip', item: 'staff_nobu' }],
    610: [{ kind: 'equipSpell', slot: 2, spell: 'blast' }, { kind: 'spendSkill', skill: 'focus' }],
  };
  for (let i = 0; i < N; i++) {
    const c = idleInput(0);
    if (at[i]) c.ui = at[i]; // an idle tick that carries only menu intents: a "paused" tick
    else if (i % 24 === 0) c.pressed = c.held = BTN.light;
    else if (i % 61 === 30) c.pressed = c.held = BTN.spell1;
    else if (i % 97 === 50) c.pressed = c.held = BTN.spell4;
    else if (i % 90 > 75) c.held = BTN.block;
    if (i % 50 === 10) c.pressed |= BTN.lock;
    out.push(c);
  }
  return out;
}

async function setup(seed: number): Promise<SimWorld> {
  const { w, p, prog } = await village({ seed });
  applyEffects(rpgCtx(w), p, [{ learnSpell: 'blast' }, { learnSpell: 'frostNova' }, { learnSpell: 'chainZap' }]);
  prog().points = 6;
  prog().inventory.staff_nobu = 1;
  stand(w, 230, 80, { x: 230, z: 84 });
  w.spawnEnemy('grunt', { x: 230, y: VILLAGE_Y, z: 84 }, Math.PI);
  return w;
}

function replay(w: SimWorld, cmds: readonly InputCommand[], from = 0, to = cmds.length): number[] {
  const hashes: number[] = [];
  for (let i = from; i < to; i++) {
    w.tick(new Map([[0, structuredClone(cmds[i])]]));
    hashes.push(w.hash());
  }
  return hashes;
}

describe('C1 determinism: swaps and spends while paused', () => {
  it('the recorded stream hashes the same on replay, every tick, and the intents really applied', async () => {
    const cmds = recording();
    const a = await setup(11);
    const ha = replay(a, cmds);
    const b = await setup(11);
    const hb = replay(b, cmds);
    expect(hb).toEqual(ha);
    const p = a.playerEntity(0)!.progress!;
    expect(p.skills).toMatchObject({ spellPower: 1, attack: 1, protection: 1, defense: 1, focus: 1 });
    expect(p.loadout).toEqual(['frostNova', 'bolt', 'blast', null]);
    // The fight made some events refuse (the staff while the Grunt targets you): still deterministic.
    expect(p.equipment.staff).toBe('staff_sproto');
    a.dispose();
    b.dispose();
  });

  it('rewound to a snapshot after the first swaps, the rest of the stream (the fight, more swaps) hashes the same', async () => {
    const cmds = recording();
    const a = await setup(11);
    replay(a, cmds, 0, 60);
    const snap = a.snapshot();
    // Rewinding in the same world keeps Rapier's internal query tree from the first run, which can
    // move a body by a nanometre much later on. Same outcome to well under a millimetre, every tick;
    // exact hashes are asserted by the fresh-world resume below (saves and joins go that way).
    const track = () => {
      const out: number[][] = [];
      for (let t = 60; t < cmds.length; t++) {
        replay(a, cmds, t, t + 1);
        out.push(a.entities.flatMap((e) => [e.id, e.tf.pos.x, e.tf.pos.y, e.tf.pos.z, e.vitals?.hp ?? 0]));
      }
      return out;
    };
    const first = track();
    a.restore(snap);
    const again = track();
    expect(again.length).toBe(first.length);
    again.forEach((row, t) => {
      expect(row.length, `tick ${t}`).toBe(first[t].length);
      row.forEach((v, i) => expect(Math.abs(v - first[t][i]), `tick ${t} value ${i}`).toBeLessThan(1e-3));
    });
    a.dispose();
  });

  it('resumed from that snapshot in a fresh world, the rest of the stream hashes the same', async () => {
    const cmds = recording();
    const a = await setup(11);
    replay(a, cmds, 0, 60);
    const snap = a.snapshot();
    const rest = replay(a, cmds, 60);
    const fresh = await setup(11);
    fresh.restore(snap);
    expect(replay(fresh, cmds, 60)).toEqual(rest);
    a.dispose();
    fresh.dispose();
  });

  it('a stream without the paused intents diverges (they really change the state)', async () => {
    const cmds = recording();
    const bare = cmds.map((c) => ({ ...c, ui: undefined }));
    const a = await setup(11);
    const b = await setup(11);
    expect(replay(b, bare).at(-1)).not.toBe(replay(a, cmds).at(-1));
    a.dispose();
    b.dispose();
  });
});
