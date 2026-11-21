import { describe, expect, it } from 'vitest';
import { GUNS } from '../../src/content/guns';
import { createGunRuntimeState, stepGunFire, type HitboxEnemyInput } from '../../src/sim/combat/ballistics';
import { GUN_AIM, aimShot, crosshairPoint, simMuzzle, type WorldRay } from '../../src/sim/combat/gunAim';
import { defaultAmmo } from '../../src/sim/entity';
import type { Vec3 } from '../../src/sim/math';
import { seedStream } from '../../src/sim/rng';

const enemy = (id: number, x: number, z: number): HitboxEnemyInput => ({
  id,
  kind: 'enemy',
  tf: { pos: { x, y: 0, z }, yaw: 0 },
  body: { radius: 0.45, height: 1.8 },
  combat: { action: null },
  view: { scale: 1 },
});

const openWorld: WorldRay = () => null;
/** A wall across the world at `z`, seen from the -z side. */
const wallAtZ = (z: number, fromX = -Infinity, toX = Infinity): WorldRay => (o, d, max) => {
  if (d.z <= 1e-9 || o.z >= z) return null;
  const t = (z - o.z) / d.z;
  const x = o.x + d.x * t;
  return t <= max && x >= fromX && x <= toX ? t : null;
};

const feet: Vec3 = { x: 0, y: 0, z: 0 };
/** An over-the-shoulder camera at body height: behind and to the right of the player, looking along +z. */
const camera = (dir: Vec3 = { x: 0, y: 0, z: 1 }) => ({ from: { x: -0.55, y: 1.3, z: -3.4 }, dir });
const dist = (a: Vec3, b: Vec3) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

describe('gun aim: the shot leaves the barrel and goes to the crosshair point', () => {
  it('puts the barrel beside the body and out along the aim, further for a longer gun', () => {
    const fwd = { x: 0, y: 0, z: 1 };
    const mg = simMuzzle(feet, fwd, 'mg');
    const sniper = simMuzzle(feet, fwd, 'sniper');
    // Yaw 0 faces +z, and the right hand is on -x.
    expect(mg.x).toBeCloseTo(-GUN_AIM.handRight);
    expect(mg.y).toBeCloseTo(GUN_AIM.handUp);
    expect(mg.z).toBeCloseTo(GUN_AIM.gripForward + GUNS.mg.length * GUN_AIM.barrelShare);
    expect(sniper.z).toBeGreaterThan(mg.z);
    expect(simMuzzle(feet, fwd, 'handgun', 'left').x).toBeCloseTo(GUN_AIM.handRight);
  });

  it('finds the crosshair point on an enemy, on a wall, or at range', () => {
    const ray = camera();
    const onEnemy = crosshairPoint(ray, feet, [enemy(1, -0.55, 20)], openWorld);
    expect(onEnemy.z).toBeGreaterThan(19);
    expect(onEnemy.z).toBeLessThan(20);
    expect(crosshairPoint(ray, feet, [], wallAtZ(12)).z).toBeCloseTo(12);
    expect(crosshairPoint(ray, feet, [], openWorld, 80).z).toBeGreaterThan(70);
  });

  it('ignores what stands between the camera and the player', () => {
    // An enemy right behind the player, on the camera's ray.
    const p = crosshairPoint(camera(), feet, [enemy(1, -0.55, -2)], openWorld, 80);
    expect(p.z).toBeGreaterThan(70);
  });

  it('aims the shot from the barrel at the crosshair point, so it hits what the crosshair is on', () => {
    const target = enemy(1, -0.55, 25);
    const aim = aimShot({ pos: feet, gun: 'sniper', ray: camera(), fallbackDir: { x: 0, y: 0, z: 1 }, enemies: [target], worldRay: openWorld });
    expect(aim.origin).toEqual(simMuzzle(feet, { x: 0, y: 0, z: 1 }, 'sniper'));
    expect(aim.blocked).toBeNull();
    // The line from the barrel passes through the point.
    const t = dist(aim.origin, aim.point);
    expect(aim.origin.x + aim.dir.x * t).toBeCloseTo(aim.point.x, 4);
    expect(aim.origin.y + aim.dir.y * t).toBeCloseTo(aim.point.y, 4);

    const runtime = createGunRuntimeState('sniper');
    runtime.adsActive = true; // no spread
    const res = stepGunFire({
      runtime, gun: 'sniper', ammo: defaultAmmo(), fireHeld: true, origin: aim.origin, aimDir: aim.dir,
      enemies: [target], rng: seedStream(7, 'gun'), worldRay: openWorld,
    });
    expect(res.fired).toBe(true);
    expect(res.hits.map((h) => h.entityId)).toEqual([1]);
    expect(res.tracers[0]!.from).toEqual(aim.origin);
  });

  it('a shot parallel to the camera from the chest would have missed that target', () => {
    // The old behaviour: the body centre, the camera's direction. The enemy stands where the crosshair is.
    const target = enemy(1, -0.55, 25);
    const runtime = createGunRuntimeState('sniper');
    runtime.adsActive = true;
    const res = stepGunFire({
      runtime, gun: 'sniper', ammo: defaultAmmo(), fireHeld: true, origin: { x: 0, y: 1.45, z: 0 }, aimDir: { x: 0, y: 0, z: 1 },
      enemies: [target], rng: seedStream(7, 'gun'),
    });
    expect(res.hits).toHaveLength(0);
  });

  it('marks the shot as blocked when cover is in front of the barrel but not the crosshair', () => {
    // A low wall 2 m ahead that covers the barrel's side (x <= 0) and leaves the camera's line clear.
    const cover = wallAtZ(2, -0.4, 5);
    const aim = aimShot({ pos: feet, gun: 'mg', ray: camera(), fallbackDir: { x: 0, y: 0, z: 1 }, enemies: [enemy(1, -0.55, 25)], worldRay: cover });
    expect(aim.point.z).toBeGreaterThan(19);
    expect(aim.blocked).not.toBeNull();
    expect(aim.blocked!.z).toBeCloseTo(2, 1);
  });

  it('fires from the chest when the barrel is inside a wall', () => {
    const aim = aimShot({ pos: feet, gun: 'sniper', ray: camera(), fallbackDir: { x: 0, y: 0, z: 1 }, enemies: [], worldRay: wallAtZ(0.6) });
    expect(aim.origin).toEqual({ x: 0, y: GUN_AIM.chestY, z: 0 });
  });

  it('does not bend the shot toward a point closer than the convergence floor', () => {
    const aim = aimShot({ pos: feet, gun: 'handgun', ray: camera(), fallbackDir: { x: 0, y: 0, z: 1 }, enemies: [], worldRay: wallAtZ(1.5) });
    expect(aim.dir).toEqual({ x: 0, y: 0, z: 1 });
    expect(aim.blocked).toBeNull();
  });

  it('with no camera ray, fires straight ahead from the barrel', () => {
    const aim = aimShot({ pos: feet, gun: 'mg', ray: undefined, fallbackDir: { x: 1, y: 0, z: 0 }, enemies: [], worldRay: openWorld });
    expect(aim.dir).toEqual({ x: 1, y: 0, z: 0 });
    expect(aim.blocked).toBeNull();
  });

  it('gives each shotgun pellet its own world check', () => {
    let rays = 0;
    const counting: WorldRay = () => (rays++, null);
    const runtime = createGunRuntimeState('shotgun');
    stepGunFire({
      runtime, gun: 'shotgun', ammo: defaultAmmo(), fireHeld: true, origin: { x: 0, y: 1.4, z: 0 }, aimDir: { x: 0, y: 0, z: 1 },
      enemies: [], rng: seedStream(3, 'gun'), worldRay: counting,
    });
    expect(rays).toBe(GUNS.shotgun.base.pellets);
  });
});

describe('gun aim in the world tick', () => {
  it('a shot fired with the crosshair on an enemy hits it, and reports its tracer from the barrel', async () => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const { ENEMIES } = await import('../../src/content/enemies');
    const { w } = await combatWorld();
    const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
    p.progress!.equipment.staff = 'gun_raygun';
    p.progress!.weapons = ['gun_raygun', null, null, null];
    // Where the over-the-shoulder crosshair points: half a metre right of the body's own line.
    const foe = w.spawnEnemy(Object.keys(ENEMIES)[0]!, { x: 30 - 0.55, y: 0, z: 42 });
    const hp = foe.vitals!.hp;
    const c = cmd({ press: BTN.light });
    c.aim = { from: { x: 30 - 0.55, y: 1.1, z: 30 - 3.4 }, dir: { x: 0, y: 0, z: 1 } };
    w.tick(new Map([[1, c]]));
    const ev = w.gunEvents.find((g) => g.entity === p.id);
    expect(ev?.fired).toBe(true);
    expect(ev!.hit).toBe(true);
    expect(foe.vitals!.hp).toBeLessThan(hp);
    expect(ev!.tracers).toHaveLength(1);
    expect(ev!.tracers[0]!.from).toEqual(ev!.muzzle);
    expect(ev!.muzzle.z).toBeGreaterThan(30.3);
    expect(w.gunRuntime(1)!.aim!.blocked).toBeNull();
    w.dispose();
  });

  it('a duck round falls and bounces, a rocket flies straight', async () => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const { w } = await combatWorld();
    const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
    p.progress!.equipment.staff = 'gun_duckgun';
    p.progress!.weapons = ['gun_duckgun', null, null, null];
    w.tick(new Map([[1, cmd({ press: BTN.light })]]));
    const round = w.entities.find((e) => e.projectile && e.projectile.owner === p.id)!;
    expect(round.projectile!.gravity).toBeGreaterThan(0);
    expect(round.projectile!.bounces).toBe(1);
    // Drawn as Sproto Shooter's rubber bullet, not a tracer.
    expect(round.view.model).toBe('rubber_bullet');
    expect(round.projectile!.splash!.damage).toBeGreaterThan(0);
    expect(w.events.some((e) => e.type === 'fire')).toBe(false);
    const vy = round.tf.vel.y;
    w.tick(new Map([[1, cmd()]]));
    expect(round.tf.vel.y).toBeLessThan(vy);
    w.dispose();
  });
});

describe('zoom by weapon', () => {
  it('is none while dual wielding, one step for most guns and two for the sniper', async () => {
    const { nextZoom, zoomStepsOf, GUN_TYPE_IDS } = await import('../../src/content/guns');
    for (const g of GUN_TYPE_IDS) expect(zoomStepsOf(g, false)).toBe(g === 'sniper' ? 2 : 1);
    expect(zoomStepsOf('handgun', true)).toBe(0);
    expect(zoomStepsOf('machinepistol', true)).toBe(0);
    expect([nextZoom(0, 1), nextZoom(1, 1)]).toEqual([1, 0]);
    expect([nextZoom(0, 2), nextZoom(1, 2), nextZoom(2, 2)]).toEqual([1, 2, 0]);
    expect(nextZoom(0, 0)).toBe(0);
  });

  const soldierWith = async (weapons: (string | null)[]) => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const { w } = await combatWorld();
    const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
    p.progress!.equipment.staff = weapons[0]!;
    p.progress!.weapons = weapons;
    p.progress!.activeWeaponSlot = 0;
    const tick = (c = cmd()) => w.tick(new Map([[1, c]]));
    const zoom = () => w.gunRuntime(1)!.runtime.scopeZoom;
    return { w, p, tick, zoom, BTN, cmd };
  };

  it('each aim press steps the sniper off, 1, 2, off', async () => {
    const { w, tick, zoom, BTN, cmd } = await soldierWith(['gun_sniper', null, null, null]);
    tick();
    const seen: number[] = [];
    for (let i = 0; i < 4; i++) {
      tick(cmd({ press: BTN.aim }));
      seen.push(zoom());
      tick();
    }
    expect(seen).toEqual([1, 2, 0, 1]);
    expect(w.gunRuntime(1)!.runtime.adsActive).toBe(true);
    w.dispose();
  });

  it('the MG has one step, and aiming never raises the guard', async () => {
    const { w, p, tick, zoom, BTN, cmd } = await soldierWith(['gun_mg', null, null, null]);
    tick();
    tick(cmd({ press: BTN.aim }));
    expect(zoom()).toBe(1);
    expect(p.combat!.action).toBeNull();
    tick(cmd({ press: BTN.aim }));
    expect(zoom()).toBe(0);
    w.dispose();
  });

  it('two sidearms on the bar never zoom, a single one does', async () => {
    const dual = await soldierWith(['gun_handgun', 'gun_machinepistol', null, null]);
    dual.tick();
    dual.tick(dual.cmd({ press: dual.BTN.aim }));
    expect(dual.zoom()).toBe(0);
    dual.w.dispose();
    const single = await soldierWith(['gun_handgun', null, null, null]);
    single.tick();
    single.tick(single.cmd({ press: single.BTN.aim }));
    expect(single.zoom()).toBe(1);
    single.w.dispose();
  });

  it('sprinting, reloading and swinging drop the zoom', async () => {
    const { w, tick, zoom, BTN, cmd } = await soldierWith(['gun_mg', null, null, null]);
    tick();
    tick(cmd({ press: BTN.aim }));
    expect(zoom()).toBe(1);
    tick(cmd({ hold: BTN.sprint, move: { x: 0, y: 1 } }));
    expect(zoom()).toBe(0);

    tick(cmd({ press: BTN.aim }));
    tick(cmd({ hold: BTN.light }));
    tick(cmd({ press: BTN.reload }));
    tick();
    expect(zoom()).toBe(0);
    for (let i = 0; i < 200; i++) tick();

    tick(cmd({ press: BTN.aim }));
    expect(zoom()).toBe(1);
    tick(cmd({ press: BTN.melee }));
    tick();
    expect(zoom()).toBe(0);
    w.dispose();
  });

  it('the trigger never swings the gun, and the melee button does', async () => {
    const { w, p, tick, BTN, cmd } = await soldierWith(['gun_mg', null, null, null]);
    tick();
    tick(cmd({ press: BTN.light }));
    expect(p.combat!.action?.kind).not.toBe('attack');
    for (let i = 0; i < 30; i++) tick();
    tick(cmd({ press: BTN.melee }));
    expect(p.combat!.action?.kind).toBe('attack');
    w.dispose();
  });

  it('zoomed, the player moves slower', async () => {
    const run = async (zoomed: boolean) => {
      const { w, p, tick, BTN, cmd } = await soldierWith(['gun_mg', null, null, null]);
      tick();
      if (zoomed) tick(cmd({ press: BTN.aim }));
      for (let i = 0; i < 90; i++) tick(cmd({ move: { x: 0, y: 1 } }));
      const z = p.tf.pos.z;
      w.dispose();
      return z;
    };
    const [hip, zoomed] = [await run(false), await run(true)];
    expect(zoomed - 30).toBeLessThan((hip - 30) * 0.9);
    expect(zoomed - 30).toBeGreaterThan((hip - 30) * 0.6);
  });
});

describe('reload', () => {
  const soldierWith = async (weapons: (string | null)[]) => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const { w } = await combatWorld();
    const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
    p.progress!.equipment.staff = weapons[0]!;
    p.progress!.weapons = weapons;
    p.progress!.activeWeaponSlot = 0;
    const tick = (c = cmd()) => w.tick(new Map([[1, c]]));
    const rt = () => w.gunRuntime(1)!.runtime;
    const swapTo = (slot: number) => {
      const c = cmd();
      c.weaponSlot = slot;
      tick(c);
      tick();
    };
    return { w, p, tick, rt, swapTo, BTN, cmd };
  };

  it('swapping guns keeps each magazine, and never refills one', async () => {
    const { w, p, tick, rt, swapTo, BTN, cmd } = await soldierWith(['gun_mg', 'gun_sniper', null, null]);
    tick();
    const full = rt().mag;
    for (let i = 0; i < 40; i++) tick(cmd({ hold: BTN.light }));
    const left = rt().mag;
    expect(left).toBeLessThan(full);
    swapTo(1);
    expect(p.progress!.equipment.staff).toBe('gun_sniper');
    expect(rt().mag).toBe(GUNS.sniper.base.magSize);
    swapTo(0);
    expect(rt().mag).toBe(left);
    w.dispose();
  });

  it('a drawn gun cannot fire until its swap time has passed, and a swap drops the reload', async () => {
    const { w, tick, rt, swapTo, BTN, cmd } = await soldierWith(['gun_mg', 'gun_sniper', null, null]);
    tick();
    for (let i = 0; i < 20; i++) tick(cmd({ hold: BTN.light }));
    tick(cmd({ press: BTN.reload }));
    expect(rt().reloadTicks).toBeGreaterThan(0);
    swapTo(1);
    expect(rt().reloadTicks).toBe(0);
    tick(cmd({ hold: BTN.light }));
    expect(rt().mag).toBe(GUNS.sniper.base.magSize);
    for (let i = 0; i < 60; i++) tick(cmd({ hold: BTN.light }));
    expect(rt().mag).toBeLessThan(GUNS.sniper.base.magSize);
    w.dispose();
  });

  it('the shotgun loads one shell at a time, and the trigger stops it', async () => {
    const { w, tick, rt, BTN, cmd } = await soldierWith(['gun_shotgun', null, null, null]);
    tick();
    while (rt().mag > 2) {
      tick(cmd({ hold: BTN.light }));
      if (rt().reloadTicks > 0) break;
    }
    for (let i = 0; i < 80; i++) tick();
    expect(rt().mag).toBe(2);
    tick(cmd({ press: BTN.reload }));
    const perShell = rt().reloadTotalTicks;
    expect(perShell).toBeLessThan((GUNS.shotgun.base.reloadTime * 60) / 2);
    for (let i = 0; i < perShell + 1; i++) tick();
    expect(rt().mag).toBe(3);
    expect(rt().reloadTicks).toBeGreaterThan(0);
    tick(cmd({ hold: BTN.light }));
    expect(rt().reloadTicks).toBe(0);
    expect(rt().mag).toBe(2);
    w.dispose();
  });

  it('a swing or a roll drops the reload', async () => {
    const { w, tick, rt, BTN, cmd } = await soldierWith(['gun_mg', null, null, null]);
    tick();
    for (let i = 0; i < 20; i++) tick(cmd({ hold: BTN.light }));
    tick(cmd({ press: BTN.reload }));
    expect(rt().reloadTicks).toBeGreaterThan(0);
    tick(cmd({ press: BTN.melee }));
    tick();
    expect(rt().reloadTicks).toBe(0);
    w.dispose();
  });

  it('a faster reload skill makes the reload shorter', async () => {
    const { computeGunStats } = await import('../../src/content/guns');
    const base = computeGunStats('mg', 1).reloadTime;
    // What the sim passes for a +15% reload speed.
    expect(computeGunStats('mg', 1, { reloadMult: 1 / 1.15 }).reloadTime).toBeLessThan(base);
    const { w, tick, rt, BTN, cmd } = await soldierWith(['gun_mg', null, null, null]);
    tick();
    for (let i = 0; i < 20; i++) tick(cmd({ hold: BTN.light }));
    tick(cmd({ press: BTN.reload }));
    // The Soldier's passive is a faster reload.
    expect(rt().reloadTotalTicks).toBeLessThan(Math.round(GUNS.mg.base.reloadTime * 60));
    w.dispose();
  });

  it('an empty gun with no reserve clicks, and gun state survives a snapshot', async () => {
    const { w, p, tick, rt, BTN, cmd } = await soldierWith(['gun_sniper', null, null, null]);
    tick();
    p.progress!.ammo!.sniper = 0;
    let dry = false;
    for (let i = 0; i < 600 && !dry; i++) {
      tick(cmd({ hold: BTN.light }));
      dry = w.gunEvents.some((g) => g.dryFire);
    }
    expect(dry).toBe(true);
    expect(rt().mag).toBe(0);
    const snap = w.snapshot();
    const hash = w.hash();
    tick(cmd({ press: BTN.aim }));
    expect(w.hash()).not.toBe(hash);
    w.restore(snap);
    expect(rt().mag).toBe(0);
    expect(w.hash()).toBe(hash);
    w.dispose();
  });
});

describe('spread and recoil', () => {
  it('sustained fire opens the hip spread and hardens the kick, and both settle when the trigger is up', async () => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const { w } = await combatWorld();
    const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
    p.progress!.equipment.staff = 'gun_mg';
    p.progress!.weapons = ['gun_mg', null, null, null];
    const tick = (c = cmd()) => w.tick(new Map([[1, c]]));
    const rt = () => w.gunRuntime(1)!.runtime;
    tick();
    const cold = rt().spreadDeg;
    let first = 0, last = 0;
    for (let i = 0; i < 90; i++) {
      tick(cmd({ hold: BTN.light }));
      const ev = w.gunEvents.find((g) => g.fired);
      if (ev && !first) first = ev.recoil.pitchDeg;
      if (ev) last = ev.recoil.pitchDeg;
    }
    expect(rt().heat).toBeGreaterThan(0.5);
    expect(rt().spreadDeg).toBeGreaterThan(cold * 1.3);
    expect(last).toBeGreaterThan(first);
    for (let i = 0; i < 60; i++) tick();
    expect(rt().heat).toBe(0);
    expect(rt().spreadDeg).toBeCloseTo(cold, 5);

    // Zoomed: the tight spread, whatever the heat, and a softer kick.
    tick(cmd({ press: BTN.aim }));
    tick(cmd({ hold: BTN.light }));
    const zoomed = w.gunEvents.find((g) => g.fired)!;
    expect(rt().spreadDeg).toBeLessThan(cold);
    expect(zoomed.recoil.pitchDeg).toBeLessThan(first);
    w.dispose();
  });
});

describe('dual wield, a trigger and a reload per gun', () => {
  const pair = async (weapons: (string | null)[] = ['gun_handgun', 'gun_machinepistol', null, null]) => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const { w } = await combatWorld();
    const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
    p.progress!.equipment.staff = weapons[0]!;
    p.progress!.weapons = weapons;
    p.progress!.activeWeaponSlot = 0;
    const tick = (c = cmd()) => w.tick(new Map([[1, c]]));
    const rt = () => w.gunRuntime(1)!.runtime;
    return { w, p, tick, rt, BTN, cmd };
  };

  it('each trigger fires only its own gun', async () => {
    const { w, tick, rt, BTN, cmd } = await pair();
    tick();
    const right = rt().mag, left = rt().dual!.offhandMag;
    const hands = new Set<string>();
    for (let i = 0; i < 40; i++) {
      tick(cmd({ hold: BTN.light }));
      for (const g of w.gunEvents) if (g.fired) hands.add(g.hand);
    }
    expect([...hands]).toEqual(['right']);
    expect(rt().mag).toBeLessThan(right);
    expect(rt().dual!.offhandMag).toBe(left);

    hands.clear();
    const rightNow = rt().mag;
    for (let i = 0; i < 40; i++) {
      tick(cmd({ hold: BTN.aim }));
      for (const g of w.gunEvents) if (g.fired) hands.add(g.hand);
    }
    expect([...hands]).toEqual(['left']);
    expect(rt().dual!.offhandMag).toBeLessThan(left);
    expect(rt().mag).toBe(rightNow);
    expect(rt().scopeZoom).toBe(0);

    hands.clear();
    for (let i = 0; i < 40; i++) {
      tick(cmd({ hold: BTN.light | BTN.aim }));
      for (const g of w.gunEvents) if (g.fired) hands.add(g.hand);
    }
    expect([...hands].sort()).toEqual(['left', 'right']);
    w.dispose();
  });

  it('each gun reloads on its own, and the other keeps firing', async () => {
    const { w, tick, rt, BTN, cmd } = await pair();
    tick();
    for (let i = 0; i < 30; i++) tick(cmd({ hold: BTN.light | BTN.aim }));
    tick(cmd({ press: BTN.reloadLeft }));
    expect(rt().dual!.reloadTicks).toBeGreaterThan(0);
    expect(rt().reloadTicks).toBe(0);
    const right = rt().mag;
    for (let i = 0; i < 20; i++) tick(cmd({ hold: BTN.light }));
    expect(rt().mag).toBeLessThan(right);
    for (let i = 0; i < 200; i++) tick();
    tick(cmd({ press: BTN.reloadRight }));
    expect(rt().reloadTicks).toBeGreaterThan(0);
    expect(rt().dual!.reloadTicks).toBe(0);
    w.dispose();
  });

  it('the raygun can be one of the pair, and zooms when it is alone', async () => {
    const { isDualWieldGun, zoomStepsOf } = await import('../../src/content/guns');
    expect(isDualWieldGun('raygun')).toBe(true);
    expect(zoomStepsOf('raygun', false)).toBe(1);
    const { w, tick, rt, BTN, cmd } = await pair(['gun_raygun', 'gun_handgun', null, null]);
    tick();
    expect(rt().dual).toBeDefined();
    tick(cmd({ press: BTN.aim }));
    expect(rt().scopeZoom).toBe(0);
    w.dispose();
  });
});

describe('a rocket at your own feet', () => {
  it('hurts its shooter for a share of the blast, and not at all from a distance', async () => {
    const { combatWorld, BTN, cmd } = await import('./combatHelpers');
    const shoot = async (dir: { x: number; y: number; z: number }) => {
      const { w } = await combatWorld();
      const p = w.spawnPlayer(1, { x: 30, y: 0, z: 30 }, 0, 'soldier');
      p.progress!.equipment.staff = 'gun_bazooka';
      p.progress!.weapons = ['gun_bazooka', null, null, null];
      const hp = p.vitals!.hp;
      const c = cmd({ press: BTN.light });
      c.aim = { from: { x: 30 - 0.55, y: 1.6, z: 30 - 3.4 }, dir };
      w.tick(new Map([[1, c]]));
      for (let i = 0; i < 240; i++) w.tick(new Map([[1, cmd()]]));
      const lost = hp - p.vitals!.hp;
      w.dispose();
      return lost;
    };
    const down = Math.hypot(0.9, 0.44);
    expect(await shoot({ x: 0, y: -0.9 / down, z: 0.44 / down })).toBeGreaterThan(0);
    expect(await shoot({ x: 0, y: 0, z: 1 })).toBe(0);
  });
});
