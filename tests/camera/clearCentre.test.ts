import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAM, CameraRig, type CameraOccluder } from '../../src/camera/CameraRig';
import { MOUNT } from '../../src/content/mounts';
import { PLAYER_BODY } from '../../src/content/tuning';
import type { ReadonlySimView } from '../../src/sim/view';

const open = { sphereCast: () => null } as unknown as ReadonlySimView;

/** The lowest the aim ray gets over a box's footprint, less the box's top (m); +∞ when it misses it. */
function clearance(rig: CameraRig, o: CameraOccluder): number {
  const ray = rig.aimRay()!;
  const flat = Math.hypot(ray.dir.x, ray.dir.z);
  let low = Infinity;
  for (let s = 0; s < 40; s += 0.01) {
    const x = ray.from.x + (ray.dir.x / flat) * s, z = ray.from.z + (ray.dir.z / flat) * s;
    const dx = x - o.x, dz = z - o.z;
    const along = dx * Math.sin(o.yaw) + dz * Math.cos(o.yaw);
    const across = dx * Math.cos(o.yaw) - dz * Math.sin(o.yaw);
    if (Math.abs(along) > o.halfLength || Math.abs(across) > o.halfWidth) continue;
    low = Math.min(low, ray.from.y + (ray.dir.y / flat) * s - o.top);
  }
  return low;
}

function settle(rig: CameraRig, feet: THREE.Vector3, yaw: number, pitch: number) {
  rig.yaw = yaw;
  rig.pitch = pitch;
  for (let i = 0; i < 120; i++) rig.update(1 / 60, feet, open, false);
}

const PITCHES = [CAM.minPitch, -0.4, -0.12, 0, 0.3, CAM.maxPitch];

describe('the centre of the screen sees past the player', () => {
  it('passes over the player on foot at every pitch', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500));
    const feet = new THREE.Vector3(4, 2, -3);
    const me: CameraOccluder = { x: feet.x, z: feet.z, yaw: 0, halfWidth: PLAYER_BODY.radius, halfLength: PLAYER_BODY.radius, top: feet.y + CAM.footTop };
    rig.occluders = [me];
    rig.snap(feet, 0.7);
    for (const pitch of PITCHES) {
      settle(rig, feet, 0.7, pitch);
      expect(clearance(rig, me), `pitch ${pitch}`).toBeGreaterThan(CAM.clearMargin - 0.02);
    }
  });

  it('passes over the rider and the whole bull, however the bull is turned', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500));
    rig.distanceScale = CAM.rideDistanceScale;
    const feet = new THREE.Vector3(0, 0.12, 0);
    rig.snap(feet, 0);
    for (const bullYaw of [0, 0.8, Math.PI / 2, 2.6]) {
      const rider: CameraOccluder = { x: 0, z: 0, yaw: 0, halfWidth: PLAYER_BODY.radius, halfLength: PLAYER_BODY.radius, top: feet.y + CAM.riderTop };
      const bull: CameraOccluder = { x: 0, z: 0, yaw: bullYaw, halfWidth: MOUNT.bodyHalfWidth, halfLength: CAM.bullHalfLength, top: feet.y - MOUNT.seatLift + CAM.bullTop };
      rig.occluders = [rider, bull];
      for (const pitch of PITCHES) {
        settle(rig, feet, 0, pitch);
        expect(clearance(rig, rider), `rider, bull yaw ${bullYaw}, pitch ${pitch}`).toBeGreaterThan(CAM.clearMargin - 0.02);
        expect(clearance(rig, bull), `bull yaw ${bullYaw}, pitch ${pitch}`).toBeGreaterThan(CAM.clearMargin - 0.02);
      }
    }
  });

  it('rises no higher than it needs: level with the margin over the crown at the usual angle', () => {
    const rig = new CameraRig(new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500));
    const feet = new THREE.Vector3(0, 0, 0);
    const me: CameraOccluder = { x: 0, z: 0, yaw: 0, halfWidth: PLAYER_BODY.radius, halfLength: PLAYER_BODY.radius, top: CAM.footTop };
    rig.occluders = [me];
    rig.snap(feet, 0);
    settle(rig, feet, 0, -0.12);
    expect(clearance(rig, me)).toBeLessThan(CAM.clearMargin + 0.05);
  });
});
