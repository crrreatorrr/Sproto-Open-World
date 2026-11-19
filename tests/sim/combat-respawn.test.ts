import { describe, expect, it } from 'vitest';
import { HITSTOP_CAP, PLAYER_STATS } from '../../src/content/combat';
import { ENEMIES } from '../../src/content/enemies';
import { flatDist } from '../../src/sim/combat/geometry';
import { BTN, combatWorld, hitsOn, idle, ofType, press, step, stepN, stepUntil } from './combatHelpers';

/** Plan §2.9: death in the M1 sandbox respawns at the spawn after 2 s with full resources. */
describe('sandbox death and respawn', () => {
  it('player HP to 0 → dead; respawn after respawnTicks at the spawn with full resources; enemies reset home', async () => {
    const { w, p } = await combatWorld({ pos: { x: 3, y: 0, z: 2 }, yaw: 1 });
    const home = { x: 3, y: 0, z: 9 };
    const b = w.spawnEnemy('brute', home, Math.PI);
    p.vitals!.hp = 1;
    p.vitals!.stamina = 10;
    p.vitals!.mana = 5;
    p.vitals!.staminaDelay = 9999;

    const deathTick = stepUntil(w, (ev) => ev.some((e) => e.type === 'death' && e.entity === p.id), 400);
    expect(p.vitals!.hp).toBe(0);
    expect(p.combat!.action?.kind).toBe('dead');
    expect(flatDist(b.tf.pos, home)).toBeGreaterThan(1); // it came to fight (its long arms don't need to come far)
    const killingHitstop = p.combat!.hitstop;

    // While dead: nothing hits the player and presses do nothing.
    const evs = stepN(w, PLAYER_STATS.respawnTicks + HITSTOP_CAP + 5);
    const respawn = ofType(evs, 'respawn').filter((x) => x.ev.entity === p.id);
    expect(respawn.length).toBe(1);
    expect(hitsOn(evs.filter((x) => x.tick < respawn[0].tick), p.id)).toEqual([]);
    const after = respawn[0].tick - deathTick;
    expect(after).toBeGreaterThanOrEqual(PLAYER_STATS.respawnTicks);
    expect(after).toBeLessThanOrEqual(PLAYER_STATS.respawnTicks + killingHitstop);
    w.dispose();
  });

  it('the respawn tick resets the player and the yard', async () => {
    const { w, p } = await combatWorld({ pos: { x: 3, y: 0, z: 2 }, yaw: 1 });
    const home = { x: 3, y: 0, z: 9 };
    const b = w.spawnEnemy('brute', home, Math.PI);
    const dummy = w.spawnEnemy('dummy_passive', { x: -5, y: 0, z: 0 }, 0);
    dummy.vitals!.hp = 123;
    p.vitals!.hp = 1;
    p.vitals!.stamina = 10;
    p.vitals!.mana = 5;
    p.vitals!.staminaDelay = 9999;
    stepUntil(w, (ev) => ev.some((e) => e.type === 'death' && e.entity === p.id), 400);
    b.vitals!.hp = 77;
    const respawnTick = stepUntil(w, (ev) => ev.some((e) => e.type === 'respawn' && e.entity === p.id), 200);
    expect(respawnTick).toBeGreaterThan(0);
    // Player: spawn point and yaw, full HP, stamina and mana, free, no lock, no buffer.
    expect(p.tf.pos).toEqual({ x: 0, y: 0, z: 0 });
    expect(p.tf.yaw).toBe(0);
    expect(p.vitals!.hp).toBe(PLAYER_STATS.hp);
    expect(p.vitals!.stamina).toBe(PLAYER_STATS.stamina);
    expect(p.vitals!.mana).toBe(PLAYER_STATS.mana);
    expect(p.combat!.action).toBeNull();
    expect(p.combat!.buffer).toBeNull();
    expect(p.combat!.lock).toBeNull();
    expect(p.combat!.hitstop).toBe(0);
    // Enemies: home, full HP, idle.
    expect(b.tf.pos).toEqual(home);
    expect(b.tf.yaw).toBe(Math.PI);
    expect(b.vitals!.hp).toBe(ENEMIES.brute.hp);
    expect(b.brain!.state).toBe('idle');
    expect(b.combat!.action).toBeNull();
    expect(dummy.vitals!.hp).toBe(ENEMIES.dummy_passive.hp);
    // And the player can act again straight away.
    step(w);
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('an enemy that dies respawns at home after its own respawnTicks', async () => {
    const { w } = await combatWorld();
    const home = { x: 0, y: 0, z: 1.9 };
    const b = w.spawnEnemy('brute', home, Math.PI);
    b.vitals!.hp = 1;
    const evs = stepN(w, 30, (i) => (i === 0 ? press(BTN.light) : idle()));
    const death = ofType(evs, 'death').find((x) => x.ev.entity === b.id)!;
    expect(death.ev.killer).toBe(w.playerEntity(0)!.id);
    expect(b.combat!.action?.kind).toBe('dead');
    const back = stepUntil(w, (ev) => ev.some((e) => e.type === 'respawn' && e.entity === b.id), 400);
    // Frozen hit-stop ticks after the killing blow don't count toward the respawn clock.
    expect(back - death.tick).toBeGreaterThanOrEqual(ENEMIES.brute.respawnTicks);
    expect(back - death.tick).toBeLessThanOrEqual(ENEMIES.brute.respawnTicks + HITSTOP_CAP);
    expect(b.vitals!.hp).toBe(ENEMIES.brute.hp);
    expect(b.tf.pos).toEqual(home);
    w.dispose();
  });
});
