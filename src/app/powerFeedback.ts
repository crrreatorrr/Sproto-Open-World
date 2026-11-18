import type { AudioManager } from '../audio/AudioManager';
import { RUMBLE, TRAUMA } from '../render/fx/feedback';
import type { SimEvent } from '../sim/events';

type PowerEvent = Extract<SimEvent, { type: 'power' }>;
type Rumble = { strong: number; weak: number; ms: number };

/** What a power's feedback may touch. `mine`: the local player caused it. */
export interface PowerFeedback {
  audio: AudioManager;
  mine: boolean;
  rumble(effect: Rumble): void;
  shake(trauma: number): void;
}

/** The C3 powers' sounds (the game's own sounds, pitched), rumble and camera shake. */
export function powerFeedback(e: PowerEvent, f: PowerFeedback): void {
  const { audio, mine } = f;
  switch (e.fx) {
    case 'ward':
      audio.play('shieldUp', 1.3);
      if (mine) f.rumble(RUMBLE.cast);
      return;
    case 'wardReflect':
      audio.play('shieldPerfect', 1.2);
      if (mine) {
        f.rumble(RUMBLE.parry);
        f.shake(TRAUMA.parry);
      }
      return;
    case 'wardBlock':
      audio.play('shieldBlock', 1.3);
      if (mine) f.rumble(RUMBLE.block);
      return;
    case 'snareRoot':
      audio.play('boltHit', 1.6);
      audio.play('stunCharge', 1.7, 0.45);
      return;
    case 'swarm':
      audio.play('shieldUp', 1.75, 0.8);
      if (mine) f.rumble(RUMBLE.cast);
      return;
    case 'wall':
      audio.play('pillarHit', 0.7);
      audio.play('rugWhoosh', 0.6);
      if (mine) {
        f.rumble(RUMBLE.blast);
        f.shake(TRAUMA.nova);
      }
      return;
    case 'wallStun':
      audio.play('bossSlam', 1.15);
      audio.play('pillarHit', 0.8);
      f.shake(TRAUMA.heavyHit);
      if (mine) f.rumble(RUMBLE.heavyHit);
      return;
    case 'wallEnd':
      audio.play('rugWhoosh', 0.5, 0.5);
      return;
    case 'vine':
      audio.play('rugWhoosh', 1.45);
      audio.play('boltHit', 0.75, 0.7);
      if (mine) f.rumble(RUMBLE.zap);
      return;
    case 'bloom':
      audio.play('shieldPerfect', 1.5, 0.6);
      if (mine) f.rumble(RUMBLE.cast);
      return;
    case 'emberStart':
      audio.play('blastExplode', 1.5, 0.5);
      if (mine) f.rumble(RUMBLE.cast);
      return;
    case 'emberPulse':
      audio.play('carpetWhoosh', 0.7, 0.4);
      if (mine) f.rumble(RUMBLE.cast);
      return;
    case 'surgeReady':
      if (mine) {
        audio.play('shieldPerfect', 1.35, 0.8);
        f.rumble(RUMBLE.perfectDodge);
      }
      return;
    case 'surge':
      audio.play('blastExplode', 0.7);
      audio.play('bossSlam', 1.25, 0.8);
      f.shake(TRAUMA.blast);
      if (mine) f.rumble(RUMBLE.blast);
      return;
    default:
      return;
  }
}
