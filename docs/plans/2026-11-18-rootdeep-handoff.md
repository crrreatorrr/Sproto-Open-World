# The Rootdeep: Handoff to Grok Bot

You are building a new cave dungeon for Sproto Open World. This document tells you what the owner
wants, what is already proven, what will trip you up, and how to finish. The step-by-step build
instructions are in [2026-11-18-rootdeep-cave-plan.md](2026-11-18-rootdeep-cave-plan.md).

## 1. Start here

| | |
|---|---|
| **Your branch** | `grok/rootdeep-cave`, based on `main` at `9036915` |
| **Worktree on the owner's machine** | `/Users/kenhiraoka/games/.worktrees/Sproto-Open-World/grok-rootdeep-cave` |
| **What is on the branch** | The plan, this handoff and `rootdeep-handoff/terrain.json`. No game code yet. |
| **Your first job** | Quest 1 in the plan |
| **Finished means** | Section 11 of this document |

Read in this order:

1. This document, all of it.
2. `AGENTS.md`, for the repo's rules and checks.
3. The plan's **Design** section.
4. The plan's Quest 1, then begin.

## 2. What the owner asked for

The owner set these requirements. Do not change them without asking.

1. A dungeon level with a cave, in the game's existing low-poly style.
2. **Placeholder environment.** No new environment art.
3. A **large cave system with many entrances and pathways**.
4. The entrance is **hidden in a wall that already exists** in the world.
5. The quest comes from the **starter zone**, from **the same person who gave Lost Relics**: Collector Pepe.
6. It unlocks **after Lost Relics is complete**.
7. **Current enemies** fill the cave.
8. At the end, **a chest holds an amazing item: a very powerful melee sword**.

The owner also **accepted these trade-offs**, so do not "fix" them:

- Rootcleaver is far stronger than the game's weapon balance rule allows, and later bosses get easier.
- Rootcleaver uses the existing staff swing animations.
- A new player can reach the cave early, because Lost Relics has no requirements. Pepe warns them, and nothing else gates it.

## 3. The finished experience

1. The player finishes Lost Relics. Collector Pepe says one relic was really a map.
2. Pepe sends them to the old hedge on the north side of the Orchard Fields. A marker leads there.
3. They drive off 4 diggers and receive 3 Seal Shards.
4. **The marker stops.** They search the hedge by hand until a prompt appears at the hidden door.
5. They go through and arrive in a dark cave, lit by a torch on the player.
6. They rest at the Lantern Hall shrine, then explore freely to find 3 levers in any order.
7. Along the way they open 7 more hidden exits from inside. Each becomes a two-way shortcut to the surface.
8. The levers unlock the vault gate. They defeat the Deep Warden and open the chest.
9. They take **Rootcleaver** back to Pepe.

## 4. Setup

Node 22 or newer is required. The owner's machine has Node 22.22.3, Blender 5.2.3 at
`/Applications/Blender.app`, and Playwright's Chromium.

```bash
cd /Users/kenhiraoka/games/.worktrees/Sproto-Open-World/grok-rootdeep-cave
npm ci
npx playwright install chromium
```

Commands you will use most:

| Purpose | Command |
|---|---|
| Bake the cave | `npm run bake:world -- rootdeep` |
| Bake the cave's map picture | `npm run bake:map -- rootdeep` |
| Check a bake is current | `npm run bake:world -- rootdeep --check` |
| Rebake the valley, then its map | `npm run bake:world -- sproutvale && npm run bake:map` |
| Run one test file | `npx vitest run tests/path/name.test.ts` |
| All checks | The list in `AGENTS.md` |

**Always bake the map after the world.** `bake:world` deletes any file it did not produce, and that
includes `map.webp`.

## 5. The starting baseline

These results are for this branch's base, `main` at `9036915`, run on the owner's machine on
2026-11-18. Use them to tell problems you caused from problems that were already there.

| Check | Result |
|---|---|
| `npm ci` | Pass |
| `npm run lint` | Pass |
| `npm run typecheck` | Pass |
| `npm test` | **1,030 of 1,031 passed.** See the timing test below. |
| `npm run build` | Pass |
| `npm run check:assets` | Pass |
| `npm run budgets` | Pass |
| `npm run gen:moves -- --check` | Pass |
| `npm run bake:world -- sproutvale --check` | Pass |
| `node tests/e2e/smoke.mjs` | Pass locally. **Failed on GitHub CI.** See below. |
| `world.mjs`, `camps.mjs`, `loading.mjs`, `mount.mjs` | **Not run for this baseline** |

**Two known problems that are not yours:**

- **Timing test:** `tests/sim/perf.test.ts` ("40 active entities average ≤ 2 ms per tick") failed once
  in the full run while the machine was very busy (load average about 40). It then passed 3 out of 3
  times on its own. If it fails for you, run it alone before you treat it as a real failure.
- **GitHub CI on `main` is red:** the latest run failed one smoke check, "R3 locks on to a wave enemy".
  The same smoke test passed locally. A separate fix is in progress (section 9). If CI fails only on
  that check, say so in your pull request instead of working around it.

## 6. What is proven and what is not

**Proven on 2026-11-18, using the real tools and the real baked world:**

| Fact | How it was checked |
|---|---|
| The bake tool builds the cave with no changes to its terrain code | Baked `terrain.json`: 130 files, 1,630 KiB, largest cell 24.9 KiB |
| All 21 chambers connect | Flood fill over the baked heights |
| Closing the gate at local z 205 cuts off only the vault | Flood fill with the gate blocked |
| A body of 3 m radius fits through every passage | Flood fill over an eroded floor |
| No wall can be climbed | No wall sample is gentler than the 50° limit |
| `bake-map` works on the cave | Produced a 512 × 512 picture, 18 KiB |
| All 8 surface entrance spots are usable | Each has a baked wall piece, flat ground and nothing blocking it |

**Not proven. Expect to find problems here:**

| Unknown | Where it shows up | What to do |
|---|---|---|
| The veil and camera during travel | Quest 2 and 3 | Watch it in the running game, not only in tests |
| How the dark look reads on screen | Quest 3 | Take screenshots and adjust the numbers |
| Enemies in narrow tunnels | Quest 5 | Watch a fight in a tunnel; a big enemy may snag on corners |
| About 50 extra enemies' cost | Quest 5 and 7 | Run the budgets and a strict long-task run on a real GPU |
| Rootcleaver in the player's hands | Quest 4 | Check grip and swing visually from several angles |
| Difficulty and length | Quest 7 | Report honestly; the owner decides on tuning |

## 7. How the existing game works, for this feature

| Topic | What you need to know | Where |
|---|---|---|
| Terrain | A cell is a heightfield, so true overhangs are impossible. Cave walls are simply high ground. There is no roof: darkness and fog hide the top. | `src/content/world/format.ts` |
| Streaming | Cells load around the player. Bodies over an unloaded cell are frozen. The veil shows until the ground is ready. | `src/world/CellStreamer.ts`, `src/app/WorldSession.ts` |
| Regions | Only one region loads today. Quest 1 merges the cave into it. | `src/world/RegionManifest.ts` |
| Setting things on the ground | Entities marked `settle` raycast down from y 200 when their cell is ready. | `SimWorld.settleOnGround` |
| Camera | Already collides with world colliders, so cave walls work with no camera change. | `src/camera/CameraRig.ts:251-266` |
| Enemy movement | **There is no pathfinding.** Enemies walk straight at the player and slide along walls, then return home on a leash. | `src/sim/ai/brain.ts:304-345` |
| Enemy awareness | **Today enemies notice players by distance only, straight through rock.** Quest 5 fixes this for cave enemies. | `pickTarget`, `src/sim/ai/brain.ts:123` |
| Saves | Position is not saved. Continue puts you at your last shrine. World flags, opened chests and inventory are saved. | `SimWorld.applySave` |
| Weapons | A weapon is an item with a `staff` block. The melee hit shape comes from the animation, about 1.9 m long, not from the model. | `src/sim/combat/hits.ts:380-415` |
| Quests | Data only. Objectives are `kill`, `collect`, `talk`, `reach`, `interact`, `feat`. | `src/content/quests.ts` |
| Pure code rule | `src/sim` and `src/content` must not use `three`, the DOM, timers or randomness. A test enforces it. | `tests/architecture.test.ts` |

## 8. Traps already found

Each of these was found by reading the code. The plan already accounts for them. Do not undo the
choice to make something simpler.

| Trap | What goes wrong | The plan's answer |
|---|---|---|
| A ridden bull follows its rider | `teleportPlayer` only cancels a mount in progress, so the bull goes underground | Portals are skipped while riding |
| The bull comes to your shrine | Resting in the cave teleports the bull into the cave | `callMount` ignores cave shrines |
| Valley tests count all content | Adding cave content to `SPROUTVALE_CONTENT` breaks the enemy count, camp spacing and map border tests | Keep it in `ROOTDEEP_CONTENT`, joined by `WORLD_CONTENT` |
| Height ranges differ between regions | The cave would decode to the wrong heights | Both regions use -8 to 40 |
| Adding a light at run time | Every shader recompiles and the game hitches | The torch always exists, at intensity 0 on the surface |
| `interactable.used` | For a portal, it means **hidden** | `syncPortals` sets it every tick |
| Every quest's giver must offer it | A content test fails for `q_rootdeep`, which starts from a reward | `rootdeep_busy` also carries `startQuest` |
| Adding `travel` to `RpgCtx` | Breaks test helpers that build that context | `SimWorld` handles the `portalTravel` event instead |
| Testing the renderer directly | `WebGLRenderer` cannot run in Vitest | Test the pure `lookFor` function |
| Item count | A test requires at most 40 kinds of item. The game has about 32, and this adds 2. | Do not add spare items |
| Asset tracking | `check:assets` fails on any file it does not know | Add the sword to `OWN` |
| `player.glb` | Optimizing it strips the weapon socket | Do not touch it |

## 9. Other work that overlaps yours

These changes exist **only as uncommitted edits in other worktrees**. They are not on `main` or
GitHub yet, and they may land while you work. **Run `git fetch` and rebase before you start each quest.**

| Work | Files it shares with you | What to watch for |
|---|---|---|
| **Quest tracker fix** (`claude/fix-relics-tracker`) | `rpg.ts`, `SimWorld.ts`, `view.ts`, `quests.ts`, `mapTab.ts`, `rpgText.ts`, `gameMenu.ts`, `App.ts` | Adds `questOffers`, which reads dialogue, and starting a quest now tracks it. This is the biggest overlap, mostly with your Quests 2, 3 and 6. |
| **Solid bull** (`claude/bull-handling`) | `SimWorld.ts`, `riding.ts`, `locomotion.ts`, `PhysicsWorld.ts`, `WorldViews.ts`, `App.ts` | The bull gets a solid body. Re-test the bull rules in Quest 2 if this lands. |
| **Smoke test fix** (`claude/fix-smoke-lock`) | `tests/e2e/smoke.mjs` | It targets the CI failure described in section 5. |

Do not copy code from those worktrees, and do not edit them.

## 10. The quests at a glance

Work them in this order. Each one must merge before the next begins.

| # | Quest | Needs | Risk | Done when |
|---|---|---|---|---|
| 1 | Bake the cave and merge it | Nothing | Medium | The cave's cells stream with the valley, and the map tests pass |
| 2 | Hidden portals | 1 | **High** | Sealed doors show nothing, and travel works both ways |
| 3 | Look, views and map | 2 | Medium | The cave is dark, the surface is unchanged, and the map switches |
| 4 | Rootcleaver | None of the cave work | Medium | The sword hits for 52, the shockwave works, and it looks right in hand |
| 5 | Enemies, levers and treasure | 2, 4 | **High** | Every cave is populated, and the vault opens only with all 3 levers |
| 6 | Collector Pepe's quests | 2, 4, 5 | Low | The whole quest chain plays from Pepe to the sword and back |
| 7 | Full gamepad run | All | Medium | Every check passes, and the owner has something to play |

For each quest:

1. `git fetch origin` and start from the latest `main`. Quest 1 stays on `grok/rootdeep-cave`.
2. Follow the plan's steps in order. Write the failing test first.
3. Run every check in `AGENTS.md`.
4. Play the change in the running game when it can be seen.
5. Open a pull request and get it reviewed by a different agent.

**Never push to `main`.**

### Pull request template

```markdown
## What this adds
Rootdeep Quest <n>: <one sentence>

## How I checked it
- [ ] lint, typecheck, tests, build
- [ ] check:assets, budgets, gen:moves --check
- [ ] bake:world --check for rootdeep and sproutvale
- [ ] test:e2e
- [ ] Played in the running game: <what you saw>

## Checks I could not run
<each one and why, or "None">

## Differences from the plan
<each one and why, or "None">
```

### Stop and ask the owner if

- A requirement in section 2 cannot be met as written.
- Merging the cave needs a rewrite of `CellStreamer`, rather than the small change planned.
- The budgets fail and the only fix is to shrink the cave.
- Frame rate falls below the game's **30 fps floor** in the cave on a real GPU.
- Another agent's merged work makes a quest's design no longer fit.
- You want to add anything not in the plan, such as new art, a save schema change or a new enemy.

Report plainly when something fails. Never mark a check as passed if you did not run it.

## 11. Definition of done

The Rootdeep is finished when all of these are true:

- [ ] All 7 quests are merged to `main`.
- [ ] Every check in `AGENTS.md` passes, including the full `npm run test:e2e`.
- [ ] A fresh save can go from Lost Relics to Rootcleaver using **only a gamepad**.
- [ ] A sealed entrance shows no model, prompt, marker or map pin.
- [ ] All 8 entrances work in both directions once opened.
- [ ] The Pepe Bull never ends up underground.
- [ ] Continue from a cave shrine returns to the cave, in the dark look.
- [ ] The surface looks and plays exactly as it did before.
- [ ] No new environment art was added.

### The owner's playtest checklist

Give the owner this list with the final pull request:

1. Finish Lost Relics, then talk to Collector Pepe.
2. Follow the quest to the Orchard hedge, and find the hidden door by searching.
3. Explore the cave, and open at least one extra exit from inside.
4. Find all 3 levers, open the vault and beat the Deep Warden.
5. Open the chest, equip Rootcleaver and try a fully charged heavy attack.
6. Report how long it took, what level you were and what felt wrong.
