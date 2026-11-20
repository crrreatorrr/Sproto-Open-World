# Vendored @metaverse/hub-sdk

- repo: https://github.com/crrreatorrr/metaverse-hub
- branch: main
- sha: a3d94f9
- package: packages/hub-sdk @ 0.9.0
- built with: `node scripts/vendor-sdk.mjs` (in metaverse-hub)
- iife: dist/hub-sdk.iife.js (global HubSDK; not used by this game)
- iife sha256: d74ffe49c3a59390040e57ad0016d25db194bd68410fbcf5a0e199a1acbe17be
- source hashes: `SOURCE.pin.json`

This copy is byte-for-byte the one Sproto Duel and Sproto Shooter vendor from the same hub commit
(their `SOURCE.pin.json` files match this one). Layout: `package.json`, `README.md`,
`SOURCE.pin.json`, `dist/*.js`, `dist/*.d.ts`. No source maps.

Sproto Open World uses two lean entries:

- `@metaverse/hub-sdk/feedback`: `installFeedback` (the N-N window, its screenshot and its sending)
  and `feedbackTransportFromSdk`. The adapter is `src/hub/feedback.ts` (keyboard only, N twice).
  modern-screenshot (MIT, `dist/third_party/`) loads on the first
  capture.
- `@metaverse/hub-sdk/core`: `createHubSdk` and `isGameId`, for ticket redeem in `src/hub/link.ts`.

`GAME_IDS` in this version does not list `sproto-open-world` (`src/hub/config.ts`), so no visit is
redeemed and the window answers that feedback needs a signed-in hub visit. When metaverse-hub
registers the game, re-vendor and `src/hub/link.ts` starts redeeming `#t=<ticket>` with no code
change.

Re-sync this tree to hub main whenever packages/hub-sdk changes (run from the metaverse-hub root:
esbuild writes source paths relative to the working directory into the IIFE):
`cd /path/to/metaverse-hub && node scripts/vendor-sdk.mjs /path/to/Sproto-Open-World --branch main`,
then `npm install`.
