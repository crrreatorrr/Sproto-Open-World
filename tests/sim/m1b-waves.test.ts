import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { WAVE_CENTRE, WAVE_GAP, WAVES } from '../../src/content/waves';
import { kill } from '../../src/sim/combat/hits';
import type { InputCommand } from '../../src/sim/commands';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, cmd, combatWorld, ofType, step, stepN, stepUntil, type TickEvents } from './combatHelpers';
import { ctxOf, keepAlive } from './m1bHelpers';

/** The M1b wave runner (`?sandbox=1`, plan §9 M1b, §2.9) and determinism with spells and waves (§2.2). */

const START_DELAY = 90; // SimWorld.startWaves

async function waveWorld(seed = 1) {
  const cw = await combatWorld({ seed });
  cw.w.startWaves();
  return cw;
}

/** Step until the next `wave` event; returns its tick and event. */
function nextWave(w: SimWorld, max = 1000) {
  let ev: Extract<SimWorld['events'][number], { type: 'wave' }> | undefined;
  const tick = stepUntil(w, (evs) => !!(ev = evs.find((e): e is NonNullable<typeof ev> => e.type === 'wave')), max);
  return { tick, ev: ev! };
}

const waveEnemies = (w: SimWorld) => w.wave!.ids.map((id) => w.get(id)!);

/** Kill every living enemy of the current wave (between ticks). */
function killWave(w: SimWorld): void {
  const p = w.playerEntity(0)!;
  const ctx = ctxOf(w);
  for (const e of waveEnemies(w)) if (e.combat!.action?.kind !== 'dead') kill(ctx, e, p);
}

describe('wave runner', () => {
  it(`spawns WAVES[0] ${START_DELAY} ticks after startWaves, engaged, with a wave event`, async () => {
    const { w, p } = await waveWorld();
    expect(w.wave).toEqual({ index: 0, loop: 0, enemiesLeft: 0, nextIn: START_DELAY, ids: [] });
    const { tick, ev } = nextWave(w);
    expect(tick).toBe(START_DELAY - 1); // the 90th tick
    expect(ev).toEqual({ type: 'wave', wave: 1, loop: 0, enemies: WAVES[0].length });
    const es = waveEnemies(w);
    expect(es.map((e) => [e.brain!.def, e.brain!.home.x, e.brain!.home.z])).toEqual(
      WAVES[0].map((s) => [s.def, WAVE_CENTRE[0] + s.at[0], WAVE_CENTRE[1] + s.at[1]]),
    );
    for (const e of es) expect([e.brain!.state, e.brain!.target]).toEqual(['engage', p.id]);
    expect(w.wave).toMatchObject({ index: 0, loop: 0, enemiesLeft: 5, nextIn: 0 });
    w.dispose();
  });

  it(`killing the whole wave emits waveClear; the next wave arrives WAVE_GAP (${WAVE_GAP}) ticks later; corpses are removed, never respawned`, async () => {
    const { w } = await waveWorld();
    nextWave(w);
    const first = waveEnemies(w);
    killWave(w);
    const killedAt = w.now; // the first tick after the kills
    const evs: TickEvents[] = [];
    let wave2: ReturnType<typeof nextWave> | undefined;
    for (let i = 0; i < 400 && !wave2; i++) {
      const tick = w.now;
      const ev = step(w);
      for (const e of ev) evs.push({ tick, ev: e });
      const wv = ev.find((e) => e.type === 'wave');
      if (wv?.type === 'wave') wave2 = { tick, ev: wv };
    }
    // Cleared once every body has lain 30 ticks.
    expect(ofType(evs, 'waveClear').map((x) => [x.tick - killedAt, x.ev.wave])).toEqual([[29, 1]]);
    const clearTick = ofType(evs, 'waveClear')[0].tick;
    expect(wave2!.tick - clearTick).toBe(WAVE_GAP);
    expect(wave2!.ev).toEqual({ type: 'wave', wave: 2, loop: 0, enemies: WAVES[1].length });
    expect(waveEnemies(w).map((e) => e.brain!.def)).toEqual(WAVES[1].map((s) => s.def));
    expect(w.wave).toMatchObject({ index: 1, loop: 0, enemiesLeft: WAVES[1].length });
    // Wave 1's dead were removed (not respawned).
    for (const e of first) expect(w.get(e.id)).toBeUndefined();
    expect(ofType(evs, 'respawn').length).toBe(0);
    w.dispose();
  });

  it('enemiesLeft counts down as enemies die; dead bodies are removed after a while and never come back', async () => {
    const { w, p } = await waveWorld();
    nextWave(w);
    const [a] = waveEnemies(w);
    kill(ctxOf(w), a, p);
    step(w);
    expect(w.wave!.enemiesLeft).toBe(4);
    const evs = stepN(w, 400, () => {
      keepAlive(w); // nobody else dies (the player included)
      return cmd();
    });
    expect(w.get(a.id)).toBeUndefined();
    expect(w.wave!.ids).not.toContain(a.id);
    expect(w.wave!.enemiesLeft).toBe(4);
    expect(ofType(evs, 'respawn').length).toBe(0);
    expect(ofType(evs, 'waveClear').length).toBe(0);
    w.dispose();
  });

  it('player death restarts the current wave: its enemies are removed and the wave spawns again in full', async () => {
    const { w, p } = await waveWorld();
    nextWave(w);
    w.wave!.index = 1; // pretend we are on wave 2 (indexes past 0 must be kept too)
    const before = waveEnemies(w);
    kill(ctxOf(w), before[0], p);
    kill(ctxOf(w), p, null);
    const respawnTick = stepUntil(w, (ev) => ev.some((e) => e.type === 'respawn' && e.entity === p.id), PLAYER_STATS.respawnTicks + 5);
    for (const e of before) expect(w.get(e.id), `enemy ${e.id}`).toBeUndefined();
    expect(w.entities.filter((e) => e.brain).length).toBe(0);
    expect(w.entities.filter((e) => e.projectile).length).toBe(0);
    expect(w.wave).toMatchObject({ index: 1, ids: [], enemiesLeft: 0 });
    const again = nextWave(w);
    expect(again.tick - respawnTick).toBe(START_DELAY - 1); // the 90th tick, counting the respawn tick
    expect(again.ev).toEqual({ type: 'wave', wave: 2, loop: 0, enemies: WAVES[1].length });
    expect(waveEnemies(w).map((e) => e.brain!.def)).toEqual(WAVES[1].map((s) => s.def));
    expect(p.vitals!.hp).toBe(p.vitals!.hpMax);
    w.dispose();
  });

  it('after the last wave the index loops and each loop adds a Grunt', async () => {
    const { w } = await waveWorld();
    const seen: [number, number, number][] = [];
    const clears: number[] = [];
    for (let i = 0; i < WAVES.length + 1; i++) {
      const { ev } = nextWave(w, 500);
      seen.push([ev.wave, ev.loop, ev.enemies]);
      if (i === WAVES.length) break;
      killWave(w);
      stepUntil(w, (evs) => evs.some((e) => e.type === 'waveClear'), 100);
      const clear = w.events.find((e) => e.type === 'waveClear');
      clears.push(clear?.type === 'waveClear' ? clear.wave : -1);
    }
    expect(seen).toEqual([
      [1, 0, WAVES[0].length],
      [2, 0, WAVES[1].length],
      [3, 0, WAVES[2].length],
      [4, 1, WAVES[0].length + 1],
    ]);
    expect(clears).toEqual([1, 2, 3]);
    expect(w.wave).toMatchObject({ index: 0, loop: 1 });
    const defs = waveEnemies(w).map((e) => e.brain!.def);
    expect(defs).toEqual([...WAVES[0].map((s) => s.def), 'grunt']);
    w.dispose();
  });

  it('wave state is in hash() and survives snapshot/restore', async () => {
    const { w } = await waveWorld();
    nextWave(w);
    stepN(w, 50);
    const h = w.hash();
    w.wave!.nextIn += 1;
    expect(w.hash()).not.toBe(h);
    w.wave!.nextIn -= 1;
    expect(w.hash()).toBe(h);
    w.wave!.loop = 3;
    expect(w.hash()).not.toBe(h);
    w.wave!.loop = 0;

    const snap = w.snapshot();
    const wave = structuredClone(w.wave);
    const hashes: number[] = [];
    for (let i = 0; i < 6; i++) {
      stepN(w, 50);
      hashes.push(w.hash());
    }
    w.restore(snap);
    expect(w.wave).toEqual(wave);
    for (let i = 0; i < 6; i++) {
      stepN(w, 50);
      expect(w.hash(), `tick ${w.now}`).toBe(hashes[i]);
    }
    // The snapshot is a copy: running on did not change it.
    expect(snap.wave).toEqual(wave);
    w.dispose();
  });

  it('a snapshot taken between waves spawns the next wave on the same tick after restore', async () => {
    const { w } = await waveWorld();
    nextWave(w);
    killWave(w);
    stepUntil(w, (evs) => evs.some((e) => e.type === 'waveClear'), 100);
    stepN(w, 40);
    expect(w.wave!.nextIn).toBe(WAVE_GAP - 40);
    const snap = w.snapshot();
    const a = nextWave(w);
    const ha = w.hash();
    w.restore(snap);
    const b = nextWave(w);
    expect([b.tick, b.ev]).toEqual([a.tick, a.ev]);
    expect(w.hash()).toBe(ha);
    w.dispose();
  });
});

describe('determinism with spells, statuses and waves (plan §2.2)', () => {
  /**
   * A spell-and-melee fight against the waves. Buttons depend only on the tick number; the camera
   * and stick aim at the nearest live enemy, so the fight really lands blows. That reads world
   * state, which is still deterministic: both worlds see the same state or the hashes differ.
   */
  function fight(w: SimWorld, t: number): InputCommand {
    let press = 0, hold = 0;
    if (t % 13 === 0) press |= BTN.light;
    if (t % 53 === 5) press |= BTN.spell1;
    if (t % 90 === 17) press |= BTN.spell2; // on cooldown half the time (180)
    if (t % 181 === 59) press |= BTN.spell4; // cooldown 360: about every other press lands
    if (t % 71 === 33) press |= BTN.dodge;
    if (t % 97 === 0) press |= BTN.heavy;
    if (t % 160 >= 140) hold |= BTN.block;
    if (t % 300 === 95) press |= BTN.lock;
    const p = w.playerEntity(0)!;
    let camYaw = Math.PI + Math.sin(t / 150) * 0.6;
    let forward = t % 400 < 120 ? 0.8 : 0;
    let best = Infinity;
    for (const e of w.entities) {
      if (!e.brain || e.combat?.action?.kind === 'dead') continue;
      const d = Math.hypot(e.tf.pos.x - p.tf.pos.x, e.tf.pos.z - p.tf.pos.z);
      if (d < best) {
        best = d;
        camYaw = Math.atan2(e.tf.pos.x - p.tf.pos.x, e.tf.pos.z - p.tf.pos.z);
        forward = d > 2.5 ? 0.8 : 0;
      }
    }
    // Frost Nova (5 m ring, cooldown 480) only when someone is close enough to catch in it.
    if (best < 4 && t % 30 === 0) press |= BTN.spell3;
    return cmd({ camYaw, move: { x: Math.sin(t / 40) * 0.3, y: forward }, press, hold, lockSwitch: t % 250 === 125 ? 1 : 0 });
  }

  function run(w: SimWorld, ticks: number, log?: string[]): void {
    for (let i = 0; i < ticks; i++) {
      const t = w.now;
      // Full mana every tick (same in both worlds): the point here is a varied fight, not the economy.
      const pl = w.playerEntity(0)!;
      pl.vitals!.mana = pl.vitals!.manaMax;
      for (const e of step(w, fight(w, t))) {
        if (!log) continue;
        if (e.type === 'hit') log.push(`${t} hit ${e.attacker}>${e.target} ${e.move} ${e.damage}`);
        else if (['cast', 'death', 'respawn', 'wave', 'waveClear', 'status', 'frozen', 'interrupt', 'blink', 'explode', 'zap', 'nova'].includes(e.type)) log.push(`${t} ${JSON.stringify(e)}`);
      }
    }
  }

  it('two wave worlds running the same fight hash the same every 100 ticks for 3000 ticks, and from a snapshot', async () => {
    const a = (await waveWorld()).w;
    const b = (await waveWorld()).w;
    const log: string[] = [];
    const hashes: number[] = [];
    let snap: ReturnType<SimWorld['snapshot']> | null = null;
    for (let i = 0; i < 30; i++) {
      run(a, 100, log);
      run(b, 100);
      expect(a.hash(), `tick ${a.now}`).toBe(b.hash());
      if (a.now !== 1500) continue;
      snap = a.snapshot();
      // A restore is exact for the ticks right after it. Later, characters in contact can drift by a
      // fraction of a millimetre, because Rapier's query tree is rebuilt (restore-replay.test.ts).
      for (let k = 0; k < 3; k++) {
        run(a, 1, log);
        run(b, 1);
        hashes.push(a.hash());
      }
    }
    // It really was a fight: every spell went off, both sides hit, statuses landed, enemies died.
    // Coverage of each spell and status is the job of m1b-spells / m1b-statuses; here it only
    // has to be a real, varied fight.
    const spellsCast = new Set(['bolt', 'blast', 'frostNova', 'chainZap'].filter((sp) => log.some((l) => l.includes(`"type":"cast"`) && l.includes(`"spell":"${sp}"`))));
    expect(spellsCast.size, [...spellsCast].join(',')).toBeGreaterThanOrEqual(3);
    expect(log.filter((l) => / hit 1>/.test(l)).length).toBeGreaterThan(15);
    expect(log.some((l) => / hit \d+>1 /.test(l))).toBe(true);
    const statuses = new Set(['burn', 'chill', 'shock'].filter((st) => log.some((l) => l.includes(`"status":"${st}"`))));
    expect(statuses.size, [...statuses].join(',')).toBeGreaterThanOrEqual(2);
    expect(log.some((l) => l.includes('"type":"death"'))).toBe(true);
    expect(log.some((l) => l.includes('"type":"wave"'))).toBe(true);

    // From the snapshot at tick 1500, the same ticks again.
    b.restore(snap!);
    for (let i = 0; i < hashes.length; i++) {
      run(b, 1);
      expect(b.hash(), `restored, tick ${b.now}`).toBe(hashes[i]);
    }
    a.dispose();
    b.dispose();
  });
});
