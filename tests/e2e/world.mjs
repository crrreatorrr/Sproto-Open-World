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
 *   node tests/e2e/world.mjs --rpg-only           # just the M3 RPG loop
 *
 * M3 (RPG systems), pad only: talk to Elder Pepe (Y), read the dialogue and accept the quest (A);
 * the tracker and compass marker show it; the menu's Quests tab lists it; the training yard
 * trigger, three straw dummies (RB), the chest (Y) and the seed hand-in advance it; Trader Pepe's
 * shop opens and refuses a purchase you can't afford; the Shrine of First Light's Rest completes it
 * and its Skills entry spends a skill point; the autosave is written. Then the page reloads, Continue
 * is on the title, and the level, XP, skills and quest state come back at the shrine.
 *
 * C1 (the tabbed menu), pad only: Start opens it, LB / RB tour every tab, View opens it on Quests,
 * the Skills tab spends a point, the Powers tab swaps a spell into a slot (it starts on cooldown)
 * and the HUD shows it.
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const arg = (name, def) => (args.includes(name) ? args[args.indexOf(name) + 1] : def);
const shotsDir = arg('--shots', null);
const LAPS = Number(arg('--laps', 3));
/** `--rpg-only`: just Play and the M3 loop (skips the cell-failure, budget and lap sections). */
const RPG_ONLY = args.includes('--rpg-only');
const strict = process.env.SMOKE_STRICT_LONGTASKS === '1';

const BUDGET = { calls: 200, triangles: 900_000 };
const HEAP_TOLERANCE = 0.15;
const STEP_M = 64;
/** Lap corners, 24 m inside the region's edge (the soft wall sits 8 m in). */
const LO = 24, HI = 512 - 24;
const LAP = [[LO, LO], [HI, HI], [HI, LO], [LO, HI], [LO, LO]];
/** The Quarry pillar nearest the lap's diagonal (src/content/packs/m5.ts). */
const QUARRY_PILLAR = [447.4, 444.6];
/** Budget spots (plan §3.5): the hub, the orchard, Thornwood, the quarry. */
const SPOTS = [
  { name: 'Sprout Hollow', x: 256, z: 58 },
  { name: 'Orchard Fields', x: 150, z: 200 },
  // Deep in the trees, out of aggro range of the patrols and the Gatekeeper.
  { name: 'Thornwood', x: 262, z: 365 },
  { name: 'Old Quarry', x: 420, z: 440 },
];

const server = await createServer({ server: { port: 5197, strictPort: false, hmr: false }, logLevel: 'error' });
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
    axes(lx, ly) {
      pad.axes[0] = lx;
      pad.axes[1] = ly;
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
  // The world has camps in it now: the tour stays healthy (QA cheat), it measures streaming, not fights.
  const ok = await page.evaluate(([x, z]) => {
    const v = window.__qa.app.sim?.playerEntity(0)?.vitals;
    if (v) v.hp = v.hpMax;
    return window.__qa.teleport(x, z);
  }, [x, z]);
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
  // A Quarry pillar stands on this stretch of the diagonal: step aside rather than teleport into it.
  for (const pt of pts) {
    if (Math.hypot(pt[0] - QUARRY_PILLAR[0], pt[1] - QUARRY_PILLAR[1]) < 6) pt.splice(0, 2, pt[0] - 8, pt[1] - 8);
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------
// M3: the RPG loop, pad only (teleports are the QA cheat; everything else is buttons and sticks).

/** Steer with the left stick (camera space) until within `stop` m of (x, z). Returns the distance. */
async function walkTo(x, z, stop = 1.6, steps = 160) {
  let dist = Infinity;
  for (let i = 0; i < steps; i++) {
    const s = await state();
    const wx = x - s.player.pos.x, wz = z - s.player.pos.z;
    dist = Math.hypot(wx, wz);
    if (dist < stop) break;
    const sy = Math.sin(s.camYaw), cy = Math.cos(s.camYaw);
    const mx = (-cy * wx + sy * wz) / dist, my = (sy * wx + cy * wz) / dist;
    // Slow down close in, so the stop lands inside reach without overshooting into the body.
    const k = dist < stop + 1 ? 0.45 : 1;
    await page.evaluate(([a, b]) => window.__pad.axes(a, b), [mx * k, -my * k]);
    await frames(2);
  }
  await page.evaluate(() => window.__pad.axes(0, 0));
  await frames(8);
  return dist;
}

/** Wait (by frames) for the QA state to satisfy `pred`; returns the last state. */
async function until(pred, maxFrames = 240) {
  let s = await state();
  for (let i = 0; i < maxFrames / 4 && !pred(s); i++) {
    await frames(4);
    s = await state();
  }
  return s;
}

/** Press A through a dialogue until `done(state)` or it closes. */
async function talkThrough(done, presses = 16) {
  let s = await state();
  for (let i = 0; i < presses && !done(s) && s.screen === 'screen-dialogue'; i++) {
    await press('a');
    await frames(6);
    s = await state();
  }
  return s;
}

const quest = (s) => s.rpg?.quests?.q_wake_up ?? null;

/** Walk up to an NPC, shrine or chest until the interact prompt names it. */
async function approach(id, x, z, stop) {
  await walkTo(x, z, stop);
  return until((s) => s.interact?.id === id, 60);
}

async function rpgLoop() {
  console.log('  -- M3 RPG loop (pad only)');
  let s = await state();
  check(!!s.rpg && s.rpg.level === 1 && s.rpg.spells.length >= 1, 'the player has RPG progress (level 1, a spell)', JSON.stringify(s.rpg && { level: s.rpg.level, spells: s.rpg.spells }));
  const objects = s.objects;
  check(['elder_pepe', 'merchant_village', 'shrine_first_light', 'chest_training'].every((id) => objects.some((o) => o.id === id && o.viewShown)), 'villagers, shrine and chest are in the world with views', JSON.stringify(objects.map((o) => [o.id, o.viewShown])));
  const compass = await page.evaluate(() => [...document.querySelectorAll('.compass .mark.cardinal')].map((e) => e.textContent).join(''));
  check(compass === 'NESW', 'the compass bar shows N, E, S and W', compass);

  // Elder Pepe: Y talks, A reads on and takes the first choice ("I'm on it.").
  await teleport(262, 64.5);
  s = await approach('elder_pepe', 262, 68, 1.7);
  check(s.interact?.id === 'elder_pepe' && /^Y\s*Talk to Elder Pepe$/.test(s.prompt ?? ''), 'the interact prompt reads "[Y] Talk to Elder Pepe"', `${JSON.stringify(s.interact)} prompt ${JSON.stringify(s.prompt)}`);
  await press('y');
  s = await until((q) => q.screen === 'screen-dialogue');
  check(s.screen === 'screen-dialogue' && s.rpg.dialogue?.node === 'intro', 'Y opens the dialogue on the Elder\'s first line', `${s.screen} ${JSON.stringify(s.rpg.dialogue)}`);
  await shot('w10-dialogue');
  s = await talkThrough((q) => q.rpg.dialogue?.node === 'intro2' && !q.typing);
  check(s.rpg.dialogue?.node === 'intro2' && s.choices.length === 2, 'A advances to the choice', `${JSON.stringify(s.rpg.dialogue)} ${JSON.stringify(s.choices)}`);
  check(s.focused === "I'm on it.", 'the first choice has the focus', JSON.stringify(s.focused));
  await press('a');
  s = await until((q) => quest(q)?.status === 'active' && q.screen === null);
  check(quest(s)?.status === 'active', 'choosing "I\'m on it." starts Wake Up, Sproto', JSON.stringify(quest(s)));
  check(s.screen === null && s.state === 'playing', 'the dialogue closes back to play', `${s.screen} ${s.state}`);
  check(/Wake Up, Sproto/.test(s.tracker) && /training yard/.test(s.tracker), 'the tracker shows the quest and its step', JSON.stringify(s.tracker));
  check(s.markerShown, 'the compass shows the step\'s marker');
  await shot('w11-tracked');

  // The tabbed menu: Start opens it, LB / RB tour every tab (and wrap), View opens it on Quests.
  await press('start');
  s = await state();
  check(s.state === 'paused' && s.screen === 'screen-menu' && s.menuTab === 'powers', 'Start opens the tabbed menu on Powers', `${s.state} ${s.screen} ${s.menuTab}`);
  const toured = [s.menuTab];
  for (let i = 0; i < 7; i++) {
    await press('rb');
    toured.push((await state()).menuTab);
  }
  check(toured.join() === 'powers,skills,gear,relics,quests,map,settings,powers', 'RB tours every tab and wraps', toured.join());
  await press('lb');
  s = await state();
  check(s.menuTab === 'settings', 'LB goes back a tab (and wraps)', s.menuTab);
  await shot('w11b-menu-settings');
  await press('start');
  s = await until((q) => q.state === 'playing');
  check(s.state === 'playing' && s.screen === null, 'Start closes the menu', `${s.state} ${s.screen}`);
  await frames(6);
  s = await state();
  check(s.state === 'playing', 'the Start that closed the menu does not pause again', s.state);
  await press('back');
  s = await state();
  const logText = await page.evaluate(() => document.querySelector('#screen-menu')?.textContent ?? '');
  check(s.screen === 'screen-menu' && s.menuTab === 'quests' && /Wake Up, Sproto/.test(logText), 'View opens the menu on Quests, listing the quest', `${s.screen} ${s.menuTab} ${logText.slice(0, 80)}`);
  await press('b');
  s = await state();
  check(s.state === 'playing', 'B back to play', s.state);

  // Trader Pepe: the shop opens from his dialogue; buying what you can't afford is refused.
  await teleport(246, 71);
  await approach('merchant_village', 246, 74, 1.7);
  await press('y');
  await until((q) => q.screen === 'screen-dialogue');
  await talkThrough((q) => q.choices.length > 0 && !q.typing);
  await press('a');
  s = await until((q) => q.screen === 'screen-shop');
  check(s.screen === 'screen-shop' && s.rpg.shop === 'merchant_village', '"Show me your wares." opens the shop', `${s.screen} ${s.rpg.shop}`);
  const stock = await page.evaluate(() => [...document.querySelectorAll('#screen-shop [data-item]')].map((e) => e.dataset.item));
  check(stock.includes('staff_nobu') && stock.includes('staff_brick_phone') && stock.length === 5, 'the shop lists the merchant\'s stock', stock.join(','));
  await shot('w12-shop');
  await press('a');
  s = await until((q) => !!q.toast);
  check(/Sprouts|afford/i.test(s.toast ?? '') && !s.rpg.inventory.staff_nobu, 'buying Nobu without the Sprouts is refused, with a reason', JSON.stringify(s.toast));
  await press('b');
  s = await until((q) => q.screen === null);
  check(s.screen === null && s.rpg.shop === null, 'B leaves the shop', `${s.screen} ${s.rpg.shop}`);

  // The training yard trigger (inside its 7 m radius, clear of the well at 256, 90).
  await teleport(250, 89);
  s = await until((q) => (quest(q)?.step ?? 0) >= 1);
  check(quest(s)?.step === 1, 'reaching the training yard completes the first step', JSON.stringify(quest(s)));
  check(/Straw Dummies 0\/3/.test(s.tracker), 'the tracker counts straw dummies', JSON.stringify(s.tracker));

  // Three straw dummies, with RB.
  const straw = s.enemies.filter((e) => e.def === 'dummy_straw');
  if (process.env.RPG_DEBUG) console.log('  debug', JSON.stringify({ screen: s.screen, state: s.state, player: s.player, dlg: s.rpg.dialogue, shop: s.rpg.shop, at: s.rpg.atShrine, device: s.device, ground: s.groundWait, wait: s.waitingForGround }));
  await shot('w12b-yard');
  check(straw.length === 3 && straw.every((e) => e.viewShown), 'three straw dummies stand in the yard', JSON.stringify(straw.map((e) => e.id)));
  for (const d of straw) {
    const dist = await walkTo(d.pos.x, d.pos.z, 1.5);
    let e = null;
    for (let i = 0; i < 16; i++) {
      e = (await state()).enemies.find((x) => x.id === d.id);
      if (!e || e.action === 'dead') break;
      // Push the stick at the dummy while swinging: a swing goes where the stick points.
      const me = await state();
      const wx = d.pos.x - me.player.pos.x, wz = d.pos.z - me.player.pos.z, l = Math.hypot(wx, wz) || 1;
      const sy = Math.sin(me.camYaw), cy = Math.cos(me.camYaw);
      await page.evaluate(([a, b]) => window.__pad.axes(a, b), [(-cy * wx + sy * wz) / l, -(sy * wx + cy * wz) / l]);
      await press('rb');
      await page.evaluate(() => window.__pad.axes(0, 0));
      await frames(10);
    }
    console.log(`  info straw dummy ${d.id}: walked to ${dist.toFixed(2)} m, hp ${d.hp} → ${e?.hp}, ${e?.action ?? 'gone'}`);
  }
  s = await until((q) => (quest(q)?.step ?? 0) >= 2, 120);
  check(quest(s)?.step === 2, 'breaking three straw dummies completes the step', `${JSON.stringify(quest(s))} tracker ${JSON.stringify(s.tracker)}`);
  check(s.rpg.xp > 0, 'the kills gave XP', String(s.rpg.xp));

  // The chest, with Y.
  s = await approach('chest_training', 270, 92, 1.4);
  check(s.interact?.kind === 'chest', 'the chest offers Open', JSON.stringify(s.interact));
  await press('y');
  s = await until((q) => (quest(q)?.step ?? 0) >= 3);
  check(quest(s)?.step === 3 && (s.rpg.inventory.sprout_seed ?? 0) >= 1, 'opening the chest gives the Sprout Seed and advances the quest', `${JSON.stringify(quest(s))} ${JSON.stringify(s.rpg.inventory)}`);
  check(s.objects.find((o) => o.id === 'chest_training')?.used === true, 'the chest stays open');
  check(s.feed.some((l) => /Sprout Seed/.test(l)), 'the feed says what you got', JSON.stringify(s.feed));
  await shot('w13-chest');

  // Back to the Elder with the seed.
  await teleport(262, 64.5);
  await approach('elder_pepe', 262, 68, 1.7);
  await press('y');
  s = await until((q) => q.screen === 'screen-dialogue');
  check(s.rpg.dialogue?.node === 'seed_return', 'the Elder greets the seed', JSON.stringify(s.rpg.dialogue));
  await talkThrough(() => false);
  s = await until((q) => (quest(q)?.step ?? 0) >= 4 && q.screen === null);
  check(quest(s)?.step === 4 && !s.rpg.inventory.sprout_seed, 'handing in the seed advances the quest (the seed is taken)', `${JSON.stringify(quest(s))} ${JSON.stringify(s.rpg.inventory)}`);

  // The Shrine of First Light: Rest, then Level up.
  await teleport(240, 59);
  s = await approach('shrine_first_light', 240, 62, 1.8);
  check(/^Y\s*Rest at Shrine of First Light$/.test(s.prompt ?? ''), 'the shrine prompt reads "[Y] Rest at Shrine of First Light"', JSON.stringify(s.prompt));
  const savesBefore = s.saves;
  await press('y');
  s = await until((q) => q.screen === 'screen-shrine');
  check(s.screen === 'screen-shrine' && s.focused === 'Rest', 'Y opens the shrine menu on Rest', `${s.screen} ${JSON.stringify(s.focused)}`);
  await press('a');
  s = await until((q) => quest(q)?.status === 'complete');
  check(quest(s)?.status === 'complete', 'resting completes Wake Up, Sproto', JSON.stringify(quest(s)));
  check(s.rpg.lastShrine === 'shrine_first_light', 'the shrine is the respawn point', JSON.stringify(s.rpg.lastShrine));
  check(s.rpg.level >= 2 && s.rpg.points >= 1, 'the quest XP levels you up, with a point to spend', `level ${s.rpg.level}, points ${s.rpg.points}, xp ${s.rpg.xp}`);
  s = await until((q) => q.saves > savesBefore, 60);
  check(s.saves > savesBefore, 'the rest autosaves', `${savesBefore} → ${s.saves}`);
  await shot('w14-shrine');
  check(s.rpg.points === 2 * (s.rpg.level - 1), 'each level-up gave 2 skill points', `level ${s.rpg.level}, points ${s.rpg.points}`);
  await press('down');
  s = await state();
  check(/^Skills/.test(s.focused ?? ''), 'the shrine offers Skills', JSON.stringify(s.focused));
  await press('a');
  s = await until((q) => q.menuTab === 'skills');
  check(s.screen === 'screen-menu' && s.menuTab === 'skills', 'Skills opens the Skills tab', `${s.screen} ${s.menuTab}`);
  check(/^Spell Power/.test(s.focused ?? ''), 'the tree starts on Spell Power', JSON.stringify(s.focused));
  await shot('w14b-skills');
  // The grid: right to the Combat branch (Attack), down to Defense, up again.
  await press('right');
  s = await state();
  check(/^Attack/.test(s.focused ?? ''), 'D-pad right moves to the Combat branch', JSON.stringify(s.focused));
  await press('down');
  s = await state();
  check(/^Defense/.test(s.focused ?? ''), 'D-pad down moves along the branch', JSON.stringify(s.focused));
  await press('up');
  const points = (await state()).rpg.points;
  await press('a');
  s = await until((q) => q.rpg.skills.attack > 0);
  check(s.rpg.skills.attack === 1 && s.rpg.points === points - 1, 'A spends a skill point on Attack', `attack ${s.rpg.skills.attack}, points ${points} → ${s.rpg.points}`);

  // The spell selector, pad only: learn a second spell (QA), pick a slot, pick a power, see it on the HUD.
  await press('lb');
  s = await state();
  check(s.menuTab === 'powers', 'LB goes to the Powers tab', s.menuTab);
  await shot('w14c-powers');
  check(/Arcane Bolt/.test(s.focused ?? '') && s.rpg.loadout[0] === 'bolt', 'Powers starts on slot 1, holding Bolt', `${JSON.stringify(s.focused)} ${JSON.stringify(s.rpg.loadout)}`);
  await press('right');
  await press('a');
  s = await state();
  check(s.menuPick === 'slot:1', 'A picks slot 2', JSON.stringify(s.menuPick));
  check(/Arcane Bolt/.test(s.focused ?? ''), 'the focus moves to the powers you know', JSON.stringify(s.focused));
  await press('a');
  s = await until((q) => q.rpg.loadout[1] === 'bolt');
  check(s.rpg.loadout[1] === 'bolt' && s.rpg.loadout[0] === null, 'A on a power equips it: Bolt moves to slot 2', JSON.stringify(s.rpg.loadout));
  check(s.menuPick === null, 'the pick is done', JSON.stringify(s.menuPick));
  await press('b'); // the tabbed menu, back to the shrine's list
  s = await until((q) => q.screen === 'screen-shrine');
  check(s.screen === 'screen-shrine', 'B returns to the shrine menu', s.screen);
  await press('b');
  s = await until((q) => q.screen === null);
  check(s.screen === null && s.rpg.atShrine === null, 'B leaves the shrine', `${s.screen} ${s.rpg.atShrine}`);
  check(s.saves > savesBefore + 1, 'spending the point autosaves too', `${savesBefore} → ${s.saves}`);
  s = await until((q) => q.hudSlots?.[1] === 'bolt');
  check(s.hudSlots?.[1] === 'bolt' && s.hudSlots?.[0] === null, 'the HUD shows the swapped loadout', JSON.stringify(s.hudSlots));
  const hudName = await page.evaluate(() => [...document.querySelectorAll('.spell-bar .spell .name')].map((e) => e.textContent));
  check(hudName[1] === 'Arcane Bolt' && hudName[0] === 'Empty', 'the HUD slots name what they hold', hudName.join(','));

  // And away from a shrine: Start → Powers, a swap by pad works anywhere (Bolt back to slot 1).
  await press('start');
  s = await state();
  check(s.state === 'paused' && s.screen === 'screen-menu' && s.menuTab === 'powers', 'Start reopens the menu on the tab it was left on', `${s.state} ${s.menuTab}`);
  await press('left'); // the focus was left on slot 2: back over slot 1, above Bolt in the grid
  await press('down');
  s = await state();
  check(/Arcane Bolt/.test(s.focused ?? ''), 'D-pad down reaches the powers grid', JSON.stringify(s.focused));
  await press('a');
  s = await state();
  check(s.menuPick === 'spell:bolt', 'A picks the power first this time', JSON.stringify(s.menuPick));
  await press('left');
  await press('a');
  s = await until((q) => q.rpg.loadout[0] === 'bolt');
  check(s.rpg.loadout[0] === 'bolt' && s.rpg.loadout[1] === null, 'then a slot: the swap applies while paused', JSON.stringify(s.rpg.loadout));
  await press('rb');
  await press('rb');
  s = await state();
  check(s.menuTab === 'gear', 'RB reaches the Gear tab', s.menuTab);
  const gearText = await page.evaluate(() => document.querySelector('#screen-menu')?.textContent ?? '');
  check(/Sprout Staff/.test(gearText) && /Apprentice Robe/.test(gearText), 'the Gear tab lists what you wear', gearText.slice(0, 120));
  await shot('w14d-gear');
  await press('start');
  s = await until((q) => q.state === 'playing');
  check(s.state === 'playing', 'Start closes the menu again', s.state);

  // The Brick Phone, by pad: RB (Light attack) with it in hand opens it; A calls a shrine you have used.
  // QA setup: the phone bought and wielded, then a walk's worth away from the shrine.
  await page.evaluate(() => {
    const a = window.__qa.app;
    a.sim.playerEntity(0).progress.inventory.staff_brick_phone = 1;
    a.commands.queueUi({ kind: 'equip', item: 'staff_brick_phone' });
  });
  s = await until((q) => q.rpg.equipment.staff === 'staff_brick_phone');
  check(s.rpg.equipment.staff === 'staff_brick_phone', 'the Brick Phone is in hand', s.rpg.equipment.staff);
  await teleport(300, 110);
  await press('rb');
  s = await until((q) => q.screen === 'screen-phone');
  const rows = await page.evaluate(() => [...document.querySelectorAll('#screen-phone .phone-row')].map((r) => `${r.dataset.shrine}:${r.tagName === 'BUTTON' ? 'call' : 'locked'}`));
  check(s.screen === 'screen-phone' && s.rpg.phone === true && /^Shrine of First Light/.test(s.focused ?? ''), 'RB with the phone opens it on the shrine you have used', `${s.screen} ${JSON.stringify(s.focused)}`);
  const lockedRows = rows.filter((r) => r.endsWith(':locked'));
  check(rows.includes('shrine_first_light:call') && !rows.some((r) => r.startsWith('shrine_watchtower')) && lockedRows.length === 7 && rows.length === 8, 'the phone lists used shrines to call, and one locked line per region for the rest', rows.join(','));
  await shot('w14e-phone');
  await press('down');
  s = await state();
  check(s.focused === 'Hang up', 'D-pad down skips the locked shrines to Hang up', JSON.stringify(s.focused));
  await press('b');
  s = await until((q) => q.screen === null);
  check(s.screen === null && !s.rpg.phone && s.player.pos.x > 290, 'B hangs up, and nothing swung', `${s.screen} ${s.rpg.phone} ${s.player.pos.x.toFixed(1)}`);
  await press('rb');
  s = await until((q) => q.screen === 'screen-phone');
  check(/^Shrine of First Light/.test(s.focused ?? ''), 'RB opens it again, on the shrine', JSON.stringify(s.focused));
  await press('a');
  s = await until((q) => q.screen === null && !q.groundWait, 600);
  const home = await page.evaluate(() => window.__qa.app.sim.locate('shrine_first_light'));
  check(Math.hypot(s.player.pos.x - home.x, s.player.pos.z - home.z) < 3, 'A calls the shrine: you arrive beside it', `${s.player.pos.x.toFixed(1)}, ${s.player.pos.z.toFixed(1)} vs ${home.x.toFixed(1)}, ${home.z.toFixed(1)}`);
  // Back to the staff, so the rest of the loop is unchanged.
  await page.evaluate(() => {
    const a = window.__qa.app;
    a.commands.queueUi({ kind: 'equip', item: 'staff_sproto' });
  });
  s = await until((q) => q.rpg.equipment.staff === 'staff_sproto');
  check(s.rpg.equipment.staff === 'staff_sproto', 'the staff goes back in hand', s.rpg.equipment.staff);
  await page.evaluate(() => { delete window.__qa.app.sim.playerEntity(0).progress.inventory.staff_brick_phone; });

  // Save → reload → Continue.
  const want = await state();
  const stored = await page.evaluate(() => localStorage.getItem('sow.save'));
  check(!!stored && JSON.parse(stored).player.level === want.rpg.level, 'the save is in localStorage', stored ? `${stored.length} bytes` : 'missing');
  // A QA edit of the save: Blast is known but not equipped, so the selector has a real swap to make.
  await page.evaluate(() => {
    const save = JSON.parse(localStorage.getItem('sow.save'));
    save.player.spells.push('blast');
    localStorage.setItem('sow.save', JSON.stringify(save));
  });
  // A CI runner's software GPU can spend more than 30 s tearing down and rebooting the game.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 180000 });
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 180000 });
  await press('down');
  s = await state();
  check(s.focused === 'Continue', 'the title offers Continue first', JSON.stringify(s.focused));
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing', null, { timeout: 30000 });
  await page.waitForFunction(() => !window.__qa.state().groundWait, null, { timeout: 30000 });
  await frames(20);
  s = await state();
  check(s.rpg.level === want.rpg.level && s.rpg.xp === want.rpg.xp && s.rpg.skills.attack === want.rpg.skills.attack && s.rpg.points === want.rpg.points, 'Continue restores level, XP and skills', `level ${s.rpg.level}/${want.rpg.level}, xp ${s.rpg.xp}/${want.rpg.xp}, attack ${s.rpg.skills.attack}, points ${s.rpg.points}`);
  check(JSON.stringify(s.rpg.loadout) === JSON.stringify(want.rpg.loadout), 'Continue restores the loadout', JSON.stringify(s.rpg.loadout));
  check(quest(s)?.status === 'complete' && s.rpg.lastShrine === 'shrine_first_light', 'Continue restores the quest and the respawn shrine', `${JSON.stringify(quest(s))} ${s.rpg.lastShrine}`);
  check(s.objects.find((o) => o.id === 'chest_training')?.used === true, 'the opened chest stays open after Continue');
  const d = Math.hypot(s.player.pos.x - 240, s.player.pos.z - 62);
  check(d < 4 && s.player.grounded, 'Continue wakes you at the last shrine', `${d.toFixed(1)} m from it, grounded ${s.player.grounded}`);
  await shot('w15-continue');

  // A real swap by pad: Blast into slot 2, away from a shrine, so it starts on cooldown.
  await press('start');
  s = await state();
  check(s.screen === 'screen-menu' && s.menuTab === 'powers', 'Start opens the Powers tab after Continue', `${s.screen} ${s.menuTab}`);
  await press('right');
  await press('a');
  s = await state();
  check(s.menuPick === 'slot:1', 'A picks the empty slot 2', JSON.stringify(s.menuPick));
  await press('right');
  s = await state();
  check(/Blast/.test(s.focused ?? '') && /Swap in/.test(s.focused ?? ''), 'the grid offers Blast, saying what the swap costs', JSON.stringify(s.focused));
  await shot('w16-swap');
  await press('a');
  s = await until((q) => q.rpg.loadout[1] === 'blast');
  check(JSON.stringify(s.rpg.loadout) === '["bolt","blast",null,null]', 'A swaps Blast into slot 2 while paused', JSON.stringify(s.rpg.loadout));
  check(s.player.cooldowns.blast >= 170 && s.player.cooldowns.blast <= 180, 'the swapped-in power starts on its cooldown', String(s.player.cooldowns.blast));
  check(/Ready in 3 s/.test(s.focused ?? ''), 'its slot says when it will be ready', JSON.stringify(s.focused));
  await press('start');
  s = await until((q) => q.state === 'playing' && q.hudSlots?.[1] === 'blast');
  check(s.hudSlots?.[1] === 'blast', 'the HUD shows Blast in slot 2', JSON.stringify(s.hudSlots));
  const hud2 = await page.evaluate(() => {
    const el = document.querySelectorAll('.spell-bar .spell')[1];
    return { name: el.querySelector('.name')?.textContent, spell: el.dataset.spell, cooling: el.classList.contains('cooling') };
  });
  check(hud2.name === 'Blast' && hud2.spell === 'blast' && hud2.cooling, 'its HUD slot has the name and the cooldown sweep', JSON.stringify(hud2));
  await shot('w17-hud-swap');
}

try {
  await page.goto(url);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 30000 });
  let s = await state();
  check(s.mode === 'world', 'boots into world mode by default', s.mode);
  // Wake the pad (that press is swallowed by design), then A on Play.
  await press('down');
  await press('a');
  // The class picker comes next on a new save: A takes the focused Wizard.
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 30000 });
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

  if (!RPG_ONLY) {
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
    // The 15 s clock starts on the first frame that finds no ground, so time it from the veil going
    // up: on a CI runner's software GPU the frames before that can take many seconds on their own.
    await page.evaluate(() => window.__qa.teleport(470, 470));
    await page.waitForFunction(() => window.__qa.state().groundWait, null, { timeout: 60000, polling: 'raf' });
    const t0 = Date.now();
    s = await state();
    const veil = await page.evaluate(() => document.querySelector('.veil').classList.contains('active'));
    check(s.groundWait && veil, 'a teleport onto missing cells shows the loading veil', `groundWait ${s.groundWait}, veil ${veil}, error ${s.errorOpen}`);
    await page.waitForFunction(() => window.__qa.state().errorOpen, null, { timeout: 180000, polling: 250 });
    const waited = (Date.now() - t0) / 1000;
    s = await state();
    // Never early. How late depends on the frame that notices: a software GPU can stall for many
    // seconds compiling shaders, so the upper limit only holds on a real one (like the long tasks).
    check(waited >= 10, 'the Retry / Return panel waits for the 15 s veil timeout', `${waited.toFixed(1)} s`);
    if (software && !strict) console.log(`  info the Retry / Return panel appeared ${waited.toFixed(1)} s after the veil (software GPU, upper limit not asserted)`);
    else check(waited <= 26, 'the Retry / Return panel appears soon after the 15 s veil timeout', `${waited.toFixed(1)} s`);
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

    // The far north-west corner: nothing the wider view or the payload cache has reached from the
    // start or from the north-east, so the fetches really do fail.
    const FAR = /cells\/c_[01]_[67]\./;
    await blockCells(FAR);
    await page.evaluate(() => window.__qa.teleport(40, 470));
    await page.waitForFunction(() => window.__qa.state().errorOpen, null, { timeout: 30000, polling: 250 });
    await press('right');
    await press('a');
    await page.waitForFunction(() => { const q = window.__qa.state(); return q.state === 'playing' && !q.errorOpen && !q.groundWait && !q.waitingForGround; }, null, { timeout: 30000 });
    await frames(12);
    st0 = standing(await state(), 256, 58);
    check(st0.ok, 'Return to start puts the player back at the start, on the ground', st0.detail);
    await unblock(FAR);
    blocking = false;
  }

  // M3: the dialogue → quest → tracker → interact loop, by pad, then save → reload → Continue.
  await rpgLoop();

  if (!RPG_ONLY) {
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
    const gpuTextures = [];
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
      gpuTextures.push(st.gpuMemory.textures);
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
    // Shown cells: at most the hysteresis ring past the widest view (rings.ts MAX_VIEW_RINGS = 5, so 13 × 13).
    check(c.active <= 25 && c.loaded <= 169, 'loaded cells stay within the rings', `${c.loaded} shown, ${c.active} active, ${c.visual} visual`);
    check(after.props.overflow === 0, 'no prop bucket overflows its baked capacity', `overflow ${after.props.overflow}`);

    const long = await page.evaluate(() => window.__long.splice(0));
    const worst = long.length ? Math.max(...long) : 0;
    const over = long.filter((d) => d > 50);
    const longDetail = `${over.length} over 50 ms, worst ${worst.toFixed(0)} ms on ${gpu}`;
    if (software && !strict) console.log(`  info long tasks during laps (software GPU, not asserted): ${longDetail}`);
    else check(over.length === 0, 'zero long tasks over 50 ms during the laps', longDetail);

    // Enemy views come and go with distance: each must give back its GPU bone texture.
    if (gpuTextures.length >= 2) check(gpuTextures.at(-1) <= gpuTextures[0] + 8, `GPU textures don't grow across ${gpuTextures.length} laps`, gpuTextures.join(' → '));
    if (heaps.every((h) => h !== null) && heaps.length >= 2) {
      const base = heaps[0];
      const drift = heaps.map((h) => (h - base) / base);
      // A leak grows the heap; a drop (the first lap's warm-up garbage collected) is fine.
      const worstGrowth = Math.max(...drift);
      check(worstGrowth <= HEAP_TOLERANCE, `JS heap doesn't grow across ${heaps.length} laps (≤ +15 %)`, heaps.map((h) => `${(h / 1048576).toFixed(1)} MB`).join(' → '));
    } else console.log(`  skip heap check (${heaps.length < 2 ? 'needs 2+ laps' : 'performance.memory not available'})`);
  }

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
