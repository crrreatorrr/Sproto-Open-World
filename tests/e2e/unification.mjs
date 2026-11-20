/**
 * Unification E2E smoke test: boots `?dungeon=L01` (Campaign Dungeon) and `?pvp=1` (Free 1v1 PvP
 * Arena, Sim v3 — no Second Wind) in headless Chromium and verifies both reach live gameplay with
 * zero console or page errors.
 *
 *   node tests/e2e/unification.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5199, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

function padInit() {
  const buttons = Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 }));
  const pad = {
    id: 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)',
    index: 0, connected: true, mapping: 'standard', timestamp: 0, axes: [0, 0, 0, 0], buttons,
    vibrationActuator: { playEffect: () => Promise.resolve('complete') },
  };
  const NAMES = ['a', 'b', 'x', 'y', 'lb', 'rb', 'lt', 'rt', 'back', 'start', 'l3', 'r3', 'up', 'down', 'left', 'right', 'home'];
  window.__pad = {
    set(name, down) {
      const b = buttons[NAMES.indexOf(name)];
      b.pressed = down;
      b.value = down ? 1 : 0;
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
}

let failures = 0;
function check(ok, what, detail = '') {
  if (ok) console.log(`  ok   ${what}${detail ? `  (${detail})` : ''}`);
  else {
    failures++;
    console.log(`  FAIL ${what} ${detail}`);
  }
}

const errors = [];
const url = server.resolvedUrls.local[0];
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}

try {
  // 1. Campaign Dungeon L01 (`?dungeon=L01`), gamepad-driven Play -> Soldier class -> live dungeon.
  console.log('  -- campaign dungeon (?dungeon=L01)');
  await page.goto(`${url}?dungeon=L01`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 60000 });
  // Wake pad, open class picker, pick Wizard (first class) to enter L01.
  await press('a');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 15000 });
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === null && window.__qa.state().player, null, { timeout: 60000 });
  await frames(10);
  const dState = await page.evaluate(() => window.__qa.state());
  check(dState.screen === null && Boolean(dState.player), 'enters live Campaign Dungeon L01');

  // 2. Free 1v1 PvP Arena (`?pvp=1`), zero-Rapier Sim v3 boot.
  console.log('  -- free 1v1 pvp arena (?pvp=1)');
  await page.goto(`${url}?pvp=1`);
  await page.waitForFunction(() => document.body.textContent?.includes('FREE 1v1 ARENA (SIM v3)'), null, { timeout: 30000 });
  await frames(10);
  const hasCanvas = await page.evaluate(() => Boolean(document.querySelector('canvas')));
  check(hasCanvas, 'renders Free 1v1 PvP Arena canvas and Sim v3 HUD');

  check(errors.length === 0, 'no console or page errors', errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}

if (failures > 0) process.exit(1);
console.log('unification e2e: ok');
