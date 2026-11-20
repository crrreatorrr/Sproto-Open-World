/**
 * M4 on the real baked world, pad only (teleports are the QA cheat): every camp's members stand on
 * the terrain and are drawn when you arrive, enemies far away are not drawn, the draw-call budget
 * holds at the busiest camps, and the Watchtower beacon can be lit from the ground.
 *
 *   node tests/e2e/camps.mjs [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });
const DRAW_CALLS = 200;
/** How far above or below the terrain a settled enemy may stand (m; wisps hover, props are kept off). */
const GROUND_SLACK = 1.5;

const server = await createServer({ server: { port: 5196, strictPort: false, hmr: false }, logLevel: 'error' });
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

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
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
async function teleport(x, z) {
  // This tour visits every camp in a row: keep the player healthy (QA cheat), it isn't about the fights.
  await page.evaluate(([a, b]) => {
    const v = window.__qa.app.sim.playerEntity(0).vitals;
    v.hp = v.hpMax;
    window.__qa.teleport(a, b);
  }, [x, z]);
  await frames(2);
  await page.waitForFunction(() => {
    const s = window.__qa.state();
    return s.state === 'playing' && !s.groundWait && !s.waitingForGround;
  }, null, { timeout: 60000, polling: 'raf' });
  await frames(8);
}
const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });

/** Camp centres (from src/content/world/sproutvaleContent.ts), with how many members each has. */
const CAMPS = [
  ['orchard_south', 70, 100, 4], ['orchard_scarecrow', 150, 190, 5], ['orchard_west', 55, 215, 5],
  ['millrun_west', 380, 186, 5], ['millrun_east', 452, 162, 5], ['mill_yard', 446, 236, 3],
  ['watchtower_squad', 256, 240, 5], ['thorn_wisp_a', 200, 296, 1], ['thorn_wisp_b', 340, 285, 1],
  ['thorn_patrol_a', 90, 330, 3], ['thorn_patrol_b', 300, 330, 3], ['thorn_patrol_c', 360, 380, 3],
  ['thorn_veterans', 140, 440, 3], ['thorn_perch_west', 130, 280, 2], ['thorn_perch_far', 50, 395, 2],
  ['thornwood_clearing', 222, 384, 1], ['quarry_ravine', 300, 402, 4],
];

try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 60000 });
  await press('down');
  await press('a');
  // The class picker comes next on a new save: A takes the focused Wizard.
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 30000 });
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 60000 });
  await frames(20);

  let s = await state();
  const farAtStart = s.enemies.filter((e) => Math.hypot(e.pos.x - s.player.pos.x, e.pos.z - s.player.pos.z) > 160);
  check(farAtStart.length > 30 && farAtStart.every((e) => !e.viewShown), 'enemies far from the village are not drawn', `${farAtStart.length} far away`);

  for (const [id, x, z, count] of CAMPS) {
    // Stand 14 m south of the camp: inside view range, and clear of its members.
    await teleport(x, z - 14);
    await frames(30);
    s = await state();
    check(s.player.action !== 'dead' && Math.hypot(s.player.pos.x - x, s.player.pos.z - z) < 40, `${id}: the player is at the camp`, `${s.player.pos.x.toFixed(0)}, ${s.player.pos.z.toFixed(0)}`);
    // The Skyfire Drake waits unseen high above the Orchard until its bait is set.
    const near = s.enemies.filter((e) => Math.hypot(e.pos.x - x, e.pos.z - z) < 50 && e.def !== 'dummy_straw' && e.def !== 'dummy_swing' && e.def !== 'skyfire_drake');
    const heights = await page.evaluate((list) => list.map((e) => window.__qa.app.stream.heightAt(e.pos.x, e.pos.z)), near);
    const off = near.filter((e, i) => heights[i] === null || Math.abs(e.pos.y - heights[i]) > GROUND_SLACK + (e.def === 'wisp' ? 1 : 0));
    check(near.length >= count, `${id}: its ${count} enemies are there`, `${near.length} within 50 m`);
    check(off.length === 0, `${id}: every enemy stands on the terrain`, off.map((e) => `${e.def} y ${e.pos.y.toFixed(1)}`).join(', '));
    check(near.every((e) => e.viewShown), `${id}: every enemy is drawn`, near.filter((e) => !e.viewShown).map((e) => e.def).join(','));
    check(s.drawCalls <= DRAW_CALLS, `${id}: draw calls ≤ ${DRAW_CALLS}`, String(s.drawCalls));
    await shot(`camp-${id}`);
  }

  // The Watchtower beacon stands on its prop: lit from the ground, with Y. This spot is 2 m south of
  // it (objects reach 2.4 m). A Slinger close by can knock the player back or flinch them through
  // the press, so each try starts again from the spot.
  let offered = false, lit = false;
  for (let i = 0; i < 6 && !lit; i++) {
    await teleport(256, 268);
    s = await state();
    if (s.interact?.id !== 'watchtower_beacon') continue;
    offered = true;
    await press('y');
    await frames(10);
    s = await state();
    lit = s.objects.find((o) => o.id === 'watchtower_beacon')?.used === true;
  }
  check(offered, 'the beacon offers its prompt from the ground', offered ? '' : JSON.stringify(s.interact));
  check(lit, 'Y lights the beacon');
  await shot('beacon-lit');

  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err}`);
  await shot('camps-failure');
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `camps: ${failures} failure(s)` : 'camps: all checks passed');
process.exit(failures ? 1 : 0);
