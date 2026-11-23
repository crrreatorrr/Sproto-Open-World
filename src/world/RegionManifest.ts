import { CELL_SIZE, cellKey, type CellEntry, type RegionManifest } from '../content/world/format';
import { REGIONS } from '../content/world/regions';

/** Where Sproutvale's manifest lives (under public/). */
export const SPROUTVALE = 'world/sproutvale/region.json';

/** Where the Rootdeep's manifest lives (under public/). */
export const ROOTDEEP = 'world/rootdeep/region.json';

/** The merged world's extras: every overworld region's horizon (the cave's is never drawn). */
export interface WorldManifest extends RegionManifest {
  horizons: string[];
}

/**
 * A public/ path as a URL the page can fetch (the build uses a relative base). `version` (a region's
 * `contentHash`) goes on as `?v=`: the file's URL then changes whenever its bake does.
 */
export function publicUrl(path: string, version?: string): string {
  return import.meta.env.BASE_URL + versioned(path.replace(/^\/+/, ''), version);
}

/** `path?v=version`, or the path alone when there is no version. */
export function versioned(path: string, version?: string): string {
  return version ? `${path}?v=${version}` : path;
}

/**
 * Prop GLB paths in the manifest are under public/assets (format.ts); accept them with or without
 * the `assets/` prefix and return a public/ path.
 */
export function propPath(path: string): string {
  const p = path.replace(/^\/+/, '');
  return p.startsWith('assets/') ? p : `assets/${p}`;
}

/** A loaded region: the manifest plus the lookups the streamer needs. */
export class Region {
  private readonly cells = new Map<string, CellEntry>();

  constructor(readonly manifest: RegionManifest) {
    for (const c of manifest.cells) this.cells.set(cellKey(c.cx, c.cz), c);
  }

  /** Whether the region has this cell (the manifest may leave holes; edges are walls). */
  has = (cx: number, cz: number): boolean => this.cells.has(cellKey(cx, cz));

  entry(cx: number, cz: number): CellEntry | undefined {
    return this.cells.get(cellKey(cx, cz));
  }

  get cellSize(): number {
    return this.manifest.cellSize;
  }
}

/** Fetch and sanity-check a region manifest. Throws with a readable reason. */
export async function loadRegion(path = SPROUTVALE, signal?: AbortSignal): Promise<Region> {
  const res = await fetch(publicUrl(path), { signal });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  const m = (await res.json()) as RegionManifest;
  const problems: string[] = [];
  if (!Array.isArray(m.cells) || m.cells.length === 0) problems.push('no cells');
  if (m.cellSize !== CELL_SIZE) problems.push(`cellSize ${m.cellSize} (the client is built for ${CELL_SIZE})`);
  if (!m.heightRange || !(m.heightRange.max > m.heightRange.min)) problems.push('bad heightRange');
  if (!m.playerStart?.pos) problems.push('no playerStart');
  if (!m.props || typeof m.props !== 'object') problems.push('no prop table');
  if (!Array.isArray(m.splatLayers) || m.splatLayers.length !== 4) problems.push('splatLayers must name 4 layers');
  if (problems.length) throw new Error(`${path}: ${problems.join(', ')}`);
  return new Region(m);
}

/**
 * One streamed world from baked regions. Cells, props and water are joined. Origin and size become
 * the bounding box of every region's cells (the horizon mask is built over it); player start, fog
 * and height range stay the first region's. A prop several regions use keeps the largest capacity
 * so no InstancedMesh is short. `overworld` lists which manifests draw their horizon.
 */
export function mergeManifests(first: RegionManifest, ...rest: RegionManifest[]): WorldManifest;
export function mergeManifests(...all: RegionManifest[]): WorldManifest {
  return mergeWorld(all, all.map(() => true));
}

export function mergeWorld(all: RegionManifest[], overworld: boolean[]): WorldManifest {
  const [a] = all;
  for (const b of all.slice(1)) {
    if (a.heightRange.min !== b.heightRange.min || a.heightRange.max !== b.heightRange.max) {
      throw new Error(`heightRange ${a.heightRange.min}..${a.heightRange.max} != ${b.heightRange.min}..${b.heightRange.max} (${b.id})`);
    }
  }
  const props: RegionManifest['props'] = { ...a.props };
  for (const b of all.slice(1)) {
    for (const [key, kind] of Object.entries(b.props)) {
      const have = props[key];
      if (!have) props[key] = kind;
      else if (kind.capacity > have.capacity) props[key] = { ...have, capacity: kind.capacity };
    }
  }
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  for (const m of all) {
    x0 = Math.min(x0, m.origin[0]);
    z0 = Math.min(z0, m.origin[1]);
    x1 = Math.max(x1, m.origin[0] + m.size[0]);
    z1 = Math.max(z1, m.origin[1] + m.size[1]);
  }
  // A river that crosses a seam is in both regions' manifests: keep it once.
  const seen = new Set<string>();
  const water = all.flatMap((m) => m.water ?? []).filter((w) => !seen.has(w.id) && Boolean(seen.add(w.id)));
  return {
    ...a,
    origin: [x0, z0],
    size: [x1 - x0, z1 - z0],
    cells: all.flatMap((m) => (m.contentHash ? m.cells.map((c) => ({ ...c, v: m.contentHash })) : m.cells)),
    props,
    ...(water.length ? { water } : {}),
    horizons: all.filter((_, i) => overworld[i]).map((m) => versioned(m.horizon, m.contentHash)),
  };
}

/** Every region in the registry (src/content/world/regions.ts), checked one by one, as one world. */
export async function loadWorld(signal?: AbortSignal): Promise<Region> {
  const loaded = await Promise.all(REGIONS.map((r) => loadRegion(r.manifest, signal)));
  return new Region(mergeWorld(loaded.map((r) => r.manifest), REGIONS.map((r) => r.overworld)));
}
