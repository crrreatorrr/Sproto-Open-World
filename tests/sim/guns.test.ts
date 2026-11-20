import { describe, expect, it } from 'vitest';
import {
  GUNS,
  GUNS_BY_ITEM_ID,
  GUN_ITEM_IDS,
  GUN_TYPE_IDS,
  SCOPE_ZOOM2,
  computeGunStats,
  gunDef,
  gunRange,
  isDualWieldGun,
  rangeFalloff,
  resolveGunType,
  zoomFovFor,
  zoomLevelsOf,
} from '../../src/content/guns';
import {
  SHIELD_DAMAGE_MULT,
  computeEnemyHitZones,
  createGunRuntimeState,
  raycastEnemyZones,
  resolveElementProc,
  resolveHitscanShot,
  startReload,
  stepGunFire,
  tickReload,
  type HitboxEnemyInput,
} from '../../src/sim/combat/ballistics';
import {
  DUAL_MUZZLE_OFFSET_M,
  canDualWield,
  createDualWieldState,
  dualMuzzleOffset,
  stepDualWieldFire,
} from '../../src/sim/combat/dualWield';
import { defaultAmmo } from '../../src/sim/entity';
import { seedStream } from '../../src/sim/rng';

function makeEnemy(
  id: number,
  x: number,
  y: number,
  z: number,
  opts?: Partial<HitboxEnemyInput>,
): HitboxEnemyInput {
  return {
    id,
    kind: 'enemy',
    tf: { pos: { x, y, z }, yaw: 0 },
    body: { radius: 0.45, height: 1.8 },
    combat: { action: null },
    view: { scale: 1 },
    ...opts,
  };
}

describe('fixed guns (src/content/guns.ts)', () => {
  it('defines all 9 iconic fixed guns keyed by GunType and item id with zero manufacturers', () => {
    expect(GUN_TYPE_IDS).toHaveLength(9);
    expect(GUN_ITEM_IDS).toHaveLength(9);

    for (const type of GUN_TYPE_IDS) {
      const def = GUNS[type];
      expect(def.id).toBe(type);
      expect(GUNS_BY_ITEM_ID[def.itemId]).toBe(def);
      expect(resolveGunType(def.itemId)).toBe(type);
      expect(gunDef(type)).toBe(def);
      expect(gunDef(def.itemId)).toBe(def);
      expect('manufacturer' in def).toBe(false);

      const stats = computeGunStats(type, 1);
      expect(stats.damage).toBeGreaterThan(0);
      expect(stats.magSize).toBeGreaterThanOrEqual(1);
    }

    // Key iconic traits
    expect(GUNS.mg.ammoType).toBe('light');
    expect(GUNS.mg.rarity).toBe('common');

    expect(GUNS.handgun.dualWield).toBe(true);
    expect(GUNS.handgun.rarity).toBe('common');

    expect(GUNS.machinepistol.dualWield).toBe(true);
    expect(GUNS.machinepistol.rarity).toBe('uncommon');

    expect(GUNS.shotgun.ammoType).toBe('shells');
    expect(GUNS.shotgun.base.pellets).toBe(9);

    expect(GUNS.sniper.ammoType).toBe('sniper');
    expect(GUNS.sniper.rarity).toBe('rare');
    expect(GUNS.sniper.zoomLevels).toBe(2);
    expect(GUNS.sniper.base.pierce).toBe(1);

    expect(GUNS.bazooka.ammoType).toBe('rockets');
    expect(GUNS.bazooka.projectile).toBe('rocket');
    expect(GUNS.bazooka.base.splashRadius).toBeGreaterThan(0);

    expect(GUNS.raygun.rarity).toBe('epic');
    expect(GUNS.raygun.element).toBe('shock');
    expect(GUNS.raygun.base.pierce).toBe(2);

    expect(GUNS.bigbullets.rarity).toBe('epic');
    expect(GUNS.bigbullets.element).toBe('fire');
    expect(GUNS.bigbullets.base.pierce).toBe(1);
    expect(GUNS.bigbullets.base.splashRadius).toBeGreaterThan(0);

    expect(GUNS.duckgun.rarity).toBe('legendary');
    expect(GUNS.duckgun.element).toBe('goo');
    expect(GUNS.duckgun.projectile).toBe('rubberBullet');
    expect(GUNS.duckgun.base.bounces).toBe(1);
    expect(GUNS.duckgun.base.splashRadius).toBeGreaterThan(0);
  });

  it('scales cleanly across Lv 1–30, applies skillMods, range falloff, and 2-stage sniper zoom', () => {
    const lv1 = computeGunStats('mg', 1);
    const lv30 = computeGunStats('mg', 30);
    expect(lv30.damage).toBeGreaterThan(lv1.damage * 4);
    expect(computeGunStats('gun_mg', 15)).toEqual(computeGunStats('mg', 15));

    const sniperBase = computeGunStats('sniper', 10);
    const sniperBoosted = computeGunStats('sniper', 10, {
      dmgMult: 1.4,
      reloadMult: 0.75,
      fireRateMult: 1.2,
      magMult: 1.5,
      critBonus: 0.15,
    });
    expect(sniperBoosted.damage).toBeCloseTo(sniperBase.damage * 1.4, 1);
    expect(sniperBoosted.reloadTime).toBeCloseTo(sniperBase.reloadTime * 0.75, 1);
    expect(sniperBoosted.fireRate).toBeCloseTo(sniperBase.fireRate * 1.2, 1);
    expect(sniperBoosted.magSize).toBe(Math.round(sniperBase.magSize * 1.5));
    expect(sniperBoosted.critChance).toBeCloseTo(sniperBase.critChance + 0.15, 3);

    expect(zoomLevelsOf('sniper')).toBe(2);
    expect(zoomLevelsOf('mg')).toBe(1);
    expect(zoomFovFor('sniper', sniperBase, 2)).toBeCloseTo(
      zoomFovFor('sniper', sniperBase, 1) * SCOPE_ZOOM2,
      5,
    );

    const sgRange = gunRange('shotgun');
    expect(rangeFalloff(sgRange, sgRange.full)).toBe(1);
    expect(rangeFalloff(sgRange, sgRange.max)).toBeCloseTo(sgRange.min, 5);
    expect(rangeFalloff(sgRange, sgRange.max + 1)).toBe(0);
  });
});

describe('multi-zone hitboxes, ballistics, elements & reload (src/sim/combat/ballistics.ts)', () => {
  it('resolves analytic weak > shield > body priority', () => {
    const shielded = makeEnemy(1, 0, 0, 10, {
      tf: { pos: { x: 0, y: 0, z: 10 }, yaw: Math.PI },
      brain: { def: 'bigObama' },
    });

    const zones = computeEnemyHitZones(shielded);
    const weakZone = zones.find((z) => z.zone === 'weak');
    const shieldZone = zones.find((z) => z.zone === 'shield');
    const bodyZone = zones.find((z) => z.zone === 'body');
    expect(weakZone).toBeDefined();
    expect(shieldZone).toBeDefined();
    expect(bodyZone).toBeDefined();

    // Head shot -> weak
    const headY = weakZone && weakZone.kind === 'sphere' ? weakZone.y : 1.65;
    const headHit = raycastEnemyZones(
      { x: 0, y: headY, z: 0 },
      { x: 0, y: 0, z: 1 },
      50,
      [shielded],
    );
    expect(headHit?.zone).toBe('weak');

    // Front torso -> shield
    const shieldHit = raycastEnemyZones(
      { x: 0, y: 0.95, z: 0 },
      { x: 0, y: 0, z: 1 },
      50,
      [shielded],
    );
    expect(shieldHit?.zone).toBe('shield');

    // Rear torso -> body
    const backHit = raycastEnemyZones(
      { x: 0, y: 0.95, z: 20 },
      { x: 0, y: 0, z: -1 },
      50,
      [shielded],
    );
    expect(backHit?.zone).toBe('body');
  });

  it('handles pierce, Crit-Weave, shield mitigation, and unified elements (fire/shock/goo)', () => {
    const e1 = makeEnemy(1, 0, 0, 10);
    const e2 = makeEnemy(2, 0, 0, 14);
    const e3 = makeEnemy(3, 2, 0, 10); // within 5m of e1
    const e4 = makeEnemy(4, 4, 0, 10); // within 5m of e3

    const headZone = computeEnemyHitZones(e1).find((z) => z.zone === 'weak')!;
    const headY = headZone.kind === 'sphere' ? headZone.y : 1.65;

    // Raygun: pierce = 2 + shock element (2-target 5m chain at 0.5x)
    const rayStats = { ...computeGunStats('raygun', 10), elementChance: 1, critChance: 0 };
    const rayRes = resolveHitscanShot({
      gun: 'raygun',
      stats: rayStats,
      origin: { x: 0, y: headY, z: 0 },
      dir: { x: 0, y: 0, z: 1 },
      enemies: [e1, e2, e3, e4],
      rng: seedStream(1, 'ray'),
    });

    expect(rayRes.hits).toHaveLength(2);
    expect(rayRes.hits[0].isWeak).toBe(true);
    expect(rayRes.hits[0].critWeave).toBe(true);
    expect(rayRes.critWeaveTriggered).toBe(true);
    expect(rayRes.hits[0].statusProc?.status).toBe('shock');
    expect(rayRes.hits[0].shockChains).toHaveLength(2);
    expect(rayRes.hits[0].shockChains[0].damage).toBe(Math.round(rayRes.hits[0].damage * 0.5));

    // Fire -> Burn, Goo -> Chill/Slow (0.4x normal, 0.2x on boss)
    const fireProc = resolveElementProc('fire', 50, e1, [e1]);
    expect(fireProc.statusProc.status).toBe('burn');

    const gooNormal = resolveElementProc('goo', 50, e1, [e1]);
    expect(gooNormal.statusProc.status).toBe('chill');
    expect(gooNormal.statusProc.slowFrac).toBeCloseTo(0.4, 5);

    const boss = makeEnemy(9, 0, 0, 10, { kind: 'boss' });
    const gooBoss = resolveElementProc('goo', 50, boss, [boss]);
    expect(gooBoss.statusProc.status).toBe('chill');
    expect(gooBoss.statusProc.slowFrac).toBeCloseTo(0.2, 5);

    // Shield reduces damage to 0.1x
    const shielded = makeEnemy(10, 0, 0, 10, {
      tf: { pos: { x: 0, y: 0, z: 10 }, yaw: Math.PI },
      shieldFront: true,
    });
    const shieldRes = resolveHitscanShot({
      gun: 'mg',
      stats: { ...computeGunStats('mg', 1), damage: 100, critChance: 0, elementChance: 0 },
      origin: { x: 0, y: 0.95, z: 0 },
      dir: { x: 0, y: 0, z: 1 },
      enemies: [shielded],
      rng: seedStream(2, 'shield'),
    });
    expect(shieldRes.hits[0].zone).toBe('shield');
    expect(shieldRes.hits[0].damage).toBe(Math.round(100 * SHIELD_DAMAGE_MULT));
  });

  it('spawns fixed projectiles for bazooka, bigbullets, and bouncing duckgun', () => {
    const ammo = defaultAmmo();
    const rng = seedStream(5, 'proj');
    const origin = { x: 0, y: 1.5, z: 0 };
    const aimDir = { x: 0, y: 0, z: 1 };

    const bazRt = createGunRuntimeState('bazooka');
    const bazRes = stepGunFire({
      runtime: bazRt,
      gun: 'bazooka',
      ammo,
      fireHeld: true,
      origin,
      aimDir,
      enemies: [],
      rng,
    });
    expect(bazRes.fired).toBe(true);
    expect(bazRes.projectiles[0].kind).toBe('rocket');
    expect(bazRes.projectiles[0].splash?.radius).toBe(4.0);

    const bbRt = createGunRuntimeState('bigbullets');
    const bbRes = stepGunFire({
      runtime: bbRt,
      gun: 'bigbullets',
      ammo,
      fireHeld: true,
      origin,
      aimDir,
      enemies: [],
      rng,
    });
    expect(bbRes.projectiles[0].kind).toBe('bigBullet');
    expect(bbRes.projectiles[0].element).toBe('fire');
    expect(bbRes.projectiles[0].pierce).toBe(1);

    const duckRt = createGunRuntimeState('duckgun');
    const duckRes = stepGunFire({
      runtime: duckRt,
      gun: 'duckgun',
      ammo,
      fireHeld: true,
      origin,
      aimDir,
      enemies: [],
      rng,
    });
    expect(duckRes.projectiles[0].kind).toBe('rubberBullet');
    expect(duckRes.projectiles[0].element).toBe('goo');
    expect(duckRes.projectiles[0].bounces).toBe(1);
    expect(duckRes.projectiles[0].splash?.radius).toBe(3.6);
  });

  it('consumes reserve ammo during reload and respects empty/infinite reserves', () => {
    const ammo = defaultAmmo();
    ammo.shells = 4;

    const rt = createGunRuntimeState('shotgun');
    rt.mag = 0;
    const start = startReload(rt, 'shotgun', ammo);
    expect(start.started).toBe(true);

    let completed = false;
    for (let i = 0; i < start.reloadTicks; i++) {
      if (tickReload(rt, 'shotgun', ammo).completed) completed = true;
    }
    expect(completed).toBe(true);
    expect(rt.mag).toBe(4);
    expect(ammo.shells).toBe(0);

    // Empty reserve fails cleanly
    rt.mag = 0;
    const empty = startReload(rt, 'shotgun', ammo);
    expect(empty.started).toBe(false);
    expect(empty.reason).toBe('empty_reserve');

    // Infinite reserve gun (raygun) reloads without consuming reserve
    const rayRt = createGunRuntimeState('raygun');
    rayRt.mag = 0;
    ammo.light = 0;
    const rayStart = startReload(rayRt, 'raygun', ammo);
    expect(rayStart.started).toBe(true);
    for (let i = 0; i < rayStart.reloadTicks; i++) tickReload(rayRt, 'raygun', ammo);
    expect(rayRt.mag).toBe(computeGunStats('raygun').magSize);
    expect(ammo.light).toBe(0);
  });
});

describe('dual wield (src/sim/combat/dualWield.ts)', () => {
  it('only permits handgun and machinepistol pairings (by GunType or item id)', () => {
    expect(isDualWieldGun('handgun')).toBe(true);
    expect(isDualWieldGun('gun_machinepistol')).toBe(true);
    expect(canDualWield('handgun', 'machinepistol')).toBe(true);
    expect(canDualWield('gun_handgun', 'gun_handgun')).toBe(true);
    expect(canDualWield('handgun', 'mg')).toBe(false);
    expect(canDualWield('shotgun', 'machinepistol')).toBe(false);
    expect(canDualWield('handgun', null)).toBe(false);
  });

  it('alternates hands, applies ±0.16m lateral muzzle offsets, disables ADS, and reloads independently', () => {
    const rt = createGunRuntimeState('handgun');
    rt.adsActive = true;
    rt.scopeZoom = 1;
    rt.dual = createDualWieldState('machinepistol');

    // Empty right hand after 1 shot so left keeps firing while right reloads
    rt.mag = 1;
    rt.dual.offhandMag = 6;

    const ammo = defaultAmmo();
    const rng = seedStream(77, 'dual');
    const origin = { x: 0, y: 1.5, z: 0 };
    const aimDir = { x: 0, y: 0, z: 1 };

    const rOff = dualMuzzleOffset(0, 'right');
    const lOff = dualMuzzleOffset(0, 'left');
    expect(Math.hypot(rOff.x, rOff.y, rOff.z)).toBeCloseTo(DUAL_MUZZLE_OFFSET_M, 5);
    expect(rOff.x).toBeCloseTo(-lOff.x, 5);

    const firedHands: ('right' | 'left')[] = [];
    let rightReloadStarted = false;
    let leftFiredWhileRightReloaded = false;

    for (let tick = 0; tick < 60; tick++) {
      const res = stepDualWieldFire({
        runtime: rt,
        rightGun: 'handgun',
        ammo,
        fireHeld: true,
        yaw: 0,
        origin,
        aimDir,
        enemies: [],
        rng,
      });
      expect(rt.adsActive).toBe(false);
      expect(rt.scopeZoom).toBe(0);

      if (res.rightReloadStarted) rightReloadStarted = true;
      if (res.fired) {
        firedHands.push(res.hand as 'right' | 'left');
        const expected = dualMuzzleOffset(0, res.hand as 'right' | 'left');
        expect(res.muzzleOrigin.x).toBeCloseTo(origin.x + expected.x, 5);
        if (res.hand === 'left' && rt.reloadTicks > 0) leftFiredWhileRightReloaded = true;
      }
    }

    expect(firedHands[0]).toBe('right');
    expect(firedHands[1]).toBe('left');
    expect(rightReloadStarted).toBe(true);
    expect(leftFiredWhileRightReloaded).toBe(true);

    // Finish right hand reload
    let rightReloadCompleted = false;
    for (let tick = 0; tick < 120; tick++) {
      const res = stepDualWieldFire({
        runtime: rt,
        rightGun: 'handgun',
        ammo,
        fireHeld: false,
        yaw: 0,
        origin,
        aimDir,
        enemies: [],
        rng,
      });
      if (res.rightReloadCompleted) {
        rightReloadCompleted = true;
        break;
      }
    }
    expect(rightReloadCompleted).toBe(true);
    expect(rt.mag).toBe(computeGunStats('handgun').magSize);
  });
});
