# Sproto Open World

A browser action RPG set in Sproutvale: fight up close with a staff and at range with spells,
take quests, beat Scrapjaw. Built with Three.js, Rapier (physics), TypeScript and Vite.

**Status: M3, RPG systems.** Play drops you into a greybox **Sproutvale**: a 512 × 512 m valley
streamed in 64 m cells as you move. It has a village plateau, Watchtower Hill, the Millrun river and
its bridge, the orchard, Thornwood and the quarry ravine. The village has the first RPG loop:
- **Elder Pepe** gives the test quest *Wake Up, Sproto*: reach the training yard, break three straw
  dummies, open the old chest, bring back the seed, then rest at the shrine.
- **Trader Pepe** sells a staff, charms and a tonic flask for Sprouts.
- **The Shrine of First Light** heals you, refills your Sprout Tonics, becomes your respawn point,
  makes power swaps free, and is the place to reset your skills.

You earn XP and levels (cap 15), wear a staff, a robe and a charm, collect loot, and the game saves
itself (Continue on the title). **The menu** (Esc or Start) has one tab each for:
- **Powers:** equip four of the spells you know. A power you swap in starts on cooldown (at least
  3 s), so a swap is never a free reset.
- **Skills:** each level gives 2 points to spend, anywhere, on the **Magic** branch (Spell Power,
  Protection, Focus) or the **Combat** branch (Attack, Defense, Stamina). 10 and 20 ranks in a branch
  unlock a perk. A shrine refunds your points for 100 Sprouts per level.
- **Gear:** compare and change your staff, robe and charm, but not in combat (an enemy targeted you
  in the last 5 s) unless you're at a shrine.
- **Quests**, **Map** (you, the shrines you found and the tracked quest's marker) and **Settings.**

The camps, the other quests and the boss come in M4 and M5. The plan is in
[docs/plans/2026-11-17-first-area-plan.md](docs/plans/2026-11-17-first-area-plan.md).

| URL | What you get |
|---|---|
| http://localhost:5180/ | Sproutvale (the streamed world) |
| http://localhost:5180/?yard=1 | The training yard: dummies and the Thornwood Brute |
| http://localhost:5180/?sandbox=1 | The wave runner: mixed waves of 5–7 enemies |
| http://localhost:5180/?god=1 | God mode, for testing: you can't die, level 99, every item, spell and relic, and the Map tab travels to any shrine or area. Nothing is saved while it is on. (Dev builds also have the switch in the menu's Settings tab.) |

On the dev server, **F9** (or LB + RB + View) opens the placement editor: move the marks in
`world-src/sproutvale/placements.json`, copy the resulting file, paste it over the original and run
`npm run bake:world -- sproutvale`. After a re-bake, `npm run bake:map` redraws the Map tab's picture.

## The Rootdeep

A cave in the same streamed world, through doors hidden in hedges and quarry walls that are already
there. A sealed door has no prompt and no map pin. After Lost Relics, Collector Pepe sends you to
the old hedge on the north side of the Orchard Fields. Inside, the sun is off, a torch follows you,
and the Map tab shows the cave (Lantern Hall, the vault, and the other halls). Rest at the Lantern
Hall shrine and Continue wakes you on that floor. The Pepe Bull stays on the surface. Mouths you
climb out of open both ways. The vault chest holds **Rootcleaver**, a greatsword in the staff slot.
`node tests/e2e/rootdeep.mjs` plays that run with a pad only.

**In the yard and the wave runner** you fight with the staff (three-hit combo, chargeable heavy,
dodge roll, block and parry) and four spells: Arcane Bolt, Blast (burns), Frost Nova (chills; three
stacks freeze) and Chain Zap (shocks). A spell cast right after a melee hit is *woven*: faster and
stronger. Tap block just before a blow lands to parry it: the attacker is stunned, and a heavy press
during the stun is a riposte for huge damage. A heavy right after an ordinary block is a guard counter.
Each enemy type has weaknesses: Sprout Grunts swarm, Coin Slingers keep their distance and
resist magic, Hex Wisps float, resist the staff and blink away, and the Brute resists magic but
freezes easily.

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5180.

**Local save mode.** The game saves in the browser's localStorage, which is separate for every
port. On a dev server it also keeps the save in `~/.sproto-open-world/save.json` (the previous one
in `save.bak.json`), so every port, worktree and browser on this machine shares the same progress:
at the title the newer of the two saves wins, and every save goes to both. The title's bottom line
shows the file. `SOW_SAVE_DIR=<folder>` moves it, `SOW_LOCAL_SAVE=0 npm run dev` turns it off, and
`?localsave=0` turns it off for one tab. Automated browsers (the e2e tests) never touch it, and a
production build has no such endpoint, so it saves in the browser only.

## Controls

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Move | WASD or arrows | Left stick |
| Look | Mouse (click to capture) | Right stick |
| Sprint | Left Shift | Left stick click |
| Jump | Space | A |
| Light attack (tap again to combo) | Left mouse | RB |
| Heavy attack (hold to charge; while falling from a height, a plunge attack) | Right mouse | RT |
| Dodge roll (with no direction held, a backstep) | C | B |
| Block (the first moment of a block parries) | Q | LB |
| Lock on / switch target | Middle mouse or T / flick the mouse | Right stick click / flick the right stick |
| Cast the spell in slot 1–4 (in Sproutvale you start with Bolt) | 1 2 3 4 (or E R Z X) | Hold LT + X / Y / B / A |
| Interact: talk, open, rest | F | Y |
| Ride or get off the Pepe Bull (east of the start) | F | Y |
| Gallop on the Pepe Bull: press once and it keeps going, at no stamina cost, until you press again or stop (holding works too) | Left Shift | Left stick click |
| Call the Pepe Bull: it runs to you, or appears nearby and runs in if it is too far away | V | D-pad ↓ |
| Fast travel: with the Brick Phone in hand (Trader Pepe sells it; wield it from Gear), Light attack opens it. Call any shrine you have touched or rested at; the others show as locked. Not in combat | Left mouse | RB |
| Drink a Sprout Tonic | H | D-pad ↑ |
| Open the menu / close it | Esc | Menu (Start) |
| Open the menu on Quests | J | View (Back) |
| Open the menu on Gear | I | Menu, then LB / RB |
| Switch menu tabs | Q / E | LB / RB |
| Menus: move, choose, back | Arrows or WASD, Enter, Esc, or the mouse | D-pad or left stick, A, B |
| Send feedback (the game pauses; options, a note, a screenshot): 1–7 pick, Tab moves, Enter sends, Esc closes | N twice | — (keyboard only) |

Everything is remappable in Settings → Controls (N stays the feedback key), and the prompts switch to
your pad's glyphs when you use it.

**Feedback** works as in Sproto Duel and Sproto Shooter: the hub SDK's window (`vendor/hub-sdk`,
adapter `src/hub/feedback.ts`) freezes the game, takes a screenshot with the menus and HUD on it,
and sends the note with where you are, your state and the last few milestones (deaths, quest steps,
boss phases). Notes send only from a signed-in hub visit (`#t=<ticket>`).

**The hub** (`src/hub/link.ts`, as Sproto Shooter's): the plaza's Sproto Open World ring stands
beside Sproto Shooter's. Walking into it opens this game with a one-time ticket (`#t=`), which
redeems to a game session of the same hub account you signed in with, so your hub login is your
account here too. The title shows who is signed in (or Guest, or Not signed in) and where your save
lives. **Return to Hub** (title and pause screens, pad or mouse; in the world, Quit to title first)
closes the session and puts you back at the ring (`/hub/#from=sproto-open-world`).

**Saves follow the account** (`src/save/slot.ts`, `src/save/accountSave.ts`, hub-sdk
`createProgressStore`): from a hub visit the game loads and writes that account's save, kept in this
browser as `sow.account@<playerId>` and in the account's cloud save (`save.get` / `save.put`), so it
carries over to any device you sign in on. The copy written last on the save's line wins (a write
counter, then the time). Play outside the hub keeps the browser's own `sow.save` (with its `.bak`),
and, as in the other games, that save never moves into an account. While a portal visit signs in the
title says so and offers no Play until it knows whose save to show. The game earns no Tickets and
grants no Relic.

Dev and QA builds take `?feedbackMock`, which keeps sent notes on `window.__feedbackSent`.

**The yard (`?yard=1`):** a passive dummy and a swinging dummy (practise parrying) just ahead to the left, a
coin-shooting dummy behind you to the right (parry the coin to send it back), and the Brute further
behind you. Its slam is unblockable: red, a jagged ring on the ground and its own sound, so dodge
it. If you die you're back at the start after two seconds, and the yard resets.

**Debug overlay** (dev builds): the ` key. It shows frame and sim timing, draw calls, the sim
hash and the player's state. `[` and `]` (or the D-pad ← → on a pad) play each of the player's 18
clips.

## Layout

| Folder | What's there |
|---|---|
| `src/sim` | The pure gameplay simulation (fixed 60 Hz). `physics/` is the only Rapier user |
| `src/content` | Tuning and level data; `generated/` comes from `npm run gen:moves` |
| `src/app` | The game shell: loop, states, wiring |
| `src/input`, `src/camera`, `src/render`, `src/ui`, `src/audio` | Presentation and devices |
| `src/hub`, `vendor/hub-sdk` | The hub visit (account, Return to Hub), the feedback window's adapter and the vendored `@metaverse/hub-sdk` |
| `src/save` | The save file, its migrations, the browser slot and the hub account's cloud slot |
| `art/` | Blender sources and the player's melee clip pipeline (`art/README.md`) |
| `world-src/`, `public/world/` | World sources (terrain stamps, placements) and the baked cells (`npm run bake:world -- sproutvale`) |
| `src/world`, `src/workers` | The client-side streamer, terrain meshes, prop instancing and the horizon |
| `tools/` | Asset import and the move-data generator |
| `scripts/` | Asset, budget and production-build checks |
| `tests/` | Vitest suites, and `e2e/smoke.mjs` (Playwright, gamepad-only) |

`AGENTS.md` lists the checks and the rules for working in this repo.
