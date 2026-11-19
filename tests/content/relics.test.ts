import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { QUESTS, type QuestDef } from '../../src/content/quests';
import { C4_QUESTS } from '../../src/content/packs/c4';
import { C5_QUESTS } from '../../src/content/packs/c5';
import { C6_QUESTS } from '../../src/content/packs/c6';
import { Q_SCRAPJAW } from '../../src/content/packs/m5';
import { RELIC_COPY } from '../../src/content/relicCopy';
import {
  BONUS_REWARDS, HOPEGLASS_SLOWS_WORLD, KEEPSAKES, PARRY_WINDOW_CAP, RELIC_SOCKETS, TOTEM_SOCKETS,
  capBlockMessage, keepsakeForQuest, relicMods, relicShortfall, totemMods, wonToast,
} from '../../src/content/relics';

const gives = (quest: QuestDef, step: string): string[] =>
  (quest.steps.find((s) => s.id === step)?.onComplete ?? []).flatMap((e) => ('give' in e ? [e.give] : []));

describe('keepsake catalog', () => {
  it('is 10 relics and 8 totems, with the plan names', () => {
    expect(KEEPSAKES.filter((k) => k.kind === 'relic')).toHaveLength(10);
    expect(KEEPSAKES.filter((k) => k.kind === 'totem')).toHaveLength(8);
    expect(KEEPSAKES.map((k) => k.name)).toContain('Coins of the Drowned Kingdom');
    expect(KEEPSAKES.map((k) => k.name)).toContain("Tinubu's Broken Seal");
    expect(KEEPSAKES.map((k) => k.name)).toContain("Elder's Hearth");
    expect(new Set(KEEPSAKES.map((k) => k.id)).size).toBe(18);
  });

  it('uses the plan defaults: 3 sockets, 1 totem, 300 ms parry cap, solo Hopeglass', () => {
    expect(RELIC_SOCKETS).toBe(3);
    expect(TOTEM_SOCKETS).toBe(1);
    expect(PARRY_WINDOW_CAP).toBe(18);
    expect(HOPEGLASS_SLOWS_WORLD).toBe(true);
  });

  it('coins add 4 ticks in solo and 2 in co-op, and never pass 18', () => {
    expect(relicMods(['relic_drowned_coins'], false).parryTicks).toBe(16);
    expect(relicMods(['relic_drowned_coins'], true).parryTicks).toBe(14);
    expect(relicMods(['relic_drowned_coins', 'relic_drowned_coins'], false).parryTicks).toBeLessThanOrEqual(18);
  });

  it('halves the mash penalty, lengthens a roll, and floors sprint at 7', () => {
    const mods = relicMods(['relic_gatekeepers_grip', 'relic_sprotos_stride', 'relic_drakeplume'], false);
    expect(mods.spamParryTicks).toBe(8);
    expect(mods.iframeEnd).toBe(20);
    expect(mods.perfectEnd).toBe(12);
    expect(relicMods(['relic_sprotos_stride'], true).iframeEnd).toBe(18);
    expect(mods.sprintPerSec).toBeCloseTo(8.4);
    expect(mods.plungeLagMul).toBe(0.5);
  });

  it('caps block stamina, the rivet and the briar, and marks Hopeglass solo', () => {
    const solo = relicMods(['relic_deepbreath_bellows', 'relic_elder_iron_rivet', 'relic_surgebriar', 'relic_hopeglass'], false);
    expect(solo.blockStaminaMul).toBeCloseTo(0.75);
    expect(relicMods(['relic_deepbreath_bellows'], true).blockStaminaMul).toBeCloseTo(0.85);
    expect(solo.guardCounterChance).toBeCloseTo(0.1);
    expect(relicMods(['relic_elder_iron_rivet'], true).guardCounterChance).toBeCloseTo(0.05);
    expect(solo.briarChance).toBeCloseTo(0.08);
    expect(solo.hopeglass).toEqual({ slowTicks: 30, cooldown: 300, coopHitstop: 10 });
    expect(totemMods('totem_turnstone', false).reflectEvery).toBe(240);
    expect(totemMods('totem_turnstone', true).reflectEvery).toBe(360);
    expect(totemMods('totem_earthspeaker_stake', true).moveMul).toBe(1);
    expect(totemMods('totem_earthspeaker_stake', false).decalLead).toBe(10);
  });

  it('says when a further parry relic would add nothing', () => {
    expect(relicShortfall('relic_drowned_coins', [], false)).toBe(0);
    expect(capBlockMessage('relic_drowned_coins', [], false)).toBeNull();
  });

  it('maps each icon slug to its item id, and the files match the spec', async () => {
    const slugs = [
      ['relic_drowned_coins', 'coins-of-the-drowned-kingdom'],
      ['relic_gatekeepers_grip', 'gatekeepers-grip'],
      ['relic_hopeglass', 'hopeglass'],
      ['relic_sprotos_stride', 'sprotos-stride'],
      ['relic_tinubus_broken_seal', 'tinubus-broken-seal'],
      ['relic_oracles_eye', 'oracles-eye'],
      ['relic_deepbreath_bellows', 'deepbreath-bellows'],
      ['relic_elder_iron_rivet', 'elder-iron-rivet'],
      ['relic_surgebriar', 'surgebriar'],
      ['relic_drakeplume', 'drakeplume'],
      ['totem_elders_hearth', 'elders-hearth'],
      ['totem_field_warden', 'field-warden'],
      ['totem_seekers_lantern', 'seekers-lantern'],
      ['totem_turnstone', 'turnstone'],
      ['totem_elders_seed', 'elders-seed'],
      ['totem_earthspeaker_stake', 'earthspeaker-stake'],
      ['totem_ember_quench_pail', 'ember-quench-pail'],
      ['totem_skylure_post', 'skylure-post'],
    ] as const;
    expect(KEEPSAKES.map((k) => [k.id, k.slug])).toEqual(slugs.map(([id, slug]) => [id, slug]));
    for (const [, slug] of slugs) {
      const png = path.join('public/assets/icons/keepsakes', `${slug}.png`);
      const svg = path.join('public/assets/icons/keepsakes', `${slug}.svg`);
      const meta = await sharp(png).metadata();
      expect(meta, slug).toMatchObject({ width: 128, height: 128 });
      const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      const opaque = (x: number, y: number) => data[(y * info.width + x) * info.channels + 3] > 8;
      for (let i = 0; i < 8; i++) {
        for (let x = 0; x < info.width; x++) expect(opaque(x, i) || opaque(x, info.height - 1 - i), `${slug} padding`).toBe(false);
        for (let y = 0; y < info.height; y++) expect(opaque(i, y) || opaque(info.width - 1 - i, y), `${slug} padding`).toBe(false);
      }
      const text = readFileSync(svg, 'utf8');
      expect(text).toContain('viewBox="0 0 24 24"');
      expect(text).toContain('currentColor');
      const paints = [...text.matchAll(/(?:fill|stroke)="([^"]+)"/g)].map((m) => m[1]);
      expect(paints.every((c) => c === 'currentColor' || c === 'none'), slug).toBe(true);
    }
  });

  it('names the eight totem GLBs from the Blender spec, and does not ship the files', () => {
    const totems = KEEPSAKES.filter((k) => k.kind === 'totem');
    expect(totems.map((k) => RELIC_COPY[k.id].model)).toEqual([
      'models/totems/totem_elders_hearth.glb',
      'models/totems/totem_field_warden.glb',
      'models/totems/totem_seekers_lantern.glb',
      'models/totems/totem_turnstone.glb',
      'models/totems/totem_elders_seed.glb',
      'models/totems/totem_earthspeaker_stake.glb',
      'models/totems/totem_ember_quench_pail.glb',
      'models/totems/totem_skylure_post.glb',
    ]);
    expect(existsSync('public/assets/models/totems')).toBe(false);
  });

  it('toasts a relic with the equip hint only the first time', () => {
    expect(wonToast('relic_hopeglass', true)).toContain('Relic won: Hopeglass');
    expect(wonToast('relic_hopeglass', true)).toContain('hold I');
    expect(wonToast('relic_hopeglass', false)).not.toContain('hold I');
    expect(wonToast('totem_elders_hearth', true)).toBe("Totem won: Elder's Hearth");
  });
});

describe('reward map', () => {
  it('gives the guaranteed keepsakes from the step the plan names', () => {
    expect(gives(QUESTS.q_wake_up, 'shrine')).toContain('totem_elders_hearth');
    expect(gives(QUESTS.q_pest_control, 'grunts')).toContain('totem_field_warden');
    expect(gives(QUESTS.q_thornwood, 'gatekeeper')).toContain('relic_gatekeepers_grip');
    expect(gives(QUESTS.q_mill, 'coin')).toContain('relic_tinubus_broken_seal');
    expect(gives(QUESTS.q_relics, 'return')).toContain('totem_seekers_lantern');
    expect(gives(C4_QUESTS.q_rivet_volley, 'return')).toContain('totem_turnstone');
    expect(gives(C4_QUESTS.q_lens_flare, 'lens')).toContain('relic_oracles_eye');
    expect(gives(C4_QUESTS.q_weavers_thorns, 'return')).toContain('relic_surgebriar');
    expect(gives(C5_QUESTS.q_elders_garden, 'shrines')).toContain('totem_elders_seed');
    expect(gives(C5_QUESTS.q_tremors, 'seam')).toContain('totem_earthspeaker_stake');
    expect(gives(C5_QUESTS.q_deep_seam, 'boss')).toContain('relic_deepbreath_bellows');
    expect(gives(C6_QUESTS.q_smoke_hills, 'hay')).toContain('totem_ember_quench_pail');
    expect(gives(C6_QUESTS.q_bait, 'post')).toContain('totem_skylure_post');
    expect(gives(C6_QUESTS.q_skyfire, 'boss')).toContain('relic_drakeplume');
    expect(gives(Q_SCRAPJAW, 'boss')).toContain('relic_hopeglass');
  });

  it('codes the bonus feats and the fallback quests', () => {
    expect(BONUS_REWARDS.map((b) => [b.id, b.feat, b.count, b.fallbackQuest])).toEqual([
      ['relic_drowned_coins', 'reflectKill', 3, 'q_thornwood'],
      ['relic_elder_iron_rivet', 'reflectKill', 2, null],
      ['relic_sprotos_stride', 'perfectDodge', 3, 'q_scrapjaw'],
    ]);
    expect(QUESTS.q_thornwood.rewards.some((e) => 'give' in e && e.give === 'relic_drowned_coins')).toBe(true);
    expect(Q_SCRAPJAW.rewards.some((e) => 'give' in e && e.give === 'relic_sprotos_stride')).toBe(true);
    expect(keepsakeForQuest('q_pumpkins')).toBeUndefined();
  });
});
