# Sproto Open World: Far View and Flight Streaming

**Status:** plan only, no code. 2026-11-19.
**Goal:** from the ground or from the air, the whole world is always visible: no holes, no popping
in front of the player, no long frames, at the 30 fps floor on the reference laptop. Flying fast over
the map shows correct low detail first and sharpens as the camera gets close, the way GTA III and
San Andreas did.

Builds on `2026-11-17-asset-streaming-plan.md` (residency, upload budget, KTX2) and the streamer in
`src/world/`. Nothing here replaces those; it adds tiers above them.

---

## 1. What GTA III and San Andreas did

GTA III's renderer and streamer have been reverse-engineered (re3). The rules below come from that
source (`Renderer.cpp`, `Streaming.cpp`, `World.h`), not from memory. San Andreas keeps the same
model and adds streamed placement files.

| # | Technique | How it worked | Numbers from the source |
|---|---|---|---|
| G1 | **A grid of sectors** | The world is a fixed grid. Every placed object is linked into the sectors it touches. Rendering and streaming only walk sectors, never the whole object list. | III: 100 × 100 sectors of 40 m (`World.h`) |
| G2 | **Two objects per building: HD and LOD** | Each building has a detailed model and a separate low-poly LOD model with a much longer draw distance. In SA, every HD placement stores the index of its LOD parent (the IPL `lod` field). | `LOD_DISTANCE` 300 m, times the player's draw-distance setting |
| G3 | **LODs are always loaded; HD streams** | LOD placements ("big buildings") live in an always-resident list scanned over the whole level, not by sector. SA keeps LOD placements in text IPLs loaded at boot and streams HD placements in binary IPL sectors from `gta3.img`, loaded when the streaming position enters a sector. | `ScanBigBuildingList` covers the whole level each frame |
| G4 | **Whole-island LOD meshes** | III also has one low-poly mesh per *other* island (`IslandLODInd`, `IslandLODcomSUB`...). From the island you are on, the others are a single draw. | 5 island meshes |
| G5 | **Frustum-shaped scanning** | The camera frustum is projected onto the sector grid as a triangle and only those sectors are visited. Looking down shortens the scan. | Triangle from the camera to the LOD-distance corners |
| G6 | **A priority wedge** | A narrow wedge in the middle of the view (20% of its width) is scanned first. Its requests jump the queue. | `CORNER_PRIO = 0.2 × LOD corner` |
| G7 | **Stream ahead of the draw distance** | A model is requested when the camera is within its draw distance plus a margin, so it is usually loaded before it should appear. | `STREAM_DISTANCE` 30 m; requests in a box of ± 80 m (`STREAM_DIST`) |
| G8 | **Fade, don't pop** | When the HD model arrives or crosses its distance, it fades in with alpha over a short band while the LOD is still drawn. | `FADE_DISTANCE` 20 m |
| G9 | **A fixed memory budget with eviction** | Streaming has its own budget. When it is full, the game first deletes objects in sectors behind the camera, then far ones, then the least recently used model. | III PC: half of free RAM, at least 50 MB. `DeleteRwObjectsBehindCamera`, `RemoveLeastUsedModel` |
| G10 | **Read order matches world order** | Models that are near each other in the world sit next to each other in the IMG archive, and nearby requests are grouped into one read. This mattered on a DVD. | 2 KiB sectors; MTA documents the grouping |
| G11 | **A blocking "load scene" for jumps** | Teleports, cutscenes and respawns drop everything not marked "keep", request the new area and wait behind a fade. | `CStreaming::LoadScene` |
| G12 | **Far clip and fog from the weather table** | `timecyc.dat` sets the far clip and fog per hour and weather, so draw distance is tuned like lighting. | per weather × hour |
| G13 | **Time objects** | Some models only show between set hours (`MITYPE_TIME`, with `GetTimeOn` / `GetTimeOff`): lit windows and neon at night, a day version otherwise. The renderer hides the one that is out of hours and doesn't even request it. | an on and an off hour per model |

**What this meant when flying.** In a fast plane, HD models in SA often hadn't arrived, so the
player saw the LOD city. Because LODs are always loaded, the worst case is low detail, never an
empty world. That is the main rule to copy: **the coarsest level of everything is always resident,
and streaming only adds detail.**

Not copied: alpha-sorted fading (it costs draw-order sorting; we dither instead), occluder boxes
(open terrain hides little), and per-object LOD placements (thousands of single draws are fine on
PS2-era drivers and wasteful in WebGL; we merge per block instead).

---

## 2. Where we are today

| GTA idea | Ours now | Gap for flight |
|---|---|---|
| G1 sectors | 64 m cells, `rings.ts`, `CellStreamer.ts` | Rings are Chebyshev around the **player cell** and ignore the camera's height |
| G2 HD + LOD | Props have LOD0 (≤ 70 m) and LOD1 (≤ 180 m), `propBucket` | Nothing between 180 m and the horizon mesh except landmark boxes |
| G3 always-resident LOD | `horizon.glb`: 8 m terrain grid plus box and prism landmark impostors, masked under loaded cells (`Horizon.ts`) | Good base. It has no trees or buildings, so from the air the countryside is bare ground |
| G4 island LOD | None (Sproutvale and the Rootdeep are both one region each) | Needed once there are more surface regions |
| G5 / G6 frustum, wedge | `viewCull.ts` culls loaded cells. Requests ignore the view | Flying, requests must follow where the camera looks |
| G7 stream ahead | `prefetchCells`, 4 s along velocity | Fine on foot; flying at 40 m/s needs a different tier |
| G8 fade | Hard swaps | Pops are much more visible from the air |
| G9 budget | Planned (S3 Residency in the asset-streaming plan) | Must count the new tiers |
| G10 read order | 2 files per cell, about 25 KiB | Fine on foot; many small requests when flying |
| G11 load scene | The veil and `groundCells` | Already right |
| G12 fog | Manifest fog 80–180 m, far plane 450 m, camera far 600 m | **This is the wall.** From any height the world fades out at 180 m |

Scale: Sproutvale is 512 × 512 m (8 × 8 cells). From 150 m up the whole region fits in view, so the
target "see the whole world while flying" is reachable now, and the design must still hold when the
surface grows to several regions (the expansion plan).

---

## 3. The design

### 3.1 Four tiers, coarsest always resident

| Tier | Name | Covers | Content | Loaded when | Colliders |
|---|---|---|---|---|---|
| **T0** | Active cell | 64 m | 1 m terrain, LOD0 props, grass | ≤ 1 cell from a **player** (today's rule) | Yes |
| **T1** | Visual cell | 64 m | Half-res terrain, LOD1 props | Camera distance ≤ 180 m (today's ring 2, made camera-aware) | No |
| **T2** | **Block LOD (new)** | 256 m = 4 × 4 cells | One baked GLB per block: 4 m terrain, every prop in the block merged into 2–3 meshes (opaque, foliage cards, landmarks), vertex colours with baked AO, no textures except one shared 256² atlas | Camera distance 180 m – 1.5 km | No |
| **T3** | **Region LOD (upgrade of `horizon.glb`)** | the region | 8 m terrain plus **tree-mass blobs** (low-poly canopy clumps per 16 m) and **building silhouettes** for every prop over 4 m, not only landmarks | Always (as now) | No |
| **T4** | **Backdrop (new)** | beyond the world edge | Chosen per stretch of the world edge (§3.1.1): **mountains and mist** on some sides, **sea** on others, so the edge of the world never shows from the air | Always | No |

T2 is our version of the GTA LOD object (G2), merged per block instead of per building because one
draw per block is far cheaper in WebGL than one per building. T3 is our version of the always-resident
big-building list and the island LODs (G3, G4). T4 replaces the ocean that hid SA's map edge.

#### 3.1.1 The world edge: mountains and mist in some places, sea in others

**The owner's call (2026-11-19): both.** The region data describes the edge as a list of stretches,
each with a kind, instead of one backdrop for the whole world:

```
edge: [
  { from: [0, 0],   to: [512, 0],   kind: 'sea' },
  { from: [512, 0], to: [512, 512], kind: 'mountains' },
  ...
]
```

| | Mountains and mist | Sea |
|---|---|---|
| **Near the edge (in the playable cells)** | The bake raises the terrain into foothills over the last 64–128 m so the ground meets the backdrop | The bake lowers the terrain into a beach or cliffs and below the water level over the last 64–128 m |
| **Backdrop mesh (T4)** | Two or three layers of low-poly ridges 1.5–4 km out, each layer lighter and bluer (aerial perspective). Height fog fills the valleys between them, so the ridges fade into mist instead of ending | One water plane from the shore to the far plane: a cheap shader (two scrolling normal maps, a fresnel tint, the sky's colour at the horizon), no reflections. Far islands or sea stacks as T4 silhouettes for scale |
| **Fog** | Height fog that is thicker low down (mist in the valleys) | Plain distance fog that turns the far sea into the sky colour, so there is no visible horizon line |
| **Where you can't go, on foot or on the mount** | **The Edge Warden** (§3.10) is what keeps players in. Behind it, as a backstop over the last 16 m: the foothills get too steep to walk, and flying, a headwind turns the mount back | The Edge Warden first. Backstop: past a set distance a current pushes you back to the shore; flying, the same headwind |
| **Cost** | About 20 KiB for each stretch; 1–2 draws | About 5 KiB (a plane and the shader); 1 draw for the whole sea |

- **Corners where the two meet** get a headland (cliffs that drop from the mountains into the sea) so
  the switch from one to the other looks deliberate.
- **The limits that stop the player are rules in the sim** (the slope limit, the current and the
  headwind come from the edge list), so they stay pure, work in co-op, and are tested like the rest.
  The headwind is a smooth push, never an invisible wall.
- **Water at the shore** is drawn by the same sea plane, so the T0–T3 terrain and the sea always meet
  at the same water level. Swimming is out of scope; deep water behaves like the edge current.
- **More regions later:** an edge stretch between two surface regions is simply not listed; only the
  outer edge of the whole world has stretches.

Byte budgets (checked by `check-budgets.mjs`): T2 ≤ 64 KiB a block (Sproutvale has 4), T3 ≤ 160 KiB a
region, T4 ≤ 80 KiB for the whole world edge (about 20 KiB per mountain stretch, 5 KiB for the sea). When there are several surface regions, add one **world LOD**
(32 m grid of every region, ≤ 200 KiB) and let each region's T3 stream like a block, as GTA III did
with the islands.

### 3.2 Choosing the tier: distance from the camera, in 3D

Today the rings count cells from the player's cell. Change the input, not the shape of the policy:

- **Distance is from the camera, in 3D**, to the nearest point of the cell or block's bounding box
  (GTA measures from the camera too). At 150 m altitude nothing directly below is closer than 150 m,
  so T0 and T1 stop loading under a flying camera by themselves. No special "in the sky" flag is needed.
- **T0 stays tied to the players' bodies**, because it carries colliders. In co-op every player keeps
  their 3 × 3 (as now) and the sim's anchors still win.
- **The swap distance has a margin and a fade band** (G7, G8): request at swap distance + 30 m;
  fade over 20 m. The values sit in one table in `rings.ts` next to `LOD0_M` and `LOD1_M`.
- **Hysteresis per tier** (as ring 3 does now) so circling at the edge of a band doesn't thrash.

The policy stays pure in `src/world/rings.ts` (no three, no clock) so `tests/world` keeps covering it
in Node. It returns, for every cell and block, the tier to show, the tier to fetch and a priority.

### 3.3 What gets requested first (G5, G6, G9)

One priority score per request, lowest first:

1. **NOW**: T0 for players (unchanged), and T0 under the predicted landing point (§3.6).
2. **Wedge**: things inside the central 20% of the view, nearest first.
3. **Frustum**: the rest of what is in view, nearest first.
4. **Ahead**: along the velocity for the next 6 s (4 s on foot as now), by tier: when moving faster
   than 25 m/s, only T2 is prefetched ahead; T1 waits until the camera slows or comes near.
5. **Behind**: everything else, only when the queue is idle.

Requests that fall out of the wanted set are cancelled (the queue already supports cancel and promote
after S0 of the asset plan). Under memory pressure, eviction order copies G9: behind the camera
first, then farthest, then least recently shown. T3 and T4 are never evicted.

### 3.4 Showing two tiers at once without seams or pops

Extend the horizon mask that already exists:

- The mask texture keeps one texel per cell and stores **which tier owns that cell** (0 = T3, 1 = T2,
  2 = T1/T0) instead of on/off. Each tier's shader discards fragments in cells owned by a finer tier,
  exactly as `Horizon.ts` does now. A cell whose fine data is still loading stays owned by the coarser
  tier, so there is always ground.
- **Fade by dithering, not alpha** (our change to G8): over 0.4 s the incoming tier dithers in with a
  screen-door pattern while the outgoing one dithers out, both depth-writing. No sorting, no
  transparent pass, and it works with the instanced props. The mask stores a fade value per cell.
- Each coarser tier sits a little lower, growing with distance (T3 already uses 0.5 m), so where both
  are drawn during a fade the fine one wins the depth test.
- Prop instances that a T2 block draws merged are hidden in T1, and the reverse, by the same mask.

### 3.5 Fog, far plane and depth precision by altitude (G12)

The fixed 80–180 m fog is what hides the world today. Make the look depend on camera height `h`
above the ground:

| | On foot (h < 10 m) | High (h ≥ 120 m), lerped between |
|---|---|---|
| Fog near / far | 80 / 180 m (combat stays readable) | 400 / 1,800 m |
| Camera far plane | 600 m | 2,500 m |
| Camera near plane | 0.1 m | 1.0 m (keeps depth precision with the larger far plane) |
| Fog colour | as now | blends towards the sky's horizon colour (aerial perspective) |

The table lives in the manifest next to `fog`, per region, so the Rootdeep keeps its cave look (it
never lerps; you can't fly in a cave). Shadows stay a small cascade around the player; T2–T4 never
cast or receive real-time shadows and use baked AO instead.

### 3.6 Landing: colliders when coming down from the air

The danger is falling into a cell whose colliders aren't built yet.

- The client already decodes T3 heights. From them it predicts the landing point along the velocity.
  When the time to ground is under 5 s, that point's 3 × 3 becomes a NOW request.
- The sim keeps its existing rule: the player's body can't enter a cell that isn't `cellReady`. In
  flight that means the body hovers at the boundary instead of falling through, and the veil shows only
  if the wait passes `VEIL_TIMEOUT_MS`, as now. This stays in the sim, so it stays pure and tested.

### 3.7 Packing and the network (G10)

- **One request per block for T2**: a single GLB per block.
- **Cell packs for T0/T1**: the bake writes one file per cell instead of a `.bin` and a `.json`
  (a small header plus both halves). That halves the request count when flying low.
- **Content-hashed names** (`c_3_0.4f2a.bin`) listed in the manifest, served with
  `Cache-Control: immutable` on Vercel, so revisiting an area is free. Assets stay committed in git.
- Decoding stays off the main thread (`terrain.worker.ts`). The bake does all merging, so the client
  never merges geometry. Uploads go through `UploadBudget`, which the asset plan is moving to a byte
  budget. A T2 block counts as one geometry job per mesh.

### 3.8 Flight itself

There is no flight in the game yet. **The owner's call (2026-11-19): flight is a gameplay feature.**
God-mode flying comes first as the test harness; the gameplay version follows.

**God-mode fly (the harness).** On the `claude/god-mode` work: a sim command toggles it, and the sim
moves the player as a kinematic body with no gravity. Pad: left stick to move, triggers for up and
down, a held button to boost to 60 m/s. Keyboard mirrors it. It goes through commands like every other
input, so `ReadonlySimView` and the architecture test still hold. It flies faster and higher than the
gameplay version will, so it is the worst case for streaming.

**Gameplay flight: a flying mount.** The game already has a ridden mount (the bull: `riding.ts`,
`mountCall.ts`, `content/mounts.ts`) and a test that streaming keeps up with it at a gallop
(`tests/sim/riding-streaming.test.ts`). Flight reuses that system instead of a new one:

- **What it is:** an original flying creature (no art or name from an existing game), called like the
  bull, unlocked mid-game. The design and model are for the owner and the art pipeline; this plan only
  fixes the numbers streaming has to hold.
- **Movement (sim, pure):** take off from the ground; cruise 25 m/s, dive up to 45 m/s, climb 8 m/s;
  stamina-limited boost. Ceiling 250 m above the ground, with soft resistance from 200 m, so the
  altitude fog table (§3.5) has a known top. Banking and a stall-free glide keep it readable on a pad.
- **Landing:** dismount only on ground that is `cellReady` (§3.6). Getting hit hard or running out of
  stamina makes the mount glide down; it never drops the rider from height.
- **Combat while flying:** spells only, no staff. `spells.ts` already extends reach to a target flying
  overhead; the same rule works from above. Ground enemies that can't reach a rider leash home, so
  flying is a way to travel, not to cheese fights. Boss arenas and the Rootdeep are no-fly zones
  (the mount lands and is dismissed), marked in the region data like other zones.
- **Pad first (owner rule):** call, take off, climb, descend, boost and land all work with the pad only,
  and the flight e2e lap (§5) drives it with the simulated gamepad.
- **Co-op later:** two riders can be 1 km apart. The tier policy already takes a list of players; with
  two cameras it takes the nearest camera per cell, and the GPU budget is split between them.
- **Saves:** whether the mount is unlocked goes in the save like the bull; position in the air is not
  saved (a load puts you on the ground at the nearest ready spot).

Because players will see the world from the air all the time, the T2 block look (§3.1) is now a
shipped look, not a debug view. It gets the same art review as near props.

### 3.9 Lights at night (far lamps as sprites)

**Needed: the owner chose day and night (2026-11-19, §3.11).** San Andreas and its mods drew far
street lamps as glowing sprites (the "LOD lights" in 2dfx data). The bake writes every lantern, lit
window and beacon position (with a colour and size) into the T2 block and T3. Each block draws them as
one point-sprite draw, sized by distance and faded in by the same night value as everything else. Towns
and roads then show from the air at night for about 1 KiB a block. Close to the player only the nearest
4 lamps are real lights (forward rendering pays for every light on every lit material); the rest are
sprites at every distance.

### 3.10 The Edge Warden: a dragon that guards the world's edge

**The owner's call (2026-11-19):** when a player gets close to the edge, a huge dragon appears. It is
very fast and strong, fires a lot, and one burn kills. It uses the dragon from sproto-shooter.

**The model is already here.** sproto-shooter-bosses' `dragon.glb` is imported for the Skyfire Drake
boss as `models/bosses/drake.glb` (731 KiB, clips `fly` and `fireball`) and
`models/bosses/drake_far.glb` (107 KiB, a simplified far version with `fly` only). The Warden uses both
as they are: no new import and no new download for anyone who has met the Drake. To keep it from
reading as the boss, the view draws it **3 × the Drake's size** (`fitHeight` 15 m instead of 5) with a
darker tint and glowing eyes and mouth. "Edge Warden" is a working name.

**Bands**, measured inward from the nearest edge stretch (§3.1.1), on foot or on the mount:

| Band | Distance from the edge | What happens |
|---|---|---|
| **Watch** | ≤ 160 m | Nothing visible. The client fetches `drake.glb` at LATER priority so it is ready (`drake_far.glb` is small, so it is fetched too) |
| **Warning** | ≤ 96 m | **It appears**: it flies in from beyond the edge with a roar, circles 120–150 m up, and a HUD line warns the player to turn back. 4 s of grace, no attacks |
| **Strike** | ≤ 64 m, or the grace runs out | It attacks without stopping (below) |
| **Leave** | back past 128 m | It breaks off, flies out past the edge and despawns. The gap between 96 and 128 m keeps it from flickering in and out at the line |

**How it fights** (it reuses the Drake's flight brain in `src/sim/systems/drake.ts`, with its own
tuning in a new content pack):

- **Fast:** cruises at 40 m/s and dashes at 90 m/s, faster than the flying mount's 45 m/s dive, so you
  can't outrun it outwards. Turning back inland is always the escape.
- **Fires a lot:** fireball barrages of 6 a second, fast (40 m/s) and leading the target, each taking
  about 40% of max health. Two or three hits kill. Rolls and cover still work, so a skilled player can
  survive long enough to retreat.
- **The burn:** a big breath shot with a clear 1.2 s telegraph (glowing mouth, roar, a mark on the
  target). If it hits, it kills: 100% of max health, ignores defence, can't be blocked, and Mirror Ward
  can't send it back. It fires one every 5 s while you stay in the strike band.
- **Can't be beaten:** it takes no damage and can't be staggered or broken. No loot, no XP, no quest;
  it is a wall with wings, not a boss to farm.
- **Fair:** it always warns first, never chases inland past the warning band, and never attacks during
  dialogue, the veil or a cutscene. Dying to it is a normal death (respawn at the last shrine).
- **God mode** can't die, so the Warden only knocks a god back; the backstop at the last 16 m
  (§3.1.1) and a hard clamp at the last baked cell still stop it.
- **Co-op:** one Warden for each player in the warning band, at most 2, each targeting its own player.
- **Not with the Skyfire Drake:** it never spawns while that boss fight is running, and the bake checks
  that no shrine, camp, quest marker or boss arena lies within 96 m of an edge stretch, so the Warden
  never lands on content. Watch out: the Drake's arena (`DRAKE_ARENA` at x 126, radius 30) has its rim
  exactly 96 m from Sproutvale's west edge. If the west side stays an outer edge, either the warning
  band there shrinks to 80 m or the arena moves 16 m east.

**Performance:**

- Circling more than 150 m away it draws `drake_far.glb`; close in, `drake.glb`. With 3 × scale it is
  visible from far, so it counts as a landmark for the far-view tiers: it is never culled by LOD distance
  while active.
- If the full model is late, the asset plan's proxy body (S1) draws it and its telegraphs stay readable.
- Fireballs come from a pool of at most 24, reusing the Drake's `fireball` model and VFX, which the
  shader warm-up at the title already covers.
- It is session state only: nothing goes in the save.
- **At night** its eyes, mouth, fireballs and the burn's mark are emissive, so it and its telegraphs read
  in the dark; the e2e lap checks the warning at midnight too.

**Sim side (pure):** a new `src/sim/systems/edgeWarden.ts` reads the player's distance to the edge from
the region's `edge` list (content data, no client lookups), runs the bands, and drives the Drake flight
code and the existing enemy projectiles (which already support counts, intervals and homing). Views and
the HUD only read it through `ReadonlySimView`.

### 3.11 Day and night

**The owner's call (2026-11-19): the game has day and night.** There is no clock today: the renderer
blends one look from the storm and the cave (`Renderer.ts`, `caveLook.ts`). This section adds the
cycle, shaped so the far view keeps working at every hour.

- **The clock lives in the sim** (pure, counted in ticks, no `Date.now`). One game day is 24 real minutes
  by default, as in GTA III and San Andreas (one game minute a second). The hour goes in the save. God
  mode gets a "set hour" entry next to its travel list, so any hour can be tested.
- **A look table by hour** (our `timecyc.dat`, G12): keyframes every 2 hours for sun direction and
  colour, ambient, sky top and horizon colours, fog colour, and a multiplier on fog distance and the far
  plane. The renderer blends between keyframes every frame.
- **One look, in a fixed order:** hour → altitude (§3.5: the fog distances are the altitude table's
  values times the hour's multiplier) → storm → cave. The cave still wins underground, as now.
- **Night fog:** shorter on the ground (about 60 / 150 m, so the dark feels close), but from the air the
  lamps (§3.9) and a moonlit horizon carry the view: the altitude table still opens it to about 1 km.
- **Shadows:** the sun's shadow follows the sun; at night the moon gives a dim light with no shadow
  map, so nights cost less GPU than days, never more.
- **Lit windows and lanterns (our G13):** no model swap and no extra download. Materials that glow get
  an emissive mask, and one shared `nightGlow` uniform (0 by day, 1 at night, eased at dusk and dawn)
  turns them all on. The same value fades in the sprite lamps.
- **Far tiers at night:** T2 and T3 use lit materials, so they darken with the same sun and ambient.
  T4's mountains become dark silhouettes against the sky; the sea shows a moon glint from the same cheap
  shader.
- **Gameplay by the hour:** day-only and night-only enemies are in this plan (§3.12). Other hour rules
  (closed shops, NPC schedules) are out of scope; the clock is in the sim, so later systems can read it.

### 3.12 Day enemies and night enemies

**The owner's call (2026-11-19):** add enemies that only come by day and enemies that only come at
night. **Every enemy in the game today stays at every hour.** The new ones use placeholders for now:
one placeholder look for day-only enemies and a different one for night-only enemies, so it is obvious
in play which group you are fighting. Real models come later through the art pipeline and replace the
placeholders without touching the sim.

**Hours on camps and enemies.** `CampDef` and `EnemyDef` get an optional `hours: 'day' | 'night'`.
Leaving it out means every hour, so all current content keeps working unchanged. Day is 06:00–19:00 and
night is 19:00–06:00, with the swap at dusk and dawn.

**The placeholders** (built in code, no download, no GPU texture):

| | Day-only placeholder | Night-only placeholder |
|---|---|---|
| Shape | A rounded capsule body with a simple head, sized from the enemy's `body` radius and height, so its hitbox matches | The same build, so collisions and hitboxes don't change when real art arrives |
| Look | Warm and bright: sun-yellow body, orange band, a small sun disc on the chest | Cool and dark: deep violet body, glowing cyan eyes and a crescent on the chest, emissive so it reads in the dark |
| Motion | Procedural: bob, lean into moves, squash on hits, and a flash on telegraphs. No skeleton | Same, plus a faint trail |
| Telegraphs | The game's usual glints and attack colours, unchanged | The same, made brighter by `nightGlow` so they are readable at night |

Each new enemy names `model: 'placeholder_day'` or `'placeholder_night'` in its `EnemyDef`. When its real
GLB lands, the def switches to the real model and nothing else changes.

**The first enemies** (moves, stats and AI styles come from the existing kinds, so no new combat code):

| Group | Working name | Built from | Where | What makes it different |
|---|---|---|---|---|
| Day | Sun Raider | Grunt moves, faster | Orchard Fields and Millrun roads | Comes in groups of 3–4 and runs off with dropped loot if you leave it |
| Day | Glare Archer | Slinger moves | Watchtower Hill, Quarry rim | Longer range in the open; worse in shade and at dusk |
| Day | Field Ox-Brute | Brute moves | Open fields | Charges across open ground |
| Night | Gloam Stalker | Grunt moves, harder hits | Thornwood, Sprout Hollow outskirts | Hard to see until close; +50% XP |
| Night | Hollow Wisp-Swarm | Wisp moves, several weak bodies | Over fields and the river | Groups that drift towards light |
| Night | Night Brute | Brute moves, more poise | Quarry, Thornwood edge | Tougher; +50% XP and sprouts |

Night enemies give more XP and sprouts, because the dark makes fights harder. Names and the exact
roster are for the owner; the plan only fixes the system.

**How the swap works** (all in the sim, pure, reading the sim clock):

- At dusk, day-only camps stand down and night-only camps come out; at dawn the reverse. A camp only
  swaps when no player is within 80 m of it and none of its members is fighting or leashing, so enemies
  never pop in or vanish in front of the player. A camp that couldn't swap tries again each game minute.
- Camps that are mixed stay as they are; only members with `hours` come and go.
- Killed `unique` members stay dead, as now. A cleared hour-bound camp comes back at its next hour or
  when you rest, like other camps.
- **Shrines get "Wait until nightfall" and "Wait until morning"**, so a player can choose the enemies
  they want to fight. It works with the pad only, like every menu.
- **Never by hour:** bosses, quest camps and anything a quest needs (a content test checks that no quest
  objective points at an hour-bound camp), the Rootdeep (caves ignore the clock, as the cave look does),
  and the Edge Warden.

**Streaming and performance:** placeholders cost nothing to download. When real models replace them, a
night model is fetched at LATER priority 15 game minutes before dusk (and a day model before dawn) if a
player is within 300 m of a camp that uses it, so the swap never waits on a download. The swap changes
which enemies exist, not how many: an hour-bound camp is no larger than the camp budget allows now.

**Saves:** the hour (§3.11) is already saved. Camp state is saved as now; which group is out follows
from the hour when loading.

**Tests:**

- `tests/sim`: at dusk a day camp far from the player stands down and a night camp comes out; a camp
  within 80 m or in a fight does not swap; "wait until nightfall" swaps them; bosses, quest camps and
  the Rootdeep never change.
- Content test: every `hours` camp uses a placeholder or a real model that exists; no quest points at
  one.
- e2e, pad only: rest until nightfall at a shrine, find a night placeholder, fight it, rest until
  morning, and see a day placeholder at its camp.

---

## 4. Bake changes (`tools/bake-world.ts`)

1. **T2 blocks**: for each 4 × 4 cell block, resample the terrain at 4 m, take every prop's LOD1 mesh,
   bake its transform in, merge by material class into at most 3 meshes, bake AO into vertex colour,
   simplify to a triangle budget (≈ 20k a block), write `blocks/b_<bx>_<bz>.<hash>.glb`.
2. **T3 upgrade**: add tree-mass blobs (cluster trees per 16 m into one low-poly canopy) and silhouettes
   for every prop taller than 4 m, beside the existing landmark impostors.
3. **T4 backdrop and edge terrain**: from the `edge` list (§3.1.1). For a mountain stretch, raise the
   last 64–128 m of terrain into foothills and generate the ridge layers from a seed; for a sea
   stretch, lower that terrain into a beach or cliffs below the water level. Headlands at the corners
   where they meet. One world-level backdrop file.
4. **Manifest**: a `blocks` list (like `cells`), the altitude fog table, hashed paths, and bytes for
   each file so budgets and the loader's progress keep working.
5. `npm run check:assets` checks each tier exists for each block and region and is under its cap.
6. Light points (§3.9): every lantern, lit window and beacon written into its T2 block and T3, with a
   colour and size; materials that glow at night get an emissive mask.
7. The bake fails if a shrine, camp, quest marker or boss arena lies within 96 m of an edge stretch
   (the Edge Warden's warning band, §3.10).

Generated files are never edited by hand; they come out of the bake like the cells do today.

---

## 5. Measurement and tests

| What | Where | Pass |
|---|---|---|
| Tier policy (camera height, wedge order, hysteresis, landing prefetch) | `tests/world`, pure Node | Unit tests, like `planRings` now |
| **No holes** | Debug overlay and e2e: count cells where no tier is drawn | Always 0, at every frame of the flight lap |
| **Flight lap** | New `tests/e2e/flight.mjs`, pad only: god-mode fly over Sproutvale at 40, 120 and 250 m, at 20 and 60 m/s, then dive and land. After F8, the same lap again on the flying mount at gameplay speeds | Lands without falling through; queue stays bounded; heap returns to baseline |
| Long frames | Same lap with `SMOKE_STRICT_LONGTASKS=1` on a GPU machine | No task over 50 ms after the first 5 s |
| Pops | Overlay counts swaps without a fade | 0 |
| Draw calls and triangles at 250 m | Overlay (`renderer.info`) | ≤ 300 draws, ≤ 1.5 M triangles |
| Bytes | `check-budgets.mjs` per tier | Under the caps in §3.1 |
| Day and night | `tests/sim` for the clock (ticks to hours, saved and loaded); the flight lap run at noon and at midnight | At midnight: towns visible from 250 m by their lamps; frame time no worse than noon; sprite lamps one draw per block |
| Edge Warden rules | `tests/sim`, pure: walk and fly towards each edge kind | Appears at 96 m and not before; no attack during the 4 s grace; leaves past 128 m; the burn kills from full health; never attacks inside 128 m; never spawns in the Rootdeep or during the Drake fight |
| Edge Warden in the game | `tests/e2e/flight.mjs`, pad only: fly to the edge, see the warning, turn back and see it leave; then stay and die, and respawn at the shrine | Passes; no long frame when it first appears |

CI runs the flight lap once at a single height, like the one Sproutvale lap it runs now. The full lap
runs locally before a streaming PR.

---

## 6. Milestones (1 unit ≈ one focused engineer-week)

| # | What | Units | Main files | Done when | Risk |
|---|---|---|---|---|---|
| **F0** | God-mode fly, and altitude fog / far / near (§3.5, §3.8). The existing T3 then already shows the whole region from the air | 0.75 | `src/sim/systems/god.ts`, `commands.ts`, `Renderer.ts`, `caveLook.ts`, manifest | You can fly to 250 m and see all of Sproutvale as low detail; on foot nothing changes | Low |
| **F1** | Camera-aware 3D tier policy, wedge priority, cancel on leaving (§3.2, §3.3) | 1 | `rings.ts`, `CellStreamer.ts`, `viewCull.ts` | T0/T1 stop loading under a high camera; requests follow the view | Low |
| **F2** | T3 upgrade, and the T4 edge: mountains and mist, sea, headlands, the sim's edge limits (§3.1.1, bake §4.2–4.3) | 1.75 | `bake-world.ts`, `Horizon.ts`, new `src/world/Sea.ts`, `format.ts` (the `edge` list), a sim edge system | From the air, trees and buildings read as masses; no world edge from any height or side; on foot and on the mount the edge pushes back smoothly | Medium: art look |
| **F3** | T2 block LODs and the tier mask (§3.1, §3.4) | 2 | `bake-world.ts`, new `src/world/BlockLod.ts`, `Horizon.ts`, `PropInstancer.ts` | 180 m – 1.5 km shows merged blocks; 0 holes on the flight lap | Medium: seams |
| **F4** | Dithered fades (§3.4) | 0.5 | terrain, prop and block materials | 0 un-faded swaps | Low |
| **F5** | Landing prefetch and the sim's hover-at-boundary rule (§3.6) | 0.75 | `rings.ts`, `SimWorld.ts`, physics | Dive at 60 m/s lands with no fall-through and no veil | Medium |
| **F6** | Cell packs, hashed names, immutable caching (§3.7) | 0.5 | `bake-world.ts`, `RegionManifest.ts`, a new `vercel.json` for the cache headers | Half the requests on the flight lap; repeat visit downloads 0 bytes | Low |
| **F7** | Residency counts T1–T3 (with S3 of the asset plan) | 0.5 | `Residency.ts` | Flight lap stays under the GPU budget | Low |
| **F8** | Flying mount: sim movement, call, take-off, landing, no-fly zones, spells from the air, pad controls, save flag (§3.8) | 2.5 | `src/sim/systems/riding.ts`, `mountCall.ts`, new `flight.ts`, `content/mounts.ts`, `commands.ts`, camera, HUD | The flight lap passes on the mount at gameplay speeds; a sim test like `riding-streaming.test.ts` proves streaming keeps up at 45 m/s dives | Medium: feel |
| **F9** | The mount's model and animations (art pipeline, `art/README.md`) | 1–2 | `art/`, `public/assets/models/` | The owner signs off; within the model budget, with a LOD for far views | Medium: art |
| **F10** | The Edge Warden: bands, flight and attacks on the Drake brain, 3 × scale and tint, HUD warning, pool, tests (§3.10) | 1.5 | new `src/sim/systems/edgeWarden.ts`, new `src/content/packs/edge.ts`, `drake.ts`, `DrakeViews.ts`, HUD | The sim and e2e rows in §5 pass | Medium: tuning so it is scary but fair |
| **F11** | Day and night: the sim clock and save, the hour look table, the blend order, moon light, `nightGlow` emissive, god-mode "set hour" (§3.11) | 1.5 | new `src/sim/systems/clock.ts`, `save/schema.ts`, `Renderer.ts`, `caveLook.ts`, materials, `god.ts` | A full day passes with smooth light; the cave look and storm still work; the save keeps the hour | Medium: the look |
| **F12** | Far lamps as sprites, and the nearest 4 as real lights (§3.9) | 0.5 | `bake-world.ts`, new `src/world/LampSprites.ts`, `BlockLod.ts` | The midnight row in §5 passes | Low |
| **F13** | Day and night enemies: `hours` on camps and enemies, the swap rule, the day and night placeholders, the first six enemies, "wait until" at shrines (§3.12) | 1.5 | `content/enemies.ts`, `sproutvaleContent.ts`, `sim/systems/encounters.ts`, new `src/render/views/PlaceholderEnemy.ts`, shrine menu | The tests in §3.12 pass; current enemies are unchanged at every hour | Low |

Total about **17 units**, of which F8 and F9 are the gameplay flight itself. F0 alone gives most of the
visible win, because T3 already covers the region; it is the place to start and to judge the look
before investing in F2 and F3.

Order: F0 → F1 → F2 → F3 → F4, with F5 and F6 able to go in parallel after F1. F7 waits for S3.
F8 can start after F0 and F5 (it needs the landing rule); F9 can run in parallel from the start. Flight
ships to players only after F3 and F4, so nobody sees the bare-ground or popping version.
F10 needs the `edge` list from F2; it can start on foot before F8 and gets its flying test once F8 lands.
It must ship no later than flight (F8), because flight is what lets players reach the edge easily.
F11 is independent and can start any time (it only touches the look and the sim clock). F12 needs F3's
blocks and F11's `nightGlow`. F13 needs F11's clock only; it doesn't wait for any streaming work.

### Collisions with work in flight

- `claude/god-mode` (this checkout, uncommitted): touches `SimWorld.ts`, `commands.ts`, `god.ts`,
  `App.ts`, `mapTab.ts`. F0 builds on it, so merge it first.
- The asset-streaming plan's S0 (cancel and promote in the queue) and S3 (residency): F1 needs S0;
  F7 needs S3.
- Rootdeep: any change to `rings.ts` or the fog must keep the cave look (`caveLook.ts`) and its tests.
- A session building a bigger world (town and mountains) is running now. If it grows the surface, the
  T2 and T3 budgets and the world-LOD question (decision 2) need its final size; check before F2.
- The bull mount: F8 extends `riding.ts` and `mountCall.ts`; don't run it alongside other mount work.
- The storm and the Rootdeep cave look (`Renderer.ts`, `caveLook.ts`): F11 puts the hour first in their
  blend; both must look the same as today at noon.
- The Skyfire Drake (C6): F10 reuses `drake.ts` and `DrakeViews.ts`. Any change there must keep the
  boss fight's tests passing.

---

## 7. Risks

| Risk | Mitigation |
|---|---|
| Seams between T1 and T2 terrain (different grid spacing) | T2 drops lower with distance; edges of T2 tiles get skirts; the mask hides T2 under T1 |
| The merged T2 look doesn't match the near props | T2 is made from the same LOD1 meshes and splat colours; review screenshots at 200 m each milestone |
| Depth fighting with a 2.5 km far plane | Near plane rises with altitude; coarse tiers sit lower |
| Draw calls grow with more regions | Blocks merge per block; regions beyond the current one show as one T3 or one world LOD draw |
| Fall-through when diving | The sim, not the client, refuses to enter an unready cell (§3.6) |
| Flying past the 30 fps floor on weaker devices | The device tier from the asset plan scales the T2 distance and the altitude fog far value |

---

## 8. Decisions for the owner

1. ~~Is flight a gameplay feature or a god-mode tool?~~ **Answered 2026-11-19: a gameplay feature**
   (§3.8, F8, F9). Still open within it: the creature's design, and where in the game it unlocks.
2. **Biggest planned surface world?** Under about 1.5 × 1.5 km, T3 per region is enough and the world LOD
   can wait.
3. ~~What lies past the world edge?~~ **Answered 2026-11-19: both, mountains and mist in some places,
   sea in others** (§3.1.1). Still open: which side of the world gets which, and it should match the
   big-world work's map.
4. ~~Will there be night?~~ **Answered 2026-11-19: yes, day and night** (§3.9, §3.11, F11, F12). Still
   open: the length of a game day (24 real minutes assumed).
   **Day and night enemies, decided 2026-11-19** (§3.12): current enemies stay at every hour; new
   day-only and night-only enemies use two different placeholders for now. Still open: their names and
   final roster, and when real art replaces the placeholders.
5. **The Edge Warden** (§3.10, decided 2026-11-19: a dragon at the edge, using the sproto-shooter
   dragon). Still open: its name, and whether 3 × scale with a dark tint is different enough from the
   Skyfire Drake, which uses the same model.

---

## Sources

- re3, the reverse-engineered GTA III source: `src/renderer/Renderer.cpp` (`ScanWorld`,
  `SetupEntityVisibility`, `ScanBigBuildingList`), `src/renderer/Renderer.h` (`LOD_DISTANCE`,
  `FADE_DISTANCE`, `STREAM_DISTANCE`), `src/core/Streaming.cpp` (`AddModelsToRequestList`,
  `DeleteRwObjectsBehindCamera`, `LoadScene`, island LODs), `src/core/World.h` (sector grid). Mirror:
  https://github.com/FSSRepo/re3
- Multi Theft Auto wiki, GTA:SA resource streaming (IPL and COL sectors in the IMG, loaded when the
  streaming position enters them; grouped reads): https://wiki.multitheftauto.com/wiki/GTA:SA_Resource_Streaming
- GTA wiki, IPL `INST` section (the LOD index on each placement): https://www.grandtheftwiki.com/INST
