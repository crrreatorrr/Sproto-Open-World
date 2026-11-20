#!/usr/bin/env node
/**
 * Smoke test (plan §8; M0 and M1a acceptance): boots the game in headless Chromium against the Vite
 * dev server and drives it with a simulated gamepad only:
 *
 *   on the training yard (`?yard=1`; plain `/` is Sproutvale, covered by world.mjs):
 *   title → Settings → Controls → back → back → Play → move, jump → pause → Settings → back → Resume
 *   → N twice on the keyboard (the hub feedback window, keyboard only: 2, Enter sends; again, Esc closes)
 *   → WebGL context lost and restored → walk to a training dummy → RB (light attack)
 *   then, on a fresh page with `?sandbox=1` (the M1b wave runner): Play → the first wave spawns →
 *   walk at the nearest enemy → lock on → LT + X (Arcane Bolt)
 *
 * It asserts the player model, its 18 clips and the staff on socket_staff, that the stick moves
 * the player and A jumps, and that there are no console errors. For M1a (b) it reads the QA log
 * (`__qa.log()`, debug/qaLog.ts): pad press → command in ≤ 1 frame, command → attack pose in ≤ 2
 * frames, and every `hit` with its spark, sound, damage number and hit-stop on the same rendered
 * frame. For M1b it asserts the wave spawns with a view per enemy, and that LT + X casts Bolt: a
 * `castStart` and a `cast` event, the cast on the upper body, mana spent, and the bolt in flight or
 * hitting. Long tasks once playing are
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

const server = await createServer({ server: { port: 5199, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const url = server.resolvedUrls.local[0];

// SMOKE_STRICT_LONGTASKS=1: use the machine's real GPU and assert long tasks (run it on the target laptop).
const strictLongTasks = process.env.SMOKE_STRICT_LONGTASKS === '1';
// Headless Chromium never gets a GPU, so strict mode opens a visible window.
const browser = await chromium.launch(strictLongTasks ? { headless: false } : { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const errors = [];

// A standard-mapping pad the test controls through window.__pad.
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

/** A fresh page with the simulated pad; console errors from every page count. */
async function openPage() {
  const p = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  p.on('pageerror', (e) => errors.push(String(e)));
  await p.addInitScript(padInit);
  return p;
}
let page = await openPage();

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
  // The M1 checks run in the training yard (`?yard=1`); Sproutvale has its own test (world.mjs).
  // `feedbackMock`: the feedback window sends to window.__feedbackSent instead of the hub (dev only).
  await page.goto(`${url}?yard=1&feedbackMock`);
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
  // A new save picks its class first, by pad: down to the Soldier, B back out, in again, then the Wizard.
  s = await state();
  check(s.screen === 'screen-classes', 'A on Play opens the class picker', s.screen);
  const classes = await page.evaluate(() => [...document.querySelectorAll('#screen-classes .class-card')].map((b) => b.dataset.class));
  check(classes.join(',') === 'wizard,soldier,pepe', 'the picker offers the Wizard, the Soldier and Pepe', classes.join(','));
  check(s.focused?.startsWith('Wizard Sproto'), 'the Wizard is focused first', JSON.stringify(s.focused));
  await press('down');
  s = await state();
  check(s.focused?.startsWith('Soldier Sproto'), 'down moves to the Soldier', JSON.stringify(s.focused));
  await shot('02b-classes');
  await press('b');
  s = await state();
  check(s.screen === 'screen-title', 'B backs out of the picker to the title', s.screen);
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 30000 });
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing', null, { timeout: 30000 });
  s = await state();
  check(s.state === 'playing', 'A on the Wizard starts the game');
  check(s.staffMounted === true, 'staff mounted on socket_staff');
  check(s.clips.length === 21 && s.clips.includes('attack_light_1') && s.clips.includes('block'), 'player.glb has all 21 clips', s.clips.join(','));

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

  // The hub feedback window (src/hub/feedback.ts) is keyboard only (owner's call): N twice opens
  // it over play and holds the game, 2 picks an option, Enter sends; again, Esc closes it. The pad
  // does nothing while it is open.
  const waitPanel = (open) => page.waitForFunction((o) => !!document.querySelector('[data-hub-feedback]')?.shadowRoot?.querySelector('.panel') === o, open, { timeout: 15000 }).then(() => true, () => false);
  const nTwice = async () => {
    await page.keyboard.press('KeyN');
    await page.keyboard.press('KeyN');
  };
  check((await page.evaluate(() => window.__qa.app.feedbackLoad)) === true, 'the feedback window is installed');
  await nTwice();
  check(await waitPanel(true), 'N twice opens the feedback window');
  const heldTick = (await state()).tick;
  await press('b');
  await press('start');
  await frames(10);
  const held = await state();
  check(held.feedbackHeld && held.tick === heldTick && held.state === 'playing' && (await waitPanel(true)), 'the window holds the game and the pad does nothing', `held ${held.feedbackHeld}, tick ${heldTick} → ${held.tick}, ${held.state}`);
  await page.keyboard.press('Digit2');
  await shot('05a-feedback');
  await page.keyboard.press('Enter');
  check(await waitPanel(false), 'Enter sends and closes the window');
  const sent = await page.evaluate(() => window.__feedbackSent ?? []);
  const note = sent[0];
  check(sent.length === 1 && JSON.stringify(note.categories) === '["unclear"]', 'the note carries the option picked with 2', JSON.stringify(sent.map((n) => n.categories)));
  check(!!note && note.meta?.mode === 'yard' && !!note.meta?.player && typeof note.image === 'string' && note.image.startsWith('data:image/'), 'the note has the game context and a screenshot', JSON.stringify(note ? { mode: note.meta?.mode, player: !!note.meta?.player, image: String(note.image).slice(0, 16) } : null));
  s = await state();
  check(!s.feedbackHeld && s.state === 'playing', 'closing the window goes back to play', `${s.feedbackHeld} ${s.state}`);
  await nTwice();
  check(await waitPanel(true), 'the window opens again');
  await page.keyboard.press('Escape');
  check(await waitPanel(false), 'Esc closes the window');
  s = await state();
  check((await page.evaluate(() => (window.__feedbackSent ?? []).length)) === 1 && s.state === 'playing', 'Esc sends nothing and does not pause the game', s.state);
  // Back to the pad for the rest of the run.
  await press('down');

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

  // M1a (b): walk to a training dummy and hit it with RB, gamepad only, then read the QA log.
  await frames(10);
  s = await state();
  const dummy = s.enemies.find((e) => e.def === 'dummy_passive') ?? s.enemies.find((e) => e.model === 'dummy');
  check(!!dummy, 'the sandbox has a training dummy', JSON.stringify(s.enemies));
  check(s.enemies.length > 0 && s.enemies.every((e) => e.viewShown), 'every enemy has a view', JSON.stringify(s.enemies.map((e) => [e.def, e.viewShown])));
  if (dummy) {
    // Steer with the left stick in camera space (x right, y forward; the pad's y axis points down).
    let dist = Infinity;
    for (let i = 0; i < 150; i++) {
      s = await state();
      const d = s.enemies.find((e) => e.id === dummy.id).pos;
      const wx = d.x - s.player.pos.x, wz = d.z - s.player.pos.z;
      dist = Math.hypot(wx, wz);
      if (dist < 1.8) break;
      const sy = Math.sin(s.camYaw), cy = Math.cos(s.camYaw);
      const mx = (-cy * wx + sy * wz) / dist, my = (sy * wx + cy * wz) / dist;
      await page.evaluate(([x, y]) => window.__pad.axes(x, y), [mx, -my]);
      await frames(3);
    }
    await page.evaluate(() => window.__pad.axes(0, 0));
    await frames(30);
    check(dist < 1.8, 'walks up to a training dummy', `${dist.toFixed(2)} m away`);
    await shot('05-at-dummy');

    await page.evaluate(() => window.__qa.log(true));
    // Push the stick at the dummy while swinging: a swing goes where the stick points.
    s = await state();
    {
      const d = s.enemies.find((e) => e.id === dummy.id).pos;
      const wx = d.x - s.player.pos.x, wz = d.z - s.player.pos.z, l = Math.hypot(wx, wz);
      const sy = Math.sin(s.camYaw), cy = Math.cos(s.camYaw);
      await page.evaluate(([x, y]) => window.__pad.axes(x, y), [(-cy * wx + sy * wz) / l, -(sy * wx + cy * wz) / l]);
    }
    await page.evaluate(() => window.__pad.set('rb', true));
    await frames(3);
    await page.evaluate(() => window.__pad.set('rb', false));
    await page.evaluate(() => window.__pad.axes(0, 0));
    await frames(12);
    await shot('06-light-attack');
    await frames(60);
    const log = await page.evaluate(() => window.__qa.log());
    const press = log.find((e) => e.kind === 'press' && e.what === 'light');
    const cmd = press && log.find((e) => e.kind === 'command' && e.what === 'light' && e.frame >= press.frame);
    const pose = cmd && log.find((e) => e.kind === 'pose' && e.frame >= cmd.frame);
    const fmt = (e) => (e ? `frame ${e.frame}${e.tick !== undefined ? ` tick ${e.tick}` : ''}` : 'missing');
    check(!!press && !!cmd && cmd.frame - press.frame <= 1, 'RB press → command in ≤ 1 frame', `press ${fmt(press)}, command ${fmt(cmd)}`);
    check(!!cmd && !!pose && pose.frame - cmd.frame <= 2, 'command → attack pose in ≤ 2 frames', `command ${fmt(cmd)}, pose ${fmt(pose)}`);
    const hits = log.filter((e) => e.kind === 'hit');
    check(hits.length > 0, 'the light attack hits the dummy', `${hits.length} hits`);
    const reactions = ['spark', 'sound', 'number', 'hitstop'];
    const missing = hits.flatMap((h) => reactions.filter((k) => !log.some((e) => e.kind === k && e.hit === h.hit && e.frame === h.frame)).map((k) => `hit ${h.hit}: ${k}`));
    check(hits.length > 0 && missing.length === 0, 'every hit has spark, sound, damage number and hit-stop on its frame', missing.join(', '));
    s = await state();
    const hp = s.enemies.find((e) => e.id === dummy.id).hp;
    check(hp !== null && hp < dummy.hp, 'the dummy took damage', `${dummy.hp} → ${hp}`);
  }

  // M1b: the wave runner on a fresh page, gamepad only. Play, wait for the first wave, close in on
  // the nearest enemy, lock on with R3 and cast Arcane Bolt with LT + X.
  console.log('  -- wave runner (?sandbox=1)');
  await page.close();
  page = await openPage();
  await page.goto(`${url}?sandbox=1`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 30000 });
  await press('down');
  await press('a');
  // The class picker comes next on a new save: A takes the focused Wizard.
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 30000 });
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing', null, { timeout: 30000 });
  s = await state();
  check(s.sandbox === true && s.wave !== null, '?sandbox=1 starts the wave runner', JSON.stringify(s.wave));
  const spawned = await page
    .waitForFunction(() => window.__qa.state().enemies.length > 0, null, { timeout: 20000 })
    .then(() => true, () => false);
  await frames(10);
  s = await state();
  check(spawned && s.enemies.length >= 5, 'the first wave spawns 5+ enemies', JSON.stringify(s.enemies.map((e) => e.def)));
  check(s.enemies.every((e) => e.viewShown), 'every wave enemy has a view', JSON.stringify(s.enemies.map((e) => [e.def, e.viewShown])));
  check((await page.evaluate(() => window.__qa.log())).some((e) => e.kind === 'wave'), 'a `wave` event announces it');
  await shot('07-wave');
  if (s.enemies.length) {
    // These checks are about the controls, not the fight: left to it, the full wave kills the player
    // or keeps them in hitstun, and more so on a slow runner. Hold the enemies in hit-stop (QA cheat).
    await page.evaluate(() => {
      const sim = window.__qa.app.sim;
      const tick = sim.tick.bind(sim);
      sim.tick = (commands) => {
        for (const e of sim.entities) if (e.brain && e.combat) e.combat.hitstop = 2;
        tick(commands);
      };
    });
    // Steer at the nearest enemy until it's well inside spell range.
    let dist = Infinity;
    for (let i = 0; i < 120; i++) {
      s = await state();
      const me = s.player.pos;
      const near = s.enemies.filter((e) => e.action !== 'dead').sort((a, b) => Math.hypot(a.pos.x - me.x, a.pos.z - me.z) - Math.hypot(b.pos.x - me.x, b.pos.z - me.z))[0];
      if (!near) break;
      const wx = near.pos.x - me.x, wz = near.pos.z - me.z;
      dist = Math.hypot(wx, wz);
      if (dist < 9) break;
      const sy = Math.sin(s.camYaw), cy = Math.cos(s.camYaw);
      const mx = (-cy * wx + sy * wz) / dist, my = (sy * wx + cy * wz) / dist;
      await page.evaluate(([x, y]) => window.__pad.axes(x, y), [mx, -my]);
      await frames(3);
    }
    await page.evaluate(() => window.__pad.axes(0, 0));
    check(dist < 9, 'closes in on an enemy', `${dist.toFixed(2)} m away`);
    // Lock-on acquires in the camera's cone: turn the camera at it with the right stick first
    // (whichever way the stick turns it, the error shrinks; flip if it grows).
    const camErr = (st) => {
      const me = st.player.pos;
      const near = st.enemies.filter((e) => e.action !== 'dead').sort((a, b) => Math.hypot(a.pos.x - me.x, a.pos.z - me.z) - Math.hypot(b.pos.x - me.x, b.pos.z - me.z))[0];
      if (!near) return 0;
      const want = Math.atan2(near.pos.x - me.x, near.pos.z - me.z);
      return Math.atan2(Math.sin(want - st.camYaw), Math.cos(want - st.camYaw));
    };
    let turn = 1;
    let err = camErr(await state());
    for (let i = 0; i < 60 && Math.abs(err) > 0.25; i++) {
      await page.evaluate((x) => window.__pad.look(x, 0), turn * Math.sign(err) * 0.7);
      await frames(2);
      const next = camErr(await state());
      if (Math.abs(next) > Math.abs(err) + 0.01) turn = -turn;
      err = next;
    }
    await page.evaluate(() => window.__pad.look(0, 0));
    await press('r3');
    s = await state();
    check(s.player.lock !== null, 'R3 locks on to a wave enemy', JSON.stringify(s.player.lock));
    await frames(5);

    // A hit cancels a cast (hitstun replaces it), and a shot already in the air can still land, so
    // try a few casts and judge the first that gets through (or the last one, if none does).
    let before = null, inFlight = false, castMana = null, log = [];
    // Watch the sim on every tick: a slow runner runs several ticks per frame, and a bolt that hits
    // something close can come and go between two looks at the page.
    await page.evaluate(() => {
      const sim = window.__qa.app.sim;
      const tick = sim.tick.bind(sim);
      window.__boltSeen = false;
      sim.tick = (commands) => {
        tick(commands);
        if (sim.entities.some((e) => e.projectile?.spell === 'bolt')) window.__boltSeen = true;
      };
    });
    for (let attempt = 0; attempt < 5; attempt++) {
      // Wait until the player is free (not in hitstun or mid-action) before pressing.
      for (let i = 0; i < 60 && (await state()).player.action; i++) await frames(2);
      before = (await state()).player.mana;
      castMana = before;
      inFlight = false;
      await page.evaluate(() => {
        window.__boltSeen = false;
        window.__qa.log(true);
      });
      await page.evaluate(() => window.__pad.set('lt', true));
      await frames(3);
      await press('x');
      await page.evaluate(() => window.__pad.set('lt', false));
      // Watch for the bolt in flight (or its hit) for up to ~2 s of frames.
      for (let i = 0; i < 40; i++) {
        const st = await state();
        castMana = Math.min(castMana, st.player.mana ?? Infinity);
        if (st.projectiles.some((p) => p.spell === 'bolt')) inFlight = true;
        const lg = await page.evaluate(() => window.__qa.log());
        if (inFlight && lg.some((e) => e.kind === 'cast')) break;
        if (lg.some((e) => e.kind === 'hit' && e.what === 'bolt')) break;
        await frames(2);
      }
      log = await page.evaluate(() => window.__qa.log());
      // On a slow runner the release can land at the very end of that window: keep watching the bolt.
      for (let i = 0; i < 40 && !inFlight && log.some((e) => e.kind === 'cast' && e.what === 'bolt') && !log.some((e) => e.kind === 'hit' && e.what === 'bolt'); i++) {
        await frames(1);
        if ((await state()).projectiles.some((p) => p.spell === 'bolt')) inFlight = true;
        log = await page.evaluate(() => window.__qa.log());
      }
      inFlight ||= await page.evaluate(() => window.__boltSeen);
      if (log.some((e) => e.kind === 'cast' && e.what === 'bolt')) break;
      console.log(`  info cast attempt ${attempt + 1} was cut off (${log.filter((e) => e.kind === 'hit').length} hits on the way); retrying`);
    }
    await shot('08-bolt');
    const started = log.find((e) => e.kind === 'castStart' && e.what === 'bolt');
    check(!!started, 'LT + X starts an Arcane Bolt cast', JSON.stringify(log.filter((e) => ['castStart', 'noMana', 'cooldown'].includes(e.kind))));
    check(log.some((e) => e.kind === 'castPose' && e.what === 'bolt'), 'the cast shows on the upper body');
    check(log.some((e) => e.kind === 'cast' && e.what === 'bolt'), 'the Bolt releases (a `cast` event)');
    check(before !== null && castMana <= before - 4, 'the cast spends mana', `${before} → ${castMana}`);
    const boltHit = log.some((e) => e.kind === 'hit' && e.what === 'bolt');
    check(inFlight || boltHit, 'the bolt flies or hits', `in flight ${inFlight}, hit ${boltHit}`);
    const bar = await page.evaluate(() => document.querySelectorAll('.spell-bar.active .spell').length);
    check(bar === 4, 'the HUD shows the four-slot spell bar', `${bar} slots`);
  }

  // Return to Hub (src/hub/link.ts), pad only: with no hub session the title's last button still
  // leaves for the plaza, at this game's ring (`#from=sproto-open-world`).
  console.log('  -- return to hub');
  await page.close();
  page = await openPage();
  await page.goto(`${url}?yard=1`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 30000 });
  s = await state();
  check(s.save?.owner === 'device', 'standalone play keeps the browser save', JSON.stringify(s.save));
  check(await page.evaluate(() => document.querySelector('.hub-chip')?.dataset.hub === 'offline'), 'the title shows the hub chip, not signed in');
  await press('down');
  await press('down');
  await press('down');
  s = await state();
  check(s.focused === 'Return to Hub', 'the D-pad reaches Return to Hub', JSON.stringify(s.focused));
  const left = page.waitForURL(/\/hub\/#from=sproto-open-world$/, { timeout: 10000 }).then(() => true, () => false);
  // The page navigates away during the press.
  await press('a').catch(() => {});
  check(await left, 'A on Return to Hub opens /hub/#from=sproto-open-world', page.url());

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
