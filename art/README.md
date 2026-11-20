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
   the source rig has it (Blender's export moves it 18 m up the hand bone) and compresses with
   resample → WebP → meshopt. Never use `gltf-transform optimize` here: it removes the socket.
5. `player.melee.json` is written by the script on every run, from `TIMING` plus each clip's
   last key. Keys snap to whole 24 fps frames, so `end` is the exact clip length. Don't edit the
   JSON by hand.
6. Run `npm run gen:moves` so the sim's frame data and staff hitboxes match the new clips.

Pose tables use the character's frame: `r` = right, `f` = forward, `u` = up, in metres from the
centre of the feet. `grip` is where the right fist holds the shaft and `staff` is the direction
from the butt to the head. `attack_light_2` starts from `attack_light_1`'s follow-through pose and
`attack_light_3` from `attack_light_2`'s, so the combo chains without a pop.
