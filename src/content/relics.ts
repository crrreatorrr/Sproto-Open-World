/**
 * Totems and relics (quest polish plan). Quest-won keepsakes: 3 relic sockets and 1 totem.
 * They are not bag items (the bag stays smaller than its cap, so a full bag never refuses a
 * quest reward) and they are not the 6 saga relics. Pure data.
 *
 * Pending owner decisions, implemented as the plan's defaults:
 *   #7 RELIC_SOCKETS = 3 and one totem.
 *   #8 Hopeglass slows the whole world in solo play (HOPEGLASS_SLOWS_WORLD).
 *   #9 Parry window never passes PARRY_WINDOW_CAP (18 ticks, 300 ms).
 *
 * Placed totems: docs/plans/quest-polish-blender-assets-spec.md (origin/grok/quest-polish-blender-assets).
 * Eight GLBs at models/totems/<id>.glb. They are built on the owner's Mac and are not in this branch.
 * Until those files are on main, the view draws a primitive stand-in off the boot path.
 */
import { BLOCK, BUFFER, PLAYER_STATS, ROLL } from './combat';
import { TICK_HZ } from './tuning';

export const RELIC_SOCKETS = 3;
export const TOTEM_SOCKETS = 1;
/** Decision #9. 18 ticks at 60 Hz is 300 ms. */
export const PARRY_WINDOW_CAP = 18;
export const SPAM_PARRY_CAP = 8;
export const IFRAME_END_CAP = 21;
export const PERFECT_END_CAP = 12;
export const GUARD_COUNTER_CAP = 0.15;
export const BRIAR_CAP = 0.1;
/** Block stamina can be cut by at most 35% (multiplier floor). */
export const BLOCK_STAMINA_FLOOR = 0.65;
/** Sprint drain floor (per second). */
export const SPRINT_COST_FLOOR = 7;
/** Decision #8: solo Hopeglass slows the world. Co-op uses extra parry hit-stop instead. */
export const HOPEGLASS_SLOWS_WORLD = true;

export const TOTEM_LIFE_TICKS = 20 * TICK_HZ;
export const TOTEM_FADE_TICKS = 2 * TICK_HZ;
export const TOTEM_RECHARGE_TICKS = 90 * TICK_HZ;
/** Hold Interact this long to plant the equipped totem. */
export const TOTEM_HOLD_TICKS = 18;

export type KeepsakeKind = 'relic' | 'totem';
export type RankedSafe = 'yes' | 'capped' | 'solo';

export interface KeepsakeDef {
  id: string;
  name: string;
  kind: KeepsakeKind;
  rarity: 'common' | 'rare' | 'epic';
  ranked: RankedSafe;
  quest: string;
  step: string;
  /** Bonus unlock words, when it is not a plain step reward. */
  bonus: string | null;
}

const relic = (
  id: string, name: string, rarity: KeepsakeDef['rarity'], ranked: RankedSafe, quest: string, step: string, bonus: string | null = null,
): KeepsakeDef => ({ id, name, kind: 'relic', rarity, ranked, quest, step, bonus });

const totem = (
  id: string, name: string, rarity: KeepsakeDef['rarity'], ranked: RankedSafe, quest: string, step: string,
): KeepsakeDef => ({ id, name, kind: 'totem', rarity, ranked, quest, step, bonus: null });

export const KEEPSAKES: readonly KeepsakeDef[] = [
  relic('relic_drowned_coins', 'Coins of the Drowned Kingdom', 'rare', 'capped', 'q_watchtower', 'slingers', 'Reflect 3 coins into Slingers'),
  relic('relic_gatekeepers_grip', "Gatekeeper's Grip", 'rare', 'yes', 'q_thornwood', 'gatekeeper'),
  relic('relic_hopeglass', 'Hopeglass', 'epic', 'solo', 'q_scrapjaw', 'boss'),
  relic('relic_sprotos_stride', "Sproto's Stride", 'rare', 'capped', 'q_hollow_giant', 'giant', '3 perfect dodges against the Hollow Giant in one fight'),
  relic('relic_tinubus_broken_seal', "Tinubu's Broken Seal", 'rare', 'yes', 'q_mill', 'coin'),
  relic('relic_oracles_eye', "Oracle's Eye", 'epic', 'yes', 'q_lens_flare', 'lens'),
  relic('relic_deepbreath_bellows', 'Deepbreath Bellows', 'rare', 'capped', 'q_deep_seam', 'boss'),
  relic('relic_elder_iron_rivet', 'Elder-Iron Rivet', 'epic', 'capped', 'q_iron_gallery', 'gunners', 'Fell 2 Gunners with their own reflected charged shot'),
  relic('relic_surgebriar', 'Surgebriar', 'rare', 'capped', 'q_weavers_thorns', 'return'),
  relic('relic_drakeplume', 'Drakeplume', 'epic', 'yes', 'q_skyfire', 'boss'),
  totem('totem_elders_hearth', "Elder's Hearth", 'common', 'yes', 'q_wake_up', 'shrine'),
  totem('totem_field_warden', 'Field Warden', 'common', 'yes', 'q_pest_control', 'grunts'),
  totem('totem_seekers_lantern', "Seeker's Lantern", 'rare', 'yes', 'q_relics', 'return'),
  totem('totem_turnstone', 'Turnstone', 'rare', 'capped', 'q_rivet_volley', 'return'),
  totem('totem_elders_seed', "Elder's Seed", 'epic', 'yes', 'q_elders_garden', 'shrines'),
  totem('totem_earthspeaker_stake', 'Earthspeaker Stake', 'rare', 'capped', 'q_tremors', 'seam'),
  totem('totem_ember_quench_pail', 'Ember-Quench Pail', 'rare', 'yes', 'q_smoke_hills', 'hay'),
  totem('totem_skylure_post', 'Skylure Post', 'rare', 'yes', 'q_bait', 'post'),
];

const BY_ID = new Map(KEEPSAKES.map((k) => [k.id, k]));

export const keepsake = (id: string | null | undefined): KeepsakeDef | undefined => (id ? BY_ID.get(id) : undefined);
export const isKeepsake = (id: string): boolean => BY_ID.has(id);
export const isRelic = (id: string): boolean => BY_ID.get(id)?.kind === 'relic';
export const isTotem = (id: string): boolean => BY_ID.get(id)?.kind === 'totem';

export const RELIC_IDS = KEEPSAKES.filter((k) => k.kind === 'relic').map((k) => k.id);
export const TOTEM_IDS = KEEPSAKES.filter((k) => k.kind === 'totem').map((k) => k.id);

/** The keepsake a quest awards, for the quest-log silhouette. */
export const keepsakeForQuest = (quest: string): KeepsakeDef | undefined => KEEPSAKES.find((k) => k.quest === quest);

/**
 * Bonus rewards. Feat names match the plan: `reflectKill` is the new feat (workstream C),
 * `perfectDodge` is the one the quest runtime already counts. Fallback givers hand the item
 * over when the later quest completes, so a miss is not permanent.
 */
export interface BonusReward {
  id: string;
  quest: string;
  step: string;
  feat: 'reflectKill' | 'perfectDodge';
  count: number;
  /** Enemy def id or tag the feat has to be against. */
  tag: string;
  /** reflectKill only: the enemy move that fired the shot. */
  sourceMove?: string;
  /** Quest whose completion hands it over if the bonus was missed. */
  fallbackQuest: string | null;
}

export const BONUS_REWARDS: readonly BonusReward[] = [
  { id: 'relic_drowned_coins', quest: 'q_watchtower', step: 'slingers', feat: 'reflectKill', count: 3, tag: 'slinger', fallbackQuest: 'q_thornwood' },
  { id: 'relic_elder_iron_rivet', quest: 'q_iron_gallery', step: 'gunners', feat: 'reflectKill', count: 2, tag: 'rivet_gunner', sourceMove: 'charged_shot', fallbackQuest: null },
  { id: 'relic_sprotos_stride', quest: 'q_hollow_giant', step: 'giant', feat: 'perfectDodge', count: 3, tag: 'hollow_giant', fallbackQuest: 'q_scrapjaw' },
];

export const bonusFor = (id: string): BonusReward | undefined => BONUS_REWARDS.find((b) => b.id === id);

/** Saved keepsake state. Empty on a new game and on a save from before this schema. */
export interface RelicProgress {
  sockets: (string | null)[];
  totem: string | null;
  owned: string[];
  /** Elder's Seed has refilled a tonic since the last shrine rest. */
  seedSpent: boolean;
  /** The first relic toast has told the player about the Relics tab. */
  introduced: boolean;
  /** Perfect dodges against the Hollow Giant's current life. */
  giantDodges: number;
  /** Bonus progress by keepsake id. */
  bonus: Record<string, number>;
}

export const emptyRelics = (): RelicProgress => ({
  sockets: Array<string | null>(RELIC_SOCKETS).fill(null),
  totem: null,
  owned: [],
  seedSpent: false,
  introduced: false,
  giantDodges: 0,
  bonus: {},
});

export interface RelicMods {
  parryTicks: number;
  spamParryTicks: number;
  iframeEnd: number;
  perfectEnd: number;
  attackBuffer: number;
  chainGrace: number;
  /** Multiplier on stamina lost per blocked blow. 1 = today's poise / 2. */
  blockStaminaMul: number;
  guardCounterChance: number;
  guardCounterCd: number;
  briarChance: number;
  briarCd: number;
  sprintPerSec: number;
  /** 1 = full plunge recovery. Drakeplume is 0.5. */
  plungeLagMul: number;
  hopeglass: { slowTicks: number; cooldown: number; coopHitstop: number } | null;
  oracle: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Combat numbers for the equipped relics. `coop` uses the plan's capped column. */
export function relicMods(equipped: readonly (string | null)[], coop: boolean): RelicMods {
  const has = (id: string) => equipped.includes(id);
  const parryBonus = has('relic_drowned_coins') ? (coop ? 2 : 4) : 0;
  const stride = has('relic_sprotos_stride') ? (coop ? 1 : 3) : 0;
  const seal = has('relic_tinubus_broken_seal') ? 4 : 0;
  const bellows = has('relic_deepbreath_bellows') ? (coop ? 0.15 : 0.25) : 0;
  const rivet = has('relic_elder_iron_rivet') ? (coop ? 0.05 : 0.1) : 0;
  const briar = has('relic_surgebriar') ? (coop ? 0.04 : 0.08) : 0;
  const plume = has('relic_drakeplume');
  return {
    parryTicks: clamp(BLOCK.parryTicks + parryBonus, 1, PARRY_WINDOW_CAP),
    spamParryTicks: clamp(BLOCK.spamParryTicks + (has('relic_gatekeepers_grip') ? BLOCK.spamParryTicks : 0), 1, SPAM_PARRY_CAP),
    iframeEnd: clamp(ROLL.iframeEnd + stride, ROLL.iframeEnd, IFRAME_END_CAP),
    perfectEnd: clamp(ROLL.perfectEnd + stride, ROLL.perfectEnd, PERFECT_END_CAP),
    attackBuffer: BUFFER.attackTicks + Math.min(4, seal),
    chainGrace: BUFFER.chainGrace + Math.min(4, seal),
    blockStaminaMul: clamp(1 - bellows, BLOCK_STAMINA_FLOOR, 1),
    guardCounterChance: clamp(rivet, 0, GUARD_COUNTER_CAP),
    guardCounterCd: 3 * TICK_HZ,
    briarChance: clamp(briar, 0, BRIAR_CAP),
    briarCd: 4 * TICK_HZ,
    sprintPerSec: plume ? Math.max(SPRINT_COST_FLOOR, PLAYER_STATS.sprintCost * 0.7) : PLAYER_STATS.sprintCost,
    plungeLagMul: plume ? 0.5 : 1,
    hopeglass: has('relic_hopeglass') ? { slowTicks: 30, cooldown: 5 * TICK_HZ, coopHitstop: 10 } : null,
    oracle: has('relic_oracles_eye'),
  };
}

export interface TotemMods {
  reflectEvery: number;
  /** 1 = no slow. Solo Earthspeaker is 0.85. */
  moveMul: number;
  decalLead: number;
  lanternTicks: number;
}

export function totemMods(id: string | null, coop: boolean): TotemMods {
  return {
    reflectEvery: id === 'totem_turnstone' ? (coop ? 6 : 4) * TICK_HZ : 0,
    moveMul: id === 'totem_earthspeaker_stake' && !coop ? 0.85 : 1,
    decalLead: id === 'totem_earthspeaker_stake' ? 10 : 0,
    lanternTicks: id === 'totem_seekers_lantern' ? 30 * TICK_HZ : 0,
  };
}

/** How many of this relic's ticks the cap eats, given what is already equipped. 0 when it still helps. */
export function relicShortfall(id: string, equipped: readonly (string | null)[], coop = false): number {
  const withIt = equipped.includes(id) ? equipped : [...equipped, id];
  const bare = relicMods(equipped.filter((x) => x !== id), coop);
  const full = relicMods(withIt, coop);
  if (id === 'relic_drowned_coins') return Math.max(0, (coop ? 2 : 4) - (full.parryTicks - bare.parryTicks));
  return 0;
}

/** The plan's sentence when a relic would add nothing because the cap is already met. */
export function capBlockMessage(id: string, equipped: readonly (string | null)[], coop = false): string | null {
  const def = keepsake(id);
  if (!def || relicShortfall(id, equipped, coop) <= 0) return null;
  const other = equipped.find((x) => x && x !== id && keepsake(x)?.kind === 'relic');
  const name = other ? keepsake(other)!.name : def.name;
  return `Already at the cap: parry window is 300 ms. This relic adds nothing with ${name} equipped.`;
}

export const badgeText = (ranked: RankedSafe): string | null => (ranked === 'solo' ? 'Solo only' : ranked === 'capped' ? 'Capped in co-op' : null);

export const ticksToMs = (ticks: number): number => Math.round((ticks * 1000) / TICK_HZ);

/** Owned count for the header. Never a total: the grid must not say how many exist. */
export const foundCount = (owned: readonly string[]): number => owned.length;

export const GEAR_LOCK_TEXT = 'Locked in combat: gear changes 5 s after the last enemy loses interest, or at a shrine.';
export const TOTEM_SWAPPED_TEXT = 'Totem swapped.';
export const FIRST_RELIC_HINT = 'Equip it in Relics (hold I).';

export const wonToast = (id: string, first: boolean): string => {
  const def = keepsake(id);
  const kind = def?.kind === 'totem' ? 'Totem' : 'Relic';
  const line = `${kind} won: ${def?.name ?? id}`;
  return first && def?.kind === 'relic' ? `${line}. ${FIRST_RELIC_HINT}` : line;
};
