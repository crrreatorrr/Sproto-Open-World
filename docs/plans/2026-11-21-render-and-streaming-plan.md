# Sproto Open World: Smooth Rendering, No Pop-in, Longer View

**Status:** plan only, no code. 2026-11-21. Not yet reviewed by a second agent.

**The owner's request:** there are loading glitches, the screen sometimes shakes when moving, and
the view should reach further. Fix all three while keeping the game light, using the way GTA San
Andreas drew its world and its buildings.

**Goal, in numbers** (reference: the same laps on a real GPU, then on the weakest target machine):

| | Today (measured) | Target |
|---|---|---|
| Distance at which trees and buildings are visible | about 180 m | 1,000 m or more on High |
| Things appearing in clear view | cells at 128–181 m, up to 393 props in one frame | 0 un-faded swaps |
| Freezes while walking | 250 ms and 110 ms seen in one run | no frame over 50 ms |
| Triangles a frame in Bellmere | 1.2–2.24 million | 1.0 million or less, far tier included |
| Shadow pass triangles in Bellmere | 345–805 thousand | 250 thousand or less |
| Draw calls | 148–228 | 200 or less |
| Camera wobble on uneven ground | 5.7 mm a frame (p95) | under 0.5 mm, same as flat ground |

This plan replaces F1, F3, F4 and F6 of `2026-11-19-far-view-and-flight-streaming-plan.md`, which
was written for one 512 m region and never built. Flight, the world edge, the Edge Warden and day
and night stay in that plan. It also carries out S1 (shader warm-up) and part of S8 (prop view
culling) of `2026-11-17-asset-streaming-plan.md`.

---

## 1. What I measured

Dev build, headless Chromium on this machine's GPU (Apple M5 Pro, Metal), 1280 × 720 at 2× pixel
ratio, driven with the simulated pad. Scripts were throwaway and are not in the repo.

| # | Finding | Evidence |
|---|---|---|
| M1 | **The world past about 180 m is bare ground.** Real terrain and props load in a 5 × 5 block of 64 m cells around the player. Beyond it only `horizon.glb` draws: an 8 m terrain grid with boxes for the 207 placements flagged as landmarks (of 25,417). Fog now starts at 140 m and ends at 820 m (it was 80–180 m when the streamer was written), so the edge of the loaded cells is in clear air | `rings.ts` (`RING_VISUAL` 2, `LOD1_M` 180); every `region.json` has `fog 140 / 820 / 2200`; cells appeared 128–181 m from the player on every walk |
| M2 | **Props swap a whole cell at a time, with no fade.** A cell's props change between hidden, LOD1 and LOD0 together, by the cell's distance | `PropInstancer.rebucket`; up to 393 instances changed in a single frame, 13–24 such frames in each 25 s walk |
| M3 | **Terrain changes shape as you approach.** The same ground is drawn three ways: the 8 m horizon grid (dropped 0.5 m), a half-resolution mesh at ring 2, a full-resolution mesh inside 1 cell. Each swap is instant | `CellStreamer.pump` (`res` 64 or 32), `Horizon.ts` |
| M4 | **Nothing is culled by the view.** Every prop mesh has `frustumCulled = false` because one mesh spans all loaded cells. Bellmere drew the same triangle count whichever way the camera faced (2,232,961 to 2,238,593 at one spot) | `PropInstancer.makeSlot`; four headings at six Bellmere spots |
| M5 | **Bellmere is 1.3 to 2.5 times over the project's own budget** of 900 thousand triangles (`tests/e2e/world.mjs`), and the shadow pass alone is 345–805 thousand. LOD1 models keep 30% of the triangles, which is not low enough for the far field | six spots; `tools/build-env-props.mjs` (`LOD1_RATIO`) |
| M6 | **Freezes happen inside the draw.** One run had a 250 ms and a 110 ms frame while walking. A repeat run had one 28 ms frame, all of it inside `renderer.render`, in the frame where 2 shader programs, 6 textures and 11 geometries first appeared. Props are warmed before they show; characters, enemies, NPCs and pickups are not: nothing in `src/render/views` compiles ahead or uses the upload budget | section timers around the frame; only `WorldSession.ts` and `PropInstancer.ts` call `compile` or `uploads` |
| M7 | **The camera passes ground bumps straight to the screen.** It rises slowly when the player goes up and drops with them at once when they go down. Its offset from the player changed by 5.7 mm a frame (p95) on Sproutvale's slopes and 0.08 mm on flat ground in the Willowrun | `CameraRig.ts:462`; walks B, C and G |
| M8 | **Shadows crawl when the player moves.** The shadow box is re-centred on the player every frame without snapping to the shadow map's texel grid, so every shadow edge shimmers while moving | `Renderer.follow` (code reading; not measured) |
| M9 | A freeze also jerks the camera: its offset jumped 157–186 mm in the long frames | walks B and D |
| M10 | No loading veil appeared on any walk, and the frame time was a steady 16.7 ms outside the freezes. The S0 fix holds | all walks |

**Not checked:** the owner's display runs at 120 Hz and the sim at 60 Hz. Headless Chromium draws
at 60 Hz, so smoothness at 120 Hz is unmeasured. Riding and flying speeds were not measured either.

**What "the screen shakes" most likely is:** M7, M8 and M9 each shake the picture during movement,
and M3 makes distant hills jump. I can't tell from here which one the owner sees most. R0 fixes all
three camera and shadow causes, and each is small, so the plan does not depend on knowing.

---

## 2. How San Andreas did it

From the reverse-engineered source (gta-reversed, `source/game_sa/`) and the GTA modding wiki. Where
the earlier plan quoted GTA III numbers, these are the San Andreas ones.

| # | Rule | Detail from the source |
|---|---|---|
| SA1 | **Every building is two objects: a detailed one and a LOD.** | The map file's `inst` line carries a `lod` index pointing at the LOD placement. `LinkLods` joins them when the map loads |
| SA2 | **LODs are always loaded; detail streams.** | A "big building" (has LOD children, or draw distance over 300) is marked never-delete and has no collision |
| SA3 | **The LOD draws until its detailed children are really on screen.** | A child counts only when it is loaded, in range, on screen and fully faded in. With several children the LOD hides only when all of them count. While a child fades in, the LOD still draws underneath. (The multi-child loop is garbled in the transcription, so "all children" is probable, not certain) |
| SA4 | **Fade, don't pop.** | A 20 m band at the edge of the draw distance. A newly streamed model starts at alpha 0 and gains 16 of 255 per frame |
| SA5 | **Request before it is needed.** | A model is requested 50 m beyond its draw distance |
| SA6 | **Draw distance is per model.** | Each definition in the `.ide` file has its own draw distance, capped at 300 m for detail, scaled by the player's setting (0.925–1.8) |
| SA7 | **Two grids.** | Detail lives in 50 m sectors (120 × 120). LODs live in 200 m cells (30 × 30) scanned out to the far plane |
| SA8 | **Collision streams apart from visuals.** | `CColStore` loads collision by bounding box plus 120 m around the player; map placements by box plus 200 m |
| SA9 | **What is in front loads first; what is behind goes first.** | Requests are urgent within 100 m or within 0.36 rad of the heading. Under memory pressure: least recently used, then sectors behind the camera |
| SA10 | **A fixed memory budget.** | 50 MB for streamed models and textures |
| SA11 | **From the air, only LODs.** | Camera 50 m or more above ground: only LODs are requested. LOD distance grows from ×1 to ×2.2 between 80 and 250 m of altitude |
| SA12 | **Speed moves the streaming point.** | In a vehicle the load position is pushed ahead by the speed |
| SA13 | **Buildings are pre-lit.** | Vertex colours, a day set and a night set blended by the clock. No dynamic lighting unless flagged |
| SA14 | **Far clip and fog are tuned like lighting.** | Per hour and weather in `timecyc.dat` |
| SA15 | **A blocking load for jumps.** | `LoadScene` drops everything, loads the new place, and waits |
| SA16 | **Fixed list sizes.** | 1,000 visible entities, 1,000 LODs |

The one idea that matters most: **the coarsest version of everything is always there, and streaming
only ever adds detail on top of it.** The worst case is low detail, never a hole and never a pop.

Not copied: one draw per building LOD (merged per block here, because draw calls are the scarce
thing in WebGL), sorted alpha fading (dithering needs no sorting), occluder boxes.

---

## 3. Approaches considered

| | What | For | Against |
|---|---|---|---|
| **A. Stretch the rings** | Load 9 × 9 or 11 × 11 cells instead of 5 × 5 | Smallest change | 3–5 times the cells, props and triangles. Bellmere is already over budget. Pops move further away but stay |
| **B. Impostor cards** | Draw far props as camera-facing pictures | Very few triangles | Needs an atlas bake per prop kind and view angle, looks flat from the air (the bull flies), and adds texture memory |
| **C. San Andreas tiers (chosen)** | An always-loaded low-detail tier, merged per 256 m block, with parent and child rules and fades; pay for it by culling and thinning the near field | Extends the view by 5 times for about 200 thousand triangles. Removes pops by construction. Matches the request | The most bake work. Seams between tiers need care |

C is the plan. A is rejected on cost, B on look and memory.

---

## 4. The design

### 4.1 Tiers

| Tier | Covers | Content | Loaded when | Draws when |
|---|---|---|---|---|
| **HD cell** (today's Active and Visual) | 64 m | Full or half-res terrain, LOD0 and LOD1 props, grass, colliders in the player's 3 × 3 | As now, by distance | Loaded, uploaded and compiled, then faded in |
| **LOD block** (new) | 256 m, 4 × 4 cells | One baked mesh: terrain at 4 m, plus every tree, rock and building in the block as a LOD2 shape, vertex-coloured, no textures. 1–2 draws | Camera within the block radius for the quality (§4.6) plus 50 m (SA5) | Everywhere a finer tier isn't showing yet (SA3) |
| **Horizon** (today's, upgraded) | a region | 8 m terrain, tree masses, a silhouette for every prop over 4 m, not only landmarks | Always (SA2) | Where no block is showing |

The overworld is 1,536 × 2,560 m, so 60 blocks. At most about 30 are loaded on High and about half
of those are in view.

### 4.2 Buildings, the San Andreas way

- **Three models per kind:** LOD0 and LOD1 as now, plus **LOD2**, made by the bake: simplified to a
  fixed triangle cap by size (a house 60–100, a tree 12–24, small clutter none), with the texture's
  colour baked into vertex colours (SA13). LOD2 is never drawn alone; it is merged into its block.
- **A draw distance per kind, by size (SA6),** in the prop table next to `capacity`: clutter (ferns,
  crops, planters) 50 m; fences and rocks 90 m; trees 140 m; houses 250 m; landmarks 300 m. Today
  everything shares 70 and 180 m. Small things stop early and big things reach further, which is
  where most of the triangle saving comes from.
- **The parent and child rule (SA1, SA3):** a cell's detailed props hide that cell's part of the
  block. The block keeps drawing there until the cell's terrain and every prop model it needs are
  loaded, uploaded and compiled. Then the two cross-fade (§4.3).
- The `town_lm_house_*` kinds (112 houses flagged as landmarks so they show from afar) are then
  ordinary houses again; every house is in its block. To confirm with the town layout script.

### 4.3 Fades without pops

- **Per instance, in the shader.** Each prop material gets the camera position and its kind's near
  and far distances, and dithers each instance in or out over a 20 m band (SA4) from that instance's
  own distance. LOD0 fades out as LOD1 fades in. The CPU only decides which cells feed which bucket,
  so a swap is never "393 props in one frame" again, and no per-frame CPU work is added.
- **Per cell, by a mask.** The horizon already hides itself under loaded cells with a one-texel-per-
  cell texture (`Horizon.ts`). The mask grows to say which tier owns each cell and how far a fade
  has run. Blocks and the horizon read it the same way. A fade takes about 0.4 s.
- **Dithered, not transparent:** both tiers write depth, nothing needs sorting.
- **Terrain:** the block's terrain sits slightly lower with distance (the horizon already uses
  0.5 m) so the finer tier wins where both draw. The half-res step (M3) is dropped if blocks at 4 m
  make it unnecessary; decide after seeing blocks in the game.

### 4.4 Lighter near field (this pays for the distance)

- **View culling for props (M4).** Keep one mesh per (kind, bucket), but pack each cell's instances
  together and draw only cells that touch the view. The shadow-casting bucket is culled against the
  shadow box, not the camera. The alternative, one mesh per cell and kind, is simpler and multiplies
  draw calls; rejected unless the first proves fragile.
- **Shadows (M5, M8).** Snap the shadow box to its texel grid. Cast with LOD1 shapes beyond 25 m.
  Kinds with no collider and under 1 m tall never cast.
- **A triangle cap per kind,** checked by `npm run check:assets`, like the byte caps today.
- **Resolution that adapts.** When the frame time stays over budget, step the pixel ratio down
  (and back up when there is headroom), within the quality setting's ceiling. This is what protects
  the 30 fps floor on weak machines.

### 4.5 Streaming order (SA5, SA8, SA9, SA11, SA12)

- Visual tiers follow the **camera**, in 3D. Colliders stay tied to the **player's** 3 × 3 and the
  sim's anchors, exactly as now.
- Priority: the player's cells, then what is within about 20° of the view centre, then the rest of
  the view, then ahead along the velocity, then behind. Eviction runs the other way.
- Look-ahead by speed: 4 s on foot (as now), longer on the bull. Above 25 m/s, or 50 m above the
  ground, only blocks are requested.
- One file per cell instead of two, content-hashed names, and `Cache-Control: immutable` in
  `vercel.json`. Assets stay in git.
- A GPU memory budget per device tier with least-recently-used eviction (S3 of the asset plan).
  Blocks count against it; the horizon is never evicted.

### 4.6 View distance by quality (SA14)

Fog and the far plane are set from what is really drawn, per quality:

| Quality | Blocks out to | Fog near / far | HD distances |
|---|---|---|---|
| Low | 500 m | 120 / 600 m | × 0.8 |
| Medium | 900 m | 140 / 1,000 m | × 1 |
| High | 1,400 m | 160 / 1,600 m | × 1.2 |

The Rootdeep keeps its cave look and has no blocks.

### 4.7 Nothing new inside a draw (M6)

- Every model that enters play goes through the same path props use now: textures through the
  upload budget, programs through `compileAsync`, and only then is it shown. Until then the enemy
  or NPC is not drawn (or draws the proxy body from S1 of the asset plan).
- The upload budget counts bytes, not items.
- A guard in dev and QA builds counts frames where the program, texture or geometry count grew
  during play. It must read 0 on the laps.

### 4.8 Camera (M7, M9)

- Vertical follow is smoothed both ways, with a cap on how far the camera may lag a real fall, so
  steps and slope changes under the feet don't reach the picture.
- Checked in a visible window at 120 Hz.

---

## 5. Milestones (1 unit ≈ one focused engineer-week)

| # | What | Units | Main files | Done when |
|---|---|---|---|---|
| **R0** | Stop the shake: camera vertical smoothing, shadow texel snap, a camera-smoothness check in the e2e lap, a 120 Hz check | 0.5 | `CameraRig.ts`, `Renderer.ts`, `tests/e2e/world.mjs` | Camera offset step under 0.5 mm (p95) on the Sproutvale walk; shadows hold still while walking; the owner confirms |
| **R1** | Stop the freezes: warm-up and upload budget for every model, byte budget, the first-draw guard | 1 | `EnemyViews.ts`, `WorldViews.ts`, `RpgViews.ts`, `AssetLoader.ts`, `UploadBudget.ts`, `Overlay.ts` | Guard reads 0 and no frame over 50 ms on the walks, on a real GPU |
| **R2** | Lighter near field: prop view culling, shadow LOD and exclusions, per-kind draw distances, triangle caps, adaptive resolution | 1.5 | `PropInstancer.ts`, `rings.ts`, `quality.ts`, `format.ts`, `bake-world.ts`, `check-assets.mjs` | Bellmere at 1.0 million triangles or less and 250 thousand shadow triangles or less, at all six spots |
| **R3** | LOD2 models and LOD blocks in the bake; horizon upgrade | 1.5 | `bake-world.ts`, `build-env-props.mjs`, `import-sibling-assets.mjs`, `format.ts`, `check-budgets.mjs` | Every block exists, under 64 KiB and 12 thousand triangles |
| **R4** | Blocks at run time: the tier mask, the parent and child rule, dithered fades per instance and per cell | 1.5 | new `src/world/BlockLod.ts`, `Horizon.ts`, `CellStreamer.ts`, `PropInstancer.ts`, `TerrainChunk.ts` | 0 holes and 0 un-faded swaps on the laps; trees and houses visible at 1 km on High |
| **R5** | Streaming order: camera-based 3D policy, view priority, speed look-ahead, one file per cell, hashed names, memory budget | 1 | `rings.ts`, `CellStreamer.ts`, `RegionManifest.ts`, `bake-world.ts`, new `vercel.json`, new `Residency.ts` | The policy's unit tests pass; a gallop and a flight lap never show a hole; a repeat visit downloads 0 bytes |
| **R6** | View distance by quality, fog and far plane to match | 0.25 | `quality.ts`, `caveLook.ts`, the manifests | The table in §4.6 holds within the budgets in the goal table |

About **7.25 units**. Order: R0 and R1 first, and they can run side by side (different files). R2
before R4, so the far tier is paid for before it is switched on. R3 can start any time. R5 after R4.

R0 alone should answer the shake; R1 the freezes; R2 to R4 the pop-in and the distance.

---

## 6. Tests and measurement

- **Turn the world tests back on.** `tests/world`, `tests/content/world-*` and
  `tests/e2e/world.mjs` are excluded today. The tier policy stays pure in `rings.ts` and is unit
  tested in Node.
- **Laps cover every region,** not only Sproutvale: on foot, at a gallop and flying.
- Each lap records what §1 measured: frame times, long frames, the first-draw guard, holes, un-faded
  swaps, triangles and draw calls by pass, camera offset step. The budgets in the goal table become
  assertions, on a real GPU (`SMOKE_STRICT_LONGTASKS=1`).
- `check:assets` and `budgets` gain the per-kind triangle caps and the block caps.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Seams where a block meets real terrain | Blocks sit lower with distance and get skirts; the mask hides them under finer cells |
| LOD2 buildings look wrong next to the real ones | Made from the same models and colours; review screenshots at 300 m before R4 ships |
| Dither is visible up close | Fades only happen beyond each kind's near distance; nothing dithers within 40 m |
| Culling packs instance buffers too often when turning | Repack only cells whose visibility changed; measure in R2 |
| The estimates are mine, not measured | Every budget is an e2e assertion, so a miss shows up at the milestone, not after |
| The shake is something not listed here | R0 ends with the owner checking; the 120 Hz check may add a cause |

---

## 8. Collisions with other work

- `AGENTS.md`: `src/sim` and `src/content` stay pure. The only content change is the prop table's
  new fields in `format.ts`.
- Generated files (`public/world/*`, `public/assets/IMPORTED.json`) come out of the bake and the
  import tool, never by hand. R2 and R3 re-bake every region.
- R1 touches the view files that shooter and dungeon work also touch; don't run them together.
- The far-view plan's F0, F2, F5 and F7 to F13 are untouched and still apply.

---

## 9. Decisions for the owner

1. **Approve the plan and the order.**
2. **What does the shake look like?** The whole picture bobbing, shadows flickering, or distant
   hills jumping. It only changes what R0 checks first.
3. **LOD2 buildings: generated by the bake, or made by hand in Blender?** Generated is assumed.
4. **The weakest machine to hold 30 fps on.** It sets the Low row in §4.6.

---

## Sources

- gta-reversed, `source/game_sa/`: `Renderer.cpp`, `Streaming.cpp`, `FileLoader.cpp`,
  `VisibilityPlugins.cpp`, `IplStore.cpp`, `Collision/ColStore.cpp`, `World.h`, `constants.h`.
  https://github.com/gta-reversed/gta-reversed
- GTA modding wiki: https://gtamods.com/wiki/Item_Definition, https://gtamods.com/wiki/INST,
  https://gtamods.com/wiki/Map_system
- This repo: the files named above, and the two earlier plans in `docs/plans/`.
