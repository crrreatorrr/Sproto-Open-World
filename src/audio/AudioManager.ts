import { Howl, Howler } from 'howler';

/** Sounds by id; files are Opus (.webm) with an AAC (.m4a) fallback, from tools/import-sibling-assets.mjs. */
const SOUNDS = {
  uiClick: { volume: 0.5 },
  uiHover: { volume: 0.25 },
  dodge: { volume: 0.5 },
  clash: { volume: 0.6 },
  hurt: { volume: 0.6 },
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

  play(id: SoundId, rate = 1): void {
    try {
      let h = this.howls.get(id);
      if (!h) {
        h = new Howl({ src: [`${this.base}${id}.webm`, `${this.base}${id}.m4a`], volume: SOUNDS[id].volume, preload: true });
        this.howls.set(id, h);
      }
      const n = h.play();
      h.rate(rate, n);
    } catch {
      // Audio is optional.
    }
  }

  setMaster(v: number): void {
    this.volume = v;
    Howler.volume(v);
  }
}
