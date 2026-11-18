import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAM, CameraRig, type CameraSolid } from '../../src/camera/CameraRig';
import { ENEMIES } from '../../src/content/enemies';
import { ENEMY_SIZES } from '../../src/content/enemyScale';
import { PLAYER_BODY } from '../../src/content/tuning';
import type { ReadonlySimView } from '../../src/sim/view';

/** The lock-on camera on flat ground, next to each scaled enemy, close up and further off. */
const FLOOR = 0;

/** Only the ground blocks a sphere cast, as in the game: the world's colliders hold no characters. */
const flatGround = {
  sphereCast(o: { x: number; y: number; z: number }, d: { x: number; y: number; z: number }, r: number) {
    if (d.y >= 0) return null;
    const len = Math.hypot(d.x, d.y, d.z);
    const t = (o.y - r - FLOOR) / (-d.y / len);
    return t >= 0 && t <= len ? { distance: t } : null;
  },
} as unknown as ReadonlySimView;

interface Shot {
  ndcHead: THREE.Vector3;
  ndcFeet: THREE.Vector3;
  ndcPlayer: THREE.Vector3;
  cam: THREE.Vector3;
}

/** Settle the locked-on camera with the player `gap` m from the enemy's skin, and see what it sees. */
function shoot(id: string, gap: number): Shot {
  const def = ENEMIES[id];
  const cam = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500);
  const rig = new CameraRig(cam);
  const dist = def.body.radius + PLAYER_BODY.radius + gap;
  const player = new THREE.Vector3(0, FLOOR, 0);
  const enemy = new THREE.Vector3(0, FLOOR, dist);
  const solid: CameraSolid = { x: enemy.x, y: enemy.y, z: enemy.z, radius: def.body.radius, height: def.body.height };
  const chest = enemy.clone().setY(enemy.y + (def.lockPoint?.up ?? def.body.height * 0.6));
  rig.distanceScale = def.cameraScale ?? 1;
  rig.solid = solid;
  rig.snap(player, 0);
  for (let i = 0; i < 300; i++) rig.update(1 / 60, player, flatGround, false, chest);
  cam.updateMatrixWorld(true);
  const project = (v: THREE.Vector3) => v.clone().project(cam);
  return {
    ndcHead: project(enemy.clone().setY(enemy.y + def.body.height)),
    ndcFeet: project(enemy.clone()),
    ndcPlayer: project(player.clone().setY(player.y + PLAYER_BODY.height * 0.5)),
    cam: cam.position.clone(),
  };
}

const GAPS = [0.05, 0.5, 1.5, 3, 6, 10];
const GROUNDED = Object.keys(ENEMY_SIZES).filter((id) => id !== 'skyfire_drake');

describe('lock-on framing', () => {
  for (const id of GROUNDED) {
    it(`${id}: its chest and the player stay in the picture, and the camera stays out of its body`, () => {
      const def = ENEMIES[id];
      for (const gap of GAPS) {
        const s = shoot(id, gap);
        const where = `${gap} m from its skin`;
        // The lock's point of interest is on screen, and not jammed against the edge.
        const up = def.lockPoint?.up ?? def.body.height * 0.6;
        const chest = THREE.MathUtils.lerp(s.ndcFeet.y, s.ndcHead.y, up / def.body.height);
        expect(Math.abs(chest), `${id} chest ${where}`).toBeLessThan(0.95);
        // The whole body is in frame with room to spare, head to feet, however close the player stands.
        expect(s.ndcHead.y, `${id} head ${where}`).toBeLessThan(0.6);
        expect(s.ndcFeet.y, `${id} feet ${where}`).toBeGreaterThan(-0.85);
        // The player is never lost.
        expect(Math.abs(s.ndcPlayer.y), `${id} player ${where}`).toBeLessThan(1);
        expect(Math.abs(s.ndcPlayer.x), `${id} player ${where}`).toBeLessThan(1);
        // The camera is outside the capsule, on the player's side of it.
        const off = Math.hypot(s.cam.x, s.cam.z - (def.body.radius + PLAYER_BODY.radius + gap));
        expect(off, `${id} camera ${where}`).toBeGreaterThan(def.body.radius);
        expect(s.cam.z, `${id} camera ${where}`).toBeLessThan(def.body.radius + PLAYER_BODY.radius + gap);
      }
    });
  }

  it('the camera stays out of a boss that backs up behind the player, without a lock', () => {
    const def = ENEMIES.scrapjaw;
    const cam = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500);
    const rig = new CameraRig(cam);
    const player = new THREE.Vector3(0, FLOOR, 0);
    // The boss stands right behind the player, where the camera wants to be.
    const solid: CameraSolid = { x: 0, y: FLOOR, z: -(def.body.radius + PLAYER_BODY.radius + 0.2), radius: def.body.radius, height: def.body.height };
    rig.solid = solid;
    rig.distanceScale = def.cameraScale ?? 1;
    rig.snap(player, 0);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, player, flatGround, false, null);
    // Short of its body, on the player's side: not inside it, and not out beyond it with the boss in the way.
    expect(cam.position.z).toBeGreaterThan(solid.z + def.body.radius);
  });

  it('an ordinary enemy changes nothing: the lock camera is the same with or without it as a solid', () => {
    const run = (solid: CameraSolid | null) => {
      const cam = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500);
      const rig = new CameraRig(cam);
      const player = new THREE.Vector3(0, FLOOR, 0);
      rig.solid = solid;
      rig.snap(player, 0);
      for (let i = 0; i < 200; i++) rig.update(1 / 60, player, flatGround, false, new THREE.Vector3(0, 0.8, 1.2));
      return cam.position.clone();
    };
    const grunt = ENEMIES.grunt.body;
    const near = run({ x: 0, y: FLOOR, z: 1.2, radius: grunt.radius, height: grunt.height });
    expect(near.distanceTo(run(null))).toBeLessThan(1e-6);
  });

  it('with no big body nearby the camera behaves exactly as before', () => {
    const a = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500);
    const rig = new CameraRig(a);
    const player = new THREE.Vector3(3, FLOOR, 4);
    rig.snap(player, 0.4);
    for (let i = 0; i < 120; i++) rig.update(1 / 60, player, flatGround, false, null);
    expect(rig.distance).toBeCloseTo(CAM.distance, 3);
  });
});
