/**
 * What the player sees and touches, on the real game: the HUD's layout on a small window, banners
 * after a pause, prompts that follow the device, pausing behind the loading veil, the error panels by
 * keyboard and stick, and a failed Continue that must keep the save.
 *
 *   node tests/e2e/tour.mjs [--shots dir]
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
    axes(lx, ly) {
      pad.axes.splice(0, 2, lx, ly);
      pad.timestamp++;
    },
  };
  navigator.getGamepads = () => [pad, null, null, null];
}

const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
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
const playing = () => page.waitForFunction(() => window.__qa.state().state === 'playing' && !window.__qa.state().groundWait, null, { timeout: 180000 });
const titleUp = () => page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 180000 });
/** The first press only wakes the pad, so confirm until the title has gone. */
async function confirmTitle() {
  await press('a');
  await frames(5);
  if ((await state()).screen === 'screen-title') await press('a');
}
let failures = 0;
function check(ok, what, detail = '') {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}${detail !== '' ? `  (${detail})` : ''}`);
  if (!ok) failures++;
}

try {
  await page.goto(server.resolvedUrls.local[0]);
  await titleUp();
  await confirmTitle();
  await playing();
  await frames(20);

  // The HUD's layout on a small window.
  const layout = await page.evaluate(() => {
    const a = window.__qa.app;
    const real = a.bossHud.update.bind(a.bossHud);
    a.bossHud.update = (_s, dt) => real({ name: 'Scrapjaw', title: 'Tour', hp: 7, hpMax: 10 }, dt);
    a.bossHud.update(null, 0.016);
    const rect = (s) => document.querySelector(s).getBoundingClientRect();
    const out = { compassGap: rect('.compass').left - rect('.bar.hp').right, barBottom: rect('.boss-bar').bottom, spellTop: rect('.spell-bar').top };
    a.bossHud.update = real;
    return out;
  });
  check(layout.compassGap > 0, 'the compass clears the health bar', layout.compassGap);
  check(layout.barBottom <= layout.spellTop, 'the boss bar clears the spell bar', `${layout.barBottom} / ${layout.spellTop}`);

  // A banner that has played does not come back when the HUD does.
  await page.evaluate(() => window.__qa.app.hud.waveBanner('Tour', 'an old banner'));
  await page.waitForTimeout(3500);
  await press('start');
  await frames(5);
  check((await state()).state === 'paused', 'Start pauses');

  // Prompts follow the device while the menu is open.
  const tabKey = () => page.evaluate(() => document.querySelector('#screen-menu .tab-key').textContent);
  const padKey = await tabKey();
  await page.keyboard.press('Shift');
  await frames(6);
  const keyKey = await tabKey();
  check(padKey === 'LB' && keyKey === 'Q', 'the tab prompts follow the device', `${padKey} -> ${keyKey}`);

  await press('b'); // wakes the pad again
  await frames(4);
  if ((await state()).state === 'paused') await press('b');
  const banner = await page.evaluate(async () => {
    const b = document.querySelector('.wave-banner');
    let max = 0;
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) {
      max = Math.max(max, Number(getComputedStyle(b).opacity));
      await new Promise((r) => requestAnimationFrame(r));
    }
    return max;
  });
  check(banner < 0.05, 'an old banner does not replay on resume', banner);

  // Pausing behind the loading veil shows the menu; resuming puts the veil back until the ground is in.
  await page.evaluate(() => window.__qa.teleport(440, 452));
  await frames(1);
  if ((await state()).groundWait) {
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await frames(6);
    const veil = () => page.evaluate(() => document.querySelector('.veil').classList.contains('active'));
    check((await state()).state === 'paused' && !(await veil()), 'the pause menu is not left under the loading veil');
    await press('b');
    await frames(4);
    if ((await state()).state === 'paused') await press('b');
  } else console.log('  (the far cell was already loaded: veil check skipped)');
  await playing();

  // The error panel, by keyboard and by stick, with the menus behind it deaf.
  await page.evaluate(() => window.__qa.app.groundTimeout());
  await frames(3);
  await page.keyboard.press('ArrowRight');
  await frames(3);
  check(/Return/.test((await state()).errorAction ?? ''), 'arrow keys move between the error actions', (await state()).errorAction);
  await page.keyboard.press('ArrowLeft');
  await frames(3);
  await page.evaluate(() => window.__pad.axes(1, 0));
  await frames(6);
  await page.evaluate(() => window.__pad.axes(0, 0));
  await frames(3);
  check(/Return/.test((await state()).errorAction ?? ''), 'the left stick moves between the error actions', (await state()).errorAction);
  await page.evaluate(() => window.__qa.app.panels.hideError());
  await press('start');
  await frames(4);
  const tab = (await state()).menuTab;
  await page.evaluate(() => window.__qa.app.panels.showError('Tour', 'OK', () => {
    window.__ok = true;
    window.__qa.app.panels.hideError();
  }));
  await frames(3);
  await page.keyboard.press('KeyE');
  await frames(3);
  check((await state()).menuTab === tab, 'a menu behind the error panel takes no keys', (await state()).menuTab);
  await page.keyboard.press('Enter');
  await frames(3);
  check(await page.evaluate(() => window.__ok === true), 'Enter confirms the error panel');

  // A failed Continue: Retry keeps the save, and there is a way back to the title.
  await page.evaluate(() => {
    const a = window.__qa.app;
    a.sim.playerEntity(0).progress.sprouts = 777;
    a.writeSaveNow();
  });
  let blocked = true;
  await page.route('**/region.json*', (r) => (blocked ? r.abort() : r.continue()));
  await page.reload();
  await titleUp();
  await frames(5);
  await confirmTitle();
  await page.waitForFunction(() => window.__qa.state().errorOpen, null, { timeout: 90000 });
  await shot('load-failed');
  const actions = await page.evaluate(() => [...document.querySelectorAll('.error-actions .btn')].map((b) => b.textContent));
  check(actions.includes('Back to title'), 'a failed load offers a way back', actions.join(' / '));
  blocked = false;
  await press('a');
  await playing();
  await frames(10);
  check((await state()).rpg.sprouts === 777, 'Retry after a failed Continue keeps the save', (await state()).rpg.sprouts);
  await page.evaluate(() => localStorage.clear());
} catch (err) {
  failures++;
  console.log(`  FAIL the tour stopped: ${err instanceof Error ? err.message : String(err)}`);
  await shot('stopped');
}

await browser.close();
await server.close();
console.log(failures ? `tour: ${failures} failed` : 'tour: all passed');
process.exit(failures ? 1 : 0);
