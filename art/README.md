# Art sources

## Player melee clips

`public/assets/models/characters/player.glb` is sproto-duel's rigged `wizard_player` with the 13
original clips plus five melee clips made in Blender: `attack_light_1`, `attack_light_2`,
`attack_light_3`, `attack_heavy` and `block`, plus three riding clips (below). The weapon is the staff, mounted on the
`socket_staff` node under `RightHand`. Hit windows, cancel points and the heavy's charge window
are in `player.melee.json` next to the GLB.

| File | What it is |
|---|---|
| `source/player_melee.blend` | The Blender scene: rig, all 21 actions (one NLA track each), and a preview staff that is not exported |
| `source/wizard_player_decoded.glb` | sproto-duel's `models/rigged/wizard_player.glb` with meshopt and quantization removed so Blender can import it |
| `source/staff_sproto_decoded.glb` | sproto-duel's `models/staffs/staff_sproto.glb`, decoded, for previewing swings only |
| `source/player_raw.glb` | Blender's uncompressed export |
| `tools/ride_anim.py` | Builds the riding clips from the same helpers |
| `tools/export_player.py` | Rebuilds the riding clips and exports `source/player_raw.glb` headless |
| `tools/melee_anim.py` | Builds the melee clips from key-pose tables using IK for arms and legs. Edit `P`, `CLIPS` and `TIMING`, then run it again |

## Riding clips

`mount`, `ride` and `dismount` are posed by `tools/ride_anim.py` for the Pepe Bull at its game size:
the hub pet's 1.7 m fit height times `BULL_SCALE` (2, so 3.4 m), the same constant as in
`src/content/mounts.ts`. At 2 the back is too broad to hang legs down the flanks, so the rider sits
up on it, and climbing on is a leap to the saddle. `POSES` holds each size's leg targets; change
both constants together and rebuild. The clips carry height only: the game moves the rider onto and
off the bull.
To rebuild them and the raw export without opening the Blender UI:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background art/source/player_melee.blend --python art/tools/export_player.py
```

Then run `node art/tools/build-player-glb.mjs`.

The bull itself is built here too. `tools/build_bull.py` starts from the hub's `pet_pepe_bull`
(`source/pepe_bull_decoded.glb`), turns it onto its line of travel, slims its barrel so the rider's
legs clear it, and adds a saddle, a blanket and ears:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/build_bull.py
```

Then run `node art/tools/build-bull-glb.mjs`, which also sets each gait's real length from
`source/pepe_bull_clips.json`.

| File | What it does |
|---|---|
| `tools/bull_rig.py` | Rig repairs: hips, loin and ear bones, the trunk and neck skin, and tack skinned from the body beneath it |
| `tools/bull_anim.py` | The clips. `GAITS` holds each gait's footfalls and body curves. Hooves are planted and moved at ground speed, and the legs reach them by IK |
| `tools/verify_bull.py` | Measures the game file: loop closure, hoof skate, hooves through the ground, body through the tack |
| `tools/render_bull_sheet.py` | Contact sheets of any clip from any side |

| Clip | Length | Ground speed | Gait |
|---|---|---|---|
| `follow_walk` | 0.56 s | 2.6 m/s | Four-beat walk |
| `follow_run` | 0.42 s | 9.5 m/s | Three-beat canter |
| `gallop` | 0.32 s | 17 m/s | Four-beat gallop with a moment of suspension |

The ground speeds are the clips' at the hub pet's size. `MountView` multiplies them by the bull's
scale (a longer stride covers more ground), so at 2 the same sim speed plays each clip at half rate.

Every gait starts its loop when the left hind hoof lands, so `MountView` can blend between them in
step. If a clip's length or speed changes, change the speed in `MountView`'s `GAITS_AT_1` to match.

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/verify_bull.py -- public/assets/models/mounts/pepe_bull.glb
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/render_bull_sheet.py -- public/assets/models/mounts/pepe_bull.glb <out_dir> gallop side,three_quarter 8
```

### Changing a clip

1. Open `source/player_melee.blend` in Blender.
2. In the Python console: `exec(open('<repo>/art/tools/melee_anim.py').read())`, then `show('attack_light_1')` to preview.
3. Export with only `Armature`, `char1` and `socket_staff` selected: glTF Binary, Animation mode
   *Actions*, Always Sample Animations on, Include Custom Properties on, to `source/player_raw.glb`.
4. Build the game file: `node art/tools/build-player-glb.mjs`. It puts `socket_staff` back where
   the source rig has it (Blender's export moves it 18 m up the hand bone), adds Sproto Shooter's
   clips, the natural `idle` stance and `socket_weapon` (below), and compresses with
   resample → WebP → meshopt. Never use `gltf-transform optimize` here: it removes the socket.
5. `player.melee.json` is written by the script on every run, from `TIMING` plus each clip's
   last key. Keys snap to whole 24 fps frames, so `end` is the exact clip length. Don't edit the
   JSON by hand.
6. Run `npm run gen:moves` so the sim's frame data and staff hitboxes match the new clips.

Pose tables use the character's frame: `r` = right, `f` = forward, `u` = up, in metres from the
centre of the feet. `grip` is where the right fist holds the shaft and `staff` is the direction
from the butt to the head. `attack_light_2` starts from `attack_light_1`'s follow-through pose and
`attack_light_3` from `attack_light_2`'s, so the combo chains without a pop.

## Class bodies and guns

Two more playable bodies next to the wizard, each holding a toy gun from Sproto Shooter. Everything
is rebuilt by the tools in `tools/classes/` from the decoded sources in `source/classes/`.

| Game file | Source | Triangles | Size |
|---|---|---|---|
| `characters/soldier.glb` | metaverse-hub `avatar/soldier.glb` → `source/classes/soldier_hub_decoded.glb` | 10,363 | 467 KiB |
| `characters/pepe_player.glb` | metaverse-hub `avatar/pepe.glb` → `source/classes/pepe_hub_decoded.glb` | 9,998 | 433 KiB |
| `guns/gun_<id>.glb` (7) | sproto-shooter `models/guns/toy_<id>.glb` | 2.4k–4k | 65–89 KiB |

Budgets (`build-class-glbs.mjs` and `build-guns.mjs` fail past them): a body ≤ 510 KiB and 22k
triangles, a gun ≤ 90 KiB and 4k triangles.

### Rebuild

```bash
node art/tools/classes/retarget.mjs          # → source/classes/<body>_raw.glb (uncompressed)
node art/tools/classes/build-class-glbs.mjs  # → public/assets/models/characters/{soldier,pepe_player}.glb
node art/tools/classes/build-guns.mjs        # reads ../sproto-shooter/public/assets/models/guns/
node art/tools/classes/preview.mjs           # contact sheets → source/classes/preview/
npm run check:assets
```

The hub sources were decoded once with `node art/tools/decode-glb.mjs <hub glb> <decoded glb>`
(Blender cannot read meshopt). `tools/classes/inspect-glb.mjs <file> [--nodes]` prints a GLB's
node tree, textures and clips.

### Bodies

- **Height.** Both stand exactly as tall as the wizard: 1.818 m, the skinned mesh of `player.glb`
  in its rest pose at scale 1, feet at y = 0, facing +Z. The scale is baked into the file (node
  translations, inverse bind matrices, positions), so the scene root stays at scale 1.
- **Clips.** The wizard's 21 clips with its names, key times and exact lengths (`idle`, `stun`,
  `victory` and `defeat` keep every other key, 12 fps), plus Sproto Shooter's sixteen (below).
- **Standing.** `idle` is set on a natural stance on every body, the Wizard included
  (`naturalStance` in `shooter-clips.mjs`): hips and chest facing straight ahead, feet parallel
  under the hip joints with 5° of turn-out, knees just off locked. The wizard's source idle stands a
  quarter turn open with its feet wide and splayed; that reads as a pose, and points a gun sideways.
- **Retarget** (`retarget.mjs`, three.js maths on the glTF, so a pose means what the game shows):
  each body joint is first turned, parent-first, so its bone points where the wizard's (or the
  shooter Pepe's) does in its rest pose; every frame then applies the source joint's world-space
  rotation from rest. Hip travel is scaled by hip height; the hips' height keeps the lowest point of
  the mesh where the wizard's is, never below the floor, and matches the thighs' height while the
  wizard sits on the bull (`mount`, `ride`, `dismount`). Fingers hold a gun grip in every clip: the
  shooter's grip plus `CURL` degrees, baked into the fingers' default rotation.
- **Compression** (`build-class-glbs.mjs`): the Tripo meshes are simplified (their UV atlases have
  so many seams that the soldier stops at 10.4k triangles), the soldier keeps a 512 px base colour
  and drops its normal map, Pepe keeps 1024 px. Most of a rigged GLB is clip JSON, so the clips are
  not resampled (all channels of a clip share one time accessor) and channels that only hold a
  joint's default are dropped, except in `aim` and `shoot`.

### Sproto Shooter's animations (all four bodies)

`tools/classes/shooter-clips.mjs` builds these for the three class bodies (through `retarget.mjs`)
and for the Wizard (through `wizard-gun-clips.mjs`, called by `build-player-glb.mjs`). The source is
`source/classes/pepe_shooter_decoded.glb`, sproto-shooter's `pepe.glb` decoded.

| Clip | Kind | From |
|---|---|---|
| `hold` | upper layer, held | The ready carry: stock under the arm, muzzle down across the body |
| `aim` | upper layer, held | Shouldered, head down to the sights |
| `shoot` | upper layer, 0.333 s | `aim` plus the gun's kick from the shooter's `shoot` |
| `reload` | upper layer, 1.2 s | A magazine change keyed for the third-person camera (`reload-clips.mjs`); the shooter's `reload` sets only its length |
| `hold_1h`, `aim_1h`, `shoot_1h`, `reload_1h` | upper layers | A sidearm (a dual-wield gun) on its own: carried low at the side and fired at arm's length in the right hand; the free arm hangs as in `idle`; the reload brings both hands together |
| `dual`, `dual_shoot_r`, `dual_shoot_l`, `dual_reload`, `dual_reload_r`, `dual_reload_l` | upper layers | A sidearm in each hand, both arms out at chest height, canted in; each hand kicks on its own shots |
| `slide` | whole body, 0.5 s | The shooter's slide: 3 keys in, then held |
| `dash` | whole body, 0.233 s | The shooter's `dash` stride |

- **Stances are placed, not retargeted.** `STANCES` puts the gun in the body's frame (from the right
  shoulder, in arm lengths) and both arms reach it by two-bone IK: the right hand so `socket_weapon`
  lands on the grip, the left on the handguard (`SUPPORT`), pulled back toward the grip on a body
  whose arm is too short. A rotation-only retarget of the shooter's `ready` left short-armed bodies
  with the support hand in the air and the gun held out in front of the chest.
- **The shooter's clips supply the recoil.** `shoot` takes, per frame, how the shooter Pepe's gun
  (its `weapon_grip`, turned with its right hand) has moved from its `ready` pose; that is scaled by
  arm length and replayed on the stance (`SHOOT_GAIN`).
- **Reloads are keyed here** (`tools/classes/reload-clips.mjs`). The shooter's `reload` is a
  first-person clip: a few degrees of tilt and a few centimetres of hand travel, which from behind
  the player reads as the arms freezing. Each reload is a short list of keys over 0..1 (the game
  scrubs the clip by the sim's reload progress): the gun's shift and turn from its reload stance, the
  support hand's place on the gun, how far that hand has gone to the pouch on the left hip (a place
  on the body, not on the tipped gun), and the torso and head going with it. `long` is the two-handed
  magazine change for every long gun, `sidearm` the one-handed gun's (the free hand fetches, seats and
  racks), `akimbo` the pair's (no free hand: both guns tip, drop to the belt and snap back up).
- **`slide` is built, as in the shooter.** There it is code, not a clip (`src/render/pvp/slidePose.js`
  makes the pose from the avatar's own limb lengths). The same construction runs here per body, is set
  down on the floor, and is written as a clip over the body's standing arms.
- **The game** (`src/render/views/PlayerView.ts`): with a gun in hand the arms show `hold`; `aim`
  while aiming and for 0.6 s after a shot; `shoot` on each shot; `reload` scrubbed by the reload's
  progress. `slide` and `dash` replace the legs' locomotion while the sim runs them. The grapple is the
  shooter's too, but stays code (`src/render/anim/gunPose.ts` `reachArm`): the left arm reaches for
  the anchor, wherever it is.
- **Sidearms** (`build-sidearms.mjs`): the Handgun and Machine Pistol have no model in the shooter, so
  they are built here from boxes in the toy guns' colours, to the same contract. The second gun of a
  pair mounts on `socket_weapon_l` (every body has one).
- **The staff** stands straight up in the fist in `idle`: `naturalStance` turns the wrist until the
  staff socket's shaft is vertical.
- **Guns** (`build-guns.mjs`): lengths are this game's, not the shooter's (which sizes them for a
  first-person view): carbine 0.90 m, shotgun 0.98, sniper 1.20, launcher 1.25, the three sidearms
  0.58–0.78.
- **Looking at them.** `tools/qa/sheet.html` (dev server) draws any body, weapon, layer and view
  as a contact sheet with the game's own animator; `tools/qa/drive.ts` plays the moves in the running
  game and photographs each from the front and the side.

### `socket_weapon` (every body)

An empty node, child of `mixamorig:RightHand`. Origin: the centre of the closed right fist, where
the shooter's `weapon_grip` sits (carried over to the soldier in hand-relative terms). +Z: along
the barrel; +Y: up from the top of the gun. In `aim` at 0 s over the default hips and legs, +Z is
the character's forward (world +Z) and +Y is world up. Over a clip whose hips turn the gun turns
with them: the wizard's `idle` stands 23° open, so a gun aimed over `idle` points that much to the
side. A gun built to the contract below parents under the socket with an identity transform. The
contract is also in the node's extras.

### Guns (`build-guns.mjs`)

`gun_<id>` for `mg`, `shotgun`, `sniper`, `bazooka`, `raygun`, `bigbullets`, `duckgun`. Root node
`gun_<id>` (identity) with two children: the mesh and `muzzle`.

- Origin at the right hand's grip: Sproto Shooter's `HAND_FRAC[id].grip` (fractions of the box
  from its centre, +z = back). Barrel along +Z (the shooter's `GUN_MODELS[id].yaw` plus half a
  turn), top +Y.
- Length (+Z extent) is the shooter's third-person length for its 1.8 m characters:
  `GUN_MODEL_LEN[id] * 0.82`, the machine gun 0.96 m.
- `muzzle`: an empty at the barrel tip, at `muzzleY` up the box on its front face. Shots and the
  muzzle flash start there and travel along the gun's +Z.
- Simplified to ≤ 4k triangles (seam-aware first, then permissive collapses weighted by UVs), WebP
  base colour 512 px stepping down until the file fits 90 KiB (the ray gun ends at 320 px and 2.4k
  triangles), metal-roughness and normal 256 px.

### Preview sheets

`source/classes/preview/` (from `preview.mjs`, which runs `tools/classes/render_sheet.py` in Blender
and `tools/classes/socket-frames.mjs`): `soldier_<n>.png` and `pepe_player_<n>.png` show idle, run,
the light and heavy attacks, block, cast, roll, ride, jump, defeat, `shoot` and `aim` (over `idle`
and on their own) from the side, three-quarter and front with `gun_mg` placed from
`socket_weapon`'s three.js world matrix; `<body>_grip.png` are close-ups of the gun hand;
`wizard_<n>.png` are the same poses on the wizard; `guns.png` shows the seven guns with the grip
origin (blue, usually hidden in the grip) and `muzzle` (red).
