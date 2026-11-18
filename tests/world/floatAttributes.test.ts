import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { floatAttributes } from '../../src/world/PropInstancer';

describe('floatAttributes (quantized props)', () => {
  it('keeps a 10 m tall quantized mesh 10 m tall after baking its node scale (no clamp to ±1)', () => {
    // KHR_mesh_quantization: positions as normalized Int16 in [-1, 1], scale 5 on the node.
    const q = new Int16Array([0, -32767, 0, 0, 32767, 0, 32767, 0, 0]);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(q, 3, true));
    const baked = floatAttributes(g.clone()).applyMatrix4(new THREE.Matrix4().makeScale(5, 5, 5));
    baked.computeBoundingBox();
    const size = baked.boundingBox!.getSize(new THREE.Vector3());
    expect(size.y).toBeCloseTo(10, 2);
    expect(size.x).toBeCloseTo(5, 2);
    // The naive path (bake straight into the normalized attribute) is what crushed the trees.
    const naive = g.clone().applyMatrix4(new THREE.Matrix4().makeScale(5, 5, 5));
    naive.computeBoundingBox();
    expect(naive.boundingBox!.getSize(new THREE.Vector3()).y).toBeLessThanOrEqual(2.0001);
  });

  it('leaves plain float attributes alone', () => {
    const g = new THREE.BufferGeometry();
    const a = new THREE.BufferAttribute(new Float32Array([0, 0, 0, 1, 2, 3]), 3);
    g.setAttribute('position', a);
    expect(floatAttributes(g).getAttribute('position')).toBe(a);
  });
});
