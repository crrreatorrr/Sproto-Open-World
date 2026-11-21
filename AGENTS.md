# Sproto Open World

A 3D open-world action RPG for the browser: melee (staff) and magic combat, quests and bosses,
single player first with co-op planned. Three.js, Rapier, TypeScript and Vite. The plan is
`docs/plans/2026-11-17-first-area-plan.md`; `README.md` covers running it and the controls.

## Rules

- `src/sim` and `src/content` are pure: no `three`, DOM, `Math.random`, `Date.now`,
  `performance.now`, storage or timers. Rapier is imported only under `src/sim/physics`. Render,
  camera and UI see the sim only through `ReadonlySimView` and change it only by sending commands.
  `tests/architecture.test.ts` enforces this.
- Generated files are never edited by hand: `src/content/generated/*` (run `npm run gen:moves`),
  `public/assets/models/characters/player.glb` and `player.melee.json` (the art pipeline in
  `art/README.md`), and `public/assets/IMPORTED.json` (`npm run import:assets`).
- Never run `gltf-transform optimize` on `player.glb`: it strips the `socket_staff` node the staff
  mounts on. Use `art/tools/build-player-glb.mjs`.
- Assets come from the sibling repos through `tools/import-sibling-assets.mjs` and are committed.
  Nothing reads a sibling repo at run time.
- Gamepad support is first-class (owner): every menu works with a pad only, and the smoke test
  proves it. The one exception, by the owner's call, is the hub feedback window: keyboard only
  (N twice; no menu button, the pad does nothing while it is open).
- `vendor/hub-sdk` comes from `metaverse-hub`. Follow `vendor/hub-sdk/VENDOR.md` to update it, and
  never edit its files by hand. The game imports only the lean `/feedback`, `/core` and `/progress`
  entries (`/progress` is `createProgressStore`, for the hub account's save in `src/save/slot.ts`),
  never the root entry.

## Checks

```bash
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run check:assets
npm run budgets
npm run gen:moves -- --check
npm run bake:world -- rootdeep --check
npm run test:e2e
```

`test:e2e` needs Playwright's Chromium (`npx playwright install chromium`). It boots the game in
headless Chromium and drives it with a simulated gamepad only. Headless Chromium (and CI) renders
on a software GPU, so long tasks during gameplay are reported there, not asserted. On a machine
with a GPU, `SMOKE_STRICT_LONGTASKS=1 npm run test:e2e` opens a visible window and asserts them. World tests are
off until the exhaustive world pass: `tests/world`, `tests/content/world-*` and
`tests/sim/riding-streaming.test.ts` are excluded in `vitest.config.ts`, and `tests/e2e/world.mjs`
(the Sproutvale laps and heap check) is out of `test:e2e` and CI. Run them by hand before a
world-streaming PR: `npm run test:world` runs the unit suites.

## Working with other agents

Claude Code, Codex, Cursor and Grok Bot all work on this repo.

- Start each task on its own branch from the latest `main`, named `<agent>/<slug>`. Never push to
  `main`; open a pull request.
- Don't edit files that another active task is changing.
- Run the checks before opening a pull request, and report any you could not run.
- A different agent reviews the work: `agent-task review <path>`, or `/codex:adversarial-review` in
  Claude Code.
