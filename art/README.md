# Art sources

## Player melee clips

`public/assets/models/characters/player.glb` is sproto-duel's rigged `wizard_player` with the 13
original clips plus five melee clips made in Blender: `attack_light_1`, `attack_light_2`,
`attack_light_3`, `attack_heavy` and `block`. The weapon is the staff, mounted on the
`socket_staff` node under `RightHand`. Hit windows, cancel points and the heavy's charge window
are in `player.melee.json` next to the GLB.

| File | What it is |
|---|---|
| `source/player_melee.blend` | The Blender scene: rig, all 18 actions (one NLA track each), and a preview staff that is not exported |
| `source/wizard_player_decoded.glb` | sproto-duel's `models/rigged/wizard_player.glb` with meshopt and quantization removed so Blender can import it |
| `source/staff_sproto_decoded.glb` | sproto-duel's `models/staffs/staff_sproto.glb`, decoded, for previewing swings only |
| `source/player_raw.glb` | Blender's uncompressed export |
| `tools/melee_anim.py` | Builds the melee clips from key-pose tables using IK for arms and legs. Edit `P`, `CLIPS` and `TIMING`, then run it again |

### Changing a clip

1. Open `source/player_melee.blend` in Blender.
2. In the Python console: `exec(open('<repo>/art/tools/melee_anim.py').read())`, then `show('attack_light_1')` to preview.
3. Export with only `Armature`, `char1` and `socket_staff` selected: glTF Binary, Animation mode
   *Actions*, Always Sample Animations on, Include Custom Properties on, to `source/player_raw.glb`.
4. Compress it. Don't use `gltf-transform optimize`, because it removes the empty `socket_staff` node:

   ```bash
   G() { npx --prefix ../sproto-duel gltf-transform "$@"; }
   G resample art/source/player_raw.glb /tmp/p1.glb
   G webp /tmp/p1.glb /tmp/p2.glb
   G meshopt /tmp/p2.glb public/assets/models/characters/player.glb
   ```

5. `player.melee.json` is written by the script on every run, from `TIMING` plus each clip's
   last key. Keys snap to whole 24 fps frames, so `end` is the exact clip length. Don't edit the
   JSON by hand.

Pose tables use the character's frame: `r` = right, `f` = forward, `u` = up, in metres from the
centre of the feet. `grip` is where the right fist holds the shaft and `staff` is the direction
from the butt to the head. `attack_light_2` starts from `attack_light_1`'s follow-through pose and
`attack_light_3` from `attack_light_2`'s, so the combo chains without a pop.
