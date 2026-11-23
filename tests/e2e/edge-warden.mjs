/**
 * The Edge Warden on the real world (far-view plan §3.10; a teleport is the only cheat): at the edge
 * of the world the dragon appears with a warning, opens fire after its grace and kills a player who
 * stays; back inland, it leaves.
 *
 *   node tests/e2e/edge-warden.mjs [--shots dir] [--gpu]
 *
 * `--gpu` renders on the machine's GPU (for looking at the shots); the default is the software GPU.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const gpu = args.includes('--gpu');

const server = await createServer({ server: { port: 5199, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

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

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const shot = async (name) => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}
/** The Warden as the sim and the scene have it, and how the player is doing. */
const look = () => page.evaluate(() => {
  const app = window.__qa.app;
  const p = app.sim.playerEntity(0);
  const d = app.sim.entities.find((e) => e.warden);
  const fire = app.sim.entities.filter((e) => e.projectile && d && e.projectile.owner === d.id).length;
  return {
    warden: d ? { mode: d.warden.mode, t: d.warden.t, away: Math.hypot(d.tf.pos.x - p.tf.pos.x, d.tf.pos.z - p.tf.pos.z), up: d.tf.pos.y - p.tf.pos.y, drawn: !!app.world?.get?.(d.id) } : null,
    fire,
    hp: p.vitals.hp / p.vitals.hpMax,
    dead: p.combat?.action?.kind === 'dead',
    x: p.tf.pos.x,
    z: p.tf.pos.z,
    toast: window.__qa.state().toast ?? null,
    wait: window.__qa.state().groundWait,
  };
});
async function until(pred, what, maxFrames = 1800) {
  for (let i = 0; i < maxFrames; i += 3) {
    const s = await look();
    if (pred(s)) return s;
    await frames(3);
  }
  throw new Error(`timed out waiting for ${what}`);
}
/** Turn the camera up to the Warden for a few frames (for the shots: it circles overhead). */
const faceWarden = (n = 24) => page.evaluate((k) => new Promise((res) => {
  let i = 0;
  const f = () => {
    const app = window.__qa.app;
    const p = app.sim.playerEntity(0);
    const d = app.sim.entities.find((e) => e.warden);
    if (d) {
      const dx = d.tf.pos.x - p.tf.pos.x, dz = d.tf.pos.z - p.tf.pos.z;
      app.rig.yaw = Math.atan2(dx, dz);
      app.rig.pitch = Math.atan2(d.tf.pos.y + 8 - p.tf.pos.y, Math.hypot(dx, dz)) * 0.9;
    }
    if (++i >= k) res();
    else requestAnimationFrame(f);
  };
  f();
}), n);
let failures = 0;
function check(ok, what, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

try {
  await page.goto(`${server.resolvedUrls.local[0]}?localsave=0`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 180000 });
  await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 30000 });
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 180000 });
  await frames(60);
  let s = await look();
  check(!s.warden, 'no Warden in the village', `the start is ${Math.min(s.x, s.z).toFixed(0)} m from the edge`);

  // The south edge of Sproutvale, below the village.
  await page.evaluate(() => window.__qa.teleport(300, 6));
  s = await until((q) => !q.wait && q.warden, 'the Warden to appear');
  check(s.warden.mode === 'watch' && s.fire === 0, 'at the edge it appears, and holds its fire', `${s.warden.away.toFixed(0)} m off, ${s.warden.up.toFixed(0)} m up`);
  const warned = await page.evaluate(() => new Promise((res) => {
    let n = 0;
    const f = () => {
      const t = window.__qa.state().toast ?? document.body.innerText;
      if (/Edge Warden/.test(t)) res(true);
      else if (++n > 240) res(false);
      else requestAnimationFrame(f);
    };
    f();
  }));
  check(warned, 'the HUD warns the player to turn back');
  s = await until((q) => q.warden && q.warden.away < 60, 'it to fly in');
  if (shots) await faceWarden();
  await shot('w1-circling');

  s = await until((q) => q.warden?.mode === 'strike' && q.fire > 0, 'it to open fire');
  check(true, 'after the grace it opens fire', `${s.fire} fireball(s) in the air`);
  if (shots) await faceWarden();
  await shot('w2-barrage');
  s = await until((q) => q.dead || q.hp < 1, 'a hit');
  await shot('w3-hit');
  s = await until((q) => q.dead, 'the player to die');
  check(s.dead, 'staying at the edge kills');

  // Back at the shrine it has nobody to guard against.
  s = await until((q) => !q.dead && !q.warden, 'the respawn, and the Warden to leave', 3600);
  check(!s.warden && Math.min(s.x, s.z) > 48, 'after the respawn it is gone', `the player is ${Math.min(s.x, s.z).toFixed(0)} m from the edge`);
  await shot('w4-gone');
  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (err) {
  await shot('w99-failure');
  check(false, String(err));
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `edge-warden: ${failures} failure(s)` : 'edge-warden: all checks passed');
process.exit(failures ? 1 : 0);
