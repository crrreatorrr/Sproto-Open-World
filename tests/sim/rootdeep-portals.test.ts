import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DOOR_REVEALED_FLAG, isRootdeep, portalOpenFlag, ROOTDEEP_PORTALS } from '../../src/content/packs/rootdeep';
import { MOUNT } from '../../src/content/mounts';
import type { CellData } from '../../src/content/world/format';
import { BTN, idleInput } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { bakedWorld, die, reload, rest, standAt, tick } from './quests-helpers';

/**
 * Rootdeep Quest 2: a sealed entrance is nothing you can use, an open one travels both ways, and
 * the Pepe Bull never follows you underground. The solid bull (PR #18) is on main, so the rider
 * and shrine checks cover that body too.
 */

const player = (w: SimWorld) => w.playerEntity(0)!;
const bullOf = (w: SimWorld) => w.entities.find((e) => e.mount)!;
const flat = (p: { x: number; z: number }) => ({ x: p.x, z: p.z });

function finishQuest(w: SimWorld, id: string): void {
  player(w).progress!.quests[id] = { status: 'complete', step: 0, progress: [] };
}

/** Stand on a portal. Distance 0 skips the facing test, so a sealed one still counts as "on it". */
function stand(w: SimWorld, id: string): void {
  const at = w.locate(id);
  if (!at) throw new Error(`nothing called ${id}`);
  standAt(w, at.x, at.z);
  const p = player(w);
  p.tf.yaw = p.tf.prevYaw = 0;
  tick(w);
}

function press(w: SimWorld, buttons: number): void {
  const c = idleInput(player(w).tf.yaw);
  c.pressed = c.held = buttons;
  tick(w, c);
}

async function mountBull(w: SimWorld): Promise<void> {
  const bull = bullOf(w);
  standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z);
  const p = player(w);
  p.tf.yaw = p.tf.prevYaw = Math.atan2(bull.tf.pos.x - p.tf.pos.x, bull.tf.pos.z - p.tf.pos.z);
  press(w, BTN.interact);
  for (let i = 0; i < MOUNT.mountTicks + 8 && p.riding?.state !== 'riding'; i++) tick(w);
  if (p.riding?.state !== 'riding') throw new Error('never got into the saddle');
}

/** Through the main door, without resting, so the last shrine stays whatever it was. */
function enterCave(w: SimWorld): void {
  w.world.flags[DOOR_REVEALED_FLAG] = 1;
  tick(w);
  stand(w, 'rd_surface_hedge_north');
  press(w, BTN.interact);
  if (!isRootdeep(player(w).tf.pos.x)) throw new Error('the main door did not open onto the cave');
}

function runUntilRespawn(w: SimWorld): void {
  for (let i = 0; i < 30 && !w.events.some((e) => e.type === 'respawn'); i++) w.tick(new Map());
}

const surfacePortals = Object.values(ROOTDEEP_PORTALS).filter((p) => p.side === 'surface');

/** Hedge and quarry-wall pieces baked into Sproutvale, as [x, y, z, yaw, scale]. */
function nearestBakedWall(p: { pos: readonly [number, number, number] }): number {
  const root = path.resolve(__dirname, '../../public/world/sproutvale');
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'region.json'), 'utf8')) as { cells: { json: string }[] };
  let best = Infinity;
  for (const c of manifest.cells) {
    const data = JSON.parse(fs.readFileSync(path.join(root, '../..', c.json), 'utf8')) as CellData;
    for (const key of ['grove_hedge', 'quarry_rock']) {
      const packed = data.props[key] ?? [];
      for (let i = 0; i < packed.length; i += 5) {
        const d = Math.hypot(p.pos[0] - packed[i], p.pos[2] - packed[i + 2]);
        if (d < best) best = d;
      }
    }
  }
  return best;
}

describe('hidden Rootdeep portals', () => {
  it('shows nothing at a sealed entrance, even standing on it', async () => {
    const w = await bakedWorld();
    stand(w, 'rd_surface_hedge_north');
    expect(w.view().interactTarget(0)).toBeNull();
    w.dispose();
  });

  it('keeps it sealed for a save that has only finished Lost Relics', async () => {
    const w = await bakedWorld();
    finishQuest(w, 'q_relics');
    tick(w);
    stand(w, 'rd_surface_hedge_north');
    expect(w.view().interactTarget(0)).toBeNull();
    w.dispose();
  });

  it('opens the main door once it is revealed, and travels to hall h1', async () => {
    const w = await bakedWorld();
    w.world.flags[DOOR_REVEALED_FLAG] = 1;
    tick(w);
    stand(w, 'rd_surface_hedge_north');
    expect(w.view().interactTarget(0)?.kind).toBe('portal');
    expect(w.view().interactTarget(0)?.name).toBe('Slip through the hedge');
    press(w, BTN.interact);
    expect(isRootdeep(player(w).tf.pos.x)).toBe(true);
    expect(w.world.flags['rootdeep.open.hedge_north']).toBe(1);
    w.dispose();
  });

  it('opens a surface entrance from inside, and then it works both ways', async () => {
    const w = await bakedWorld();
    stand(w, 'rd_cave_hedge_south');
    press(w, BTN.interact);
    expect(flat(player(w).tf.pos)).toEqual({ x: 54.8, z: 132 });
    stand(w, 'rd_surface_hedge_south');
    expect(w.view().interactTarget(0)?.kind).toBe('portal');
    press(w, BTN.interact);
    expect(isRootdeep(player(w).tf.pos.x)).toBe(true);
    w.dispose();
  });

  it('leaves the bull on the surface when you rest in the cave', async () => {
    const w = await bakedWorld();
    const before = bullOf(w).tf.pos.x;
    rest(w, 'shrine_rootdeep_lantern');
    expect(isRootdeep(bullOf(w).tf.pos.x)).toBe(false);
    expect(bullOf(w).tf.pos.x).toBe(before);
    w.dispose();
  });

  it('offers Dismount, not the entrance, to a rider', async () => {
    const w = await bakedWorld();
    w.world.flags[portalOpenFlag('hedge_north')] = 1;
    tick(w);
    await mountBull(w);
    stand(w, 'rd_surface_hedge_north');
    expect(w.view().interactTarget(0)?.kind).toBe('mount');
    expect(isRootdeep(player(w).tf.pos.x)).toBe(false);
    // Interact gets you down. It does not take the bull through the wall.
    press(w, BTN.interact);
    expect(w.view().events.some((e) => e.type === 'portalTravel')).toBe(false);
    expect(isRootdeep(player(w).tf.pos.x)).toBe(false);
    expect(isRootdeep(bullOf(w).tf.pos.x)).toBe(false);
    w.dispose();
  });

  it('offers the open mouth, not Ride, once you have dismounted against it', async () => {
    const w = await bakedWorld();
    w.world.flags[portalOpenFlag('hedge_north')] = 1;
    tick(w);
    await mountBull(w);
    stand(w, 'rd_surface_hedge_north');
    press(w, BTN.interact);
    const p = player(w);
    for (let i = 0; i < MOUNT.dismountTicks + 8 && p.riding; i++) tick(w);
    expect(p.riding).toBeUndefined();
    const at = w.locate('rd_surface_hedge_north');
    if (!at) throw new Error('no hedge mouth');
    p.tf.yaw = p.tf.prevYaw = Math.atan2(at.x - p.tf.pos.x, at.z - p.tf.pos.z);
    tick(w);
    expect(w.view().interactTarget(0)?.kind).toBe('portal');
    expect(isRootdeep(bullOf(w).tf.pos.x)).toBe(false);
    w.dispose();
  });

  it('refuses a bull call from inside the cave and leaves the bull on the surface', async () => {
    const w = await bakedWorld();
    const home = bullOf(w).tf.pos.x;
    // Grunt Warren and the vault are where a far call appears on the cave floor today.
    // Lantern Hall is where that same call fails. Neither may bring the bull underground.
    for (const [x, z] of [[4352, 148], [4352, 256], [4264, 168]] as const) {
      standAt(w, x, z);
      tick(w);
      press(w, BTN.callMount);
      expect(isRootdeep(bullOf(w).tf.pos.x), `${x},${z}`).toBe(false);
      expect(bullOf(w).tf.pos.x, `${x},${z}`).toBe(home);
      expect(w.events.some((e) => e.type === 'mountCall' && e.phase === 'failed'), `${x},${z}`).toBe(true);
    }
    w.dispose();
  });

  it('wakes a Continue at a cave shrine on the cave floor', async () => {
    const w = await bakedWorld();
    rest(w, 'shrine_rootdeep_lantern');
    const next = await reload(w);
    expect(isRootdeep(player(next).tf.pos.x)).toBe(true);
    expect(Math.abs(player(next).tf.pos.y)).toBeLessThan(0.5);
    // A fresh world builds the bull at its surface home. Continue does not bring it down.
    expect(isRootdeep(bullOf(next).tf.pos.x)).toBe(false);
    next.dispose();
  });

  it('wakes at the surface shrine after dying in the cave without resting there', async () => {
    const w = await bakedWorld();
    rest(w, 'shrine_first_light');
    enterCave(w);
    die(w);
    runUntilRespawn(w);
    expect(isRootdeep(player(w).tf.pos.x)).toBe(false);
    expect(isRootdeep(bullOf(w).tf.pos.x)).toBe(false);
    w.dispose();
  });

  it('puts every surface portal within 5 m of a baked wall piece', () => {
    for (const p of surfacePortals) expect(nearestBakedWall(p), p.id).toBeLessThanOrEqual(5);
  });
});
