import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  DUNGEON_IDS,
  DUNGEON_LIST,
  DUNGEONS,
  getDungeon,
  getDungeonById,
} from '../../src/content/dungeons/catalog';
import { GUN_ITEM_IDS } from '../../src/content/guns';
import { DungeonView } from '../../src/render/dungeon/DungeonView';
import {
  createDungeonSession,
  stepDungeon,
} from '../../src/sim/dungeon/DungeonDirector';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { compileDungeonColliders } from '../../src/sim/physics/dungeonColliders';

beforeAll(async () => {
  await initPhysics();
});

describe('Campaign Dungeons Catalog (L01-L10)', () => {
  it('defines all 10 campaign dungeons L01-L10 with valid structure and rewards', () => {
    expect(DUNGEON_IDS).toEqual([
      'L01',
      'L02',
      'L03',
      'L04',
      'L05',
      'L06',
      'L07',
      'L08',
      'L09',
      'L10',
    ]);
    expect(DUNGEON_LIST).toHaveLength(10);

    const gunIdSet = new Set<string>(GUN_ITEM_IDS);

    for (const id of DUNGEON_IDS) {
      const d = getDungeon(id);
      expect(d).toBe(DUNGEONS[id]);
      expect(getDungeonById(id)).toBe(d);
      expect(d.name.length).toBeGreaterThan(0);
      expect(d.subtitle.length).toBeGreaterThan(0);
      expect([1, 2, 3]).toContain(d.act);
      expect(d.suggestedLevel).toBeGreaterThanOrEqual(1);
      expect(d.solids.length).toBeGreaterThan(5);
      expect(d.checkpoints.length).toBeGreaterThanOrEqual(2);
      expect(d.encounters.length).toBeGreaterThanOrEqual(2);
      expect(d.mechanisms.some((m) => m.kind === 'door')).toBe(true);
      expect(d.rewardXp).toBeGreaterThan(0);
      expect(d.rewardSprouts).toBeGreaterThan(0);
      if (d.rewardGun) {
        expect(gunIdSet.has(d.rewardGun), `${id} rewardGun ${d.rewardGun}`).toBe(true);
      }
      // Every lockdown door referenced by an encounter must exist in mechanisms
      const doorIds = new Set(
        d.mechanisms.filter((m) => m.kind === 'door').map((m) => m.id),
      );
      for (const enc of d.encounters) {
        expect(enc.enemies.length).toBeGreaterThan(0);
        if (enc.lockdownDoorId) {
          expect(doorIds.has(enc.lockdownDoorId), `${id} missing door ${enc.lockdownDoorId}`).toBe(
            true,
          );
        }
      }
    }
  });

  it('assigns progressive movement ability unlocks on L01, L02, L04, and L05', () => {
    expect(getDungeon('L01').unlockAbility).toBe('slide');
    expect(getDungeon('L02').unlockAbility).toBe('dash');
    expect(getDungeon('L03').unlockAbility).toBeNull();
    expect(getDungeon('L04').unlockAbility).toBe('doubleJump');
    expect(getDungeon('L05').unlockAbility).toBe('grapple');
  });
});

describe('Rapier Dungeon Colliders (dungeonColliders)', () => {
  it('compiles all 10 dungeons L01-L10 into Rapier3D and hits floors and ramps with raycasts', () => {
    for (const d of DUNGEON_LIST) {
      const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
      const compiled = compileDungeonColliders(world, d);
      expect(compiled.dungeonId).toBe(d.id);
      expect(compiled.colliderCount).toBeGreaterThanOrEqual(d.solids.length);

      // Raycast straight down at spawn -> must hit floor near y = 0
      const spawnRay = new RAPIER.Ray(
        { x: d.spawn[0], y: d.spawn[1] + 2, z: d.spawn[2] },
        { x: 0, y: -1, z: 0 },
      );
      const spawnHit = world.castRayAndGetNormal(spawnRay, 10, true);
      expect(spawnHit, `${d.id} spawn floor raycast`).not.toBeNull();
      const hitY = d.spawn[1] + 2 - spawnHit!.timeOfImpact;
      expect(hitY).toBeCloseTo(0, 1);

      // Raycast straight down at exit -> must hit floor near y = 0
      const exitRay = new RAPIER.Ray(
        { x: d.exit[0], y: d.exit[1] + 2, z: d.exit[2] },
        { x: 0, y: -1, z: 0 },
      );
      const exitHit = world.castRay(exitRay, 10, true);
      expect(exitHit, `${d.id} exit floor raycast`).not.toBeNull();

      // Raycast straight down onto every ramp's center -> must hit sloped surface
      const ramps = d.solids.filter((s) => s.kind === 'ramp');
      expect(ramps.length, `${d.id} should have at least one ramp`).toBeGreaterThan(0);
      for (const r of ramps) {
        const rampRay = new RAPIER.Ray(
          { x: r.at[0], y: r.at[1] + r.size[1] + 2, z: r.at[2] },
          { x: 0, y: -1, z: 0 },
        );
        const rampHit = world.castRayAndGetNormal(rampRay, 20, true);
        expect(rampHit, `${d.id} ramp ${r.id} raycast`).not.toBeNull();
        // Sloped surface has 0 < normal.y < 0.99
        expect(rampHit!.normal.y).toBeGreaterThan(0.1);
        expect(rampHit!.normal.y).toBeLessThan(0.99);
      }

      // Dispose removes all colliders cleanly
      compiled.dispose();
      const afterDispose = world.castRay(spawnRay, 10, true);
      expect(afterDispose).toBeNull();
      world.free();
    }
  });

  it('toggles dynamic lockdown door colliders on and off cleanly', () => {
    const d = getDungeon('L01');
    const door = d.mechanisms.find((m) => m.kind === 'door')!;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const compiled = compileDungeonColliders(world, d);

    const doorRay = new RAPIER.Ray(
      { x: door.pos[0] - 4, y: door.pos[1], z: door.pos[2] },
      { x: 1, y: 0, z: 0 },
    );

    // Initially unsealed -> ray passes right through
    expect(compiled.isDoorSealed(door.id)).toBe(false);
    expect(world.castRay(doorRay, 8, true)).toBeNull();

    // Seal door -> ray hits the barrier
    expect(compiled.setDoorSealed(door.id, true)).toBe(true);
    expect(compiled.isDoorSealed(door.id)).toBe(true);
    const hit = world.castRay(doorRay, 8, true);
    expect(hit).not.toBeNull();
    expect(hit!.timeOfImpact).toBeCloseTo(4 - door.size[0] * 0.5, 1);

    // Unseal door -> ray passes through again
    expect(compiled.setDoorSealed(door.id, false)).toBe(true);
    expect(compiled.isDoorSealed(door.id)).toBe(false);
    expect(world.castRay(doorRay, 8, true)).toBeNull();

    compiled.dispose();
    world.free();
  });

  it('compiles terrain heightfield colliders on outdoor dungeons (L03)', () => {
    const d = getDungeon('L03');
    expect(d.terrain).toBeDefined();
    const t = d.terrain!;
    const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    const compiled = compileDungeonColliders(world, d);

    const cx = t.origin[0] + t.size[0] * 0.5;
    const cz = t.origin[2] + t.size[1] * 0.5;
    const ray = new RAPIER.Ray({ x: cx, y: 10, z: cz }, { x: 0, y: -1, z: 0 });
    const hit = world.castRay(ray, 20, true);
    expect(hit).not.toBeNull();

    compiled.dispose();
    world.free();
  });
});

describe('DungeonDirector (pure simulation state machine)', () => {
  it('runs encounter activation -> lockdown -> checkpoint respawn (NO Second Wind) -> clear -> completion & ability unlock', () => {
    const d = getDungeon('L01');
    let state = createDungeonSession('L01');
    expect(state.dungeonId).toBe('L01');
    expect(state.activeCheckpointId).toBe('L01-CP0');
    expect(state.cleared).toBe(false);

    // 1. Enter first encounter trigger -> activates encounter and seals lockdown door
    let res = stepDungeon(state, d.encounters[0].triggerPos, false, 6, false);
    state = res.state;
    expect(state.activeEncounterId).toBe('L01-E1');
    expect(state.sealedDoorIds).toContain('L01-door-1');
    expect(res.events.some((e) => e.type === 'encounterStarted' && e.encounterId === 'L01-E1')).toBe(
      true,
    );
    expect(
      res.events.some(
        (e) => e.type === 'doorStateChanged' && e.doorId === 'L01-door-1' && e.sealed === true,
      ),
    ).toBe(true);

    // 2. Player dies mid-encounter -> immediate clean checkpoint respawn (NO Second Wind!)
    res = stepDungeon(state, d.encounters[0].triggerPos, true, 4, false);
    state = res.state;
    expect(state.respawnCount).toBe(1);
    expect(state.activeEncounterId).toBeNull();
    expect(state.encounterStates['L01-E1']).toBe('pending');
    expect(state.sealedDoorIds).not.toContain('L01-door-1');
    const respawnEvt = res.events.find((e) => e.type === 'playerRespawn');
    expect(respawnEvt).toEqual({
      type: 'playerRespawn',
      checkpointId: 'L01-CP0',
      pos: d.checkpoints[0].pos,
      fullRestore: true,
    });

    // 3. Re-enter E1 and clear all enemies -> unlocks lockdown door
    res = stepDungeon(state, d.encounters[0].triggerPos, false, 6, false);
    state = res.state;
    expect(state.activeEncounterId).toBe('L01-E1');

    res = stepDungeon(state, d.encounters[0].triggerPos, false, 0, false);
    state = res.state;
    expect(state.encounterStates['L01-E1']).toBe('cleared');
    expect(state.sealedDoorIds).not.toContain('L01-door-1');
    expect(state.unlockedDoorIds).toContain('L01-door-1');
    expect(res.events.some((e) => e.type === 'encounterCleared' && e.encounterId === 'L01-E1')).toBe(
      true,
    );

    // 4. Advance to checkpoint CP2 before boss arena
    const cp2 = d.checkpoints[2];
    res = stepDungeon(state, cp2.pos, false, 0, false);
    state = res.state;
    expect(state.activeCheckpointId).toBe(cp2.id);
    expect(
      res.events.some((e) => e.type === 'checkpointActivated' && e.checkpointId === cp2.id),
    ).toBe(true);

    // 5. Reaching exit BEFORE boss is defeated must NOT clear the dungeon
    res = stepDungeon(state, d.exit, false, 0, false);
    state = res.state;
    expect(state.cleared).toBe(false);

    // 6. Trigger boss encounter and defeat boss
    const bossEnc = d.encounters.find((e) => e.boss)!;
    res = stepDungeon(state, bossEnc.triggerPos, false, 5, false);
    state = res.state;
    expect(state.activeEncounterId).toBe(bossEnc.id);
    expect(state.sealedDoorIds).toContain(bossEnc.lockdownDoorId);

    res = stepDungeon(state, bossEnc.triggerPos, false, 0, false);
    state = res.state;
    expect(state.bossDefeated).toBe(true);
    expect(state.sealedDoorIds).not.toContain(bossEnc.lockdownDoorId);

    // 7. Reach exit portal -> clears dungeon, grants XP/Sprouts/ability unlock/gun, returns to overworld
    res = stepDungeon(state, d.exit, false, 0, false);
    state = res.state;
    expect(state.cleared).toBe(true);
    expect(res.events).toContainEqual({
      type: 'dungeonCleared',
      dungeonId: 'L01',
      rewardXp: d.rewardXp,
      rewardSprouts: d.rewardSprouts,
      unlockAbility: 'slide',
      rewardGun: 'gun_handgun',
    });
    expect(res.events).toContainEqual({
      type: 'returnToOverworld',
      dungeonId: 'L01',
      regionId: 'sproutvale',
    });
  });

  it('handles switches, geysers, and hazards cleanly', () => {
    // Test switch on L01
    const l01 = getDungeon('L01');
    const sw = l01.mechanisms.find((m) => m.kind === 'switch')!;
    let s1 = createDungeonSession('L01');
    const swRes = stepDungeon(s1, sw.pos, false, 0, true);
    s1 = swRes.state;
    expect(s1.activatedSwitches).toContain(sw.id);
    expect(swRes.events.some((e) => e.type === 'switchActivated' && e.switchId === sw.id)).toBe(
      true,
    );

    // Test geyser & hazard on L10
    const l10 = getDungeon('L10');
    const geyser = l10.mechanisms.find((m) => m.kind === 'geyser')!;
    const hazard = l10.mechanisms.find((m) => m.kind === 'hazard')!;
    let s10 = createDungeonSession('L10');

    const gRes = stepDungeon(s10, geyser.pos, false, 0, false);
    s10 = gRes.state;
    expect(gRes.events.some((e) => e.type === 'geyserBoost' && e.mechanismId === geyser.id)).toBe(
      true,
    );

    const hRes = stepDungeon(s10, hazard.pos, false, 0, false);
    expect(hRes.events.some((e) => e.type === 'hazardDamage' && e.mechanismId === hazard.id)).toBe(
      true,
    );
  });
});

describe('DungeonView (Three.js visual builder)', () => {
  it('builds meshes, applies and restores lighting, toggles doors, and disposes cleanly', () => {
    const d = getDungeon('L03');
    const scene = new THREE.Scene();
    const origBg = new THREE.Color(0x112233);
    scene.background = origBg;
    const sun = new THREE.DirectionalLight(0xffffff, 2);
    const hemi = new THREE.HemisphereLight(0xaabbcc, 0x223344, 1);

    const view = new DungeonView(d);
    scene.add(view.root);
    expect(view.root.children.length).toBeGreaterThan(d.solids.length);

    view.applyLighting(scene, sun, hemi);
    expect((scene.background as THREE.Color).getHex()).toBe(d.skyColor);
    expect((scene.fog as THREE.Fog).color.getHex()).toBe(d.fogColor);
    expect(sun.color.getHex()).toBe(d.sunColor);

    view.setDoorSealed('L03-door-1', true);
    view.setCheckpointActivated('L03-CP1', true);
    view.setExitUnlocked(true);

    view.dispose();
    expect(scene.children).not.toContain(view.root);
    expect(scene.background).toBe(origBg);
    expect(sun.color.getHex()).toBe(0xffffff);
  });
});
