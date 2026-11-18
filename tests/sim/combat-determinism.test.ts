import { describe, expect, it } from 'vitest';
import { SANDBOX } from '../../src/content/sandbox';
import type { InputCommand } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, step } from './combatHelpers';

/**
 * Determinism with combat (plan §2.2): the populated sandbox (three dummies and the Brute) and a
 * scripted fight. The script only depends on the tick number.
 */
async function populated(seed = 1): Promise<SimWorld> {
  await initPhysics();
  const w = new SimWorld(SANDBOX, seed);
  w.spawnPlayer(0);
  w.populate();
  return w;
}

const toward = (x: number, z: number) => Math.atan2(x, z);

/** Fight the dummies, walk over to the Brute (it comes to meet you), then fight it. */
function fight(t: number): InputCommand {
  const camYaw = t < 700 ? toward(5, 4) : toward(-7, -28.5);
  const walking = t < 58 || (t >= 700 && t < 900);
  const fighting = !walking;
  let press = 0, hold = 0;
  if (fighting) {
    if (t % 11 === 0) press |= BTN.light;
    if (t % 47 === 0) press |= BTN.heavy;
    if (t % 47 < 25 && t % 94 < 47) hold |= BTN.heavy; // every other heavy is charged
    if (t % 61 === 0) press |= BTN.dodge;
    if (t % 150 >= 120 && t % 150 < 140) hold |= BTN.block;
  }
  if (t === 5 || t === 705 || t === 900) press |= BTN.lock;
  const strafe = fighting ? Math.sin(t / 30) * 0.3 : 0;
  return cmd({ camYaw, move: { x: strafe, y: walking ? 1 : 0 }, press, hold, lockSwitch: t % 200 === 100 ? 1 : 0 });
}

/** Runs the script; returns a log of the fight's notable events. */
function run(w: SimWorld, ticks: number): string[] {
  const log: string[] = [];
  for (let i = 0; i < ticks; i++) {
    const t = w.now;
    for (const e of step(w, fight(t))) {
      if (e.type === 'hit') log.push(`${t} hit ${e.attacker}>${e.target} ${e.move} ${e.damage}`);
      else if (e.type === 'telegraph' || e.type === 'death' || e.type === 'respawn' || e.type === 'parry') log.push(`${t} ${e.type} ${JSON.stringify(e)}`);
    }
  }
  return log;
}

const bruteId = (w: SimWorld) => w.entities.find((e) => e.brain?.def === 'brute')!.id;

describe('determinism with combat', () => {
  it('two populated worlds running the same fight hash the same every 100 ticks', async () => {
    const a = await populated();
    const b = await populated();
    const log: string[] = [];
    for (let i = 0; i < 18; i++) {
      log.push(...run(a, 100));
      run(b, 100);
      expect(a.hash(), `tick ${a.now}`).toBe(b.hash());
    }
    // It really was a fight: both sides landed hits and the Brute telegraphed its attacks.
    const brute = bruteId(a);
    expect(log.filter((l) => l.includes(' hit ')).length).toBeGreaterThan(5);
    expect(log.some((l) => l.includes(`hit 1>${brute}`))).toBe(true);
    expect(log.filter((l) => l.includes(`"type":"telegraph","entity":${brute}`)).length).toBeGreaterThan(2);
    expect(log.some((l) => l.includes(`hit ${brute}>1`))).toBe(true);
    a.dispose();
    b.dispose();
  });

  it('a snapshot restored mid-fight continues identically', async () => {
    const a = await populated();
    run(a, 1050); // in the middle of the Brute fight
    // Mid-fight: something is mid-action.
    expect(a.entities.some((e) => e.combat?.action)).toBe(true);
    const snap = a.snapshot();
    const hashes: number[] = [];
    for (let i = 0; i < 8; i++) {
      run(a, 100);
      hashes.push(a.hash());
    }
    a.restore(snap);
    for (let i = 0; i < 8; i++) {
      run(a, 100);
      expect(a.hash(), `tick ${a.now}`).toBe(hashes[i]);
    }
    a.dispose();
  });

  it('a different seed changes the fight (the Brute rolls its moves from the ai stream)', async () => {
    const a = await populated(1);
    const b = await populated(2);
    const la = run(a, 1800);
    const lb = run(b, 1800);
    const brute = `"entity":${bruteId(a)},"move"`;
    expect(la.filter((l) => l.includes(brute))).not.toEqual(lb.filter((l) => l.includes(brute)));
    a.dispose();
    b.dispose();
  });
});
