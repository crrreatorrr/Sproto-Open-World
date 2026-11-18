#!/usr/bin/env node
/**
 * M0 smoke test (plan §8, M0 acceptance): boots the game in headless Chromium against the Vite dev
 * server and drives it with a simulated gamepad only:
 *
 *   title → Settings → Controls → back → back → Play → move, jump → pause → Settings → back → Resume
 *   → WebGL context lost and restored
 *
 * It asserts the player model, its 18 clips and the staff on socket_staff, that the stick moves
 * the player and A jumps, and that there are no console errors. Long tasks once playing are
 * asserted on a real GPU and only reported on a software one (CI), where they measure frame time.
 *
 *   npm run test:e2e                 # headless
 *   npm run test:e2e -- --shots DIR  # also save screenshots
 *   SMOKE_STRICT_LONGTASKS=1 npm run test:e2e   # real GPU, long tasks asserted
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

const server = await createServer({ server: { port: 5199, strictPort: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

// SMOKE_STRICT_LONGTASKS=1: use the machine's real GPU and assert long tasks (run it on the target laptop).
const strictLongTasks = process.env.SMOKE_STRICT_LONGTASKS === '1';
// Headless Chromium never gets a GPU, so strict mode opens a visible window.
const browser = await chromium.launch(strictLongTasks ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));

// A standard-mapping pad the test controls through window.__pad.
await page.addInitScript(() => {
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
    axes(lx, ly) {
      pad.axes[0] = lx;
      pad.axes[1] = ly;
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
});

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
  if (cond) console.log(`  ok   ${what}`);
  else {
    failures++;
    console.log(`  FAIL ${what} ${detail}`);
  }
}
async function shot(name) {
  if (shotsDir) await page.screenshot({ path: `${shotsDir}/${name}.png` });
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 30000 });
  check(true, 'boots to the title screen');
  await shot('01-title');

  // Wake the pad (that press is swallowed by design), then navigate menus with it.
  await press('down');
  let s = await state();
  check(s.device === 'gamepad', 'the pad becomes the active device', JSON.stringify(s.device));
  await press('down');
  s = await state();
  check(s.focused === 'Settings', 'D-pad moves the focus', JSON.stringify(s.focused));
  await press('a');
  s = await state();
  check(s.screen === 'screen-settings', 'A opens Settings', s.screen);
  await press('a');
  s = await state();
  check(s.screen === 'screen-controls', 'A opens Controls', s.screen);
  await shot('02-controls');
  await press('b');
  await press('b');
  s = await state();
  check(s.screen === 'screen-title', 'B backs out to the title', s.screen);
  await press('up');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing', null, { timeout: 30000 });
  s = await state();
  check(s.state === 'playing', 'A on Play starts the game');
  check(s.staffMounted === true, 'staff mounted on socket_staff');
  check(s.clips.length === 18 && s.clips.includes('attack_light_1') && s.clips.includes('block'), 'player.glb has all 18 clips', s.clips.join(','));

  // Long tasks from here on (loading is allowed to be heavy).
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver((l) => window.__long.push(...l.getEntries().map((e) => e.duration))).observe({ type: 'longtask', buffered: false });
  });

  const start = s.player.pos;
  await page.evaluate(() => window.__pad.axes(0, -1));
  await frames(60);
  await page.evaluate(() => window.__pad.axes(0, 0));
  s = await state();
  const moved = Math.hypot(s.player.pos.x - start.x, s.player.pos.z - start.z);
  check(moved > 1.5, 'left stick moves the player', `moved ${moved.toFixed(2)} m`);
  await shot('03-moving');

  await frames(20);
  await page.evaluate(() => window.__pad.set('a', true));
  let airborne = false;
  for (let i = 0; i < 20 && !airborne; i++) {
    await frames(1);
    airborne = !(await state()).player.grounded;
  }
  await page.evaluate(() => window.__pad.set('a', false));
  check(airborne, 'A jumps');
  await frames(90);
  check((await state()).player.grounded, 'lands again');

  await page.evaluate(() => window.__qa.playClip('attack_heavy'));
  await frames(30);
  await shot('04-heavy-clip');

  // Long tasks only mean something on a real GPU. On a software rasterizer (CI runners have no
  // GPU, so Chromium draws with SwiftShader on the CPU) every rendered frame is a long task, which
  // is frame time, and frame time is measured by hand on the target laptop (plan §8). There the
  // count is reported, not asserted. SMOKE_STRICT_LONGTASKS=1 asserts it anyway.
  // Measured over gameplay only: the context-loss step below rebuilds every shader on purpose.
  const long = await page.evaluate(() => window.__long.splice(0));
  const worst = long.length ? Math.max(...long) : 0;
  const gpu = await page.evaluate(() => {
    const gl = document.querySelector('canvas.game-canvas').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
  });
  const software = /swiftshader|llvmpipe|software|lavapipe/i.test(gpu);
  const longDetail = `${long.length} tasks, worst ${worst.toFixed(0)} ms on ${gpu}`;
  if (software && !strictLongTasks) console.log(`  info long tasks during gameplay (software GPU, not asserted): ${longDetail}`);
  else check(worst <= 50 || long.length <= 2, 'no repeated long tasks during gameplay', longDetail);
  await press('start');
  s = await state();
  check(s.state === 'paused' && s.screen === 'screen-pause', 'Start pauses', `${s.state} ${s.screen}`);
  await press('down');
  await press('a');
  s = await state();
  check(s.screen === 'screen-settings', 'Settings from the pause menu', s.screen);
  await press('b');
  await press('up');
  await press('a');
  s = await state();
  check(s.state === 'playing', 'Resume from the pause menu', s.state);

  // WebGL context loss (plan §2.9): pause behind a veil, recover when the context returns.
  const lost = await page.evaluate(async () => {
    const gl = document.querySelector('canvas.game-canvas').getContext('webgl2');
    const ext = gl.getExtension('WEBGL_lose_context');
    if (!ext) return null;
    ext.loseContext();
    await new Promise((r) => setTimeout(r, 200));
    const during = { state: window.__qa.state().state, veil: document.querySelector('.veil').classList.contains('active') };
    ext.restoreContext();
    await new Promise((r) => setTimeout(r, 500));
    return { during, veilAfter: document.querySelector('.veil').classList.contains('active') };
  });
  if (lost) {
    check(lost.during.state === 'paused' && lost.during.veil, 'a lost WebGL context pauses behind the veil', JSON.stringify(lost.during));
    check(!lost.veilAfter, 'the veil clears when the context is restored');
    await page.evaluate(() => window.__qa.app.resume());
    await frames(10);
    check((await state()).state === 'playing', 'play resumes after a context restore');
  } else console.log('  skip WebGL context loss (WEBGL_lose_context not available)');

  check(errors.length === 0, 'no console errors', errors.join('\n'));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err instanceof Error ? err.message : err}`);
  await shot('99-failure');
} finally {
  await browser.close();
  await server.close();
}

if (failures) {
  console.log(`smoke: ${failures} failure(s)`);
  process.exit(1);
}
console.log('smoke: all checks passed');
