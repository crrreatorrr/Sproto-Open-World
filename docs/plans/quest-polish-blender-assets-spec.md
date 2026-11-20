# Quest polish: Blender asset spec

This file is the whole brief for the quest-polish meshes. It is the only file on `grok/quest-polish-blender-assets` until the owner's Mac builds the GLBs. Blender on that Mac is 5.2.3 at `/Applications/Blender.app` (`docs/plans/2026-11-18-rootdeep-handoff.md:57-58`). The rebuild pattern is the Rootcleaver one (`docs/plans/rootcleaver-blender-spec.md`, `art/tools/build_rootcleaver.py`).

Numbers below come from the Quest Polish Plan (Gameplay, 2026-11-19; the `totemArt` table and the roadmap row "18 icons, 18 HUD silhouettes and 8 placed totem models") and from `main` at `3a05dad`. A sentence marked **Inferred** is not written in those sources.

Eight placed totems are the Blender work. Nothing else in the plan needs a new mesh. Enemies stay on the models already imported from sproto-duel and sproto-shooter. Relics and the totem menu art are flat images and HUD silhouettes, listed under Not Blender.

## Summary

Triangle and size figures are caps the build script must assert, not measured files. LOD1 is not required: these paths are `models/totems/`, and `check:assets` only demands a sibling `-lod1.glb` for `models/props/<name>.glb` (`scripts/check-assets.mjs:65-66`). Do not emit a LOD1.

| id | GLB on main | Tris max | Size max | LOD1 |
|---|---|---|---|---|
| `totem_elders_hearth` | `public/assets/models/totems/totem_elders_hearth.glb` | 600 | 24 KB | no |
| `totem_field_warden` | `public/assets/models/totems/totem_field_warden.glb` | 1,600 | 40 KB | no |
| `totem_seekers_lantern` | `public/assets/models/totems/totem_seekers_lantern.glb` | 900 | 28 KB | no |
| `totem_turnstone` | `public/assets/models/totems/totem_turnstone.glb` | 500 | 20 KB | no |
| `totem_elders_seed` | `public/assets/models/totems/totem_elders_seed.glb` | 700 | 24 KB | no |
| `totem_earthspeaker_stake` | `public/assets/models/totems/totem_earthspeaker_stake.glb` | 500 | 20 KB | no |
| `totem_ember_quench_pail` | `public/assets/models/totems/totem_ember_quench_pail.glb` | 600 | 24 KB | no |
| `totem_skylure_post` | `public/assets/models/totems/totem_skylure_post.glb` | 900 | 28 KB | no |

Size is the GLB on disk. Eight files, 6,300 triangles and 208 KB at the caps. All eight stay off the boot path.

| id | Build script |
|---|---|
| `totem_elders_hearth` | `art/tools/build_totem_elders_hearth.py` |
| `totem_field_warden` | `art/tools/build_totem_field_warden.py` |
| `totem_seekers_lantern` | `art/tools/build_totem_seekers_lantern.py` |
| `totem_turnstone` | `art/tools/build_totem_turnstone.py` |
| `totem_elders_seed` | `art/tools/build_totem_elders_seed.py` |
| `totem_earthspeaker_stake` | `art/tools/build_totem_earthspeaker_stake.py` |
| `totem_ember_quench_pail` | `art/tools/build_totem_ember_quench_pail.py` |
| `totem_skylure_post` | `art/tools/build_totem_skylure_post.py` |

## Shared contract

One script per totem. Each script builds an empty file and writes one GLB. From the repo root, on the Mac:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/build_<id>.py
```

`<id>` is the id in the table (`build_totem_elders_hearth.py` for Elder's Hearth). Same flags as Rootcleaver (`art/tools/build_rootcleaver.py:1-4`, `docs/plans/2026-11-18-rootdeep-cave-plan.md:498`).

**Inferred, from `art/tools/build_rootcleaver.py:31-33` and `:278-292`:** resolve the output path from the script file, not from Blender's current directory. Export with `bpy.ops.export_scene.gltf`, `export_format='GLB'`, `export_yup=True`, `export_apply=True`, `export_animations=False`, `export_skins=False`, `export_morph=False`. There is no second compress step and no `gltf-transform optimize`. Assert the triangle cap before export. Print the exported glTF bounds.

Do not open `art/source/player_melee.blend`. Do not export through `player.glb`. Do not run `node art/tools/build-player-glb.mjs`. Do not run `gltf-transform optimize` on `player.glb`. That optimize strips `socket_staff` (`AGENTS.md`).

### Where a placed totem sits

The plan: placed totems sit on the terrain, and placements settle onto the ground the way the packs already do. Content marks start with `settle`, and `SimWorld.settleOnGround` drops them onto the cell ray hit (`src/sim/SimWorld.ts:605-628`). Packed prop `y` is already the ground height (`src/content/world/format.ts:65-66`). The pack comments say the same thing (`src/content/packs/c5.ts:17`, `src/content/packs/c6.ts:34`).

So the mesh origin is the base centre, on the ground. The game puts that origin on the settled point. No `fitHeight` and no `rotationY`: both would resize or turn a mesh that is already in metres and already facing +Z (`src/assets/manifest.ts:12-17`). A missing file currently draws the generic capsule (`src/assets/AssetLoader.ts:201-217`). The code agent owns a smaller stand-in. This spec does not add one.

| | Value |
|---|---|
| Units | metres |
| Root scale | 1, 1, 1 |
| Root rotation | identity |
| Origin | `(0, 0, 0)`, base centre, on the ground |
| Up | glTF +Y. No vertex below Y = 0 |
| Forward | glTF +Z. Same direction as sim yaw 0 (`src/assets/manifest.ts:16-17`) |
| Blender axes | Blender is Z-up. The exporter maps Blender +Z to glTF +Y and Blender −Y to glTF +Z (`art/tools/build_rootcleaver.py:11-12`). Stand the mesh on Blender +Z and point its front at Blender −Y, then check the exported bounds |

Totems last 20 s and fade over the last 2 s. That fade is game code. The mesh has no animation, no skin, and no armature.

### Look

Chunky hand-made fantasy objects, clean shapes, flat-shaded, one normal per face. Match the valley props, not a photo. No baked-in text or letters. No real-person likeness. No emissive map, no normal map, no ORM map, no image of any kind. Glow lives in the VFX on the named anchors, not in a texture. A bright flat `baseColorFactor` is enough for the ember, the seed, and the lantern pane.

`check:assets` does not count materials or textures (`scripts/check-assets.mjs:70-78`). The first-area plan's prop texture cap is 512 px (`docs/plans/2026-11-17-first-area-plan.md:307-308`). These meshes stay at zero images, so that cap does not apply.

Palette, used by every totem. Hex is `baseColorFactor`. Roughness is a factor on the Principled BSDF, not a texture. Metallic is 0 except where the row says 1.

| Token | Hex | RGB | Metallic | Use |
|---|---|---|---|---|
| `stone` | `#8A7B6E` | 0.541, 0.482, 0.431 | 0 | Hearth ring, Turnstone body |
| `stone_dark` | `#4A433C` | 0.290, 0.263, 0.235 | 0 | Hearth bowl, soot |
| `ember` | `#FF6A1A` | 1.000, 0.416, 0.102 | 0 | Hearth ember. Brightest texel of that mesh |
| `straw` | `#C9A24A` | 0.788, 0.635, 0.290 | 0 | Field Warden. Same hay colour as `HaystackView` (`src/render/views/DrakeViews.ts:399`) |
| `wood` | `#5A3D24` | 0.353, 0.239, 0.141 | 0 | Poles, pail staves, Skylure post. Same wood as the sheep decoy (`src/render/views/DrakeViews.ts:462`) |
| `wool` | `#E8E2D2` | 0.910, 0.886, 0.824 | 0 | Skylure tufts. Same wool as the decoy (`src/render/views/DrakeViews.ts:461`) |
| `brass` | `#FFB847` | 1.000, 0.722, 0.282 | 1 | Lantern body. Staff gold (`staff_sproto_gold_mat`, `(1, 0.72, 0.28)`) |
| `bronze` | `#C48A3A` | 0.769, 0.541, 0.227 | 1 | Turnstone face |
| `iron` | `#3E4450` | 0.243, 0.267, 0.314 | 1 | Hook, stake, grille |
| `iron_wet` | `#6A7380` | 0.416, 0.451, 0.502 | 1 | Pail bands |
| `pale` | `#F3EED4` | 0.953, 0.933, 0.831 | 0 | Lantern pane |
| `seed` | `#3DCC6A` | 0.239, 0.800, 0.416 | 0 | Elder's Seed stone |
| `shoot` | `#5FA83A` | 0.373, 0.659, 0.227 | 0 | Seed shoots |
| `soil` | `#6B4A32` | 0.420, 0.290, 0.196 | 0 | Seed mound, stake dirt |
| `water` | `#3A7CA5` | 0.227, 0.486, 0.647 | 0 | Water in the pail |
| `twine` | `#8A7048` | 0.541, 0.439, 0.282 | 0 | Wool ties |

Rarity frames stay UI: common `#d9ccb0`, rare `#8fc8ff`, epic `#d8a0ff`, equipped accent `#f0c548` (`src/styles.css:6`, `:280-281`). Do not paint those frames onto the mesh.

Two to four materials per file. Name them `<id>_<token>_mat`.

### VFX anchors

Idle and activation effects in the plan are particles and lights in code. They need empty child nodes, zero triangles, parented to the root, translation only. The root node is named `<id>`. Mesh children use the names in each section. `check:assets` does not read these names. It only requires `socket_staff` on `player.glb` and `chest_lid` on the chest (`scripts/check-assets.mjs:84-92`). **Inferred:** the code will look the anchors up by name, the way `ChestView` looks up `chest_lid`. Export them.

No clip. The Turnstone face is a separate mesh node so the game can yaw it. The script does not animate that yaw.

### Triangles, LOD1, bytes, boot path

`check:assets` triangle caps (`scripts/check-assets.mjs:21-31`):

| Folder | Cap |
|---|---|
| `models/props/<landmark>` | 10,000 |
| `models/props/` anything else | 4,000 |
| `models/staffs/*-lod1.glb` | 4,000 |
| `models/staffs/` | 12,000 |
| `models/pickups/` | 1,000 |
| `models/interactables/` | 4,000 |

There is no pattern for `models/totems/`. The caps in the summary table are this spec's, and each script asserts its own. Every cap is under the 4,000 prop cap.

LOD1 is required only for a file matching `^models/props/[^/]+\.glb$` that does not already end in `-lod1.glb` (`scripts/check-assets.mjs:65-66`). A prop LOD1 is treated as tracked only when the LOD0 is in `IMPORTED.json` (`scripts/check-assets.mjs:44-45`). An OWN LOD0 does not make its LOD1 legal. These totems are not world props and are not in `IMPORTED.json`. Do not write a `-lod1.glb`. Do not file them under `models/props/`.

If a later change does move one under `models/props/`, then it needs `<name>-lod1.glb`, both files count against 4,000 triangles, and the importer's LOD1 recipe is simplify to 30% (`tools/import-sibling-assets.mjs:73-74`, `LOD1_RATIO = 0.3`). That is not this task.

`check:assets` has no per-file byte cap (`scripts/check-assets.mjs:63-78`). `check-budgets` caps the critical set at 6 MiB, not every GLB (`scripts/check-budgets.mjs:4-9`, `:80`). The critical list is the player, the small starter staff, village NPCs, the shrine, chests, pickups, the village-square props, Sproutvale cells in the start ring, and any prop those cells place (`scripts/check-budgets.mjs:28-55`).

Keep every totem off that list:

- Do not add a `STAFF_BOOT_LOD` entry (`src/assets/manifest.ts:141-147`).
- Do not add the GLB to the `critical` array in `scripts/check-budgets.mjs`.
- Do not add a prop kind to `public/world/sproutvale/region.json`, and do not place one in a cell. A prop on a start-ring cell is critical (`scripts/check-budgets.mjs:50-53`).
- Load the GLB the first time that totem is placed. Shooter and Fighter are the pattern: one file, not in the critical download (`src/assets/manifest.ts:63-65`).

The critical path on this `main` is shared and nearly full. These files are lazy, so they add 0 bytes to it.

### Names the code will use

This branch does not edit `src/assets/manifest.ts` or `scripts/check-assets.mjs`. Those land with the agent that spawns the totems. The strings are fixed here.

`MODELS` keys, paths relative to `public/assets` (`src/assets/manifest.ts:1-2`). No `fitHeight`, no `rotationY`, no `clips`, no `rigged`:

```ts
totem_elders_hearth: { path: 'models/totems/totem_elders_hearth.glb' },
totem_field_warden: { path: 'models/totems/totem_field_warden.glb' },
totem_seekers_lantern: { path: 'models/totems/totem_seekers_lantern.glb' },
totem_turnstone: { path: 'models/totems/totem_turnstone.glb' },
totem_elders_seed: { path: 'models/totems/totem_elders_seed.glb' },
totem_earthspeaker_stake: { path: 'models/totems/totem_earthspeaker_stake.glb' },
totem_ember_quench_pail: { path: 'models/totems/totem_ember_quench_pail.glb' },
totem_skylure_post: { path: 'models/totems/totem_skylure_post.glb' },
```

`OWN` strings, added to the set at `scripts/check-assets.mjs:43`. A GLB under `public/assets` that is not in `OWN` and not in `IMPORTED.json` fails the check (`scripts/check-assets.mjs:63-64`):

```text
models/totems/totem_elders_hearth.glb
models/totems/totem_field_warden.glb
models/totems/totem_seekers_lantern.glb
models/totems/totem_turnstone.glb
models/totems/totem_elders_seed.glb
models/totems/totem_earthspeaker_stake.glb
models/totems/totem_ember_quench_pail.glb
models/totems/totem_skylure_post.glb
```

Do not add these files to `public/assets/IMPORTED.json`. That file is generated by `npm run import:assets` and records sibling-repo copies. `OWN` is for meshes made in this repo (`scripts/check-assets.mjs:42-43`).

The item id, the `MODELS` key, and the file name are the same string. Proposed ids from the plan: `totem_elders_hearth` and the seven beside it.

## The eight meshes

Bounds are the exported glTF accessor box, root scale 1. X and Z are centred on the origin. Y starts at 0.

### Elder's Hearth (`totem_elders_hearth`)

Quest `q_wake_up`, step `shrine`. Common. "A small round stone hearth with one warm ember in the middle." Placed size: "Knee-high stone ring, 0.6 m wide." Idle: ember pulses slowly, thin smoke curl. Activation: a warm ring of light flares out to 6 m, then a soft glow on the ground.

**Inferred height.** The plan gives the width and says knee-high. The ring is 0.60 m across and 0.45 m tall. The bowl is open. One faceted ember sits in the middle, clear of the rim.

| | Metres |
|---|---|
| Outer diameter | 0.60 (X and Z from −0.30 to 0.30) |
| Height | 0.45 (Y 0 to 0.45) |
| Wall thickness | about 0.10 |
| Ember | about 0.10 across, centre near Y = 0.12 |

| Node | What |
|---|---|
| `totem_elders_hearth` | Root, empty |
| `totem_elders_hearth_ring` | Mesh, `stone` outside, `stone_dark` inside the bowl |
| `totem_elders_hearth_ember` | Mesh, `ember` |
| `vfx_ember` | Empty at the ember centre |
| `vfx_smoke` | Empty above the rim, about Y = 0.50 |
| `vfx_ground` | Empty at the origin. The 6 m ring is a decal in code, not geometry |

Materials: 3 (`stone`, `stone_dark`, `ember`). Tris max 600. File max 24 KB. Script `art/tools/build_totem_elders_hearth.py`.

The ring can be a low lathe (8 to 12 sides), not a smooth torus. It is rotationally symmetric. +Z is still the forward axis.

### Field Warden (`totem_field_warden`)

Quest `q_pest_control`, step `grunts`. Common. "A straw figure in a wide field hat, arms out." Placed size: "Figure about 1.6 m tall on a pole." Idle: straw stirs in an unseen breeze. Activation: the hat brim glows, and a short ripple turns nearby heads.

`grove_scarecrow.glb` is a world prop and is not this mesh. The totem is flat colour, 1.6 m, with the anchors below. Do not instance the scarecrow.

**Inferred.** Total height is 1.6 m, pole included, so the figure reads at eye level on a short stake rather than as a second villager on a tall mast. Arms out span 0.90 m. The hat brim is about 0.55 m across. The body is a stuffed straw torso and a round head, not a rigged character.

| | Metres |
|---|---|
| Height | 1.60 (Y 0 to 1.60) |
| Arm span | 0.90 (X −0.45 to 0.45) |
| Depth | within Z −0.20 to 0.20, hat included |
| Pole | from Y = 0 to about Y = 0.55, radius about 0.04 |

| Node | What |
|---|---|
| `totem_field_warden` | Root, empty |
| `totem_field_warden_pole` | Mesh, `wood` |
| `totem_field_warden_body` | Mesh, `straw` torso, head, arms |
| `totem_field_warden_hat` | Mesh, `straw` crown and `wood` brim, or all `straw` if a fourth material is not worth it |
| `vfx_hat` | Empty at the brim centre |
| `vfx_ground` | Empty at the origin |

Materials: 2 (`straw`, `wood`). The hat brim may stay `straw`. Tris max 1,600. File max 40 KB. Script `art/tools/build_totem_field_warden.py`.

The front of the head and the brim face +Z. No bones. The breeze is a VFX on `vfx_hat`, or a slow code sway of the hat node. The script exports a still mesh.

### Seeker's Lantern (`totem_seekers_lantern`)

Quest `q_relics`, step `return`. Rare. "A brass lantern with a pale glow behind a simple grille." Placed size: "Lantern on a 1.2 m iron hook-stake." Idle: the pale glow breathes. Activation: a slow pulse rolls out to 40 m. The shimmer on chests is the chest VFX in the Not Blender list, not part of this mesh.

`lantern_post.glb` is the village prop (collider height 3.4 m in `public/world/sproutvale/region.json`). This totem is a different object: a 1.2 m stake with one lantern.

**Inferred.** The stake is 1.2 m of `iron`, with a hook at the top. The lantern hangs on the +Z side of the hook. The lantern body is about 0.22 m tall and 0.16 m wide. Its bottom sits near Y = 0.78, so it clears the grass. The pane is a flat `pale` quad behind 4 to 6 grille bars. No glass texture.

| | Metres |
|---|---|
| Height | 1.20 (Y 0 to 1.20) |
| Width | within X −0.12 to 0.12 |
| Depth | Z −0.06 to 0.28 (stake on the axis, lantern toward +Z) |

| Node | What |
|---|---|
| `totem_seekers_lantern` | Root, empty |
| `totem_seekers_lantern_stake` | Mesh, `iron` stake and hook |
| `totem_seekers_lantern_body` | Mesh, `brass` case |
| `totem_seekers_lantern_pane` | Mesh, `pale` |
| `vfx_glow` | Empty in the middle of the pane |
| `vfx_ground` | Empty at the origin |

Materials: 3 (`iron`, `brass`, `pale`). Tris max 900. File max 28 KB. Script `art/tools/build_totem_seekers_lantern.py`.

The grille faces +Z.

### Turnstone (`totem_turnstone`)

Quest `q_rivet_volley`, step `return`. Rare. "A short standing stone with one polished bronze face." Placed size: "Stone about 1 m tall." Idle: the bronze face catches light as it slowly turns. Activation: on a reflect, the face snaps toward the shot with a clang flash.

**Inferred.** A slightly tapered slab, 1.00 m tall, 0.42 m wide, 0.22 m deep. The bronze face is a thin plate on the +Z side, not a texture. Its node origin sits on the stone's upright axis (X = 0, Z = 0) so a yaw in code turns the plate around the stone. The plate geometry is offset to the +Z surface. The script does not key that rotation.

| | Metres |
|---|---|
| Height | 1.00 (Y 0 to 1.00) |
| Width | 0.42 (X −0.21 to 0.21) |
| Depth | 0.22 (Z −0.11 to 0.11), plate included, plate a few centimetres past the stone |

| Node | What |
|---|---|
| `totem_turnstone` | Root, empty |
| `totem_turnstone_stone` | Mesh, `stone` |
| `totem_turnstone_face` | Mesh, `bronze`. Local origin on the upright axis. This is the node the game yaws |
| `vfx_face` | Empty at the plate centre, child of `totem_turnstone_face`, so the flash follows the snap |
| `vfx_ground` | Empty at the origin |

Materials: 2 (`stone`, `bronze`). Tris max 500. File max 20 KB. Script `art/tools/build_totem_turnstone.py`.

The face looks down +Z in the exported bind pose.

### Elder's Seed (`totem_elders_seed`)

Quest `q_elders_garden`, step `shrines`. Epic. "A glowing green seed-stone with tiny shoots." Placed size: "Fist-sized stone on a little soil mound." Idle: shoots sway, soft green motes rise. Activation: a burst of leaves, then a green circle on the ground for the heal.

**Inferred.** The stone is 0.10 m across. The mound is 0.36 m across and 0.12 m tall. Three or four blocky shoots rise to about Y = 0.32. The stone sits in the mound, centre near Y = 0.16.

| | Metres |
|---|---|
| Mound diameter | 0.36 (X and Z −0.18 to 0.18) |
| Height | 0.32 (Y 0 to 0.32) |
| Stone | about 0.10 across |

| Node | What |
|---|---|
| `totem_elders_seed` | Root, empty |
| `totem_elders_seed_mound` | Mesh, `soil` |
| `totem_elders_seed_stone` | Mesh, `seed` |
| `totem_elders_seed_shoots` | Mesh, `shoot` |
| `vfx_seed` | Empty at the stone centre |
| `vfx_ground` | Empty at the origin. The heal circle is a decal, not a ring of polygons |

Materials: 3 (`soil`, `seed`, `shoot`). Tris max 700. File max 24 KB. Script `art/tools/build_totem_elders_seed.py`.

Symmetric. +Z is the forward axis anyway. Motes and the leaf burst are VFX on `vfx_seed` and `vfx_ground`.

### Earthspeaker Stake (`totem_earthspeaker_stake`)

Quest `q_tremors`, step `seam`. Rare. "An iron stake with ripples in the dirt around it." Placed size: "Stake about 0.9 m, half driven in." Idle: faint ring ripples in the dirt. Activation: a shockwave of dust out to 12 m.

**Inferred.** Half of 0.9 m is buried. Buried geometry would stick through the terrain once the origin sits on the ground, so the mesh keeps Y ≥ 0. The visible iron is 0.45 m above a dirt mound. The mound implies the driven half. The stake is a four-sided iron bar, about 0.06 m thick, with a slightly wider head. The mound is 0.40 m across and 0.10 m tall, with two low concentric ribs so the idle ripple has a shape to sit on. The moving ripples and the 12 m shockwave are code, on `vfx_ground`.

| | Metres |
|---|---|
| Visible stake | Y 0.10 to 0.55 (0.45 m of iron) |
| Mound diameter | 0.40 |
| Height | 0.55 (Y 0 to 0.55) |

| Node | What |
|---|---|
| `totem_earthspeaker_stake` | Root, empty |
| `totem_earthspeaker_stake_stake` | Mesh, `iron` |
| `totem_earthspeaker_stake_dirt` | Mesh, `soil` |
| `vfx_ground` | Empty at the origin |

Materials: 2 (`iron`, `soil`). Tris max 500. File max 20 KB. Script `art/tools/build_totem_earthspeaker_stake.py`.

### Ember-Quench Pail (`totem_ember_quench_pail`)

Quest `q_smoke_hills`, step `hay`. Rare. "A dented wooden pail with wet iron bands." Placed size: "Pail about 0.5 m tall." Idle: slow drips and a little steam. Activation: a splash of water fans out to 6 m.

**Inferred.** A tapered bucket, 0.50 m tall, rim diameter 0.40 m, base diameter 0.30 m. Two `iron_wet` bands. The water surface is a flat `water` disc just below the rim. One dent is a pushed-in quad on the +Z side, not a normal map. Drips, steam, and the 6 m splash are VFX. No handle arch unless it fits in the triangle cap; a short wooden lug on each side is enough.

| | Metres |
|---|---|
| Height | 0.50 (Y 0 to 0.50) |
| Rim diameter | 0.40 (X and Z −0.20 to 0.20) |
| Base diameter | 0.30 |

| Node | What |
|---|---|
| `totem_ember_quench_pail` | Root, empty |
| `totem_ember_quench_pail_body` | Mesh, `wood` |
| `totem_ember_quench_pail_bands` | Mesh, `iron_wet` |
| `totem_ember_quench_pail_water` | Mesh, `water` |
| `vfx_drip` | Empty on the rim, +Z side |
| `vfx_steam` | Empty just above the water, about Y = 0.52 |
| `vfx_ground` | Empty at the origin |

Materials: 3 (`wood`, `iron_wet`, `water`). Tris max 600. File max 24 KB. Script `art/tools/build_totem_ember_quench_pail.py`.

The dent faces +Z.

### Skylure Post (`totem_skylure_post`)

Quest `q_bait`, step `post`. Rare. "A crooked wooden perch with tufts of wool tied on twine." Placed size: "Post about 2 m tall." Idle: wool tufts flutter. Activation: a puff of wool drifts up.

This is the totem the player places later. It is not the quest bait post. That post is already a box greybox, 3 m tall, in `BaitPostView` (`src/render/views/DrakeViews.ts:482-507`). Leave `BaitPostView` alone. Do not scale this 2 m mesh up to replace it.

**Inferred.** A single crooked post, 2.00 m tall, leaning about 8° toward +Z, with one short crosspiece near Y = 1.7. Three wool tufts hang from twine on the crosspiece. The post is about 0.10 m thick. The lean stays inside the bounds below.

| | Metres |
|---|---|
| Height | 2.00 (Y 0 to 2.00) |
| Lean and crosspiece | X −0.15 to 0.15, Z −0.10 to 0.45 |
| Tufts | each about 0.12 m across |

| Node | What |
|---|---|
| `totem_skylure_post` | Root, empty |
| `totem_skylure_post_post` | Mesh, `wood` post and crosspiece |
| `totem_skylure_post_wool` | Mesh, `wool` tufts and `twine` ties. `twine` may be `wood` if a third material is tight |
| `vfx_wool_0`, `vfx_wool_1`, `vfx_wool_2` | Empties, one at each tuft |
| `vfx_lure` | Empty at the top of the post, about Y = 2.00. The upward puff starts here |
| `vfx_ground` | Empty at the origin |

Materials: 3 (`wood`, `wool`, `twine`). Tris max 900. File max 28 KB. Script `art/tools/build_totem_skylure_post.py`.

The crook and the wool face +Z. Flutter is code on the three wool empties, or a sway of `totem_skylure_post_wool`. The export is still.

## Not Blender

These are in the plan and look like props. They are not new meshes.

| Plan item | Decision | Use what is already there |
|---|---|---|
| Mill seal pickup (`q_mill`, step `coin`) | Code pickup, not a GLB | Tinubu's Broken Seal is a relic. Its art is the 128 px icon below. The beat is "the seal drops out of the wheel's teeth" after the lever. There is no mill-wheel mesh: the object is `mill_lever` with `model: 'lever'` (`src/content/objects.ts`). A small gold disc primitive, or `pickup_gem` tinted gold, drops at the lever and the toast shows the icon. The roadmap counts 8 placed models, not a ninth for this seal. |
| Giant footprints (`q_hollow_giant`) | Ground decals | The plan says replace the four compass markers with footprint decals that fade in. `TelegraphDecal` is the pattern (`src/render/views/TelegraphDecal.ts:42-47`): a flat shape on the ground, no prop. Four stamps along the existing track. The paw-print on Sproto's Stride is the 2D icon, not a mesh. |
| Chest shimmer (`q_relics`) | VFX on the chest | "Each chest gets a faint gold shimmer visible from 15 m." The chest is `models/interactables/chest.glb` (`src/assets/manifest.ts:124`). A soft gold additive on that model. The third chest's camera turn toward the Beanstalk is code. `grove_beanstalk.glb` stays the landmark it is. |
| Haystack scorch trails (`q_smoke_hills`) | Ground decals | "Each doused haystack shows a scorch trail toward the next one." A dark streak decal on the ground. Burning haystacks are already `HaystackView` (`src/render/views/DrakeViews.ts:407-444`). World hay is `models/props/grove_hay.glb`. Neither is replaced. |
| Pumpkins on Grunt heads (`q_pumpkins`) | Existing prop | Parent `models/props/grove_pumpkin.glb` to the Grunt. No new pumpkin. |
| Wooden sheep and the quest bait post (`q_bait`) | Existing greyboxes | `SheepDecoyView` and `BaitPostView` already draw them from boxes (`src/render/views/DrakeViews.ts:456-507`). The plan does not ask for a sheep mesh. The new model is the 2 m Skylure Post totem, not the 3 m quest post. |
| Quarry Gate lock glow (`q_thornwood`) | VFX | The gate is `models/props/frost_gate.glb`. The lock glows when the player carries the key. No new lock mesh. |
| Rivets glinting on wrecks (`q_iron_gallery`) | VFX | A glint on the salvage already in the yard. The Elder-Iron Rivet the player wins is the 2D icon. |
| Drake scale cracks (`q_skyfire`) | VFX on the boss | Three cracks on `models/bosses/drake.glb`. Enemies are not Blender work. |
| Shrine hum (`q_elders_garden`) | Audio | The shrine is `models/interactables/shrine.glb`. Louder hum on approach, a chord on the third. No new stone. |
| Parry glints, coin-ring, gunner whine, phase roar, dust burst, sky darkening | VFX and audio | Already the kind of thing `EnemyViews` glints and `TelegraphDecal` cover. No mesh. |

Enemies are not Blender. The plan adds no enemy type. Grunts, Slingers, Wisps, Brutes, the Gatekeeper, Rivet Gunners, the Lens Warden, Big Coin, the Hollow Giant, the Burrowmother, Scrapjaw, and the Skyfire Drake keep the models in `MODELS` (`src/assets/manifest.ts:71-98`), which were imported from sproto-duel and sproto-shooter. Do not author a new enemy GLB. Do not copy a new sibling file for this branch.

## Not Blender (2D, for Design expert)

The roadmap's art line is "18 icons, 18 HUD silhouettes and 8 placed totem models." The 8 models are this spec. The 36 flat images are not.

Icon rules from the plan, for that pass:

- A 128 px master, transparent, centred, 8 px padding. It must still read at 64 px (menu grid) and 32 px (toast).
- A 24×24 one-colour silhouette for the HUD, in `currentColor`, the way `src/ui/icons.ts:1-5` draws its icons. No separate texture for the HUD.
- The rarity frame is UI, drawn around the 64 px card. It is not painted into the icon. Common neutral `#d9ccb0`, rare `#8fc8ff`, epic `#d8a0ff`. Equipped adds `#f0c548`.
- No baked-in letters. Star-forts and crests are shapes. No face on the seal.

These stay off the boot path. HUD silhouettes that live in `icons.ts` are already in the JS bundle; keep them small.

| # | id | Name | Rarity | Silhouette at 64 / 32 px |
|---|---|---|---|---|
| 1 | `relic_drowned_coins` | Coins of the Drowned Kingdom | Rare | Three overlapping circles in a fan |
| 2 | `relic_gatekeepers_grip` | Gatekeeper's Grip | Rare | Fist outline, blocky knuckles |
| 3 | `relic_hopeglass` | Hopeglass | Epic | Hourglass, bright green upper half |
| 4 | `relic_sprotos_stride` | Sproto's Stride | Rare | Two wraps side by side, paw-print on the sole |
| 5 | `relic_tinubus_broken_seal` | Tinubu's Broken Seal | Rare | Round seal, a crack, a trailing ribbon. No face, no letters |
| 6 | `relic_oracles_eye` | Oracle's Eye | Epic | Round lens with a bright inner ring |
| 7 | `relic_deepbreath_bellows` | Deepbreath Bellows | Rare | Teardrop bellows, nozzle, puff |
| 8 | `relic_elder_iron_rivet` | Elder-Iron Rivet | Epic | Short peg under a star-shaped head |
| 9 | `relic_surgebriar` | Surgebriar | Rare | Cuff bristling with thorns |
| 10 | `relic_drakeplume` | Drakeplume | Epic | One long curved feather |
| 11 | `totem_elders_hearth` | Elder's Hearth | Common | Round ring with a bright centre |
| 12 | `totem_field_warden` | Field Warden | Common | Hat and outstretched arms on a pole |
| 13 | `totem_seekers_lantern` | Seeker's Lantern | Rare | Lantern on a hook |
| 14 | `totem_turnstone` | Turnstone | Rare | Upright slab with a lighter face |
| 15 | `totem_elders_seed` | Elder's Seed | Epic | Mound with a bright stone and shoots |
| 16 | `totem_earthspeaker_stake` | Earthspeaker Stake | Rare | Stake in a dirt ring |
| 17 | `totem_ember_quench_pail` | Ember-Quench Pail | Rare | Bucket with two bands |
| 18 | `totem_skylure_post` | Skylure Post | Rare | Crooked post with tufts |

Each of the 18 gets both the 128 px master and the 24×24 HUD SVG. The totem rows are the icon versions of the meshes above, not a second 3D file.

## What this branch commits

This commit is the spec only.

The Mac follow-up, on this same branch, commits the eight scripts and the eight GLBs and nothing else:

- `art/tools/build_totem_elders_hearth.py`
- `art/tools/build_totem_field_warden.py`
- `art/tools/build_totem_seekers_lantern.py`
- `art/tools/build_totem_turnstone.py`
- `art/tools/build_totem_elders_seed.py`
- `art/tools/build_totem_earthspeaker_stake.py`
- `art/tools/build_totem_ember_quench_pail.py`
- `art/tools/build_totem_skylure_post.py`
- the eight files under `public/assets/models/totems/`

Do not commit item stats, the Relics menu, `src/assets/manifest.ts`, `scripts/check-assets.mjs`, `public/assets/IMPORTED.json`, or any file under `src/content/`. Do not open a pull request from this branch as part of building the meshes. The code agents reference these paths. A `MODELS` key whose file is missing already draws the loader's primitive (`src/assets/AssetLoader.ts:201-217`). `App.staffModel` only mounts a staff key that is in `MODELS`, and otherwise keeps the Sprout Staff (`src/app/App.ts:912-914`). Totem code should follow that: a known key with a missing file, not a crash.

`check:assets` fails a new GLB as untracked until `OWN` contains it. That line belongs to the code agent. Do not add it on the Mac just to make the check pass, and do not add a LOD1 to sneak past `ownedLod1`.

Commit as `creatooor <33529965+crrreatorrr@users.noreply.github.com>`.

## Acceptance

On the Mac, from the repo root, for each id:

```bash
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/build_<id>.py
```

Then, before any game code exists:

- The GLB path matches the summary table. No `-lod1.glb` beside it.
- Triangle count is under that row's cap. Count index triples the way `scripts/check-assets.mjs:70-78` does.
- Image count is 0. Materials are the flat colours named for that totem.
- Root scale is 1 and root rotation is identity.
- Bounds match that totem's table: origin at the base centre, nothing below Y = 0, up is +Y, the face looks down +Z.
- The named mesh nodes and the `vfx_*` empties are in the file.
- `player.glb` is byte-for-byte unchanged.
- File size is under that row's KB cap.

## What the plan left open

- Exact facet counts, dent depth, hat brim thickness, and how many sides a lathe gets. The plan gives the silhouette and the size. The part layout in each section is inferred from that silhouette.
- Elder's Hearth height. The plan says knee-high and 0.6 m wide. 0.45 m is the knee-high reading.
- Field Warden arm span and how much of the 1.6 m is pole. The plan says a 1.6 m figure on a pole.
- Earthspeaker burial. The plan says the 0.9 m stake is half driven in. The mesh shows the exposed 0.45 m so it does not sink through the ground origin.
- Elder's Seed and the pail diameters. The plan says fist-sized on a mound, and a pail 0.5 m tall.
- Seeker's Lantern name still shares "Seeker" with the Seeker Swarm spell. The plan leaves that question for Ken. The file name stays `totem_seekers_lantern` until he changes it.
- Node names. No check reads them. They are here so the VFX code has one string to find.
- A totem LOD. Not required, and not wanted, for `models/totems/`.
