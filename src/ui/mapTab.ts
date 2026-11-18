import type { Entity, Progress } from '../sim/entity';
import type { ReadonlySimView } from '../sim/view';
import { publicUrl } from '../world/RegionManifest';
import { trackedQuest } from './rpgText';
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

const SHRINE_NAMES: Readonly<Record<string, string>> = { shrine_first_light: 'Shrine of First Light' };

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
export function mapPoint(x: number, z: number): { left: number; top: number } {
  const clamp = (v: number) => Math.min(100, Math.max(0, v));
  return { left: clamp((1 - x / MAP_SIZE) * 100), top: clamp((1 - z / MAP_SIZE) * 100) };
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
function mapPins(view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>): Pin[] {
  const me = e.tf.pos;
  const away = (x: number, z: number) => `${Math.round(Math.hypot(x - me.x, z - me.z))} m away`;
  const pins: Pin[] = [{ key: 'player', kind: 'player', title: 'You', detail: `Level ${p.level}`, x: me.x, z: me.z }];
  const quest = trackedQuest(p);
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
export function mapSignature(view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>): string {
  return mapPins(view, e, p).map((q) => `${q.key}:${Math.round(q.x)},${Math.round(q.z)}:${q.detail}`).join('|') + `|${e.tf.yaw.toFixed(2)}`;
}

/**
 * The Map tab: Sproutvale from above with you, the found shrines and the tracked quest's marker. The
 * list beside it works with a pad alone: up and down walk the pins and light the one in focus, and
 * confirming the quest's row opens the Quests tab.
 */
export function renderMap(body: HTMLElement, view: ReadonlySimView | null, e: Readonly<Entity>, p: Readonly<Progress>, openQuests: () => void): void {
  const pins = mapPins(view, e, p);
  const wrap = el('div', 'map-tab');
  const frame = el('div', 'map-frame');
  const img = el('img', 'map-image');
  img.src = publicUrl(MAP_IMAGE);
  img.alt = 'Map of Sproutvale';
  img.draggable = false;
  frame.append(img, el('span', 'map-north', 'N'));
  for (const r of REGIONS) {
    const at = mapPoint(r.x, r.z);
    const label = el('span', 'map-region', r.name);
    label.style.left = `${at.left}%`;
    label.style.top = `${at.top}%`;
    frame.append(label);
  }
  const marks = new Map<string, HTMLElement>();
  // Drawn last to first, so you stay on top of a shrine you are standing at.
  for (const pin of [...pins].reverse()) {
    const at = mapPoint(pin.x, pin.z);
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
