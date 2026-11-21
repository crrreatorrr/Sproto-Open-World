# Gun shooting: design

Date: 2026-11-21. Status: built on `claude/shooter-animations` (uncommitted), ahead of the owner's
sign-off on this document; see "What was built" at the end for where the build differs.

## Why

Guns landed in the unification work, but they do not feel like a shooter. Shots leave the player's
chest, not the gun, and land about half a metre left and low of the crosshair. Nothing is drawn for
a shot: no tracer, no muzzle flash. Reload and zoom are half wired. The owner wants Call of Duty
feel, based on Sproto Shooter's rules, with zoom decided per weapon.

## What the owner decided

- Call of Duty is the reference for feel. Sproto Shooter is the base for rules and numbers.
- Shots must visibly come out of the gun.
- Zoom depends on the weapon: none while dual wielding, one step for the MG and most guns, two for
  the sniper.
- Controls with a gun in hand follow the Call of Duty layout: left mouse / RT fires, right mouse / LT
  aims.
- Guns are played in third person only.
- Zoom is a toggle: each press of aim cycles off, zoom 1, then (sniper only) zoom 2, then off.
- The old Gunfire spell is removed. Guns are the only way to shoot.
- Melee stays shared by every class.

## Goals

1. A shot lands where the crosshair points, and is seen leaving the barrel.
2. Reload is a real beat: it takes time, can be interrupted, and is never free.
3. Zoom follows the weapon, and the camera, spread, look speed and movement all respond to it.
4. Firing has feedback: recoil, spread that grows, hit markers, a blocked-barrel marker.
5. Every part works on a gamepad alone.

## Not in this work

- First-person polish. The first-person toggle does nothing while a gun is in hand (my call, from
  "only third person"). `Viewmodel.ts` is left alone.
- The PvP arena. It has its own guns and rules (`src/sim/pvp`).
- Third-person body animation (aim, shoot, reload poses). The "Sproto Shooter animations import"
  session owns `PlayerView.ts`, `src/render/anim/*` and the character models. This work exposes the
  sim state it needs and asks it for a muzzle position.
- New gun models. The handgun and machine pistol have no third-person model today (they show a
  staff). That is asked of the animation session, not built here.
- Random gun parts, manufacturers and qualities from Sproto Shooter. The nine fixed guns stay.

## What must not happen

- A shot that hits somewhere the crosshair did not show, with no warning.
- Aiming a gun raising the melee guard, or one key doing two things (R reloading and casting).
- Swapping guns refilling the magazine.
- Sim rules reading the camera or a model. `src/sim` stays pure.

## Approaches for the shot origin

**A. Hit from the eye, draw from the gun.** The hit is a ray from the camera. The tracer is drawn
from the barrel to that hit point. This is what Sproto Shooter does. It is simple and the crosshair
is always true. But in third person the camera sits beside and behind the player, so you can shoot
things your character and gun cannot see, such as round a corner you are standing behind.

**B. Fire from the gun toward the crosshair point (picked).** The camera ray only finds the point
the crosshair is on. The bullet then really travels from the barrel to that point. If something is
in the barrel's way, the bullet hits that, and the crosshair shows a small blocked marker at the
real impact. This matches "shots come out of the gun", it is what the unification plan called for
(section 3.1), and it is what third-person shooters do. It costs one extra ray per shot and the
marker.

**C. Fire from the chest toward the crosshair point.** Like B but from the body centre. Cheaper,
but tracers and rockets would still not line up with the barrel.

The owner handed over the how, so I am going with B.

## Design

### 1. Aim and shot origin (sim)

- New pure module `src/sim/combat/gunAim.ts`.
- **Crosshair point.** Each tick a gun player has a command, take the camera ray (`cmd.aim.from`,
  `cmd.aim.dir`). Skip the stretch of the ray that lies behind the player (start at the point on
  the ray level with the player). Cast against the world (`PhysicsWorld.raycast`) and the enemy
  hit zones (`raycastEnemyZones`). The nearest hit is the crosshair point. With no hit, use the
  point at the gun's `range.max` (150 m cap). With no `cmd.aim` (AI, tests), aim straight along
  the body yaw.
- **Sim muzzle.** The sim cannot read the model, so each gun gets a `muzzle` offset in
  `guns.ts`: metres right, up and forward of the player's feet in the aim yaw's frame (roughly
  right 0.22, up 1.35, forward 0.35 plus the gun's length). Dual wield uses mirrored left and right
  offsets and alternates, replacing the fixed ±0.16 m.
- **Direction.** From the sim muzzle to the crosshair point, then the spread cone. If the crosshair
  point is nearer than 3 m, use the camera direction instead, so a close wall does not bend shots
  sideways.
- **Barrel inside a wall.** If the world blocks the short segment from the chest (feet + 1.45 m)
  to the sim muzzle, fire from the chest point instead.
- **Blocked marker.** The sim reports, per player, whether the first thing on the muzzle ray is
  more than 0.5 m from the crosshair point, and where it is. The HUD draws a small red mark there.
- **Facing.** While a gun is in hand and the player fires or is zoomed, the body yaw follows the
  camera yaw, so the gun points where the shot goes.
- **Projectiles** (bazooka, big bullets, duck gun) spawn at the sim muzzle and head for the
  crosshair point. The fields dropped today are carried into `projectiles.ts`: gravity, bounces,
  pierce, splash damage (separate from direct damage), splash falloff and self damage. Their
  duplicate bolt-cast sound is removed.
- Hitscan guns keep `resolveHitscanShot`; only the origin and direction change.
- Guns can fire from the hip while mounted (today they cannot fire at all). No zoom while mounted.
  This replaces what the Gunfire spell did from the saddle.

### 2. Seeing the shot (render)

- Gun events gain the tracer segments the sim already computes (`from`, `to`, `hand`, gun type,
  element) and a `muzzle` point.
- New `src/render/fx/GunFx.ts`: a pooled tracer line set (life 0.05 s, sniper 0.15 s, coloured by
  element), a muzzle flash sprite (0.05 s), and the raygun's beam (the unused `beam` flag finally
  drives it; life 0.16 s).
- The drawn start point is the gun model's `muzzle` node in world space when the player view can
  give it, else the sim muzzle. The animation session is asked to add
  `muzzleWorld(out, hand): boolean` to `PlayerView`. Until it exists, the sim muzzle is used, which
  is already at the barrel to within a few centimetres.
- Projectile views are already drawn at the sim position, so they now start at the barrel.

### 3. Controls

The layout follows the weapon in hand, not the class. A staff in hand keeps today's controls.

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Fire | Left mouse | RT |
| Aim (cycles zoom) | Right mouse | LT |
| Melee: tap light, hold heavy | Q | RB |
| Reload | R | X |
| Spells 1 to 4 | E, Y, Z, X | hold LB + X, Y, B, A |
| Weapon slots | 1 to 4, Tab for next | D-pad Right for next |
| Dodge, jump, sprint, interact, potion, mount | unchanged | unchanged |
| Grapple | G | LB + RB (melee is suppressed for the chord) |

- Calls I made: melee goes on Q and RB (I first said V and R3, but V whistles for the mount and R3
  is lock-on). There is no block while a gun is out; dodge remains. With a gun out, R only reloads
  and the number keys only pick weapon slots, so spell 2 moves to Y.
- With a staff out the number keys cast spells, as players expect today, and no longer also swap
  weapon slot (today one press does both); Tab and D-pad Right change weapon. With a gun out the
  number keys pick slots. The pad layout with a staff is unchanged, so the pad-only tests hold.
- New command bit `aim` (bit 20), separate from `block`, so aiming never raises the guard.
- The gun layout is a second table in `bindings.ts` and is rebindable through `controlPrefs` like
  the others. The Controls screen shows it.

### 4. Zoom

- `zoomLevels` becomes `0 | 1 | 2`, worked out per tick: 0 while dual wielding, 2 for the sniper,
  1 for every other gun (a single handgun or machine pistol included).
- Zoom state lives in the sim (`GunRuntimeState.scopeZoom`, 0 to 2) and is changed by `aim`
  presses: off, 1, (2), off. With `zoomLevels` 0 the press does nothing.
- Zoom drops to off on: sprint, reload start, weapon swap, melee, dodge, mounting, death, and any
  menu or dialogue.
- The camera reads the zoom from the sim view: over-the-shoulder at hip, a tighter shoulder view
  at zoom 1, and for the sniper a full-screen scope at both levels (the body is hidden and the
  existing scope overlay is drawn). The scope is the one place the camera leaves the shoulder; I
  judge that still fits "third person only", since an over-the-shoulder view at 12° and 4° is
  unusable.
- Zoom field of view per gun (degrees; hip is the over-the-shoulder 62). This table replaces the
  `zoomFov` values in `guns.ts` where they differ:

| Gun | Zoom 1 | Zoom 2 |
|---|---|---|
| Handgun, machine pistol (single) | 55 | none |
| Handgun, machine pistol (dual) | none | none |
| Shotgun | 55 | none |
| MG | 48 | none |
| Bazooka, duck gun | 50 | none |
| Raygun, big bullets | 46 | none |
| Sniper | 12 | 4 |

- While zoomed: `adsSpread` replaces `spread`, look speed scales by zoom FOV over hip FOV for
  mouse and stick, move speed is 80%, recoil is 70%, and the pad's aim assist pull is on.
- The sim is the single source for zoom; the mismatches found today (camera zooming while dual
  wielding, HUD showing aimed spread while dual wielding) go away.

### 5. Reload

- The timer, auto reload on an empty magazine and reserves stay as they are.
- **The magazine is kept per weapon.** Rounds in the magazine are stored on the player's progress
  per weapon bar slot (my call: the bar has four slots and the same gun can sit in two of them),
  saved with a migration that starts every slot full, and restored on swap. A dual-wield offhand
  uses its own slot's magazine. Swapping no longer refills. The unused `GunInstance` stash is left
  alone.
- **Swap.** Swapping cancels a reload with no rounds added, and the new gun cannot fire for its
  `swapTime` (0.35 to 0.7 s, already in the data and unused).
- **Interrupts.** Firing is blocked during a reload. Melee and dodge cancel it. Sprint does not.
- **Shotgun loads one shell at a time** (my call, for Call of Duty feel): each shell takes
  `reloadTime / magSize`, and pressing fire stops the reload after the current shell.
- Reload speed skills are fixed: today the Handling stat and the Soldier passive make reloads
  slower because the multiplier is applied the wrong way round.
- The HUD's magazine size and reload bar use the computed stats, not the base ones. An empty gun
  with no reserve plays the dry-fire click (the sound exists and is never called).
- The sim view exposes `reloading`, reload progress 0 to 1, `zoom`, `firedTick` and `hand`, for the
  HUD and for the animation session's reload and shoot clips.
- Gun state (magazine, timers, zoom) joins `snapshot`, `restore` and `hash`.

### 6. Recoil, spread and feedback

- **Recoil.** The `recoilKick` each shot already returns is applied to the camera: pitch up by the
  gun's `recoil` (growing up to 60% with sustained fire), a random yaw of ±`recoilYaw`, then it
  recovers. This is Sproto Shooter's model. It lives on the camera side as an offset, so it moves
  the crosshair and therefore the shot.
- **Spread.** Hip spread grows a little per shot and recovers when the trigger is released;
  moving multiplies it by 1.4 and being airborne by 2. Class recoil and spread skills, which are
  passed in but ignored today, take effect.
- **Crosshair.** One reticle only while a gun is out (the RPG reticle is hidden). Its gap shows the
  real current spread. Hit, crit and kill markers are wired (they are hard-coded off today).
- **Aim assist** (pad): the pull is routed straight into the camera angles; today it goes through
  the mouse path, which shrinks it and flips it under inverted Y.
- Pad rumble on fire and reload uses the values already in `bindings.ts`.

### 7. Removing the Gunfire spell

- `gunfire` leaves the spell table. The owner chose to give the Soldier the normal Arcane Bolt back
  in slot 1: the Soldier casts magic like the Wizard, alongside its guns. The "Soldier spells are
  drawn as bullets" rule (`firesAsBullets`) goes with it, so only guns fire bullets. Pepe keeps
  Arcane Bolt and loses Gunfire. A save migration turns a saved `gunfire` into `bolt` for the
  Soldier and drops it for Pepe.
- Dual wield stays automatic (owner): two sidearms on the weapon bar means both fire and there is
  no zoom; one sidearm is single-handed with one zoom step.
- Tests and the mount end-to-end script that cast it are changed to fire the gun.

## Order of work

1. Aim, origin, projectiles and the tracer and flash (sections 1 and 2).
2. Controls and zoom (3 and 4).
3. Reload (5).
4. Recoil, spread and feedback (6).
5. Gunfire removal and mounted fire (7).

Each step ends with the repo checks green. New sim tests cover `gunRuntimeTick`, which has none
today: origin and convergence, the blocked barrel, zoom cycling per gun, swap keeping the magazine,
shell-by-shell reload and the reload speed fix. The pad-only smoke test gains a gun pass: fire,
zoom, reload and swap with a pad alone.

## Left to the builder

Exact muzzle offsets per gun, bloom and recoil recovery rates, tracer and flash look, the blocked
marker's art, and how the Controls screen lays out the second table.

## Working alongside the animation session

Both sessions share this checkout on `claude/shooter-animations`, by the owner's arrangement (my
call: stay here and not branch, since the gun models and body clips this work depends on are that
session's uncommitted changes; this departs from the one-branch-per-task rule in `AGENTS.md`).
Nothing is committed until the owner asks. The animation session will add
`PlayerView.muzzleWorld(out, hand)` and `muzzleDir(out)`, plays `reload` scrubbed by progress
(so any reload time fits), and will trigger `shoot` from gun events. It rebuilt the gun models at
real sizes (MG 0.90 m, shotgun 0.98, sniper 1.20, bazooka 1.25, raygun 0.58, big bullets 0.72,
duck gun 0.78); the sim muzzle offsets use those lengths. `GunRuntimeState` gains
`reloadTotalTicks`. This work does not touch `art/tools`, the character models,
`PlayerView.ts`, `src/render/anim/*` or the clip lists. Both touch `SimWorld.ts` and `App.ts`; this
work keeps to the gun tick, the gun view accessor and the gun wiring in `App.ts`.

## What was built

Sections 1 to 7 are built, with sim tests in `tests/sim/gun-aim.test.ts`, input tests in
`tests/input/gunBindings.test.ts` and a save test in `tests/save/migrations.test.ts`. Where the
build differs from the text above:

- **Rocket self damage is damage only.** A bazooka rocket that goes off beside its shooter costs
  them 35% of the blast; it does not push them (no rocket jump).
- **Not built: rebinding the gun layout.** The gun layout is a second table in `bindings.ts`, and
  the HUD hints follow it, but the Controls screen cannot rebind it yet.
- **The pad-only gun test is its own script**, `tests/e2e/guns.mjs` (part of `npm run test:e2e`), not a pass inside `smoke.mjs`,
  which another session was changing. It drives fire, zoom, reload and melee with the pad alone.
- **Gunfire is deleted** from the spell table, the icons and the cast sounds. A save that names
  it is cleaned before it is validated (the Soldier gets the Arcane Bolt, anyone else loses it),
  with no schema bump.
- **Magazines are kept per bar slot with the gun's id**, so another gun put in the slot starts
  full. Drawing a gun from a staff has no swap delay; gun to gun does.
- **The first-person toggle** is ignored while a gun is in hand, and a gun in hand always uses the
  shoulder camera.
- **The sim's barrel sits at shoulder height** (1.55 m), where the shouldered gun's `muzzle` node
  is. The model's own node is used for the flash and tracer when it is within 0.35 m of it.

## Added after the first build (owner, 2026-11-21)

- **Third person only, for everything.** The first-person toggle (B / D-pad Left) is disabled for
  every weapon and class. The sniper's full-screen scope stays (owner: "sniper is good").
- **Dual wield plays like the early Halo games.** Each gun has its own trigger and its own reload.
  Two guns never zoom, so the zoom trigger is free to be the left gun.

  | Action | Gamepad | Keyboard and mouse |
  |---|---|---|
  | Fire the right gun | RT | Right mouse |
  | Fire the left gun | LT | Left mouse |
  | Reload the right gun | tap RB | R (reloads both) |
  | Reload the left gun | tap LB | R (reloads both) |
  | Reload both | X | R |
  | Melee | hold RB | Q |
  | Spells | hold LB + face button | E, Y, Z, X |

  A bumper counts as a tap when released within 0.28 s (`DUAL_TAP`). My calls: holding RB past a tap
  swings, so melee is still on the pad; the keyboard has no per-hand reload key. In the sim the
  right gun is `light` and the left gun is `aim`, with `reloadLeft` and `reloadRight` beside
  `reload`.
- **The raygun is a dual-wield gun** alongside the handgun and machine pistol. Alone it zooms one
  step; paired with another dual-wield gun on the weapon bar it does not.
