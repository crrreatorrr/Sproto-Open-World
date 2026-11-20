/**
 * Pure simulation director for instanced Campaign Dungeons (L01-L10).
 *
 * Rules:
 * - 100% pure: no Three.js, Rapier, DOM, Math.random, Date.now, or timers.
 * - NO Second Wind: player death immediately respawns cleanly at the last activated checkpoint
 *   with full HP, Tonics, and ammo (`fullRestore: true`).
 */
import { getDungeon } from '../../content/dungeons/catalog';
import type {
  DungeonAbilityUnlock,
  DungeonEncounterEnemyDef,
  DungeonId,
  Vec3Tuple,
} from '../../content/dungeons/types';
import type { RegionId } from '../../content/world/regions';

export type EncounterPhase = 'pending' | 'active' | 'cleared';

export interface DungeonSessionState {
  readonly dungeonId: DungeonId;
  tick: number;
  activeCheckpointId: string;
  activeCheckpointPos: [number, number, number];
  activatedCheckpoints: string[];
  encounterStates: Record<string, EncounterPhase>;
  activeEncounterId: string | null;
  /** Door mechanism IDs currently sealed (solid). */
  sealedDoorIds: string[];
  /** Door mechanism IDs that have been unlocked/opened. */
  unlockedDoorIds: string[];
  activatedSwitches: string[];
  bossDefeated: boolean;
  cleared: boolean;
  respawnCount: number;
}

export type DungeonEvent =
  | {
      readonly type: 'checkpointActivated';
      readonly checkpointId: string;
      readonly pos: readonly [number, number, number];
    }
  | {
      readonly type: 'encounterStarted';
      readonly encounterId: string;
      readonly enemies: readonly DungeonEncounterEnemyDef[];
      readonly boss?: string;
      readonly lockdownDoorId?: string;
    }
  | {
      readonly type: 'encounterCleared';
      readonly encounterId: string;
      readonly boss?: string;
      readonly unlockedDoorId?: string;
    }
  | {
      readonly type: 'doorStateChanged';
      readonly doorId: string;
      readonly sealed: boolean;
    }
  | {
      readonly type: 'switchActivated';
      readonly switchId: string;
      readonly targetId?: string;
    }
  | {
      readonly type: 'geyserBoost';
      readonly mechanismId: string;
      readonly power: number;
    }
  | {
      readonly type: 'hazardDamage';
      readonly mechanismId: string;
      readonly dps: number;
    }
  | {
      /** Clean respawn at last activated checkpoint with full HP/Tonics/ammo (NO Second Wind). */
      readonly type: 'playerRespawn';
      readonly checkpointId: string;
      readonly pos: readonly [number, number, number];
      readonly fullRestore: true;
    }
  | {
      readonly type: 'dungeonCleared';
      readonly dungeonId: DungeonId;
      readonly rewardXp: number;
      readonly rewardSprouts: number;
      readonly unlockAbility: DungeonAbilityUnlock;
      readonly rewardGun?: string;
    }
  | {
      readonly type: 'returnToOverworld';
      readonly dungeonId: DungeonId;
      readonly regionId: RegionId;
    };

export interface DungeonStepResult {
  readonly state: DungeonSessionState;
  readonly events: readonly DungeonEvent[];
}

function distSq(a: Vec3Tuple, b: Vec3Tuple): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return dx * dx + dy * dy + dz * dz;
}

function pointInBox(
  p: Vec3Tuple,
  center: Vec3Tuple,
  size: Vec3Tuple,
  margin = 0,
): boolean {
  const hx = size[0] * 0.5 + margin;
  const hy = size[1] * 0.5 + margin;
  const hz = size[2] * 0.5 + margin;
  return (
    Math.abs(p[0] - center[0]) <= hx &&
    Math.abs(p[1] - center[1]) <= hy &&
    Math.abs(p[2] - center[2]) <= hz
  );
}

/**
 * Create a fresh instanced dungeon session for the given campaign dungeon ID.
 */
export function createDungeonSession(dungeonId: DungeonId): DungeonSessionState {
  const def = getDungeon(dungeonId);
  const firstCp = def.checkpoints[0];
  const startPos: [number, number, number] = firstCp
    ? [firstCp.pos[0], firstCp.pos[1], firstCp.pos[2]]
    : [def.spawn[0], def.spawn[1], def.spawn[2]];
  const startId = firstCp ? firstCp.id : `${dungeonId}-SPAWN`;

  const encounterStates: Record<string, EncounterPhase> = {};
  for (const enc of def.encounters) {
    encounterStates[enc.id] = 'pending';
  }

  return {
    dungeonId,
    tick: 0,
    activeCheckpointId: startId,
    activeCheckpointPos: startPos,
    activatedCheckpoints: firstCp ? [firstCp.id] : [],
    encounterStates,
    activeEncounterId: null,
    sealedDoorIds: [],
    unlockedDoorIds: [],
    activatedSwitches: [],
    bossDefeated: false,
    cleared: false,
    respawnCount: 0,
  };
}

function addUnique(list: string[], id: string): boolean {
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}

function removeItem(list: string[], id: string): boolean {
  const idx = list.indexOf(id);
  if (idx < 0) return false;
  list.splice(idx, 1);
  return true;
}

/**
 * Advance the dungeon session by one simulation tick.
 *
 * Returns a new state snapshot along with any emitted events for the host simulation / renderer /
 * physics layer to apply (spawning encounter squads, toggling door colliders, teleporting on
 * checkpoint respawn, granting completion rewards, and returning to the overworld).
 */
export function stepDungeon(
  prevState: DungeonSessionState,
  playerPos: Vec3Tuple,
  playerDead: boolean,
  aliveEncounterEnemies: number,
  interactPressed: boolean,
): DungeonStepResult {
  const def = getDungeon(prevState.dungeonId);
  const events: DungeonEvent[] = [];

  const state: DungeonSessionState = {
    ...prevState,
    tick: prevState.tick + 1,
    activeCheckpointPos: [
      prevState.activeCheckpointPos[0],
      prevState.activeCheckpointPos[1],
      prevState.activeCheckpointPos[2],
    ],
    activatedCheckpoints: [...prevState.activatedCheckpoints],
    encounterStates: { ...prevState.encounterStates },
    sealedDoorIds: [...prevState.sealedDoorIds],
    unlockedDoorIds: [...prevState.unlockedDoorIds],
    activatedSwitches: [...prevState.activatedSwitches],
  };

  if (state.cleared) {
    return { state, events };
  }

  // 1. Player death -> immediate clean checkpoint respawn (NO Second Wind).
  if (playerDead) {
    state.respawnCount += 1;

    // Reset any currently active encounter so the player is never locked out of the arena.
    if (state.activeEncounterId) {
      const activeEnc = def.encounters.find((e) => e.id === state.activeEncounterId);
      state.encounterStates[state.activeEncounterId] = 'pending';
      state.activeEncounterId = null;
      if (activeEnc?.lockdownDoorId && removeItem(state.sealedDoorIds, activeEnc.lockdownDoorId)) {
        events.push({
          type: 'doorStateChanged',
          doorId: activeEnc.lockdownDoorId,
          sealed: false,
        });
      }
    }

    events.push({
      type: 'playerRespawn',
      checkpointId: state.activeCheckpointId,
      pos: [
        state.activeCheckpointPos[0],
        state.activeCheckpointPos[1],
        state.activeCheckpointPos[2],
      ],
      fullRestore: true,
    });
    return { state, events };
  }

  // 2. Checkpoint activation on proximity.
  for (const cp of def.checkpoints) {
    if (state.activatedCheckpoints.includes(cp.id)) continue;
    if (distSq(playerPos, cp.pos) <= cp.radius * cp.radius) {
      state.activatedCheckpoints.push(cp.id);
      state.activeCheckpointId = cp.id;
      state.activeCheckpointPos = [cp.pos[0], cp.pos[1], cp.pos[2]];
      events.push({
        type: 'checkpointActivated',
        checkpointId: cp.id,
        pos: cp.pos,
      });
    }
  }

  // 3. Active encounter completion check.
  if (state.activeEncounterId) {
    if (aliveEncounterEnemies <= 0) {
      const enc = def.encounters.find((e) => e.id === state.activeEncounterId);
      state.encounterStates[state.activeEncounterId] = 'cleared';
      state.activeEncounterId = null;

      let unlockedDoorId: string | undefined;
      if (enc?.lockdownDoorId) {
        if (removeItem(state.sealedDoorIds, enc.lockdownDoorId)) {
          addUnique(state.unlockedDoorIds, enc.lockdownDoorId);
          unlockedDoorId = enc.lockdownDoorId;
          events.push({
            type: 'doorStateChanged',
            doorId: enc.lockdownDoorId,
            sealed: false,
          });
        }
      }
      if (enc?.boss) {
        state.bossDefeated = true;
      }
      events.push({
        type: 'encounterCleared',
        encounterId: enc ? enc.id : prevState.activeEncounterId!,
        boss: enc?.boss,
        unlockedDoorId,
      });
    }
  } else {
    // 4. Encounter activation when entering trigger radius.
    for (const enc of def.encounters) {
      if (state.encounterStates[enc.id] !== 'pending') continue;
      if (distSq(playerPos, enc.triggerPos) <= enc.triggerRadius * enc.triggerRadius) {
        state.encounterStates[enc.id] = 'active';
        state.activeEncounterId = enc.id;
        if (enc.lockdownDoorId && addUnique(state.sealedDoorIds, enc.lockdownDoorId)) {
          events.push({
            type: 'doorStateChanged',
            doorId: enc.lockdownDoorId,
            sealed: true,
          });
        }
        events.push({
          type: 'encounterStarted',
          encounterId: enc.id,
          enemies: enc.enemies,
          boss: enc.boss,
          lockdownDoorId: enc.lockdownDoorId,
        });
        break;
      }
    }
  }

  // 5. Mechanisms: switches, geysers, hazards.
  for (const mech of def.mechanisms) {
    if (mech.kind === 'switch') {
      if (
        interactPressed &&
        !state.activatedSwitches.includes(mech.id) &&
        pointInBox(playerPos, mech.pos, mech.size, 1.5)
      ) {
        state.activatedSwitches.push(mech.id);
        events.push({
          type: 'switchActivated',
          switchId: mech.id,
          targetId: mech.targetId,
        });
        if (mech.targetId) {
          const wasSealed = removeItem(state.sealedDoorIds, mech.targetId);
          addUnique(state.unlockedDoorIds, mech.targetId);
          if (wasSealed) {
            events.push({
              type: 'doorStateChanged',
              doorId: mech.targetId,
              sealed: false,
            });
          }
        }
      }
    } else if (mech.kind === 'geyser') {
      if (pointInBox(playerPos, mech.pos, mech.size, 0.5)) {
        events.push({
          type: 'geyserBoost',
          mechanismId: mech.id,
          power: mech.power ?? 14,
        });
      }
    } else if (mech.kind === 'hazard') {
      if (pointInBox(playerPos, mech.pos, mech.size, 0.25)) {
        events.push({
          type: 'hazardDamage',
          mechanismId: mech.id,
          dps: mech.dps ?? 12,
        });
      }
    }
  }

  // 6. Dungeon completion & exit portal check.
  const hasBoss = def.encounters.some((e) => Boolean(e.boss));
  const finalCleared = hasBoss
    ? state.bossDefeated
    : def.encounters.every((e) => state.encounterStates[e.id] === 'cleared');

  const exitRadius = def.exitRadius ?? 4.5;
  if (finalCleared && distSq(playerPos, def.exit) <= exitRadius * exitRadius) {
    state.cleared = true;
    events.push({
      type: 'dungeonCleared',
      dungeonId: def.id,
      rewardXp: def.rewardXp,
      rewardSprouts: def.rewardSprouts,
      unlockAbility: def.unlockAbility,
      rewardGun: def.rewardGun,
    });
    events.push({
      type: 'returnToOverworld',
      dungeonId: def.id,
      regionId: def.regionId,
    });
  }

  return { state, events };
}
