/**
 * The Pepe Bull on the real world, pad only (a teleport is the only cheat): ride up with Y, run, swing
 * with RB, cast with LT + X, and get down with Y.
 *
 *   node tests/e2e/mount.mjs [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

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
    axes(lx, ly, rx = 0, ry = 0) {
      pad.axes.splice(0, 4, lx, ly, rx, ry);
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
}

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const state = () => page.evaluate(() => window.__qa.state());
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}
async function until(pred, what, maxFrames = 600) {
  for (let i = 0; i < maxFrames; i += 3) {
    const s = await state();
    if (pred(s)) return s;
    await frames(3);
  }
  throw new Error(`timed out waiting for ${what}`);
}
let failures = 0;
function check(ok, what, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 180000 });
  await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 180000 });
  await frames(30);

  // Walk up to the bull, east of the start.
  await page.evaluate(() => window.__qa.teleport(272, 55.6));
  await frames(40);
  let s = await until((q) => /Ride Pepe Bull/.test(q.prompt ?? ''), 'the ride prompt');
  check(/Ride Pepe Bull/.test(s.prompt), 'the bull offers a ride', s.prompt);
  await shot('b1-prompt');

  await press('y');
  s = await until((q) => q.player.riding === 'mounting', 'mounting');
  check(s.player.action === 'mounting', 'Y starts climbing on', s.player.action);
  await frames(6);
  await shot('b2-mounting');
  s = await until((q) => q.player.riding === 'riding', 'the saddle');
  check(s.player.riding === 'riding', 'the player is in the saddle');
  await frames(20);
  await shot('b3-seated');
  s = await state();
  check(/Dismount/.test(s.prompt ?? ''), 'the prompt now says Dismount', s.prompt);
  check(/LS\s*Gallop/.test(s.prompt ?? ''), 'the prompt names the gallop button on the pad', s.prompt);

  // Press to run: one tap of L3 and the bull gallops with nothing held.
  await page.evaluate(() => window.__pad.axes(0, -1));
  s = await until((q) => q.player.speed > 8, 'trotting', 900);
  await press('l3');
  s = await until((q) => q.player.speed > 14, 'galloping', 900);
  check(s.player.speed > 14, 'one press of L3 gallops with no button held', `${s.player.speed.toFixed(1)} m/s`);
  check(/Slow to a trot/.test(s.prompt ?? ''), 'the prompt offers the trot', s.prompt);
  await shot('b4-gallop');
  // A hedge crosses this line 70 m north of the bull: each leg starts back at the bull, so a stop against it can't pass for a trot.
  const backToBull = () => page.evaluate(() => window.__qa.teleport(272, 55.6));
  await backToBull();
  await press('l3');
  await until((q) => q.player.speed > 8.5, 'trotting again', 900);
  await frames(40);
  s = await state();
  check(s.player.speed > 8.5 && s.player.speed < 10, 'the next press slows to a trot', `${s.player.speed.toFixed(1)} m/s`);
  await backToBull();
  await press('l3');
  s = await until((q) => q.player.speed > 14, 'galloping again', 900);
  check(s.player.speed > 14, 'a third press gallops again', `${s.player.speed.toFixed(1)} m/s`);
  await backToBull();

  // Melee and magic without stopping. Short actions are read from the QA log: on a slow software
  // GPU a 0.3 s Bolt can start and end between two rendered frames.
  const logged = async (kind, what) => (await page.evaluate(() => window.__qa.log())).some((e) => e.kind === kind && (!what || e.what === what));
  const waitLog = async (kind, what, label) => {
    for (let i = 0; i < 300; i++) {
      if (await logged(kind, what)) return true;
      await frames(2);
    }
    throw new Error(`timed out waiting for ${label}`);
  };
  const z0 = (await state()).player.pos;
  await page.evaluate(() => window.__qa.log(true));
  await page.evaluate(() => window.__pad.set('rb', true));
  await waitLog('attackStart', null, 'a swing');
  await page.evaluate(() => window.__pad.set('rb', false));
  s = await state();
  check(s.player.riding === 'riding', 'RB swings the staff from the saddle');
  await shot('b5-melee');
  s = await until((q) => q.player.action === null, 'the swing ending');
  check(Math.hypot(s.player.pos.x - z0.x, s.player.pos.z - z0.z) > 1, 'the bull kept moving through the swing');

  await page.evaluate(() => window.__qa.log(true));
  await page.evaluate(() => window.__pad.set('lt', true));
  await frames(3);
  await page.evaluate(() => window.__pad.set('x', true));
  await waitLog('cast', 'bolt', 'a cast');
  await page.evaluate(() => { window.__pad.set('x', false); window.__pad.set('lt', false); });
  s = await state();
  check(s.player.riding === 'riding', 'LT + X casts from the saddle');
  await shot('b6-cast');
  await until((q) => q.player.action === null, 'the cast ending');

  // Stop, and get down.
  await page.evaluate(() => window.__pad.axes(0, 0));
  await until((q) => q.player.speed < 0.3, 'stopping');
  await until((q) => /Dismount/.test(q.prompt ?? ''), 'the dismount prompt');

  // The legs stay in the saddle while the arms fight: pose the rider directly at a known action.
  const layersFor = (action) => page.evaluate((a) => {
    const app = window.__qa.app;
    const e = structuredClone(app.sim.playerEntity(0));
    e.combat.action = a;
    app.player.update(e, 1, 0);
    const anim = app.player.animator;
    return { base: anim.currentClip, upper: anim.upperClip };
  }, action);
  let l = await layersFor({ kind: 'attack', move: 'light1', t: 6, clipT: 6, charge: 0, charging: false, charged: false, hit: [], lunge: 0, lungeDir: { x: 0, z: 1 } });
  check(l.base === 'ride' && /^attack_light/.test(l.upper ?? ''), 'melee plays on the upper body over the seated legs', JSON.stringify(l));
  l = await layersFor({ kind: 'cast', spell: 'bolt', t: 4, release: 10, woven: false });
  check(l.base === 'ride' && l.upper === 'cast', 'magic plays on the upper body over the seated legs', JSON.stringify(l));
  await frames(6);

  await press('y');
  s = await until((q) => q.player.riding === 'dismounting', 'dismounting');
  check(s.player.action === 'mounting', 'Y climbs down');
  await frames(8);
  await shot('b7-dismounting');
  s = await until((q) => q.player.riding === null, 'the ground');
  check(s.player.riding === null, 'the player is back on foot');
  await frames(30);
  await shot('b8-off');
  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (err) {
  await shot('b99-failure');
  check(false, String(err));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `mount: ${failures} failure(s)` : 'mount: all checks passed');
process.exit(failures ? 1 : 0);
