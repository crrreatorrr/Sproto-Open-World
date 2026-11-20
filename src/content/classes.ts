/**
 * Classes, chosen once when a new save is made: the Wizard Sproto (staff and spells), the Soldier Sproto
 * (one of Sproto Shooter's guns; its shots replace the shooting spells and never run out) and Pepe (a
 * gun and every spell). Every class keeps the same melee, powers and skills. Pure data.
 *
 * A gun is an item of kind `staff`: it is held in the weapon slot, swung like a staff, and its `staff`
 * numbers are its melee damage and spell power. Its `gun` numbers are what Gunfire shoots.
 */
import type { ItemDef } from './items';
import type { SpellId } from './spells';

export type ClassId = 'wizard' | 'soldier' | 'pepe_warrior' | 'pepe';
export const CLASS_IDS: readonly ClassId[] = ['wizard', 'soldier', 'pepe_warrior', 'pepe'];

export interface ClassDef {
  id: ClassId;
  name: string;
  /** One line on the class picker. */
  blurb: string;
  /** Primary weapon archetype for starting gear / drop swaps (all classes can wield any weapon). */
  weapon: 'staff' | 'gun';
  /** The view's model key for the body. */
  model: 'player' | 'player_soldier' | 'player_pepe_warrior' | 'player_pepe';
  /** The weapon a new save holds, and everything else it starts with in the bags. */
  startWeapon: string;
  startItems: readonly string[];
}

export interface ClassPassiveDef {
  id: string;
  name: string;
  primaryBranch: 'magic' | 'combat' | 'gunslinger';
  text: string;
}

/** The guns every gun class starts with: Sproto Shooter's regular arsenal. */
export const STARTER_GUNS = ['gun_mg', 'gun_shotgun', 'gun_sniper', 'gun_bazooka'] as const;

export const CLASSES: Record<ClassId, ClassDef> = {
  wizard: {
    id: 'wizard', name: 'Wizard Sproto', weapon: 'staff', model: 'player', startWeapon: 'staff_sproto', startItems: [],
    blurb: 'Staff in hand, spells at the ready. Every shot costs mana.',
  },
  soldier: {
    id: 'soldier', name: 'Soldier Sproto', weapon: 'gun', model: 'player_soldier', startWeapon: 'gun_mg', startItems: STARTER_GUNS,
    blurb: 'One gun at a time and bullets that never run out. Still knows the old powers.',
  },
  pepe_warrior: {
    id: 'pepe_warrior', name: 'Pepe Warrior', weapon: 'staff', model: 'player_pepe_warrior', startWeapon: 'staff_sproto', startItems: [],
    blurb: 'Vanguard brawler with heavy poise. Wields any weapon.',
  },
  pepe: {
    id: 'pepe', name: 'Pepe', weapon: 'gun', model: 'player_pepe', startWeapon: 'gun_mg', startItems: STARTER_GUNS,
    blurb: 'Shoots a gun and casts every spell. Why choose?',
  },
};

/** Innate Level 1 class passives (unification plan §4.1). Pure data. */
export const CLASS_PASSIVES: Record<ClassId, ClassPassiveDef> = {
  wizard: {
    id: 'arcane_conduit',
    name: 'Arcane Conduit',
    primaryBranch: 'magic',
    text: 'Spells cost 10% less mana; gunshots restore a small amount of mana on hit.',
  },
  soldier: {
    id: 'combat_ready',
    name: 'Combat Ready',
    primaryBranch: 'gunslinger',
    text: '+15% weapon swap and reload speed; shooting spells fire as high-velocity ballistic rounds.',
  },
  pepe_warrior: {
    id: 'vanguard_poise',
    name: 'Vanguard Poise',
    primaryBranch: 'combat',
    text: '+15% melee and poise damage, +15% max HP, and reduced stagger taken while swinging or blocking.',
  },
  pepe: {
    id: 'chaos_freestyle',
    name: 'Chaos Freestyle',
    primaryBranch: 'combat',
    text: '+10% crit chance and +10% move speed for 3 s when chaining different weapon types (Melee → Gun → Spell).',
  },
};

export const classOf = (id: ClassId | undefined): ClassDef => CLASSES[id ?? 'wizard'] ?? CLASSES.wizard;
export const isClassId = (v: unknown): v is ClassId => typeof v === 'string' && (CLASS_IDS as readonly string[]).includes(v);

/** What one pull of the trigger does. Damage = SPELL_BASE × spellPower × mv per bullet. Ticks are 60 Hz. */
export interface GunShot {
  mv: number;
  /** Ticks between shots (the fire rate). */
  cooldown: number;
  /** Bullets per shot, fanned across `spread` degrees. */
  pellets: number;
  spread: number;
  speed: number;
  range: number;
  radius: number;
  /** Explodes where it lands. */
  explodeRadius?: number;
  /** Knocks non-elite enemies down. */
  knockdown?: boolean;
  /** Interrupts a ranged enemy's wind-up. */
  interrupts?: boolean;
  poise: number;
}

export interface GunDef {
  /** Sproto Shooter's gun id (all 9 single-gun-per-type weapons). */
  type: 'mg' | 'handgun' | 'machinepistol' | 'shotgun' | 'sniper' | 'bazooka' | 'raygun' | 'bigbullets' | 'duckgun';
  shot: GunShot;
  /** The projectile's look: a tracer, a heavy slug or a rocket. */
  look: 'bullet' | 'slug' | 'rocket';
}

const gun = (id: string, name: string, rarity: ItemDef['rarity'], blurb: string, melee: number, spellPower: number, def: GunDef): ItemDef => ({
  id, name, kind: 'staff', rarity, blurb, staff: { damage: melee, spellPower, model: id }, gun: def,
});

/**
 * Sproto Shooter's nine fixed guns (one per gun type). Shot numbers keep the shooter's character
 * at this game's damage scale: an Arcane Bolt is 12 a shot.
 */
export const GUN_ITEMS: Record<string, ItemDef> = {
  gun_mg: gun('gun_mg', 'Toy MG', 'common', 'Sprays. Reliable automatic rifle.', 20, 1.0, {
    type: 'mg', look: 'bullet', shot: { mv: 0.3, cooldown: 7, pellets: 1, spread: 2, speed: 90, range: 40, radius: 0.14, poise: 3 },
  }),
  gun_handgun: gun('gun_handgun', 'Handgun', 'common', 'Crisp sidearm. Dual-wieldable.', 18, 0.95, {
    type: 'handgun', look: 'bullet', shot: { mv: 0.55, cooldown: 14, pellets: 1, spread: 1.5, speed: 100, range: 38, radius: 0.14, poise: 5 },
  }),
  gun_machinepistol: gun('gun_machinepistol', 'Machine Pistol', 'common', 'Rapid-fire sidearm. Dual-wieldable.', 18, 0.95, {
    type: 'machinepistol', look: 'bullet', shot: { mv: 0.24, cooldown: 5, pellets: 1, spread: 3.5, speed: 88, range: 32, radius: 0.13, poise: 2 },
  }),
  gun_shotgun: gun('gun_shotgun', 'Toy Shotgun', 'common', 'Up close, all of it lands.', 22, 0.95, {
    type: 'shotgun', look: 'bullet', shot: { mv: 0.25, cooldown: 45, pellets: 9, spread: 14, speed: 70, range: 16, radius: 0.14, knockdown: false, poise: 4 },
  }),
  gun_sniper: gun('gun_sniper', 'Toy Sniper', 'rare', 'One shot. Make it count.', 18, 1.05, {
    type: 'sniper', look: 'slug', shot: { mv: 3, cooldown: 75, pellets: 1, spread: 0, speed: 160, range: 90, radius: 0.16, interrupts: true, poise: 30 },
  }),
  gun_bazooka: gun('gun_bazooka', 'Toy Bazooka', 'rare', 'Slow rocket, big bang.', 24, 1.0, {
    type: 'bazooka', look: 'rocket', shot: { mv: 4, cooldown: 100, pellets: 1, spread: 0, speed: 28, range: 40, radius: 0.3, explodeRadius: 3.5, knockdown: true, poise: 40 },
  }),
  gun_raygun: gun('gun_raygun', 'Raygun', 'epic', 'Hums. Melts.', 22, 1.3, {
    type: 'raygun', look: 'bullet', shot: { mv: 0.6, cooldown: 9, pellets: 1, spread: 1, speed: 110, range: 60, radius: 0.16, interrupts: true, poise: 5 },
  }),
  gun_bigbullets: gun('gun_bigbullets', 'Big Bullets', 'epic', 'Each round is a small boulder.', 30, 1.1, {
    type: 'bigbullets', look: 'slug', shot: { mv: 6, cooldown: 70, pellets: 1, spread: 0, speed: 70, range: 50, radius: 0.32, explodeRadius: 2.5, knockdown: true, poise: 50 },
  }),
  gun_duckgun: gun('gun_duckgun', 'Duck Gun', 'epic', 'Quack.', 28, 1.2, {
    type: 'duckgun', look: 'rocket', shot: { mv: 3.5, cooldown: 45, pellets: 1, spread: 0, speed: 36, range: 45, radius: 0.3, explodeRadius: 3.6, knockdown: true, poise: 35 },
  }),
};

/**
 * A gun class handed one of these staffs gets the gun beside it instead: Sproto Shooter's boss and
 * legendary guns take the epic staffs' places. Any other staff still goes in the bags.
 */
export const STAFF_TO_GUN: Readonly<Record<string, string>> = {
  staff_moonward: 'gun_raygun',
  staff_fighters_might: 'gun_bigbullets',
  staff_rootcleaver: 'gun_duckgun',
};

/** True for an item the class can hold in its weapon slot (any class can wield any staff or gun). */
export function canWield(_cls: ClassId | undefined, item: ItemDef | undefined): boolean {
  return !!item && item.kind === 'staff';
}

/** The spell a class learns in place of `spell`: the Soldier's gun takes the Arcane Bolt's place. */
export function classSpell(cls: ClassId | undefined, spell: SpellId): SpellId | null {
  const c = classOf(cls).id;
  if (spell === 'gunfire' && c === 'wizard') return null;
  if (spell === 'bolt' && c === 'soldier') return 'gunfire';
  return spell;
}

/** The spells a new save of this class knows, from the ones the world hands out at the start. */
export function classSpells(cls: ClassId | undefined, spells: readonly SpellId[]): SpellId[] {
  const out: SpellId[] = [];
  for (const s of spells) {
    const k = classSpell(cls, s);
    if (k && !out.includes(k)) out.push(k);
  }
  // Pepe has both: the gun, and the bolt.
  if (classOf(cls).id === 'pepe' && !out.includes('gunfire')) out.unshift('gunfire');
  return out;
}

/**
 * The Soldier's shooting spells come out of the gun: same numbers, a bullet's look and sound. Pepe and
 * the Wizard cast theirs as magic.
 */
export const firesAsBullets = (cls: ClassId | undefined, spell: SpellId): boolean => spell === 'gunfire' || classOf(cls).id === 'soldier';
