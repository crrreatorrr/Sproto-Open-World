# Rootcleaver: Blender model spec

This file is the whole brief for the sword mesh. It is the fallback for Quest 4 when Blender is not available on Linux. Build it on the owner's Mac, which has Blender 5.2.3 at `/Applications/Blender.app` (`docs/plans/2026-11-18-rootdeep-handoff.md:57-58`).

Work on branch `grok/rootdeep-4-rootcleaver-blender`. Leave branch `grok/rootdeep-4-rootcleaver` alone. Another agent is using it for the item, the stats and the combat.

Numbers below come from the Rootdeep plan, the handoff, and the files on `main` at `3e77af0`. A sentence marked **Inferred** is not written in those sources. The staff measurements were read out of the committed GLBs (node extras, accessor bounds, index counts, JPEG headers). Those GLBs have no text line numbers.

## Where to save

These are the paths and names on `main`. Use them exactly.

| What | Full path from the repo root | Name the game looks up |
|---|---|---|
| Sword GLB | `public/assets/models/staffs/staff_rootcleaver.glb` | The file name is `staff_rootcleaver.glb`, next to `staff_sproto.glb` (`src/assets/manifest.ts:56`). |
| Blender script | `art/tools/build_rootcleaver.py` | The plan names this script and no other (`docs/plans/2026-11-18-rootdeep-cave-plan.md:447`, `:496`). |
| `MODELS` entry | `src/assets/manifest.ts`, inside `MODELS` (the staff block is `src/assets/manifest.ts:56-70`) | Key `staff_rootcleaver`. Value `{ path: 'models/staffs/staff_rootcleaver.glb' }`. Paths in `MODELS` are relative to `public/assets` (`src/assets/manifest.ts:1-2`). |
| `check-assets` entry | `scripts/check-assets.mjs`, the `OWN` set at `scripts/check-assets.mjs:43` | The string `models/staffs/staff_rootcleaver.glb`. |
| Item model field | The item `staff_rootcleaver`, which Quest 4 adds in `src/content/items.ts` and `src/content/packs/c2.ts` (`docs/plans/2026-11-18-rootdeep-cave-plan.md:448`, `:154`) | `staff.model` must be the string `staff_rootcleaver`. Existing staffs use that same string as the item id, the `MODELS` key and the `staff.model` field (`src/content/items.ts:52`). |

Quest 4's interface list calls the model key `staff_rootcleaver` (`docs/plans/2026-11-18-rootdeep-cave-plan.md:455`). `App.staffModel` mounts `staff.model` only when that string is a key of `MODELS`. Any other string draws the Sprout Staff (`src/app/App.ts:912-914`).

Do not create `public/assets/models/staffs/staff_rootcleaver-lod1.glb`. The plan names one GLB. An extra file under `public/assets` fails `check:assets` until it is listed (`scripts/check-assets.mjs:63-64`).

The Blender task commits only the script and the GLB. The `MODELS` line, the `OWN` line and the item are the Quest 4 agent's edits. They are listed here so the finished names on `main` are fixed before either branch writes them.

## What Rootcleaver is

Rootcleaver is the melee sword in the Rootdeep vault chest. The cave quest ends at that chest (`docs/plans/2026-11-18-rootdeep-cave-plan.md:5`, `:44`, `:115`, `:145`). The owner asked for a very powerful melee sword (`docs/plans/2026-11-18-rootdeep-handoff.md:35`).

It is a staff-slot item, id `staff_rootcleaver`, rarity `epic`, blurb "Cut from the heart of the Rootdeep." Melee damage is 52. Spell power is 0.6. Its trait is `sunder`: a fully charged heavy sends a shockwave 8 m along the ground (`docs/plans/2026-11-18-rootdeep-cave-plan.md:150-162`). Those stats are game data. The mesh does not encode them.

The owner accepted two trade-offs. The sword is far stronger than the weapon balance rule, and it uses the existing staff swing animations (`docs/plans/2026-11-18-rootdeep-cave-plan.md:45-46`, `docs/plans/2026-11-18-rootdeep-handoff.md:39-40`). Do not author a new attack clip. Do not edit `art/tools/melee_anim.py`, `public/assets/models/characters/player.glb`, `player.melee.json`, or anything under `src/content/generated/`.

The hit volume is the staff capsule from the clips, about 1.9 m long, radius 0.18 m. It does not come from this mesh (`docs/plans/2026-11-18-rootdeep-handoff.md:145`, `docs/plans/2026-11-17-first-area-plan.md:208-211`, `src/content/generated/playerHitboxes.ts:5-8`, `src/sim/combat/hits.ts:386-395`).

No new environment art. The cave stays placeholder terrain, darkness and fog (`docs/plans/2026-11-18-rootdeep-cave-plan.md:16`, `docs/plans/2026-11-18-rootdeep-handoff.md:29`). This task adds one weapon file and the script that builds it.

## Look

The plan's model line is the whole art direction:

> One low-poly two-handed greatsword, 1.9 m long, the length of the staff's hit capsule (`docs/plans/2026-11-18-rootdeep-cave-plan.md:162`).

Quest 4 adds: flat-shaded, in the palette of the other staffs, under 3,000 triangles (`docs/plans/2026-11-18-rootdeep-cave-plan.md:496`).

The plan does not set blade profile, fuller, edge count, guard shape, grip wrap, pommel shape, or which colour sits on which part.

**Inferred shape.** Build a straight two-handed sword in that 1.9 m envelope: a long double-edged blade, a simple crossguard, a grip thick enough for two hands, and a pommel. Keep it blocky and low-poly, in the same family as the game's placeholder props. Copy the staff's grip and axis, not the staff's orb, rings, charms or idle spin. `staff_sproto.glb` is a textured staff of 9,998 triangles (`public/assets/models/staffs/staff_sproto.glb`). The sword is the flat, smaller mesh the quest describes.

**Inferred colours.** Use only flat `baseColorFactor` values taken from `staff_sproto.glb`'s untextured materials:

| Material on the staff | Base colour |
|---|---|
| `staff_sproto_gold_mat` | `(1, 0.72, 0.28)` |
| `staff_sproto_red_mat` | `(0.82, 0.04, 0.05)` |
| `staff_sproto_blue_mat` | `(0.06, 0.2, 0.78)` |
| `staff_sproto_yellow_mat` | `(1, 0.78, 0.08)` |

**Inferred assignment:** gold guard and pommel, blue blade, a yellow edge line if a second blade material is worth the triangles. Two to four materials is enough. The first-area plan's later-art note is a daylight green-and-gold palette (`docs/plans/2026-11-17-first-area-plan.md:765`). Gold is the colour that note and the staff share.

Shade flat. One normal per face. No normal map, no ORM map, no emissive extension. The game never reads the staff's `extras.vfx` or `emissivePulse` (nothing under `src/` refers to them).

**Inferred which end is the blade.** The plan never says. Match the staff contract: the head is +Y, the butt is −Y (measured below). On the swing clips the left hand sits 0.25 m, 0.28 m or 0.50 m from the right-hand grip toward the head (`art/tools/melee_anim.py:301-324`, `lhand_on_staff`). Put the grip so both of those fists land on it: right fist at Y = 0, left fist between Y = 0.25 and Y = 0.50. Put the crossguard just past the higher fist, near Y = 0.55. Put the blade tip at the head, near Y = +0.80, because that end is the staff's head and it leads the authored swings (`art/tools/melee_anim.py:15-16`). The remaining length, down to Y ≈ −1.093, is then haft and pommel. That is a long-hafted sword, which is what fitting the staff capsule requires. A short game-style hilt with the blade only above the hands leaves most of the 1.9 m hit capsule empty.

## Output and how to run it

The script builds the mesh from scratch in an empty file and writes the game GLB itself. Quest 4's run line is:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/build_rootcleaver.py
```

(`docs/plans/2026-11-18-rootdeep-cave-plan.md:498`). Expected Blender is 5.2.3 (`docs/plans/2026-11-18-rootdeep-handoff.md:57-58`). Run it from the repo root.

**Inferred, from `art/tools/build_bull.py:21` and `:168-176`:** resolve the output path from the script file, not from Blender's current directory. `build_bull.py` exports with `bpy.ops.export_scene.gltf`, `export_format='GLB'`. For this sword set `export_animations=False` and `export_skins=False`. The bull export turns animations and skins on because the bull has them. This sword has neither.

There is no second compress step. The bull then runs `node art/tools/build-bull-glb.mjs` (`art/README.md:37-42`). The Rootcleaver plan stops at the Python script (`docs/plans/2026-11-18-rootdeep-cave-plan.md:496-498`).

Do not open `art/source/player_melee.blend`. Do not export through `player.glb`. Do not run `node art/tools/build-player-glb.mjs`. Do not run `gltf-transform optimize` on `player.glb`. That optimize strips the empty `socket_staff` node (`AGENTS.md:16-17`, `art/README.md:71-73`, `art/tools/build-player-glb.mjs:6-11`).

## Dimensions, origin, axis

The game parents the staff scene to `socket_staff` with no extra rotation, scale or `fitHeight` (`src/render/views/PlayerView.ts:126-142`, `src/assets/manifest.ts:56-65`). `socket_staff` is the constant `STAFF_SOCKET` (`src/assets/manifest.ts:155-156`). A `fitHeight` would resize the mesh and move it off the grip. Leave it off.

### Measured `staff_sproto.glb`

Root node `staff_sproto`, identity rotation, identity scale. Child nodes carry translation only. The root extras contract, the same object on `staff_fighters_might.glb` and `staff_nobu.glb`, says:

| Field | Value |
|---|---|
| `socket` | `socket:staff` |
| `origin` | grip point (centre of the hand) |
| `up` | `+Y` (butt → head) |
| `forward` | `+Z` (front of the head) |
| `units` | metres |
| `length_m` | 1.894 |
| `grip_from_butt_m` | 1.093 |
| `head_above_grip_m` | 0.801 |

Mesh bounds of that file, in the same space (accessor min/max plus each node's translation):

| | X | Y | Z |
|---|---|---|---|
| Min | −0.1289 | −1.0919 | −0.1016 |
| Max | 0.1187 | 0.7946 | 0.0995 |
| Size | 0.248 m | 1.886 m | 0.201 m |

Y = 0 is the grip. The butt is 1.092 m below it. The head is 0.795 m above it. The span, 1.886 m, sits just under the contract length 1.894 m. Triangle count is 9,998. File size is 772,236 bytes (754 KiB). Eight materials. Six JPEG images: three 1024×1024 and three 512×512. One animation, `staff_sproto_idle`. The sword does not copy the images or the animation.

`player.glb` node `socket_staff` (parent `RightHand`) carries the matching contract string: "staff root here: origin = grip (fist centre on the shaft axis), +Y butt->head, +Z front, metres (scale 100 cancels the 0.01 armature scale)". Its local transform is translation `(1.2130, 4.6789, −2.8804)`, rotation quaternion xyzw `(−0.5387, 0.4153, 0.0496, 0.7313)`, scale `(100, 100, 100)`. `extras.bindPoseWorld` places the grip at `(−0.4340, 1.0992, 0.1767)`, the butt at `(−0.4107, 0.0065, 0.1684)` and the top at `(−0.4512, 1.9000, 0.1828)`. Butt-to-top length is 1.894 m. `tools/gen-player-moves.ts:118-126` reads `butt` and `top` from that socket. `art/tools/melee_anim.py:27-28` stores the same grip in Blender's Z-up frame as `(-0.434, -0.177, 1.099)`.

The socket scale of 100 cancels the armature's 0.01 scale. A child authored in metres stays in metres. Author the sword in metres at scale 1.

The missing-model stand-in is a cylinder of length 1.9 m, radius 0.02 to 0.025, shifted to `position.y = -0.15`, so it spans Y −1.10 to +0.80 (`src/assets/AssetLoader.ts:205-208`). That is the fallback drawing, not the art target. It shows the same envelope.

### Required sword, in the exported glTF

| | Value |
|---|---|
| Units | metres |
| Root scale | 1, 1, 1 |
| Root rotation | identity |
| Origin | `(0, 0, 0)`, the right-hand grip, on the centreline |
| Long axis | +Y, butt → head, the same axis as the staff |
| Front | +Z |
| Butt / pommel end | Y = −1.093 (staff contract `grip_from_butt_m`) |
| Head / blade tip | Y = +0.801 (staff contract `head_above_grip_m`) |
| Length | 1.90 m as the plan states (`docs/plans/2026-11-18-rootdeep-cave-plan.md:162`, `:496`). The staff contract's 1.894 m is the measured target inside that. Keep the mesh span within a couple of centimetres of 1.894 m. |
| Right fist | Y = 0 |
| Left fist | Y = 0.25 (heavy), 0.28 (overhead), 0.50 (block), along +Y (`art/tools/melee_anim.py:301-324`) |

**Inferred Blender axes.** Blender is Z-up. The glTF exporter maps Blender +Z to glTF +Y and Blender −Y to glTF +Z. Model the length along Blender +Z and the front face toward Blender −Y, then check the exported accessor bounds. The glTF numbers above are the ones that have to come out. A centimetre-scale export will be about 100 times too big once it sits on the socket.

**Inferred thickness.** Stay inside the staff's lateral box, about 0.25 m in X and 0.20 m in Z, so the guard does not stick past the hand the way a much wider mesh would. A grip radius near the stand-in's 0.02 m reads as something a fist can close on. The staff shaft itself is thicker (about 0.09 m of wood). The 0.18 m capsule radius is the hit volume, not a mesh radius (`src/content/generated/playerHitboxes.ts:8`).

After export, the root bounds should read about:

- min Y −1.093, max Y +0.801
- |X| and |Z| well under 0.15 m except at the guard
- no mesh sitting only on the positive Y side

## Limits

| Limit | Value | Where it is enforced |
|---|---|---|
| Triangles | Under 3,000 | The quest (`docs/plans/2026-11-18-rootdeep-cave-plan.md:496`). `check:assets` allows a staff file up to 12,000 and a `models/staffs/*-lod1.glb` up to 4,000 (`scripts/check-assets.mjs:26-27`). Meet 3,000. The 12,000 figure is only the folder cap. |
| Materials | Flat colours, no image maps | The quest says flat-shaded (`docs/plans/2026-11-18-rootdeep-cave-plan.md:496`). `check:assets` does not count materials. |
| Textures | Zero | Same flat-shade line. `check:assets` does not measure texture size. The first-area plan's edge caps, if a later mesh ever has images, are 2048 px for the player, 1024 px for other characters, 512 px for props (`docs/plans/2026-11-17-first-area-plan.md:307-308`). This sword stays at zero images, so those caps do not come into play. |
| File size | No per-file byte cap | `check:assets` checks tracking and triangles (`scripts/check-assets.mjs:63-78`). `check-budgets` checks the built critical set, not every GLB (`scripts/check-budgets.mjs:4-9`, `:80`). |
| Boot path | Keep this GLB off it | Critical transfer to playable is at most 6 MiB (`scripts/check-budgets.mjs:80`). The critical list includes `assets/models/staffs/staff_sproto-lod1.glb` and does not include the other staffs (`scripts/check-budgets.mjs:8-9`, `:28`). The full Sprout Staff file is 754 KiB. The owner says the critical path has about 110 KiB of headroom left. That 110 KiB figure is the owner's number for this spec. It is not printed by the plan or by `check-budgets`. Do not add `staff_rootcleaver` to the critical array, and do not add a `STAFF_BOOT_LOD` entry (`src/assets/manifest.ts:141-147`). Shooter and Fighter are the pattern: one file, loaded the first time they are equipped, never in the critical download (`src/assets/manifest.ts:63-65`). |

`player.glb` stays as it is. Optimizing it removes `socket_staff` (`AGENTS.md:16-17`).

## Names, manifest, check-assets

Nothing in `src/` looks up a staff mesh name, material name or clip name. `check:assets` does not require `socket_staff` on a staff file. It requires that node only on `player.glb` (`scripts/check-assets.mjs:86-92`). An older expansion note says the check covers each new staff (`docs/plans/2026-11-17-expansion-plan.md:168`). The script on `main` does not.

**Inferred names**, matching `staff_sproto` so the file is easy to read:

- Root node `staff_rootcleaver`
- Children `staff_rootcleaver_blade`, `staff_rootcleaver_guard`, `staff_rootcleaver_grip`, `staff_rootcleaver_pommel`
- Materials `staff_rootcleaver_blade_mat`, `staff_rootcleaver_gold_mat`

No skin, no armature, no animation, no empty socket inside the sword file. The socket lives on the player.

On `main`, once Quest 4 lands, these references exist:

1. `MODELS.staff_rootcleaver = { path: 'models/staffs/staff_rootcleaver.glb' }` in `src/assets/manifest.ts`, beside the other staff keys (`src/assets/manifest.ts:56-70`). No `fitHeight`, no `rotationY`, no `clips`, no `rigged`.
2. `'models/staffs/staff_rootcleaver.glb'` inside `OWN` in `scripts/check-assets.mjs:43`. The plan points at that line (`docs/plans/2026-11-18-rootdeep-cave-plan.md:450`, `:496`). The handoff says `check:assets` fails on any file it does not know, and the fix is to add the sword to `OWN` (`docs/plans/2026-11-18-rootdeep-handoff.md:166`).
3. The item's `staff.model` is `'staff_rootcleaver'` (`docs/plans/2026-11-18-rootdeep-cave-plan.md:154-155`, `src/content/items.ts:52`).

Do not add the GLB to `public/assets/IMPORTED.json`. That file is generated by `npm run import:assets` and records sibling-repo copies (`AGENTS.md:13-15`, `tools/import-sibling-assets.mjs:93-100`). This sword is made in this repo, which is what `OWN` is for (`scripts/check-assets.mjs:42-43`).

Do not add a `STAFF_BOOT_LOD` pair. A save that continues with Rootcleaver equipped currently takes the full model at boot, because `App` uses `STAFF_BOOT_LOD[staff]` and falls through to the full key when the map has no entry (`src/app/App.ts:456-459`). The plan does not add a small boot file. Leave that choice to the Quest 4 agent. See the open points below.

## Acceptance

On the Mac, from the repo root:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/build_rootcleaver.py
```

Then confirm the GLB, before any game code exists:

- Path is `public/assets/models/staffs/staff_rootcleaver.glb`.
- Triangle count is under 3,000 (count index triples the way `scripts/check-assets.mjs:70-78` does).
- Image count is 0. Materials are flat colours from the table above.
- Root scale is 1 and root rotation is identity.
- Bounds match the table: grip at the origin, length along +Y, butt near Y = −1.093, tip near Y = +0.801, front toward +Z.
- `player.glb` is byte-for-byte unchanged.

`check:assets` on this branch alone fails the new GLB as untracked until `OWN` contains it (`scripts/check-assets.mjs:63-64`, `docs/plans/2026-11-18-rootdeep-handoff.md:166`). That line belongs to the Quest 4 agent. Do not add it here to make the check pass.

When the Quest 4 branch has the item and the two bookkeeping lines, run the checks the owner named (`AGENTS.md:24-34`):

```bash
npm test
npm run build
npm run check:assets
npm run budgets
```

`budgets` reads `dist/` and is meant to run after `npm run build` (`scripts/check-budgets.mjs:2-3`). `check:assets` passes once the GLB is under the triangle cap and listed in `OWN`. `budgets` stays passing because this file is not in the critical list.

Visual check, in the running game, after the item exists (`docs/plans/2026-11-18-rootdeep-handoff.md:130`, `:259`, `docs/plans/2026-11-18-rootdeep-cave-plan.md:733`):

1. Equip Rootcleaver from the Gear tab with the pad. `staffMounted` becomes true (`src/render/views/PlayerView.ts:141-142`).
2. Screenshot the grip from a few angles. The right fist closes on the origin. The long axis matches a staff in the same hand. The tip is about 0.80 m above the fist and the butt about 1.09 m below it.
3. Swing a light attack and a fully charged heavy. The mesh stays parented to `socket_staff` and follows the staff clips `attack_light_1` and `attack_heavy`. No new clip.

The Gear tab still says "Staff" until Quest 4 renames that label to "Weapon" (`src/ui/gameMenu.ts:362`, `docs/plans/2026-11-18-rootdeep-cave-plan.md:501-503`). That rename is game code.

## Handoff

Claude builds the mesh on the Mac and commits only these two paths to `grok/rootdeep-4-rootcleaver-blender`:

- `art/tools/build_rootcleaver.py`
- `public/assets/models/staffs/staff_rootcleaver.glb`

Then hand the branch back. Do not open a pull request from this branch. Do not push `main`. Do not commit item stats, traits, combat, the Gear label, `src/assets/manifest.ts`, or `scripts/check-assets.mjs`. Those land on the Quest 4 agent's branch (`docs/plans/2026-11-18-rootdeep-cave-plan.md:444-515`).

Commit as `creatooor <33529965+crrreatorrr@users.noreply.github.com>`.

## What the plan left open

- Blade, guard, grip and pommel shapes, and which palette colour goes on which part. The plan says "low-poly two-handed greatsword", "flat-shaded" and "the palette of the other staffs" (`docs/plans/2026-11-18-rootdeep-cave-plan.md:162`, `:496`). The part layout in this file is inferred from the staff grip.
- Which end is the blade. The contract names a head and a butt. It does not say the head is a blade tip.
- A boot LOD. Continuing a save with this weapon equipped loads the full GLB at boot today (`src/app/App.ts:456-459`), while `check-budgets` will not count it (`scripts/check-budgets.mjs:28`). The plan does not say which of those two should change. Headroom on the critical path is about 110 KiB (owner's figure, not a repo measurement).
- Node and material names. No check reads them.
- Texture size and material count. No check reads them. Flat shading and zero images are the quest's answer.
- The live critical cap is 6 MiB (`scripts/check-budgets.mjs:80`). The first-area plan still says 8 MiB (`docs/plans/2026-11-17-first-area-plan.md:339`). Use 6 MiB.
- `docs/plans/2026-11-17-expansion-plan.md:168` says `check:assets` asserts `socket_staff` on each new staff. `scripts/check-assets.mjs:86-92` asserts it on `player.glb` only.
