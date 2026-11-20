import { describe, expect, it } from 'vitest';
import { AIM_ASSIST, aimAssist, assistTargetsFromView, lookAngles, type AimAssistTarget } from '../../src/input/aimAssist';
import type { Entity } from '../../src/sim/entity';
import type { ReadonlySimView } from '../../src/sim/view';

const EYE = { x: 0, y: 1.6, z: 0 };

function enemyAt(x: number, y: number, z: number, r = 0.6): AimAssistTarget {
  return {
    center: { x, y: y + 0.9, z },
    head: { x, y: y + 1.55, z },
    r,
  };
}

describe('controller-only aim assist', () => {
  it('returns zero adjustment when input device is KB/M', () => {
    const target = enemyAt(0.2, 0, 12);
    const res = aimAssist({
      eye: EYE,
      yaw: 0,
      pitch: 0,
      targets: [target],
      aiming: true,
      input: 1,
      dt: 1 / 60,
      device: 'kbm',
      aimAssistStrength: 1,
    });
    expect(res).toEqual({ slow: 1, dYaw: 0, dPitch: 0, target: -1 });
  });

  it('returns zero adjustment when aimAssistStrength is 0', () => {
    const target = enemyAt(0.2, 0, 12);
    const res = aimAssist({
      eye: EYE,
      yaw: 0,
      pitch: 0,
      targets: [target],
      aiming: true,
      input: 1,
      dt: 1 / 60,
      device: 'gamepad',
      aimAssistStrength: 0,
    });
    expect(res).toEqual({ slow: 1, dYaw: 0, dPitch: 0, target: -1 });
  });

  it('slows right-stick look speed near an enemy in hip-fire without head drift', () => {
    const target = enemyAt(0.3, 0, 12);
    const res = aimAssist({
      eye: EYE,
      yaw: 0,
      pitch: 0,
      targets: [target],
      aiming: false,
      input: 1,
      dt: 1 / 60,
      device: 'gamepad',
      aimAssistStrength: 1,
    });
    expect(res.target).toBe(0);
    expect(res.slow).toBeLessThan(1);
    expect(res.slow).toBeGreaterThanOrEqual(AIM_ASSIST.minSlow);
    expect(res.dYaw).toBe(0);
    expect(res.dPitch).toBe(0);
  });

  it('slows more strongly and gently drifts toward the enemy head while ADS', () => {
    const target = enemyAt(0.4, 0, 12);
    const hip = aimAssist({
      eye: EYE,
      yaw: 0,
      pitch: -0.02,
      targets: [target],
      aiming: false,
      input: 0.8,
      dt: 1 / 60,
      device: 'gamepad',
    });
    const ads = aimAssist({
      eye: EYE,
      yaw: 0,
      pitch: -0.02,
      targets: [target],
      aiming: true,
      input: 0.8,
      dt: 1 / 60,
      device: 'gamepad',
    });

    expect(ads.target).toBe(0);
    expect(ads.slow).toBeLessThan(hip.slow);
    // Enemy is at +x, +z so target yaw > 0; head is at y=1.55 vs eye=1.6 with pitch -0.02 -> dYaw > 0.
    const headAngles = lookAngles(EYE, target.head);
    expect(Math.sign(ads.dYaw)).toBe(Math.sign(headAngles.yaw - 0));
    expect(Math.abs(ads.dYaw)).toBeGreaterThan(0);
    expect(Math.abs(ads.dYaw)).toBeLessThan(Math.abs(headAngles.yaw));
  });

  it('ignores targets outside the assist cone or beyond weapon range', () => {
    const offAxis = enemyAt(20, 0, 10);
    expect(
      aimAssist({
        eye: EYE,
        yaw: 0,
        pitch: 0,
        targets: [offAxis],
        aiming: true,
        input: 1,
        dt: 1 / 60,
        device: 'gamepad',
      }).target,
    ).toBe(-1);

    const farTarget = enemyAt(0, 0, 35);
    expect(
      aimAssist({
        eye: EYE,
        yaw: 0,
        pitch: 0,
        targets: [farTarget],
        aiming: true,
        input: 1,
        dt: 1 / 60,
        device: 'gamepad',
        range: 20,
      }).target,
    ).toBe(-1);
  });

  it('extracts only live enemy and boss targets from ReadonlySimView', () => {
    const entities: Partial<Entity>[] = [
      { id: 1, kind: 'player', tf: { pos: { x: 0, y: 0, z: 0 }, prevPos: { x: 0, y: 0, z: 0 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } } },
      {
        id: 2,
        kind: 'enemy',
        tf: { pos: { x: 0, y: 0, z: 10 }, prevPos: { x: 0, y: 0, z: 10 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
        body: { radius: 0.45, height: 1.8 },
        vitals: { hp: 50, hpMax: 50, stamina: 0, staminaMax: 0, mana: 0, manaMax: 0, staminaDelay: 0 },
      },
      {
        id: 3,
        kind: 'enemy',
        tf: { pos: { x: 2, y: 0, z: 10 }, prevPos: { x: 2, y: 0, z: 10 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
        body: { radius: 0.45, height: 1.8 },
        vitals: { hp: 0, hpMax: 50, stamina: 0, staminaMax: 0, mana: 0, manaMax: 0, staminaDelay: 0 },
      },
      {
        id: 4,
        kind: 'boss',
        tf: { pos: { x: -1, y: 0, z: 15 }, prevPos: { x: -1, y: 0, z: 15 }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } },
        body: { radius: 1.2, height: 4.0 },
        vitals: { hp: 500, hpMax: 500, stamina: 0, staminaMax: 0, mana: 0, manaMax: 0, staminaDelay: 0 },
      },
    ];
    const view = { entities } as unknown as ReadonlySimView;
    const targets = assistTargetsFromView(view);
    expect(targets.map((t) => t.entityId)).toEqual([2, 4]);
    expect(targets[0]!.head.y).toBeGreaterThan(targets[0]!.center.y);
  });
});
