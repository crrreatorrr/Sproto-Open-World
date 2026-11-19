import { describe, expect, it } from 'vitest';
import { BLOCK, BREAK_CRIT, PLAYER_MOVES } from '../../src/content/combat';
import { BTN, atYaw, cmd, combatWorld, hitsOn, hold, idle, press, step, stepN } from './combatHelpers';

/** Where the parry and the melee strikes meet: which bonus wins, and what a stun survives. */
const SWING_HIT = 54;

/** The swinging dummy 1.5 m ahead, parried, with the hit-stop over. */
async function stunned() {
  const { w, p } = await combatWorld();
  const d = w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
  for (let i = w.now; i <= SWING_HIT; i++) step(w, i >= SWING_HIT - 5 ? hold(BTN.block) : idle());
  stepN(w, BLOCK.parryHitstop);
  expect(d.combat!.action).toMatchObject({ kind: 'stagger', reason: 'parried' });
  return { w, p, d };
}

const riposteDamage = 20 * PLAYER_MOVES.riposte.mv * 1.5;

describe('the parry stun and the melee strikes', () => {
  it('a light hit on a parried enemy does not cut its stun short', async () => {
    const { w, d } = await stunned();
    step(w, press(BTN.light));
    const hits = hitsOn(stepN(w, 30), d.id);
    expect(hits.length).toBe(1);
    expect(d.combat!.action).toMatchObject({ kind: 'stagger', reason: 'parried' });
    w.dispose();
  });

  it('a heavy out of a sprint during the riposte window is the riposte, not a sprint attack', async () => {
    const { w, p } = await stunned();
    step(w, cmd({ move: { x: 0, y: 1 }, hold: BTN.sprint, press: BTN.heavy }));
    expect(p.combat!.action).toMatchObject({ kind: 'attack', move: 'riposte' });
    w.dispose();
  });

  it('a riposte from behind is a riposte: the backstab bonus does not stack on it', async () => {
    const { w, d } = await stunned();
    d.tf.yaw = 0; // Facing away from the player.
    step(w, press(BTN.heavy));
    const [hit] = hitsOn(stepN(w, BLOCK.riposteStartup + 24), d.id);
    expect(hit.ev.strike).toBeUndefined();
    expect(hit.ev.damage).toBe(Math.round(riposteDamage * BLOCK.riposteBonus));
    w.dispose();
  });

  it('a riposte turns to the enemy it parried, even with another enemy hard-locked to one side', async () => {
    const { w, p } = await combatWorld();
    const d = w.spawnEnemy('dummy_swing', { x: 0, y: 0, z: 1.5 }, Math.PI);
    const other = w.spawnEnemy('dummy_straw', atYaw(-65, 3), Math.PI);
    p.combat!.lock = other.id;
    for (let i = w.now; i <= SWING_HIT; i++) step(w, i >= SWING_HIT - 5 ? hold(BTN.block) : idle());
    stepN(w, BLOCK.parryHitstop);
    expect(d.combat!.action).toMatchObject({ kind: 'stagger', reason: 'parried' });
    expect(p.combat!.lock).toBe(other.id);
    step(w, press(BTN.heavy));
    const [hit] = hitsOn(stepN(w, BLOCK.riposteStartup + 24), d.id);
    expect(hit?.ev.move).toBe('riposte');
    w.dispose();
  });

  it('a riposte on an enemy the parry broke takes the break critical, not both bonuses', async () => {
    const { w, d } = await stunned();
    d.combat!.action = { kind: 'stagger', t: 0, dur: 120, reason: 'broken' };
    step(w, press(BTN.heavy));
    const [hit] = hitsOn(stepN(w, BLOCK.riposteStartup + 24), d.id);
    expect(hit.ev.strike).toBe('breakCrit');
    expect(hit.ev.damage).toBe(Math.round(riposteDamage * BREAK_CRIT.damage));
    w.dispose();
  });
});
