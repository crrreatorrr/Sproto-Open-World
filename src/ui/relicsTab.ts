/**
 * The Relics tab (quest polish menu spec). It only queues UiActions. GameMenu wiring waits on
 * src/ui/gameMenu.ts (held until Rootdeep Quest 4 merges): add 'relics' between Gear and Quests,
 * render this panel, and let onBack / frame call RelicsPanel.first.
 *
 * 128 px icon masters are not in this build. Cards show the 24 px silhouette inside a rarity frame.
 */
import './relics.css';
import { relicCopy } from '../content/relicCopy';
import {
  GEAR_LOCK_TEXT, KEEPSAKES, RELIC_SOCKETS, TOTEM_SWAPPED_TEXT, badgeText, capBlockMessage, foundCount, keepsake, relicShortfall,
  type KeepsakeDef,
} from '../content/relics';
import { QUESTS } from '../content/quests';
import type { UiAction } from '../sim/commands';
import type { Progress } from '../sim/entity';
import { KEEPSAKE_ICONS } from './icons';

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
  won: string;
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

const cardOf = (def: KeepsakeDef, p: Progress, locked: boolean): RelicCardModel => {
  const r = p.relics;
  const owned = !!r?.owned.includes(def.id);
  const equipped = owned && (r?.sockets.includes(def.id) || r?.totem === def.id);
  const dim = owned && relicShortfall(def.id, r?.sockets ?? []) > 0;
  const text = relicCopy(def.id);
  return {
    id: def.id, kind: def.kind, rarity: def.rarity,
    name: owned ? def.name : '????',
    locked: !owned, equipped, effect: text?.effect ?? '', flavour: text?.flavour ?? '', clue: text?.clue ?? '', cap: text?.cap ?? null,
    badge: badgeText(def.ranked), won: `Won at: ${QUESTS[def.quest]?.title ?? def.quest}`, dim: dim && !locked,
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

const art = (id: string, locked: boolean): HTMLElement => {
  const d = el('span', `relic-art placeholder${locked ? ' locked' : ''}`);
  d.innerHTML = KEEPSAKE_ICONS[id] ?? '';
  return d;
};

/**
 * Builds the tab into `body`. `onAction` is the menu's send. Returns the selected id so a
 * re-render can keep it. Pad: confirm equips, compare shows both lines, jump moves between the
 * sockets and the grid. Those keys are handled by `relicKey`.
 */
export function renderRelics(
  body: HTMLElement,
  model: RelicsModel,
  selected: string | null,
  compare: string | null,
  onSelect: (id: string) => void,
  onReplace: (socket: number) => void,
): void {
  body.replaceChildren();
  const root = el('div', 'relics');
  const head = el('div', 'relic-head');
  head.append(el('span', '', 'Equipped relics'), el('span', '', `${model.found} found`));
  if (model.locked) root.append(el('p', 'note locked', GEAR_LOCK_TEXT));
  if (model.message) root.append(el('p', 'note', model.message));
  const sockets = el('div', 'relic-sockets');
  model.sockets.forEach((s, i) => {
    const b = el('button', `relic-socket${s ? ` filled ${s.rarity}` : ' plus'}`) as HTMLButtonElement;
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.gx = String(i);
    b.dataset.gy = '0';
    b.dataset.socket = String(i);
    if (s) {
      b.append(art(s.id, false));
      b.disabled = model.locked;
      b.addEventListener('click', () => onReplace(i));
    } else b.textContent = '+';
    sockets.append(b);
  });
  const totem = el('button', `relic-socket${model.totem ? ` filled ${model.totem.rarity}` : ' plus'}`) as HTMLButtonElement;
  totem.type = 'button';
  totem.dataset.nav = '';
  totem.dataset.gx = '3';
  totem.dataset.gy = '0';
  totem.dataset.totem = '';
  if (model.totem) totem.append(art(model.totem.id, false));
  else totem.textContent = '+';
  sockets.append(totem);
  const grid = el('div', 'relic-grid');
  model.cards.forEach((c, i) => {
    const b = el('button', `relic-card ${c.rarity}${c.equipped ? ' equipped' : ''}${c.locked ? ' locked' : ''}${c.dim ? ' dim' : ''}`) as HTMLButtonElement;
    b.type = 'button';
    b.dataset.nav = '';
    b.dataset.gx = String(i % 5);
    b.dataset.gy = String(1 + Math.floor(i / 5));
    b.dataset.id = c.id;
    b.append(art(c.id, c.locked), el('span', 'sr', c.name));
    b.disabled = model.locked && !c.locked;
    b.addEventListener('click', () => onSelect(c.id));
    b.addEventListener('mouseenter', () => onSelect(c.id));
    grid.append(b);
  });
  const detail = detailOf(model, selected, compare);
  root.append(head, sockets, grid, detail);
  body.append(root);
}

function detailOf(model: RelicsModel, selected: string | null, compare: string | null): HTMLElement {
  const box = el('div', 'relic-detail');
  const card = model.cards.find((c) => c.id === selected) ?? null;
  if (!card) {
    box.append(el('p', 'note', 'Choose a relic or a totem.'));
    return box;
  }
  const name = el('div', `name ${card.locked ? '' : card.rarity}`);
  name.append(el('span', '', card.name), el('span', 'rarity', card.locked ? '' : card.rarity));
  if (card.badge) name.append(el('span', 'relic-badge', card.badge));
  box.append(name);
  if (card.locked) {
    box.append(el('p', 'blurb', card.clue));
    return box;
  }
  const effect = el('p', `trait${card.dim ? ' dim' : ''}`, card.effect);
  box.append(effect, el('p', 'blurb', `"${card.flavour}"`), el('p', '', card.won));
  if (card.cap) box.append(el('p', '', card.cap));
  const def = keepsake(card.id);
  if (def?.bonus) box.append(el('p', '', def.bonus));
  if (compare) {
    const other = model.sockets[0];
    const row = el('div', 'relic-compare');
    row.append(el('p', 'trait', card.effect), el('p', 'trait', other?.effect ?? 'Empty socket.'));
    box.append(row);
  }
  return box;
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
