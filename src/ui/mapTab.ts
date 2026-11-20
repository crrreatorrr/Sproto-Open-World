import { RD_X } from '../content/packs/rootdeep';
import { CELL_SIZE } from '../content/world/format';
import { regionAt, type RegionId } from '../content/world/regions';
import type { QuestOffer } from '../content/quests';
import type { Entity, Progress } from '../sim/entity';
import type { ReadonlySimView } from '../sim/view';
import { publicUrl } from '../world/RegionManifest';
import { leadLine, trackedQuest } from './rpgText';
import './mapTab.css';

/** Sproutvale's side (m): 8 cells of 64 m, with its south-west corner at the world's origin. */
const MAP_SIZE = 512;
/** Baked by tools/bake-map.mjs. */
const MAP_IMAGE = 'world/sproutvale/map.webp';

/** Where the regions of Sproutvale are, for the names on the map (world x, z). */
const REGIONS: readonly { name: string; x: number; z: number }[] = [
  { name: 'Sprout Hollow', x: 260, z: 98 },
  { name: 'Orchard Fields', x: 104, z: 160 },
  { name: 'Millrun', x: 424, z: 176 },
  { name: 'Watchtower Hill', x: 256, z: 286 },
  { name: 'Thornwood', x: 216, z: 352 },
  { name: 'The Quarry', x: 440, z: 452 },
];

const SHRINE_NAMES: Readonly<Record<string, string>> = {
  shrine_first_light: 'Shrine of First Light',
  shrine_rootdeep_lantern: 'Lantern Hall Shrine',
  shrine_rootdeep_crossing: 'Crossing Shrine',
};

/** The eight main caves and the vault, in world x (local x + 4096) and world z. */
const CAVE_REGIONS: readonly { name: string; x: number; z: number }[] = [
  { name: 'Lantern Hall', x: RD_X + 168, z: 168 },
  { name: 'Grunt Warren', x: RD_X + 256, z: 148 },
  { name: 'Slinger Gallery', x: RD_X + 344, z: 168 },
  { name: 'Wisp Hollow', x: RD_X + 364, z: 256 },
  { name: 'Brute Den', x: RD_X + 344, z: 344 },
  { name: 'Fungus Crossing', x: RD_X + 256, z: 364 },
  { name: 'Old Mine', x: RD_X + 168, z: 344 },
  { name: 'Echo Pit', x: RD_X + 148, z: 256 },
  { name: 'Vault', x: RD_X + 256, z: 256 },
];

/** Named places on the new regions' maps (world x, z). */
export const OVERWORLD_LABELS: Partial<Record<RegionId, readonly { name: string; x: number; z: number }[]>> = {
  town: [
    { name: 'Bell Plaza', x: 760, z: 232 },
    { name: 'Bell Canal', x: 816, z: 330 },
    { name: 'Bellmere Harbour', x: 1110, z: 96 },
  ],
  zen: [
    { name: 'Maple Gate', x: 252, z: 925 },
    { name: 'Maple Temple', x: 246, z: 1010 },
    { name: 'Koi Ponds', x: 212, z: 958 },
    { name: 'East Court', x: 419, z: 1170 },
  ],
  river: [
    { name: 'Willowrun Mill', x: 1100, z: 950 },
    { name: 'Mill Pond', x: 952, z: 992 },
    { name: 'Hollow Brook', x: 720, z: 1280 },
  ],
  waterfalls: [
    { name: 'The Veilfalls', x: 1150, z: 1730 },
    { name: 'The Gorge', x: 1030, z: 1790 },
    { name: 'Veil Tarn', x: 1254, z: 1900 },
    { name: 'Lower Veil', x: 1420, z: 1606 },
    { name: 'Veil Spring', x: 1160, z: 2330 },
  ],
  mountains: [
    { name: 'Lowpine Meadow', x: 322, z: 1700 },
    { name: 'Tarnhollow', x: 432, z: 1905 },
    { name: 'Frost Tarn', x: 466, z: 1942 },
    { name: 'Switchback Stair', x: 316, z: 2110 },
    { name: 'Eyrie Shelf', x: 324, z: 2246 },
    { name: 'Rope Bridge', x: 404, z: 2250 },
    { name: 'The Rimecleft', x: 400, z: 2150 },
    { name: 'The Old Watch', x: 472, z: 2262 },
  ],
};

/** The picture a world point belongs on: its region's map, baked by tools/bake-map.mjs. */
export function mapBounds(x: number, z = 0): { region: RegionId; name: string; minX: number; minZ: number; size: number; sizeZ: number; image: string } {
  const r = regionAt(x, z);
  if (r.id === 'sproutvale') return { region: r.id, name: r.name, minX: 0, minZ: 0, size: MAP_SIZE, sizeZ: MAP_SIZE, image: MAP_IMAGE };
  return {
    region: r.id,
    name: r.name,
    minX: r.origin[0] * CELL_SIZE,
    minZ: r.origin[1] * CELL_SIZE,
    size: r.size[0] * CELL_SIZE,
    sizeZ: r.size[1] * CELL_SIZE,
    image: `world/${r.id}/map.webp`,
  };
}

/** "shrine_quarry_gate" → "Quarry Gate Shrine". */
function shrineLabel(id: string): string {
  const known = SHRINE_NAMES[id];
  if (known) return known;
  return `${id.replace(/^shrine_/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')} Shrine`;
}

/**
 * A world point on the picture, in percent. North (+z) is up and the world is seen from above, so +x
 * is on the left: the compass calls that side west, and turning right in play turns right here.
 */
export function mapPoint(x: number, z: number, minX = 0, size = MAP_SIZE, minZ = 0, sizeZ = size): { left: number; top: number } {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return { left: clamp((1 - (x - minX) / size) * 100), top: clamp((1 - (z - minZ) / sizeZ) * 100) };
}

type PinKind = 'player' | 'quest' | 'shrine';

interface Pin {
  key: string;
  kind: PinKind;
  title: string;
  detail: string;
  x: number;
  z: number;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

/** What the map shows: you, the tracked quest's marker, and every shrine found so far. */
function mapPins(view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>, lead: QuestOffer | null): Pin[] {
  const me = e.tf.pos;
  const away = (x: number, z: number) => `${Math.round(Math.hypot(x - me.x, z - me.z))} m away`;
  const pins: Pin[] = [{ key: 'player', kind: 'player', title: 'You', detail: `Level ${p.level}`, x: me.x, z: me.z }];
  const quest = lead ? leadLine(lead) : trackedQuest(p);
  const at = quest?.marker ? view?.locate(quest.marker) : null;
  if (quest && at) pins.push({ key: 'quest', kind: 'quest', title: quest.title, detail: `${quest.step} · ${away(at.x, at.z)}`, x: at.x, z: at.z });
  for (const id of p.discoveredShrines) {
    const s = view?.locate(id);
    if (!s) continue;
    const rested = p.lastShrine === id ? 'You wake here · ' : '';
    pins.push({ key: id, kind: 'shrine', title: shrineLabel(id), detail: `${rested}${away(s.x, s.z)}`, x: s.x, z: s.z });
  }
  return pins;
}

/** Re-render the tab when any of this changes. */
export function mapSignature(view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>, lead: QuestOffer | null = null): string {
  return mapBounds(e.tf.pos.x, e.tf.pos.z).image + '|' + mapPins(view, e, p, lead).map((q) => `${q.key}:${Math.round(q.x)},${Math.round(q.z)}:${q.detail}`).join('|') + `|${e.tf.yaw.toFixed(2)}`;
}

/**
 * The Map tab: Sproutvale from above with you, the found shrines and the tracked quest's marker. The
 * list beside it works with a pad alone: up and down walk the pins and light the one in focus, and
 * confirming the quest's row opens the Quests tab.
 */
export function renderMap(body: HTMLElement, view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>, openQuests: () => void, lead: QuestOffer | null = null): void {
  const pins = mapPins(view, e, p, lead);
  const bounds = mapBounds(e.tf.pos.x, e.tf.pos.z);
  const labels = bounds.region === 'rootdeep' ? CAVE_REGIONS : bounds.region === 'sproutvale' ? REGIONS : OVERWORLD_LABELS[bounds.region] ?? [];
  const wrap = el('div', 'map-tab');
  const frame = el('div', 'map-frame');
  // Regions are not all square: the frame takes the region's shape and keeps the square's longer side.
  if (bounds.size !== bounds.sizeZ) {
    frame.style.aspectRatio = `${bounds.size} / ${bounds.sizeZ}`;
    if (bounds.sizeZ > bounds.size) frame.style.width = `calc(min(66vh, 92vw, 560px) * ${bounds.size / bounds.sizeZ})`;
  }
  const img = el('img', 'map-image');
  img.src = publicUrl(bounds.image);
  img.alt = `Map of ${bounds.name}`;
  img.draggable = false;
  frame.append(img, el('span', 'map-north', 'N'));
  for (const r of labels) {
    const at = mapPoint(r.x, r.z, bounds.minX, bounds.size, bounds.minZ, bounds.sizeZ);
    const label = el('span', 'map-region', r.name);
    label.style.left = `${at.left}%`;
    label.style.top = `${at.top}%`;
    frame.append(label);
  }
  const marks = new Map<string, HTMLElement>();
  // Drawn last to first, so you stay on top of a shrine you are standing at.
  // Mouths are never pins: a sealed one must show nothing, and an open one is the passage itself.
  for (const pin of [...pins].reverse()) {
    const at = mapPoint(pin.x, pin.z, bounds.minX, bounds.size, bounds.minZ, bounds.sizeZ);
    const mark = el('i', `map-pin ${pin.kind}`);
    mark.style.left = `${at.left}%`;
    mark.style.top = `${at.top}%`;
    // Yaw 0 faces north (up), and a positive yaw turns toward +x: left on this map.
    if (pin.kind === 'player') mark.style.setProperty('--facing', `${-e.tf.yaw}rad`);
    marks.set(pin.key, mark);
    frame.append(mark);
  }
  const list = el('div', 'list map-legend');
  for (const pin of pins) {
    const row = el('button', `btn item-row map-row ${pin.kind}`);
    row.type = 'button';
    row.dataset.nav = '';
    row.dataset.pin = pin.key;
    row.append(el('span', 'name', pin.title), el('span', 'blurb', pin.detail));
    row.addEventListener('focus', () => {
      for (const m of marks.values()) m.classList.remove('lit');
      marks.get(pin.key)?.classList.add('lit');
    });
    if (pin.kind === 'quest') row.addEventListener('click', openQuests);
    list.append(row);
  }
  if (!pins.some((q) => q.kind === 'shrine')) list.append(el('p', 'note', 'Shrines you find will appear here.'));
  wrap.append(frame, list);
  body.append(wrap);
}
