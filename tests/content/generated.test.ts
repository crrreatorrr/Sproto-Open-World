import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PLAYER_HITBOXES } from '../../src/content/generated/playerHitboxes';
import { PLAYER_MOVE_TIMING } from '../../src/content/generated/playerMoveTiming';

const json = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../public/assets/models/characters/player.melee.json'), 'utf8')) as {
  clips: Record<string, { active?: [number, number]; cancel?: number; end: number }>;
};
const ticks = (s: number) => Math.round(s * 60);

describe('generated player move data', () => {
  it('timing equals player.melee.json converted to 60 Hz ticks', () => {
    for (const [name, t] of Object.entries(json.clips)) {
      const g = PLAYER_MOVE_TIMING[name as keyof typeof PLAYER_MOVE_TIMING] as Record<string, number>;
      expect(g.end, name).toBe(ticks(t.end));
      if (t.active) {
        expect(g.activeStart, name).toBe(ticks(t.active[0]));
        expect(g.activeEnd, name).toBe(ticks(t.active[1]));
      }
      if (t.cancel !== undefined) expect(g.cancel, name).toBe(ticks(t.cancel));
    }
  });

  it('every attack has one staff capsule per active tick, near the player and about a staff long', () => {
    for (const [name, t] of Object.entries(PLAYER_MOVE_TIMING) as [string, Record<string, number>][]) {
      if (t.activeStart === undefined) continue;
      const boxes = PLAYER_HITBOXES[name];
      expect(boxes.map((b) => b.tick), name).toEqual(Array.from({ length: t.activeEnd - t.activeStart }, (_, i) => t.activeStart + i));
      for (const { a, b } of boxes) {
        const len = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        expect(len, name).toBeGreaterThan(1.7);
        expect(len, name).toBeLessThan(2.1);
        for (const p of [a, b]) expect(Math.hypot(p[0], p[2]), name).toBeLessThan(2.2);
      }
    }
  });
});
