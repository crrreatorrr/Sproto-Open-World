import { ITEMS, type ItemDef } from '../content/items';
import { staffCostMult } from '../content/packs/c2';
import { BRANCHES, PERKS, PERK_IDS, SKILLS, SKILL_MAX_RANK, branchTotal, hasPerk, RESPEC_SPROUTS_PER_LEVEL, type Branch } from '../content/progression';
import { SPELLS, type SpellId } from '../content/spells';
import type { UiAction } from '../sim/commands';
import type { Entity, Progress } from '../sim/entity';
import type { ReadonlySimView } from '../sim/view';
import { spellIcon } from './Hud';
import { mapSignature, renderMap } from './mapTab';
import type { MenuNav, Screen } from './MenuNav';
import { KIND_NAMES, SWAP_RULE, costText, gearCompare, inventoryGroups, itemStats, levelProgress, questLog, readyText, skillGain, staffTraitText, swapCooldown } from './rpgText';

export type MenuTab = 'powers' | 'skills' | 'gear' | 'quests' | 'map' | 'settings';

export const MENU_TABS: readonly { id: MenuTab; label: string }[] = [
  { id: 'powers', label: 'Powers' },
  { id: 'skills', label: 'Skills' },
  { id: 'gear', label: 'Gear' },
  { id: 'quests', label: 'Quests' },
  { id: 'map', label: 'Map' },
  { id: 'settings', label: 'Settings' },
];

/** What the menu reads and how it acts: the sim's view, the local player, the command queue. */
export interface GameMenuSource {
  view(): ReadonlySimView | null;
  player(): Readonly<Entity> | undefined;
  /** Queue a menu intent for the next tick (it rides a tick even while paused). */
  send(action: UiAction): void;
  /** Gear changes are refused right now (in combat, not at a shrine): ReadonlySimView.gearLocked. */
  gearLocked(): boolean;
  /** A prompt glyph on the active device (keys, or pad buttons). */
  prompt(keys: readonly string[], pad: readonly string[]): string;
  /** A spell slot's cast glyph (1, or LT + X). */
  slotGlyph(slot: number): string;
  resume(): void;
  quitToTitle(): void;
  /** Open today's settings screen (sliders, toggles, Controls) over the menu. */
  openSettings(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function button(html: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls);
  b.innerHTML = html;
  b.dataset.nav = '';
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A grid cell (MenuNav's 2-D mode). */
function cell<T extends HTMLElement>(e: T, x: number, y: number): T {
  e.dataset.gx = String(x);
  e.dataset.gy = String(y);
  return e;
}

const POWER_COLS = 4;

/**
 * The one tabbed menu (expansion plan §5): Powers (the spell selector), Skills (the Magic and Combat
 * tree), Gear (staff, robe, charm with compare deltas; the character's numbers), Quests, Map and
 * Settings. LB / RB or Q / E switch tabs; Powers and Skills are 2-D grids. It replaces the Character
 * and Quest log screens. Like every menu it only queues UiActions: the sim decides.
 */
export class GameMenu {
  readonly screen: Screen;
  private readonly el: HTMLElement;
  tab: MenuTab = 'powers';
  /** The spell selector's half-made choice: a slot picked (then a power), or a power picked (then a slot). */
  private pick: { slot: number } | { spell: SpellId | null } | null = null;
  private sig = '';

  constructor(host: HTMLElement, private readonly nav: MenuNav, private readonly src: GameMenuSource) {
    const root = el('div', 'menus game-menu-host');
    host.appendChild(root);
    this.el = el('section', 'screen rpg game-menu');
    this.el.id = 'screen-menu';
    root.appendChild(this.el);
    this.screen = {
      el: this.el,
      render: () => this.render(),
      onBack: () => this.back(),
      onTab: (dir) => this.switchTab(dir),
      focusKey: () => this.tab,
      grid: () => this.tab === 'powers' || this.tab === 'skills',
    };
  }

  /** Show the menu on a tab (Start: the last one; J / View: Quests; I: Gear; the shrine: Skills). */
  open(tab: MenuTab = this.tab): void {
    this.tab = tab;
    this.pick = null;
    this.sig = '';
  }

  /** The spell selector's pending pick (QA). */
  get pending(): string | null {
    const p = this.pick;
    if (!p) return null;
    return 'slot' in p ? `slot:${p.slot}` : `spell:${p.spell}`;
  }

  private switchTab(dir: -1 | 1): void {
    const i = MENU_TABS.findIndex((t) => t.id === this.tab);
    this.tab = MENU_TABS[(i + dir + MENU_TABS.length) % MENU_TABS.length].id;
    this.pick = null;
  }

  private back(): void {
    if (this.pick) {
      this.pick = null;
      this.nav.refresh();
      return;
    }
    if (this.nav.depth > 1) this.nav.pop();
    else this.src.resume();
  }

  /** Once per frame while the menu is on top: re-render when what it shows changed. */
  frame(): void {
    if (this.nav.top !== this.screen) return;
    const sig = this.signature();
    if (sig === this.sig) return;
    const first = this.sig === '';
    this.sig = sig;
    if (!first) this.nav.refresh();
  }

  private progress(): Readonly<Progress> | undefined {
    return this.src.player()?.progress;
  }

  /** What the open tab shows, and the glyphs of the device in use (they follow it while the menu is up). */
  private signature(): string {
    return `${this.src.prompt(['KeyQ'], ['lb'])}|${this.src.slotGlyph(0)}|${this.tabSignature()}`;
  }

  private tabSignature(): string {
    const e = this.src.player();
    const p = e?.progress;
    if (!p) return 'none';
    switch (this.tab) {
      case 'powers': {
        const cds = p.spells.map((s) => Math.ceil((e.combat?.cooldowns[s] ?? 0) / 60)).join(',');
        return `${p.loadout.join(',')}|${p.spells.join(',')}|${cds}|${p.atShrine}|${e.combat?.action?.kind}|${this.pending}`;
      }
      case 'skills':
        return `${p.points}|${JSON.stringify(p.skills)}|${p.sprouts}|${p.atShrine}|${p.level}`;
      case 'gear': {
        const v = e.vitals;
        return `${JSON.stringify(p.equipment)}|${JSON.stringify(p.inventory)}|${p.level}|${p.xp}|${p.points}|${v?.hpMax}|${v?.staminaMax}|${v?.manaMax}|${this.src.gearLocked()}`;
      }
      case 'quests':
        return `${p.tracked}|${JSON.stringify(p.quests)}`;
      case 'map':
        return e ? mapSignature(this.src.view(), e, p) : 'none';
      default:
        return 'settings';
    }
  }

  // --- Layout -----------------------------------------------------------------------------------

  private render(): void {
    this.sig = this.signature();
    const bar = el('div', 'tabs');
    bar.append(el('kbd', 'tab-key', this.src.prompt(['KeyQ'], ['lb'])));
    for (const t of MENU_TABS) {
      const d = el('div', `tab${t.id === this.tab ? ' active' : ''}`, t.label);
      d.dataset.tab = t.id;
      d.addEventListener('click', () => {
        if (t.id === this.tab) return;
        this.nav.retab(() => {
          this.tab = t.id;
          this.pick = null;
        });
      });
      bar.append(d);
    }
    bar.append(el('kbd', 'tab-key', this.src.prompt(['KeyE'], ['rb'])));
    const body = el('div', `tab-body tab-${this.tab}`);
    this.el.replaceChildren(bar, body);
    const p = this.progress();
    if (!p && this.tab !== 'settings') {
      body.append(el('p', 'note', 'Nothing to show here yet.'));
      return;
    }
    switch (this.tab) {
      case 'powers':
        return this.powers(body, p!);
      case 'skills':
        return this.skills(body, p!);
      case 'gear':
        return this.gear(body, p!);
      case 'quests':
        return this.quests(body, p!);
      case 'map':
        return renderMap(body, this.src.view(), this.src.player()!, p!, () => this.nav.retab(() => {
          this.tab = 'quests';
        }));
      case 'settings':
        return this.settings(body);
    }
  }

  // --- Powers (the spell selector) --------------------------------------------------------------

  private cooldown(spell: SpellId): number {
    return this.src.player()?.combat?.cooldowns[spell] ?? 0;
  }

  private equip(slot: number, spell: SpellId | null): void {
    this.pick = null;
    this.src.send({ kind: 'equipSpell', slot, spell });
    this.nav.refresh();
    this.nav.focusWhere((e) => e.dataset.slot === String(slot));
  }

  private powers(body: HTMLElement, p: Readonly<Progress>): void {
    const pick = this.pick;
    const casting = this.src.player()?.combat?.action?.kind === 'cast';
    body.append(el('h3', '', 'Loadout'));
    const slots = el('div', 'slot-row');
    p.loadout.forEach((id, i) => {
      const picked = !!pick && 'slot' in pick && pick.slot === i;
      const cd = id ? this.cooldown(id) : 0;
      const html = `<kbd>${this.src.slotGlyph(i)}</kbd>${spellIcon(id)}<span class="name">${id ? SPELLS[id].name : 'Empty'}</span><span class="state">${id ? readyText(cd) : '—'}</span>`;
      const b = cell(button(html, () => this.slotPressed(i), `btn slot-card${picked ? ' picked' : ''}${id ? '' : ' empty'}${cd > 0 ? ' cooling' : ''}`), i, 0);
      b.dataset.slot = String(i);
      slots.append(b);
    });
    body.append(slots);
    const hint = pick
      ? 'slot' in pick
        ? `Choose a power for slot ${pick.slot + 1}.`
        : `Choose a slot for ${pick.spell ? SPELLS[pick.spell].name : 'clearing'}.`
      : 'Pick a slot, then a power (or a power, then a slot).';
    body.append(el('p', 'note rule', p.atShrine ? 'You are at a shrine: swaps are free.' : SWAP_RULE), el('p', 'note pick', casting ? 'Finish casting to change powers.' : hint));
    body.append(el('h3', '', 'Powers you know'));
    const grid = el('div', 'power-grid');
    const known: (SpellId | null)[] = [...p.spells, null];
    known.forEach((id, k) => {
      const inSlot = id ? p.loadout.indexOf(id) : -1;
      const picked = !!pick && 'spell' in pick && pick.spell === id;
      let state: string;
      if (!id) state = 'Empty the slot';
      else if (inSlot >= 0) state = `In slot ${inSlot + 1} · ${readyText(this.cooldown(id))}`;
      else {
        const wait = swapCooldown(id, this.cooldown(id), !!p.atShrine);
        state = wait > 0 ? `Swap in: ${readyText(wait).toLowerCase()}` : 'Swap in: ready';
      }
      const def = id ? SPELLS[id] : null;
      const html = `${spellIcon(id)}<span class="name">${def?.name ?? 'Clear slot'}</span>${def ? `<span class="cost">${def.meter ? 'Uses the Surge meter' : `${costText(def.cost * staffCostMult(p.equipment.staff))} mana · ${(def.cooldown / 60).toFixed(def.cooldown % 60 ? 1 : 0)} s`}</span>` : ''}<span class="state">${state}</span>`;
      const b = cell(button(html, () => this.powerPressed(id), `btn power-card${picked ? ' picked' : ''}${inSlot >= 0 ? ' slotted' : ''}`), k % POWER_COLS, 1 + Math.floor(k / POWER_COLS));
      b.dataset.power = id ?? 'none';
      grid.append(b);
    });
    body.append(grid);
  }

  private slotPressed(slot: number): void {
    const pick = this.pick;
    if (pick && 'spell' in pick) return this.equip(slot, pick.spell);
    this.pick = pick && 'slot' in pick && pick.slot === slot ? null : { slot };
    this.nav.refresh();
    if (this.pick) this.nav.focusWhere((e) => e.dataset.power !== undefined);
  }

  private powerPressed(spell: SpellId | null): void {
    const pick = this.pick;
    if (pick && 'slot' in pick) return this.equip(pick.slot, spell);
    this.pick = pick && 'spell' in pick && pick.spell === spell ? null : { spell };
    this.nav.refresh();
    if (this.pick) {
      const p = this.progress();
      const at = spell && p ? p.loadout.indexOf(spell) : -1;
      const empty = p ? p.loadout.indexOf(null) : -1;
      const slot = at >= 0 ? at : empty >= 0 ? empty : 0;
      this.nav.focusWhere((e) => e.dataset.slot === String(slot));
    }
  }

  // --- Skills -----------------------------------------------------------------------------------

  private skills(body: HTMLElement, p: Readonly<Progress>): void {
    const pts = p.points;
    body.append(el('p', 'note points', pts > 0 ? `${pts} skill ${pts === 1 ? 'point' : 'points'} to spend` : 'No skill points to spend. Level up to earn 2.'));
    const tree = el('div', 'skill-tree');
    (['magic', 'combat'] as Branch[]).forEach((br, x) => {
      const col = el('div', `branch ${br}`);
      const total = branchTotal(p.skills, br);
      col.append(el('h3', '', `${BRANCHES[br].name} · ${total}`));
      BRANCHES[br].skills.forEach((id, y) => {
        const r = p.skills[id];
        const max = r >= SKILL_MAX_RANK;
        const pips = Array.from({ length: SKILL_MAX_RANK }, (_, i) => `<i class="${i < r ? 'on' : ''}"></i>`).join('');
        const html = `<span class="name">${SKILLS[id].name}</span><span class="rank">${r} / ${SKILL_MAX_RANK}</span><span class="pips">${pips}</span><span class="blurb">${max ? 'Highest rank' : `Next rank: ${skillGain(id)}`}</span>`;
        const b = cell(button(html, () => this.src.send({ kind: 'spendSkill', skill: id }), `btn skill${max ? ' max' : ''}${pts <= 0 ? ' poor' : ''}`), x, y);
        b.dataset.skill = id;
        col.append(b);
      });
      for (const k of PERK_IDS.filter((k) => PERKS[k].branch === br)) {
        const got = hasPerk(p.skills, k);
        const d = el('div', `perk${got ? ' got' : ''}`);
        d.innerHTML = `<span class="name">${PERKS[k].name}</span><span class="at">${got ? 'Unlocked' : `${BRANCHES[br].name} ${PERKS[k].at}`}</span><span class="blurb">${PERKS[k].text}</span>`;
        col.append(d);
      }
      tree.append(col);
    });
    body.append(tree);
    if (p.atShrine) {
      const cost = RESPEC_SPROUTS_PER_LEVEL * p.level;
      const b = cell(button(`<span class="name">Reset skills</span><span class="price">${cost} Sprouts</span><span class="blurb">Every rank back as points (you have ${p.sprouts}).</span>`, () => this.src.send({ kind: 'respecSkills' }), 'btn item-row respec'), 0, BRANCHES.magic.skills.length);
      body.append(b);
    } else body.append(el('p', 'hint', 'Spend points anywhere. Reset them at a shrine.'));
  }

  // --- Gear -------------------------------------------------------------------------------------

  private gear(body: HTMLElement, p: Readonly<Progress>): void {
    const e = this.src.player();
    const locked = this.src.gearLocked();
    const cols = el('div', 'columns');
    const stats = el('div', 'stats');
    const row = (k: string, val: string) => {
      const r = el('div', 'stat');
      r.append(el('span', 'k', k), el('span', 'v', val));
      return r;
    };
    const lp = levelProgress(p.level, p.xp);
    const v = e?.vitals;
    const def = e?.combat?.defense;
    stats.append(
      row('Level', String(p.level)),
      row('XP', lp.capped ? `${p.xp} (max level)` : `${lp.into} / ${lp.need}`),
      ...(p.points > 0 ? [row('Skill points', String(p.points))] : []),
      row('Health', String(v?.hpMax ?? '—')),
      row('Stamina', String(v?.staminaMax ?? '—')),
      row('Mana', String(v?.manaMax ?? '—')),
      row('Defense', def ? `${def.physical} physical · ${def.arcane} arcane` : '—'),
      row('Tonics', `${p.tonics.charges} / ${p.tonics.max}`),
      row('Sprouts', String(p.sprouts)),
    );
    const gear = el('div', 'gear');
    if (locked) gear.append(el('p', 'note locked', 'Locked in combat: gear changes 5 s after the last enemy loses interest, or at a shrine.'));
    const slot = (label: string, id: string | null) => row(label, id ? (ITEMS[id]?.name ?? id) : 'empty');
    gear.append(el('h3', '', 'Equipped'), slot('Staff', p.equipment.staff), slot('Robe', p.equipment.robe), slot('Charm', p.equipment.charm));
    const worn = (it: ItemDef) => (it.kind === 'staff' ? ITEMS[p.equipment.staff] : it.kind === 'robe' ? ITEMS[p.equipment.robe] : undefined);
    for (const g of inventoryGroups(p)) {
      gear.append(el('h3', '', KIND_NAMES[g.kind]));
      for (const it of g.items) {
        const equippable = g.kind === 'staff' || g.kind === 'robe' || g.kind === 'charm';
        const st = itemStats(it.item);
        const deltas = equippable && !it.equipped ? gearCompare(it.item, worn(it.item)) : [];
        const dl = deltas.length ? `<span class="deltas">${deltas.map((d) => `<b class="${d.delta > 0 ? 'up' : d.delta < 0 ? 'down' : 'same'}">${d.label} ${d.text}</b>`).join('')}</span>` : '';
        const action = it.equipped ? (g.kind === 'charm' ? 'Equipped · remove' : 'Equipped') : equippable ? (locked ? 'Locked' : 'Equip') : '';
        const trait = staffTraitText(it.item);
        const html = `<span class="name">${it.item.name}${it.count > 1 ? ` ×${it.count}` : ''}</span><span class="price">${action}</span><span class="blurb">${it.item.blurb}${st ? ` · ${st}` : ''}</span>${trait ? `<span class="trait">${trait}</span>` : ''}${dl}`;
        const canPress = equippable && (!it.equipped || g.kind === 'charm');
        if (canPress) {
          const b = button(html, () => this.src.send({ kind: 'equip', item: it.item.id }), `btn item-row ${it.item.rarity}${locked ? ' locked' : ''}${it.equipped ? ' equipped' : ''}`);
          b.dataset.item = it.item.id;
          gear.append(b);
        } else {
          const d = el('div', `item-row static ${it.item.rarity}${it.equipped ? ' equipped' : ''}`);
          d.innerHTML = html;
          gear.append(d);
        }
      }
    }
    cols.append(stats, gear);
    body.append(cols);
  }

  // --- Quests -----------------------------------------------------------------------------------

  private quests(body: HTMLElement, p: Readonly<Progress>): void {
    const list = el('div', 'list wide');
    const quests = questLog(p);
    if (!quests.length) list.append(el('p', 'note', 'No quests yet. Villagers may have work for you.'));
    for (const q of quests) {
      const tracked = q.status === 'active' && p.tracked === q.id;
      const lines = q.lines.map((l) => `<span class="obj${l.done ? ' done' : ''}">${l.text}</span>`).join('');
      const html = `<span class="name">${q.title}</span><span class="price">${q.status === 'complete' ? 'Complete' : tracked ? 'Tracked' : 'Track'}</span><span class="blurb">${q.step}</span>${lines}`;
      if (q.status === 'active') {
        const b = button(html, () => this.src.send({ kind: 'track', quest: q.id }), `btn item-row quest${tracked ? ' tracked' : ''}`);
        b.dataset.quest = q.id;
        list.append(b);
      } else {
        const d = el('div', 'item-row static quest complete');
        d.innerHTML = html;
        list.append(d);
      }
    }
    body.append(list);
  }

  // --- Settings ---------------------------------------------------------------------------------

  private settings(body: HTMLElement): void {
    const list = el('div', 'list');
    list.append(
      button('Resume', () => this.src.resume()),
      button('Settings', () => this.src.openSettings()),
      button('Quit to title', () => this.src.quitToTitle()),
    );
    body.append(list, el('p', 'hint', 'The game saves itself at shrines, on quest steps and level-ups.'));
  }
}
