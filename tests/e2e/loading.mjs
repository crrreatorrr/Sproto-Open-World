/**
 * Asset streaming S0 (docs/plans/2026-11-17-asset-streaming-plan.md), pad only on the real baked
 * world: the title downloads only what it needs, the small boot staff sharpens when things are
 * calm, a model that fails to download recovers by itself, and walking across cell edges never
 * shows the loading veil.
 *
 *   node tests/e2e/loading.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

/** Decoded bytes of game assets the title may fetch. */
const TITLE_BUDGET_KIB = 2900;
const CELL = 64;

const server = await createServer({ server: { port: 5195, strictPort: false, hmr: false }, logLevel: 'error' });
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
    axes(x, y) {
      pad.axes[0] = x;
      pad.axes[1] = y;
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
  performance.setResourceTimingBufferSize(20000);
}

const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
/** While a test blocks a file on purpose, the browser's "Failed to load resource" is expected. */
let blocking = false;
page.on('console', (m) => {
  if (m.type() !== 'error' || (blocking && /Failed to load resource/.test(m.text()))) return;
  errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const state = () => page.evaluate(() => window.__qa.state());
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}
let failures = 0;
function check(ok, what, detail = '') {
  if (ok) console.log(`  ok   ${what}${detail ? `  (${detail})` : ''}`);
  else {
    failures++;
    console.log(`  FAIL ${what} ${detail}`);
  }
}
const assetRequests = () => page.evaluate(() => performance.getEntriesByType('resource')
  .map((e) => ({ path: new URL(e.name).pathname, bytes: e.decodedBodySize }))
  .filter((e) => /^\/(assets|world)\//.test(e.path)));
const heal = () => page.evaluate(() => {
  const v = window.__qa.app.sim.playerEntity(0).vitals;
  v.hp = v.hpMax;
});
async function settle() {
  await page.waitForFunction(() => {
    const s = window.__qa.state();
    const c = s.world?.counters;
    return s.state === 'playing' && !s.groundWait && !s.waitingForGround && c && c.pending === 0 && c.queued === 0 && c.inFlight === 0;
  }, null, { timeout: 120000, polling: 250 });
  await frames(10);
}
async function teleport(x, z) {
  await heal();
  await page.evaluate(([a, b]) => window.__qa.teleport(a, b), [x, z]);
  await frames(2);
  await settle();
}

/** Walk with the left stick toward (x, z) until the player's cell changes. Returns veil frames seen. */
async function walkAcrossEdge(toX, toZ) {
  const start = await state();
  const cellOf = (p) => `${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`;
  const from = cellOf(start.player.pos);
  await page.evaluate(() => {
    const app = window.__qa.app;
    const seen = { frames: 0, on: true };
    window.__veilWatch = seen;
    const f = () => {
      if (!seen.on) return;
      if (app.groundWait) seen.frames++;
      requestAnimationFrame(f);
    };
    requestAnimationFrame(f);
  });
  let crossed = false;
  for (let i = 0; i < 240 && !crossed; i++) {
    const s = await state();
    const wx = toX - s.player.pos.x, wz = toZ - s.player.pos.z;
    const d = Math.hypot(wx, wz) || 1;
    const sy = Math.sin(s.camYaw), cy = Math.cos(s.camYaw);
    await page.evaluate(([a, b]) => window.__pad.axes(a, b), [(-cy * wx + sy * wz) / d, -(sy * wx + cy * wz) / d]);
    await frames(2);
    await heal();
    crossed = cellOf((await state()).player.pos) !== from;
  }
  // A few more steps past the edge: the veil, if any, shows on the frames right after the crossing.
  await frames(12);
  await page.evaluate(() => window.__pad.axes(0, 0));
  await frames(4);
  const veil = await page.evaluate(() => {
    window.__veilWatch.on = false;
    return window.__veilWatch.frames;
  });
  return { crossed, veil };
}

try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 90000 });
  await page.waitForFunction(() => {
    const c = window.__qa.state().world?.counters;
    return c && c.loaded > 0 && c.pending === 0 && c.queued === 0 && c.inFlight === 0;
  }, null, { timeout: 90000, polling: 250 });
  await page.waitForTimeout(1500);

  console.log('  -- the title');
  let req = await assetRequests();
  const titleKiB = req.reduce((n, e) => n + e.bytes, 0) / 1024;
  check(titleKiB <= TITLE_BUDGET_KIB, `the title downloads ≤ ${TITLE_BUDGET_KIB} KiB`, `${titleKiB.toFixed(0)} KiB in ${req.length} files`);
  const got = (name) => req.some((e) => e.path.endsWith(name));
  check(!got('/elites/brute.glb'), 'no Brute at the title');
  check(!got('/staffs/staff_sproto.glb'), 'no full staff at the title');
  check(got('/staffs/staff_sproto-lod1.glb'), 'the small boot staff is there');

  // A model blocked before anyone needs it: the Orchard's Grunts stand in, then recover.
  blocking = true;
  await page.route(/models\/enemies\/grunt\.glb/, (r) => r.fulfill({ status: 503, body: 'unavailable' }));

  await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 90000 });
  await settle();

  console.log('  -- the boot staff sharpens when calm');
  // Game time can't pass faster than 0.1 s a frame, so on a CI runner's software GPU the staff's ten
  // calm seconds take minutes.
  let s = await state();
  check(s.staffMounted, 'the player holds a staff from the first frame');
  await page.waitForFunction(() => performance.getEntriesByType('resource').some((e) => e.name.endsWith('/staffs/staff_sproto.glb')), null, { timeout: 300000, polling: 500 });
  await page.waitForFunction(() => window.__qa.app.assets.isReal('staff_sproto'), null, { timeout: 300000, polling: 500 });
  await frames(10);
  s = await state();
  check(s.staffMounted, 'the full staff is in hand after a calm moment');

  console.log('  -- a failed model recovers by itself');
  await teleport(70, 84);
  await page.waitForFunction(() => window.__qa.state().enemies.some((e) => e.def === 'grunt_orchard' && e.viewShown), null, { timeout: 300000, polling: 250 });
  check(!(await page.evaluate(() => window.__qa.app.assets.isReal('grunt'))), 'with its file blocked, the Grunt is a stand-in');
  check((await state()).state === 'playing', 'the game keeps running');
  await page.unroute(/models\/enemies\/grunt\.glb/);
  await page.waitForFunction(() => window.__qa.app.assets.isReal('grunt'), null, { timeout: 300000, polling: 500 });
  blocking = false;
  await heal();
  await frames(6);
  const skinned = await page.evaluate(() => {
    const st = window.__qa.state();
    const g = st.enemies.find((e) => e.def === 'grunt_orchard' && e.viewShown && e.action !== 'dead');
    const v = g && window.__qa.app.world.get(g.id);
    let found = false;
    v?.root.traverse((o) => { if (o.isSkinnedMesh) found = true; });
    return found;
  });
  check(skinned, 'once the file is back, the Grunt on screen is the real model');

  console.log('  -- walking across cell edges');
  // Open ground, away from the camps. Each stop is 8 m short of an edge, walking over it.
  const ROUTES = [
    [100, 120, 100, 140], [100, 184, 100, 200], [120, 150, 136, 150],
    [250, 120, 250, 136], [248, 110, 264, 110], [200, 120, 200, 136],
  ];
  let veilFrames = 0;
  let crossings = 0;
  for (const [x, z, toX, toZ] of ROUTES) {
    await teleport(x, z);
    const r = await walkAcrossEdge(toX, toZ);
    if (r.crossed) crossings++;
    veilFrames += r.veil;
  }
  check(crossings === ROUTES.length, 'every walk crossed its cell edge', `${crossings} of ${ROUTES.length}`);
  check(veilFrames === 0, 'no veil frames while walking across cell edges', `${veilFrames} frames`);

  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err}`);
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `loading: ${failures} failure(s)` : 'loading: all checks passed');
process.exit(failures ? 1 : 0);
