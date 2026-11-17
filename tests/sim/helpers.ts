import { SANDBOX, type LevelDef } from '../../src/content/sandbox';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

export async function makeWorld(level: LevelDef = SANDBOX, seed = 1): Promise<SimWorld> {
  await initPhysics();
  const w = new SimWorld(level, seed);
  w.spawnPlayer(0);
  return w;
}

/** A scripted input for tick `t`: run forward, strafe, sprint, jump on a beat. */
export function scripted(t: number): InputCommand {
  const c = idleInput(0.3 * Math.sin(t / 90));
  c.move = { x: Math.sin(t / 40) * 0.6, y: Math.cos(t / 70) };
  if (t % 200 > 120) c.held |= BTN.sprint;
  if (t % 97 === 0) {
    c.pressed |= BTN.jump;
    c.held |= BTN.jump;
  }
  return c;
}

export function run(w: SimWorld, ticks: number, input: (t: number) => InputCommand = scripted): void {
  for (let i = 0; i < ticks; i++) w.tick(new Map([[0, input(w.now)]]));
}
