import { DIALOGUE, type DialogueNode } from '../content/dialogue';
import { NPCS } from '../content/npcs';
import type { UiAction } from '../sim/commands';
import type { Entity, Progress } from '../sim/entity';
import type { SimEvent } from '../sim/events';
import type { ReadonlySimView } from '../sim/view';
import type { MenuNav, Screen } from './MenuNav';
import type { MenuTab } from './gameMenu';
import { itemStats, shopStock } from './rpgText';

/** What the RPG menus read and how they act: the sim's view, the local player, and the command queue. */
export interface RpgSource {
  view(): ReadonlySimView | null;
  player(): Readonly<Entity> | undefined;
  /** The choices on the player's current dialogue node (ReadonlySimView.dialogueChoices). */
  choices(): { index: number; text: string }[];
  /** Queue a menu intent for the next tick (CommandBuilder.queueUi). */
  send(action: UiAction): void;
  /** The prompt glyph for the interact action on the active device ("F", "Y", "△"). */
  interactGlyph(): string;
  /** Open the tabbed menu over this one, on a tab (the shrine's Skills and Powers). */
  openMenu(tab: MenuTab): void;
}

/** Typewriter speed (characters per second). */
const TYPE_CPS = 60;
/** A sent choice waits this long (s) for the sim to move the cursor before another may be sent. */
const PENDING_SEC = 0.6;

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text) e.textContent = text;
  return e;
};

function button(label: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  const b = el('button', cls, label);
  b.dataset.nav = '';
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** "shrine_first_light" → "First Light Shrine": a fallback when the sim hasn't named it. */
function shrineFallbackName(id: string): string {
  const words = id.replace(/^shrine_/, '').split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return `${words.join(' ')} Shrine`;
}

/**
 * The RPG menus the sim opens (plan §5): dialogue, the merchant's shop and the shrine (Rest, Skills,
 * Powers), by setting `progress.dialogue`, `.shop` or `.atShrine`. The player's own screens are the
 * tabbed GameMenu. Every one works by pad: MenuNav moves the focus, A confirms, B backs out. They
 * act only by queueing UiActions; the sim validates and applies them.
 */
export class RpgMenus {
  readonly dialogue: Screen;
  readonly shop: Screen;
  readonly shrine: Screen;
  private readonly root: HTMLElement;
  /** The dialogue on screen: its node key, full text, and how much has typed out. */
  private talk = { key: '', text: '', shown: 0, typing: false };
  private talkText: HTMLElement | null = null;
  private pendingFor = 0;
  /** Each screen's last data signature: a change re-renders it, keeping focus. */
  private sigs = new Map<Screen, string>();
  /** Names the sim gave shrines (from its interact prompt), for the shrine menu's title. */
  private readonly shrineNames = new Map<string, string>();
  private shrineNote = '';

  constructor(host: HTMLElement, private readonly nav: MenuNav, private readonly src: RpgSource) {
    this.root = el('div', 'menus rpg-menus');
    host.appendChild(this.root);
    this.dialogue = this.makeDialogue();
    this.shop = this.makeShop();
    this.shrine = this.makeShrine();
  }

  /** The sim menu the player's progress asks for: dialogue first, then the shop, then the shrine. */
  wanted(p: Readonly<Progress> | undefined): Screen | null {
    if (!p) return null;
    if (p.dialogue) return this.dialogue;
    if (p.shop) return this.shop;
    if (p.atShrine) return this.shrine;
    return null;
  }

  /** Remember what the sim calls a shrine (the interact prompt carries its name). */
  nameShrine(id: string, name: string): void {
    this.shrineNames.set(id, name);
  }

  /** Once per rendered frame while an RPG screen is on top: typewriter, and re-render on change. */
  frame(dt: number): void {
    const top = this.nav.top;
    if (!top) return;
    this.pendingFor = Math.max(0, this.pendingFor - dt);
    if (top === this.dialogue) this.typeFrame(dt);
    const sig = this.signature(top);
    if (sig === null) return;
    const before = this.sigs.get(top);
    if (before === sig) return;
    this.sigs.set(top, sig);
    if (before === undefined) return;
    this.nav.refresh();
    // A new dialogue node starts with its first choice focused.
    if (top === this.dialogue) this.nav.focus(0);
  }

  /** F / pad Y in a dialogue: finish the line, or continue when there is nothing to choose. */
  interactPressed(): void {
    if (this.nav.top !== this.dialogue) return;
    if (this.talk.typing) return this.finishTyping();
    if (this.src.choices().length === 0) this.choose(0);
  }

  /** Sim events the menus show: a rest's note, a refusal cancels a pending choice. */
  event(e: SimEvent): void {
    if (e.type === 'shrineRest') {
      this.shrineNote = 'You rest. Health and tonics restored; you will return here if you fall.';
      if (this.nav.top === this.shrine) this.nav.refresh();
    } else if (e.type === 'refused') this.pendingFor = 0;
  }

  /** A sim menu just opened: forget the last one's state. */
  opened(s: Screen): void {
    if (s === this.dialogue) this.talk = { key: '', text: '', shown: 0, typing: false };
    if (s === this.shrine) this.shrineNote = '';
    this.sigs.delete(s);
    this.pendingFor = 0;
  }

  // --- Data -------------------------------------------------------------------------------------

  private progress(): Readonly<Progress> | undefined {
    return this.src.player()?.progress;
  }

  private node(): { node: DialogueNode | undefined; key: string; npc: string } | null {
    const d = this.progress()?.dialogue;
    if (!d) return null;
    const graph = DIALOGUE[NPCS[d.npc]?.dialogue ?? d.npc];
    return { node: graph?.nodes[d.node], key: `${d.npc}:${d.node}`, npc: d.npc };
  }

  private signature(s: Screen): string | null {
    const p = this.progress();
    if (!p) return null;
    switch (s) {
      case this.dialogue:
        return `${this.node()?.key}|${this.src.choices().map((c) => c.index).join(',')}`;
      case this.shop: {
        const flags = this.src.view()?.world.flags ?? {};
        return `${p.shop}|${p.sprouts}|${JSON.stringify(flags)}|${JSON.stringify(p.inventory)}`;
      }
      case this.shrine:
        return `${p.atShrine}|${p.points}|${this.shrineNote}`;
      default:
        return null;
    }
  }

  private choose(index: number): void {
    if (this.pendingFor > 0) return;
    this.pendingFor = PENDING_SEC;
    this.src.send({ kind: 'dialogueChoose', choice: index });
  }

  private screen(id: string, cls = ''): HTMLElement {
    const s = el('section', `screen${cls ? ` ${cls}` : ''}`);
    s.id = id;
    this.root.appendChild(s);
    return s;
  }

  // --- Dialogue ---------------------------------------------------------------------------------

  private makeDialogue(): Screen {
    const s = this.screen('screen-dialogue', 'dialogue');
    const render = () => {
      const n = this.node();
      const panel = el('div', 'dialogue-panel');
      const text = n?.node?.text ?? '…';
      if (n && n.key !== this.talk.key) this.talk = { key: n.key, text, shown: 0, typing: true };
      panel.append(el('div', 'speaker', n?.node?.speaker ?? NPCS[n?.npc ?? '']?.name ?? ''));
      this.talkText = el('p', 'line');
      this.talkText.textContent = this.talk.typing ? text.slice(0, Math.floor(this.talk.shown)) : text;
      panel.append(this.talkText);
      const list = el('div', 'list choices');
      const choices = this.src.choices();
      if (choices.length) {
        for (const c of choices) list.append(button(c.text, () => (this.talk.typing ? this.finishTyping() : this.choose(c.index)), 'btn choice'));
      } else {
        // No choices: continue to the next line, or end the talk.
        const last = !n?.node?.next;
        list.append(button(last ? 'Farewell' : 'Continue', () => (this.talk.typing ? this.finishTyping() : this.choose(0)), 'btn choice continue'));
      }
      panel.append(list, el('p', 'hint', `${this.src.interactGlyph()} or confirm to continue · back to leave`));
      s.replaceChildren(panel);
    };
    return { el: s, render, onBack: () => this.src.send({ kind: 'closeMenu' }) };
  }

  private typeFrame(dt: number): void {
    const t = this.talk;
    if (!t.typing || !this.talkText) return;
    t.shown += dt * TYPE_CPS;
    if (t.shown >= t.text.length) return this.finishTyping();
    this.talkText.textContent = t.text.slice(0, Math.floor(t.shown));
  }

  private finishTyping(): void {
    this.talk.typing = false;
    this.talk.shown = this.talk.text.length;
    if (this.talkText) this.talkText.textContent = this.talk.text;
  }

  /** The dialogue line is still typing out (QA). */
  get typing(): boolean {
    return this.talk.typing;
  }

  // --- Shop -------------------------------------------------------------------------------------

  private makeShop(): Screen {
    const s = this.screen('screen-shop', 'rpg');
    const render = () => {
      const p = this.progress();
      const merchant = p?.shop ?? '';
      const flags = this.src.view()?.world.flags ?? {};
      s.replaceChildren(el('h2', '', NPCS[merchant]?.name ?? 'Merchant'), el('p', 'note sprout-count', `Your Sprouts: ${p?.sprouts ?? 0}`));
      const list = el('div', 'list wide');
      for (const line of shopStock(merchant, flags)) {
        const stats = itemStats(line.item);
        const sold = line.left <= 0;
        const poor = !sold && (p?.sprouts ?? 0) < line.price;
        const b = button('', () => this.src.send({ kind: 'buy', merchant, item: line.item.id }), `btn item-row ${line.item.rarity}${poor ? ' poor' : ''}`);
        b.innerHTML = `<span class="name">${line.item.name}</span><span class="price">${sold ? 'Sold out' : `${line.price} Sprouts`}</span><span class="blurb">${line.item.blurb}${stats ? ` · ${stats}` : ''}</span>`;
        b.dataset.item = line.item.id;
        if (sold) b.disabled = true;
        list.append(b);
      }
      list.append(button('Leave', () => this.src.send({ kind: 'closeMenu' })));
      s.append(list);
    };
    return { el: s, render, onBack: () => this.src.send({ kind: 'closeMenu' }) };
  }

  // --- Shrine -----------------------------------------------------------------------------------

  private makeShrine(): Screen {
    const s = this.screen('screen-shrine', 'rpg');
    const render = () => {
      const p = this.progress();
      const id = p?.atShrine ?? '';
      s.replaceChildren(el('h2', '', this.shrineNames.get(id) ?? shrineFallbackName(id)));
      if (this.shrineNote) s.append(el('p', 'note', this.shrineNote));
      const list = el('div', 'list');
      const points = p?.points ?? 0;
      list.append(
        button('Rest', () => this.src.send({ kind: 'rest' })),
        button(points > 0 ? `Skills (${points} ${points === 1 ? 'point' : 'points'})` : 'Skills', () => this.src.openMenu('skills')),
        button('Powers (free swaps here)', () => this.src.openMenu('powers')),
        button('Leave', () => this.src.send({ kind: 'closeMenu' })),
      );
      s.append(list);
    };
    return { el: s, render, onBack: () => this.src.send({ kind: 'closeMenu' }) };
  }
}
