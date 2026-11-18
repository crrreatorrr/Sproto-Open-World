import { PLAYER_STATS } from '../../content/combat';
import { DIALOGUE, type DialogueNode } from '../../content/dialogue';
import { ENEMIES } from '../../content/enemies';
import { HEART_HEAL, INVENTORY_CAP, ITEMS, STARTING_GEAR, TONIC, type Slot } from '../../content/items';
import { DROPS, MERCHANTS } from '../../content/loot';
import { MOUNT } from '../../content/mounts';
import { NPCS } from '../../content/npcs';
import { OBJECTS, usedFlag } from '../../content/objects';
import { GROWTH, LEVEL_CAP, SKILL_EFFECT, SKILL_POINTS_PER_LEVEL, noSkills, xpForLevel } from '../../content/progression';
import { QUESTS, type Condition, type Effect, type Objective } from '../../content/quests';
import { SPELLS, defaultLoadout, type SpellId } from '../../content/spells';
import { BTN, type UiAction } from '../commands';
import { angleTo, flatDist } from '../combat/geometry';
import type { Entity, InteractKind, Progress, WorldState } from '../entity';
import type { SimEvent } from '../events';
import type { Vec3 } from '../math';
import { equipSpell, gearLocked, grantSkillPoints, learnIntoLoadout, respecSkills, spendSkill } from './loadout';
import { next as rngNext, range as rngRange, type RngState } from '../rng';
import { startDismount, startMount } from './riding';

/**
 * The RPG layer (plan §5): progression and derived stats, inventory and gear, loot and pickups,
 * the merchant, shrines, chests, NPC dialogue (the sim owns the cursor), triggers and the quest
 * runtime. Everything changes only through commands and this tick's events. Pure.
 */

export interface RpgCtx {
  now: number;
  entities: readonly Entity[];
  events: SimEvent[];
  world: WorldState;
  rng: RngState;
  /** Spawns a pickup entity (SimWorld owns ids). */
  spawnPickup(pos: Vec3, pickup: NonNullable<Entity['pickup']>): void;
}

// ---------------------------------------------------------------- progress and derived stats

export function newProgress(spells: SpellId[]): Progress {
  return {
    level: 1, xp: 0, skills: noSkills(), points: 0, sprouts: 0,
    equipment: { staff: STARTING_GEAR.staff, robe: STARTING_GEAR.robe, charm: STARTING_GEAR.charm },
    inventory: { [STARTING_GEAR.staff]: 1, [STARTING_GEAR.robe]: 1 },
    spells: [...spells], loadout: defaultLoadout(spells), tonics: { charges: TONIC.charges, max: TONIC.charges },
    quests: {}, tracked: null, lastShrine: null, discoveredShrines: [], dialogue: null, shop: null, atShrine: null,
  };
}

export const charmOf = (p: Progress) => (p.equipment.charm ? ITEMS[p.equipment.charm]?.charm : undefined);
export const staffOf = (p: Progress) => ITEMS[p.equipment.staff]?.staff ?? ITEMS[STARTING_GEAR.staff].staff!;

/** Re-derive max HP/stamina/mana, defense and tonic charges from level, skills and gear. */
export function recompute(e: Entity): void {
  const p = e.progress;
  const v = e.vitals;
  const c = e.combat;
  if (!p || !v || !c) return;
  const above = p.level - 1;
  const sk = p.skills;
  const hpMax = PLAYER_STATS.hp + GROWTH.hpPerLevel * above + SKILL_EFFECT.defenseHp * sk.defense;
  const stMax = PLAYER_STATS.stamina + GROWTH.staminaPerLevel * above + SKILL_EFFECT.staminaMax * sk.stamina;
  const mpMax = PLAYER_STATS.mana + GROWTH.manaPerLevel * above + SKILL_EFFECT.focusMana * sk.focus;
  // Growing a maximum grows the current value with it (a level-up feels like one).
  v.hp = Math.min(hpMax, v.hp + Math.max(0, hpMax - v.hpMax));
  v.stamina = Math.min(stMax, v.stamina + Math.max(0, stMax - v.staminaMax));
  v.mana = Math.min(mpMax, v.mana + Math.max(0, mpMax - v.manaMax));
  v.hpMax = hpMax;
  v.staminaMax = stMax;
  v.manaMax = mpMax;
  const robe = ITEMS[p.equipment.robe]?.robe ?? { physical: 0, arcane: 0 };
  const charm = charmOf(p);
  const vit = sk.defense * SKILL_EFFECT.defense;
  const k = charm?.defense ?? 1;
  c.defense = { physical: Math.round((robe.physical + vit) * k), arcane: Math.round((robe.arcane + vit) * k) };
  c.level = p.level;
  const max = TONIC.charges + (charm?.tonicCharges ?? 0) + (p.inventory.tonic_upgrade ? 1 : 0);
  p.tonics.charges = Math.min(max, p.tonics.charges + Math.max(0, max - p.tonics.max));
  p.tonics.max = max;
}

export function grantXp(ctx: RpgCtx, e: Entity, amount: number): void {
  const p = e.progress;
  if (!p || amount <= 0) return;
  p.xp += amount;
  ctx.events.push({ type: 'xp', entity: e.id, amount, total: p.xp });
  while (p.level < LEVEL_CAP && p.xp >= xpForLevel(p.level + 1)) {
    p.level++;
    p.points += SKILL_POINTS_PER_LEVEL;
    ctx.events.push({ type: 'levelUp', entity: e.id, level: p.level, points: SKILL_POINTS_PER_LEVEL });
  }
  recompute(e);
}

export function giveItem(ctx: RpgCtx, e: Entity, item: string, count = 1): boolean {
  const p = e.progress!;
  const def = ITEMS[item];
  if (!def) return false;
  const kinds = Object.keys(p.inventory).filter((k) => p.inventory[k] > 0).length;
  if (!p.inventory[item] && kinds >= INVENTORY_CAP) {
    ctx.events.push({ type: 'refused', entity: e.id, action: 'give', reason: 'Your bags are full.' });
    return false;
  }
  p.inventory[item] = (p.inventory[item] ?? 0) + count;
  ctx.events.push({ type: 'itemGained', entity: e.id, item, count });
  if (item === 'tonic_upgrade') recompute(e);
  return true;
}

function addSprouts(ctx: RpgCtx, e: Entity, amount: number): void {
  const p = e.progress!;
  p.sprouts += amount;
  ctx.events.push({ type: 'currency', entity: e.id, amount, total: p.sprouts });
}

// ---------------------------------------------------------------- conditions and effects

export function checkCondition(c: Condition, p: Progress, world: WorldState): boolean {
  if ('not' in c) return !checkCondition(c.not, p, world);
  if ('quest' in c) {
    const q = p.quests[c.quest];
    const status = q?.status ?? (QUESTS[c.quest]?.prereq?.every((x) => checkCondition(x, p, world)) === false ? 'locked' : 'available');
    if (status !== c.status) return false;
    return c.step === undefined || q?.step === c.step;
  }
  if ('flag' in c) return c.value === undefined ? (world.flags[c.flag] ?? 0) !== 0 : world.flags[c.flag] === c.value;
  return (p.inventory[c.hasItem] ?? 0) >= (c.count ?? 1);
}

export const checkAll = (cs: readonly Condition[] | undefined, p: Progress, world: WorldState) => !cs || cs.every((c) => checkCondition(c, p, world));

export function applyEffects(ctx: RpgCtx, e: Entity, effects: readonly Effect[] | undefined): void {
  const p = e.progress!;
  for (const fx of effects ?? []) {
    if ('give' in fx) giveItem(ctx, e, fx.give, fx.count ?? 1);
    else if ('xp' in fx) grantXp(ctx, e, fx.xp);
    else if ('learnSpell' in fx) {
      if (!p.spells.includes(fx.learnSpell)) {
        p.spells.push(fx.learnSpell);
        learnIntoLoadout(p, fx.learnSpell);
        ctx.events.push({ type: 'spellLearned', entity: e.id, spell: fx.learnSpell });
      }
    } else if ('setFlag' in fx) ctx.world.flags[fx.setFlag] = fx.value ?? 1;
    else if ('startQuest' in fx) startQuest(ctx, e, fx.startQuest);
    else if ('currency' in fx) addSprouts(ctx, e, fx.currency);
    else if ('openShop' in fx) p.shop = fx.openShop;
    else if ('spawnUnique' in fx) ctx.world.flags[`unique:${fx.spawnUnique}`] = 1;
    else if ('openGate' in fx) ctx.world.flags[`gate:${fx.openGate}`] = 1;
    else if ('skillPoints' in fx) grantSkillPoints(ctx, e, fx.skillPoints);
  }
}

// ---------------------------------------------------------------- quests

export function startQuest(ctx: RpgCtx, e: Entity, id: string): void {
  const p = e.progress!;
  const def = QUESTS[id];
  if (!def || p.quests[id]?.status === 'active' || p.quests[id]?.status === 'complete') return;
  p.quests[id] = { status: 'active', step: 0, progress: def.steps[0].objectives.map(() => 0) };
  p.tracked ??= id;
  ctx.events.push({ type: 'questStarted', entity: e.id, quest: id });
}

const target = (o: Objective) => (o.kind === 'kill' || o.kind === 'collect' || o.kind === 'feat' ? o.count : 1);

/** Match this tick's events against every active quest's current step; complete steps and quests. */
export function questTick(ctx: RpgCtx, e: Entity): void {
  const p = e.progress!;
  for (const [id, q] of Object.entries(p.quests)) {
    if (q.status !== 'active') continue;
    const def = QUESTS[id];
    // A completed step can complete the next on the same tick only through fresh events, so loop
    // while steps keep finishing (a collect step already satisfied by the inventory).
    for (let guard = 0; guard < def.steps.length && q.status === 'active'; guard++) {
      const step = def.steps[q.step];
      let changed = false;
      step.objectives.forEach((o, i) => {
        const before = q.progress[i];
        q.progress[i] = Math.min(target(o), before + countFor(o, ctx.events, e, ctx.entities));
        if (o.kind === 'collect') q.progress[i] = Math.min(target(o), p.inventory[o.item] ?? 0);
        // What the world already remembers counts, so doing things out of order never soft-locks a
        // quest: a chest opened or an object used before the quest, a unique killed before it.
        if (o.kind === 'interact' && ((ctx.world.flags[usedFlag(o.object)] ?? 0) !== 0 || ctx.world.openedChests.includes(o.object))) q.progress[i] = 1;
        if (o.kind === 'kill' && ctx.world.killedUniques.includes(o.tag)) q.progress[i] = o.count;
        if (q.progress[i] !== before) changed = true;
      });
      if (changed) ctx.events.push({ type: 'questProgress', entity: e.id, quest: id, step: q.step, progress: [...q.progress] });
      if (!step.objectives.every((o, i) => q.progress[i] >= target(o))) break;
      // Step done.
      for (const o of step.objectives) if (o.kind === 'collect' && o.consume) p.inventory[o.item] = Math.max(0, (p.inventory[o.item] ?? 0) - o.count);
      applyEffects(ctx, e, step.onComplete);
      q.step++;
      if (q.step >= def.steps.length) {
        q.status = 'complete';
        q.progress = [];
        if (p.tracked === id) p.tracked = Object.entries(p.quests).find(([k, s]) => k !== id && s.status === 'active')?.[0] ?? null;
        ctx.events.push({ type: 'questComplete', entity: e.id, quest: id });
        applyEffects(ctx, e, def.rewards);
      } else {
        q.progress = def.steps[q.step].objectives.map(() => 0);
        ctx.events.push({ type: 'questStep', entity: e.id, quest: id, step: q.step });
      }
    }
  }
}

function countFor(o: Objective, events: readonly SimEvent[], e: Entity, entities: readonly Entity[]): number {
  let n = 0;
  for (const ev of events) {
    switch (o.kind) {
      case 'kill':
        if (ev.type === 'death' && ev.killer === e.id) {
          const dead = entities.find((x) => x.id === ev.entity);
          const def = dead?.brain ? ENEMIES[dead.brain.def] : undefined;
          if (def && (def.id === o.tag || def.tags?.includes(o.tag))) n++;
        }
        break;
      case 'feat':
        if (o.feat === 'heavyHit' && ev.type === 'hit' && ev.attacker === e.id && ev.heavy) n++;
        else if (o.feat === 'perfectDodge' && ev.type === 'dodgePerfect' && ev.entity === e.id) n++;
        else if (o.feat === 'parry' && ev.type === 'parry' && ev.target === e.id) n++;
        break;
      case 'talk':
        if (ev.type === 'talk' && ev.entity === e.id && ev.npc === o.npc && (!o.node || ev.node === o.node)) n++;
        break;
      case 'reach':
        if (ev.type === 'trigger' && ev.entity === e.id && ev.trigger === o.trigger) n++;
        break;
      case 'interact':
        if (ev.type === 'interact' && ev.entity === e.id && ev.object === o.object) n++;
        break;
      case 'collect':
        break;
    }
  }
  return n;
}

// ---------------------------------------------------------------- interaction, dialogue, menus

const REACH = { npc: 2.6, shrine: 3, chest: 2.4, object: 2.4, mount: MOUNT.reach } as const;
const FRONT = (80 * Math.PI) / 180;

/** The nearest NPC, shrine or unopened chest within reach and roughly in front of the player. */
export function interactTarget(player: Entity, entities: readonly Entity[]): { e: Entity; id: string; kind: 'npc' | 'mount' | InteractKind; name: string } | null {
  if (player.riding && player.riding.state !== 'riding') return null;
  let best: { e: Entity; id: string; kind: 'npc' | 'mount' | InteractKind; name: string } | null = null;
  let bestD = Infinity;
  for (const e of entities) {
    let kind: 'npc' | 'mount' | InteractKind;
    let id: string;
    let name: string;
    if (e.npc) {
      kind = 'npc';
      id = e.npc.id;
      name = NPCS[id]?.name ?? id;
    } else if (e.mount) {
      if (e.mount.rider !== null || player.riding) continue;
      kind = 'mount';
      id = MOUNT.id;
      name = `Ride ${MOUNT.name}`;
    } else if (e.interactable && !(e.interactable.kind !== 'shrine' && e.interactable.used)) {
      kind = e.interactable.kind;
      id = e.interactable.id;
      name = kind === 'shrine' ? shrineName(id) : kind === 'object' ? `${OBJECTS[id]?.verb ?? 'Use'} ${OBJECTS[id]?.name ?? id}` : 'Old chest';
    } else continue;
    const d = flatDist(player.tf.pos, e.tf.pos);
    // An object can stand on top of its prop (the beacon, about 4 m above the ground around it).
    if (d > REACH[kind] || Math.abs(player.tf.pos.y - e.tf.pos.y) > (kind === 'object' ? 6 : 2.5)) continue;
    if (d > 0.8 && angleTo(player.tf.pos, player.tf.yaw, e.tf.pos) > FRONT) continue;
    if (d < bestD) {
      bestD = d;
      best = { e, id, kind, name };
    }
  }
  // In the saddle with nothing else in reach, the same button gets you down.
  if (!best && player.riding) {
    const bull = entities.find((x) => x.id === player.riding!.mount);
    if (bull) return { e: bull, id: MOUNT.id, kind: 'mount', name: 'Dismount' };
  }
  return best;
}

export const shrineName = (id: string) =>
  ({ shrine_first_light: 'Shrine of First Light', shrine_watchtower: 'Watchtower Shrine', shrine_quarry_gate: 'Quarry Gate Shrine' })[id] ?? 'Shrine';

/** The available choices on a node (conditions checked), with their index into node.choices. */
export function availableChoices(node: DialogueNode, p: Progress, world: WorldState): { index: number; text: string }[] {
  return (node.choices ?? []).flatMap((c, index) => (checkAll(c.if, p, world) ? [{ index, text: c.text }] : []));
}

function enterNode(ctx: RpgCtx, e: Entity, npc: string, nodeId: string | undefined): void {
  const p = e.progress!;
  const graph = DIALOGUE[NPCS[npc]?.dialogue ?? npc];
  const node = nodeId ? graph?.nodes[nodeId] : undefined;
  if (!graph || !node) {
    p.dialogue = null;
    ctx.events.push({ type: 'dialogueEnd', entity: e.id, npc });
    return;
  }
  p.dialogue = { npc, node: nodeId! };
  ctx.events.push({ type: 'talk', entity: e.id, npc, node: nodeId! });
  applyEffects(ctx, e, node.do);
}

function startTalk(ctx: RpgCtx, e: Entity, npc: string): void {
  const p = e.progress!;
  const graph = DIALOGUE[NPCS[npc]?.dialogue ?? npc];
  if (!graph) return;
  const entry = graph.entry.find((r) => checkAll(r.if, p, ctx.world));
  ctx.events.push({ type: 'interact', entity: e.id, object: npc, kind: 'npc' });
  enterNode(ctx, e, npc, entry?.node);
}

function choose(ctx: RpgCtx, e: Entity, choice: number): void {
  const p = e.progress!;
  if (!p.dialogue) return;
  const { npc, node: nodeId } = p.dialogue;
  const node = DIALOGUE[NPCS[npc]?.dialogue ?? npc]?.nodes[nodeId];
  if (!node) {
    p.dialogue = null;
    return;
  }
  if (node.choices?.length) {
    const c = node.choices[choice];
    // A forbidden or missing choice is refused (a client can't pick what its conditions hide).
    if (!c || !checkAll(c.if, p, ctx.world)) {
      ctx.events.push({ type: 'refused', entity: e.id, action: 'dialogueChoose', reason: 'That choice is not available.' });
      return;
    }
    applyEffects(ctx, e, c.do);
    enterNode(ctx, e, npc, c.next);
  } else enterNode(ctx, e, npc, node.next);
}

function openChest(ctx: RpgCtx, e: Entity, chest: Entity, contents: { items: { item: string; count: number }[]; sprouts?: number } | undefined): void {
  const ia = chest.interactable!;
  // A chest's contents are fixed and given once: with no room for them, it stays shut.
  const p = e.progress!;
  const held = Object.keys(p.inventory).filter((k) => p.inventory[k] > 0);
  const newKinds = new Set((contents?.items ?? []).map((i) => i.item).filter((i) => !(p.inventory[i] > 0)));
  if (held.length + newKinds.size > INVENTORY_CAP) {
    ctx.events.push({ type: 'refused', entity: e.id, action: 'interact', reason: 'Your bags are full.' });
    return;
  }
  ia.used = true;
  if (!ctx.world.openedChests.includes(ia.id)) ctx.world.openedChests.push(ia.id);
  ctx.events.push({ type: 'interact', entity: e.id, object: ia.id, kind: 'chest' });
  for (const it of contents?.items ?? []) giveItem(ctx, e, it.item, it.count);
  if (contents?.sprouts) addSprouts(ctx, e, contents.sprouts);
}

/** Use a one-use world object (M4): it stays used (a world flag) and applies its effects. */
function useObject(ctx: RpgCtx, e: Entity, obj: Entity): void {
  const ia = obj.interactable!;
  ia.used = true;
  ctx.world.flags[usedFlag(ia.id)] = 1;
  ctx.events.push({ type: 'interact', entity: e.id, object: ia.id, kind: 'object' });
  applyEffects(ctx, e, OBJECTS[ia.id]?.effects);
}

/**
 * Interact presses, potion presses and menu intents for one player. `chests` maps a chest id to
 * its contents. Returns true while the player is in a menu or talking (their gameplay input is
 * ignored this tick).
 */
export function playerRpg(ctx: RpgCtx, e: Entity, pressed: number, ui: readonly UiAction[], chests: ReadonlyMap<string, { items: { item: string; count: number }[]; sprouts?: number }>): boolean {
  const p = e.progress!;
  const dead = e.combat?.action?.kind === 'dead';
  for (const a of ui) {
    switch (a.kind) {
      case 'dialogueChoose':
        choose(ctx, e, a.choice);
        break;
      case 'buy':
        buy(ctx, e, a.merchant, a.item);
        break;
      case 'equip':
        equip(ctx, e, a.item);
        break;
      case 'equipSpell':
        equipSpell(ctx, e, a.slot, a.spell);
        break;
      case 'spendSkill':
        spendSkill(ctx, e, a.skill);
        break;
      case 'respecSkills':
        respecSkills(ctx, e);
        break;
      case 'rest':
        if (p.atShrine) rest(ctx, e, p.atShrine);
        break;
      case 'closeMenu':
        p.shop = null;
        p.atShrine = null;
        break;
      case 'track':
        if (p.quests[a.quest]?.status === 'active') p.tracked = a.quest;
        break;
    }
  }
  const busy = !!(p.dialogue || p.shop || p.atShrine);
  if (dead || busy) return busy;

  if (pressed & BTN.interact) {
    const t = interactTarget(e, ctx.entities);
    if (t?.kind === 'npc') startTalk(ctx, e, t.id);
    else if (t?.kind === 'chest') openChest(ctx, e, t.e, chests.get(t.id));
    else if (t?.kind === 'object') useObject(ctx, e, t.e);
    else if (t?.kind === 'mount') (e.riding ? startDismount : startMount)(ctx.events, e, t.e);
    else if (t?.kind === 'shrine') {
      if (!p.discoveredShrines.includes(t.id)) p.discoveredShrines.push(t.id);
      p.atShrine = t.id;
      ctx.events.push({ type: 'interact', entity: e.id, object: t.id, kind: 'shrine' });
    }
  }
  if ((pressed & BTN.potion) && !e.combat?.action) drinkTonic(ctx, e);
  return !!(p.dialogue || p.shop || p.atShrine);
}

function drinkTonic(ctx: RpgCtx, e: Entity): void {
  const p = e.progress!;
  if (p.tonics.charges <= 0) {
    ctx.events.push({ type: 'refused', entity: e.id, action: 'potion', reason: 'No tonics left. Rest at a shrine.' });
    return;
  }
  p.tonics.charges--;
  e.combat!.action = { kind: 'drink', t: 0, healPerTick: (e.vitals!.hpMax * TONIC.heal) / TONIC.healTicks };
  ctx.events.push({ type: 'drink', entity: e.id, charges: p.tonics.charges });
}

/** Rest: full health, mana and tonics, this shrine becomes the respawn point. */
export function rest(ctx: RpgCtx, e: Entity, shrine: string): void {
  const p = e.progress!;
  const v = e.vitals!;
  v.hp = v.hpMax;
  v.mana = v.manaMax;
  v.stamina = v.staminaMax;
  p.tonics.charges = p.tonics.max;
  p.lastShrine = shrine;
  if (!p.discoveredShrines.includes(shrine)) p.discoveredShrines.push(shrine);
  delete e.statuses;
  ctx.events.push({ type: 'shrineRest', entity: e.id, shrine });
  // Resting at a shrine also counts as interacting with it (the test quest's last step).
  ctx.events.push({ type: 'interact', entity: e.id, object: shrine, kind: 'shrine' });
}

function equip(ctx: RpgCtx, e: Entity, item: string): void {
  const p = e.progress!;
  const def = ITEMS[item];
  if (!def || !(p.inventory[item] > 0) || (def.kind !== 'staff' && def.kind !== 'robe' && def.kind !== 'charm')) {
    ctx.events.push({ type: 'refused', entity: e.id, action: 'equip', reason: "You don't have that." });
    return;
  }
  // Gear changes only out of combat, or at a shrine (expansion plan §1.1).
  if (gearLocked(e, ctx.now)) {
    ctx.events.push({ type: 'refused', entity: e.id, action: 'equip', reason: "You can't change gear in combat." });
    return;
  }
  const slot = def.kind as Slot;
  // Toggling a charm off: equipping the one already worn removes it.
  if (slot === 'charm' && p.equipment.charm === item) p.equipment.charm = null;
  else p.equipment[slot] = item as never;
  recompute(e);
  ctx.events.push({ type: 'equip', entity: e.id, item, slot });
}

function buy(ctx: RpgCtx, e: Entity, merchant: string, item: string): void {
  const p = e.progress!;
  const m = MERCHANTS[merchant];
  const refuse = (reason: string): void => {
    ctx.events.push({ type: 'refused', entity: e.id, action: 'buy', reason });
  };
  if (!m || p.shop !== merchant) return refuse('That shop is not open.');
  const stock = m.stock[item] ?? 0;
  const key = `bought:${merchant}:${item}`;
  const sold = ctx.world.flags[key] ?? 0;
  if (sold >= stock) return refuse('Sold out.');
  const price = ITEMS[item]?.price ?? 0;
  if (p.sprouts < price) return refuse('Not enough Sprouts.');
  if (!giveItem(ctx, e, item, 1)) return;
  p.sprouts -= price;
  ctx.world.flags[key] = sold + 1;
  ctx.events.push({ type: 'bought', entity: e.id, merchant, item, price });
}

// ---------------------------------------------------------------- loot, pickups, triggers

const PICKUP_LIFE = 60 * 60;
const PICKUP_RADIUS = 1.3;

/** Drops for a kill (rng stream `loot`), XP to the killer. */
export function onKill(ctx: RpgCtx, killer: Entity, dead: Entity): void {
  const def = dead.brain ? ENEMIES[dead.brain.def] : undefined;
  if (!def || !killer.progress) return;
  grantXp(ctx, killer, def.xp);
  const table = DROPS[def.id];
  if (!table) return;
  const at = (k: number) => ({ x: dead.tf.pos.x + Math.cos(k * 2.1) * 0.6, y: dead.tf.pos.y + 0.3, z: dead.tf.pos.z + Math.sin(k * 2.1) * 0.6 });
  ctx.spawnPickup(at(0), { kind: 'sprouts', amount: rngRange(ctx.rng, table.sprouts[0], table.sprouts[1]), life: PICKUP_LIFE });
  if (rngNext(ctx.rng) < table.heartChance) ctx.spawnPickup(at(1), { kind: 'heart', amount: 1, life: PICKUP_LIFE });
  let k = 2;
  for (const it of table.items ?? []) if (rngNext(ctx.rng) < it.chance) ctx.spawnPickup(at(k++), { kind: 'item', item: it.item, amount: 1, life: PICKUP_LIFE });
}

/** Walk over a pickup to take it; old ones fade. Returns the ids to remove. */
export function pickups(ctx: RpgCtx): number[] {
  const gone: number[] = [];
  const players = ctx.entities.filter((e) => e.progress && e.combat?.action?.kind !== 'dead');
  for (const e of ctx.entities) {
    const pk = e.pickup;
    if (!pk) continue;
    const who = players.find((p) => flatDist(p.tf.pos, e.tf.pos) <= PICKUP_RADIUS && Math.abs(p.tf.pos.y - e.tf.pos.y) < 2);
    if (who) {
      if (pk.kind === 'sprouts') addSprouts(ctx, who, pk.amount);
      else if (pk.kind === 'heart') who.vitals!.hp = Math.min(who.vitals!.hpMax, who.vitals!.hp + who.vitals!.hpMax * HEART_HEAL);
      else if (pk.item && !giveItem(ctx, who, pk.item, pk.amount)) continue;
      ctx.events.push({ type: 'pickup', entity: who.id, kind: pk.kind, item: pk.item, amount: pk.amount });
      gone.push(e.id);
    } else if (--pk.life <= 0) gone.push(e.id);
  }
  return gone;
}

/** Trigger volumes: an event when a player enters (not every tick while inside). */
export function triggers(ctx: RpgCtx, list: readonly { id: string; pos: [number, number, number]; radius: number; halfHeight?: number }[], inside: Set<string>): void {
  for (const e of ctx.entities) {
    if (!e.progress) continue;
    for (const t of list) {
      const key = `${e.id}:${t.id}`;
      // A vertical cylinder: height only counts when the trigger says so (M4 volumes sit on terrain).
      const inNow = Math.hypot(e.tf.pos.x - t.pos[0], e.tf.pos.z - t.pos[2]) <= t.radius && (t.halfHeight === undefined || Math.abs(e.tf.pos.y - t.pos[1]) < t.halfHeight);
      if (inNow && !inside.has(key)) {
        inside.add(key);
        ctx.events.push({ type: 'trigger', entity: e.id, trigger: t.id });
      } else if (!inNow) inside.delete(key);
    }
  }
}

/** Spells the player may cast (learned ones only). */
export const knowsSpell = (e: Entity, spell: SpellId) => !e.progress || e.progress.spells.includes(spell);

export const ALL_SPELLS = Object.keys(SPELLS) as SpellId[];
