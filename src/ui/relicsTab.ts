/**
 * The Relics tab (quest polish menu spec). GameMenu mounts it between Gear and Quests.
 * It only queues UiActions. Card text is fetched from /ui/relic-copy.json so those strings
 * stay out of the boot script. The 128 px master and the 24 px silhouette are files under
 * public/assets/icons/keepsakes. The rarity frame is drawn here, not painted into the art.
 */
import './relics.css';
import type { RelicCopy } from '../content/relicCopy';
import {
  GEAR_LOCK_TEXT, KEEPSAKES, RELIC_SOCKETS, TOTEM_SWAPPED_TEXT, badgeText, capBlockMessage, foundCount, keepsake, keepsakeIcon, relicShortfall,
  type KeepsakeDef,
} from '../content/relics';
import type { UiAction } from '../sim/commands';
import type { Progress } from '../sim/entity';

export interface RelicCardModel {
  id: string;
  kind: KeepsakeDef['kind'];
  rarity: KeepsakeDef['rarity'];
  name: string;
  locked: boolean;
  equipped: boolean;
  effect: string;
  flavour: string;
  clue: string;
  cap: string | null;
  badge: string | null;
  dim: boolean;
}

export interface RelicsModel {
  found: number;
  sockets: (RelicCardModel | null)[];
  totem: RelicCardModel | null;
  cards: RelicCardModel[];
  locked: boolean;
  message: string | null;
}

let copyOf: (id: string) => RelicCopy | undefined = () => undefined;

/** Tests and the menu share one lookup. The menu fills it from the fetched JSON. */
export function setRelicCopy(copy: (id: string) => RelicCopy | undefined): void {
  copyOf = copy;
}

/** Fetched once, the first time the Relics tab opens. A failure leaves the cards without text. */
export function loadRelicCopy(): Promise<void> {
  return fetch('/ui/relic-copy.json').then(async (res) => {
    if (!res.ok) return;
    const data = await res.json() as Record<string, RelicCopy>;
    setRelicCopy((id) => data[id]);
  });
}

const cardOf = (def: KeepsakeDef, p: Progress, locked: boolean): RelicCardModel => {
  const r = p.relics;
  const owned = !!r?.owned.includes(def.id);
  const equipped = owned && (r?.sockets.includes(def.id) || r?.totem === def.id);
  const dim = owned && relicShortfall(def.id, r?.sockets ?? []) > 0;
  const text = copyOf(def.id);
  return {
    id: def.id, kind: def.kind, rarity: def.rarity,
    name: owned ? def.name : '????',
    locked: !owned, equipped, effect: text?.effect ?? '', flavour: text?.flavour ?? '', clue: text?.clue ?? '', cap: text?.cap ?? null,
    badge: badgeText(def.ranked), dim: dim && !locked,
  };
};

export function relicsModel(p: Progress, seen: (quest: string) => boolean, gearLocked: boolean, message: string | null): RelicsModel {
  const r = p.relics;
  const show = (def: KeepsakeDef) => !!r?.owned.includes(def.id) || seen(def.quest);
  const cards = KEEPSAKES.filter(show).map((def) => cardOf(def, p, gearLocked));
  const sockets = Array.from({ length: RELIC_SOCKETS }, (_, i) => {
    const id = r?.sockets[i];
    const def = keepsake(id);
    return def ? cardOf(def, p, gearLocked) : null;
  });
  const totemDef = keepsake(r?.totem);
  return { found: foundCount(r?.owned ?? []), sockets, totem: totemDef ? cardOf(totemDef, p, gearLocked) : null, cards, locked: gearLocked, message };
}

export interface PressResult {
  action: UiAction | null;
  message: string | null;
  /** Focus should move onto the sockets so the player picks one to replace. */
  replace: boolean;
}

/** A on a card. Equipped removes it. A full relic bar asks which socket to replace. */
export function pressCard(p: Progress, id: string, gearLocked: boolean, replaceSocket: number | null): PressResult {
  const def = keepsake(id);
  const r = p.relics;
  if (!def || !r?.owned.includes(id)) return { action: null, message: null, replace: false };
  if (gearLocked) return { action: null, message: GEAR_LOCK_TEXT, replace: false };
  if (def.kind === 'totem') {
    const swapped = r.totem !== null && r.totem !== id;
    return { action: { kind: 'equipTotem', item: id }, message: swapped ? TOTEM_SWAPPED_TEXT : null, replace: false };
  }
  if (r.sockets.includes(id) && replaceSocket === null) return { action: { kind: 'equipRelic', item: id }, message: null, replace: false };
  const empty = r.sockets.indexOf(null);
  if (replaceSocket !== null) {
    const msg = capBlockMessage(id, r.sockets.filter((_, i) => i !== replaceSocket));
    return { action: { kind: 'equipRelic', item: id, socket: replaceSocket }, message: msg, replace: false };
  }
  if (empty >= 0) {
    const msg = capBlockMessage(id, r.sockets);
    return { action: { kind: 'equipRelic', item: id, socket: empty }, message: msg, replace: false };
  }
  return { action: null, message: null, replace: true };
}

const el = (tag: string, cls = '', text = ''): HTMLElement => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

const btn = (cls: string, x: number, y: number): HTMLButtonElement => {
  const b = el('button', cls) as HTMLButtonElement;
  b.type = 'button';
  b.dataset.nav = '';
  b.dataset.gx = String(x);
  b.dataset.gy = String(y);
  return b;
};

/** Owned cards show the 128 px master. A locked card masks the currentColor silhouette. */
const art = (id: string, locked: boolean): HTMLElement => {
  const files = keepsakeIcon(id);
  if (!files || locked) {
    const d = el('span', 'relic-art silhouette');
    if (files) d.style.maskImage = `url("${files.svg}")`;
    return d;
  }
  const img = el('img', 'relic-art') as HTMLImageElement;
  img.src = files.png;
  return img;
};

function detailOf(model: RelicsModel, selected: string | null, compare: string | null): HTMLElement {
  const box = el('div', 'relic-detail');
  const card = model.cards.find((c) => c.id === selected);
  if (!card) return box;
  const name = el('div', `name ${card.locked ? '' : card.rarity}`);
  name.append(el('span', '', card.name), el('span', 'rarity', card.locked ? '' : card.rarity));
  if (card.badge) name.append(el('span', 'relic-badge', card.badge));
  box.append(art(card.id, card.locked), name);
  if (card.locked) return box.append(el('p', 'blurb', card.clue)), box;
  box.append(el('p', `trait${card.dim ? ' dim' : ''}`, card.effect), el('p', 'blurb', card.flavour));
  if (card.cap) box.append(el('p', '', card.cap));
  const bonus = copyOf(card.id)?.bonus;
  if (bonus) box.append(el('p', '', bonus));
  if (compare) {
    const row = el('div', 'relic-compare');
    row.append(el('p', 'trait', card.effect), el('p', 'trait', model.sockets[0]?.effect ?? 'Empty socket.'));
    box.append(row);
  }
  return box;
}

/** Sockets, the owned grid, and the detail card. Confirm equips; compare and jump are relicKey. */
export function renderRelics(
  body: HTMLElement,
  model: RelicsModel,
  selected: string | null,
  compare: string | null,
  onSelect: (id: string) => void,
  onActivate: (id: string) => void,
  onReplace: (socket: number) => void,
): void {
  const root = el('div', 'relics');
  const head = el('div', 'relic-head');
  head.append(el('span', '', `${model.found} found`));
  if (model.locked) root.append(el('p', 'note locked', GEAR_LOCK_TEXT));
  if (model.message) root.append(el('p', 'note', model.message));
  const sockets = el('div', 'relic-sockets');
  const socket = (card: RelicCardModel | null, x: number, onClick: (() => void) | null) => {
    const b = btn(`relic-socket${card ? ` filled ${card.rarity}` : ' plus'}`, x, 0);
    b.dataset.socket = String(x);
    if (card && onClick) {
      b.append(art(card.id, false));
      b.disabled = model.locked;
      b.addEventListener('click', onClick);
    } else b.textContent = '+';
    sockets.append(b);
  };
  model.sockets.forEach((s, i) => socket(s, i, () => onReplace(i)));
  socket(model.totem, 3, null);
  const grid = el('div', 'relic-grid');
  model.cards.forEach((c, i) => {
    const b = btn(`relic-card ${c.rarity}${c.equipped ? ' equipped' : ''}${c.locked ? ' locked' : ''}${c.dim ? ' dim' : ''}`, i % 5, 1 + Math.floor(i / 5));
    b.dataset.id = c.id;
    b.append(art(c.id, c.locked));
    b.disabled = model.locked && !c.locked;
    b.addEventListener('click', () => onActivate(c.id));
    const pick = () => onSelect(c.id);
    b.addEventListener('focus', pick);
    b.addEventListener('mouseenter', pick);
    grid.append(b);
  });
  root.append(head, sockets, grid, detailOf(model, selected, compare));
  body.replaceChildren(root);
}

/** Keyboard while the tab is up. Confirm is the grid button's click (Enter / pad A). */
export function relicKey(code: string): 'compare' | 'jump' | 'equip' | null {
  if (code === 'KeyC') return 'compare';
  if (code === 'Tab') return 'jump';
  if (code === 'Enter' || code === 'KeyF') return 'equip';
  return null;
}

/** Pad face buttons that are not already menu confirm / back. */
export function relicPad(button: string): 'compare' | 'jump' | null {
  if (button === 'x') return 'compare';
  if (button === 'y') return 'jump';
  return null;
}
