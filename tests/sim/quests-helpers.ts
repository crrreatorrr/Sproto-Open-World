import fs from 'node:fs';
import path from 'node:path';
import { DIALOGUE } from '../../src/content/dialogue';
import { ENEMIES } from '../../src/content/enemies';
import { NPCS } from '../../src/content/npcs';
import { QUESTS, type Objective } from '../../src/content/quests';
import { cellColliders, decodeCellBin } from '../../src/content/world/codec';
import type { CellColliders, CellData, RegionManifest } from '../../src/content/world/format';
import { worldLevel } from '../../src/content/world/level';
import { SPROUTVALE_CONTENT } from '../../src/content/world/sproutvaleContent';
import type { SaveFile } from '../../src/save/schema';
import { BTN, idleInput, type InputCommand } from '../../src/sim/commands';
import type { Entity, Progress } from '../../src/sim/entity';
import type { SimEvent } from '../../src/sim/events';
import { initPhysics } from '../../src/sim/physics/PhysicsWorld';
import { SimWorld } from '../../src/sim/SimWorld';

/**
 * Plays quests on the real baked Sproutvale by commands. Teleports stand in for walking and enemies
 * are finished with a Burn in the player's name (the fights have their own tests); talking, using
 * things, standing in volumes and picking things up all go through the same commands the game sends.
 */
const PUBLIC = path.resolve(__dirname, '../../public');
const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'world/sproutvale/region.json'), 'utf8')) as RegionManifest;
const baked: CellColliders[] = manifest.cells.map((c) => {
  const { heights } = decodeCellBin(fs.readFileSync(path.join(PUBLIC, c.bin)), manifest.heightRange);
  return cellColliders(JSON.parse(fs.readFileSync(path.join(PUBLIC, c.json), 'utf8')) as CellData, heights, manifest);
});

/** A world on the baked terrain with every cell built and every placement settled. */
export async function bakedWorld(seed = 1, save?: SaveFile): Promise<SimWorld> {
  await initPhysics();
  const w = new SimWorld(worldLevel(manifest), seed);
  w.spawnPlayer(0);
  for (const c of baked) w.loadCell(c);
  for (let i = 0; i < 4000 && manifest.cells.some((c) => !w.cellReady(c.cx, c.cz)); i++) w.tick(new Map([[0, idleInput(0)]]));
  w.populateWorld(SPROUTVALE_CONTENT);
  if (save) w.applySave(save);
  for (let i = 0; i < 3; i++) w.tick(new Map([[0, idleInput(0)]]));
  return w;
}

/** Save and load into a fresh world, as closing the tab and coming back does. */
export async function reload(w: SimWorld, seed = 1): Promise<SimWorld> {
  const save = JSON.parse(JSON.stringify(w.toSave({ savedAt: 'test', build: 'test', region: 'sproutvale' }))) as SaveFile;
  w.dispose();
  return bakedWorld(seed, save);
}

export const prog = (w: SimWorld): Progress => w.playerEntity(0)!.progress!;
export const statusOf = (w: SimWorld, q: string) => prog(w).quests[q]?.status;
const alive = (e: Entity) => e.combat?.action?.kind !== 'dead';

/** One tick, with the player kept healthy: these runs are about quests, not fights. */
export function tick(w: SimWorld, c: InputCommand = idleInput(0)): SimEvent[] {
  w.tick(new Map([[0, c]]));
  const p = w.playerEntity(0)!;
  p.vitals!.hp = p.vitals!.hpMax;
  return w.events;
}

function press(buttons: number): InputCommand {
  const c = idleInput(w0Yaw);
  c.pressed = c.held = buttons;
  return c;
}
let w0Yaw = 0;

const groundAt = (w: SimWorld, x: number, z: number) => w.physics.raycast({ x, y: 200, z }, { x: 0, y: -1, z: 0 }, 400)?.point.y ?? null;

/** Stand on the ground at (x, z). */
export function standAt(w: SimWorld, x: number, z: number): void {
  const y = groundAt(w, x, z);
  if (y === null) throw new Error(`no ground at ${x}, ${z}`);
  w.teleportPlayer(0, { x, y: y + 0.05, z });
}

/** Walk up to a thing and face it, somewhere it can actually be used from. */
export function standBy(w: SimWorld, id: string): void {
  const at = w.locate(id);
  if (!at) throw new Error(`nothing called ${id}`);
  const p = w.playerEntity(0)!;
  for (const r of [1.6, 2, 2.3]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      const x = at.x + Math.sin(a) * r, z = at.z + Math.cos(a) * r;
      standAt(w, x, z);
      p.tf.yaw = p.tf.prevYaw = Math.atan2(at.x - x, at.z - z);
      w0Yaw = p.tf.yaw;
      tick(w, idleInput(w0Yaw));
      p.tf.yaw = p.tf.prevYaw = Math.atan2(at.x - p.tf.pos.x, at.z - p.tf.pos.z);
      if (w.view().interactTarget(0)?.id === id) return;
    }
  }
  throw new Error(`${id} can't be used from anywhere around it`);
}

/** Talk to an NPC to the end, taking the choice that starts `start` when one is offered. */
export function talk(w: SimWorld, npc: string, start?: string): SimEvent[] {
  const out: SimEvent[] = [];
  standBy(w, npc);
  out.push(...tick(w, press(BTN.interact)));
  const graph = DIALOGUE[NPCS[npc].dialogue];
  for (let i = 0; i < 12 && prog(w).dialogue; i++) {
    const node = graph.nodes[prog(w).dialogue!.node];
    const open = w.view().dialogueChoices(0);
    const pick = open.find((c) => node.choices?.[c.index].do?.some((fx) => 'startQuest' in fx && fx.startQuest === start)) ?? open[0];
    const c = idleInput(w0Yaw);
    c.ui = [{ kind: 'dialogueChoose', choice: pick?.index ?? 0 }];
    out.push(...tick(w, c));
  }
  if (prog(w).dialogue) throw new Error(`the talk with ${npc} never ends (at ${prog(w).dialogue!.node})`);
  if (prog(w).shop) closeMenu(w);
  return out;
}

function closeMenu(w: SimWorld): void {
  const c = idleInput(w0Yaw);
  c.ui = [{ kind: 'closeMenu' }];
  tick(w, c);
}

/** Open Trader Pepe's shop, buy one thing, and close it again. */
export function buy(w: SimWorld, item: string): SimEvent[] {
  standBy(w, 'merchant_village');
  const out = [...tick(w, press(BTN.interact))];
  const open = idleInput(w0Yaw);
  open.ui = [{ kind: 'dialogueChoose', choice: 0 }];
  out.push(...tick(w, open));
  const c = idleInput(w0Yaw);
  c.ui = [{ kind: 'buy', merchant: 'merchant_village', item }];
  out.push(...tick(w, c));
  closeMenu(w);
  return out;
}

export function use(w: SimWorld, id: string): SimEvent[] {
  standBy(w, id);
  return [...tick(w, press(BTN.interact))];
}

/** Rest at a shrine: the camps come back. */
export function rest(w: SimWorld, shrine: string): SimEvent[] {
  const out = use(w, shrine);
  const c = idleInput(w0Yaw);
  c.ui = [{ kind: 'rest' }];
  out.push(...tick(w, c));
  closeMenu(w);
  return out;
}

export function reach(w: SimWorld, trigger: string): SimEvent[] {
  const at = w.locate(trigger);
  if (!at) throw new Error(`no trigger ${trigger}`);
  standAt(w, at.x, at.z);
  return [...tick(w), ...tick(w)];
}

/** The player falls and gets back up at the last shrine. */
export function die(w: SimWorld): void {
  const p = w.playerEntity(0)!;
  p.vitals!.hp = 0.001;
  p.statuses = { burn: { ticks: 10, perTick: 1, source: p.id } };
  for (let i = 0; i < 600; i++) {
    w.tick(new Map([[0, idleInput(0)]]));
    if (w.events.some((e) => e.type === 'respawn' && e.entity === p.id)) return;
  }
  throw new Error('the player never got back up');
}

/** Finish an enemy with a Burn in the player's name, then walk over what it dropped (unless `leaveLoot`). */
export function slay(w: SimWorld, e: Entity, leaveLoot = false): SimEvent[] {
  const p = w.playerEntity(0)!;
  e.vitals!.hp = 0.001;
  e.statuses = { ...e.statuses, burn: { ticks: 10, perTick: 1, source: p.id } };
  const out: SimEvent[] = [];
  for (let i = 0; i < 5 && alive(e); i++) out.push(...tick(w));
  if (alive(e)) throw new Error(`could not finish ${e.brain?.def}`);
  for (let i = 0; i < 2; i++) out.push(...tick(w));
  if (leaveLoot) return out;
  for (const pk of w.entities.filter((x) => x.pickup)) {
    w.teleportPlayer(0, { ...pk.tf.pos });
    out.push(...tick(w));
  }
  return out;
}

const matches = (e: Entity, tag: string) => {
  const def = ENEMIES[e.brain!.def];
  return def.id === tag || !!def.tags?.includes(tag);
};

/** Kill one living enemy matching `tag`, resting at a shrine to bring the camps back if none is left. */
export function hunt(w: SimWorld, tag: string, leaveLoot = false): SimEvent[] {
  const find = () => w.entities.find((e) => e.brain && alive(e) && matches(e, tag) && !e.brain.summoned && !e.brain.held);
  let target = find();
  const out: SimEvent[] = [];
  if (!target) {
    out.push(...rest(w, 'shrine_first_light'));
    target = find();
  }
  if (!target) throw new Error(`no ${tag} left in the world, even after a rest`);
  standAt(w, target.brain!.home.x + 5, target.brain!.home.z + 5);
  if (tag === 'wisp') return [...out, ...tick(w), ...spellSlay(w, target, leaveLoot)];
  if (tag === 'bramble_colossus') {
    target.combat!.action = { kind: 'stagger', t: 0, dur: 80, reason: 'broken' };
    target.brain!.wasStaggered = true;
  }
  return [...out, ...tick(w), ...slay(w, target, leaveLoot)];
}

/** Wisps only drop Thorn Seeds to a spell, so the play-through finishes them with Bolt. */
function spellSlay(w: SimWorld, e: Entity, leaveLoot: boolean): SimEvent[] {
  const p = w.playerEntity(0)!;
  e.vitals!.hp = 1;
  p.vitals!.mana = p.vitals!.manaMax;
  standAt(w, e.tf.pos.x, e.tf.pos.z + 2);
  p.tf.yaw = p.tf.prevYaw = Math.atan2(e.tf.pos.x - p.tf.pos.x, e.tf.pos.z - p.tf.pos.z);
  const out: SimEvent[] = [];
  for (let i = 0; i < 40 && alive(e); i++) {
    p.vitals!.mana = p.vitals!.manaMax;
    const c = idleInput(p.tf.yaw);
    if (!p.combat?.action) {
      c.pressed = BTN.spell1;
      c.held = BTN.spell1;
    }
    out.push(...tick(w, c));
  }
  if (alive(e)) throw new Error('the spell did not fell the Wisp');
  if (leaveLoot) return out;
  for (const pk of w.entities.filter((x) => x.pickup)) {
    w.teleportPlayer(0, { ...pk.tf.pos });
    out.push(...tick(w));
  }
  return out;
}

/** Where a collect objective's item comes from. */
const SOURCES: Record<string, string> = { stolen_pumpkin: 'grunt_orchard', rivet: 'rivet_gunner', giant_pumpkin: 'bramble_colossus', thorn_seed: 'wisp' };

/** The swinging dummy's swing, parried. */
function parry(w: SimWorld): void {
  const dummy = w.entities.find((e) => e.brain?.def === 'dummy_swing')!;
  const move = ENEMIES[dummy.brain!.def].moves[0];
  const p = w.playerEntity(0)!;
  standAt(w, dummy.tf.pos.x + Math.sin(dummy.tf.yaw) * 1.5, dummy.tf.pos.z + Math.cos(dummy.tf.yaw) * 1.5);
  p.tf.yaw = p.tf.prevYaw = Math.atan2(dummy.tf.pos.x - p.tf.pos.x, dummy.tf.pos.z - p.tf.pos.z);
  for (let i = 0; i < 600; i++) {
    const a = dummy.combat!.action;
    const c = idleInput(p.tf.yaw);
    if (a?.kind === 'attack' && a.t >= move.windup - 3) {
      c.held = BTN.block;
      if (a.t === move.windup - 3) c.pressed = BTN.block;
    }
    if (tick(w, c).some((e) => e.type === 'parry')) return;
  }
  throw new Error('the dummy was never parried');
}

/** Do one objective of the active step, however far it has got. */
function doObjective(w: SimWorld, o: Objective): void {
  switch (o.kind) {
    case 'talk':
      talk(w, o.npc);
      break;
    case 'reach':
      // A volume only counts on the way in.
      standAt(w, 256, 58);
      tick(w);
      reach(w, o.trigger);
      break;
    case 'interact':
      if (w.entities.find((e) => e.interactable?.id === o.object)?.interactable?.kind === 'shrine') rest(w, o.object);
      else use(w, o.object);
      break;
    case 'kill':
      hunt(w, o.tag);
      break;
    case 'feat':
      parry(w);
      break;
    case 'collect': {
      if ((prog(w).inventory[o.item] ?? 0) >= o.count) break;
      if (o.item === 'sheep_decoy') {
        const next = w.entities.find((e) => e.interactable?.id.startsWith('sheep_decoy') && !e.interactable.used);
        if (!next) throw new Error('no Sheep Decoy left to take');
        use(w, next.interactable!.id);
      } else if (SOURCES[o.item]) hunt(w, SOURCES[o.item]);
      else throw new Error(`nowhere to get ${o.item}`);
      break;
    }
  }
}

const target = (o: Objective) => (o.kind === 'kill' || o.kind === 'collect' || o.kind === 'feat' ? o.count : 1);

/**
 * Play a started quest to its end, one objective at a time. `onStep` runs after each thing done
 * and returns the world to go on in (a reload hands back a new one).
 */
export async function playQuest(w: SimWorld, id: string, onStep?: (w: SimWorld) => Promise<SimWorld>): Promise<SimWorld> {
  const def = QUESTS[id];
  for (let guard = 0; guard < 200 && statusOf(w, id) === 'active'; guard++) {
    const q = prog(w).quests[id];
    const objectives = def.steps[q.step].objectives;
    const i = objectives.findIndex((o, k) => q.progress[k] < target(o));
    if (i < 0) tick(w);
    else doObjective(w, objectives[i]);
    if (onStep && prog(w).quests[id].status === 'active') w = await onStep(w);
  }
  if (statusOf(w, id) !== 'complete') throw new Error(`${id} stuck at step ${prog(w).quests[id]?.step} (${def.steps[prog(w).quests[id]?.step ?? 0]?.id})`);
  return w;
}
