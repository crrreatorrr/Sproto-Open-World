import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CameraRig } from '../../src/camera/CameraRig';
import type { ReadonlySimView } from '../../src/sim/view';

describe('the aim ray is the centre of the screen', () => {
  it('matches where the camera really is and looks, at any angle', () => {
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500);
    const rig = new CameraRig(camera);
    const view = { sphereCast: () => null } as unknown as ReadonlySimView;
    const feet = new THREE.Vector3(12, 3, -7);
    rig.snap(feet, 0.4);
    for (const [yaw, pitch] of [[0.4, -0.12], [2.2, 0.5], [-1.3, -0.6]]) {
      rig.yaw = yaw;
      rig.pitch = pitch;
      rig.update(1 / 60, feet, view, false);
      const ray = rig.aimRay()!;
      camera.updateMatrixWorld();
      const dir = camera.getWorldDirection(new THREE.Vector3());
      expect(ray.from.x).toBeCloseTo(camera.position.x, 3);
      expect(ray.from.y).toBeCloseTo(camera.position.y, 3);
      expect(ray.from.z).toBeCloseTo(camera.position.z, 3);
      expect(dir.dot(new THREE.Vector3(ray.dir.x, ray.dir.y, ray.dir.z))).toBeGreaterThan(0.99999);
    }
  });

  it('keeps the character centred: no shoulder offset', () => {
    const camera = new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500);
    const rig = new CameraRig(camera);
    const feet = new THREE.Vector3(0, 0, 0);
    rig.snap(feet, 0);
    rig.update(1 / 60, feet, { sphereCast: () => null } as unknown as ReadonlySimView, false);
    expect(camera.position.x).toBeCloseTo(0, 5);
  });
});
