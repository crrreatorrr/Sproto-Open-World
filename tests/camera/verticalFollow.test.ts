import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAM, CameraRig } from '../../src/camera/CameraRig';
import type { ReadonlySimView } from '../../src/sim/view';

const open = { sphereCast: () => null } as unknown as ReadonlySimView;
const DT = 1 / 60;

/** Walk the rig along z with the feet at `heightAt(frame)`; returns the camera's height per frame. */
function walk(heightAt: (i: number) => number, frames: number): { cam: number[]; feet: number[] } {
  const rig = new CameraRig(new THREE.PerspectiveCamera(62, 16 / 9, 0.1, 500));
  const feet = new THREE.Vector3(0, heightAt(0), 0);
  rig.snap(feet, 0);
  const cam: number[] = [], ys: number[] = [];
  for (let i = 0; i < frames; i++) {
    feet.set(0, heightAt(i), i * 5 * DT);
    rig.update(DT, feet, open, false);
    cam.push(rig.camera.position.y);
    ys.push(feet.y);
  }
  return { cam, feet: ys };
}

/** The largest frame-to-frame change of velocity (m per frame²) over the last `tail` frames. */
function roughness(y: number[], tail: number): number {
  let worst = 0;
  for (let i = y.length - tail; i < y.length; i++) worst = Math.max(worst, Math.abs(y[i] - 2 * y[i - 1] + y[i - 2]));
  return worst;
}

describe('the camera follows the ground without passing its bumps on', () => {
  // Uneven ground under the feet: a steady slope with 5 mm of noise, a new value every frame.
  const bumpy = (slope: number) => (i: number) => 10 + slope * i * 5 * DT + (i % 2 ? 0.005 : -0.005);

  it('smooths foot-height noise going downhill', () => {
    const { cam, feet } = walk(bumpy(-0.2), 240);
    expect(roughness(cam, 120)).toBeLessThan(roughness(feet, 120) * 0.2);
  });

  it('smooths foot-height noise going uphill', () => {
    const { cam, feet } = walk(bumpy(0.2), 240);
    expect(roughness(cam, 120)).toBeLessThan(roughness(feet, 120) * 0.2);
  });

  it('stays close on a steady slope, up or down', () => {
    for (const slope of [-0.3, 0.3]) {
      const { cam, feet } = walk((i) => 10 + slope * i * 5 * DT, 240);
      const settled = cam[0] - feet[0];
      expect(Math.abs(cam[239] - feet[239] - settled), `slope ${slope}`).toBeLessThan(0.35);
    }
  });

  it('never trails a long fall by more than the lead it is allowed', () => {
    // 20 m/s straight down for a second.
    const { cam, feet } = walk((i) => 100 - 20 * i * DT, 60);
    const settled = cam[0] - feet[0];
    expect(cam[59] - feet[59] - settled).toBeLessThan(CAM.dropMaxLead + 0.02);
    expect(cam[59] - feet[59] - settled).toBeGreaterThan(0);
  });
});
