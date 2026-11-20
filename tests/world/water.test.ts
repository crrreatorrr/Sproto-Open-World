import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { WaterBody } from '../../src/content/world/format';
import { WaterLayer, patchFlowingWater, patchVertexColorGlow } from '../../src/world/Water';

/**
 * The world's water (src/world/Water.ts): rivers become ribbons cut into ~64 m pieces that follow
 * the surface height, a steep drop turns pale (a falling sheet), pools are discs at their level.
 */
const river: WaterBody = {
  id: 'r',
  kind: 'river',
  // 200 m of river at 10 m, then a 20 m fall over 4 m, then 40 m more at -10 m.
  points: [[0, 0, 10], [100, 0, 10], [200, 0, 10], [204, 0, -10], [244, 0, -10]],
  halfWidth: 6,
  flow: 1.2,
};
const pool: WaterBody = { id: 'p', kind: 'pool', center: [50, 50], radius: 12, y: 3 };

describe('WaterLayer', () => {
  const layer = new WaterLayer([river, pool]);
  const meshes = layer.root.children as THREE.Mesh[];

  it('cuts a river into pieces and draws a pool as one disc', () => {
    const pieces = meshes.filter((m) => m.name.startsWith('r_'));
    expect(pieces.length).toBeGreaterThanOrEqual(4);
    expect(meshes.filter((m) => m.name === 'p')).toHaveLength(1);
  });

  it('keeps the ribbon on the surface height and as wide as the river', () => {
    const first = meshes.find((m) => m.name === 'r_0')!;
    first.geometry.computeBoundingBox();
    const b = first.geometry.boundingBox!;
    expect(b.min.y).toBeCloseTo(10.02, 1);
    expect(b.max.z - b.min.z).toBeCloseTo(12, 0);
  });

  it('turns pale where the surface falls steeply', () => {
    const brightness = (m: THREE.Mesh) => {
      const c = m.geometry.getAttribute('color');
      let sum = 0;
      for (let i = 0; i < c.count; i++) sum += c.getX(i) + c.getY(i) + c.getZ(i);
      return sum / c.count;
    };
    const calm = meshes.find((m) => m.name === 'r_0')!;
    const fall = meshes.find((m) => {
      const p = m.geometry.getAttribute('position');
      for (let i = 0; i < p.count; i++) if (p.getX(i) > 200 && p.getX(i) < 204) return m.name.startsWith('r_');
      return false;
    })!;
    expect(brightness(fall)).toBeGreaterThan(brightness(calm));
  });

  it('sits a pool flat at its level', () => {
    const disc = meshes.find((m) => m.name === 'p')!;
    disc.geometry.computeBoundingBox();
    expect(disc.geometry.boundingBox!.max.y - disc.geometry.boundingBox!.min.y).toBeLessThan(0.001);
  });

  it('patches a kit water material once and keeps it transparent', () => {
    const m = new THREE.MeshStandardMaterial();
    patchFlowingWater(m);
    const hook = m.onBeforeCompile;
    patchFlowingWater(m);
    expect(m.onBeforeCompile).toBe(hook);
    expect(m.transparent).toBe(true);
  });

  it('tints a kit glow material by its vertex colours, once', () => {
    const m = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: 0xffffff });
    patchVertexColorGlow(m);
    const hook = m.onBeforeCompile;
    patchVertexColorGlow(m);
    expect(m.onBeforeCompile).toBe(hook);
    const shader = { fragmentShader: 'void main() {\n#include <color_fragment>\n}', vertexShader: '', uniforms: {} };
    hook.call(m, shader as unknown as THREE.WebGLProgramParametersWithUniforms, undefined as unknown as THREE.WebGLRenderer);
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance *= vColor.rgb');
  });
});
