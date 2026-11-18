# Sproto Open World

A browser action RPG set in Sproutvale: fight up close with a staff and at range with spells,
take quests, beat Scrapjaw. Built with Three.js, Rapier (physics), TypeScript and Vite.

**Status: M0, bootstrap.** You can run, sprint and jump around a greybox test yard with the
player model and its staff, using keyboard and mouse or a gamepad, with title, pause, settings and
remappable controls. Combat arrives in M1a. The plan is in
[docs/plans/2026-11-17-first-area-plan.md](docs/plans/2026-11-17-first-area-plan.md).

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
| Pause / back | Esc | Menu / B |
| Menus | Arrows, Enter, Esc, or the mouse | D-pad or left stick, A, B |

Attack, block, dodge, lock-on and spell keys are already bound (see Settings → Controls) and do
nothing until M1a. Everything is remappable, and the prompts switch to your pad's glyphs when you
use it.

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
