/**
 * The Quests tab's "Find a quest", pad only (teleports are the QA cheat): it leads the tracker and
 * compass to a quest giver, taking that quest puts it on the tracker, and selecting it again moves on.
 *
 *   node tests/e2e/find-quest.mjs [--shots dir]
 */
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const args = process.argv.slice(2);
const shots = args.includes('--shots') ? args[args.indexOf('--shots') + 1] : null;
if (shots) mkdirSync(shots, { recursive: true });

const server = await createServer({ server: { port: 5197, strictPort: false, hmr: false }, logLevel: 'error' });
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
const hud = () => page.evaluate(() => ({
  title: document.querySelector('.tracker .title')?.textContent ?? '',
  step: document.querySelector('.tracker .step')?.textContent ?? '',
  compass: document.querySelector('.quest-marker')?.classList.contains('active') ?? false,
  state: window.__qa.state().state,
  tracked: window.__qa.app.sim.playerEntity(0).progress.tracked,
}));
const findButton = () => page.evaluate(() => {
  const b = document.querySelector('[data-find-quest]');
  return b ? { focused: b.classList.contains('focused'), text: b.textContent } : null;
});

/** Open the menu, go to Quests and press Find a quest, with the pad alone. */
async function findQuest() {
  await press('start');
  await frames(10);
  for (let i = 0; i < 6 && !(await findButton()); i++) await press('rb');
  for (let i = 0; i < 12 && !(await findButton())?.focused; i++) await press('up');
  const b = await findButton();
  check(!!b?.focused, 'the pad reaches Find a quest', b?.text ?? 'not on screen');
  await shot('quests-tab');
  await press('a');
  await frames(20);
}

try {
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 180000 });
  await press('down');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 180000 });
  await frames(30);

  await findQuest();
  let h = await hud();
  check(h.state === 'playing', 'it goes back to the game', h.state);
  check(/^Talk to .+ to take this quest\.$/.test(h.step), 'the tracker says who to talk to', `${h.title}: ${h.step}`);
  check(h.compass, 'the compass points the way');
  await shot('lead');
  const first = h.title;

  await findQuest();
  h = await hud();
  check(h.title !== first && /^Talk to /.test(h.step), 'selecting it again leads to another quest', `${first} then ${h.title}`);

  // Walk up to Collector Pepe (a teleport) and take Lost Relics.
  while ((await hud()).title !== 'Lost Relics') await findQuest();
  await page.evaluate(() => {
    const at = window.__qa.app.sim.view().locate('collector_pepe');
    const p = window.__qa.app.sim.playerEntity(0);
    window.__qa.teleport(at.x - 1.5, at.z);
    p.tf.yaw = p.tf.prevYaw = Math.PI / 2;
  });
  await frames(15);
  await press('y');
  for (let i = 0; i < 10 && await page.evaluate(() => !window.__qa.app.sim.playerEntity(0).progress.quests.q_relics); i++) await press('a');
  for (let i = 0; i < 8 && await page.evaluate(() => !!window.__qa.app.sim.playerEntity(0).progress.dialogue); i++) await press('a');
  await frames(15);
  h = await hud();
  check(h.tracked === 'q_relics', 'the quest taken is the one tracked', h.tracked);
  check(h.title === 'Lost Relics' && /relic chests/.test(h.step), 'the tracker moves on to its first step', h.step);
  check(h.compass, 'the compass leads to the first relic chest');
  await shot('taken');
  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (err) {
  failures++;
  console.log(`  FAIL ${err}`);
  await shot('find-quest-failure');
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `find-quest: ${failures} failure(s)` : 'find-quest: all checks passed');
process.exit(failures ? 1 : 0);
