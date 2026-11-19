import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { AssetLoader } from '../../src/assets/AssetLoader';
import type { Entity } from '../../src/sim/entity';
import { MountView, mountClipRate, mountGait, slopePitch, turnLean } from '../../src/render/views/MountView';

describe('the bull picks its gait from its speed', () => {
  it('stands, walks, runs and gallops as it speeds up', () => {
    expect(mountGait(0, 'idle')).toBe('idle');
    expect(mountGait(2.6, 'idle')).toBe('walk');
    expect(mountGait(9.5, 'walk')).toBe('run');
    expect(mountGait(17, 'run')).toBe('gallop');
  });

  it('holds a gait across the line, so a steady speed cannot flicker', () => {
    expect(mountGait(12, 'run')).toBe('run');
    expect(mountGait(12, 'gallop')).toBe('gallop');
    expect(mountGait(5, 'walk')).toBe('walk');
    expect(mountGait(5, 'run')).toBe('run');
  });

  it('drops straight to the right gait when it slows hard', () => {
    expect(mountGait(0, 'gallop')).toBe('idle');
    expect(mountGait(3, 'gallop')).toBe('walk');
  });

  it('plays each clip at the rate that keeps planted hooves still', () => {
    expect(mountClipRate('walk', 2.6)).toBeCloseTo(1);
    expect(mountClipRate('run', 9.5)).toBeCloseTo(1);
    expect(mountClipRate('gallop', 17)).toBeCloseTo(1);
    expect(mountClipRate('gallop', 12)).toBeCloseTo(12 / 17);
  });
});

describe('the bull\'s body follows the ground and the turn', () => {
  it('raises its nose on a climb and lowers it going down, within limits', () => {
    expect(slopePitch(0, 5)).toBe(0);
    expect(slopePitch(1, 1)).toBeCloseTo(0.6);
    expect(slopePitch(0.2, 1)).toBeCloseTo(Math.atan(0.2));
    expect(slopePitch(-0.2, 1)).toBeCloseTo(-Math.atan(0.2));
    expect(slopePitch(10, 1)).toBeLessThanOrEqual(0.6);
  });

  it('leans into a turn, harder the faster it goes, and stands level on a straight', () => {
    expect(turnLean(17, 0)).toBeCloseTo(0);
    expect(turnLean(10, 1)).toBeLessThan(0);
    expect(turnLean(10, -1)).toBeGreaterThan(0);
    expect(Math.abs(turnLean(10, 1))).toBeGreaterThan(Math.abs(turnLean(5, 1)));
    expect(Math.abs(turnLean(17, 8))).toBeLessThanOrEqual(0.2);
  });
});

describe('the bull\'s view on a hill', () => {
  const view = () => new MountView({ instance: () => new Promise(() => {}) } as unknown as AssetLoader);
  const at = (x: number, y: number, z: number) => ({ tf: { pos: { x, y, z }, prevPos: { x, y, z }, yaw: 0, prevYaw: 0, vel: { x: 0, y: 0, z: 0 } }, mount: { rider: null, home: { x, y, z }, homeYaw: 0, speed: 5 } }) as unknown as Entity;

  it('pitches climbing, keeps it standing still, and drops it when sent somewhere else', () => {
    const v = view();
    for (let i = 0; i < 60; i++) v.update(at(0, i * 0.05, i * 0.1), 1, 1 / 60);
    const climbing = v.tilt.pitch;
    expect(climbing).toBeGreaterThan(0.3);
    for (let i = 0; i < 30; i++) v.update(at(0, 59 * 0.05, 59 * 0.1), 1, 1 / 60);
    expect(v.tilt.pitch).toBeCloseTo(climbing, 1);
    for (let i = 0; i < 3; i++) v.update(at(200, 0, 200), 1, 1 / 60);
    expect(v.tilt.pitch).toBe(0);
    v.dispose();
  });

  it('a gallop on a slow frame is not mistaken for being sent somewhere else', () => {
    const v = view();
    for (let i = 0; i < 12; i++) v.update(at(0, i * 2, i * 4), 1, 0.25);
    expect(v.tilt.pitch).toBeGreaterThan(0.3);
    v.dispose();
  });

  it('the saddle\'s height leaves out the body\'s tilt, so the rider isn\'t moved by it twice', () => {
    const v = view();
    const spine = new THREE.Object3D();
    spine.position.set(0, 1.2, 0.5);
    v.root.add(spine);
    const inner = v as unknown as { spine: THREE.Object3D; spineHeight(): number };
    inner.spine = spine;
    v.root.rotation.order = 'YXZ';
    v.root.rotation.x = -0.5;
    v.root.rotation.z = 0.2;
    expect(inner.spineHeight()).toBeCloseTo(1.2);
    expect(v.root.rotation.x).toBeCloseTo(-0.5);
    expect(v.root.rotation.z).toBeCloseTo(0.2);
    v.dispose();
  });
});
