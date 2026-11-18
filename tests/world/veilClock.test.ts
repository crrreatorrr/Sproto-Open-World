import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorldSession } from '../../src/app/WorldSession';
import type { CellView } from '../../src/world/CellStreamer';
import { VEIL_TIMEOUT_MS } from '../../src/world/rings';

describe('the loading veil timeout', () => {
  afterEach(() => vi.restoreAllMocks());

  it('a pause does not count: the clock starts over on resume', () => {
    const now = vi.spyOn(performance, 'now');
    const s = new WorldSession(null as never, null as never);
    (s as unknown as { streamer: unknown }).streamer = { groundReady: () => false };
    const ground = (t: number) => {
      now.mockReturnValue(t);
      return s.ground({} as CellView, { x: 0, z: 0 });
    };
    expect(ground(0)).toBe('loading');
    now.mockReturnValue(VEIL_TIMEOUT_MS * 3);
    s.restartVeilClock();
    expect(ground(VEIL_TIMEOUT_MS * 3 + 1)).toBe('loading');
    expect(ground(VEIL_TIMEOUT_MS * 4)).toBe('timeout');
  });

  it('with no veil up there is no clock to restart', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(5);
    const s = new WorldSession(null as never, null as never);
    (s as unknown as { streamer: unknown }).streamer = { groundReady: (_v: unknown, _x: number, _z: number, fresh: boolean) => { expect(fresh).toBe(true); return true; } };
    s.restartVeilClock();
    expect(s.ground({} as CellView, { x: 0, z: 0 })).toBe('ready');
    expect(now).not.toHaveBeenCalled();
  });
});
