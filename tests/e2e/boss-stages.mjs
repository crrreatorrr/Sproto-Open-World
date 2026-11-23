/**
 * Boss stages E2E: in the training yard, each staged boss is spawned in front of the player and
 * taken through its three phases. Its view must draw stage 1, then swap to (or grow into) stages 2
 * and 3 as the phases turn, and play its attack clips. Screenshots go to SHOTS (optional).
 *
 *   node tests/e2e/boss-stages.mjs [boss ids...]
 */
import { chromium } from 'playwright';
import { createServer } from 'vite';
import fs from 'node:fs';

const BOSSES = process.argv.slice(2).length ? process.argv.slice(2) : ['duel_obama', 'broccoli_head', 'glowie', 'hex_sahil', 'mega_tinubu', 'blue_monster', 'sproto_beast'];
const SHOTS = process.env.SHOTS;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

const server = await createServer({ server: { port: 5197, strictPort: false, hmr: false }, logLevel: 'error' });
await server.listen();
const gpu = process.env.SMOKE_GPU === '1' ? ['--use-angle=metal', '--ignore-gpu-blocklist'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
const browser = await chromium.launch({ args: gpu });

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
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(padInit);

const frames = (n) => page.evaluate((k) => new Promise((r) => { let i = 0; const f = () => (++i >= k ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
async function press(name) {
  await page.evaluate((n) => window.__pad.set(n, true), name);
  await frames(3);
  await page.evaluate((n) => window.__pad.set(n, false), name);
  await frames(3);
}

/** What the boss and its view are doing now. */
const look = (id) => page.evaluate((bossId) => {
  const app = window.__qa.app;
  const p = app.sim.playerEntity(0);
  p.vitals.hp = p.vitals.hpMax;
  const e = app.sim.entities.find((x) => x.id === bossId);
  if (!e) return null;
  const v = app.world.views.get(bossId);
  const a = e.combat?.action;
  return {
    state: e.boss.state, phase: e.boss.phase, hp: e.vitals.hp / e.vitals.hpMax, action: a?.kind ?? null, move: a?.kind === 'attack' ? a.move : null,
    view: v?.constructor.name ?? null, stage: v?.shownStage ?? null, scale: v?.body?.scale.x ?? null, clips: v?.clips ?? [],
    clip: v?.animator?.current?.getClip?.().name ?? null,
    adds: app.sim.entities.filter((x) => x.brain?.summoned).map((x) => x.brain.def),
  };
}, id);

try {
  await page.goto(`${url}?yard=1&localsave=0`);
  await page.waitForFunction(() => window.__qa?.ready && window.__qa.state().screen === 'screen-title', null, { timeout: 60000 });
  await press('a');
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === 'screen-classes', null, { timeout: 15000 });
  await press('a');
  await page.waitForFunction(() => window.__qa.state().screen === null && window.__qa.state().player, null, { timeout: 60000 });
  await frames(20);

  for (const boss of BOSSES) {
    console.log(boss);
    const spawned = await page.evaluate(async (def) => {
      const app = window.__qa.app;
      const sim = app.sim;
      const { ENEMIES } = await import('/src/content/enemies.ts');
      // The yard's own enemies and the last boss go, so one fight is on at a time.
      for (const e of [...sim.entities]) if (e.kind === 'enemy' || e.kind === 'boss' || e.brain) sim.remove(e.id);
      const p = sim.playerEntity(0);
      const yaw = p.tf.yaw;
      const d = 9 + ENEMIES[def].body.radius;
      const e = sim.spawnEnemy(def, { x: p.tf.pos.x + Math.sin(yaw) * d, y: p.tf.pos.y, z: p.tf.pos.z + Math.cos(yaw) * d }, yaw + Math.PI);
      const s = ENEMIES[def];
      return { id: e.id, stageScale: s.stageScale, stageModels: s.stageModels ?? null, phase2: s.boss.phase2, phase3: s.boss.phase3, clips: [...new Set(s.moves.map((m) => m.clip).filter(Boolean))] };
    }, boss);
    const until = async (pred, label, max = 900) => {
      for (let i = 0; i < max; i++) {
        const s = await look(spawned.id);
        if (s && pred(s)) return s;
        await frames(2);
      }
      throw new Error(`${boss}: timed out waiting for ${label}: ${JSON.stringify(await look(spawned.id))}`);
    };
    const staged = !!spawned.stageModels;
    const near = (a, b) => Math.abs(a - b) < 0.02;
    const seen = new Set();
    const watch = async (n) => {
      for (let i = 0; i < n; i++) {
        const s = await look(spawned.id);
        if (s?.move) seen.add(s.move);
        await frames(2);
      }
    };

    let s = await until((q) => q.state === 'fight' && q.view && q.clips.length > 0 && (!staged || q.stage === 0), 'the fight on stage 1');
    check(s.phase === 1 && near(s.scale, spawned.stageScale[0]), 'stage 1 is drawn at its size', `${s.view}, stage ${s.stage}, ×${s.scale.toFixed(2)}`);
    for (const c of spawned.clips) check(s.clips.includes(c), `its rig has the ${c} clip`);
    await watch(120);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${boss}-1.png` });

    for (const phase of [2, 3]) {
      await page.evaluate(([id, frac]) => {
        const e = window.__qa.app.sim.entities.find((x) => x.id === id);
        e.vitals.hp = e.vitals.hpMax * frac - 1;
      }, [spawned.id, phase === 2 ? spawned.phase2 : spawned.phase3]);
      s = await until((q) => q.phase === phase && near(q.scale, spawned.stageScale[phase - 1]) && (!staged || q.stage === phase - 1), `stage ${phase}`);
      check(true, `phase ${phase} turns it into stage ${phase}`, `${staged ? spawned.stageModels[phase - 1] : 'same model'}, ×${s.scale.toFixed(2)}`);
      check(s.clips.length > 0, `stage ${phase} is animated`, `${s.clips.length} clips`);
      await watch(150);
      if (SHOTS) await page.screenshot({ path: `${SHOTS}/${boss}-${phase}.png` });
    }
    check(seen.size >= 2, 'it attacks with its moves', [...seen].join(', '));
    s = await look(spawned.id);
    if (boss === 'duel_obama') check(s.adds.includes('duel_midget'), 'The Midget is in the fight', s.adds.join(', '));
  }
  check(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));
} catch (e) {
  failures++;
  console.log(`  FAIL ${e.message}`);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/failure.png` }).catch(() => {});
} finally {
  await browser.close();
  await server.close();
}
console.log(failures ? `boss stages: ${failures} failed` : 'boss stages: all passed');
process.exit(failures ? 1 : 0);
