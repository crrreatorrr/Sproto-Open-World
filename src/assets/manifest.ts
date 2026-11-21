import { MOUNT } from '../content/mounts';

/**
 * Every model the game loads, by key. Paths are relative to public/assets. The loader falls back
 * to a primitive when a file is missing, so a key can exist before its art does.
 */
export interface ModelEntry {
  path: string;
  /** Clip names the game expects (checked by scripts/check-assets.mjs and warned about at load). */
  clips?: readonly string[];
  /** Skinned and animated. */
  rigged?: boolean;
  /**
   * Fit at load: scale the model so it stands this tall (m) with its feet at y = 0, so it matches
   * the sim's capsule whatever size the source was exported at.
   */
  fitHeight?: number;
  /** Turn the model at load (radians) so it faces +Z, the sim's yaw 0. */
  rotationY?: number;
  /** Clips are authored in place (their hip sway is part of the motion): don't pin root motion. */
  inPlace?: boolean;
}

export const PLAYER_CLIPS = [
  'idle', 'run', 'run_back', 'strafe_l', 'strafe_r', 'jump', 'roll', 'hit', 'stun', 'defeat', 'victory',
  'cast', 'cast_big', 'attack_light_1', 'attack_light_2', 'attack_light_3', 'attack_heavy', 'block',
  'mount', 'ride', 'dismount',
] as const;

/**
 * Sproto Shooter's animations, on every playable body (art/README.md): the gun layers over the legs
 * (`hold` the ready carry, `aim` the shouldered sights, `shoot` the trigger pull, `reload`), and the
 * whole-body `slide` and `dash`.
 */
export const SHOOTER_CLIPS = [
  'aim', 'hold', 'shoot', 'reload', 'slide', 'dash',
  // The sidearms (the dual-wield guns): one in the right hand, or one in each.
  'aim_1h', 'hold_1h', 'shoot_1h', 'reload_1h', 'dual', 'dual_shoot_r', 'dual_shoot_l', 'dual_reload', 'dual_reload_r', 'dual_reload_l',
] as const;

/** Every playable body's clips: the Wizard's 21 (retargeted onto the class bodies' Mixamo rigs) plus the shooter's. */
export const GUNNER_CLIPS = [...PLAYER_CLIPS, ...SHOOTER_CLIPS] as const;

/** The Thornwood Brute (sproto-shooter's `sproto_monster`). */
export const BRUTE_CLIPS = ['idle', 'walk', 'run', 'punch', 'kick'] as const;

/** sproto-duel's 24-joint clip set, shared by the M1b standard enemies (no walk clip). */
export const DUEL_ENEMY_CLIPS = [
  'idle', 'run', 'cast', 'cast_big', 'hit', 'stun', 'defeat', 'roll', 'jump', 'strafe_l', 'strafe_r', 'run_back',
] as const;

/** midget_stage3 carries the core combat clips without jump/strafe/run_back. */
export const MIDGET_STAGE3_CLIPS = [
  'idle', 'run', 'cast', 'cast_big', 'hit', 'stun', 'defeat', 'roll', 'victory',
] as const;

/** The Gatekeeper (sproto-shooter's `monster` boss): smash is its only attack clip. */
export const GATEKEEPER_CLIPS = ['idle', 'walk', 'run', 'smash'] as const;

/** The robot elites (sproto-shooter-bosses): `cast_big` is the Rivet Gunner's alone. */
export const ROBOT_SHOOTER_CLIPS = ['idle', 'run', 'cast', 'cast_big', 'stun'] as const;
export const ROBOT_LASER_CLIPS = ['idle', 'run', 'cast', 'stun'] as const;
/** Scrapjaw (sproto-shooter-bosses' `car_monster`): every boss action has its own clip. */
export const SCRAPJAW_CLIPS = ['idle', 'walk', 'smash', 'slam', 'charge_start', 'charge', 'stunned', 'roar', 'throw_start', 'throw_loop'] as const;
/** The Burrowmother (sproto-shooter-bosses' `mole_monster`): no burrow clip, her view sinks her instead. */
export const BURROWMOTHER_CLIPS = ['idle', 'walk', 'smash', 'slam', 'charge_start', 'charge', 'stunned', 'roar', 'shoot_start', 'shoot_loop'] as const;

/** The Skyfire Drake (sproto-shooter-bosses' `dragon`): it only ever flies. */
export const DRAKE_CLIPS = ['fly', 'fireball'] as const;

/** Villagers keep only their idle (the importer drops the rest). */
export const NPC_CLIPS = ['idle'] as const;

export const MODELS = {
  /** sproto-duel's rigged wizard plus the Blender melee clips (art/README.md). Never optimized again. */
  player: { path: 'models/characters/player.glb', rigged: true, clips: GUNNER_CLIPS },
  /**
   * The Soldier Sproto (metaverse-hub's soldier avatar) and Pepe (the hub's Pepe avatar), built by
   * art/tools/classes: the Wizard's height, a `socket_weapon` in the right hand, and GUNNER_CLIPS.
   */
  player_soldier: { path: 'models/characters/soldier.glb', rigged: true, clips: GUNNER_CLIPS },
  player_pepe_warrior: { path: 'models/characters/pepe_warrior.glb', rigged: true, clips: GUNNER_CLIPS },
  player_pepe: { path: 'models/characters/pepe_player.glb', rigged: true, clips: GUNNER_CLIPS },
  /** U0: Grapple hook gear (sproto-shooter; lazy-loaded once Grapple is unlocked). */
  grappler: { path: 'models/gear/grappler.glb', clips: ['Grappler jaws'] },
  /** Sproto Shooter's guns (art/tools/classes/build-guns.mjs): grip at the origin, barrel +Z, a `muzzle` node. */
  gun_mg: { path: 'models/guns/gun_mg.glb' },
  gun_shotgun: { path: 'models/guns/gun_shotgun.glb' },
  gun_sniper: { path: 'models/guns/gun_sniper.glb' },
  gun_bazooka: { path: 'models/guns/gun_bazooka.glb' },
  gun_raygun: { path: 'models/guns/gun_raygun.glb' },
  gun_bigbullets: { path: 'models/guns/gun_bigbullets.glb' },
  gun_duckgun: { path: 'models/guns/gun_duckgun.glb' },
  /** The sidearms, which the shooter has no model for (art/tools/classes/build-sidearms.mjs). */
  gun_handgun: { path: 'models/guns/gun_handgun.glb' },
  gun_machinepistol: { path: 'models/guns/gun_machinepistol.glb' },
  staff_sproto: { path: 'models/staffs/staff_sproto.glb' },
  /** The small starter staff the world boots with (STAFF_BOOT_LOD). */
  staff_sproto_lod1: { path: 'models/staffs/staff_sproto-lod1.glb' },
  staff_moonward: { path: 'models/staffs/staff_moonward.glb' },
  staff_momentum: { path: 'models/staffs/staff_momentum.glb' },
  staff_nobu: { path: 'models/staffs/staff_nobu.glb' },
  staff_fighters_might: { path: 'models/staffs/staff_fighters_might.glb' },
  /** Rootcleaver. No boot LOD: it downloads the first time it is equipped, after the world is playable. */
  staff_rootcleaver: { path: 'models/staffs/staff_rootcleaver.glb' },
  /** The Brick Phone, the fast-travel device (art/tools/build_brick_phone.py). Tiny; loaded the first time it is equipped. */
  staff_brick_phone: { path: 'models/staffs/staff_brick_phone.glb' },
  /** C2: loaded the first time one is equipped, never in the critical download. Each is its own only LOD. */
  staff_shooter: { path: 'models/staffs/staff_shooter.glb' },
  staff_fighter: { path: 'models/staffs/staff_fighter.glb' },
  /** The small models a save's equipped staff boots with (STAFF_BOOT_LOD). */
  staff_moonward_lod1: { path: 'models/staffs/staff_moonward-lod1.glb' },
  staff_momentum_lod1: { path: 'models/staffs/staff_momentum-lod1.glb' },
  staff_nobu_lod1: { path: 'models/staffs/staff_nobu-lod1.glb' },
  staff_fighters_might_lod1: { path: 'models/staffs/staff_fighters_might-lod1.glb' },
  /** Faces +Z already (the shooter's MODEL_ROTATION_Y is 0 for it); fitted to the EnemyDef body. */
  brute: { path: 'models/elites/brute.glb', rigged: true, clips: BRUTE_CLIPS, fitHeight: 2.4, rotationY: 0, inPlace: true },
  /** M1b standard enemies, fitted to their EnemyDef bodies (the Wisp's 1.9 m is the body; it hovers above that). */
  grunt: { path: 'models/enemies/grunt.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.3 },
  slinger: { path: 'models/enemies/slinger.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.85 },
  wisp: { path: 'models/enemies/wisp.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.9 },
  /**
   * M4 veterans and elites. Views also scale the fitted model to the EnemyDef's body, so these are
   * the bodies they were made for: the veteran Grunt, the Slinger veteran, Big Coin (the same
   * model, bigger) and the Gatekeeper (faces +Z like the Brute; in-place clips).
   */
  grunt_vet: { path: 'models/enemies/grunt_vet.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.3 },
  slinger_vet: { path: 'models/enemies/slinger_vet.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.85 },
  big_coin: { path: 'models/enemies/slinger_vet.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 2.3 },
  /** U0: remaining Shooter enemy/boss stages (lazy-loaded; not in the critical download). */
  midget_stage3: { path: 'models/enemies/midget_stage3.glb', rigged: true, clips: MIDGET_STAGE3_CLIPS, fitHeight: 1.3 },
  obama_stage3: { path: 'models/enemies/obama_stage3.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.85 },
  sahil_stage2: { path: 'models/enemies/sahil_stage2.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.9 },
  sahil_stage3: { path: 'models/enemies/sahil_stage3.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.9 },
  tinubu_stage1: { path: 'models/enemies/tinubu_stage1.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 2.0 },
  tinubu_stage2: { path: 'models/enemies/tinubu_stage2.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 2.0 },
  tinubu_stage3: { path: 'models/enemies/tinubu_stage3.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 2.2 },
  gatekeeper: { path: 'models/elites/gatekeeper.glb', rigged: true, clips: GATEKEEPER_CLIPS, fitHeight: 3.2, rotationY: 0, inPlace: true },
  /** C4's robot elites: outside the critical download, they face +Z and their clips are in place. */
  robot_shooter: { path: 'models/elites/robot_shooter.glb', rigged: true, clips: ROBOT_SHOOTER_CLIPS, fitHeight: 2.0, rotationY: 0, inPlace: true },
  robot_laser: { path: 'models/elites/robot_laser.glb', rigged: true, clips: ROBOT_LASER_CLIPS, fitHeight: 2.1, rotationY: 0, inPlace: true },
  /** M5: the boss (faces +Z, in-place clips), lazy-loaded. Fitted to its 5.4 m EnemyDef body. */
  scrapjaw: { path: 'models/bosses/scrapjaw.glb', rigged: true, clips: SCRAPJAW_CLIPS, fitHeight: 5.4, rotationY: 0, inPlace: true },
  /** C5: the second boss (faces +Z, in-place clips), lazy-loaded. Fitted to her 5 m EnemyDef body. */
  burrowmother: { path: 'models/bosses/burrowmother.glb', rigged: true, clips: BURROWMOTHER_CLIPS, fitHeight: 5, rotationY: 0, inPlace: true },
  /**
   * C6: the boss (its head is at the source's -X, so it turns the other way from the other Tripo
   * models; in-place clips), and the far LOD the flyover draws. Both lazy-loaded.
   */
  drake: { path: 'models/bosses/drake.glb', rigged: true, clips: DRAKE_CLIPS, fitHeight: 5, rotationY: Math.PI / 2, inPlace: true },
  drake_far: { path: 'models/bosses/drake_far.glb', rigged: true, clips: ['fly'], fitHeight: 5, rotationY: Math.PI / 2, inPlace: true },
  /** The Old Quarry's breakable pillars (the sim's obstacles; the same rock as the quarry's rim). */
  quarry_pillar: { path: 'models/props/rock_outcrop.glb' },
  /**
   * M4 villagers (NpcDef.model), fitted to 1.8 m (views rescale to the NPC's body). The Miller is
   * the Trader's model, tinted by the view.
   */
  npc_elder: { path: 'models/npcs/pepe_general.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_trader: { path: 'models/npcs/pepe.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_miller: { path: 'models/npcs/pepe.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_collector: { path: 'models/npcs/pepe_tux.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_farmer: { path: 'models/npcs/broccoli.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_captain: { path: 'models/npcs/agent.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  // C4's villagers: existing models, tinted by the view (RpgViews' NPC_TINTS).
  npc_watch: { path: 'models/npcs/agent.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_ranger: { path: 'models/npcs/pepe.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  npc_weaver: { path: 'models/npcs/pepe_tux.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  // C5's quarry miners: the Trader's Pepe, tinted by the view.
  npc_miner: { path: 'models/npcs/pepe.glb', rigged: true, clips: NPC_CLIPS, fitHeight: 1.8 },
  /**
   * M4 interactables and pickups (sproto-shooter's cartoon kit; vertex colours). The shrine is
   * 2.46 m tall at scale 1 (its crystal, `shrine_focus`, has its own clip); the chest's lid is the
   * `chest_lid` node, hinged on its back edge (the importer splits it off). Pickups are fitted by
   * their view.
   */
  shrine: { path: 'models/interactables/shrine.glb' },
  chest: { path: 'models/interactables/chest.glb' },
  pickup_gem: { path: 'models/pickups/gem.glb' },
  pickup_heart: { path: 'models/pickups/heart.glb' },
  pickup_potion: { path: 'models/pickups/potion.glb' },
  /** U0: Shooter ammo pickup and projectiles (lazy-loaded; not in the village critical download). */
  pickup_ammo_box: { path: 'models/pickups/ammo_box.glb' },
  proj_duck: { path: 'models/projectiles/duck.glb' },
  proj_rubber_bullet: { path: 'models/projectiles/rubber_bullet.glb' },
  proj_missile: { path: 'models/projectiles/missile.glb' },
  proj_bomb: { path: 'models/projectiles/bomb.glb' },
  proj_tyre: { path: 'models/projectiles/tyre.glb' },
  proj_drill_head: { path: 'models/projectiles/drill_head.glb' },
  /** World props the C3 powers grow, tinted by their views: Bramble Wall's roots, Healing Bloom's flowers. */
  prop_root_wall: { path: 'models/props/grove_root_wall.glb' },
  prop_crops: { path: 'models/props/grove_crops.glb' },
  /** The rideable Pepe Bull (art/tools/build_bull.py), at the height art/tools/ride_anim.py poses the rider for. */
  pepe_bull: { path: 'models/mounts/pepe_bull.glb', rigged: true, clips: ['idle', 'follow_walk', 'follow_run', 'gallop'], fitHeight: MOUNT.standHeight, rotationY: 0, inPlace: true },
} satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;

/**
 * The world boots with these small staffs (the starter's and a save's equipped one), and the full
 * model streams in once things are calm.
 */
export const STAFF_BOOT_LOD: Partial<Record<ModelKey, ModelKey>> = {
  staff_sproto: 'staff_sproto_lod1',
  staff_moonward: 'staff_moonward_lod1',
  staff_momentum: 'staff_momentum_lod1',
  staff_nobu: 'staff_nobu_lod1',
  staff_fighters_might: 'staff_fighters_might_lod1',
};

export const TEXTURES = {
  groundGrass: 'textures/grove/floor.jpg',
  stone: 'textures/grove/stone.jpg',
  sky: 'textures/grove/sky.jpg',
} as const;

/** Where the staff mounts on a rigged character (node extras carry the contract). */
export const STAFF_SOCKET = 'socket_staff';
/** Where a gun mounts on every playable body: grip at its origin, +Z along the barrel. */
export const WEAPON_SOCKET = 'socket_weapon';
/** The same in the left hand, for the second gun of a dual-wielded pair. */
export const OFFHAND_SOCKET = 'socket_weapon_l';
