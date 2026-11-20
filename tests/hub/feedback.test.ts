import { describe, expect, it } from 'vitest';
import { breadcrumbFor } from '../../src/hub/feedback';
import { LOCAL_SERVER_KEY, nakamaServerKey } from '../../src/hub/serverKey';
import { RESERVED_KEYS, bindKey, defaultControlPrefs } from '../../src/input/controlPrefs';
import type { SimEvent } from '../../src/sim/events';

const ME = 7;

describe('feedback breadcrumbs', () => {
  it('records the local player’s milestones and the world’s', () => {
    expect(breadcrumbFor({ type: 'death', entity: ME, killer: 3 }, ME)).toEqual({ type: 'death', data: { killer: 3 } });
    expect(breadcrumbFor({ type: 'questComplete', entity: ME, quest: 'q1' }, ME)).toEqual({ type: 'quest_complete', data: { quest: 'q1' } });
    expect(breadcrumbFor({ type: 'levelUp', entity: ME, level: 4, points: 1 }, ME)).toEqual({ type: 'level_up', data: { level: 4 } });
    expect(breadcrumbFor({ type: 'bossPhase', boss: 9, phase: 2 }, ME)).toEqual({ type: 'boss_phase', data: { boss: 9, phase: 2 } });
    expect(breadcrumbFor({ type: 'mount', entity: ME, mount: 2, phase: 'seated' }, ME)).toEqual({ type: 'mounted' });
  });

  it('skips other entities’ events and the per-hit noise', () => {
    expect(breadcrumbFor({ type: 'death', entity: 12, killer: ME }, ME)).toBeNull();
    expect(breadcrumbFor({ type: 'questComplete', entity: 12, quest: 'q1' }, ME)).toBeNull();
    expect(breadcrumbFor({ type: 'mount', entity: ME, mount: 2, phase: 'start' }, ME)).toBeNull();
    const hit = { type: 'hit', attacker: ME, target: 12 } as unknown as SimEvent;
    expect(breadcrumbFor(hit, ME)).toBeNull();
    expect(breadcrumbFor({ type: 'jump', entity: ME }, ME)).toBeNull();
  });
});

describe('the Nakama server key', () => {
  it('takes the build key, else the stock key in dev or on loopback, else none', () => {
    expect(nakamaServerKey({ envKey: 'k', dev: false, hostname: 'example.com' })).toBe('k');
    expect(nakamaServerKey({ dev: true, hostname: 'example.com' })).toBe(LOCAL_SERVER_KEY);
    expect(nakamaServerKey({ dev: false, hostname: '127.0.0.1' })).toBe(LOCAL_SERVER_KEY);
    expect(nakamaServerKey({ dev: false, hostname: 'localhost' })).toBe(LOCAL_SERVER_KEY);
    expect(nakamaServerKey({ dev: false, hostname: 'example.com' })).toBe('');
  });
});

describe('N belongs to the feedback window', () => {
  it('cannot be bound to an action', () => {
    expect(RESERVED_KEYS.has('KeyN')).toBe(true);
    const r = bindKey(defaultControlPrefs(), 'jump', 1, 'KeyN');
    expect(r.ok).toBe(false);
  });
});
