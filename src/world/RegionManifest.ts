import { CELL_SIZE, cellKey, type CellEntry, type RegionManifest } from '../content/world/format';

/** Where Sproutvale's manifest lives (under public/). */
export const SPROUTVALE = 'world/sproutvale/region.json';

/** Where the Rootdeep's manifest lives (under public/). */
export const ROOTDEEP = 'world/rootdeep/region.json';

/** A public/ path as a URL the page can fetch (the build uses a relative base). */
export function publicUrl(path: string): string {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '');
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
 * One streamed world from two baked regions. Cells and props are joined; everything else (origin,
 * size, horizon, player start, fog, height range) stays the first region's, which is what the
 * streamer and the horizon mask are built around. A prop both regions place keeps the larger
 * capacity so neither InstancedMesh is short.
 */
export function mergeManifests(a: RegionManifest, b: RegionManifest): RegionManifest {
  if (a.heightRange.min !== b.heightRange.min || a.heightRange.max !== b.heightRange.max) {
    throw new Error(`heightRange ${a.heightRange.min}..${a.heightRange.max} != ${b.heightRange.min}..${b.heightRange.max}`);
  }
  const props: RegionManifest['props'] = { ...a.props };
  for (const [key, kind] of Object.entries(b.props)) {
    const have = props[key];
    if (!have) props[key] = kind;
    else if (kind.capacity > have.capacity) props[key] = { ...have, capacity: kind.capacity };
  }
  return { ...a, cells: [...a.cells, ...b.cells], props };
}

/** Sproutvale plus the Rootdeep, checked the same way as either manifest on its own. */
export async function loadWorld(signal?: AbortSignal): Promise<Region> {
  const [sproutvale, rootdeep] = await Promise.all([loadRegion(SPROUTVALE, signal), loadRegion(ROOTDEEP, signal)]);
  return new Region(mergeManifests(sproutvale.manifest, rootdeep.manifest));
}
