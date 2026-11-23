import * as THREE from 'three';

/** Uniforms every prop material shares: where the camera is, and a running clock in seconds. */
export interface PropFadeShared {
  cam: { value: THREE.Vector3 };
  time: { value: number };
}

/** How long a prop that has just arrived takes to dither in (s). */
export const APPEAR_SECONDS = 0.4;

const VERTEX_PARS = /* glsl */ `
uniform vec3 uPropCam;
uniform vec4 uPropFade;
uniform float uPropTime;
attribute float aBorn;
varying vec2 vPropFade;
`;

/**
 * Each instance's own distance to the camera on the ground plane decides how much of it shows:
 * in between uPropFade.x and .y (vPropFade.x), out between .z and .w, and in over a moment after it
 * arrives (together, vPropFade.y). One that doesn't show at all is thrown out of the view here, so
 * it costs no pixels.
 */
const VERTEX_MAIN = /* glsl */ `
#ifdef USE_INSTANCING
  float propD = distance(instanceMatrix[3].xz, uPropCam.xz);
  vPropFade.x = clamp((propD - uPropFade.x) / max(uPropFade.y - uPropFade.x, 0.001), 0.0, 1.0);
  vPropFade.y = clamp((uPropFade.w - propD) / max(uPropFade.w - uPropFade.z, 0.001), 0.0, 1.0)
    * clamp((uPropTime - aBorn) * ${(1 / APPEAR_SECONDS).toFixed(3)}, 0.0, 1.0);
  if (vPropFade.x <= 0.0 || vPropFade.y <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
#else
  vPropFade = vec2(1.0);
#endif
`;

/**
 * A screen-door fade: each pixel has a fixed threshold. A model fading out keeps the pixels whose
 * threshold is under its fade; the model fading in over the same distances keeps exactly the other
 * pixels. So while a prop swaps its detailed model for its simple one, every pixel of it is drawn by
 * one of the two: no holes and no doubling. Both write depth, so nothing needs sorting and no
 * transparent pass is added (San Andreas faded with alpha, which needs both).
 */
const FRAGMENT_MAIN = /* glsl */ `
  if (vPropFade.x < 0.999 || vPropFade.y < 0.999) {
    float propNoise = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
    if (vPropFade.y <= propNoise || vPropFade.x <= 1.0 - propNoise) discard;
  }
`;

/**
 * A copy of a prop's material that fades by distance and on arrival. `fade` is the set's own
 * distances (x, y: in; z, w: out), read live, so changing it moves the fade without a recompile.
 * Whatever the material was already taught (flowing water, vertex-colour glow) is kept.
 */
export function fadeMaterial<T extends THREE.Material>(base: T, shared: PropFadeShared, fade: THREE.Vector4): T {
  const m = base.clone();
  const before = base.onBeforeCompile;
  const custom = base.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey;
  const baseKey = custom ? base.customProgramCacheKey() : '';
  m.onBeforeCompile = (shader, renderer) => {
    before.call(m, shader, renderer);
    shader.uniforms.uPropCam = shared.cam;
    shader.uniforms.uPropTime = shared.time;
    shader.uniforms.uPropFade = { value: fade };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERTEX_MAIN}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPropFade;')
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${FRAGMENT_MAIN}`);
  };
  m.customProgramCacheKey = () => `${baseKey}|prop-fade-v2`;
  return m;
}
