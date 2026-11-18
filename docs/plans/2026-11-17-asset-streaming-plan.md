# Sproto Open World: Asset Streaming Architecture

**Decision.** Keep the cell streamer, terrain worker and prop instancer. They are sound. Add what is missing around them: detail tiers for characters and textures, one scheduler for every download, one residency manager that can release memory, and a hard rule that the sim never waits for a download.

**How this was checked.** I read the code on `claude/m4-sproutvale` at `de1f969`. I also ran read-only probes outside the repo: the real `CellStreamer` and `SimWorld` in `App.playFrame` order, a census of all 86 GLBs, and model parse timings. Timings come from Node on an Apple Silicon Mac with no GPU work. **Assumption:** the reference laptop is about 4× slower. Other assumptions are marked.

**Second check.** The main findings were re-read against the code, and finding 1 was reproduced in the running game: the veil flashed and input was held on the frame after a cell crossing (one crossing observed in that run, on a software GPU). Download figures come from a real run of the game on the dev server (decoded bytes): 3,952 KiB at the title, 1,106 KiB more after Play.

---

## 1. Diagnosis

Ranked by harm to play.

| # | Problem | Evidence | What the player feels |
|---|---|---|---|
| 1 | **Crossing into a new cell raises the loading veil for a frame and drops input.** `groundReady` needs colliders on all 3 × 3 cells, but the three new neighbours only go Active on the crossing frame, and the check runs before the tick that builds them. | `CellStreamer.ts:382-391`, `App.ts:573-579`, `App.ts:736-742`. Probe: 10 of 12 crossings held one frame, at 5.2, 7.8 and 12.1 m/s. The other two followed a U-turn. | A dark flash, the HUD blinking, and a lost button press about every 8 s of sprinting. |
| 2 | **Enemies can fight while invisible.** Brute and humanoid views stay empty until the model lands. Lazy models get no view at all, so telegraph glints are lost too. | `EnemyViews.ts:113`, `EnemyViews.ts:506`, `WorldViews.ts:285`, `WorldViews.ts:117` | Unreadable attacks on a slow link or after a respawn. |
| 3 | **Characters are never shader-warmed or upload-budgeted.** Only props and terrain use `compile` and `UploadBudget`. | Callers: `WorldSession.ts:67-86`, `PropInstancer.ts:329-335` only | A stall on the first draw of each new enemy type. Worst long tasks measured were 1,350 and 3,088 ms (software GPU, relative only). |
| 4 | **Sim state depends on network timing.** Colliders arrive when the download does, and bodies over unbuilt cells freeze. | `CellStreamer.ts:226-228`, `SimWorld.ts:414-423`, `SimWorld.ts:431-447` | Nothing yet. It blocks co-op and replays. |
| 5 | **Character memory is never released.** `templates` only grows and `refs` is never read. `dispose()` frees the skeleton only. | `AssetLoader.ts:46`, `:69`, `:76-83` | Each staff tried costs 16–24 MiB of GPU for the whole session. All five cost 100 MiB. |
| 6 | **A single failed download is permanent.** Models keep a placeholder and props stay hidden for the session. No retry. | `AssetLoader.ts:109-112`, `PropInstancer.ts:307-310` | One network blip gives a capsule Brute until reload. |
| 7 | **Swapping staffs leaves empty hands, and can mount two.** Already fixed on `claude/c2-staffs` (`dcd459b`), not merged here. Take that fix. | `PlayerView.ts:43-55` | The weapon vanishes for the length of a 0.8–1.2 MB download. |
| 8 | **Loader priorities are wrong.** Every character is NOW. Prop loads cannot be cancelled or promoted. Terrain textures and audio skip the queue. | `AssetLoader.ts:96-102`, `:86-90`, `PropInstancer.ts:285-291`, `AudioManager.ts:66` | A far enemy can delay the ground under you. |
| 9 | **The title downloads things it does not need.** The Brute (569 KiB) and the full staff (754 KiB) load there, though a 219 KiB `staff_sproto-lod1.glb` already ships unused. | `App.ts:226-227`, `manifest.ts:44` | Slower first play. |
| 10 | **Prop LOD has no hysteresis and props are never culled by view.** Each change re-uploads the whole matrix buffer. | `rings.ts:187-192`, `PropInstancer.ts:203`, `:277` | Fine at today's 565 instances, not at 10×. |

**The budget number misleads.** `check-budgets.mjs:27` counts `sky.jpg` (566 KiB), which world mode never loads (`Renderer.ts:71-73`), plus four enemies that are not at the start (1,365 KiB). It leaves out audio. The honest critical figure, with the LOD1 staff, is about **5.4 MiB**, not 7.7.

**Other waste found:**
- Rapier's WASM is inlined as base64: 1,604 KiB gzipped, against 832 KiB as a brotli `.wasm`.
- `App.ts:30-31` imports it statically, so the title waits for it.
- Grass samples `floor.jpg` at mip bias 2.5–3.0 (`TerrainChunk.ts:52-53`), so its top mips are nearly unused.
- `staff_sproto` has 10k triangles and 20 MiB of textures. The player's body has 5.8k and 5.3 MiB.
- Seven models share one 24-joint skeleton. Animation and glTF JSON are 55–64% of each standard enemy's file.
- Multi-region does not exist yet: `SPROUTVALE` is hard-coded (`RegionManifest.ts:4`).

### Where the main thread can stall

| Work | Measured | × 4 estimate | Verdict |
|---|---|---|---|
| Shader compile on first draw | Not measurable here | Often 50–300 ms (assumption) | **Worst. Fix first.** |
| Texture upload with mipmaps | Not measurable here | 10–40 ms per 1024² RGBA (assumption) | **Bad.** The budget counts textures, not bytes (`UploadBudget.ts:6-7`) |
| GLB parse plus `prepareRig` | Player 25 ms, enemies 4–6 ms | 16–100 ms | Bad for heroes, and grows with detail |
| Skinned clone | 0.2–0.45 ms | 1–2 ms | Minor. Limit to one per frame |
| Heightfield collider | 0.14 ms | 0.6 ms | Fine. No change |

A stall also costs input. Pad buttons are polled once per frame (`App.ts:496`), so a tap shorter than a stall never happens.

---

## 2. The distance model

Every asset has three distances: **request** (start downloading), **show** (needed on screen) and **release** (may be evicted). Show and release differ, which gives the hysteresis.

`request = show + max(speed, 5.2 m/s) × lead`

`lead` is the expected download plus decode time from measured throughput, clamped to 3–10 s. Design top speed is **12.1 m/s**, the Pepe Bull's sprint on `claude/pepe-bull-mount` (7.8 × 1.55).

All ranges are in metres, written as in / out.

### World

| Class | Tier | Range | Content | How the change is hidden |
|---|---|---|---|---|
| Terrain | Active | Ring ≤ 1, **plus any cell within 24 m of the player** | 1 m grid, colliders | Skirts |
| | Visual | Ring 2 | 2 m grid | Fog from 80 m |
| | Hold | Ring 3 | Keep what is loaded | Fog |
| | Horizon | Whole region | 8 m grid | Masked under real cells (exists) |
| Props | P0 | ≤ 60 / 68 | LOD0 with shadow | Shadow box ends near here |
| | P1 | ≤ 70 / 80 | LOD0 | Same mesh |
| | P2 | ≤ 110 / 120 | LOD1, 30% triangles | Swap below 1.5 px of error |
| | P3 | ≤ 180 / 195 | **New** LOD2, 10% triangles | Fog is over 30% here |
| | Landmark | ≤ 450 | Horizon impostor | Exists |

### Characters

A 1.8 m body on a 1080p screen at 62° is `1618 / d` pixels tall: 115 px at 14 m, 40 px at 40 m, 18 px at 90 m.

| Tier | Range | Mesh | Textures | Animation | Shadow |
|---|---|---|---|---|---|
| C0 | ≤ 14 / 18 | Full | T0 | Every frame | Yes |
| C1 | ≤ 40 / 48 | 45% | T1 | 30 Hz | Yes |
| C2 | ≤ 90 / 105 | 15% | T2 | 10 Hz | No |
| C3 | ≤ 150 / 180 | 200-triangle silhouette, instanced per archetype | Tint | Held pose | No |

- Anything targeting the player is at least C1, whatever its distance.
- Tier swaps use a 0.2 s dither.
- This also delivers the animation rates promised in plan §3.4, which are not built (`EnemyViews.ts:597`).

### Bosses, weapons, textures, audio, VFX

| Class | Rule |
|---|---|
| **Boss** | Request at 250 m or on the quest step that points at it, whichever is first. Full mesh and T0 at P1. Resident for the fight and 60 s after. A reserved memory pool means it evicts nothing the fight needs. |
| **Player's staff** | LOD1 is pinned at boot. Full model upgrades after 10 s out of combat. Swaps keep the old staff until the new one is ready. |
| **Loot and shop staffs** | LOD1 only, requested within 30 m or when the menu opens. |
| **Textures** | T3 64 px travels inside the lowest mesh, so a mesh is never untextured. T2 256, T1 512 and T0 1024–2048 are separate files, upgraded one step at a time. |
| **Audio** | Combat sounds pinned. Ambience streams within 120 m. Enemy voices request at 60 m. Late audio is silence, never a wait. |
| **VFX** | Code-generated and pinned (true today). Particles: full to 30 m, half to 60 m, none past 90 m. |

### Always resident

The pinned set never waits on the network and is never evicted:
- player mesh and clips
- equipped staff (at least LOD1)
- combat sounds, hit and spell VFX, telegraph decals
- proxy bodies, HUD, terrain textures, horizon

Play does not start until it is ready.

---

## 3. Gameplay safety

### Invariants

1. **The sim never reads a render asset.** `tests/architecture.test.ts` already enforces the import rule.
2. **After region entry, the sim makes no decision that depends on the network.** A region collision pack goes into `SimWorld` at session start. Cells activate as a pure function of entity positions and the tick. Size for Sproutvale: **179 KiB** of heights brotli-compressed, plus about 9 KiB of placements.
3. **Every entity is drawable from its first frame.** A proxy body exists before any model.
4. **Telegraphs never depend on a model.** Glint, decal and lean run on the proxy.
5. **Nothing the player has is removed before its replacement is ready.**
6. **No load blocks a frame.** All main-thread work goes through the frame budget.
7. **Only the UI may wait for assets, and only before sending a command.** The sim sees commands, so determinism holds.

### When an asset is late

| Case | What happens |
|---|---|
| **Enemy before its model** | Proxy with the right size, glow, lean and telegraphs. `FallbackView` (`EnemyViews.ts:402`) is the starting point. Model dithers in over 0.2 s. |
| **Boss before its model** | The arena gate's prompt holds until the boss is ready, for at most 10 s. The `interact` command is simply not sent yet. After 10 s the fight opens on the proxy. The sim never waits. |
| **Fight on a slow link** | Combat mode: only P0 and P1 download, tiers do not upgrade, nothing in use is evicted. Combat is true while any enemy targets the player (`App.ts:657`). |
| **Teleport or respawn** | Cancel everything stale. The veil holds for the collision pack's cells and the pinned set, not for visuals. Nearby enemies show as proxies. The 15 s timeout stays. |
| **Fast mount** | Lead grows with speed. If streaming falls behind, skip LOD0 and show LOD1. Never slow the player. With invariant 2 the ground is always there. |
| **Download fails** | Three retries with `withRetry`, then again after 30 s. The placeholder is never stored as the template. |
| **Tier cannot fit in memory** | Stay on the tier already resident. |

### Frame budget

**The floor is 30 fps on every machine we support (owner's decision), so a frame may take up to 33.3 ms on the weakest one.** Faster machines run higher. The limits below stay tight on purpose, so loading never uses up that headroom. Budgets are checked against a clock, and each job's cost is predicted from the manifest.

| Item | Limit |
|---|---|
| Sim | ≤ 2 ms per tick (existing) |
| Render | ≤ 8 ms on the reference laptop. On weaker machines, render scale drops to hold 30 fps |
| **All loader work on the main thread** | **2 ms exploring, 1 ms in combat, 8 ms behind a veil, menu or title** |
| Geometry upload | ≤ 256 KiB per frame |
| Compressed texture upload | 1 per frame, ≤ 1.4 MiB |
| Uncompressed texture upload | ≤ one 512² per frame in play. Larger only behind a veil |
| Model parse | 1 per frame, and never in combat unless it is P0 or P1 |
| Skinned clone and Animator | 1 per frame |
| Disposal | ≤ 8 objects per frame |

- **Slicing:** the loader runs after the sim, using the time left, instead of before it as now (`WorldSession.ts:100`).
- **Big jobs:** a job larger than the slice runs alone on a frame with slack, at most once per 500 ms, and never in combat.
- **Off the main thread:** meshopt decode (`MeshoptDecoder.useWorkers(2)`), image decode and KTX2 transcode.
- **Parse:** stays on the main thread until the hitch metric says otherwise. Moving it is costly and only hero models need it.

### Shader pre-warming

A fixed material feature matrix is generated at build time from the asset manifest: skinned or instanced, then the map, normal, emissive and vertex-colour combinations in use. At the title, one tiny mesh per variant goes through `renderer.compileAsync` with the world's real lights and fog.

A model is never made visible until its programs are ready. `RpgViews.ts:16-18` already bans adding lights mid-play, because that recompiles everything. That rule becomes a test: **`renderer.info.programs.length` must not grow after the title.**

---

## 4. Asset pipeline

Adopt in this order.

| # | Adopt | Why | Note |
|---|---|---|---|
| 1 | **Asset manifest** `asset-manifest.json`, built by `tools/build-asset-manifest.mjs` | Size, GPU bytes, tiers and dependencies per asset. Everything else reads it | |
| 2 | **Content-hashed URLs** with `Cache-Control: immutable` | `public/` files keep their names today, so caching them long is unsafe | Hash at build into `dist/a/`. Hosting is Vercel-style: set the headers in `vercel.json`. The host compresses with brotli |
| 3 | **Rapier as a real `.wasm`** | Saves about 730 KiB and compiles while streaming | `init()` in the compat build takes no arguments, so this needs a spike |
| 4 | **One compressed file per cell** | Bin plus JSON is two requests. Gzip takes bins from 198 to 67 KiB. Decode with `DecompressionStream` in the worker, so it does not depend on the host | Bake format version 2 |
| 5 | **Character LOD chain** in `import-sibling-assets.mjs`, using the skinned simplify already there | Biggest visual and memory gain | **`player.glb` is excluded.** It goes through `art/tools/build-player-glb.mjs` only, and `socket_staff` must survive |
| 6 | **Shared clip packs** per rig | Seven models share one skeleton. Could save over 100 KiB per enemy | **Assumption:** clips are interchangeable. The bytes differ, so check by eye first |
| 7 | **KTX2** | 4–8× less GPU memory, far cheaper upload. ETC1S for colour and masks at T1–T3, UASTC for normals and T0 | Transcoder is 212 KiB brotli, loaded after the title. This reverses plan §3.3, which judged KTX2 on download size. The driver now is GPU memory |
| 8 | **Separate texture tiers** | Mesh and T3 first, sharper textures later | GLB references external KTX2 files |
| 9 | **Region groups** in the manifest | Lets the loader prefetch a region's kit | **No bundle files.** HTTP/2 handles small files, and bundles break cancellation |
| 10 | **Service Worker** with Cache API, hashed URLs only | Durable repeat visits and "download this region" | **Last.** Never cache `index.html` |

### Skip

| Technology | Why not |
|---|---|
| **WebGPU** | Would mean rewriting every `onBeforeCompile` material, and loading problems are not caused by WebGL2. |
| **Virtual texturing** | Needs a feedback pass and custom sampling in every material. Four tiers do the job at this art scale. |
| **Nanite-style meshlets** | Needs compute or mesh shaders, and the art is stylised. Discrete LODs are enough. |
| **Occlusion culling** | Open terrain with fog hides little. Cell-level view culling gets most of the gain. |
| **Draco** | Meshopt is already in use and decodes faster. |
| **Sim or renderer in a worker** | Large rewrite. Budgets solve the problem first. |

---

## 5. Memory governance

No browser reports GPU memory, so the budget is **our own accounting** from the manifest's `gpuBytes`.

| Device tier | How detected | GPU budget | JS heap | Top texture |
|---|---|---|---|---|
| **Low** | `deviceMemory` ≤ 4, mobile, or a weak GPU string | 256 MiB | 200 MiB | 512 |
| **Medium** (reference) | Default, including Safari | 384 MiB (plan §3.5) | 300 MiB | 1024 |
| **High** | 8 GB or more reported, discrete GPU, 2 s frame probe passes | 768 MiB | 450 MiB | 2048 |

**Medium split:** render targets 80, pinned 40, terrain 40, props 80, characters 104, boss reserve 40.

### Residency manager (`src/assets/Residency.ts`)

Each asset moves through: absent → queued → fetched → decoded → uploading → resident → cooling → evicted.

- Systems say what they want: `want(asset, tier, priority, neededInSeconds)`. They never load directly.
- **Evict** when a pool passes 90%, down to 80%. Order is lowest priority band, then least recently used.
- **Never evict** pinned assets, anything drawn in the last 5 s, or anything used by a fight.
- **Cooling replaces the 10 s timer** (`PropInstancer.ts:150`). With memory free, keep templates. Only pressure evicts them.
- Demote before evicting: T0 → T1 is cheaper than losing the asset.

### Correct disposal

`AssetLoader` gains release: when references reach zero, a template goes to cooling. Eviction disposes geometry, materials and textures. Skeleton disposal stays per instance. Audio joins the same system with `Howl.unload()`.

CPU copies of geometry and textures are freed after upload for evictable assets. That makes eviction and context loss both a re-request.

### Pressure and loss

| Signal | Response |
|---|---|
| Long frames for 10 s | Lower render scale, then drop one texture tier |
| JS heap above 85% (Chromium only) | Clear caches and cooling assets |
| **WebGL context lost** | Sim pauses (exists). Mark all GPU assets evicted. On restore, drop one device tier, reload pinned assets behind the veil, then re-request by distance. Extends `App.ts:267-279`. |
| **Tab killed** | Cannot be prevented. Save on `visibilitychange` when hidden and out of combat. Today it only pauses (`App.ts:246-248`). |

---

## 6. Scheduling

One `AssetScheduler` replaces `RequestQueue`. Every network request goes through it: models, cells, textures, audio.

| Priority | Contents | In combat |
|---|---|---|
| **P0** | Pinned set, collision pack | Runs |
| **P1** | Active cells, enemies within 40 m or targeting the player, the boss | Runs |
| **P2** | Visual ring, LOD1 props, enemies within 120 m | Paused if the link is slow |
| **P3** | Upgrades: LOD0, T0, T1 | Paused |
| **P4** | Predicted cells and their kits | Paused |
| **P5** | Idle: owned staffs, next region | Paused |

- **Order inside a priority:** soonest needed first (distance divided by speed), with ties broken by smallest size.
- **Connections:** 2 on `slow-2g`, `2g` or Save-Data, 4 on `3g`, 6 otherwise.
- **Preemption:** a P0 or P1 request aborts the lowest running job if that job has over 256 KiB left.
- **Cancellation:** a job aborts when nothing wants it. `AbortSignal` reaches `fetch`, which `gltf()` ignores today.
- **Throughput:** measured from our own downloads, because it works in every browser. `navigator.connection` is only a first guess and is missing from Safari and Firefox.
- **Movement prediction:** look ahead `max(4 s, 128 m / speed)`, extending `PREFETCH_SECONDS` (`rings.ts:25`).
- **Quest prediction:** a 30° cone toward the tracked quest marker (`App.ts:705`), two rings further out, at P4.
- **Co-op:** the scheduler takes a list of focus points. Remote players count at P2.
- **Idle time:** `requestIdleCallback` rarely fires in a game running at 60 fps, so P5 runs when the queue is empty, out of combat, above 5 Mbps and without Save-Data.
- **Device tier** caps the tier requested, so low-end machines never download T0.

---

## 7. Boot flow

| Stage | Loads | Waits for |
|---|---|---|
| **1. Shell** | HTML, CSS, entry JS (≤ 150 KiB) | Nothing |
| **2. Title interactive** | three.js, app code, region manifest, horizon, title camera's 9 cells | Shell |
| **3. Behind the title, in order** | Rapier, collision pack, player, LOD1 staff, combat sounds, shader warm-up, terrain textures, near props | Starts as soon as the title is up. Press Play at any time |
| **4. After Play** | NPC models (proxies first), ring 2, LOD0 upgrades, full staff | Control already returned |
| **Never at boot** | Brute and enemies, other staffs, next regions | Their distance rules |

| Target | Today | Goal |
|---|---|---|
| Title usable, 10 Mbps, 100 ms RTT, 4× CPU | Waits for Rapier | **≤ 3 s** |
| Cold start to control, same profile | Budget 15 s | **≤ 8 s** |
| Cold start to control, 50 Mbps | Budget 6 s | **≤ 3 s** |
| Repeat visit to control | Not measured | **≤ 2 s** |
| Play press to control, after 10 s on the title | Not measured | **≤ 1 s** |
| Critical transfer | 7.7 MiB counted | **≤ 6 MiB after S0, ≤ 4 MiB after S6** |

---

## 8. Measurement and enforcement

### Metrics

| Metric | Definition | Goal |
|---|---|---|
| **Hitch** | Frames over 50 ms per minute of play (33 ms is a normal frame at the 30 fps floor), plus the worst frame, attributed to a job class | ≤ 1 per minute exploring, **0 in combat** |
| **Pop-in lateness** | For each asset, time from entering its show range to reaching its wanted tier | p95 ≤ 250 ms at 50 Mbps. Under 2% late |
| **Proxy exposure** | Seconds an engaged enemy is drawn as a proxy | **0** at 10 Mbps on the scripted route |
| **Veil in play** | Veil frames outside teleport and respawn | **0** |
| **Residency** | Bytes per pool against budget, evictions, re-downloads | Never over budget |

### Overlay

Extend `Overlay.ts` and `WorldSession.overlayLines`, on the existing backquote key:
- pool bars against budget
- queue depth by priority, throughput, device tier
- main-thread loader ms this frame
- hitch and lateness counters
- a tier letter for each visible character

### CI

The e2e run uses a software GPU, so it checks **behaviour and bytes, not time**.

| Can be asserted in CI | Only on a real GPU |
|---|---|
| Bytes at title and to playable, against budgets | Frame times and hitch counts |
| No forbidden request before need, such as the Brute at the title | Long tasks (`SMOKE_STRICT_LONGTASKS=1`) |
| `renderer.info.programs` stops growing after the title | Actual shader compile time |
| Per-frame upload bytes never exceed limits, from scheduler counters | Actual upload time |
| Zero veil frames on a walked route across cell edges | Visual pop-in, by owner review |
| Accounted memory stays under budget, and `info.memory` returns to baseline after a lap | True GPU memory |
| **Same `sim.hash()` at the same tick on fast and heavily throttled networks** | |
| Proxy shows when a model is blocked, and a failed model recovers on retry | |

`check-budgets.mjs` gains per-class caps. `check-assets.mjs` gains required LOD tiers, texture size limits and manifest completeness. Before each release, record hitch and lateness on the reference laptop in the PR, as plan §3.5 already asks for frame rate.

---

## 9. Milestones

Sizes are engineer-weeks. Each ships alone.

| ID | Delivers | Size | Files | Acceptance test | Risk |
|---|---|---|---|---|---|
| **S0 Quick wins** | No veil flash at cell edges. Title diet. Starter staff boots on LOD1 (add it to C2's `STAFF_BOOT_LOD`). Model retry. Honest budget | **0.5** | `CellStreamer.ts`, `rings.ts`, `App.ts`, `AssetLoader.ts`, `manifest.ts`, `check-budgets.mjs`, `tests/e2e/world.mjs` | 0 veil frames on a walked route. Title ≤ 2,900 KiB (from 3,952). A blocked model recovers on retry | Low |
| **S1 Readable combat** | Proxy bodies, shader warm-up, character work inside budgets | **1.25** | `EnemyViews.ts`, `WorldViews.ts`, `RpgViews.ts`, `Renderer.ts`, `UploadBudget.ts` | With enemy models blocked, telegraphs still show. Program count flat after the title | Medium: look of proxies |
| **S2 Scheduler** | One prioritized loader with cancel, preemption, combat mode | **1.5** | New `AssetScheduler.ts`, replaces `RequestQueue.ts`. `AssetLoader.ts`, `CellStreamer.ts`, `PropInstancer.ts`, `AudioManager.ts` | Unit tests for order, cancel and preempt. P1 never waits behind P3 on a throttled run | Medium: touches all loading |
| **S3 Residency** | Budgets, LRU eviction, disposal, device tiers, context-loss recovery | **1.5** | New `Residency.ts`. `AssetLoader.ts`, `PropInstancer.ts`, `App.ts`, `Overlay.ts` | Trying all staffs stays under budget. Forced context loss recovers to play | Medium: disposal bugs |
| **S4 Delivery** | Manifest, hashed URLs, Rapier WASM, compressed cells, Rapier off the title path | **1.5** | `vite.config.ts`, new `tools/build-asset-manifest.mjs`, `tools/bake-world.ts`, `terrain.worker.ts`, `main.ts`, `App.ts` | Critical ≤ 4.6 MiB. Title usable ≤ 3 s on the reference profile | Medium: host dependent |
| **S5 Character LOD** | C0–C3 tiers, clip packs, 30 and 10 Hz animation | **2** | `import-sibling-assets.mjs`, `manifest.ts`, `check-assets.mjs`, `EnemyViews.ts`, `Animator.ts` | Triangles in a 6-enemy fight down at least 40%. Owner signs off the look | Medium: skinned simplify quality |
| **S6 KTX2 and texture tiers** | Compressed textures, T0–T3, smaller terrain detail map | **2** | Import tool, `AssetLoader.ts`, `TerrainChunk.ts`, art pipeline | Village GPU textures down at least 60%. Critical ≤ 4 MiB | Medium: art quality, player pipeline |
| **S7 Deterministic ground** | Region collision pack, sim-owned cell activation | **1.5** | `SimWorld.ts`, `PhysicsWorld.ts`, `bake-world.ts`, `CellStreamer.ts`, `WorldSession.ts` | Same hash on fast and throttled runs | High: sim change, saves |
| **S8 Scale** | Multi-region streaming, prop view culling, LOD2, kit caps | **2** | `RegionManifest.ts`, `WorldSession.ts`, `CellStreamer.ts`, `PropInstancer.ts`, `rings.ts`, `bake-world.ts` | Two regions stream across a border. ≤ 200 draw calls at 10× test density | Medium |
| **S9 Offline cache** | Service Worker, region download | **0.75** | New `sw.ts`, `main.ts` | Repeat visit works offline. A new build replaces the old one cleanly | Medium: stale caches |

**Total: 14.5 engineer-weeks.** S0–S3 (under 5 weeks) remove every gameplay risk except determinism. Co-op is not being started, so S7 stays late in the order.

### Collisions with work in flight

| Work | Overlap | Handling |
|---|---|---|
| **M4 and C1** (merged together at `7b3cba8`, integrating on `claude/merge-core`) | `App.ts`, `manifest.ts`, `WorldViews.ts`, import tool, `tests/e2e/world.mjs` | Start S0 from the integrated branch, not from `claude/m4-sproutvale` |
| **C2 staffs** (`claude/c2-staffs`) | `PlayerView.ts`, `manifest.ts`, `App.ts`. Adds two 1 MB staffs | Merge first. S0 builds on its boot LOD and swap guard |
| **C3 powers, C4 robots** | `App.ts`, and new enemy models | New enemies must use the S1 proxy path once it lands |
| **Pepe Bull mount** (`claude/pepe-bull-mount`) | `App.ts`, `PlayerView.ts`, `WorldViews.ts`, `SimWorld.ts`, `manifest.ts`, import tool. Adds a 598 KiB model | The bull stays out of the critical set: load it when the player is near |
| **M5 Scrapjaw** (`claude/m5-scrapjaw`) | `SimWorld.ts`, boss views, gate logic, a 20.1k-triangle model | **Land S1 early**, so the boss is built on proxies and the gate rule. **Do not run S7 during M5** |

---

## The owner's decisions (2026-11-17)

1. **Hosting:** somewhere like Vercel. Custom cache headers go in `vercel.json`, and the host handles brotli.
2. **Performance floor:** 30 fps on every supported machine. Weak machines lower render scale and texture tier to hold it.
3. **Generated asset tiers:** stay in git for now, as `AGENTS.md` says. Review this if the repository grows too large to clone comfortably.
4. **Starter staff:** starts on LOD1 and sharpens after 10 calm seconds.
5. **Co-op:** not being started. S7 keeps its late place in the order.
