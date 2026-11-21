import { beforeAll, describe, expect, it } from 'vitest';
import { getDungeon } from '../../src/content/dungeons/catalog';
import { SANDBOX } from '../../src/content/sandbox';
import { idleInput } from '../../src/sim/commands';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';
import { SHRINE_ARRIVE_OFFSET } from '../../src/sim/systems/travel';
import { evs, interact, tick1, ui, yawTo } from './m3Helpers';

/** Shrines inside a Campaign Dungeon: there to use, and a rest moves the respawn point to them. */

beforeAll(async () => {
  await initPhysics();
});

function dungeon(id: 'L01' | 'L07'): SimWorld {
  const w = new SimWorld(SANDBOX, 1);
  w.spawnPlayer(0);
  w.startDungeon(id);
  for (let i = 0; i < 3; i++) tick1(w);
  return w;
}

/** Stand 1.5 m south of a shrine, facing it. */
function standBy(w: SimWorld, id: string): void {
  const at = w.locate(id)!;
  w.teleportPlayer(0, { x: at.x, y: at.y + 0.1, z: at.z - 1.5 });
  const e = w.playerEntity(0)!;
  e.tf.yaw = e.tf.prevYaw = yawTo(at.x, at.z - 1.5, at.x, at.z);
  for (let i = 0; i < 3; i++) tick1(w);
}

describe('dungeon shrines in the sim', () => {
  it('a dungeon spawns its shrines, and only those', () => {
    const w = dungeon('L01');
    const found = w.entities.filter((e) => e.interactable?.kind === 'shrine').map((e) => e.interactable!.id);
    expect(found).toEqual(getDungeon('L01').shrines.map((s) => s.id));
    w.dispose();
  });

  it('the session moves on from tick to tick', () => {
    const w = dungeon('L01');
    const t = w.dungeon!.tick;
    tick1(w);
    expect(w.dungeon!.tick).toBe(t + 1);
    w.dispose();
  });

  it('you can rest at one: health and tonics back, and it becomes the checkpoint you wake at', () => {
    const w = dungeon('L07');
    const def = getDungeon('L07');
    const shrine = def.shrines[1];
    const p = () => w.playerEntity(0)!;
    expect(w.dungeon!.activeCheckpointId).toBe(def.checkpoints[0].id);
    standBy(w, shrine.id);
    expect(w.dungeon!.activeCheckpointId, 'the shrine is off the checkpoint ring').toBe(def.checkpoints[0].id);
    p().vitals!.hp = 5;
    p().progress!.tonics.charges = 0;
    expect(evs(tick1(w, interact()), 'interact').map((e) => e.object)).toEqual([shrine.id]);
    expect(p().progress!.atShrine).toBe(shrine.id);
    expect(evs(tick1(w, ui([{ kind: 'rest' }])), 'shrineRest').map((e) => e.shrine)).toEqual([shrine.id]);
    expect(p().vitals!.hp).toBe(p().vitals!.hpMax);
    expect(p().progress!.tonics.charges).toBe(p().progress!.tonics.max);
    expect(w.dungeon!.activeCheckpointId).toBe(shrine.checkpointId);
    expect(w.dungeon!.activatedCheckpoints).toContain(shrine.checkpointId);
    expect(w.dungeonEvents.some((e) => e.type === 'checkpointActivated' && e.checkpointId === shrine.checkpointId)).toBe(true);
    tick1(w, ui([{ kind: 'closeMenu' }]));

    // Die somewhere else: you wake beside the shrine.
    w.teleportPlayer(0, { x: def.spawn[0], y: def.spawn[1] + 0.2, z: def.spawn[2] });
    tick1(w);
    p().vitals!.hp = 0;
    p().combat!.action = { kind: 'dead', t: 0 } as never;
    w.tick(new Map([[0, idleInput(0)]]));
    expect(w.dungeonEvents.some((e) => e.type === 'playerRespawn')).toBe(true);
    expect(Math.hypot(p().tf.pos.x - (shrine.pos[0] + SHRINE_ARRIVE_OFFSET), p().tf.pos.z - (shrine.pos[2] + SHRINE_ARRIVE_OFFSET))).toBeLessThan(0.5);
    expect(p().combat?.action?.kind).not.toBe('dead');
    w.dispose();
  });
});

describe("god mode's phone and the dungeon shrines", () => {
  const call = (shrine: string) => ui([{ kind: 'fastTravel', shrine }]);

  it('calls a shrine in another dungeon by loading that dungeon, and only in god mode', () => {
    const w = dungeon('L01');
    const target = getDungeon('L07').shrines[1]!;
    expect(evs(tick1(w, call(target.id)), 'portalTravel')).toHaveLength(0);
    tick1(w, ui([{ kind: 'godMode', on: true }]));
    const [ev] = evs(tick1(w, call(target.id)), 'portalTravel');
    expect(ev).toMatchObject({ to: 'dungeon:L07', shrine: target.id });
    w.dispose();
  });

  it('calls a shrine of this dungeon by moving there', () => {
    const w = dungeon('L07');
    const target = getDungeon('L07').shrines[2]!;
    tick1(w, ui([{ kind: 'godMode', on: true }]));
    const events = tick1(w, call(target.id));
    expect(evs(events, 'travel')).toHaveLength(1);
    expect(evs(events, 'portalTravel')).toHaveLength(0);
    w.dispose();
  });

  it('a dungeon started at a shrine puts you beside it, and that is where you wake', () => {
    const def = getDungeon('L07');
    const sh = def.shrines[1]!;
    const w = new SimWorld(SANDBOX, 1);
    w.spawnPlayer(0);
    w.startDungeon('L07', sh.id);
    for (let i = 0; i < 3; i++) tick1(w);
    const p = w.playerEntity(0)!;
    expect(Math.hypot(p.tf.pos.x - sh.pos[0], p.tf.pos.z - sh.pos[2])).toBeLessThan(3);
    expect(w.dungeon!.activeCheckpointId).toBe(sh.checkpointId);
    // An id from some other dungeon is ignored: the ordinary spawn.
    const w2 = new SimWorld(SANDBOX, 1);
    w2.spawnPlayer(0);
    w2.startDungeon('L01', sh.id);
    const p2 = w2.playerEntity(0)!;
    expect(Math.hypot(p2.tf.pos.x - getDungeon('L01').spawn[0], p2.tf.pos.z - getDungeon('L01').spawn[2])).toBeLessThan(0.5);
    w.dispose();
    w2.dispose();
  });
});
