#!/usr/bin/env node
/**
 * Bakes the Map tab's picture (src/ui/mapTab.ts) from a baked region: terrain colours from the splat
 * weights, hill shading and contour lines from the heights, the river from terrain.json, and the
 * trees and buildings from the cells' prop lists. One pixel is one metre.
 *
 *   node tools/bake-map.mjs [region]   writes public/world/<region>/map.webp
 *
 * North (+z) is up. The world is seen from above, so +x is on the LEFT: that is the side the compass
 * calls west, and turning right in the game turns right on the map.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const region = process.argv[2] ?? 'sproutvale';
const ROOT = path.resolve('public/world', region);
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'region.json'), 'utf8'));
const terrain = JSON.parse(fs.readFileSync(path.resolve('world-src', region, 'terrain.json'), 'utf8'));

const CELL = manifest.cellSize;
const RES = CELL + 1;
const W = manifest.size[0] * CELL, H = manifest.size[1] * CELL;
const [ox, oz] = manifest.origin.map((c) => c * CELL);

const LAYER_RGB = { grass: [122, 150, 78], dirt: [156, 128, 88], rock: [142, 136, 124], path: [214, 192, 142] };
const layers = manifest.splatLayers.map((n) => LAYER_RGB[n] ?? LAYER_RGB.grass);
const WATER = [92, 142, 170];
const TREE = [58, 92, 50];
const BUILT = [96, 74, 54];
const TREES = new Set(['grove_tree', 'grove_pines']);
const BUILDINGS = new Set(['market_stall', 'fountain', 'grove_shed', 'grove_barn_roof', 'grove_silo', 'grove_water_tower', 'grove_tower', 'well', 'grove_bridge']);
/** The environment kits' props by name (art/tools/env). */
const KIT_TREE = /_(pine|pine_small|maple_red|maple_orange|willow|birch|birch_pair|bamboo)$/;
const KIT_BUILT = /_(house_[a-z]+|clock_tower|keep|mill|temple|pagoda|torii|bridge|market_stall|watchtower_ruin|dock|rope_bridge)$/;
const KIT_ROCK = /_(peak_[ab]|cliff_[ab]|basalt_cliff|basalt_cliff_low|rock_large)$/;
const ROCK = [118, 112, 128];
const CONTOUR_M = 4;

const heights = new Float32Array(W * H);
const rgb = new Float32Array(W * H * 3);
const at = (x, z) => Math.min(H - 1, Math.max(0, z)) * W + Math.min(W - 1, Math.max(0, x));
const span = manifest.heightRange.max - manifest.heightRange.min;

const placed = [];
for (const c of manifest.cells) {
  const bin = fs.readFileSync(path.resolve('public', c.bin));
  const view = new DataView(bin.buffer, bin.byteOffset, bin.byteLength);
  const splatAt = RES * RES * 2;
  for (let iz = 0; iz < CELL; iz++) {
    for (let ix = 0; ix < CELL; ix++) {
      const s = iz * RES + ix;
      const i = at(c.cx * CELL + ix - ox, c.cz * CELL + iz - oz);
      heights[i] = manifest.heightRange.min + (view.getUint16(s * 2, true) / 65535) * span;
      let sum = 0;
      const mix = [0, 0, 0];
      for (let l = 0; l < 4; l++) {
        const w = bin[splatAt + s * 4 + l];
        sum += w;
        for (let k = 0; k < 3; k++) mix[k] += layers[l][k] * w;
      }
      for (let k = 0; k < 3; k++) rgb[i * 3 + k] = mix[k] / Math.max(1, sum);
    }
  }
  const json = JSON.parse(fs.readFileSync(path.resolve('public', c.json), 'utf8'));
  for (const [kind, packed] of Object.entries(json.props ?? {})) {
    const tree = TREES.has(kind) || KIT_TREE.test(kind), built = BUILDINGS.has(kind) || KIT_BUILT.test(kind), rock = KIT_ROCK.test(kind);
    const paint = tree ? TREE : built ? BUILT : rock ? ROCK : null;
    if (!paint) continue;
    const r = kind === 'grove_pines' ? 3 : /peak/.test(kind) ? 26 : /cliff/.test(kind) ? 10 : /house|temple|mill|clock|keep|pagoda/.test(kind) ? 4.5 : tree ? 1.8 : 2.4;
    for (let p = 0; p + 4 < packed.length; p += 5) placed.push({ x: packed[p] - ox, z: packed[p + 2] - oz, r: r * Math.sqrt(packed[p + 4]), paint });
  }
}

/** Distance from (x, z) to the polyline. */
function toLine(points, x, z) {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const [ax, az] = points[i], [bx, bz] = points[i + 1];
    const dx = bx - ax, dz = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
    best = Math.min(best, Math.hypot(x - ax - dx * t, z - az - dz * t));
  }
  return best;
}

const rivers = (terrain.carve ?? []).filter((c) => c.id === 'river').map((c) => ({ points: c.points, half: c.bedHalfWidth + 1.5 }));
// The water the renderer draws (manifest.water): rivers by their ribbon, pools by their disc.
for (const w of manifest.water ?? []) if (w.kind === 'river') rivers.push({ points: w.points, half: w.halfWidth });
const pools = (manifest.water ?? []).filter((w) => w.kind === 'pool');
for (let z = 0; z < H; z++) {
  for (let x = 0; x < W; x++) {
    const i = at(x, z);
    const wet = rivers.some((r) => toLine(r.points, x + ox, z + oz) <= r.half) || pools.some((p) => Math.hypot(x + ox - p.center[0], z + oz - p.center[1]) <= p.radius);
    if (wet) for (let k = 0; k < 3; k++) rgb[i * 3 + k] = WATER[k];
  }
}

for (const p of placed) {
  const R = Math.ceil(p.r);
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = Math.round(p.x) + dx, z = Math.round(p.z) + dz;
      if (x < 0 || z < 0 || x >= W || z >= H || dx * dx + dz * dz > p.r * p.r) continue;
      const i = at(x, z);
      for (let k = 0; k < 3; k++) rgb[i * 3 + k] += (p.paint[k] - rgb[i * 3 + k]) * 0.7;
    }
  }
}

let lo = Infinity, hi = -Infinity;
for (const h of heights) {
  lo = Math.min(lo, h);
  hi = Math.max(hi, h);
}
// Contours every 4 m in the lowlands; a mountain region would turn brown with lines, so space them by its relief.
const contour = Math.max(CONTOUR_M, Math.round((hi - lo) / 12 / 2) * 2);
const out = Buffer.alloc(W * H * 3);
for (let z = 0; z < H; z++) {
  for (let x = 0; x < W; x++) {
    const i = at(x, z);
    // Map space: u = −x, v = −z, lit from the picture's top-left corner.
    const du = (heights[at(x - 1, z)] - heights[at(x + 1, z)]) / 2;
    const dv = (heights[at(x, z - 1)] - heights[at(x, z + 1)]) / 2;
    const shade = Math.max(0.55, Math.min(1.35, 1 + 0.55 * (du + dv)));
    const band = Math.floor(heights[i] / contour);
    const edge = band !== Math.floor(heights[at(x + 1, z)] / contour) || band !== Math.floor(heights[at(x, z + 1)] / contour);
    const lift = 0.92 + 0.16 * ((heights[i] - lo) / Math.max(1, hi - lo));
    const o = ((H - 1 - z) * W + (W - 1 - x)) * 3;
    for (let k = 0; k < 3; k++) out[o + k] = Math.max(0, Math.min(255, rgb[i * 3 + k] * shade * lift * (edge ? 0.86 : 1)));
  }
}

const file = path.join(ROOT, 'map.webp');
await sharp(out, { raw: { width: W, height: H, channels: 3 } }).webp({ quality: 84 }).toFile(file);
console.log(`bake-map: ${path.relative(process.cwd(), file)} ${W}×${H}, ${(fs.statSync(file).size / 1024).toFixed(0)} KiB`);
