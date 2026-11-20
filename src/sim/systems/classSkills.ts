/**
 * Pure 4-class skill & perk runtime evaluator (unification plan §4.1).
 *
 * Evaluates all 4 classes (`wizard`, `soldier`, `pepe_warrior`, `pepe`):
 * - Innate Lv 1 passives (Arcane Conduit, Combat Ready, Vanguard Poise, Chaos Freestyle)
 * - Signature skills (Arcane Surge, Tactical Handling, Warlord's Might, Trickster Tempo)
 * - All 24 class-tailored Rank 10 & Rank 20 branch milestone perks from `src/content/progression.ts`
 *
 * 100% pure simulation logic: zero Three.js, DOM, Rapier, timers, or Math.random.
 */
import type { ClassId } from '../../content/classes';
import { branchTotal, SKILL_EFFECT, type SkillRanks } from '../../content/progression';

export interface ClassModifierContext {
  /** True while Chaos Freestyle's 3 s weapon-chain window is active (Melee -> Gun -> Spell). */
  recentWeaponChain?: boolean;
  /** Distance to current target in metres (used by Point-Blank Breacher <= 8 m). */
  distanceToTarget?: number;
  /** Explicit close-range flag (also activates Point-Blank Breacher if `distanceToTarget` is omitted). */
  inCloseRange?: boolean;
  /** True when dual-wielding sidearms (activates Tactical Handling & Akimbo Ace dual bonuses). */
  dualWielding?: boolean;
  /** True while sliding or dashing (activates Soldier's Unshaken +15% damage resistance). */
  slidingOrDashing?: boolean;
}

export interface ClassCombatModifiers {
  classId: ClassId;

  // Core numeric multipliers & bonuses
  meleeDmgMult: number;
  poiseDmgMult: number;
  gunDmgMult: number;
  weakspotMult: number;
  reloadSpeedMult: number;
  fireRateMult: number;
  recoilSpreadMult: number;
  swapSpeedMult: number;
  ammoCapacityMult: number;
  spellDmgMult: number;
  spellCostMult: number;
  spellCritBonus: number;
  gunCritBonus: number;
  elementProcBonus: number;
  protectionMult: number;
  manaRegenMult: number;
  staminaRegenMult: number;
  maxHpMult: number;
  moveSpeedMult: number;
  movementCooldownMult: number;
  damageResist: number;

  // Dual-wield specific multipliers
  dualWieldFireRateMult: number;
  dualWieldSpreadMult: number;
  dualWieldReloadMult: number;

  // Melee / parry / posture modifiers
  plungeDmgMult: number;
  counterRiposteMult: number;
  swingStaggerReduction: number;
  parryHealFrac: number;
  riposteEmpowerMult: number;
  meleeReflectFrac: number;
  meleeKillDamageResist: number;
  uninterruptibleHeavy: boolean;
  uninterruptibleReload: boolean;

  // Spell / weave / gun-spell synergy modifiers
  spellsFireAsBullets: boolean;
  gunHitManaFrac: number;
  meleeHitManaFrac: number;
  wovenSpellCostMult: number;
  wovenCastSpeedMult: number;
  gunCritTriggersWeave: boolean;
  gunHitTriggersWeave: boolean;
  protectionCleansesStatus: boolean;
  protectionGrantsShield: boolean;
  protectionGrantsSuperArmor: boolean;
  elementalProcEchoesBolt: boolean;
  parryTriggersShockwave: boolean;
  gunHitRefreshesStatuses: boolean;
  manaFedMagShots: number;
  spellInheritsGunCritFrac: number;
  spellInheritsGunElement: boolean;
  castRefillsMagFrac: number;
  warCastBonusPoise: boolean;

  // Gun / ammo / perk triggers
  stowedAutoReloadTicks: number;
  quickdrawFireRateBonus: number;
  weakspotRefundsAmmo: boolean;
  deadeyeCritPerStack: number;
  deadeyeMaxStacks: number;
  pointBlankRange: number;
  pointBlankDmgMult: number;
  meleeKillReloadsGun: boolean;
  bayonetBoostShots: number;
  bayonetBoostDmgMult: number;

  // Pepe hybrid / chaos triggers
  weaponChainCritBonus: number;
  weaponChainMoveSpeedMult: number;
  weaveCooldownTrimTicks: number;
  wildSurgeEveryN: number;
  evasiveCounterGuaranteesCrit: boolean;
  freestyleFinisherBurst: boolean;
  wackyProcRateMult: number;
  nonLegendaryCritMiniProc: boolean;
}

const POINT_BLANK_RANGE_M = 8;

/**
 * Compute all class passives, signature skill scalings, and active rank 10 / 20 branch perks
 * for a player given their class, skill ranks, and optional combat context.
 */
export function computeClassModifiers(
  cls: ClassId | undefined,
  skills: Readonly<SkillRanks>,
  ctx?: ClassModifierContext,
): ClassCombatModifiers {
  const classId: ClassId = cls ?? 'wizard';

  const spellPower = skills.spellPower ?? 0;
  const protection = skills.protection ?? 0;
  const focus = skills.focus ?? 0;
  const attack = skills.attack ?? 0;
  const stamina = skills.stamina ?? 0;
  const marksmanship = skills.marksmanship ?? 0;
  const handling = skills.handling ?? 0;
  const logistics = skills.logistics ?? 0;

  const magicTotal = branchTotal(skills, 'magic');
  const combatTotal = branchTotal(skills, 'combat');
  const gunslingerTotal = branchTotal(skills, 'gunslinger');

  const hasMagic10 = magicTotal >= 10;
  const hasMagic20 = magicTotal >= 20;
  const hasCombat10 = combatTotal >= 10;
  const hasCombat20 = combatTotal >= 20;
  const hasGunslinger10 = gunslingerTotal >= 10;
  const hasGunslinger20 = gunslingerTotal >= 20;

  // Baseline shared skill scalings
  const mods: ClassCombatModifiers = {
    classId,

    meleeDmgMult: 1 + SKILL_EFFECT.attack * attack,
    poiseDmgMult: 1,
    gunDmgMult: 1 + SKILL_EFFECT.marksmanship * marksmanship,
    weakspotMult: 1 + 0.02 * marksmanship,
    reloadSpeedMult: 1 + SKILL_EFFECT.handling * handling,
    fireRateMult: 1 + SKILL_EFFECT.handling * handling,
    recoilSpreadMult: Math.max(0.2, 1 - SKILL_EFFECT.handling * handling),
    swapSpeedMult: 1,
    ammoCapacityMult: 1 + SKILL_EFFECT.logistics * logistics,
    spellDmgMult: 1 + SKILL_EFFECT.spellPower * spellPower,
    spellCostMult: 1,
    spellCritBonus: 0,
    gunCritBonus: SKILL_EFFECT.marksmanship * marksmanship,
    elementProcBonus: 0,
    protectionMult: 1 + SKILL_EFFECT.protection * protection,
    manaRegenMult: 1 + SKILL_EFFECT.focusRegen * focus,
    staminaRegenMult: 1,
    maxHpMult: 1,
    moveSpeedMult: 1,
    movementCooldownMult: 1,
    damageResist: 0,

    dualWieldFireRateMult: 1,
    dualWieldSpreadMult: 1,
    dualWieldReloadMult: 1,

    plungeDmgMult: 1,
    counterRiposteMult: 1,
    swingStaggerReduction: 0,
    parryHealFrac: 0,
    riposteEmpowerMult: 1,
    meleeReflectFrac: 0,
    meleeKillDamageResist: 0,
    uninterruptibleHeavy: false,
    uninterruptibleReload: false,

    spellsFireAsBullets: false,
    gunHitManaFrac: 0,
    meleeHitManaFrac: 0,
    wovenSpellCostMult: 1,
    wovenCastSpeedMult: 1,
    gunCritTriggersWeave: false,
    gunHitTriggersWeave: false,
    protectionCleansesStatus: false,
    protectionGrantsShield: false,
    protectionGrantsSuperArmor: false,
    elementalProcEchoesBolt: false,
    parryTriggersShockwave: false,
    gunHitRefreshesStatuses: false,
    manaFedMagShots: 0,
    spellInheritsGunCritFrac: 0,
    spellInheritsGunElement: false,
    castRefillsMagFrac: 0,
    warCastBonusPoise: false,

    stowedAutoReloadTicks: 0,
    quickdrawFireRateBonus: 0,
    weakspotRefundsAmmo: false,
    deadeyeCritPerStack: 0,
    deadeyeMaxStacks: 0,
    pointBlankRange: 0,
    pointBlankDmgMult: 1,
    meleeKillReloadsGun: false,
    bayonetBoostShots: 0,
    bayonetBoostDmgMult: 1,

    weaponChainCritBonus: 0,
    weaponChainMoveSpeedMult: 1,
    weaveCooldownTrimTicks: 0,
    wildSurgeEveryN: 0,
    evasiveCounterGuaranteesCrit: false,
    freestyleFinisherBurst: false,
    wackyProcRateMult: 1,
    nonLegendaryCritMiniProc: false,
  };

  if (classId === 'wizard') {
    // Innate Lv 1 Passive — Arcane Conduit
    mods.spellCostMult *= 0.9;
    mods.gunHitManaFrac = 0.02;

    // Signature Skill — Arcane Surge (replaces Protection in Magic)
    mods.spellCritBonus += 0.06 * protection;
    mods.elementProcBonus += 0.06 * protection;

    // Magic 10 — Weaver
    if (hasMagic10) {
      mods.wovenSpellCostMult = 0.85;
      mods.wovenCastSpeedMult = 1.25;
      mods.gunCritTriggersWeave = true;
    }
    // Magic 20 — Archmage's Ward
    if (hasMagic20) {
      mods.protectionCleansesStatus = true;
      mods.protectionGrantsShield = true;
      mods.elementalProcEchoesBolt = true;
    }
    // Combat 10 — Spellblade
    if (hasCombat10) {
      mods.meleeHitManaFrac = 0.08;
    }
    // Combat 20 — Aegis Parry
    if (hasCombat20) {
      mods.parryTriggersShockwave = true;
    }
    // Gunslinger 10 — Runic Rounds
    if (hasGunslinger10) {
      mods.elementProcBonus += 0.15;
      mods.gunHitRefreshesStatuses = true;
    }
    // Gunslinger 20 — Mana-Fed Mag
    if (hasGunslinger20) {
      mods.manaFedMagShots = 3;
    }
  } else if (classId === 'soldier') {
    // Innate Lv 1 Passive — Combat Ready
    mods.swapSpeedMult *= 1.15;
    mods.reloadSpeedMult *= 1.15;
    mods.spellsFireAsBullets = true;

    // Signature Skill — Tactical Handling (replaces Handling in Gunslinger)
    mods.dualWieldFireRateMult *= 1 + 0.03 * handling;
    mods.dualWieldSpreadMult *= Math.max(0.4, 1 - 0.03 * handling);
    if (ctx?.dualWielding) {
      mods.fireRateMult *= 1 + 0.03 * handling;
      mods.recoilSpreadMult = Math.max(0.2, mods.recoilSpreadMult * Math.max(0.4, 1 - 0.03 * handling));
    }

    // Magic 10 — Ordnance Caster
    if (hasMagic10) {
      mods.spellInheritsGunCritFrac = 0.25;
      mods.spellInheritsGunElement = true;
    }
    // Magic 20 — Suppressive Barrage
    if (hasMagic20) {
      mods.castRefillsMagFrac = 0.3;
    }
    // Combat 10 — CQC Specialist
    if (hasCombat10) {
      mods.poiseDmgMult *= 1.35;
    }
    // Combat 20 — Unshaken
    if (hasCombat20) {
      mods.uninterruptibleHeavy = true;
      mods.uninterruptibleReload = true;
      if (ctx?.slidingOrDashing) {
        mods.damageResist += 0.15;
      }
    }
    // Gunslinger 10 — Quickdraw
    if (hasGunslinger10) {
      mods.stowedAutoReloadTicks = 180;
      mods.quickdrawFireRateBonus = 0.15;
    }
    // Gunslinger 20 — Deadeye
    if (hasGunslinger20) {
      mods.weakspotRefundsAmmo = true;
      mods.deadeyeCritPerStack = 0.2;
      mods.deadeyeMaxStacks = 3;
    }
  } else if (classId === 'pepe_warrior') {
    // Signature Skill — Warlord's Might (replaces Attack in Combat: +5% melee, +6% poise, plunge/counter/riposte)
    mods.meleeDmgMult = 1 + 0.05 * attack;
    mods.poiseDmgMult *= 1 + 0.06 * attack;
    mods.plungeDmgMult *= 1 + 0.05 * attack;
    mods.counterRiposteMult *= 1 + 0.05 * attack;

    // Innate Lv 1 Passive — Vanguard Poise
    mods.meleeDmgMult *= 1.15;
    mods.poiseDmgMult *= 1.15;
    mods.maxHpMult *= 1.15;
    mods.swingStaggerReduction = 0.25;

    // Magic 10 — War-Cast
    if (hasMagic10) {
      mods.warCastBonusPoise = true;
    }
    // Magic 20 — Battle Ward
    if (hasMagic20) {
      mods.protectionGrantsSuperArmor = true;
      mods.meleeReflectFrac = 0.2;
    }
    // Combat 10 — Riposte Rush
    if (hasCombat10) {
      mods.parryHealFrac = 0.06;
      mods.riposteEmpowerMult = 1.35;
    }
    // Combat 20 — Unstoppable Juggernaut
    if (hasCombat20) {
      mods.uninterruptibleHeavy = true;
      mods.meleeKillDamageResist = 0.2;
    }
    // Gunslinger 10 — Point-Blank Breacher
    if (hasGunslinger10) {
      mods.pointBlankRange = POINT_BLANK_RANGE_M;
      mods.pointBlankDmgMult = 1.25;
      const close =
        ctx?.inCloseRange === true
        || (ctx?.distanceToTarget !== undefined && ctx.distanceToTarget <= POINT_BLANK_RANGE_M);
      if (close) {
        mods.gunDmgMult *= 1.25;
        mods.poiseDmgMult *= 1.25;
      }
    }
    // Gunslinger 20 — Bayonet Momentum
    if (hasGunslinger20) {
      mods.meleeKillReloadsGun = true;
      mods.bayonetBoostShots = 2;
      mods.bayonetBoostDmgMult = 1.2;
    }
  } else {
    // Pepe (`pepe`)
    // Innate Lv 1 Passive — Chaos Freestyle
    mods.weaponChainCritBonus = 0.1;
    mods.weaponChainMoveSpeedMult = 1.1;
    if (ctx?.recentWeaponChain) {
      mods.gunCritBonus += 0.1;
      mods.spellCritBonus += 0.1;
      mods.moveSpeedMult *= 1.1;
    }

    // Signature Skill — Trickster Tempo (replaces Stamina in Combat)
    mods.staminaRegenMult *= 1 + 0.04 * stamina;
    mods.movementCooldownMult = Math.max(0.5, 1 - 0.03 * stamina);

    // Magic 10 — Chaos Weave
    if (hasMagic10) {
      mods.weaveCooldownTrimTicks = 60;
      mods.gunHitTriggersWeave = true;
    }
    // Magic 20 — Wild Surge
    if (hasMagic20) {
      mods.wildSurgeEveryN = 4;
    }
    // Combat 10 — Evasive Counter
    if (hasCombat10) {
      mods.parryHealFrac = 0.05;
      mods.evasiveCounterGuaranteesCrit = true;
    }
    // Combat 20 — Freestyle Finisher
    if (hasCombat20) {
      mods.freestyleFinisherBurst = true;
    }
    // Gunslinger 10 — Akimbo Ace
    if (hasGunslinger10) {
      mods.dualWieldFireRateMult *= 1.2;
      mods.dualWieldSpreadMult *= 0.8;
      mods.dualWieldReloadMult *= 1.2;
      if (ctx?.dualWielding) {
        mods.fireRateMult *= 1.2;
        mods.recoilSpreadMult = Math.max(0.2, mods.recoilSpreadMult * 0.8);
        mods.reloadSpeedMult *= 1.2;
      }
    }
    // Gunslinger 20 — Wacky Overdrive
    if (hasGunslinger20) {
      mods.wackyProcRateMult = 1.5;
      mods.nonLegendaryCritMiniProc = true;
    }
  }

  return mods;
}
