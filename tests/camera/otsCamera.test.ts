import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAM, CameraRig, type CameraOccluder } from '../../src/camera/CameraRig';
import { PLAYER_BODY } from '../../src/content/tuning';
import type { ReadonlySimView } from '../../src/sim/view';

const open = { sphereCast: () => null } as unknown as ReadonlySimView;

function makeRig() {
  const cam = new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500);
  const rig = new CameraRig(cam);
  const feet = new THREE.Vector3(0, 0, 0);
  rig.snap(feet, 0);
  return { cam, rig, feet };
}

function step(rig: CameraRig, feet: THREE.Vector3, frames: number, sprinting = false) {
  for (let i = 0; i < frames; i++) rig.update(1 / 60, feet, open, sprinting);
}

describe('CameraRig OTS / ADS / scope / FPS modes', () => {
  it('defaults to orbit mode with distance 4.6, shoulder 0, fov 62', () => {
    const { cam, rig, feet } = makeRig();
    expect(rig.mode).toBe('orbit');
    step(rig, feet, 60);
    expect(rig.distance).toBeCloseTo(CAM.distance, 2);
    expect(rig.shoulderOffset).toBeCloseTo(0, 2);
    expect(cam.fov).toBeCloseTo(CAM.fov, 1);
  });

  it('smoothly damps into OTS hip-fire (distance 3.4, shoulder 0.55, fov 62)', () => {
    const { cam, rig, feet } = makeRig();
    rig.setCameraMode('ots');
    expect(rig.mode).toBe('ots');

    // After 1 frame it should be mid-transition, not snapped.
    step(rig, feet, 1);
    expect(rig.distance).toBeLessThan(CAM.distance);
    expect(rig.distance).toBeGreaterThan(CAM.otsDistance);
    expect(rig.shoulderOffset).toBeGreaterThan(0);
    expect(rig.shoulderOffset).toBeLessThan(CAM.otsShoulder);

    // After settling, it reaches the OTS target.
    step(rig, feet, 120);
    expect(rig.distance).toBeCloseTo(CAM.otsDistance, 2);
    expect(rig.shoulderOffset).toBeCloseTo(CAM.otsShoulder, 2);
    expect(cam.fov).toBeCloseTo(CAM.otsFov, 1);
  });

  it('smoothly damps into ADS (distance 1.9, shoulder 0.65, default fov 46 or custom zoomFov)', () => {
    const { cam, rig, feet } = makeRig();
    rig.setCameraMode('ads');
    step(rig, feet, 120);
    expect(rig.distance).toBeCloseTo(CAM.adsDistance, 2);
    expect(rig.shoulderOffset).toBeCloseTo(CAM.adsShoulder, 2);
    expect(cam.fov).toBeCloseTo(CAM.adsFov, 1);

    rig.setCameraMode('ads', 38);
    step(rig, feet, 120);
    expect(cam.fov).toBeCloseTo(38, 1);
  });

  it('supports scope1 and scope2 at eye height with distance 0 and shoulder 0', () => {
    const { cam, rig, feet } = makeRig();
    rig.pitch = 0;
    rig.setCameraMode('scope1');
    step(rig, feet, 120);
    expect(rig.distance).toBeCloseTo(0, 2);
    expect(rig.shoulderOffset).toBeCloseTo(0, 2);
    expect(cam.position.y).toBeCloseTo(CAM.fpsHeight, 2);
    expect(cam.fov).toBeCloseTo(CAM.scope1Fov, 1);

    rig.setCameraMode('scope2', 30);
    step(rig, feet, 120);
    expect(rig.distance).toBeCloseTo(0, 2);
    expect(cam.fov).toBeCloseTo(10, 1);
  });

  it('supports eye-level FPS (standing 1.6 m / sliding 0.72 m, fov 68) and toggleFirstPerson()', () => {
    const { cam, rig, feet } = makeRig();
    rig.pitch = 0;
    rig.setCameraMode('ots');
    step(rig, feet, 60);

    expect(rig.toggleFirstPerson()).toBe('fps');
    expect(rig.isFirstPerson).toBe(true);
    step(rig, feet, 120);
    expect(rig.distance).toBeCloseTo(0, 2);
    expect(rig.shoulderOffset).toBeCloseTo(0, 2);
    expect(cam.position.y).toBeCloseTo(CAM.fpsHeight, 2);
    expect(cam.fov).toBeCloseTo(CAM.fpsFov, 1);

    rig.sliding = true;
    step(rig, feet, 120);
    expect(cam.position.y).toBeCloseTo(CAM.fpsSlideHeight, 2);

    rig.sliding = false;
    expect(rig.toggleFirstPerson()).toBe('ots');
    step(rig, feet, 120);
    expect(rig.distance).toBeCloseTo(CAM.otsDistance, 2);
    expect(rig.shoulderOffset).toBeCloseTo(CAM.otsShoulder, 2);
  });

  it('keeps clear-centre occluders intact in orbit and skips them in FPS', () => {
    const { cam, rig, feet } = makeRig();
    const me: CameraOccluder = {
      x: 0,
      z: 0,
      yaw: 0,
      halfWidth: PLAYER_BODY.radius,
      halfLength: PLAYER_BODY.radius,
      top: CAM.footTop,
    };
    rig.occluders = [me];
    rig.pitch = -0.12;
    step(rig, feet, 120);
    const ray = rig.aimRay()!;
    // In orbit, clear-centre keeps the ray well above footTop (1.95 m).
    expect(ray.from.y).toBeGreaterThan(CAM.footTop + CAM.clearMargin);

    // Switching to FPS puts the camera at eye height (1.6 m), not pushed above footTop.
    rig.setCameraMode('fps');
    rig.pitch = 0;
    step(rig, feet, 120);
    expect(cam.position.y).toBeCloseTo(CAM.fpsHeight, 2);
  });
});
