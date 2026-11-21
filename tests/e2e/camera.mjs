#!/usr/bin/env node
/**
 * Camera smoothness (feedback WORLD-0005: "sudden jumps" while running, aiming or not). Boots
 * Sproutvale, stands the player in the orchard the note came from, and runs them about with a
 * simulated pad: forward, side to side, in circles, sprinting, jumping, turning the view, zooming
 * in and out, with a staff (orbit camera) and with a gun (shoulder and zoomed cameras).
 *
 * Every rendered frame it records where the camera is and which way it looks. A smooth camera
 * changes speed a little each frame; a pop is a frame whose movement differs from its neighbours'
 * by centimetres. The test fails when any frame's pop is over the limits below. The view stick is
 * moved gradually: the rig turns exactly as told, so a flicked stick is the player's own jump.
 *
 *   node tests/e2e/camera.mjs            # headless, software GPU
 *   CAMERA_GPU=1 node tests/e2e/camera.mjs   # headless on the machine's GPU (smooth frame times)
 *   node tests/e2e/camera.mjs --json FILE    # also save every scenario's worst frames
 *   node tests/e2e/camera.mjs --shots DIR    # also save a screenshot at the end of each scenario
 *   node tests/e2e/camera.mjs --only TEXT    # only the scenarios whose name has TEXT in it
 */
import { writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;
const shotsDir = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;

/** The most the camera's place may pop in one frame (m), at 60 frames a second. */
const POP_LIMIT = 0.05;
/** The most the view direction may pop in one frame (degrees). */
const TURN_POP_LIMIT = 0.6;

const server = await createServer({ server: { port: 5196, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const gpu = process.env.CAMERA_GPU === '1';
const browser = await chromium.launch({ args: gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

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
    axes(lx, ly) {
      pad.axes[0] = lx;
      pad.axes[1] = ly;
      pad.timestamp++;
    },
    look(rx, ry) {
      pad.axes[2] = rx;
      pad.axes[3] = ry;
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
}

/** Record the camera after every rig update: wraps `rig.update` once. */
function recorderInit() {
  const app = window.__qa.app;
  const rig = app.rig;
  if (rig.__rec) return;
  const rec = { on: false, rows: [] };
  rig.__rec = rec;
  const update = rig.update.bind(rig);
  const dir = rig.forward.clone();
  rig.update = (dt, target, ...rest) => {
    update(dt, target, ...rest);
    if (!rec.on) return;
    const cam = rig.camera;
    cam.getWorldDirection(dir);
    rec.rows.push([dt, cam.position.x, cam.position.y, cam.position.z, dir.x, dir.y, dir.z, target.x, target.y, target.z, rig.mode, cam.fov]);
  };
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
const report = {};

/**
 * The worst pops in a recording. Per frame: the camera's place and its view direction. A frame's
 * pop is how far its step is from the average of the steps before and after it, each step scaled
 * to the frame's length so an uneven frame rate doesn't read as one.
 */
function analyse(rows) {
  const out = { frames: rows.length, pop: 0, popAt: -1, turnPop: 0, turnAt: -1, fovPop: 0, worst: [] };
  const vel = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1], b = rows[i];
    const dt = Math.max(1e-4, b[0]);
    const turn = Math.acos(Math.min(1, a[4] * b[4] + a[5] * b[5] + a[6] * b[6])) * (180 / Math.PI);
    vel.push({ i, dt, v: [(b[1] - a[1]) / dt, (b[2] - a[2]) / dt, (b[3] - a[3]) / dt], w: turn / dt, f: (b[11] - a[11]) / dt });
  }
  for (let k = 1; k < vel.length - 1; k++) {
    const p = vel[k - 1], c = vel[k], n = vel[k + 1];
    const pop = Math.hypot(...c.v.map((v, j) => v - (p.v[j] + n.v[j]) / 2)) * c.dt;
    const turnPop = Math.abs(c.w - (p.w + n.w) / 2) * c.dt;
    out.fovPop = Math.max(out.fovPop, Math.abs(c.f - (p.f + n.f) / 2) * c.dt);
    if (pop > out.pop) { out.pop = pop; out.popAt = c.i; }
    if (turnPop > out.turnPop) { out.turnPop = turnPop; out.turnAt = c.i; }
    if (pop > POP_LIMIT / 2 || turnPop > TURN_POP_LIMIT / 2) out.worst.push({ frame: c.i, dt: +c.dt.toFixed(4), pop: +pop.toFixed(3), turnPop: +turnPop.toFixed(2), dy: +(c.v[1] * c.dt).toFixed(3), mode: rows[c.i][10] });
  }
  out.worst = out.worst.slice(0, 40);
  return out;
}

async function play(kind) {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(padInit);
  const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
  const press = async (name) => {
    await page.evaluate((n) => window.__pad.set(n, true), name);
    await frames(3);
    await page.evaluate((n) => window.__pad.set(n, false), name);
    await frames(3);
  };
  const stick = (x, y) => page.evaluate(([lx, ly]) => window.__pad.axes(lx, ly), [x, y]);
  let lookAt = [0, 0];
  /** Push the view stick to (x, y) over a third of a second, as a thumb does. */
  const look = async (x, y, ms = 330) => {
    const [x0, y0] = lookAt;
    const t0 = Date.now();
    for (;;) {
      const k = ms <= 0 ? 1 : Math.min(1, (Date.now() - t0) / ms);
      const e = k * k * (3 - 2 * k);
      await page.evaluate(([rx, ry]) => window.__pad.look(rx, ry), [x0 + (x - x0) * e, y0 + (y - y0) * e]);
      if (k >= 1) break;
      await page.waitForTimeout(8);
    }
    lookAt = [x, y];
  };
  const hold = (name, down) => page.evaluate(([n, d]) => window.__pad.set(n, d), [name, down]);
  const wait = (ms) => page.waitForTimeout(ms);

  await page.goto(`${url}?localsave=0`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 120000 });
  await press('a');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 15000 });
  if (kind === 'gun') await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === null && window.__qa.state().player, null, { timeout: 120000 });
  await frames(30);
  await page.evaluate(recorderInit);

  /** Back to the orchard (or `at`), the view turned to `yaw`, standing still; then record `run`. */
  const scenario = async (name, run, at = [104, 160], yaw = 0.6) => {
    if (only && !`${kind}: ${name}`.includes(only)) return;
    await stick(0, 0);
    await look(0, 0, 0);
    await page.evaluate(([x, z, turned]) => {
      const app = window.__qa.app;
      window.__qa.teleport(x, z);
      app.rig.yaw = turned;
      app.rig.pitch = -0.12;
    }, [...at, yaw]);
    await wait(700);
    await page.evaluate(() => { const r = window.__qa.app.rig.__rec; r.rows = []; r.on = true; });
    await run();
    const rows = await page.evaluate(() => { const r = window.__qa.app.rig.__rec; r.on = false; return r.rows; });
    if (shotsDir) await page.screenshot({ path: `${shotsDir}/${kind}-${name.replace(/[^a-z]+/gi, '-')}.png` });
    await stick(0, 0);
    await look(0, 0, 0);
    await hold('l3', false);
    const a = analyse(rows);
    report[`${kind}: ${name}`] = a;
    check(a.pop <= POP_LIMIT && a.turnPop <= TURN_POP_LIMIT, `${kind}: ${name}`, `${a.frames} frames, worst pop ${(a.pop * 100).toFixed(1)} cm, worst turn pop ${a.turnPop.toFixed(2)}°`);
  };

  const sides = async (ms, times) => {
    for (let i = 0; i < times; i++) {
      await stick(i % 2 ? 1 : -1, 0);
      await wait(ms);
    }
  };
  const circle = async (ms) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      const a = ((Date.now() - t0) / 1000) * 2.4;
      await stick(Math.sin(a), -Math.cos(a));
      await wait(16);
    }
  };

  await scenario('run forward', async () => { await stick(0, -1); await wait(2500); });
  await scenario('run side to side', async () => { await sides(600, 6); });
  await scenario('quick side steps', async () => { await sides(180, 14); });
  await scenario('run in circles', async () => { await circle(4000); });
  await scenario('run back at the camera', async () => { await stick(0, 1); await wait(2000); });
  await scenario('sprint forward and side to side', async () => {
    await stick(0, -1);
    await press('l3');
    await wait(1200);
    await sides(500, 6);
  });
  await scenario('run while turning the view', async () => { await stick(0, -1); await look(0.7, 0); await wait(2500); await look(-0.7, 0.3); await wait(1500); });
  await scenario('side to side while looking up and down', async () => {
    await look(0, -0.5);
    await sides(500, 3);
    await look(0, 0.5);
    await sides(500, 4);
  });
  await scenario('run and jump', async () => {
    await stick(0, -1);
    for (let i = 0; i < 3; i++) { await wait(500); await press('a'); await wait(600); }
  });
  await scenario('side to side and jump', async () => {
    for (let i = 0; i < 4; i++) { await stick(i % 2 ? 1 : -1, 0); await wait(300); await press('a'); await wait(500); }
  });
  await scenario('run and dodge', async () => {
    await stick(0, -1);
    for (let i = 0; i < 3; i++) { await wait(500); await press('b'); await wait(500); }
  });
  await scenario('start and stop', async () => {
    for (let i = 0; i < 5; i++) { await stick(i % 2 ? -1 : 0.7, -0.7); await wait(350); await stick(0, 0); await wait(350); }
  });
  await scenario('run over the hill', async () => {
    await stick(0, -1);
    await press('l3');
    await wait(6000);
  }, [104, 175], 0);
  await scenario('run across the slope', async () => {
    await stick(1, 0);
    await wait(2500);
    await stick(-1, 0);
    await wait(2500);
  }, [104, 190], 0);

  // A hedge 2 m high and 2 m through runs along z = 195 to 197: the camera looks over it, and its
  // boom skims the ragged top. That used to snap the camera 2.8 m in and out.
  await scenario('run side to side with a hedge behind', async () => {
    await sides(600, 6);
  }, [119.2, 197.8], 0);
  await scenario('turn the view with a hedge behind', async () => {
    await look(-0.6, 0);
    await wait(1500);
    await look(0.6, 0);
    await wait(2500);
  }, [120.3, 197.8], -0.8);
  // The orchard camp's grunts stand around (150, 190).
  await scenario('lock on and let go', async () => {
    await stick(1, 0);
    await wait(300);
    await press('r3');
    await wait(900);
    await stick(-1, 0);
    await wait(600);
    await press('r3');
    await wait(700);
  }, [141, 186], 0.3);

  if (kind === 'gun') {
    const mode = () => page.evaluate(() => window.__qa.app.rig.mode);
    check((await mode()) === 'ots', 'a gun in hand uses the shoulder camera');
    await scenario('zoom in and out while running', async () => {
      await stick(0, -1);
      for (let i = 0; i < 4; i++) { await wait(500); await press('lt'); }
      await wait(500);
    });
    await scenario('zoom in and out while running side to side', async () => {
      for (let i = 0; i < 6; i++) { await stick(i % 2 ? 1 : -1, 0); await wait(350); await press('lt'); await wait(250); }
    });
    await scenario('zoomed: run side to side', async () => {
      await press('lt');
      await wait(500);
      await sides(600, 6);
      await press('lt');
    });
    await scenario('zoomed: run in circles and turn', async () => {
      await press('lt');
      await wait(500);
      await look(0.5, 0);
      await circle(3500);
      await press('lt');
    });
    await scenario('zoomed: run and jump', async () => {
      await press('lt');
      await stick(-1, -0.3);
      for (let i = 0; i < 3; i++) { await wait(500); await press('a'); await wait(600); }
      await press('lt');
    });
    await scenario('fire while running side to side', async () => {
      await hold('rt', true);
      await sides(500, 6);
      await hold('rt', false);
    });
  }
  await page.close();
}

try {
  await play('staff');
  await play('gun');
  check(errors.length === 0, 'no console or page errors', errors.join('\n'));
} finally {
  if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
  await browser.close();
  await server.close();
}

if (failures > 0) process.exit(1);
console.log('camera e2e: ok');
