import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { CAM, CameraRig, type CameraMode, type CameraOccluder } from '../../src/camera/CameraRig';
import { MOUNT } from '../../src/content/mounts';
import { MOVE, PLAYER_BODY } from '../../src/content/tuning';
import type { ReadonlySimView } from '../../src/sim/view';

/**
 * Feedback WORLD-0005: "a lot of issues when running and aiming or running without aiming for the
 * camera, sudden jumps". Every move the rig makes on its own must be smooth: these drive it the way
 * the app does (the player's feet, their body as an occluder, the mode, the lock) and measure, per
 * frame, how far the camera's movement is from that of the frames either side. A pop of centimetres
 * in one frame is a jump the player sees.
 */

const open = { sphereCast: () => null } as unknown as ReadonlySimView;

interface Frame {
  feet: THREE.Vector3;
  rig: CameraRig;
  /** Seconds since the recording began, and the frame's number. */
  t: number;
  i: number;
  dt: number;
}

interface Shot {
  mode?: CameraMode;
  riding?: boolean;
  /** The view's tip (radians) from the start; the usual slight tip down otherwise. */
  pitch?: number;
  seconds: number;
  /** Move the player (and anything else) for this frame. May return the lock point and the view. */
  frame(f: Frame): { lock?: THREE.Vector3 | null; view?: ReadonlySimView; sprinting?: boolean } | void;
  /** Look at the rig once it has moved for this frame. */
  after?(f: Frame): void;
  /** Occluders besides the player on foot. */
  occluders?(feet: THREE.Vector3): CameraOccluder[];
}

interface Result {
  /** The worst pop of the camera's position (m) and of its view direction (degrees), and of the field of view (degrees). */
  pop: number;
  turnPop: number;
  fovPop: number;
  popAt: number;
  /** The camera's height above the feet, per frame. */
  height: number[];
  rig: CameraRig;
}

/** The player's body as the app gives it: round, so a square turned to face the camera. */
function me(feet: THREE.Vector3, yaw: number, top: number = CAM.footTop): CameraOccluder {
  return { x: feet.x, z: feet.z, yaw, halfWidth: PLAYER_BODY.radius, halfLength: PLAYER_BODY.radius, top: feet.y + top };
}

/** Run a shot at `fps` after a second standing still, and measure the camera's pops. */
function film(shot: Shot, fps: number, skip: (t: number) => boolean = () => false): Result {
  const rig = new CameraRig(new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500));
  const feet = new THREE.Vector3(3, 10, -4);
  const dt = 1 / fps;
  if (shot.mode) rig.setCameraMode(shot.mode);
  rig.riding = shot.riding ?? false;
  rig.snap(feet, 0.6);
  if (shot.pitch !== undefined) rig.pitch = shot.pitch;
  rig.occluders = [me(feet, rig.yaw), ...(shot.occluders?.(feet) ?? [])];
  for (let i = 0; i < fps; i++) rig.update(dt, feet, open, false);
  const pos: THREE.Vector3[] = [], dir: THREE.Vector3[] = [], fov: number[] = [], height: number[] = [];
  const frames = Math.round(shot.seconds * fps);
  for (let i = 0; i < frames; i++) {
    const f = { feet, rig, t: i * dt, i, dt };
    const out = shot.frame(f) ?? {};
    rig.occluders = [me(feet, rig.yaw, rig.riding ? CAM.riderTop : CAM.footTop), ...(shot.occluders?.(feet) ?? [])];
    rig.update(dt, feet, out.view ?? open, out.sprinting ?? false, out.lock ?? null);
    shot.after?.(f);
    pos.push(rig.camera.position.clone());
    dir.push(rig.camera.getWorldDirection(new THREE.Vector3()));
    fov.push(rig.camera.fov);
    height.push(rig.camera.position.y - feet.y);
  }
  let pop = 0, turnPop = 0, fovPop = 0, popAt = -1;
  for (let i = 1; i < frames - 1; i++) {
    if (skip(i * dt)) continue;
    const mid = pos[i - 1].clone().add(pos[i + 1]).multiplyScalar(0.5);
    const p = mid.distanceTo(pos[i]);
    if (p > pop) { pop = p; popAt = i; }
    const before = dir[i - 1].angleTo(dir[i]), after = dir[i].angleTo(dir[i + 1]);
    turnPop = Math.max(turnPop, (Math.abs(after - before) * 180) / Math.PI / 2);
    fovPop = Math.max(fovPop, Math.abs(fov[i] - (fov[i - 1] + fov[i + 1]) / 2));
  }
  if (process.env.CAM_DEBUG) console.log(`${expect.getState().currentTestName} @${fps}: pop ${(pop * 100).toFixed(2)} cm (frame ${popAt}), turn ${turnPop.toFixed(3)}°, fov ${fovPop.toFixed(3)}°`);
  return { pop, turnPop, fovPop, popAt, height, rig };
}

/**
 * Run side to side across the view at `speed`, turning round every `every` seconds. The key flips at
 * once; the body pushes off as the sim's does (`MOVE.pivotAccel`).
 */
function sideToSide(speed: number, every: number): Shot['frame'] {
  let v = 0;
  return ({ feet, rig, t, dt }) => {
    const want = (Math.floor(t / every) % 2 ? -1 : 1) * speed;
    v += Math.min(MOVE.pivotAccel * dt, Math.max(-MOVE.pivotAccel * dt, want - v));
    feet.x += -Math.cos(rig.yaw) * v * dt;
    feet.z += Math.sin(rig.yaw) * v * dt;
  };
}

/** A view with one round post standing at (cx, cz): the sphere cast against an upright cylinder. */
function post(cx: number, cz: number, radius: number): ReadonlySimView {
  return {
    sphereCast: (o: { x: number; z: number }, d: { x: number; y: number; z: number }, r: number) => {
      const len = Math.hypot(d.x, d.y, d.z);
      const ux = d.x / len, uz = d.z / len;
      const ox = o.x - cx, oz = o.z - cz;
      const c = ox * ox + oz * oz - (radius + r) ** 2;
      if (c <= 0) return { distance: 0 };
      const a = ux * ux + uz * uz, b = ox * ux + oz * uz;
      if (a < 1e-9 || b >= 0 || b * b - a * c <= 0) return null;
      const t = (-b - Math.sqrt(b * b - a * c)) / a;
      return t <= len ? { distance: t } : null;
    },
  } as unknown as ReadonlySimView;
}

const RATES = [60, 120, 240];
/**
 * The most the camera may pop in a frame at 60 Hz (m). The limit scales with the frame's length
 * squared, as smooth movement does: a step in place or in speed does not shrink that fast with the
 * frame, so it fails at the higher rates even where it would pass at 60 Hz.
 */
const POP = 0.012;
const limit = (fps: number, at60 = POP) => at60 * (60 / fps) ** 2;
/** The same for the field of view (degrees), which the rig only changes in steps of 0.01°. */
const fovLimit = (fps: number, at60: number) => Math.max(0.02, limit(fps, at60));

describe('the camera never jumps', () => {
  for (const mode of ['ots', 'ads'] as const) {
    for (const speed of [MOVE.runSpeed, MOVE.sprintSpeed]) {
      it(`${mode}, running side to side at ${speed} m/s: no pop, and the camera keeps its height`, () => {
        for (const fps of RATES) {
          const shot = film({ mode, seconds: 4, frame: sideToSide(speed, 0.6) }, fps);
          expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps));
          // A gun's cameras stand beside the player: whichever way they run the camera all but keeps
          // its height (it stepped 39 cm). The few cm are the slight tip down of the view: running
          // toward the shoulder side carries the body under the centre ray, which must not meet it.
          expect(Math.max(...shot.height) - Math.min(...shot.height), `${fps} Hz`).toBeLessThan(0.06);
        }
      });
    }
  }

  it('orbit, sprinting side to side: no pop, and the camera keeps its height over the player', () => {
    for (const fps of RATES) {
      const shot = film({ seconds: 4, frame: sideToSide(MOVE.sprintSpeed, 0.6) }, fps);
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps));
      expect(Math.max(...shot.height) - Math.min(...shot.height), `${fps} Hz`).toBeLessThan(0.01);
    }
  });

  it('running in a circle while the view turns and tips', () => {
    for (const mode of ['orbit', 'ots', 'ads'] as const) {
      for (const fps of RATES) {
        const shot = film({
          mode, seconds: 5,
          frame: ({ feet, rig, t, dt }) => {
            feet.x += Math.sin(t * 2.4) * MOVE.runSpeed * dt;
            feet.z += Math.cos(t * 2.4) * MOVE.runSpeed * dt;
            // A steady hand on the stick: the turn itself is smooth.
            rig.yaw = 0.6 + Math.sin(t * 0.9) * 1.2;
            rig.pitch = -0.1 + Math.sin(t * 1.3) * 0.5;
          },
        }, fps);
        expect(shot.pop, `${mode}, ${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps));
        expect(shot.turnPop, `${mode}, ${fps} Hz`).toBeLessThan(0.05);
      }
    }
  });

  it('zooming in and out while running sideways', () => {
    for (const fps of RATES) {
      const run = sideToSide(MOVE.runSpeed, 0.7);
      const shot = film({
        mode: 'ots', seconds: 5,
        frame: (f) => {
          f.rig.setCameraMode(Math.floor(f.t / 0.5) % 2 ? 'ads' : 'ots');
          run(f);
        },
      }, fps);
      // The zoom covers 1.5 m in a quarter of a second: it gathers speed, but over frames.
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.065));
      expect(shot.fovPop, `${fps} Hz`).toBeLessThan(fovLimit(fps, 0.75));
    }
  });

  it('drawing and putting away a gun: orbit to the shoulder and back', () => {
    for (const fps of RATES) {
      const run = sideToSide(MOVE.runSpeed, 0.7);
      const shot = film({
        seconds: 6,
        frame: (f) => {
          f.rig.setCameraMode(Math.floor(f.t / 1.5) % 2 ? 'orbit' : 'ots');
          run(f);
        },
      }, fps);
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.06));
    }
  });

  it('looking down a scope and back', () => {
    for (const fps of RATES) {
      const shot = film({
        mode: 'ots', seconds: 4,
        frame: ({ rig, t }) => rig.setCameraMode(t > 1 && t < 2.5 ? 'scope1' : 'ots'),
      }, fps);
      // 3.4 m to the eye in a quarter of a second.
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.15));
    }
  });

  it('a jump and its landing, a drop off a ledge and a step up', () => {
    for (const mode of ['orbit', 'ots'] as const) {
      for (const fps of RATES) {
        let vy = 0;
        const shot = film({
          mode, seconds: 5,
          frame: ({ feet, i, dt }) => {
            feet.z += MOVE.runSpeed * dt;
            if (i === Math.round(0.5 / dt)) vy = 7.5;
            if (vy !== 0 || feet.y > 10) {
              vy -= 22 * dt;
              feet.y += vy * dt;
              if (feet.y <= 10) { feet.y = 10; vy = 0; }
            }
            // A 0.3 m kerb, down and up again, each in one frame (the character controller's step).
            if (i === Math.round(3 / dt)) feet.y -= 0.3;
            if (i === Math.round(4 / dt)) feet.y += 0.3;
          },
        }, fps);
        // The player's own height changes at once on landing and on a kerb; the camera's must not.
        expect(shot.pop, `${mode}, ${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.06));
      }
    }
  });

  it('locking on to an enemy off to the side, and letting go', () => {
    for (const fps of RATES) {
      const enemy = new THREE.Vector3(3 + 7, 11.2, -4 + 2);
      const run = sideToSide(MOVE.runSpeed, 0.8);
      const shot = film({
        seconds: 5,
        frame: (f) => {
          run(f);
          return { lock: f.t > 0.5 && f.t < 3 ? enemy : null };
        },
      }, fps);
      // The view swings a quarter turn to face the enemy in under half a second.
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.055));
      expect(shot.turnPop, `${fps} Hz`).toBeLessThan(limit(fps, 0.75));
    }
  });

  it('mounting the bull and getting off', () => {
    for (const fps of RATES) {
      const shot = film({
        seconds: 6,
        frame: ({ rig, t }) => { rig.riding = t > 0.5 && t < 3.5; },
        occluders: (feet) => [{ x: feet.x + 0.4, z: feet.z, yaw: 1.1, halfWidth: MOUNT.bodyHalfWidth, halfLength: CAM.bullHalfLength, top: feet.y + CAM.bullTop }],
      }, fps);
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps));
    }
  });

  it('eases back out after a wall pulled it in (the pull itself is at once, so the wall is never clipped)', () => {
    for (const fps of RATES) {
      const wall = { sphereCast: (_from: unknown, d: { x: number; y: number; z: number }) => (Math.hypot(d.x, d.y, d.z) > 1.5 ? { distance: 1.5 } : null) } as unknown as ReadonlySimView;
      const shot = film({
        seconds: 4,
        frame: ({ t }) => ({ view: t > 0.5 && t < 1.5 ? wall : open }),
        // Only the frames where the wall arrives may step.
      }, fps, (t) => t > 0.45 && t < 0.6);
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.04));
    }
  });

  it('a tree trunk crossing between the camera and the player does not move the camera', () => {
    for (const mode of ['orbit', 'ots', 'ads'] as const) {
      for (const fps of RATES) {
        // 1.4 m behind the player and 2 m to their right: running side to side takes the boom across it.
        const yaw = 0.6;
        const trunk = post(3 - Math.cos(yaw) * 2 - Math.sin(yaw) * 1.4, -4 + Math.sin(yaw) * 2 - Math.cos(yaw) * 1.4, 0.25);
        const run = sideToSide(MOVE.runSpeed, 0.9);
        let nearest = Infinity;
        const shot = film({
          mode, seconds: 5,
          frame: (f) => {
            run(f);
            nearest = Math.min(nearest, f.rig.distance);
            return { view: trunk };
          },
        }, fps);
        expect(shot.pop, `${mode}, ${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps));
        expect(nearest, `${mode}, ${fps} Hz`).toBeGreaterThan(shot.rig.distance - 0.05);
      }
    }
  });

  it('glides in front of something thin that stays in the way', () => {
    for (const fps of RATES) {
      // On the boom, 1.6 m behind the shoulder, from half a second in.
      const yaw = 0.6;
      const trunk = post(3 - Math.cos(yaw) * CAM.otsShoulder - Math.sin(yaw) * 1.6, -4 + Math.sin(yaw) * CAM.otsShoulder - Math.cos(yaw) * 1.6, 0.25);
      const at: number[] = [];
      const shot = film({
        mode: 'ots', seconds: 3,
        frame: ({ rig, t }) => {
          at.push(rig.distance);
          return { view: t > 0.5 ? trunk : open };
        },
      }, fps);
      expect(shot.pop, `${fps} Hz, frame ${shot.popAt}`).toBeLessThan(limit(fps, 0.045));
      // It waits a moment (the trunk may be passing), then ends up in front of it.
      expect(at[Math.round(0.7 * fps)], `${fps} Hz`).toBeCloseTo(CAM.otsDistance, 2);
      expect(shot.rig.distance, `${fps} Hz`).toBeLessThan(1.6 - 0.25 - CAM.collisionRadius + 0.01);
      expect(shot.rig.distance, `${fps} Hz`).toBeGreaterThan(0.8);
    }
  });

  it('a wall still pulls the camera in at once', () => {
    // Everything further than 1.5 m is solid, and so is the place the camera would have had.
    const wall = { sphereCast: (_from: unknown, d: { x: number; y: number; z: number }) => (Math.hypot(d.x, d.y, d.z) > 1.5 ? { distance: 1.5 } : null) } as unknown as ReadonlySimView;
    const rig = new CameraRig(new THREE.PerspectiveCamera(CAM.fov, 16 / 9, 0.1, 500));
    const feet = new THREE.Vector3(0, 0, 0);
    rig.snap(feet, 0);
    rig.update(1 / 60, feet, open, false);
    expect(rig.distance).toBeCloseTo(CAM.distance, 3);
    rig.update(1 / 60, feet, wall, false);
    expect(rig.distance).toBeLessThanOrEqual(1.5 + CAM.inSlack);
    for (let i = 0; i < 30; i++) rig.update(1 / 60, feet, wall, false);
    expect(rig.distance).toBeLessThanOrEqual(1.5);
  });

  it('sprinting widens the view without a step', () => {
    for (const fps of RATES) {
      const shot = film({ seconds: 3, frame: ({ t }) => ({ sprinting: t > 0.5 && t < 1.5 }) }, fps);
      expect(shot.fovPop, `${fps} Hz`).toBeLessThan(fovLimit(fps, 0.15));
    }
  });
});

describe('the centre of the screen stays off the player while the camera eases', () => {
  /** How far the aim ray passes over the player's box at its lowest (m); +∞ when it passes beside it. */
  function clearance(rig: CameraRig, feet: THREE.Vector3): number {
    const ray = rig.aimRay()!;
    const flat = Math.hypot(ray.dir.x, ray.dir.z);
    const fx = ray.dir.x / flat, fz = ray.dir.z / flat;
    let low = Infinity;
    for (let s = 0; s < 12; s += 0.01) {
      const dx = ray.from.x + fx * s - feet.x, dz = ray.from.z + fz * s - feet.z;
      // The player's box faces the camera: across the view and along it.
      if (Math.abs(dx * fz - dz * fx) > PLAYER_BODY.radius || Math.abs(dx * fx + dz * fz) > PLAYER_BODY.radius) continue;
      low = Math.min(low, ray.from.y + (ray.dir.y / flat) * s - (feet.y + CAM.footTop));
    }
    return low;
  }

  it('through a jump, at every pitch', () => {
    for (const mode of ['orbit', 'ots'] as const) {
      for (const pitch of [CAM.minPitch, -0.3, 0, 0.3, CAM.maxPitch]) {
        for (const fps of RATES) {
          let vy = 0, low = Infinity;
          film({
            mode, pitch, seconds: 2.5,
            frame: ({ feet, i, dt }) => {
              feet.z += MOVE.runSpeed * dt;
              if (i === Math.round(0.5 / dt)) vy = Math.sqrt(2 * MOVE.gravity * MOVE.jumpHeight);
              if (vy !== 0 || feet.y > 10) {
                vy -= MOVE.gravity * dt;
                feet.y += vy * dt;
                if (feet.y <= 10) { feet.y = 10; vy = 0; }
              }
            },
            after: ({ rig, feet }) => { low = Math.min(low, clearance(rig, feet)); },
          }, fps);
          expect(low, `${mode}, pitch ${pitch}, ${fps} Hz`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('with a gun, sprinting toward the shoulder side while looking down', () => {
    for (const mode of ['ots', 'ads'] as const) {
      for (const pitch of [CAM.minPitch, -0.4, -0.12]) {
        for (const fps of RATES) {
          let low = Infinity, speed = 0;
          film({
            mode, pitch, seconds: 3,
            frame: ({ feet, rig, dt }) => {
              // Forward and to the right of the view, getting up to speed as the sim does.
              const fx = Math.sin(rig.yaw), fz = Math.cos(rig.yaw);
              speed = Math.min(MOVE.sprintSpeed, speed + MOVE.accel * dt);
              feet.x += (fx - fz) * speed * Math.SQRT1_2 * dt;
              feet.z += (fz + fx) * speed * Math.SQRT1_2 * dt;
            },
            // Once the rise has had the moment it takes to come on.
            after: ({ rig, feet, t }) => { if (t > 0.8) low = Math.min(low, clearance(rig, feet)); },
          }, fps);
          // The lag carries the body under the ray, which then passes just over it: no margin here,
          // so the camera moves no more than it must.
          expect(low, `${mode}, pitch ${pitch}, ${fps} Hz`).toBeGreaterThan(-0.01);
        }
      }
    }
  });
});

describe('the rise over the player', () => {
  it('is all there behind the player and gone by the shoulder cameras', () => {
    const settle = (mode: CameraMode) => {
      const shot = film({ mode, seconds: 2, frame: () => {} }, 60);
      return shot.height[shot.height.length - 1];
    };
    // Level view from behind: the pivot height plus the margin (and a little for the slight tip down).
    expect(settle('orbit')).toBeGreaterThan(CAM.height + CAM.clearMargin);
    // Over the shoulder the centre passes beside the body: the camera sits at the pivot's own height.
    const tip = Math.sin(0.12);
    expect(settle('ots')).toBeCloseTo(CAM.height + tip * CAM.otsDistance, 2);
    expect(settle('ads')).toBeCloseTo(CAM.height + tip * CAM.adsDistance, 2);
    expect(CAM.clearFeather).toBeLessThanOrEqual(CAM.otsShoulder - PLAYER_BODY.radius + 1e-9);
  });
});
