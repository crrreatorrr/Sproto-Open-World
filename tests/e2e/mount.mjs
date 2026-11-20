/**
 * The Pepe Bull on the real world, pad only (a teleport is the only cheat): ride up with Y, run, swing
 * with RB, cast with LT + X, fly with three taps of A, and get down with Y.
 *
 *   node tests/e2e/mount.mjs [--shots dir] [--class wizard|soldier|pepe]
 *
 * `--class` rides as another class (the picker's order): a gun class shoots Gunfire from LT + X.
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const CLASS = args.includes('--class') ? args[args.indexOf('--class') + 1] : 'wizard';
const CLASS_ORDER = ['wizard', 'soldier', 'pepe'];
if (!CLASS_ORDER.includes(CLASS)) throw new Error(`--class must be one of ${CLASS_ORDER.join(', ')}`);
/** What slot 1 casts for the class. */
const SLOT1 = CLASS === 'wizard' ? 'bolt' : 'gunfire';

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
/**
 * Note the rider's state on every rendered frame. The game runs at most 5 ticks a frame, so on a slow
 * software GPU climbing on or off lasts about 8 frames and can pass between two polls of `until`.
 */
const watchRiding = () => page.evaluate(() => {
  window.__ridingSeen = new Set();
  const look = () => {
    const p = window.__qa.app.sim.playerEntity(0);
    if (p?.riding) window.__ridingSeen.add(`${p.riding.state}/${p.combat?.action?.kind ?? 'none'}`);
    requestAnimationFrame(look);
  };
  requestAnimationFrame(look);
});
async function sawRiding(state, maxFrames = 600) {
  for (let i = 0; i < maxFrames; i += 3) {
    if (await page.evaluate((k) => window.__ridingSeen.has(k), state)) return true;
    await frames(3);
  }
  return false;
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
  // The class picker comes next on a new save: down to the class asked for, then A.
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 30000 });
  for (let i = 0; i < CLASS_ORDER.indexOf(CLASS); i++) await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 180000 });
  const picked = await page.evaluate(() => window.__qa.app.sim.playerEntity(0).progress.class ?? 'wizard');
  check(picked === CLASS, `the picker made a ${CLASS}`, picked);
  await frames(30);
  await watchRiding();

  // The bull is solid: running straight at its flank stops at its side. It stands long along X here.
  await page.evaluate(() => window.__qa.teleport(272, 52));
  await frames(30);
  for (let i = 0; i < 60; i++) {
    const q = await state();
    if (q.player.pos.z > 58.5) break;
    const sy = Math.sin(q.camYaw), cy = Math.cos(q.camYaw);
    await page.evaluate(([x, y]) => window.__pad.axes(x, y), [sy, -cy]);
    await frames(3);
  }
  await page.evaluate(() => window.__pad.axes(0, 0));
  await frames(10);
  const blocked = (await state()).player.pos.z;
  check(blocked > 56.5 && blocked < 57.4, 'a runner stops at the bull\'s side', `z ${blocked.toFixed(2)}, the bull is at 58`);

  // Walk up to the bull, east of the start.
  await page.evaluate(() => window.__qa.teleport(272, 55.6));
  await frames(40);
  let s = await until((q) => /Ride Pepe Bull/.test(q.prompt ?? ''), 'the ride prompt');
  check(/Ride Pepe Bull/.test(s.prompt), 'the bull offers a ride', s.prompt);
  await shot('b1-prompt');

  await press('y');
  check(await sawRiding('mounting/mounting'), 'Y starts climbing on');
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
  // Wait on the speed, not a frame count: a slow software GPU covers many metres per rendered frame.
  await until((q) => q.player.speed > 8.5 && q.player.speed < 10, 'trotting again', 900);
  await frames(4);
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
  check(s.player.riding === 'riding', `RB swings the ${CLASS === 'wizard' ? 'staff' : 'gun'} from the saddle`);
  await shot('b5-melee');
  s = await until((q) => q.player.action === null, 'the swing ending');
  check(Math.hypot(s.player.pos.x - z0.x, s.player.pos.z - z0.z) > 1, 'the bull kept moving through the swing');

  await page.evaluate(() => window.__qa.log(true));
  await page.evaluate(() => window.__pad.set('lt', true));
  await frames(3);
  await page.evaluate(() => window.__pad.set('x', true));
  await waitLog('cast', SLOT1, 'a cast');
  await page.evaluate(() => { window.__pad.set('x', false); window.__pad.set('lt', false); });
  s = await state();
  check(s.player.riding === 'riding', `LT + X ${CLASS === 'wizard' ? 'casts' : 'shoots'} from the saddle`);
  await shot('b6-cast');
  await until((q) => q.player.action === null, 'the cast ending');

  // Flight: three quick taps of A take off, the stick flies it like a plane (back climbs, forward
  // dives), and touching down lands it, still in the saddle. One frame down and one up per tap, so
  // even a slow software GPU's frames fit three taps in the window.
  await backToBull();
  const flying = () => page.evaluate(() => !!window.__qa.app.sim.playerEntity(0).riding?.flight);
  const height = () => page.evaluate(() => window.__qa.app.sim.playerEntity(0).tf.pos.y);
  const ground = await height();
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => window.__pad.set('a', true));
    await frames(1);
    await page.evaluate(() => window.__pad.set('a', false));
    await frames(1);
  }
  await frames(2);
  check(await flying(), 'three quick taps of A take off');
  await page.evaluate(() => window.__pad.axes(0, 1));
  for (let i = 0; i < 300 && (await height()) < ground + 8; i += 3) await frames(3);
  check((await height()) > ground + 8 && (await flying()), 'the stick back climbs', `${((await height()) - ground).toFixed(1)} m up`);
  await shot('b6b-flying');
  await page.evaluate(() => window.__pad.axes(0, -1));
  for (let i = 0; i < 900 && (await flying()); i += 3) await frames(3);
  s = await state();
  check(!(await flying()) && s.player.riding === 'riding', 'the stick forward dives, and touching down lands it in the saddle', `${((await height()) - ground).toFixed(1)} m`);
  await backToBull();

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
  check(await sawRiding('dismounting/mounting'), 'Y climbs down');
  await frames(8);
  await shot('b7-dismounting');
  s = await until((q) => q.player.riding === null, 'the ground');
  check(s.player.riding === null, 'the player is back on foot');

  // Call the bull with the D-pad. Read every frame: a slow software GPU shows few of them.
  check(/Call bull/.test(await page.evaluate(() => document.body.innerText)), 'the controls bar shows how to call the bull');
  await page.evaluate(() => {
    const sim = window.__qa.app.sim;
    const bull = sim.entities.find((e) => e.mount);
    window.__bull = { top: 0, jump: 0, last: null };
    const look = () => {
      const w = window.__bull, at = bull.tf.pos;
      if (w.last) w.jump = Math.max(w.jump, Math.hypot(at.x - w.last.x, at.z - w.last.z));
      w.last = { x: at.x, z: at.z };
      w.top = Math.max(w.top, bull.mount.speed);
      requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  });
  const bullNow = () => page.evaluate(() => {
    const sim = window.__qa.app.sim, b = sim.entities.find((e) => e.mount), p = sim.playerEntity(0);
    return { x: b.tf.pos.x, z: b.tf.pos.z, away: Math.hypot(b.tf.pos.x - p.tf.pos.x, b.tf.pos.z - p.tf.pos.z), called: !!b.mount.call, speed: b.mount.speed, ...window.__bull };
  });
  const goTo = async (x, z) => {
    await page.evaluate(([a, c]) => {
      const v = window.__qa.app.sim.playerEntity(0).vitals;
      v.hp = v.hpMax;
      window.__qa.teleport(a, c);
    }, [x, z]);
    await frames(2);
    await page.waitForFunction(() => {
      const q = window.__qa.state();
      return q.state === 'playing' && !q.groundWait && !q.waitingForGround;
    }, null, { timeout: 180000, polling: 'raf' });
    await frames(10);
  };
  const arrives = async (what) => {
    for (let i = 0; i < 400; i++) {
      const b = await bullNow();
      if (!b.called && b.away < 4) return b;
      await frames(3);
    }
    throw new Error(`timed out waiting for ${what}`);
  };

  // Near: it runs over the ground, with no jump in position.
  let b = await bullNow();
  const toVillage = Math.atan2(256 - b.x, 58 - b.z);
  await goTo(b.x + Math.sin(toVillage) * 35, b.z + Math.cos(toVillage) * 35);
  await page.evaluate(() => Object.assign(window.__bull, { top: 0, jump: 0, last: null }));
  await press('down');
  b = await arrives('the bull to run over');
  check(b.top > 5, 'D-pad down calls the bull and it runs to the player', `top speed ${b.top.toFixed(1)} m/s, ${b.away.toFixed(1)} m away`);
  check(b.jump < 8, 'it covers the ground without teleporting', `biggest step ${b.jump.toFixed(1)} m`);
  await shot('b9-called');

  // Far: it appears out of sight a short way off and runs in.
  await goTo(420, 60);
  await page.evaluate(() => Object.assign(window.__bull, { top: 0, jump: 0, last: null }));
  b = await bullNow();
  check(b.away > 80, 'the bull is left far behind', `${b.away.toFixed(0)} m away`);
  await press('down');
  let first = await bullNow();
  for (let i = 0; i < 40 && first.away > 40; i++) {
    await frames(2);
    first = await bullNow();
  }
  check(first.away <= 30 && first.away > 4, 'from far away it appears a short way off', `${first.away.toFixed(1)} m away`);
  b = await arrives('the bull to run in');
  check(b.top > 5, 'and runs the rest of the way in', `top speed ${b.top.toFixed(1)} m/s, ${b.away.toFixed(1)} m away`);
  await shot('b10-called-far');
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
