import { Howl, Howler } from 'howler';

/** Sounds by id; files are Opus (.webm) with an AAC (.m4a) fallback, from tools/import-sibling-assets.mjs. */
const SOUNDS = {
  uiClick: { volume: 0.5 },
  uiHover: { volume: 0.25 },
  dodge: { volume: 0.5 },
  clash: { volume: 0.6 },
  hurt: { volume: 0.6 },
  // Combat (M1a): guards, swings, heavy impacts, lock-on, telegraphs, death.
  shieldBlock: { volume: 0.6 },
  shieldPerfect: { volume: 0.75 },
  shieldUp: { volume: 0.45 },
  boltCast: { volume: 0.35 },
  noMana: { volume: 0.4 },
  rugWhoosh: { volume: 0.45 },
  carpetWhoosh: { volume: 0.55 },
  lockBeep: { volume: 0.35 },
  stunCharge: { volume: 0.7 },
  bossSlam: { volume: 0.7 },
  pillarHit: { volume: 0.65 },
  roundLose: { volume: 0.6 },
} as const;
export type SoundId = keyof typeof SOUNDS;

/**
 * Small Howler wrapper. Sounds load lazily on first play, so the title shell stays light; a sound
 * that fails to load is skipped silently (audio is never allowed to break the game).
 */
export class AudioManager {
  private readonly howls = new Map<SoundId, Howl>();
  private readonly base = import.meta.env.BASE_URL + 'assets/audio/';
  volume = 0.8;

  /** Play a sound; true if it was started (or queued until its file loads). */
  play(id: SoundId, rate = 1, volume = 1): boolean {
    try {
      const h = this.howl(id);
      const n = h.play();
      h.rate(rate, n);
      if (volume !== 1) h.volume(SOUNDS[id].volume * volume, n);
      return true;
    } catch {
      // Audio is optional.
      return false;
    }
  }

  /** Start loading sounds now (entering play), so the first hit isn't the one that waits. */
  preload(ids: readonly SoundId[]): void {
    for (const id of ids) {
      try {
        this.howl(id);
      } catch {
        // Audio is optional.
      }
    }
  }

  private howl(id: SoundId): Howl {
    let h = this.howls.get(id);
    if (!h) {
      h = new Howl({ src: [`${this.base}${id}.webm`, `${this.base}${id}.m4a`], volume: SOUNDS[id].volume, preload: true });
      this.howls.set(id, h);
    }
    return h;
  }

  setMaster(v: number): void {
    this.volume = v;
    Howler.volume(v);
  }
}
