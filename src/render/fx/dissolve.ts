import type * as THREE from 'three';

/** Value noise in three octaves, in 0..1. World metres in, so every body burns away at the same grain. */
const NOISE_GLSL = /* glsl */ `
uniform float uDissolve;
varying vec3 vDissolveP;
float dissolveHash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float dissolveValue(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dissolveHash(i), dissolveHash(i + vec3(1, 0, 0)), f.x), mix(dissolveHash(i + vec3(0, 1, 0)), dissolveHash(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(dissolveHash(i + vec3(0, 0, 1)), dissolveHash(i + vec3(1, 0, 1)), f.x), mix(dissolveHash(i + vec3(0, 1, 1)), dissolveHash(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float dissolveNoise(vec3 p) {
  return 0.55 * dissolveValue(p) + 0.3 * dissolveValue(p * 2.1) + 0.15 * dissolveValue(p * 4.3);
}
`;

/** Throw away what the burn has reached, and light the edge just ahead of it. */
const CUT_GLSL = /* glsl */ `
float dissolveEdge = 0.0;
if (uDissolve > 0.0) {
  float dissolveN = dissolveNoise(vDissolveP * 2.6);
  float dissolveCut = uDissolve * 0.92 + 0.1;
  if (dissolveN < dissolveCut) discard;
  dissolveEdge = 1.0 - smoothstep(dissolveCut, dissolveCut + 0.08, dissolveN);
}
`;

/**
 * Teach a material to burn away (the death dissolve). Returns the uniform to drive: 0 is whole, 1 is
 * gone. The noise is measured from the mesh's own origin, so it stays put on a body that sinks.
 */
export function makeDissolvable(m: THREE.Material): { value: number } {
  const uniform = { value: 0 };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uDissolve = uniform;
    shader.vertexShader = `varying vec3 vDissolveP;\n${shader.vertexShader}`.replace(
      '#include <project_vertex>',
      '#include <project_vertex>\nvDissolveP = mat3(modelMatrix) * transformed;',
    );
    shader.fragmentShader = `${NOISE_GLSL}\n${shader.fragmentShader}`
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${CUT_GLSL}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vec3(1.0, 0.5, 0.16) * dissolveEdge * 3.5;');
  };
  // Every dissolvable material of a kind shares one program; each keeps its own uniform.
  m.customProgramCacheKey = () => 'sow-dissolve';
  return uniform;
}
