#!/usr/bin/env node
/**
 * World streaming test (plan §8 smoke steps 2–3; M2 acceptance 1, 3 and 4). Boots into Sproutvale
 * in Chromium, presses Play with a simulated pad, then uses `window.__qa.teleport` (dev builds
 * only) to move the player along a corner-to-corner lap of the region, three times:
 *
 *   SW → NE (diagonal) → SE → NW (diagonal) → SW, one cell (64 m) per step
 *
 * After every step it waits for the player's cell and its neighbours to have colliders, then checks
 * the player stands on the terrain and isn't frozen. It asserts:
 *   - the streamer's counters: cells fetched, unloaded, none failed, the queue drains;
 *   - draw calls (main + shadow pass) ≤ 200 and triangles ≤ 900k at 4 fixed spots, looking 4 ways;
 *   - the JS heap stays within ±15 % across 3 laps (where `performance.memory` exists);
 *   - no console errors;
 *   - zero long tasks over 50 ms during the laps ON A REAL GPU. On a software GPU (headless
 *     Chromium, CI) every frame is a long task, so they are reported, not asserted.
 *
 *   npm run test:e2e                              # software GPU, long tasks reported
 *   SMOKE_STRICT_LONGTASKS=1 npm run test:e2e     # the machine's GPU, long tasks asserted
 *   node tests/e2e/world.mjs --laps 1 --shots DIR # quicker, with screenshots
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const shotsDir = arg('--shots', null);
const LAPS = Number(arg('--laps', 3));
const strict = process.env.SMOKE_STRICT_LONGTASKS === '1';

const BUDGET = { calls: 200, triangles: 900_000 };
const HEAP_TOLERANCE = 0.15;
const STEP_M = 64;
/** Lap corners, 24 m inside the region's edge (the soft wall sits 8 m in). */
const LO = 24, HI = 512 - 24;
const LAP = [[LO, LO], [HI, HI], [HI, LO], [LO, HI], [LO, LO]];
/** Budget spots (plan §3.5): the hub, the orchard, Thornwood, the quarry. */
const SPOTS = [
  { name: 'Sprout Hollow', x: 256, z: 58 },
  { name: 'Orchard Fields', x: 150, z: 200 },
  { name: 'Thornwood', x: 300, z: 340 },
  { name: 'Old Quarry', x: 420, z: 440 },
];

const server = await createServer({ server: { port: 5197, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

// The real GPU: headless Chromium on macOS reaches it through ANGLE's Metal backend; elsewhere a
// visible window is the reliable way (as in smoke.mjs).
const gpuLaunch = process.platform === 'darwin' ? { args: ['--use-angle=metal', '--ignore-gpu-blocklist'] } : { headless: false };
const softLaunch = { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] };
const launch = strict ? gpuLaunch : softLaunch;
launch.args = [...(launch.args ?? []), '--enable-precise-memory-info', '--js-flags=--expose-gc'];
const browser = await chromium.launch(launch);
const errors = [];

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

// A software GPU spends its time filling pixels; draw calls and triangles don't depend on size.
const page = await browser.newPage({ viewport: strict ? { width: 1280, height: 720 } : { width: 960, height: 540 } });
/** While a test blocks cell requests on purpose, the browser's "Failed to load resource" is expected. */
let blocking = false;
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  if (blocking && /Failed to load resource/.test(m.text())) return;
  errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((n) => new Promise((r) => { let i = 0; const f = () => (++i >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const state = () => page.evaluate(() => window.__qa.state());
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}
let failures = 0;
function check(cond, what, detail = '') {
  if (cond) console.log(`  ok   ${what}${detail ? `  (${detail})` : ''}`);
  else {
    failures++;
    console.log(`  FAIL ${what} ${detail}`);
  }
}
async function shot(name) {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}.png` });
}

/** Teleport, wait for ground under the player's 3 × 3, then let it settle. Returns the settled state. */
async function teleport(x, z, settleFrames = 12) {
  const ok = await page.evaluate(([x, z]) => window.__qa.teleport(x, z), [x, z]);
  if (!ok) throw new Error(`teleport to ${x}, ${z} refused`);
  await frames(2);
  await page.waitForFunction(() => {
    const s = window.__qa.state();
    return s.state === 'playing' && !s.groundWait && !s.waitingForGround;
  }, null, { timeout: 30000, polling: 'raf' });
  await frames(settleFrames);
  return state();
}

/** The player is on the ground near (x, z) and free to move. */
function standing(s, x, z) {
  const p = s.player;
  const d = Math.hypot(p.pos.x - x, p.pos.z - z);
  return { ok: p.grounded && !s.waitingForGround && d < 3, detail: `grounded ${p.grounded}, frozen ${s.waitingForGround}, ${d.toFixed(2)} m from target, y ${p.pos.y.toFixed(2)}` };
}

/** Wait until nothing is loading: no pending cells, queue drained, uploads done, templates ready. */
async function streamIdle(timeout = 30000) {
  await page.waitForFunction(() => {
    const w = window.__qa.state().world;
    return w && w.counters.pending === 0 && w.counters.queued === 0 && w.counters.inFlight === 0 && w.uploads === 0 && w.props.ready === w.props.templates;
  }, null, { timeout, polling: 100 });
  // Props re-bucket every 15 ticks; give them a few.
  await frames(30);
}

async function heap() {
  return page.evaluate(() => {
    window.gc?.();
    return performance.memory ? performance.memory.usedJSHeapSize : null;
  });
}

function lapPoints() {
  const pts = [];
  for (let i = 0; i + 1 < LAP.length; i++) {
    const [ax, az] = LAP[i], [bx, bz] = LAP[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP_M));
    for (let k = 0; k < n; k++) pts.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  pts.push(LAP[LAP.length - 1]);
  return pts;
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 30000 });
  let s = await state();
  check(s.mode === 'world', 'boots into world mode by default', s.mode);
  // Wake the pad (that press is swallowed by design), then A on Play.
  await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing', null, { timeout: 30000 });
  await page.waitForFunction(() => !window.__qa.state().groundWait, null, { timeout: 30000 });
  await frames(20);
  s = await state();
  check(s.world?.region === 'sproutvale', 'Play loads Sproutvale', JSON.stringify(s.world?.region));
  const start = s.player.pos;
  check(Math.hypot(start.x - 256, start.z - 58) < 2, 'the player starts at the manifest start', `${start.x.toFixed(1)}, ${start.z.toFixed(1)}`);
  check(s.player.grounded && !s.waitingForGround, 'the player stands on the terrain at the start', `y ${start.y.toFixed(2)}`);
  check(s.world.horizon, 'the horizon mesh is resident');
  await shot('w01-start');

  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas.game-canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
  const software = /swiftshader|llvmpipe|software|lavapipe/i.test(gpu);
  console.log(`  info GPU: ${gpu}`);

  // Cell fetch failure (plan §2.9): 3 retries, the veil holds the player, and after 15 s the panel
  // offers Retry / Return to start, pad only. Runs before the laps, while these cells are uncached.
  console.log('  -- cell fetch failure');
  const blockCells = async (re) => {
    blocking = true;
    await page.route(re, (r) => r.fulfill({ status: 503, body: 'unavailable' }));
  };
  const unblock = async (re) => {
    await page.unroute(re);
  };
  const NE = /cells\/c_[67]_[67]\./;
  await blockCells(NE);
  await page.evaluate(() => window.__qa.teleport(470, 470));
  await frames(10);
  s = await state();
  const veil = await page.evaluate(() => document.querySelector('.veil').classList.contains('active'));
  check(s.groundWait && veil, 'a teleport onto missing cells shows the loading veil', `groundWait ${s.groundWait}, veil ${veil}`);
  const t0 = Date.now();
  await page.waitForFunction(() => window.__qa.state().errorOpen, null, { timeout: 30000, polling: 250 });
  const waited = (Date.now() - t0) / 1000;
  s = await state();
  check(waited >= 13 && waited <= 22, 'the Retry / Return panel appears after the 15 s veil timeout', `${waited.toFixed(1)} s`);
  check(s.world.counters.retries >= 3 && s.world.counters.failed > 0, 'each failing cell was retried 3 times first', `retries ${s.world.counters.retries}, failed ${s.world.counters.failed}`);
  check(s.waitingForGround, 'the player is held still meanwhile');
  check(s.errorAction === 'Retry', 'Retry has the focus', s.errorAction);
  await press('right');
  check((await state()).errorAction === 'Return to start', 'the D-pad moves to Return to start', (await state()).errorAction);
  await press('left');
  await shot('w01b-timeout');
  await unblock(NE);
  await press('a');
  await page.waitForFunction(() => { const q = window.__qa.state(); return !q.errorOpen && !q.groundWait && !q.waitingForGround; }, null, { timeout: 30000 });
  await frames(12);
  let st0 = standing(await state(), 470, 470);
  check(st0.ok, 'Retry loads the cells and the player lands', st0.detail);

  const EAST = /cells\/c_7_[234]\./;
  await blockCells(EAST);
  await page.evaluate(() => window.__qa.teleport(480, 200));
  await page.waitForFunction(() => window.__qa.state().errorOpen, null, { timeout: 30000, polling: 250 });
  await press('right');
  await press('a');
  await page.waitForFunction(() => { const q = window.__qa.state(); return q.state === 'playing' && !q.errorOpen && !q.groundWait && !q.waitingForGround; }, null, { timeout: 30000 });
  await frames(12);
  st0 = standing(await state(), 256, 58);
  check(st0.ok, 'Return to start puts the player back at the start, on the ground', st0.detail);
  await unblock(EAST);
  blocking = false;

  // Budgets at 4 spots, looking 4 ways (terrain culls by frustum; props draw as whole meshes).
  console.log('  -- budgets at 4 spots');
  for (const spot of SPOTS) {
    s = await teleport(spot.x, spot.z);
    await streamIdle();
    let worst = { calls: 0, triangles: 0, shadowCalls: 0, shadowTriangles: 0 };
    for (let i = 0; i < 4; i++) {
      await page.evaluate((yaw) => {
        window.__qa.app.rig.yaw = yaw;
      }, (i * Math.PI) / 2);
      await frames(4);
      const f = (await state()).frameStats;
      if (f.calls > worst.calls) worst = { ...worst, calls: f.calls, shadowCalls: f.shadowCalls };
      if (f.triangles > worst.triangles) worst = { ...worst, triangles: f.triangles, shadowTriangles: f.shadowTriangles };
      if (i === 0) await shot(`w02-${spot.name.replace(/\W+/g, '-').toLowerCase()}`);
    }
    const st = standing(await state(), spot.x, spot.z);
    check(st.ok, `${spot.name}: stands on the terrain`, st.detail);
    check(worst.calls <= BUDGET.calls, `${spot.name}: draw calls ≤ ${BUDGET.calls}`, `${worst.calls} (main ${worst.calls - worst.shadowCalls} + shadow ${worst.shadowCalls})`);
    check(worst.triangles <= BUDGET.triangles, `${spot.name}: triangles ≤ 900k`, `${(worst.triangles / 1000).toFixed(1)}k (shadow ${(worst.shadowTriangles / 1000).toFixed(1)}k)`);
  }

  // Laps. Long tasks are watched from the first step on (loading was allowed to be heavy).
  const points = lapPoints();
  console.log(`  -- ${LAPS} laps, ${points.length} teleports each`);
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: false });
  });
  const heaps = [];
  const before = (await state()).world.counters;
  let notStanding = [];
  for (let lap = 1; lap <= LAPS; lap++) {
    const t0 = Date.now();
    for (const [x, z] of points) {
      const st = standing(await teleport(x, z), x, z);
      if (!st.ok) notStanding.push(`lap ${lap} (${x.toFixed(0)}, ${z.toFixed(0)}): ${st.detail}`);
    }
    // Measure the heap at the same spot each lap, with streaming settled.
    await teleport(256, 58);
    await streamIdle();
    const h = await heap();
    heaps.push(h);
    const st = await state();
    const c = st.world.counters;
    console.log(`  info lap ${lap}: ${((Date.now() - t0) / 1000).toFixed(1)} s, heap ${h === null ? 'n/a' : `${(h / 1048576).toFixed(1)} MB`}, GPU geometries ${st.gpuMemory.geometries} textures ${st.gpuMemory.textures}, fetched ${c.fetched}, unloaded ${c.unloaded}, colliders +${c.collidersLoaded}/−${c.collidersUnloaded}, retries ${c.retries}`);
    if (lap === 1) await shot('w03-after-lap-1');
  }
  check(notStanding.length === 0, 'after every teleport the player stands on the terrain, not frozen', notStanding.slice(0, 5).join('; '));

  const after = (await state()).world;
  const c = after.counters;
  check(c.fetched >= 60, 'the laps stream in (nearly) every cell of the region', `fetched ${c.fetched} of 64 (${c.cached} cached)`);
  check(c.unloaded - before.unloaded > 50, 'cells unload behind the player', `unloaded ${c.unloaded - before.unloaded} during the laps`);
  check(c.collidersUnloaded > 0 && c.collidersLoaded > c.collidersUnloaded, 'colliders go to the sim and come back out', `+${c.collidersLoaded} −${c.collidersUnloaded}`);
  check(c.failed === before.failed && c.retries === before.retries, 'no cell fetch failed or retried during the laps', `failed ${c.failed - before.failed}, retries ${c.retries - before.retries}`);
  check(c.queued === 0 && c.pending === 0, 'the loader queue drains', `queued ${c.queued}, pending ${c.pending}`);
  check(c.active <= 25 && c.loaded <= 49, 'loaded cells stay within the rings', `${c.loaded} shown, ${c.active} active, ${c.visual} visual`);
  check(after.props.overflow === 0, 'no prop bucket overflows its baked capacity', `overflow ${after.props.overflow}`);

  const long = await page.evaluate(() => window.__long.splice(0));
  const worst = long.length ? Math.max(...long) : 0;
  const over = long.filter((d) => d > 50);
  const longDetail = `${over.length} over 50 ms, worst ${worst.toFixed(0)} ms on ${gpu}`;
  if (software && !strict) console.log(`  info long tasks during laps (software GPU, not asserted): ${longDetail}`);
  else check(over.length === 0, 'zero long tasks over 50 ms during the laps', longDetail);

  if (heaps.every((h) => h !== null) && heaps.length >= 2) {
    const base = heaps[0];
    const drift = heaps.map((h) => (h - base) / base);
    // A leak grows the heap; a drop (the first lap's warm-up garbage collected) is fine.
    const worstGrowth = Math.max(...drift);
    check(worstGrowth <= HEAP_TOLERANCE, `JS heap doesn't grow across ${heaps.length} laps (≤ +15 %)`, heaps.map((h) => `${(h / 1048576).toFixed(1)} MB`).join(' → '));
  } else console.log(`  skip heap check (${heaps.length < 2 ? 'needs 2+ laps' : 'performance.memory not available'})`);

  check(errors.length === 0, 'no console errors', errors.join('\n'));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err instanceof Error ? err.message : err}`);
  await shot('w99-failure');
} finally {
  await browser.close();
  await server.close();
}

if (failures) {
  console.log(`world: ${failures} failure(s)`);
  process.exit(1);
}
console.log('world: all checks passed');
