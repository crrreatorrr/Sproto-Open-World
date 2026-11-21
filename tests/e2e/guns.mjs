/**
 * Gun controls E2E, pad only (gun shooting design §3 to §5): as the Soldier in the training yard,
 * RT fires, LT steps the zoom, X reloads, RB swings, and the view stays third person.
 *
 *   node tests/e2e/guns.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { port: 5198, strictPort: false, hmr: false }, logLevel: 'error' });
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
  // The training yard as the Soldier (second class in the picker), with nothing but the pad.
  await page.goto(`${url}?yard=1&localsave=0`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 60000 });
  await press('a');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 15000 });
  await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === null && window.__qa.state().player, null, { timeout: 60000 });
  await frames(20);

  const gun = () => page.evaluate(() => {
    const app = window.__qa.app;
    const g = app.sim.gunRuntime(0);
    const p = app.sim.playerEntity(0);
    return g && { id: g.gunId, mag: g.runtime.mag, magSize: g.runtime.magSize, zoom: g.runtime.scopeZoom, reload: g.runtime.reloadTicks, mode: app.rig.mode, action: p.combat?.action?.kind ?? null, spells: p.progress.spells };
  });
  const until = async (pred, label, max = 600) => {
    for (let i = 0; i < max; i++) {
      const g = await gun();
      if (g && pred(g)) return g;
      await frames(2);
    }
    throw new Error(`timed out waiting for ${label}`);
  };

  let g = await gun();
  check(g?.id === 'gun_mg' && g.mag === g.magSize, 'the Soldier starts with a full Toy MG', `${g?.mag}/${g?.magSize}`);
  check(g.spells.includes('bolt') && !g.spells.includes('gunfire'), 'the Soldier knows the Arcane Bolt, not Gunfire');
  check(g.mode === 'ots', 'a gun in hand uses the shoulder camera', g.mode);

  // RT fires.
  await page.evaluate(() => window.__pad.set('rt', true));
  g = await until((q) => q.mag <= q.magSize - 3, 'three shots');
  await page.evaluate(() => window.__pad.set('rt', false));
  check(g.mag < g.magSize, 'RT fires the gun', `${g.mag}/${g.magSize}`);
  check(g.action !== 'attack', 'the trigger does not swing the gun');

  // LT steps the zoom: on, then off (one level on the MG).
  await press('lt');
  g = await until((q) => q.zoom === 1, 'zoom on');
  check(g.zoom === 1, 'LT zooms');
  await frames(20);
  g = await gun();
  check(g.mode === 'ads', 'the camera tightens over the shoulder', g.mode);
  check(g.action !== 'block', 'zooming does not raise the guard');
  await press('lt');
  g = await until((q) => q.zoom === 0, 'zoom off');
  check(g.zoom === 0, 'LT again drops the zoom (one level on the MG)');

  // X reloads.
  const before = g.mag;
  await press('x');
  g = await until((q) => q.reload > 0, 'a reload');
  check(g.reload > 0, 'X reloads');
  g = await until((q) => q.reload === 0 && q.mag === q.magSize, 'the reload finishing', 900);
  check(g.mag === g.magSize && g.mag > before, 'the magazine is full again', `${before} -> ${g.mag}`);

  // RB swings the gun.
  await press('rb');
  g = await until((q) => q.action === 'attack', 'a swing');
  check(g.action === 'attack', 'RB swings the gun');

  // The old first-person toggle does nothing: the game is third person only.
  await until((q) => q.action === null, 'the swing ending', 900);
  await press('left');
  await frames(10);
  g = await gun();
  check(g.mode === 'ots', 'D-pad Left no longer leaves third person', g.mode);

  check(errors.length === 0, 'no console or page errors', errors.join('\n'));
} finally {
  await browser.close();
  await server.close();
}

if (failures > 0) process.exit(1);
console.log('guns e2e: ok');
