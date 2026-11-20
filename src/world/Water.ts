import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WaterBody } from '../content/world/format';

/**
 * The world's water, drawn from the manifest's `water` list (tools/bake-world.ts carves the beds).
 * Visual only: the player wades on the terrain under it.
 *
 * Rivers are ribbons along their sampled line, cut into ~64 m pieces; pools are discs. The pieces
 * are merged into one mesh per 256 m tile (one draw each), and a tile past the fog's far edge is
 * hidden, so the whole world's water costs a handful of draws wherever you stand. The look follows the concept art: faceted turquoise, lighter toward the banks, white
 * foam at the edges and wherever the surface falls steeply (the ribbon turns into a falling
 * sheet there). The vertex shader rolls slow waves along the flow, and flat shading turns the
 * moving vertices into shifting facets.
 *
 * Prop parts made with the kits' `fx_water` material (waterfall sheets, mist, foam rings) share
 * one clock: `patchFlowingWater` scrolls bright streaks down their UVs.
 */

/** Seconds, shared by every water material. WorldSession advances it each frame. */
export const waterClock = { value: 0 };

const DEEP = new THREE.Color(0x1f9ea8);
const SHALLOW = new THREE.Color(0x58d3c4);
const FOAM = new THREE.Color(0xf2fbfb);
/** Vertices across a river ribbon (edge, bank, centre…, bank, edge). */
const ACROSS = [-1, -0.82, -0.45, 0, 0.45, 0.82, 1];
/** Metres between ribbon rows. */
const ROW = 2.5;
/** Metres of river per mesh (one draw each, culled on its own). */
const PIECE = 64;
/** Metres per side of a water tile (one mesh, one draw). */
const TILE = 256;
/** Surface sits a hair above the river's surface height so the banks' 0.4 m rise covers its edge. */
const LIFT = 0.02;

function waterMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.86,
    roughness: 0.22,
    metalness: 0,
    flatShading: true,
    depthWrite: false,
  });
  m.name = 'world_water';
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWaterTime;\nattribute vec3 waterFlow;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
  // waterFlow: x = metres along the flow, y = flow speed (m/s), z = how still the vertex is (1 at a bank).
  float wt = uWaterTime;
  float along = waterFlow.x - wt * waterFlow.y;
  vec3 wp = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float wave = sin(along * 0.9 + wp.z * 0.35) * 0.06 + sin(wp.x * 0.7 - wt * 1.3 + along * 0.4) * 0.05;
  transformed.y += wave * (1.0 - waterFlow.z);`,
      );
  };
  m.customProgramCacheKey = () => 'world-water-v1';
  return m;
}

function pushColor(out: number[], c: THREE.Color): void {
  out.push(c.r, c.g, c.b);
}

/** One ribbon piece: rows [from, to] of the river's resampled line. */
function riverPiece(rows: { x: number; z: number; y: number; nx: number; nz: number; s: number; fall: number }[], halfWidth: number, flow: number): THREE.BufferGeometry {
  const pos: number[] = [], col: number[] = [], flowAttr: number[] = [], idx: number[] = [];
  const n = ACROSS.length;
  const c = new THREE.Color();
  for (const r of rows) {
    for (const a of ACROSS) {
      const edge = Math.abs(a);
      pos.push(r.x + r.nx * a * halfWidth, r.y + LIFT, r.z + r.nz * a * halfWidth);
      c.copy(DEEP).lerp(SHALLOW, edge * 0.85);
      if (edge >= 0.99) c.lerp(FOAM, 0.75);
      c.lerp(FOAM, r.fall * (0.6 + 0.4 * edge));
      pushColor(col, c);
      flowAttr.push(r.s, flow * (1 + r.fall * 6), edge >= 0.99 ? 1 : 0);
    }
  }
  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const a = j * n + i, b = a + 1, cc = a + n, d = cc + 1;
      idx.push(a, cc, b, b, cc, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('waterFlow', new THREE.Float32BufferAttribute(flowAttr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** A river's line resampled every ROW metres, with a sideways normal and how steeply it falls. */
function resample(points: [number, number, number][]): { x: number; z: number; y: number; nx: number; nz: number; s: number; fall: number }[] {
  const out: { x: number; z: number; y: number; nx: number; nz: number; s: number; fall: number }[] = [];
  let s = 0;
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, z0, y0] = points[i];
    const [x1, z1, y1] = points[i + 1];
    const len = Math.hypot(x1 - x0, z1 - z0);
    if (len < 1e-6) continue;
    const steps = Math.max(1, Math.ceil(len / ROW));
    const fall = Math.min(1, Math.max(0, (y0 - y1) / len - 0.15) * 1.5);
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, y: y0 + (y1 - y0) * t, nx: (z1 - z0) / len, nz: -(x1 - x0) / len, s: s + len * t, fall });
    }
    s += len;
  }
  const last = points[points.length - 1];
  const prev = out[out.length - 1];
  if (prev) out.push({ x: last[0], z: last[1], y: last[2], nx: prev.nx, nz: prev.nz, s, fall: prev.fall });
  // Smooth the sideways normals so bends don't pinch.
  for (let i = 1; i < out.length - 1; i++) {
    const nx = out[i - 1].nx + out[i].nx + out[i + 1].nx, nz = out[i - 1].nz + out[i].nz + out[i + 1].nz;
    const l = Math.hypot(nx, nz) || 1;
    out[i].nx = nx / l;
    out[i].nz = nz / l;
  }
  return out;
}

function poolGeometry(center: [number, number], radius: number, y: number): THREE.BufferGeometry {
  const rings = Math.max(3, Math.round(radius / 3));
  const seg = Math.max(12, Math.round(radius * 1.6));
  const pos: number[] = [0 + center[0], y + LIFT, center[1]], col: number[] = [], flowAttr: number[] = [0, 0, 0], idx: number[] = [];
  pushColor(col, DEEP);
  const c = new THREE.Color();
  for (let r = 1; r <= rings; r++) {
    const f = r / rings;
    for (let k = 0; k < seg; k++) {
      const a = (k / seg) * Math.PI * 2;
      pos.push(center[0] + Math.cos(a) * radius * f, y + LIFT, center[1] + Math.sin(a) * radius * f);
      c.copy(DEEP).lerp(SHALLOW, f * f);
      if (r === rings) c.lerp(FOAM, 0.7);
      pushColor(col, c);
      flowAttr.push(a * radius * 0.3, 0.25, r === rings ? 1 : 0);
    }
  }
  for (let k = 0; k < seg; k++) idx.push(0, 1 + ((k + 1) % seg), 1 + k);
  for (let r = 1; r < rings; r++) {
    const a0 = 1 + (r - 1) * seg, a1 = 1 + r * seg;
    for (let k = 0; k < seg; k++) {
      const k1 = (k + 1) % seg;
      idx.push(a0 + k, a0 + k1, a1 + k, a0 + k1, a1 + k1, a1 + k);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('waterFlow', new THREE.Float32BufferAttribute(flowAttr, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/** One named piece of water: a pool's disc, or ~64 m of a river's ribbon. */
export interface WaterPiece {
  name: string;
  geometry: THREE.BufferGeometry;
}

/** Every water body cut into pieces (`<id>` for a pool, `<id>_<row>` for a river piece). */
export function waterPieces(bodies: readonly WaterBody[]): WaterPiece[] {
  const out: WaterPiece[] = [];
  for (const b of bodies) {
    if (b.kind === 'pool') {
      out.push({ name: b.id, geometry: poolGeometry(b.center, b.radius, b.y) });
      continue;
    }
    const rows = resample(b.points);
    const perPiece = Math.max(2, Math.round(PIECE / ROW));
    for (let i = 0; i < rows.length - 1; i += perPiece) out.push({ name: `${b.id}_${i}`, geometry: riverPiece(rows.slice(i, Math.min(rows.length, i + perPiece + 1)), b.halfWidth, b.flow) });
  }
  return out;
}

/** Every water body in the world under one root: one mesh per tile, hidden past `range` metres. */
export class WaterLayer {
  readonly root = new THREE.Group();
  readonly material = waterMaterial();
  private readonly tiles: { mesh: THREE.Mesh; x: number; z: number; r: number }[] = [];

  constructor(bodies: readonly WaterBody[], private readonly range = Infinity) {
    this.root.name = 'water';
    const byTile = new Map<string, THREE.BufferGeometry[]>();
    for (const { geometry } of waterPieces(bodies)) {
      const c = geometry.boundingSphere!.center;
      const key = `${Math.floor(c.x / TILE)},${Math.floor(c.z / TILE)}`;
      const list = byTile.get(key);
      if (list) list.push(geometry);
      else byTile.set(key, [geometry]);
    }
    for (const [key, list] of byTile) {
      const g = list.length === 1 ? list[0] : mergeGeometries(list);
      if (list.length > 1) for (const piece of list) piece.dispose();
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, this.material);
      mesh.name = `water_${key.replace(',', '_')}`;
      mesh.renderOrder = 2;
      mesh.receiveShadow = false;
      mesh.castShadow = false;
      this.root.add(mesh);
      const s = g.boundingSphere!;
      this.tiles.push({ mesh, x: s.center.x, z: s.center.z, r: s.radius });
    }
  }

  /** Show only the tiles that reach within `range` of the focus (the rest are lost in the fog). */
  update(x: number, z: number): void {
    for (const t of this.tiles) t.mesh.visible = Math.hypot(t.x - x, t.z - z) - t.r <= this.range;
  }

  dispose(): void {
    for (const o of this.root.children) (o as THREE.Mesh).geometry.dispose();
    this.material.dispose();
    this.root.clear();
  }
}

/**
 * A kit's `fx_water` material (waterfall sheets, mist, foam): keep its vertex colours and add bright
 * streaks that run down the sheet's V coordinate, plus a soft flicker. Idempotent.
 */
export function patchFlowingWater(m: THREE.Material): void {
  if (m.userData.flowingWater) return;
  m.userData.flowingWater = true;
  m.transparent = true;
  (m as THREE.MeshStandardMaterial).depthWrite = false;
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uWaterTime = waterClock;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vFlowUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlowUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uWaterTime;\nvarying vec2 vFlowUv;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
  float streak = fract(vFlowUv.y * 3.0 - uWaterTime * 1.6 + sin(vFlowUv.x * 23.0) * 0.35);
  float band = smoothstep(0.0, 0.18, streak) * (1.0 - smoothstep(0.35, 0.6, streak));
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.96, 0.99, 1.0), band * 0.55);`,
      );
  };
  m.customProgramCacheKey = () => 'flowing-water-v1';
  m.needsUpdate = true;
}

/**
 * A kit's `fx_glow` material (crystals, lanterns, the Veilfalls rainbow). Blender lights these
 * with their own vertex colours, but glTF can only export one emissive colour, so they arrive as
 * flat white ×2 and wash every band out to white. Tint the emission by the vertex colour so each
 * part glows in its own colour. Idempotent.
 */
export function patchVertexColorGlow(m: THREE.Material): void {
  if (m.userData.vertexColorGlow) return;
  m.userData.vertexColorGlow = true;
  m.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  #if defined( USE_COLOR ) || defined( USE_COLOR_ALPHA )
  totalEmissiveRadiance *= vColor.rgb;
  #endif`,
    );
  };
  m.customProgramCacheKey = () => 'vertex-color-glow-v1';
  m.needsUpdate = true;
}
