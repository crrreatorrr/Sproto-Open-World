import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { MODELS } from '../../src/assets/manifest';
import { GUN_ITEMS } from '../../src/content/classes';
import { ENEMIES } from '../../src/content/enemies';
import { GUN_ITEM_IDS } from '../../src/content/guns';
import {
  DUNGEON_IDS,
  DUNGEON_PORTAL_BY_ID,
  DUNGEON_PORTALS,
  OVERWORLD_MIX_CAMPS,
  WEAPON_BOX_SHOPS,
} from '../../src/content/packs/overworldMix';
import {
  SHOOTER_ENEMIES,
  SHOOTER_ENEMY_IDS,
  SHOOTER_HITZONES,
  SHOOTER_LOOT,
} from '../../src/content/shooterEnemies';
import { cellColliders } from '../../src/content/world/codec';
import { CELL_SIZE, cellOf, type CellData, type ColliderShape, type RegionManifest } from '../../src/content/world/format';
import { REGIONS, regionAt, type RegionId } from '../../src/content/world/regions';

function inRegionRect(regionId: RegionId, x: number, z: number): boolean {
  const r = REGIONS.find((reg) => reg.id === regionId);
  if (!r) return false;
  const x0 = r.origin[0] * CELL_SIZE;
  const z0 = r.origin[1] * CELL_SIZE;
  return x >= x0 && z >= z0 && x < x0 + r.size[0] * CELL_SIZE && z < z0 + r.size[1] * CELL_SIZE;
}

describe('shooterEnemies', () => {
  it('every Shooter enemy and stage model uses a valid key in MODELS', () => {
    for (const id of SHOOTER_ENEMY_IDS) {
      const def = SHOOTER_ENEMIES[id];
      expect(def, `missing ShooterEnemyDef for ${id}`).toBeDefined();
      expect(def.id).toBe(id);
      expect(def.model in MODELS, `${id} model "${def.model}" not in MODELS`).toBe(true);
      if (def.stageModels) {
        for (const m of def.stageModels) {
          expect(m in MODELS, `${id} stageModel "${m}" not in MODELS`).toBe(true);
        }
      }
      expect(def.moves.length, `${id} should have at least one move`).toBeGreaterThan(0);
    }
  });

  it('every Shooter enemy has valid multi-zone hitboxes (weak + body, plus shield on heavies/bosses)', () => {
    for (const id of SHOOTER_ENEMY_IDS) {
      const zones = SHOOTER_HITZONES[id];
      expect(zones.length, `${id} missing hitzones`).toBeGreaterThanOrEqual(2);
      expect(zones.some((z) => z.kind === 'weak'), `${id} missing weak hitzone`).toBe(true);
      expect(zones.some((z) => z.kind === 'body'), `${id} missing body hitzone`).toBe(true);
      for (const z of zones) {
        expect(z.radius).toBeGreaterThan(0);
        expect(z.mult).toBeGreaterThan(0);
      }
    }

    const bigObamaZones = SHOOTER_HITZONES.big_bitcoin_obama;
    expect(bigObamaZones.some((z) => z.kind === 'shield' && z.forward > 0)).toBe(true);
    expect(bigObamaZones.some((z) => z.kind === 'weak' && z.forward < 0)).toBe(true);
  });

  it('every loot gun ID exists in GUN_ITEMS and all 9 fixed guns drop across SHOOTER_LOOT', () => {
    const droppedGuns = new Set<string>();
    for (const id of SHOOTER_ENEMY_IDS) {
      const table = SHOOTER_LOOT[id];
      expect(table, `missing loot table for ${id}`).toBeDefined();
      expect(table.sprouts[0]).toBeGreaterThan(0);
      expect(table.sprouts[1]).toBeGreaterThanOrEqual(table.sprouts[0]);
      expect(table.ammo.length).toBeGreaterThan(0);
      for (const g of table.guns) {
        expect(g.item in GUN_ITEMS, `${id} drops unknown gun "${g.item}"`).toBe(true);
        expect(g.chance).toBeGreaterThan(0);
        expect(g.chance).toBeLessThanOrEqual(1);
        droppedGuns.add(g.item);
      }
      for (const it of table.items ?? []) {
        expect(it.item in GUN_ITEMS, `${id} items entry "${it.item}" not in GUN_ITEMS`).toBe(true);
      }
    }
    for (const gunId of GUN_ITEM_IDS) {
      expect(droppedGuns.has(gunId), `fixed gun "${gunId}" missing from SHOOTER_LOOT`).toBe(true);
    }
  });
});

describe('overworldMix', () => {
  it('covers all 6 walkable overworld regions with mixed camps scaling Lv 1–30', () => {
    const walkableRegions = REGIONS.filter((r) => r.overworld).map((r) => r.id);
    const covered = new Set(OVERWORLD_MIX_CAMPS.map((c) => c.region));
    for (const r of walkableRegions) {
      expect(covered.has(r), `overworld region "${r}" has no mixed camps`).toBe(true);
    }

    let minLv = Infinity;
    let maxLv = -Infinity;
    const campIds = new Set<string>();

    for (const camp of OVERWORLD_MIX_CAMPS) {
      expect(campIds.has(camp.id), `duplicate camp id "${camp.id}"`).toBe(false);
      campIds.add(camp.id);

      const [x, , z] = camp.pos;
      expect(inRegionRect(camp.region, x, z), `camp ${camp.id} outside ${camp.region} rect`).toBe(true);
      expect(regionAt(x, z).id, `regionAt(${x}, ${z}) != ${camp.region} for ${camp.id}`).toBe(camp.region);

      expect(camp.levelRange[0]).toBeGreaterThanOrEqual(1);
      expect(camp.levelRange[1]).toBeLessThanOrEqual(30);
      expect(camp.levelRange[1]).toBeGreaterThanOrEqual(camp.levelRange[0]);
      minLv = Math.min(minLv, camp.levelRange[0]);
      maxLv = Math.max(maxLv, camp.levelRange[1]);

      for (const m of camp.members) {
        const known = m.def in ENEMIES || m.def in SHOOTER_ENEMIES;
        expect(known, `camp ${camp.id} member "${m.def}" not in ENEMIES or SHOOTER_ENEMIES`).toBe(true);
        const mx = x + m.at[0];
        const mz = z + m.at[1];
        expect(
          regionAt(mx, mz).id,
          `camp ${camp.id} member ${m.def} at (${mx}, ${mz}) outside ${camp.region}`,
        ).toBe(camp.region);
      }
    }

    expect(minLv).toBe(1);
    expect(maxLv).toBe(30);
    expect(OVERWORLD_MIX_CAMPS.some((c) => c.isWorldBoss)).toBe(true);
  });

  it('Weapon Box shops are priced in Sprouts, inside their regions, and stock all 9 fixed guns', () => {
    const stockedGuns = new Set<string>();
    const shopIds = new Set<string>();

    for (const shop of WEAPON_BOX_SHOPS) {
      expect(shopIds.has(shop.id), `duplicate shop id "${shop.id}"`).toBe(false);
      shopIds.add(shop.id);
      expect(shop.currency).toBe('sprouts');

      const [x, , z] = shop.pos;
      expect(inRegionRect(shop.region, x, z), `shop ${shop.id} outside ${shop.region} rect`).toBe(true);
      expect(regionAt(x, z).id, `regionAt(${x}, ${z}) != ${shop.region} for ${shop.id}`).toBe(shop.region);

      for (const g of shop.guns) {
        expect(g.item in GUN_ITEMS, `shop ${shop.id} stocks unknown gun "${g.item}"`).toBe(true);
        expect(g.price).toBeGreaterThan(0);
        stockedGuns.add(g.item);
      }
      expect(shop.ammoBundles.length).toBeGreaterThanOrEqual(4);
      for (const a of shop.ammoBundles) {
        expect(a.amount).toBeGreaterThan(0);
        expect(a.price).toBeGreaterThan(0);
      }
    }

    for (const gunId of GUN_ITEM_IDS) {
      expect(stockedGuns.has(gunId), `fixed gun "${gunId}" missing from WEAPON_BOX_SHOPS`).toBe(true);
    }
  });

  it('no Weapon Box merchant stands on a prop collider (it would settle on top and hover: WORLD-0003)', () => {
    const PUBLIC = path.resolve(__dirname, '../../public');
    /** How far a point is outside a collider's footprint on the ground (0 or less: over it). */
    const outside = (s: ColliderShape, x: number, z: number): number => {
      const dx = x - s.pos[0], dz = z - s.pos[2];
      if (s.kind === 'cylinder') return Math.hypot(dx, dz) - s.radius;
      // Into the box's frame (the sim turns it by `yaw` about y).
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const ox = Math.abs(dx * c - dz * sn) - s.half[0], oz = Math.abs(dx * sn + dz * c) - s.half[2];
      return ox <= 0 && oz <= 0 ? Math.max(ox, oz) : Math.hypot(Math.max(ox, 0), Math.max(oz, 0));
    };
    for (const shop of WEAPON_BOX_SHOPS) {
      const [x, , z] = shop.pos;
      const manifest = JSON.parse(fs.readFileSync(path.join(PUBLIC, `world/${shop.region}/region.json`), 'utf8')) as RegionManifest;
      const [cx, cz] = cellOf(x, z);
      for (const c of manifest.cells) {
        if (Math.abs(c.cx - cx) > 1 || Math.abs(c.cz - cz) > 1) continue;
        const data = JSON.parse(fs.readFileSync(path.join(PUBLIC, c.json), 'utf8')) as CellData;
        for (const s of cellColliders(data, new Float32Array(0), manifest).shapes) {
          // The settle ray drops from the merchant's own x, z: keep that point clear of every footprint.
          expect(outside(s, x, z), `shop ${shop.id} is over the ${s.kind} collider at ${s.pos}`).toBeGreaterThan(0.25);
        }
      }
    }
  });

  it('all 10 dungeons L01–L10 have unique portals inside their declared regions covering Lv 3–30', () => {
    expect(DUNGEON_PORTALS.length).toBe(10);

    const seenDungeonIds = new Set<string>();
    const seenPortalIds = new Set<string>();
    const seenWaypoints = new Set<string>();
    const seenFlags = new Set<string>();

    let minLv = Infinity;
    let maxLv = -Infinity;

    for (const portal of DUNGEON_PORTALS) {
      expect(seenDungeonIds.has(portal.dungeonId), `duplicate dungeonId ${portal.dungeonId}`).toBe(false);
      expect(seenPortalIds.has(portal.id), `duplicate portal id ${portal.id}`).toBe(false);
      expect(seenWaypoints.has(portal.fastTravel.waypointId), `duplicate waypoint ${portal.fastTravel.waypointId}`).toBe(false);
      expect(seenFlags.has(portal.fastTravel.discoverFlag), `duplicate flag ${portal.fastTravel.discoverFlag}`).toBe(false);

      seenDungeonIds.add(portal.dungeonId);
      seenPortalIds.add(portal.id);
      seenWaypoints.add(portal.fastTravel.waypointId);
      seenFlags.add(portal.fastTravel.discoverFlag);

      expect(DUNGEON_PORTAL_BY_ID[portal.dungeonId]).toBe(portal);

      const [x, , z] = portal.pos;
      expect(inRegionRect(portal.region, x, z), `portal ${portal.dungeonId} outside ${portal.region} rect`).toBe(true);
      expect(
        regionAt(x, z).id,
        `regionAt(${x}, ${z}) != ${portal.region} for portal ${portal.dungeonId}`,
      ).toBe(portal.region);

      expect(portal.levelRange[0]).toBeGreaterThanOrEqual(3);
      expect(portal.levelRange[1]).toBeLessThanOrEqual(30);
      expect(portal.levelRange[1]).toBeGreaterThanOrEqual(portal.levelRange[0]);

      minLv = Math.min(minLv, portal.levelRange[0]);
      maxLv = Math.max(maxLv, portal.levelRange[1]);
    }

    for (const id of DUNGEON_IDS) {
      expect(seenDungeonIds.has(id), `missing portal for ${id}`).toBe(true);
    }
    expect(minLv).toBe(3);
    expect(maxLv).toBe(30);
  });
});
