import { isRootdeep } from '../content/packs/rootdeep';
import { CELL_SIZE } from '../content/world/format';
import { regionAt, type RegionId } from '../content/world/regions';
import type { QuestOffer } from '../content/quests';
import type { Entity, Progress } from '../sim/entity';
import type { ReadonlySimView } from '../sim/view';
import { publicUrl } from '../world/RegionManifest';
import { NPCS } from '../content/npcs';
import { CAVE_AREAS, SURFACE_AREAS } from '../content/world/areas';
import { leadLine, placeName, questPlaces, questSteps, shrineLabel, trackedQuest, type QuestPlace, type QuestStepLine } from './rpgText';
import './mapTab.css';

/** Sproutvale's side (m): 8 cells of 64 m, with its south-west corner at the world's origin. */
const MAP_SIZE = 512;
/** Baked by tools/bake-map.mjs. */
const MAP_IMAGE = 'world/sproutvale/map.webp';

const REGIONS = SURFACE_AREAS;

const CAVE_REGIONS = CAVE_AREAS;

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

export { shrineLabel };

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

/** The quest the map follows: the one "Find a quest" leads to, else the tracked one. */
export interface MapQuest {
  id: string;
  title: string;
  steps: QuestStepLine[];
  places: QuestPlace[];
}

export function mapQuest(p: Readonly<Progress>, lead: QuestOffer | null): MapQuest | null {
  if (lead) {
    const line = leadLine(lead);
    const giver = { id: lead.npc, name: NPCS[lead.npc]?.name ?? placeName(lead.npc) };
    return { id: line.id, title: line.title, steps: [{ text: line.step, state: 'current', lines: [] }], places: [giver] };
  }
  const q = trackedQuest(p);
  if (!q) return null;
  return { id: q.id, title: q.title, steps: questSteps(q.id, p.quests[q.id]), places: questPlaces(q.id, p.quests[q.id]) };
}

/** What the map shows: you, every place the followed quest's step sends you, and every shrine found so far. */
function mapPins(view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>, quest: MapQuest | null): Pin[] {
  const me = e.tf.pos;
  const cave = isRootdeep(me.x);
  // The cave and the valley share no ground, so a place on the other map has no distance worth giving.
  const away = (x: number, z: number) => isRootdeep(x) === cave
    ? `${Math.round(Math.hypot(x - me.x, z - me.z))} m away`
    : cave ? 'Up in Sproutvale' : 'Down in the Rootdeep';
  const pins: Pin[] = [{ key: 'player', kind: 'player', title: 'You', detail: `Level ${p.level}`, x: me.x, z: me.z }];
  for (const place of quest?.places ?? []) {
    const at = view?.locate(place.id);
    if (at) pins.push({ key: `quest:${place.id}`, kind: 'quest', title: place.name, detail: away(at.x, at.z), x: at.x, z: at.z });
  }
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
  const quest = mapQuest(p, lead);
  const steps = quest ? `${quest.id}:${quest.steps.map((s) => s.state[0] + s.lines.map((l) => l.text).join(',')).join(';')}` : '';
  return mapBounds(e.tf.pos.x, e.tf.pos.z).image + '|' + steps + '|' + mapPins(view, e, p, quest).map((q) => `${q.key}:${Math.round(q.x)},${Math.round(q.z)}:${q.detail}`).join('|') + `|${e.tf.yaw.toFixed(2)}`;
}

/** The followed quest's steps: ticked off, the one you are on (with what is left of it), and what comes next. */
function stepList(quest: MapQuest): HTMLElement {
  const box = el('div', 'map-quest');
  box.append(el('p', 'map-quest-title', quest.title));
  const ol = el('ol', 'map-steps');
  for (const s of quest.steps) {
    const li = el('li', `map-step ${s.state}`, s.text);
    if (s.lines.length) {
      const ul = el('ul', 'map-step-lines');
      for (const l of s.lines) ul.append(el('li', l.done ? 'done' : '', l.text));
      li.append(ul);
    }
    ol.append(li);
  }
  box.append(ol);
  return box;
}

/**
 * The Map tab: Sproutvale from above with you, the found shrines, and a pin on every place the tracked
 * quest's step sends you, with that quest's steps listed beside it. The list works with a pad alone:
 * up and down walk the pins and light the one in focus, and confirming a quest row opens the Quests tab.
 */
export function renderMap(body: HTMLElement, view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>, openQuests: () => void, lead: QuestOffer | null = null): void {
  const quest = mapQuest(p, lead);
  const pins = mapPins(view, e, p, quest);
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
    // A place on another region's map (the valley seen from the cave, Bellmere from Sproutvale) is
    // listed, not pinned on the edge.
    if (mapBounds(pin.x, pin.z).region !== bounds.region) continue;
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
  pins.forEach((pin, i) => {
    // The quest's steps sit under you, above the places they send you.
    if (i === 1 && quest) list.append(stepList(quest));
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
  });
  if (quest && pins.length === 1) list.append(stepList(quest));
  if (!pins.some((q) => q.kind === 'shrine')) list.append(el('p', 'note', 'Shrines you find will appear here.'));
  wrap.append(frame, list);
  body.append(wrap);
}
