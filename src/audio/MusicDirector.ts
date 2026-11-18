import { Howl } from 'howler';

/** The track's loudness at full music volume. */
const LEVEL = 0.6;
const FADE_IN_MS = 1800;
const FADE_OUT_MS = 2200;
/** Each boss phase after the first plays the loop a little faster and higher. */
const PHASE_RATE = 0.04;

/**
 * The boss fight's music: it comes up when a fight starts, quickens with each phase and fades when
 * the fight ends for any reason. Follows the fight's state, so a new boss needs nothing here.
 */
export class MusicDirector {
  private readonly src = import.meta.env.BASE_URL + 'assets/audio/musicBattle';
  private howl: Howl | null = null;
  private playing: number | null = null;
  private fighting = false;
  private volume = 0.7;
  private duck = 1;

  /** Fetch the track ahead of the first fight. */
  warm(): void {
    try {
      this.howl ??= new Howl({ src: [`${this.src}.webm`, `${this.src}.m4a`], loop: true, volume: 0, preload: true });
    } catch {
      // Audio is optional.
    }
  }

  private get target(): number {
    return LEVEL * this.volume * this.duck;
  }

  /** Call every frame with whether a boss fight is on; only a change does anything. */
  setFight(on: boolean): void {
    if (on === this.fighting) return;
    this.fighting = on;
    try {
      if (on) this.begin();
      else this.fadeOut();
    } catch {
      // Audio is optional.
    }
  }

  private begin(): void {
    this.warm();
    const h = this.howl;
    if (!h) return;
    // Back into a fight while the last one still fades: pick the same voice up again.
    const from = this.playing !== null ? (h.volume(this.playing) as number) : 0;
    const id = this.playing ?? h.play();
    this.playing = id;
    h.rate(1, id);
    h.fade(from, this.target, FADE_IN_MS, id);
  }

  private fadeOut(): void {
    const h = this.howl;
    const id = this.playing;
    if (!h || id === null) return;
    h.fade(h.volume(id) as number, 0, FADE_OUT_MS, id);
    h.once('fade', () => {
      if (this.fighting || this.playing !== id) return;
      h.stop(id);
      this.playing = null;
    }, id);
  }

  /** The boss moved to a new phase (the fight starts in phase 1). */
  phase(phase: number): void {
    if (this.playing !== null) this.howl?.rate(1 + Math.max(0, phase - 1) * PHASE_RATE, this.playing);
  }

  setVolume(v: number): void {
    this.volume = v;
    this.applyLevel();
  }

  /** Quieter under a menu. */
  setDuck(k: number): void {
    if (k === this.duck) return;
    this.duck = k;
    this.applyLevel();
  }

  private applyLevel(): void {
    if (this.fighting && this.playing !== null) this.howl?.volume(this.target, this.playing);
  }

  /** Silence now (quit to title). */
  stop(): void {
    this.fighting = false;
    if (this.playing !== null) this.howl?.stop(this.playing);
    this.playing = null;
  }
}
