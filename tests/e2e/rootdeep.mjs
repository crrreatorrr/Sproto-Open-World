/**
 * Rootdeep Quest 7: one pad-only run of the cave (plan Quest 7). Boots its own Vite server, installs
 * the simulated pad before navigation, and asserts, in order:
 *
 *   1. A fresh save at hedge_north has no interact target and an empty prompt (the door is sealed).
 *   2. With rootdeep.door.revealed set, Y goes through, the veil lifts, and the player is on the
 *      cave floor (x >= 4096, |y| < 0.5) with __qa.state().cave true.
 *   3. View opens Quests and RB opens the Map on the cave picture, with Lantern Hall and the vault
 *      labelled, and no quest pin.
 *   4. Y at the Lantern Hall shrine, then A on Rest, autosaves. Reload, Down, A on Continue wakes
 *      on the cave floor at shrine_rootdeep_lantern with cave still true.
 *   5. On foot, Y at rd_cave_hedge_south comes out near (54.8, 132) with cave false, and the bull
 *      (kind mount) is still on the surface (x < 4096). Resting in the cave must not move it.
 *   6. Y on chest_rootdeep_vault, then the Gear tab by pad, A equips Rootcleaver in Lantern Hall
 *      once gearLocked is false. equipment.staff is staff_rootcleaver and staffMounted is true.
 *
 * Teleport is the QA cheat. The door flag is a localStorage edit of the save the sim would write
 * (`toSave`), then Continue loads it. Every interaction is a pad press.
 *
 *   node tests/e2e/rootdeep.mjs [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const RD_X = 4096;
const DOOR = [79.1, 226.4];
const SURFACE_SOUTH = [54.8, 132];
/** Gear sits here. Relics is between Gear and Quests, so Quests takes two LB, not one. */
const TABS = ['powers', 'skills', 'gear', 'relics', 'quests', 'map', 'settings'];

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

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const state = () => page.evaluate(() => window.__qa.state());
const shot = async (name) => shots && page.screenshot({ path: `${shots}/${name}.png` });
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}
let failures = 0;
function check(ok, what, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

/** Put the player on the ground at (x, z). A debug cheat, the same one camps.mjs uses. */
async function teleport(x, z) {
  await page.evaluate(([a, b]) => window.__qa.teleport(a, b), [x, z]);
  await frames(2);
  await page.waitForFunction(() => {
    const s = window.__qa.state();
    return s.state === 'playing' && !s.groundWait && !s.waitingForGround;
  }, null, { timeout: 90000, polling: 'raf' });
  await frames(8);
}

const bullX = () => page.evaluate(() => {
  const b = window.__qa.app.sim.entities.find((e) => e.kind === 'mount');
  return b ? b.tf.pos.x : null;
});

/** Where a placed thing stands (x, z), from the sim's place table. */
const place = (id) => page.evaluate((name) => {
  const at = window.__qa.app.sim.locate(name);
  return at ? { x: at.x, z: at.z } : null;
}, id);

/**
 * The door flag, as a save edit. Continue is what loads it: syncPortals reads the world the save
 * restored, not a flag poked into the session we were already playing.
 */
async function saveWithDoorRevealed() {
  await page.evaluate(() => {
    const save = window.__qa.app.sim.toSave({ savedAt: new Date().toISOString(), build: 'e2e', region: 'sproutvale' });
    save.world.flags['rootdeep.door.revealed'] = 1;
    localStorage.setItem('sow.save', JSON.stringify(save));
  });
}

/** Title → playing. `down` wakes the pad (that press is swallowed); A confirms the focused row. */
async function leaveTitle(which) {
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 180000 });
  await press('down');
  const s = await state();
  check(s.focused === which, `the title offers ${which}`, JSON.stringify(s.focused));
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 180000 });
  await frames(12);
}

/** Stand on `id` and press Y once it is the interact target. */
async function pressYOn(id, x, z) {
  let s = await state();
  for (let i = 0; i < 6 && s.interact?.id !== id; i++) {
    await teleport(x, z);
    s = await state();
    if (s.player?.action === 'dead') break;
    if (s.interact?.id === id) break;
    await frames(10);
  }
  check(s.interact?.id === id, `${id} offers itself`, JSON.stringify(s.interact));
  if (s.interact?.id === id) await press('y');
  return state();
}

/** LB / RB from whatever tab Start remembered, onto Gear. */
async function openGear() {
  await press('start');
  await frames(8);
  let s = await state();
  check(s.screen === 'screen-menu', 'Start opens the menu', `${s.state} ${s.screen} ${s.menuTab}`);
  const from = TABS.indexOf(s.menuTab);
  const gear = TABS.indexOf('gear');
  const forward = (gear - from + TABS.length) % TABS.length;
  const back = (from - gear + TABS.length) % TABS.length;
  const steps = Math.min(forward, back);
  const button = forward <= back ? 'rb' : 'lb';
  for (let i = 0; i < steps; i++) await press(button);
  await frames(8);
  s = await state();
  check(s.menuTab === 'gear', `pad reaches Gear from ${TABS[from]}`, s.menuTab);
  return s;
}

try {
  await page.goto(server.resolvedUrls.local[0]);
  await leaveTitle('Play');

  // 1. Sealed door on a fresh save.
  await teleport(DOOR[0], DOOR[1]);
  let s = await state();
  check(s.interact === null, 'a sealed door has no interact target', JSON.stringify(s.interact));
  check(s.prompt == null || s.prompt === '', 'a sealed door has an empty prompt', JSON.stringify(s.prompt));
  await shot('01-sealed');

  // 2. The revealed flag lives in the save. Continue loads it, then Y walks through.
  await saveWithDoorRevealed();
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await leaveTitle('Continue');
  await pressYOn('rd_surface_hedge_north', DOOR[0], DOOR[1]);
  await page.waitForFunction(() => {
    const q = window.__qa.state();
    const veil = document.querySelector('.veil')?.classList.contains('active') ?? false;
    const p = q.player?.pos;
    return q.state === 'playing' && !q.groundWait && !q.waitingForGround && !veil
      && !!p && p.x >= 4096 && Math.abs(p.y) < 0.5 && q.cave === true;
  }, null, { timeout: 90000, polling: 'raf' });
  s = await state();
  check(s.player.pos.x >= RD_X && Math.abs(s.player.pos.y) < 0.5, 'Y lands on the cave floor', `x ${s.player.pos.x.toFixed(1)} y ${s.player.pos.y.toFixed(2)}`);
  check(s.cave === true, 'the cave look is on', String(s.cave));
  const veilUp = await page.evaluate(() => document.querySelector('.veil')?.classList.contains('active') ?? false);
  check(!veilUp, 'the loading veil has lifted');
  await shot('02-cave');

  // 3. View → Quests, RB → Map. Cave picture and labels, never a quest pin.
  await press('back');
  await frames(8);
  s = await state();
  check(s.screen === 'screen-menu' && s.menuTab === 'quests', 'View opens Quests', `${s.screen} ${s.menuTab}`);
  await press('rb');
  await frames(8);
  s = await state();
  check(s.menuTab === 'map', 'RB opens the Map', s.menuTab);
  const map = await page.evaluate(() => {
    const img = document.querySelector('.map-image');
    return {
      src: img?.getAttribute('src') ?? '',
      alt: img?.alt ?? '',
      labels: [...document.querySelectorAll('.map-region')].map((e) => e.textContent ?? ''),
      questPin: !!document.querySelector('.map-pin.quest'),
    };
  });
  check(map.src.includes('world/rootdeep/map.webp'), 'the map picture is the cave', map.src);
  check(map.labels.includes('Lantern Hall') && map.labels.includes('Vault'), 'the cave labels name Lantern Hall and the vault', map.labels.join(', '));
  check(!map.questPin, 'a sealed entrance is not a quest pin', String(map.questPin));
  await shot('03-map');
  await press('start');
  await frames(8);
  s = await state();
  check(s.state === 'playing', 'Start closes the map', s.state);

  // 4. Rest at Lantern Hall, then Continue comes back to that floor.
  const shrine = await place('shrine_rootdeep_lantern');
  if (!shrine) throw new Error('shrine_rootdeep_lantern is not placed');
  const bullBefore = await bullX();
  await teleport(shrine.x, shrine.z);
  s = await state();
  check(s.interact?.id === 'shrine_rootdeep_lantern', 'the Lantern Hall shrine offers Rest', JSON.stringify(s.interact));
  const savesBefore = s.saves;
  await press('y');
  await frames(10);
  s = await state();
  check(s.screen === 'screen-shrine' && s.focused === 'Rest', 'Y opens the shrine menu on Rest', `${s.screen} ${JSON.stringify(s.focused)}`);
  await press('a');
  s = await state();
  for (let i = 0; i < 40 && s.saves <= savesBefore; i++) {
    await frames(4);
    s = await state();
  }
  check(s.saves > savesBefore, 'resting autosaves', `${savesBefore} → ${s.saves}`);
  check(s.rpg?.lastShrine === 'shrine_rootdeep_lantern', 'the rest sets the Lantern Hall shrine', JSON.stringify(s.rpg?.lastShrine));
  const bullAfterRest = await bullX();
  check(bullBefore != null && bullAfterRest != null && bullAfterRest < RD_X, 'a cave rest leaves the bull on the surface', `before ${bullBefore} after ${bullAfterRest}`);
  await shot('04-rest');

  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await leaveTitle('Continue');
  s = await state();
  check(s.player.pos.x >= RD_X && Math.abs(s.player.pos.y) < 0.5, 'Continue wakes on the cave floor', `x ${s.player.pos.x.toFixed(1)} y ${s.player.pos.y.toFixed(2)}`);
  check(s.rpg?.lastShrine === 'shrine_rootdeep_lantern', 'Continue keeps the Lantern Hall shrine', JSON.stringify(s.rpg?.lastShrine));
  check(s.cave === true, 'Continue is still in the cave', String(s.cave));
  await shot('04-continue');

  // 5. Out the south mouth, on foot. The bull stays west of the cave.
  const south = await place('rd_cave_hedge_south');
  if (!south) throw new Error('rd_cave_hedge_south is not placed');
  s = await state();
  check(s.player.riding == null, 'the exit is taken on foot', JSON.stringify(s.player.riding));
  await pressYOn('rd_cave_hedge_south', south.x, south.z);
  await page.waitForFunction(() => {
    const q = window.__qa.state();
    const veil = document.querySelector('.veil')?.classList.contains('active') ?? false;
    return q.state === 'playing' && !q.groundWait && !q.waitingForGround && !veil && q.cave === false;
  }, null, { timeout: 90000, polling: 'raf' });
  s = await state();
  const out = Math.hypot(s.player.pos.x - SURFACE_SOUTH[0], s.player.pos.z - SURFACE_SOUTH[1]);
  check(s.cave === false && out < 4, 'Y comes out by the south hedge', `cave ${s.cave}, ${out.toFixed(2)} m from (54.8, 132), at ${s.player.pos.x.toFixed(1)}, ${s.player.pos.z.toFixed(1)}`);
  const bullOut = await bullX();
  check(bullOut != null && bullOut < RD_X, 'the bull is not underground', String(bullOut));
  await shot('05-surface');

  // 6. The vault chest, then equip in Lantern Hall where gear is not locked.
  const chest = await place('chest_rootdeep_vault');
  if (!chest) throw new Error('chest_rootdeep_vault is not placed');
  await pressYOn('chest_rootdeep_vault', chest.x, chest.z);
  let got = false;
  for (let i = 0; i < 40 && !got; i++) {
    await frames(4);
    s = await state();
    got = (s.rpg?.inventory?.staff_rootcleaver ?? 0) >= 1;
  }
  check(got, 'Y on the vault chest gives Rootcleaver', JSON.stringify(s.rpg?.inventory?.staff_rootcleaver));
  await teleport(shrine.x, shrine.z);
  s = await state();
  for (let i = 0; i < 90 && s.gearLocked; i++) {
    await frames(4);
    s = await state();
  }
  check(s.gearLocked === false, 'Lantern Hall is not gear-locked', String(s.gearLocked));
  check(Math.hypot(s.player.pos.x - shrine.x, s.player.pos.z - shrine.z) < 8, 'equip happens in Lantern Hall', `${s.player.pos.x.toFixed(1)}, ${s.player.pos.z.toFixed(1)}`);
  await openGear();
  s = await state();
  for (let i = 0; i < 8 && !/Rootcleaver/.test(s.focused ?? ''); i++) {
    await press('down');
    s = await state();
  }
  check(/Rootcleaver/.test(s.focused ?? ''), 'A is on Rootcleaver', JSON.stringify(s.focused));
  await press('a');
  s = await state();
  for (let i = 0; i < 20 && s.rpg?.equipment?.staff !== 'staff_rootcleaver'; i++) {
    await frames(4);
    s = await state();
  }
  check(s.rpg?.equipment?.staff === 'staff_rootcleaver', 'A equips Rootcleaver', JSON.stringify(s.rpg?.equipment?.staff));
  // The menu pauses the frame loop, so the view mounts the sword once Start returns to play.
  await press('start');
  let mounted = false;
  for (let i = 0; i < 80 && !mounted; i++) {
    await frames(4);
    s = await state();
    mounted = s.staffMounted === true && s.rpg?.equipment?.staff === 'staff_rootcleaver';
  }
  check(s.rpg?.equipment?.staff === 'staff_rootcleaver' && s.staffMounted === true, 'Rootcleaver is in hand', `staff ${s.rpg?.equipment?.staff} mounted ${s.staffMounted}`);
  await shot('06-rootcleaver');

  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err}`);
  await shot('rootdeep-failure');
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `rootdeep: ${failures} failure(s)` : 'rootdeep: all checks passed');
process.exit(failures ? 1 : 0);
