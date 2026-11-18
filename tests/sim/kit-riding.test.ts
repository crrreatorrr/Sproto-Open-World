import { describe, expect, it } from 'vitest';
import { PLAYER_STATS } from '../../src/content/combat';
import { MOUNT } from '../../src/content/mounts';
import { migrate } from '../../src/save/migrations';
import { kill } from '../../src/sim/combat/hits';
import type { Entity } from '../../src/sim/entity';
import type { SimWorld } from '../../src/sim/SimWorld';
import { BTN, press, step, stepN } from './combatHelpers';
import { ctxOf } from './m1bHelpers';
import { evs, interact, ui } from './m3Helpers';
import { flatSproutvale, standAt } from './m4Helpers';

/** Getting on and off the bull in every state the player can be in. */

const bullOf = (w: SimWorld) => w.entities.find((e) => e.mount)!;

function nextToBull(w: SimWorld): Entity {
  const bull = bullOf(w);
  standAt(w, bull.tf.pos.x - 2, bull.tf.pos.z, bull.tf.pos);
  return bull;
}

function mountUp(w: SimWorld): Entity {
  const bull = nextToBull(w);
  step(w, interact());
  stepN(w, MOUNT.mountTicks + 1);
  return bull;
}

describe('getting on', () => {
  it('is refused while dead', async () => {
    const { w, p } = await flatSproutvale();
    const bull = nextToBull(w);
    kill(ctxOf(w), p, null);
    step(w, interact());
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });

  it('is refused in a menu', async () => {
    const { w, p } = await flatSproutvale();
    const bull = nextToBull(w);
    p.progress!.atShrine = 'shrine_first_light';
    step(w, interact());
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });

  it('is refused in the middle of a swing', async () => {
    const { w, p } = await flatSproutvale();
    const bull = nextToBull(w);
    step(w, press(BTN.light));
    expect(p.combat!.action?.kind).toBe('attack');
    step(w, interact());
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });

  it('dying on the way up frees the bull', async () => {
    const { w, p } = await flatSproutvale();
    const bull = nextToBull(w);
    step(w, interact());
    expect(p.riding?.state).toBe('mounting');
    kill(ctxOf(w), p, null);
    step(w);
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });
});

describe('in the saddle', () => {
  it('a menu opened while riding leaves you riding and takes no input', async () => {
    const { w, p } = await flatSproutvale();
    mountUp(w);
    expect(p.riding?.state).toBe('riding');
    p.progress!.atShrine = 'shrine_first_light';
    step(w, interact());
    expect(p.riding?.state).toBe('riding');
    step(w, ui([{ kind: 'closeMenu' }]));
    expect(p.progress!.atShrine).toBeNull();
    w.dispose();
  });

  it('getting off is refused mid-swing, then works', async () => {
    const { w, p } = await flatSproutvale();
    mountUp(w);
    step(w, press(BTN.light));
    step(w, interact());
    expect(p.riding?.state).toBe('riding');
    for (let i = 0; i < 120 && p.combat!.action; i++) step(w);
    step(w, interact());
    expect(p.riding?.state).toBe('dismounting');
    stepN(w, MOUNT.dismountTicks + 1);
    expect(p.riding).toBeUndefined();
    expect(p.combat!.action).toBeNull();
    w.dispose();
  });

  it('a hit while getting off lands you on foot, with the bull free', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    step(w, interact());
    p.combat!.action = { kind: 'hitstun', t: 0, dur: 5, knockdown: false };
    step(w);
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });

  it('a teleport keeps the bull under you', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    w.teleportPlayer(0, { x: p.tf.pos.x + 12, y: p.tf.pos.y + 0.05, z: p.tf.pos.z });
    stepN(w, 3);
    expect(p.riding?.state).toBe('riding');
    expect(Math.hypot(bull.tf.pos.x - p.tf.pos.x, bull.tf.pos.z - p.tf.pos.z)).toBeLessThan(0.01);
    w.dispose();
  });

  it('death and the respawn: on foot, the bull free to ride again', async () => {
    const { w, p } = await flatSproutvale();
    const bull = mountUp(w);
    kill(ctxOf(w), p, null);
    stepN(w, PLAYER_STATS.respawnTicks + 3);
    expect(p.combat!.action).toBeNull();
    expect(p.riding).toBeUndefined();
    expect(bull.mount!.rider).toBeNull();
    w.dispose();
  });
});

describe('across a save', () => {
  it('a save made in the saddle loads on foot with the bull free', async () => {
    const { w } = await flatSproutvale();
    mountUp(w);
    const file = migrate(JSON.parse(JSON.stringify(w.toSave({ savedAt: 'then', build: 'test', region: 'sproutvale' }))));
    expect(JSON.stringify(file)).not.toContain('riding');
    const b = await flatSproutvale();
    b.w.applySave(file);
    expect(b.p.riding).toBeUndefined();
    expect(bullOf(b.w).mount!.rider).toBeNull();
    expect(evs(step(b.w), 'refused')).toEqual([]);
    w.dispose();
    b.w.dispose();
  });
});
