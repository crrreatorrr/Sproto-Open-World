# The Rootdeep Implementation Plan

> **For agentic workers (Grok Bot):** Work the quests below in order. If your harness has `superpowers:subagent-driven-development` or `superpowers:executing-plans`, use it. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Rootdeep, a large placeholder cave system reached through hidden entrances in existing Sproutvale walls, unlocked by a quest from Collector Pepe and ending in a chest holding Rootcleaver, a very powerful melee greatsword.

**Architecture:** The cave is a second baked region at cell origin `[64, 0]` (world x 4096 to 4607), merged into the one streamed world at load, so the sim, streaming, colliders, camera and saves all keep working unchanged. Walls are raised terrain: a flat 16 m block with chambers and tunnels carved out by the bake tool's existing `bowl` and `carve` phases. A new reusable `portal` interactable moves the player between the surface and the cave behind the existing loading veil.

**Tech Stack:** TypeScript, Three.js, Rapier, Vite, Vitest, Playwright, `tools/bake-world.ts`, Blender (sword model only).

**Spec:** The "Design" section of this file. The owner approved it on 2026-11-18.

## Global Constraints

- Follow `AGENTS.md`. `src/sim` and `src/content` stay pure. Rapier stays under `src/sim/physics`. Every menu and interaction works with a gamepad alone.
- Environment art is **placeholder**: no new environment models or textures. The cave's look comes only from the terrain's rock and dirt layers, darkness and fog. `world-src/rootdeep/placements.json` places no props.
- Enemies are **current enemies** only: existing models and moves, as data variants.
- Every entrance is **hidden in a wall that already exists**. A sealed entrance has no model, no prompt, no compass marker and no map pin.
- The opening quest comes from **Collector Pepe** (`collector_pepe`, Sprout Hollow) and its only prerequisite is `{ questDone: 'q_relics' }`.
- No save schema bump: all new state fits in existing `world.flags`, `openedChests`, `inventory` and `quests`.
- Quest 1 continues on the branch `grok/rootdeep-cave`, which already holds this plan. Each later quest is its own branch from the latest `main` once the quest before it has merged, named `grok/rootdeep-<n>-<slug>`. Every quest gets its own pull request, reviewed by a different agent.
- Run every check in `AGENTS.md` before each pull request, and report any you could not run.

## Review Focus

1. A player who rests at a cave shrine must not pull the Pepe Bull underground. Owned by Quest 2.
2. Standing exactly on a sealed entrance must show nothing, on a fresh save and on an old save with Lost Relics finished. Owned by Quest 2.
3. Continue from a save whose last shrine is in the cave must land on the cave floor; dying before resting there must wake at the surface shrine. Owned by Quest 2, with the dark look proved in Quest 7.
4. Enemies must not notice the player through solid rock. Owned by Quest 5.
5. A rider at an entrance must get the Dismount prompt, not the entrance, because a ridden bull follows its rider. Owned by Quest 2.

---

## Design

### Owner's decisions

| Decision | Choice |
|---|---|
| Quest giver | Collector Pepe, after Lost Relics is complete |
| Entrance | Hidden in existing walls, with many entrances |
| Environment | Placeholder, large cave system with many pathways |
| Enemies | Current enemies |
| Reward | Rootcleaver in the final chest |
| Rootcleaver's balance | Deliberately above the 15% weapon rule; it makes later bosses easier |
| Sword animation | Reuses the staff swings |

Lost Relics has no prerequisite, so the cave can be reached early. That is accepted. Collector Pepe warns the player in dialogue, and nothing else gates it.

### The cave map

All coordinates are **local**: world x = local x + 4096, world z = local z. The floor is y 0 and the rock top is y 16.

**21 chambers** (`id (x, z, flat radius)`). Each is a `bowl` with `radius = flatRadius + 2`, `depth = 16`.

| Group | Chambers |
|---|---|
| Entrance halls | h1 (96, 96, 12), h2 (256, 56, 12), h3 (416, 96, 12), h4 (456, 256, 12), h5 (416, 416, 12), h6 (256, 456, 12), h7 (96, 416, 12), h8 (56, 256, 12) |
| Main caves | m1 Lantern Hall (168, 168, 18), m2 Grunt Warren (256, 148, 18), m3 Slinger Gallery (344, 168, 18), m4 Wisp Hollow (364, 256, 18), m5 Brute Den (344, 344, 18), m6 Fungus Crossing (256, 364, 18), m7 Old Mine (168, 344, 18), m8 Echo Pit (148, 256, 18) |
| Treasure pockets | p1 (36, 36, 8), p2 (476, 36, 8), p3 (476, 476, 8), p4 (36, 476, 8) |
| Final room | vault (256, 256, 26) |

**29 tunnels** (`a-b@bendX,bendZ`). Each is a `carve` with id `t_a_b`, points `[a, bend, b]`, depth 16 at every point, `bedHalfWidth: 3.5`, `bankWidth: 1.5`.

| Group | Tunnels |
|---|---|
| Hall to cave | h1-m1@126,138; h2-m2@265,102; h3-m3@374,126; h4-m4@410,265; h5-m5@386,374; h6-m6@247,410; h7-m7@138,386; h8-m8@102,247 |
| Inner ring | m1-m2@214,167; m2-m3@302,149; m3-m4@345,214; m4-m5@363,302; m5-m6@298,345; m6-m7@210,363; m7-m8@167,298; m8-m1@149,210 |
| Outer ring | h1-h2@178,85; h2-h3@338,67; h3-h4@427,178; h4-h5@445,338; h5-h6@334,427; h6-h7@174,445; h7-h8@85,334; h8-h1@67,174 |
| Pockets | h1-p1@72,60; h3-p2@440,60; h5-p3@440,452; h7-p4@72,452 |
| Vault | m2-vault@256,202 |

This exact layout was trial-baked with the unmodified bake tool on 2026-11-18. Every chamber connects, a 3 m-radius body fits through every passage, the gate at local z 205 seals only the vault (the floor is 7 m wide there), and no wall is gentler than the 50° climb limit.

### The eight hidden entrances

Each surface portal stands just in front of one existing wall piece. The positions below were checked against the baked world: each wall piece exists, the ground is flat, and nothing blocks the spot.

| Key | Wall | Surface portal (x, z) | Yaw | Arrive on surface (x, z) | Cave hall |
|---|---|---|---|---|---|
| `hedge_north` (main door) | Orchard hedge, piece at (79.11, 224) | (79.1, 226.4) | π | (79.1, 228) | h1 |
| `hedge_south` | Orchard hedge, piece at (54.77, 136) | (54.8, 133.6) | 0 | (54.8, 132) | h2 |
| `hedge_village_east` | Village hedge, piece at (300, 126) | (300, 123.6) | 0 | (300, 122) | h3 |
| `hedge_village_west` | Village hedge, piece at (216, 126) | (216, 123.6) | 0 | (216, 122) | h4 |
| `rock_quarry_west` | Quarry rock wall, piece at (347.3, 462.75) | (342.9, 462.8) | π/2 | (341.4, 462.8) | h5 |
| `rock_quarry_south` | Quarry rock wall, piece at (401.13, 398.16) | (401.1, 393.7) | 0 | (401.1, 392.2) | h6 |
| `rock_quarry_east` | Quarry rock wall, piece at (451.36, 392) | (451.4, 387.6) | 0 | (451.4, 386.1) | h7 |
| `hedge_scarecrow` | Orchard hedge, piece at (164.57, 196) | (164.6, 198.4) | π | (164.6, 200) | h8 |

Rules:

- Entity ids are `rd_surface_<key>` and `rd_cave_<key>`. The open flag is `rootdeep.open.<key>`.
- A cave portal stands at its hall's centre, is always usable, and arrives 3 m from the hall centre toward local (256, 256).
- Using a cave portal sets its open flag, so **the other seven entrances are found from inside** and then work both ways.
- A surface portal is usable only when its open flag is set. The one exception is `hedge_north`, which is also usable once the world flag `rootdeep.door.revealed` is set.
- A player riding the bull cannot use a portal. The prompt stays Dismount until they are on foot.

### Who lives where

Local positions. Rings use the `ring(def, n, r, from)` shape from `sproutvaleContent.ts`.

| Chamber | Enemies | Also here |
|---|---|---|
| m1 Lantern Hall | none | `shrine_rootdeep_lantern` |
| m2 Grunt Warren | 5 `rd_grunt` at r 6, 3 `rd_grunt` at r 12 | |
| m3 Slinger Gallery | 5 `rd_slinger` at r 12, 2 `rd_grunt` at r 4 | `rootdeep_lever_a` |
| m4 Wisp Hollow | 4 `rd_wisp` at r 10 | |
| m5 Brute Den | 2 `rd_brute` at (±5, 0), 2 `rd_grunt` at r 10 | `rootdeep_lever_b` |
| m6 Fungus Crossing | 3 `rd_grunt` at r 6, 2 `rd_slinger` at r 13 | `shrine_rootdeep_crossing` |
| m7 Old Mine | 1 `rd_brute` at centre, 2 `rd_wisp` at r 10 | `rootdeep_lever_c` |
| m8 Echo Pit | 3 `rd_slinger` at r 12, 2 `rd_wisp` at r 7 | |
| h2 to h8 | 2 `rd_grunt` at r 6 in each hall | the cave portal |
| h1 | none | the cave portal |
| p1 to p4 | none | one chest each: `rd_chest_p1` to `rd_chest_p4`, 80 Sprouts and 1 `heart` each |
| vault | `deep_warden` at (256, 268), unique | `chest_rootdeep_vault` at (256, 280) |

Camp ids are `rd_<chamber>`, centred on the chamber. Shrines and pocket chests stand at their chamber's centre. Each lever stands 8 m from its chamber's centre toward local (256, 256). The vault gate `gate_rootdeep_vault` is at local (256, 205), yaw 0, model `gate_barrier`, box half `[5, 8, 1.2]`, `openFlag: 'gate:rootdeep_vault'`. Its lock `rootdeep_vault_lock` is at local (256, 200).

### The quests

**`q_collectors_map`, "The Collector's Last Map"** (side, giver `collector_pepe`, prereq `[{ questDone: 'q_relics' }]`):

| Step id | Text | Objectives | Marker | On complete |
|---|---|---|---|---|
| `wall` | Find the old hedge on the north side of the Orchard Fields. | reach `old_hedge_wall` | `old_hedge_wall` | |
| `diggers` | Drive off the diggers working along the hedge. | kill `rootdeep_digger` × 4 | `old_hedge_wall` | give `seal_shard` × 3, set flag `rootdeep.door.revealed` |
| `door` | The map says the leaves grow wrong where the door is hidden. Search the hedge. | collect `seal_shard` × 3 (consume), interact `rd_surface_hedge_north` | **none** | |

Rewards: 150 XP, `{ startQuest: 'q_rootdeep' }`.

The trigger `old_hedge_wall` is at (79, 231), radius 12. The camp `hedge_diggers` is at (79, 240): 4 `rootdeep_digger` at r 4.

### Where the content lives

Everything new goes in `ROOTDEEP_CONTENT`, including the surface portals, `old_hedge_wall` and `hedge_diggers`. `WORLD_CONTENT` joins it with `SPROUTVALE_CONTENT`, and the game populates `WORLD_CONTENT`. `SPROUTVALE_CONTENT` itself does not change, because its tests check the valley's own limits: 55 to 75 enemies, camps 60 m apart, and every placement inside the map border.

**`q_rootdeep`, "The Rootdeep"** (side, giver `collector_pepe`, prereq `[{ questDone: 'q_collectors_map' }]`):

| Step id | Text | Objectives | Marker |
|---|---|---|---|
| `lantern` | Rest at the shrine in the Lantern Hall. | interact `shrine_rootdeep_lantern` | `shrine_rootdeep_lantern` |
| `levers` | Pull the three old levers: Slinger Gallery, Brute Den and Old Mine. | interact `rootdeep_lever_a`, `rootdeep_lever_b`, `rootdeep_lever_c` | none |
| `lock` | Open the vault gate north of the Grunt Warren. | interact `rootdeep_vault_lock` | `rootdeep_vault_lock` |
| `warden` | Defeat the Deep Warden. | kill `deep_warden` × 1 | `rootdeep_vault` |
| `chest` | Open the chest in the vault. | interact `chest_rootdeep_vault` | `chest_rootdeep_vault` |
| `return` | Tell Collector Pepe what you found. | talk `collector_pepe` node `rootdeep_done` | `collector_pepe` |

Rewards: 900 XP, 300 Sprouts. The trigger `rootdeep_vault` is at local (256, 256), radius 24.

### Rootcleaver

| Field | Value |
|---|---|
| Item id | `staff_rootcleaver` (it uses the staff slot) |
| Name | Rootcleaver |
| Rarity | `epic` |
| Blurb | Cut from the heart of the Rootdeep. |
| Melee damage | 52 (the strongest weapon today is 32) |
| Spell power | 0.6 |
| Trait | `sunder`, "Sunder": A fully charged heavy attack sends a shockwave 8 m along the ground. |
| Trait numbers | `TRAIT.sunder = { range: 8, speed: 16, radius: 1.2, damage: 0.8 }`, where damage multiplies the sword's melee power |
| Model | One low-poly two-handed greatsword, 1.9 m long, the length of the staff's hit capsule |

---

## Quest 1: Bake the cave and merge it into the world

**Files:**
- Create: `world-src/rootdeep/terrain.json`, `world-src/rootdeep/placements.json`
- Create (baked output, committed): `public/world/rootdeep/**`
- Modify: `tools/bake-world.ts:36-55,581-586`
- Modify: `src/world/RegionManifest.ts`
- Modify: `src/app/WorldSession.ts:43`
- Test: `tests/content/rootdeep-map.test.ts`, `tests/world/mergeRegions.test.ts`

**Interfaces:**
- Produces: `ROOTDEEP = 'world/rootdeep/region.json'`, `mergeManifests(a: RegionManifest, b: RegionManifest): RegionManifest`, `loadWorld(signal?: AbortSignal): Promise<Region>`, all in `src/world/RegionManifest.ts`.

- [x] **Step 1: Write the failing tests**

`tests/world/mergeRegions.test.ts`:

```ts
it('joins the cells of both regions and keeps the first region\'s origin, size and horizon', () => {
  const m = mergeManifests(sproutvale, rootdeep);
  expect(m.cells.length).toBe(sproutvale.cells.length + rootdeep.cells.length);
  expect(m.origin).toEqual(sproutvale.origin);
  expect(m.size).toEqual(sproutvale.size);
  expect(m.horizon).toBe(sproutvale.horizon);
});
it('takes the larger capacity for a prop both regions use', () => {
  expect(mergeManifests(withProp('rock', 4), withProp('rock', 9)).props.rock.capacity).toBe(9);
});
it('refuses regions with different height ranges', () => {
  expect(() => mergeManifests(sproutvale, { ...rootdeep, heightRange: { min: 0, max: 1 } })).toThrow(/heightRange/);
});
```

`tests/content/rootdeep-map.test.ts` decodes `public/world/rootdeep` the way `tests/content/world-sproutvale.test.ts` does, treats height ≤ 0.6 as floor, and flood-fills from local (96, 96):

```ts
it('has 64 cells at origin [64, 0] and shares Sproutvale\'s height range', () => {
  expect(manifest.cells.length).toBe(64);
  expect(manifest.origin).toEqual([64, 0]);
  expect(manifest.heightRange).toEqual({ min: -8, max: 40 });
});
it('connects all 21 chambers', () => { for (const c of CHAMBERS) expect(reached(c), c.id).toBe(true); });
it('seals only the vault when the gate at local z 205 is shut', () => {
  const shut = (id: string) => flood({ blockZ: [204, 206], nearX: 256 }).has(id);
  expect(CHAMBERS.filter((c) => !shut(c.id)).map((c) => c.id)).toEqual(['vault']);
});
it('lets a 3 m-radius body through every passage', () => { expect(floodEroded(3).size).toBe(21); });
it('has no wall the player can climb', () => { expect(wallSamplesGentlerThan(KCC.maxSlopeDeg)).toBe(0); });
it('grows no grass', () => { expect(grassWeightOnAnyFloorSample()).toBe(0); });
```

- [x] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/world/mergeRegions.test.ts tests/content/rootdeep-map.test.ts`
Expected: FAIL, `mergeManifests` is not exported and `public/world/rootdeep/region.json` does not exist.

- [x] **Step 3: Add a fixed height range to the bake**

Add `heightRange?: { min: number; max: number }` to `TerrainSrc`. When it is set, `bakeRegion` uses it instead of the measured range, and throws if any height falls outside it.

- [x] **Step 4: Write the cave's sources and bake them**

Copy `docs/plans/rootdeep-handoff/terrain.json` to `world-src/rootdeep/terrain.json` unchanged. It is the tested layout from the Design tables, in world coordinates (local x + 4096).

`placements.json` has empty `kinds`, `place`, `lines`, `zones` and `scatter`, and one mark: `{ "id": "rootdeep_start", "kind": "playerStart", "at": [4192, 96], "yaw": 0 }`.

Run: `npm run bake:world -- rootdeep && npm run bake:map -- rootdeep`
Expected: `bake:world: wrote 130 files`, and `public/world/rootdeep/map.webp` is 512 × 512.

- [x] **Step 5: Implement `mergeManifests` and `loadWorld`, and call `loadWorld()` from `WorldSession.load`**

`loadWorld` fetches both manifests through `loadRegion`'s checks and returns `new Region(mergeManifests(sproutvale, rootdeep))`. Everything except `cells` and `props` comes from Sproutvale.

- [x] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/world/mergeRegions.test.ts tests/content/rootdeep-map.test.ts && npm run bake:world -- rootdeep --check`
Expected: all PASS, and `bake:world --check: rootdeep is up to date`.

- [x] **Step 7: Commit**

```bash
git add world-src/rootdeep public/world/rootdeep tools/bake-world.ts src/world/RegionManifest.ts src/app/WorldSession.ts tests/world/mergeRegions.test.ts tests/content/rootdeep-map.test.ts docs/plans/2026-11-18-rootdeep-cave-plan.md
git commit -m "Rootdeep: bake the cave map and stream it with Sproutvale"
```

---

## Quest 2: Hidden portals in the sim

**Files:**
- Create: `src/content/packs/rootdeep.ts`, `src/content/world/worldContent.ts`
- Modify: `src/sim/entity.ts:215`, `src/sim/events.ts:87`, `src/sim/view.ts:37`
- Modify: `src/sim/systems/rpg.ts:266,270-291,309-310,441-447`
- Modify: `src/sim/SimWorld.ts` (`addInteractable`, `populateWorld`, `callMount`, the tick)
- Modify: `src/content/world/sproutvaleContent.ts:40-53` (add `portals?` to `RegionContent`)
- Modify: `src/app/App.ts:16,441` (populate `WORLD_CONTENT`)
- Modify: `tests/sim/quests-helpers.ts` (also load the Rootdeep's baked cells, and populate `WORLD_CONTENT`)
- Modify: `world-src/sproutvale/placements.json`, and rebake `public/world/sproutvale`
- Test: `tests/sim/rootdeep-portals.test.ts`

**Interfaces:**
- Produces, from `src/content/packs/rootdeep.ts`:
  - `RD_X = 4096`
  - `isRootdeep(x: number): boolean` (true when `x >= RD_X`)
  - `DOOR_REVEALED_FLAG = 'rootdeep.door.revealed'`
  - `interface PortalDef { id: string; key: string; side: 'surface' | 'cave'; pos: [number, number, number]; yaw: number; to: string; arrive: [number, number]; verb: string }`
  - `ROOTDEEP_PORTALS: Record<string, PortalDef>`
  - `portalOpenFlag(key: string): string` (returns `rootdeep.open.<key>`)
  - `portalUsable(def: PortalDef, flags: Readonly<Record<string, number>>): boolean`
  - `ROOTDEEP_CONTENT: RegionContent`, holding the portals and the two cave shrines in this quest
- Produces, from `src/content/world/worldContent.ts`: `WORLD_CONTENT: RegionContent`
- Produces, in the sim:
  - `InteractKind` gains `'portal'`
  - `RegionContent.portals?: Placement[]`
  - the event `{ type: 'portalTravel'; entity: EntityId; portal: string; to: string }`

- [x] **Step 1: Write the failing tests**

Build the world with `tests/sim/quests-helpers.ts`. Helpers named below that it does not already have are small functions local to this test file.

```ts
it('shows nothing at a sealed entrance, even standing on it', () => {
  stand(w, 'rd_surface_hedge_north');
  expect(w.view().interactTarget(0)).toBeNull();
});
it('keeps it sealed for a save that has only finished Lost Relics', () => {
  finishQuest(w, 'q_relics'); w.tick(); stand(w, 'rd_surface_hedge_north');
  expect(w.view().interactTarget(0)).toBeNull();
});
it('opens the main door once it is revealed, and travels to hall h1', () => {
  w.world.flags[DOOR_REVEALED_FLAG] = 1; w.tick(); stand(w, 'rd_surface_hedge_north');
  expect(w.view().interactTarget(0)?.kind).toBe('portal');
  press(w, BTN.interact);
  expect(isRootdeep(player(w).tf.pos.x)).toBe(true);
  expect(w.world.flags['rootdeep.open.hedge_north']).toBe(1);
});
it('opens a surface entrance from inside, and then it works both ways', () => {
  stand(w, 'rd_cave_hedge_south'); press(w, BTN.interact);
  expect(flat(player(w).tf.pos)).toEqual({ x: 54.8, z: 132 });
  stand(w, 'rd_surface_hedge_south');
  expect(w.view().interactTarget(0)?.kind).toBe('portal');
});
it('leaves the bull on the surface when you rest in the cave', () => {
  const before = bull(w).tf.pos.x; restAt(w, 'shrine_rootdeep_lantern');
  expect(isRootdeep(bull(w).tf.pos.x)).toBe(false);
  expect(bull(w).tf.pos.x).toBe(before);
});
it('offers Dismount, not the entrance, to a rider', () => {
  w.world.flags[portalOpenFlag('hedge_north')] = 1; w.tick();
  mountBull(w); stand(w, 'rd_surface_hedge_north');
  expect(w.view().interactTarget(0)?.kind).toBe('mount');
  expect(isRootdeep(player(w).tf.pos.x)).toBe(false);
});
it('wakes a Continue at a cave shrine on the cave floor', () => {
  const next = reload(saveAfterRestingAt(w, 'shrine_rootdeep_lantern'));
  expect(isRootdeep(player(next).tf.pos.x)).toBe(true);
  expect(Math.abs(player(next).tf.pos.y)).toBeLessThan(0.5);
});
it('wakes at the surface shrine after dying in the cave without resting there', () => {
  restAt(w, 'shrine_first_light'); enterCave(w); die(w); runUntilRespawn(w);
  expect(isRootdeep(player(w).tf.pos.x)).toBe(false);
});
it('puts every surface portal within 5 m of a baked wall piece', () => {
  for (const p of surfacePortals) expect(nearestBakedWall(p), p.id).toBeLessThanOrEqual(5);
});
```

- [x] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/sim/rootdeep-portals.test.ts`
Expected: FAIL, `src/content/packs/rootdeep.ts` does not exist.

- [x] **Step 3: Add the portal table and content**

Write `ROOTDEEP_PORTALS` from the Design's entrance table, 16 entries. Surface verb: "Slip through the hedge" for hedges, "Squeeze between the rocks" for rocks. Cave verb: "Climb out". This module imports only types from the registries, like `src/content/packs/c5.ts`.

Add both cave shrines to `ROOTDEEP_CONTENT` now, and name them "Lantern Hall Shrine" and "Crossing Shrine" in `shrineName`. `WORLD_CONTENT` joins every list of the two regions.

- [x] **Step 4: Add the `portal` interactable**

- `interactable.used` means **hidden** for a portal, so `interactTarget` already skips it. Name it with the portal's verb and give it `REACH.portal = 2.4`.
- `interactTarget` also skips portals while `player.riding` is set. `teleportPlayer` only cancels a mount in progress, and a ridden bull follows its rider, so a rider must never travel.
- Add a private `syncPortals()` to `SimWorld`, called each tick before `playerRpg`. It sets `used = !portalUsable(def, this.world.flags)`.
- `usePortal` in `rpg.ts` sets the open flag and pushes the `interact` event (kind `'portal'`) and the `portalTravel` event.
- After the `playerRpg` loop, `SimWorld` handles each new `portalTravel` event: it calls `teleportPlayer` to the destination's `arrive` point at y 200 and sets `e.settle = true`, so the player lands on the real floor once the destination cell has colliders.

- [x] **Step 5: Keep the bull on the surface**

In `callMount`, return early when the shrine's position satisfies `isRootdeep(at.x)`.

- [x] **Step 6: Mark the surface spots and rebake Sproutvale**

Add one `placements.json` mark per surface portal (kind `object`, `clear: 2`), and one for `hedge_diggers` (kind `camp`, `clear: 8`), so scattered props keep off these spots.

Run: `npm run bake:world -- sproutvale && npm run bake:map`
Expected: the bake succeeds, and `npx vitest run tests/content` passes.

- [x] **Step 7: Run the tests and confirm they pass**

Run: `npx vitest run tests/sim/rootdeep-portals.test.ts`
Expected: PASS.

- [x] **Step 8: Commit**

```bash
git add src world-src/sproutvale public/world/sproutvale tests/sim/rootdeep-portals.test.ts
git commit -m "Rootdeep: hidden two-way entrances in Sproutvale's walls"
```

---

## Quest 3: The cave's look, portal views and the map

**Files:**
- Create: `src/render/caveLook.ts`
- Modify: `src/render/Renderer.ts`
- Modify: `src/render/views/RpgViews.ts`, `src/render/views/WorldViews.ts:400`
- Modify: `src/ui/rpgText.ts:166`, `src/ui/mapTab.ts`
- Modify: `src/app/App.ts` (the frame loop, the `portalTravel` event and `__qa.state()`)
- Test: `tests/ui/mapTab-rootdeep.test.ts`, `tests/render/caveLook.test.ts`

**Interfaces:**
- Consumes: `isRootdeep`, the `portalTravel` event, `ROOTDEEP_PORTALS` (Quest 2).
- Produces: `lookFor(cave: boolean): { sunIntensity: number; sunShadow: boolean; torchIntensity: number; hemiIntensity: number; fogNear: number; fogFar: number; farPlane: number }`, `Renderer.setCave(on: boolean): void`, `mapBounds(x: number): { minX: number; size: number; image: string }`, `mapPoint(x: number, z: number, minX?: number, size?: number)`.

- [ ] **Step 1: Write the failing tests**

```ts
it('picks the cave map underground and the valley map on the surface', () => {
  expect(mapBounds(4200).image).toBe('world/rootdeep/map.webp');
  expect(mapBounds(200).image).toBe('world/sproutvale/map.webp');
});
it('places a cave point on the cave map', () => {
  const { minX, size } = mapBounds(4352);
  expect(mapPoint(4352, 256, minX, size)).toEqual({ left: 50, top: 50 });
});
it('turns the sun off and lights the torch in the cave', () => {
  expect(lookFor(true)).toMatchObject({ sunIntensity: 0, sunShadow: false, torchIntensity: 30, hemiIntensity: 0.45, fogNear: 6, fogFar: 46, farPlane: 140 });
});
it('restores daylight on the surface, with the torch dark', () => {
  expect(lookFor(false)).toMatchObject({ sunIntensity: 2.8, sunShadow: true, torchIntensity: 0, hemiIntensity: 1.3 });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/ui/mapTab-rootdeep.test.ts tests/render/caveLook.test.ts`
Expected: FAIL, `mapBounds` and `lookFor` do not exist.

- [ ] **Step 3: Implement `lookFor` and `Renderer.setCave`**

`setCave` does nothing when the state is unchanged, and applies `lookFor`. In the cave the background is black, fog colour is `0x050608`, and the hemisphere light is `0x6a7a8a` over `0x1a1a22`. A `torch` `PointLight(0xffc98a, 30, 22, 2)` follows the player 2 m up. The torch **stays in the scene** at intensity 0 on the surface, because adding or removing a light recompiles every shader. On the surface the fog, far plane and colours come back from the values `worldLook` was given.

- [ ] **Step 4: Add `PortalView`**

While the portal is hidden it draws nothing. Once `rootdeep.door.revealed` is set, the main door shows faint green motes within 5 m until it is opened. Once usable it draws a dark placeholder opening: a flat near-black box 1.6 m wide and 2.4 m tall against the wall. A cave portal is a dark stone column.

- [ ] **Step 5: Wire the app and the map**

- Each frame: `renderer.setCave(isRootdeep(player.x))`, and add `cave: boolean` to the object `__qa.state()` returns.
- On `portalTravel`: snap the camera with `rig.snap`, as `placePlayer` does.
- `interactLabel` returns the name unchanged for `'portal'`.
- `renderMap` uses `mapBounds`, and underground it labels the eight main caves and the vault instead of the valley's regions. Sealed entrances are never pinned.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/ui/mapTab-rootdeep.test.ts tests/render/caveLook.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src tests/ui/mapTab-rootdeep.test.ts tests/render/caveLook.test.ts
git commit -m "Rootdeep: the dark cave look, entrance views and the cave map"
```

---

## Quest 4: Rootcleaver

**Files:**
- Create: `art/tools/build_rootcleaver.py`, `public/assets/models/staffs/staff_rootcleaver.glb`
- Modify: `src/content/packs/c2.ts`, `src/content/items.ts`
- Modify: `src/sim/combat/staffTraits.ts`, `src/sim/combat/playerCombat.ts:159-166`
- Modify: `src/assets/manifest.ts:56-70`, `scripts/check-assets.mjs:43`
- Modify: `src/ui/gameMenu.ts:355`
- Test: `tests/sim/rootcleaver.test.ts`

**Interfaces:**
- Produces: item `staff_rootcleaver`, trait id `sunder`, `TRAIT.sunder`, model key `staff_rootcleaver`.

- [ ] **Step 1: Write the failing tests**

```ts
it('hits harder than any other weapon, and casts weakly', () => {
  const s = ITEMS.staff_rootcleaver.staff!;
  expect(s.damage).toBe(52);
  expect(s.spellPower).toBe(0.6);
  for (const i of Object.values(ITEMS)) if (i.staff && i.id !== 'staff_rootcleaver') expect(i.staff.damage).toBeLessThan(52);
});
it('sends one shockwave on a fully charged heavy', () => {
  equip(w, 'staff_rootcleaver'); chargedHeavy(w);
  expect(playerProjectiles(w).length).toBe(1);
});
it('sends none on a quick heavy or a light attack', () => {
  equip(w, 'staff_rootcleaver'); quickHeavy(w); light(w);
  expect(playerProjectiles(w).length).toBe(0);
});
it('hits an enemy 7 m ahead and misses one 10 m ahead', () => {
  expect(shockwaveHits(w, 7)).toBe(true);
  expect(shockwaveHits(w, 10)).toBe(false);
});
it('stops the shockwave at a wall', () => { expect(shockwaveHitsThroughWall(w)).toBe(false); });
it('gives other staffs no shockwave', () => {
  equip(w, 'staff_fighters_might'); chargedHeavy(w);
  expect(playerProjectiles(w).length).toBe(0);
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/sim/rootcleaver.test.ts`
Expected: FAIL, `ITEMS.staff_rootcleaver` is undefined.

- [ ] **Step 3: Add the item and the trait**

Use the Design's values. Add `sunder` to `StaffTraitId`, `STAFF_TRAITS`, `TRAIT` and `TRAIT_OF`. Fire the wave once, when `a.charged` and `a.clipT === tm.activeStart`, through the same projectile path Arcane Bolt uses in `src/sim/combat/spells.ts`.

- [ ] **Step 4: Build the model**

`art/tools/build_rootcleaver.py` runs headless in Blender and exports a greatsword 1.9 m long, under 3,000 triangles, flat-shaded, in the palette of the other staffs. Match the origin and long axis of `staff_sproto.glb`, so the grip sits on `socket_staff`. Add the file to `OWN` in `check-assets.mjs` and to the model manifest.

Run: `/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python art/tools/build_rootcleaver.py && npm run check:assets`
Expected: the GLB is written and `check:assets` passes.

- [ ] **Step 5: Rename the gear slot**

Change the `Staff` label in the Gear tab to `Weapon`.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/sim/rootcleaver.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add art/tools/build_rootcleaver.py public/assets/models/staffs/staff_rootcleaver.glb src scripts/check-assets.mjs tests/sim/rootcleaver.test.ts
git commit -m "Rootcleaver: the greatsword and its Sunder shockwave"
```

---

## Quest 5: Enemies, levers, gate and treasure

**Files:**
- Modify: `src/content/packs/rootdeep.ts`
- Modify: `src/content/enemies.ts:165,390`, `src/content/loot.ts:26-27`, `src/content/objects.ts:32`
- Modify: `src/sim/ai/brain.ts:68,94,123-141`, `src/sim/combat/hits.ts:360`
- Test: `tests/sim/rootdeep-enemies.test.ts`, `tests/content/rootdeep-content.test.ts`

**Interfaces:**
- Consumes: `ROOTDEEP_CONTENT`, `RD_X` (Quest 2), `staff_rootcleaver` (Quest 4).
- Produces:
  - `EnemyDef.needsSight?: boolean`
  - `registerRootdeepEnemies(table: Record<string, EnemyDef>): void`
  - enemy ids `rd_grunt`, `rd_slinger`, `rd_wisp`, `rd_brute`, `rootdeep_digger`, `deep_warden`
  - object ids `rootdeep_lever_a`, `rootdeep_lever_b`, `rootdeep_lever_c`, `rootdeep_vault_lock`
  - `ROOTDEEP_OBJECTS: Record<string, ObjectDef>`

- [ ] **Step 1: Write the failing tests**

```ts
// A bare test level (see tests/sim/aiHelpers.ts): flat ground, the enemy and player 10 m apart,
// inside its 14 m aggro range, with a solid 4 m-tall box wall between them in the first test only.
it('does not notice a player behind a wall', () => {
  const { w, e } = levelWithWallBetween('rd_grunt', 10);
  run(w, 60); expect(e.brain!.target).toBeNull();
});
it('notices a player in plain sight', () => {
  const { w, e } = levelInPlainSight('rd_grunt', 10);
  run(w, 60); expect(e.brain!.target).not.toBeNull();
});
it('still chases someone who hurt it from behind a wall', () => {
  const { w, e } = levelWithWallBetween('rd_grunt', 10); hurt(w, e);
  run(w, 10); expect(e.brain!.target).not.toBeNull();
});
it('leaves surface enemies exactly as they were', () => {
  expect(ENEMIES.grunt.needsSight).toBeUndefined();
  expect(ENEMIES.brute.needsSight).toBeUndefined();
});
it('keeps the vault gate shut until all three levers are pulled', () => {
  pull(w, 'rootdeep_lever_a'); pull(w, 'rootdeep_lever_b');
  use(w, 'rootdeep_vault_lock');
  expect(w.world.flags['gate:rootdeep_vault']).toBeUndefined();
  pull(w, 'rootdeep_lever_c'); use(w, 'rootdeep_vault_lock');
  expect(w.world.flags['gate:rootdeep_vault']).toBe(1);
});
it('never brings the Deep Warden back after a rest', () => {
  killUnique(w, 'deep_warden'); restAt(w, 'shrine_rootdeep_lantern');
  expect(find(w, 'deep_warden')).toBeUndefined();
});
it('gives Rootcleaver from the vault chest once', () => {
  use(w, 'chest_rootdeep_vault'); use(w, 'chest_rootdeep_vault');
  expect(prog(w).inventory.staff_rootcleaver).toBe(1);
});
```

`tests/content/rootdeep-content.test.ts` asserts that every camp, shrine, lever and chest stands on floor (baked height ≤ 0.6), and that no 3 × 3 cell window holds more than 4 elites.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/sim/rootdeep-enemies.test.ts tests/content/rootdeep-content.test.ts`
Expected: FAIL, `rd_grunt` is not defined.

- [ ] **Step 3: Add the enemy variants**

`registerRootdeepEnemies` runs after `Object.assign(ENEMIES, C4_ENEMIES)` in `enemies.ts`:

| Id | Base | Changes |
|---|---|---|
| `rd_grunt` | `grunt_vet` | `aggroRange: 14`, `leashRange: 24`, `needsSight: true` |
| `rd_slinger` | `slinger` | `aggroRange: 16`, `leashRange: 24`, `needsSight: true` |
| `rd_wisp` | `wisp` | `aggroRange: 14`, `leashRange: 24`, `needsSight: true` |
| `rd_brute` | `brute` | `aggroRange: 14`, `leashRange: 24`, `needsSight: true` |
| `rootdeep_digger` | `grunt_vet` | `tags: ['grunt', 'rootdeep_digger']` |
| `deep_warden` | `hollow_giant` | `name: 'Deep Warden'`, `hp: 2400`, `xp: 900`, `level: 9`, `aggroRange: 24`, `leashRange: 40`, `needsSight: true` |

Each variant inherits its base's drop table in `loot.ts`.

- [ ] **Step 4: Add the sight rule**

Export `lineOfSight` from `hits.ts` and pass `physics` to `pickTarget`. A `needsSight` enemy that is unhurt and not already engaged skips a player it has no line of sight to.

- [ ] **Step 5: Add the placements**

Extend `ROOTDEEP_CONTENT` with everything in the Design's "Who lives where" table, plus the gate, the `hedge_diggers` camp and the `old_hedge_wall` and `rootdeep_vault` triggers.

- The levers use model `lever`, verb "Pull", name "Old Lever".
- The lock uses model `gate_lock`, verb "Open", name "Vault Gate". It requires the three `used:rootdeep_lever_*` flags, refuses with "Three old levers still hold it shut.", and has the effect `{ openGate: 'rootdeep_vault' }`.
- `deep_warden` is a camp member with `unique: 'deep_warden'`.
- `chest_rootdeep_vault` holds `staff_rootcleaver` × 1 and 250 Sprouts.

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `npx vitest run tests/sim/rootdeep-enemies.test.ts tests/content/rootdeep-content.test.ts tests/sim/ai-determinism.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src tests/sim/rootdeep-enemies.test.ts tests/content/rootdeep-content.test.ts
git commit -m "Rootdeep: camps, levers, the vault gate, the Deep Warden and the chest"
```

---

## Quest 6: Collector Pepe's quests

**Files:**
- Modify: `src/content/packs/rootdeep.ts`
- Modify: `src/content/quests.ts:187-190`, `src/content/items.ts:80-82`, `src/content/dialogue.ts:201-208`
- Modify: `tests/sim/quests-playthrough.test.ts:95-107`
- Modify: `tests/content/m4-sproutvale.test.ts` (the quest reference checks), `tests/content/quests-content.test.ts:27-28`
- Test: `tests/sim/rootdeep-quests.test.ts`

**Interfaces:**
- Consumes: every id from Quests 2, 4 and 5.
- Produces: `ROOTDEEP_QUESTS`, `ROOTDEEP_ITEMS` (`seal_shard`), `registerRootdeepDialogue(table: Record<string, DialogueGraph>): void`.

- [ ] **Step 1: Write the failing tests**

```ts
it('offers nothing new until Lost Relics is finished', () => {
  talk(w, 'collector_pepe');
  expect(node(w)).toBe('offer');
});
it('offers the map once Lost Relics is finished', () => {
  finishQuest(w, 'q_relics'); talk(w, 'collector_pepe');
  expect(node(w)).toBe('map_offer');
});
it('still lets you hand in Lost Relics first', () => {
  setStep(w, 'q_relics', 'return'); talk(w, 'collector_pepe');
  expect(node(w)).toBe('relics_done');
});
it('gives no marker on the step that finds the hidden door', () => {
  expect(QUESTS.q_collectors_map.steps.find((s) => s.id === 'door')!.marker).toBeUndefined();
});
it('starts The Rootdeep when you go through the hidden door', () => {
  playToDoor(w); useDoor(w);
  expect(prog(w).quests.q_collectors_map.status).toBe('complete');
  expect(prog(w).quests.q_rootdeep.status).toBe('active');
  expect(prog(w).inventory.seal_shard ?? 0).toBe(0);
});
it('plays from Collector Pepe to Rootcleaver and back', async () => {
  await playRootdeep(w);
  expect(prog(w).inventory.staff_rootcleaver).toBe(1);
  expect(prog(w).quests.q_rootdeep.status).toBe('complete');
});
```

Extend `every power and staff the plan promises can be had` in `tests/sim/quests-playthrough.test.ts` by playing the Rootdeep before the staff check.

In `tests/content/m4-sproutvale.test.ts`, point the quest reference checks and "nothing is given twice" at `WORLD_CONTENT`, and add its portals to `placeIds`. In `tests/content/quests-content.test.ts`, build `standing` and `places` from `WORLD_CONTENT`. The placement and camp-count checks stay on `SPROUTVALE_CONTENT`.

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `npx vitest run tests/sim/rootdeep-quests.test.ts`
Expected: FAIL, `q_collectors_map` is not defined.

- [ ] **Step 3: Add the quests and the item**

Write both quests from the Design. `seal_shard` is a `quest` item, rarity `rare`, stacking, named "Seal Shard", with the blurb "Warm to the touch."

- [ ] **Step 4: Add Collector Pepe's lines**

Insert these rules **before** the `after` rule in `collector_pepe`'s entry list, in this order:

| Condition | Node |
|---|---|
| `q_rootdeep` complete | `rootdeep_after` |
| `q_rootdeep` active, step 5 | `rootdeep_done` |
| `q_rootdeep` active | `rootdeep_busy` |
| `q_collectors_map` active | `map_busy` |
| `q_relics` complete and `q_collectors_map` available | `map_offer` |

| Node | Text |
|---|---|
| `map_offer` | "One of those relics was never a relic. It's a map, and it shows a door hidden in the old Orchard hedge. Something very sharp is buried behind it. The way down is dangerous, mind." Choices: "Show me." (starts `q_collectors_map`), "Maybe later." |
| `map_busy` | "North side of the Orchard. Look where the leaves grow wrong." |
| `rootdeep_busy` | "Three levers, one vault. And more ways out than the map shows." Effect: `do: [{ startQuest: 'q_rootdeep' }]`. It changes nothing while the quest is active, and the content test requires every quest's giver to offer it. |
| `rootdeep_done` | "You found it! Keep the blade. My collection could never hold it." |
| `rootdeep_after` | "My collection is complete. I mean it this time." |

- [ ] **Step 5: Run the tests and confirm they pass**

Run: `npx vitest run tests/sim/rootdeep-quests.test.ts tests/sim/quests-playthrough.test.ts tests/content/quests-content.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests/sim/rootdeep-quests.test.ts tests/sim/quests-playthrough.test.ts tests/content/m4-sproutvale.test.ts tests/content/quests-content.test.ts
git commit -m "Rootdeep: Collector Pepe's two quests"
```

---

## Quest 7: Prove the whole run with a gamepad

**Files:**
- Create: `tests/e2e/rootdeep.mjs`
- Modify: `package.json:17`, `.github/workflows/ci.yml`
- Modify: `README.md`, `AGENTS.md` (the Checks list)

**Interfaces:**
- Consumes: `window.__pad` and `window.__qa`, as `tests/e2e/camps.mjs` uses them.

- [ ] **Step 1: Write the end-to-end test**

`tests/e2e/rootdeep.mjs` drives the game with the simulated gamepad only. `__qa.teleport` may move the player between spots. Every interaction must be a pad press. It asserts, in order:

1. At `hedge_north` on a fresh save there is no interact prompt.
2. With `rootdeep.door.revealed` set, a pad press goes through the door, the loading veil lifts, and the player is on the cave floor (`isRootdeep`, y within 0.5 of 0).
3. `__qa.state().cave` is true, and the Map tab opens by pad on the cave map.
4. Resting at the Lantern Hall shrine, then reloading and pressing Continue, lands on the cave floor with `__qa.state().cave` true.
5. A pad press at `rd_cave_hedge_south` comes out on the surface with `__qa.state().cave` false, and the bull has not moved underground.
6. Rootcleaver equips from the Gear tab by pad, and `staffMounted` is true.

- [ ] **Step 2: Run it and confirm it passes**

Run: `npm run build && node tests/e2e/rootdeep.mjs`
Expected: exit code 0.

- [ ] **Step 3: Add it to the checks**

Append `&& node tests/e2e/rootdeep.mjs` to `test:e2e`, run it in CI, add `npm run bake:world -- rootdeep --check` to `AGENTS.md`'s checks, and add a short "The Rootdeep" section to `README.md`.

- [ ] **Step 4: Run every check**

Run: `npm run lint && npm run typecheck && npm test && npm run build && npm run check:assets && npm run budgets && npm run gen:moves -- --check && npm run test:e2e`
Expected: all pass. World streaming changed, so this must be the full `test:e2e`: three laps and the heap check.

- [ ] **Step 5: Hand it to the owner to play**

Report the time for a first clear, the level you tested at, and anything that felt wrong. Target: 30 to 45 minutes to find all three levers and reach the vault.

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/rootdeep.mjs package.json .github/workflows/ci.yml README.md AGENTS.md
git commit -m "Rootdeep: a pad-only end-to-end run"
```
