# Sproto Open World

A browser action RPG set in Sproutvale: fight up close with a staff and at range with spells,
take quests, beat Scrapjaw. Built with Three.js, Rapier (physics), TypeScript and Vite.

**Status: M1a, first combat (the first "is it fun" gate).** Fight training dummies and the
Thornwood Brute in a greybox yard with the staff: a three-hit light combo, a chargeable heavy, a
dodge roll with i-frames and perfect dodges, block and parry (including reflecting coins), lock-on
and ripostes. Keyboard and mouse or a gamepad. Spells, groups and the real world come next. The plan
is in [docs/plans/2026-11-17-first-area-plan.md](docs/plans/2026-11-17-first-area-plan.md).

## Run it

```bash
npm install
npm run dev
```

Then open http://localhost:5180.

## Controls

| Action | Keyboard and mouse | Gamepad |
|---|---|---|
| Move | WASD or arrows | Left stick |
| Look | Mouse (click to capture) | Right stick |
| Sprint | Left Shift | Left stick click |
| Jump | Space | A |
| Light attack (tap again to combo) | Left mouse | RB |
| Heavy attack (hold to charge) | Right mouse | RT |
| Dodge roll | C | B |
| Block (the first moment of a block parries) | Q | LB |
| Lock on / switch target | Middle mouse or T / flick the mouse | Right stick click / flick the right stick |
| Pause / back | Esc | Menu / B |
| Menus | Arrows, Enter, Esc, or the mouse | D-pad or left stick, A, B |

Spell keys (1–4, or hold LT plus a face button) are bound but do nothing until M1b. Everything is
remappable in Settings → Controls, and the prompts switch to your pad's glyphs when you use it.

**The yard:** a passive dummy and a swinging dummy (practise parrying) just ahead to the left, a
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
| `art/` | Blender sources and the player's melee clip pipeline (`art/README.md`) |
| `tools/` | Asset import and the move-data generator |
| `scripts/` | Asset, budget and production-build checks |
| `tests/` | Vitest suites, and `e2e/smoke.mjs` (Playwright, gamepad-only) |

`AGENTS.md` lists the checks and the rules for working in this repo.
