import { describe, expect, it } from 'vitest';
import { noSkills, type SkillRanks } from '../../src/content/progression';
import { computeClassModifiers } from '../../src/sim/systems/classSkills';
import { createMovementTechState, MOVEMENT_TECH, stepMovementTech } from '../../src/sim/systems/movementTech';

function withSkills(patch: Partial<SkillRanks>): SkillRanks {
  return { ...noSkills(), ...patch };
}

const MAX_ALL: SkillRanks = {
  spellPower: 10,
  protection: 10,
  focus: 10,
  attack: 10,
  defense: 10,
  stamina: 10,
  marksmanship: 10,
  handling: 10,
  logistics: 10,
};

describe('classSkills', () => {
  it('defaults undefined class to wizard', () => {
    const undef = computeClassModifiers(undefined, noSkills());
    const wiz = computeClassModifiers('wizard', noSkills());
    expect(undef).toEqual(wiz);
  });

  describe('Wizard Sproto', () => {
    it('applies innate Arcane Conduit passive at Lv 1', () => {
      const m = computeClassModifiers('wizard', noSkills());
      expect(m.spellCostMult).toBeCloseTo(0.9, 5);
      expect(m.gunHitManaFrac).toBeGreaterThan(0);
    });

    it('applies signature Arcane Surge (protection ranks)', () => {
      const m = computeClassModifiers('wizard', withSkills({ protection: 5 }));
      expect(m.spellCritBonus).toBeCloseTo(0.3, 5);
      expect(m.elementProcBonus).toBeCloseTo(0.3, 5);
      expect(m.protectionMult).toBeCloseTo(1.4, 5);
    });

    it('applies all 6 Wizard rank 10 / 20 branch perks', () => {
      // Below threshold: branch totals = 9 -> no perks
      const below = computeClassModifiers(
        'wizard',
        withSkills({ spellPower: 9, attack: 9, marksmanship: 9 }),
      );
      expect(below.wovenSpellCostMult).toBe(1);
      expect(below.wovenCastSpeedMult).toBe(1);
      expect(below.gunCritTriggersWeave).toBe(false);
      expect(below.meleeHitManaFrac).toBe(0);
      expect(below.gunHitRefreshesStatuses).toBe(false);

      // Rank 10 perks across all 3 branches
      const r10 = computeClassModifiers(
        'wizard',
        withSkills({ spellPower: 10, attack: 10, marksmanship: 10 }),
      );
      // Magic 10 — Weaver
      expect(r10.wovenSpellCostMult).toBeCloseTo(0.85, 5);
      expect(r10.wovenCastSpeedMult).toBeCloseTo(1.25, 5);
      expect(r10.gunCritTriggersWeave).toBe(true);
      // Combat 10 — Spellblade
      expect(r10.meleeHitManaFrac).toBeCloseTo(0.08, 5);
      // Gunslinger 10 — Runic Rounds
      expect(r10.elementProcBonus).toBeCloseTo(0.15, 5);
      expect(r10.gunHitRefreshesStatuses).toBe(true);
      // Rank 20 perks still locked
      expect(r10.protectionCleansesStatus).toBe(false);
      expect(r10.parryTriggersShockwave).toBe(false);
      expect(r10.manaFedMagShots).toBe(0);

      // Rank 20 perks across all 3 branches
      const r20 = computeClassModifiers('wizard', MAX_ALL);
      // Magic 20 — Archmage's Ward
      expect(r20.protectionCleansesStatus).toBe(true);
      expect(r20.protectionGrantsShield).toBe(true);
      expect(r20.elementalProcEchoesBolt).toBe(true);
      // Combat 20 — Aegis Parry
      expect(r20.parryTriggersShockwave).toBe(true);
      // Gunslinger 20 — Mana-Fed Mag
      expect(r20.manaFedMagShots).toBe(3);
    });
  });

  describe('Soldier Sproto', () => {
    it('applies innate Combat Ready passive at Lv 1', () => {
      const m = computeClassModifiers('soldier', noSkills());
      expect(m.swapSpeedMult).toBeCloseTo(1.15, 5);
      expect(m.reloadSpeedMult).toBeCloseTo(1.15, 5);
      expect(m.spellsFireAsBullets).toBe(true);
    });

    it('applies signature Tactical Handling (handling ranks + dual wield)', () => {
      const single = computeClassModifiers('soldier', withSkills({ handling: 5 }), { dualWielding: false });
      const dual = computeClassModifiers('soldier', withSkills({ handling: 5 }), { dualWielding: true });
      expect(single.dualWieldFireRateMult).toBeCloseTo(1.15, 5);
      expect(single.dualWieldSpreadMult).toBeCloseTo(0.85, 5);
      expect(dual.fireRateMult).toBeGreaterThan(single.fireRateMult);
      expect(dual.recoilSpreadMult).toBeLessThan(single.recoilSpreadMult);
    });

    it('applies all 6 Soldier rank 10 / 20 branch perks', () => {
      const r10 = computeClassModifiers(
        'soldier',
        withSkills({ spellPower: 10, attack: 10, marksmanship: 10 }),
      );
      // Magic 10 — Ordnance Caster
      expect(r10.spellInheritsGunCritFrac).toBeCloseTo(0.25, 5);
      expect(r10.spellInheritsGunElement).toBe(true);
      // Combat 10 — CQC Specialist
      expect(r10.poiseDmgMult).toBeCloseTo(1.35, 5);
      // Gunslinger 10 — Quickdraw
      expect(r10.stowedAutoReloadTicks).toBe(180);
      expect(r10.quickdrawFireRateBonus).toBeCloseTo(0.15, 5);
      // Rank 20 still locked
      expect(r10.castRefillsMagFrac).toBe(0);
      expect(r10.uninterruptibleHeavy).toBe(false);
      expect(r10.uninterruptibleReload).toBe(false);
      expect(r10.weakspotRefundsAmmo).toBe(false);

      const r20Idle = computeClassModifiers('soldier', MAX_ALL, { slidingOrDashing: false });
      const r20Sliding = computeClassModifiers('soldier', MAX_ALL, { slidingOrDashing: true });
      // Magic 20 — Suppressive Barrage
      expect(r20Idle.castRefillsMagFrac).toBeCloseTo(0.3, 5);
      // Combat 20 — Unshaken
      expect(r20Idle.uninterruptibleHeavy).toBe(true);
      expect(r20Idle.uninterruptibleReload).toBe(true);
      expect(r20Idle.damageResist).toBe(0);
      expect(r20Sliding.damageResist).toBeCloseTo(0.15, 5);
      // Gunslinger 20 — Deadeye
      expect(r20Idle.weakspotRefundsAmmo).toBe(true);
      expect(r20Idle.deadeyeCritPerStack).toBeCloseTo(0.2, 5);
      expect(r20Idle.deadeyeMaxStacks).toBe(3);
    });
  });

  describe('Pepe Warrior', () => {
    it('applies innate Vanguard Poise passive at Lv 1', () => {
      const m = computeClassModifiers('pepe_warrior', noSkills());
      expect(m.meleeDmgMult).toBeCloseTo(1.15, 5);
      expect(m.poiseDmgMult).toBeCloseTo(1.15, 5);
      expect(m.maxHpMult).toBeCloseTo(1.15, 5);
      expect(m.swingStaggerReduction).toBeCloseTo(0.25, 5);
    });

    it("applies signature Warlord's Might (attack ranks: +5% melee, +6% poise, plunge & riposte)", () => {
      const m = computeClassModifiers('pepe_warrior', withSkills({ attack: 10 }));
      // (1 + 0.05 * 10) * 1.15 = 1.725
      expect(m.meleeDmgMult).toBeCloseTo(1.725, 5);
      // (1 + 0.06 * 10) * 1.15 = 1.84
      expect(m.poiseDmgMult).toBeCloseTo(1.84, 5);
      expect(m.plungeDmgMult).toBeCloseTo(1.5, 5);
      expect(m.counterRiposteMult).toBeCloseTo(1.5, 5);
    });

    it('applies all 6 Pepe Warrior rank 10 / 20 branch perks including Point-Blank Breacher range check', () => {
      const r10Far = computeClassModifiers(
        'pepe_warrior',
        withSkills({ spellPower: 10, defense: 10, marksmanship: 10 }),
        { distanceToTarget: 15 },
      );
      const r10Close = computeClassModifiers(
        'pepe_warrior',
        withSkills({ spellPower: 10, defense: 10, marksmanship: 10 }),
        { distanceToTarget: 6 },
      );
      // Magic 10 — War-Cast
      expect(r10Far.warCastBonusPoise).toBe(true);
      // Combat 10 — Riposte Rush
      expect(r10Far.parryHealFrac).toBeCloseTo(0.06, 5);
      expect(r10Far.riposteEmpowerMult).toBeCloseTo(1.35, 5);
      // Gunslinger 10 — Point-Blank Breacher
      expect(r10Far.pointBlankRange).toBe(8);
      expect(r10Close.gunDmgMult).toBeCloseTo(r10Far.gunDmgMult * 1.25, 5);
      expect(r10Close.poiseDmgMult).toBeCloseTo(r10Far.poiseDmgMult * 1.25, 5);

      const r20 = computeClassModifiers('pepe_warrior', MAX_ALL, { inCloseRange: true });
      // Magic 20 — Battle Ward
      expect(r20.protectionGrantsSuperArmor).toBe(true);
      expect(r20.meleeReflectFrac).toBeCloseTo(0.2, 5);
      // Combat 20 — Unstoppable Juggernaut
      expect(r20.uninterruptibleHeavy).toBe(true);
      expect(r20.meleeKillDamageResist).toBeCloseTo(0.2, 5);
      // Gunslinger 20 — Bayonet Momentum
      expect(r20.meleeKillReloadsGun).toBe(true);
      expect(r20.bayonetBoostShots).toBe(2);
      expect(r20.bayonetBoostDmgMult).toBeCloseTo(1.2, 5);
    });
  });

  describe('Pepe', () => {
    it('applies innate Chaos Freestyle passive when chaining weapon types', () => {
      const idle = computeClassModifiers('pepe', noSkills(), { recentWeaponChain: false });
      const chained = computeClassModifiers('pepe', noSkills(), { recentWeaponChain: true });
      expect(idle.moveSpeedMult).toBe(1);
      expect(idle.spellCritBonus).toBe(0);
      expect(idle.gunCritBonus).toBe(0);

      expect(chained.moveSpeedMult).toBeCloseTo(1.1, 5);
      expect(chained.spellCritBonus).toBeCloseTo(0.1, 5);
      expect(chained.gunCritBonus).toBeCloseTo(0.1, 5);
    });

    it('applies signature Trickster Tempo and scales movementTech dash cooldown', () => {
      const m = computeClassModifiers('pepe', withSkills({ stamina: 10 }));
      expect(m.staminaRegenMult).toBeCloseTo(1.4, 5);
      expect(m.movementCooldownMult).toBeCloseTo(0.7, 5);

      // Verify end-to-end integration with movementTech
      const techState = createMovementTechState();
      stepMovementTech(
        techState,
        {
          pos: { x: 0, y: 0, z: 0 },
          vel: { x: 0, y: 0, z: 0 },
          yaw: 0,
          wishX: 0,
          wishZ: 1,
          grounded: true,
          sprinting: false,
          slidePressed: false,
          dashPressed: true,
          jumpPressed: false,
          grappleHeld: false,
        },
        { slide: true, dash: true, doubleJump: true, grapple: true },
        false,
        m.movementCooldownMult,
      );
      expect(techState.dashCdTicks).toBe(Math.round(MOVEMENT_TECH.dashCooldownTicks * 0.7));
    });

    it('applies all 6 Pepe rank 10 / 20 branch perks including Akimbo Ace dual wield', () => {
      const r10Single = computeClassModifiers(
        'pepe',
        withSkills({ spellPower: 10, attack: 10, marksmanship: 10 }),
        { dualWielding: false },
      );
      const r10Dual = computeClassModifiers(
        'pepe',
        withSkills({ spellPower: 10, attack: 10, marksmanship: 10 }),
        { dualWielding: true },
      );
      // Magic 10 — Chaos Weave
      expect(r10Single.weaveCooldownTrimTicks).toBe(60);
      expect(r10Single.gunHitTriggersWeave).toBe(true);
      // Combat 10 — Evasive Counter
      expect(r10Single.parryHealFrac).toBeCloseTo(0.05, 5);
      expect(r10Single.evasiveCounterGuaranteesCrit).toBe(true);
      // Gunslinger 10 — Akimbo Ace
      expect(r10Single.dualWieldFireRateMult).toBeCloseTo(1.2, 5);
      expect(r10Single.dualWieldSpreadMult).toBeCloseTo(0.8, 5);
      expect(r10Single.dualWieldReloadMult).toBeCloseTo(1.2, 5);
      expect(r10Dual.fireRateMult).toBeCloseTo(r10Single.fireRateMult * 1.2, 5);
      expect(r10Dual.reloadSpeedMult).toBeCloseTo(r10Single.reloadSpeedMult * 1.2, 5);
      expect(r10Dual.recoilSpreadMult).toBeCloseTo(r10Single.recoilSpreadMult * 0.8, 5);

      const r20 = computeClassModifiers('pepe', MAX_ALL);
      // Magic 20 — Wild Surge
      expect(r20.wildSurgeEveryN).toBe(4);
      // Combat 20 — Freestyle Finisher
      expect(r20.freestyleFinisherBurst).toBe(true);
      // Gunslinger 20 — Wacky Overdrive
      expect(r20.wackyProcRateMult).toBeCloseTo(1.5, 5);
      expect(r20.nonLegendaryCritMiniProc).toBe(true);
    });
  });
});
