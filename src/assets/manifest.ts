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

/** The Thornwood Brute (sproto-shooter's `sproto_monster`). */
export const BRUTE_CLIPS = ['idle', 'walk', 'run', 'punch', 'kick'] as const;

/** sproto-duel's 24-joint clip set, shared by the M1b standard enemies (no walk clip). */
export const DUEL_ENEMY_CLIPS = [
  'idle', 'run', 'cast', 'cast_big', 'hit', 'stun', 'defeat', 'roll', 'jump', 'strafe_l', 'strafe_r', 'run_back',
] as const;

/** Tripo exports face +X; a quarter turn makes them face +Z (duel and the shooter do the same). */
const TRIPO_ROTATION_Y = -Math.PI / 2;

export const MODELS = {
  /** sproto-duel's rigged wizard plus the Blender melee clips (art/README.md). Never optimized again. */
  player: { path: 'models/characters/player.glb', rigged: true, clips: PLAYER_CLIPS },
  staff_sproto: { path: 'models/staffs/staff_sproto.glb' },
  staff_moonward: { path: 'models/staffs/staff_moonward.glb' },
  staff_momentum: { path: 'models/staffs/staff_momentum.glb' },
  staff_nobu: { path: 'models/staffs/staff_nobu.glb' },
  staff_fighters_might: { path: 'models/staffs/staff_fighters_might.glb' },
  /** Faces +Z already (the shooter's MODEL_ROTATION_Y is 0 for it); fitted to the EnemyDef body. */
  brute: { path: 'models/elites/brute.glb', rigged: true, clips: BRUTE_CLIPS, fitHeight: 2.4, rotationY: 0, inPlace: true },
  /** M1b standard enemies, fitted to their EnemyDef bodies (the Wisp's 1.9 m is the body; it hovers above that). */
  grunt: { path: 'models/enemies/grunt.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.3, rotationY: TRIPO_ROTATION_Y },
  slinger: { path: 'models/enemies/slinger.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.85, rotationY: TRIPO_ROTATION_Y },
  wisp: { path: 'models/enemies/wisp.glb', rigged: true, clips: DUEL_ENEMY_CLIPS, fitHeight: 1.9, rotationY: TRIPO_ROTATION_Y },
  /** The hub's Pepe Bull at riding size (art/tools/ride_anim.py poses the rider for this height). */
  pepe_bull: { path: 'models/mounts/pepe_bull.glb', rigged: true, clips: ['idle', 'follow_walk', 'follow_run'], fitHeight: 1.7, rotationY: 0, inPlace: true },
} satisfies Record<string, ModelEntry>;

export type ModelKey = keyof typeof MODELS;

export const TEXTURES = {
  groundGrass: 'textures/grove/floor.jpg',
  stone: 'textures/grove/stone.jpg',
  sky: 'textures/grove/sky.jpg',
} as const;

/** Where the staff mounts on a rigged character (node extras carry the contract). */
export const STAFF_SOCKET = 'socket_staff';
