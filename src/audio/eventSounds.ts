import type { EntityId } from '../sim/entity';
import type { SimEvent } from '../sim/events';
import type { AudioManager, SoundId } from './AudioManager';

/** Sounds loaded when play starts, on top of the combat set. */
export const EVENT_SOUNDS: readonly SoundId[] = ['stunHit', 'fireBurn', 'ticketPickup', 'roundWin', 'bossRoar', 'bossRise', 'defeat', 'victory', 'pillarCrumble'];

/**
 * The sounds for everything the sim does that `App.present` leaves silent: movement, statuses, the
 * RPG's small moments and the boss cues. Each sound is one the game already ships, pitched to fit.
 */
export function eventSound(e: SimEvent, audio: AudioManager, me: EntityId | null): void {
  const mine = 'entity' in e && e.entity === me;
  switch (e.type) {
    case 'hit':
      // On top of the hit's own sound (App.presentHit): the blows worth hearing from across the field.
      if (e.attacker !== me) return;
      if (e.strike === 'breakCrit') {
        audio.play('bossSlam', 1.25, 0.8);
        audio.play('stunHit', 0.7);
      } else if (e.strike === 'backstab') {
        audio.play('pillarHit', 1.3, 0.8);
        audio.play('stunHit', 1.2, 0.7);
      } else if (e.crit) audio.play('shieldPerfect', 1.5, 0.35);
      return;
    case 'jump':
      if (mine) audio.play('dodge', 1.35, 0.35);
      return;
    case 'land':
      if (mine && e.fallSpeed > 2.5) audio.play('pillarHit', 1.5, Math.min(0.6, e.fallSpeed / 22));
      return;
    case 'castStart':
      if (mine && !e.woven) audio.play('shieldUp', 0.85, 0.3);
      return;
    case 'stagger':
      audio.play('stunHit', mine ? 1 : 0.8, mine ? 1 : 0.7);
      return;
    case 'status':
      if (e.status === 'burn') audio.play('fireBurn', 0.95 + Math.random() * 0.1);
      else if (e.status === 'chill') audio.play('shieldBlock', 1.7, 0.35);
      else audio.play('stunHit', 1.4, 0.5);
      return;
    case 'cleanse':
      if (mine) audio.play('shieldUp', 1.5, 0.6);
      return;
    case 'lock':
      if (mine && e.target === null) audio.play('lockBeep', 0.7, 0.6);
      return;
    case 'death':
      if (mine) audio.play('defeat', 1, 0.8);
      else audio.play('pillarCrumble', 1.1 + Math.random() * 0.2, 0.45);
      return;
    case 'respawn':
      if (mine) audio.play('bossRise', 1.25, 0.45);
      return;
    case 'levelUp':
      if (mine) audio.play('roundWin');
      return;
    case 'itemGained':
      if (mine) audio.play('ticketPickup');
      return;
    case 'equip':
      if (mine) audio.play('shieldUp', 1.25, 0.5);
      return;
    case 'spellLearned':
      if (mine) audio.play('spellLearned');
      return;
    case 'perk':
      if (mine) audio.play('ultReady');
      return;
    case 'skillPoints':
      if (mine) audio.play('ultReady', 1.2, 0.6);
      return;
    case 'drink':
      if (mine) audio.play('lifePackPickup', 1, 0.7);
      return;
    case 'talk':
      if (mine) audio.play('uiHover', 0.9, 0.7);
      return;
    case 'dialogueEnd':
      if (mine) audio.play('uiClick', 0.85, 0.5);
      return;
    case 'questProgress':
      if (mine) audio.play('uiHover', 1.3, 0.8);
      return;
    case 'interact':
      if (!mine) return;
      if (e.kind === 'shrine') audio.play('shieldUp', 0.6, 0.6);
      else if (e.kind === 'npc') audio.play('uiClick', 1, 0.4);
      else if (e.kind === 'object') audio.play('uiClick', 0.7, 0.6);
      return;
    case 'bossIntro':
      audio.play('bossRoar');
      return;
    case 'bossPhase':
      audio.play('bossRise');
      return;
    case 'cue':
      if (e.cue === 'horn') audio.play('bossRoar', 1.6, 0.55);
      else if (e.cue === 'bell') audio.play('shieldPerfect', 1.8, 0.7);
      else if (e.cue === 'whine') audio.play('stunCharge', 0.55 + (e.frac ?? 0) * 1.1, 0.2 + (e.frac ?? 0) * 0.35);
      else if (e.cue === 'roar' || e.cue === 'distantRoar') audio.play('bossRoar', e.cue === 'distantRoar' ? 0.55 : 1, e.cue === 'distantRoar' ? 0.45 : 0.8);
      else if (e.cue === 'coinRing') audio.play('shieldPerfect', 2.1, 0.85);
      else if (e.cue === 'crack') audio.play('pillarHit', 1.4, 0.45);
      else if (e.cue === 'sizzle') audio.play('fireBurn', 1.3, 0.4);
      else if (e.cue === 'hum') audio.play('shieldUp', 0.5 + (e.frac ?? 0.5), 0.15 + (e.frac ?? 0) * 0.35);
      else if (e.cue === 'chord') {
        audio.play('shieldUp', 0.7, 0.45);
        audio.play('shieldPerfect', 1.2, 0.35);
      } else if (e.cue === 'tremor') audio.play('pillarHit', 0.45, 0.35);
      else if (e.cue === 'sealDrop') audio.play('ticketPickup', 0.8, 0.7);
      return;
    case 'bossSummon':
      audio.play('bossRoar', 1.25, 0.7);
      return;
    case 'bossDefeated':
      audio.play('victory');
      return;
    default:
      return;
  }
}
