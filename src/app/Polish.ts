import { Ambience } from '../audio/Ambience';
import type { AudioManager } from '../audio/AudioManager';
import { EVENT_SOUNDS, eventSound } from '../audio/eventSounds';
import { MusicDirector } from '../audio/MusicDirector';
import { ZONE_SURFACE, zoneAt, type ZoneId } from '../audio/zones';
import type { HitFx, SparkStyle } from '../render/fx/HitFx';
import { ImpactFx } from '../render/fx/ImpactFx';
import { MomentFx } from '../render/fx/MomentFx';
import { applyQuality } from '../render/quality';
import type { Renderer } from '../render/Renderer';
import { BodyGlow } from '../render/views/BodyGlow';
import type { PlayerView } from '../render/views/PlayerView';
import type { WorldViews } from '../render/views/WorldViews';
import type { Entity, EntityId } from '../sim/entity';
import type { SimEvent } from '../sim/events';
import type { ReadonlySimView } from '../sim/view';
import { ScreenFades } from '../ui/ScreenFades';
import { motionScale, type Settings } from '../ui/settings';
import type { AppState } from './App';

/** How often the player's zone is looked up (s). */
const ZONE_EVERY = 0.5;
/** Metres of ground covered per footfall, and the slowest speed that makes any (m/s). */
const STRIDE = 1.9;
const STEP_MIN_SPEED = 1.2;
/** The beds and music under a menu, and the beds under a boss fight. */
const PAUSED_BED = 0.35;
const PAUSED_MUSIC = 0.5;
const BOSS_BED = 0.45;

export interface PolishDeps {
  /** The UI layer the full-screen fades go in. */
  host: HTMLElement;
  audio: AudioManager;
  fx: HitFx;
  world: WorldViews;
  renderer: Renderer;
  /** The ground's height at a point, once its cell has loaded. */
  ground(x: number, z: number): number | null;
  /** The streamed world: it has zones, and shrines to wake at. */
  streamed: boolean;
}

/**
 * The presentation layer over the game's feedback (M6): impact and status visuals, the moments of
 * light, boss music and ambient beds, the sounds of every smaller action, hit reactions, the death
 * and rest screens and the settings that scale them. App hands it each sim event and each frame.
 * It only ever reads the sim.
 */
export class Polish {
  readonly screens: ScreenFades;
  private readonly music = new MusicDirector();
  private readonly ambience = new Ambience();
  private readonly impact: ImpactFx;
  private readonly moments: MomentFx;
  private player: PlayerView | null = null;
  private zone: ZoneId = 'meadow';
  private zoneClock = 0;
  private stride = 0;
  private fighting = false;

  constructor(private readonly d: PolishDeps) {
    this.screens = new ScreenFades(d.host);
    this.impact = new ImpactFx(d.fx, d.world.spells);
    this.moments = new MomentFx(d.fx);
    d.fx.root.add(this.impact.root, this.moments.root);
    d.world.status.onThaw = (p) => this.impact.shatter(p, 12);
  }

  /** Apply the player's settings (at boot, and on every change). */
  apply(s: Settings): void {
    const { audio, fx, renderer } = this.d;
    applyQuality(renderer, fx, s.quality);
    const flash = motionScale(s.flash);
    fx.flashScale = flash;
    BodyGlow.flashScale = flash;
    audio.setMaster(s.masterVolume);
    audio.setEffects(s.sfxVolume);
    this.music.setVolume(s.musicVolume);
    this.ambience.setVolumes(s.ambienceVolume, s.sfxVolume);
  }

  /** A play session started with this player on screen. */
  begin(player: PlayerView): void {
    this.player = player;
    this.d.world.playerBody = player.root;
    this.d.audio.preload(EVENT_SOUNDS);
    this.music.warm();
    this.ambience.start();
    this.zoneClock = 0;
  }

  /** Back to the title. */
  end(): void {
    this.player = null;
    this.d.world.playerBody = null;
    this.fighting = false;
    this.music.stop();
    this.screens.clear();
    this.impact.clear();
    this.moments.clear();
  }

  /** The death screen is up (QA). */
  get deathShown(): boolean {
    return this.screens.deathShown;
  }

  /** Every sim event, on the tick it happened. */
  event(view: ReadonlySimView, e: SimEvent, me: EntityId | null): void {
    eventSound(e, this.d.audio, me);
    const player = this.player;
    switch (e.type) {
      case 'hit':
        if (e.target === me) player?.flinch(view.get(e.attacker)?.tf.pos ?? e.pos, e.heavy);
        return;
      case 'block':
        this.impact.guard(e.pos, e.guardBreak);
        if (e.target === me) player?.guardRecoil(view.get(e.attacker)?.tf.pos ?? e.pos, e.guardBreak);
        return;
      case 'parry':
        this.impact.parry(e.pos);
        return;
      case 'stagger':
        this.d.world.event(view, e);
        if (e.entity === me) player?.reel();
        return;
      case 'frozen': {
        const at = this.d.world.get(e.entity)?.root.position;
        if (at) this.impact.shatter({ x: at.x, y: at.y + 1, z: at.z }, 10);
        return;
      }
      case 'nova':
        this.impact.shatter({ x: e.pos.x, y: e.pos.y + 0.6, z: e.pos.z }, 16);
        return;
      case 'explode':
        this.burn(e.pos, e.radius * 0.8, e.pos.y - 1);
        return;
      case 'rockLand':
        this.burn(e.pos, e.radius, e.pos.y);
        return;
      case 'bossImpact':
        this.burn(e.pos, 3, e.pos.y);
        return;
      case 'bossPhase':
        this.music.phase(e.phase);
        return;
      case 'death':
        if (e.entity === me) this.screens.died(this.d.streamed ? 'You will wake at the last shrine you rested at' : '');
        return;
      case 'respawn':
        if (e.entity !== me) return;
        this.screens.woke();
        if (player) this.moments.heal(player.root);
        return;
      case 'levelUp':
        if (e.entity === me && player) this.moments.levelUp(player.root);
        return;
      case 'shrineRest':
        if (e.entity !== me) return;
        this.screens.rested();
        if (player) this.moments.rest(player.root);
        return;
      case 'drink':
        if (e.entity === me && player) this.moments.heal(player.root);
        return;
      default:
        return;
    }
  }

  /** A burn on the ground under `p`; `fallback` is its height before the cell has loaded. */
  private burn(p: { x: number; z: number }, radius: number, fallback: number): void {
    this.impact.scorch(p.x, this.d.ground(p.x, p.z) ?? fallback, p.z, radius);
  }

  /** A hit landed, in the spark style App chose. `soft`: damage that ticks, too often to dress up. */
  hit(e: Extract<SimEvent, { type: 'hit' }>, spark: SparkStyle, soft: boolean): void {
    if (!soft) this.impact.hit(e.pos, spark, e.heavy, e.crit);
  }

  /** Once per frame of play, after the world has been drawn into place. */
  frame(view: ReadonlySimView, p: Readonly<Entity>, dt: number): void {
    this.impact.update(dt);
    this.moments.update(dt);
    this.fighting = view.entities.some((e) => e.boss?.state === 'intro' || e.boss?.state === 'fight');
    this.music.setFight(this.fighting);
    this.zoneClock -= dt;
    if (this.zoneClock <= 0) {
      this.zoneClock = ZONE_EVERY;
      this.zone = this.d.streamed ? zoneAt(p.tf.pos.x, p.tf.pos.z) : 'meadow';
      this.ambience.setZone(this.zone);
    }
    this.ambience.frame(dt);
    this.footsteps(p, dt);
  }

  private footsteps(p: Readonly<Entity>, dt: number): void {
    const speed = p.loco?.speed ?? 0;
    const action = p.combat?.action?.kind;
    if (!p.loco?.grounded || speed < STEP_MIN_SPEED || (action && action !== 'cast')) {
      // The next step lands soon after the player sets off.
      this.stride = 0.6;
      return;
    }
    this.stride += (speed / STRIDE) * dt;
    if (this.stride < 1) return;
    this.stride -= 1;
    this.ambience.footstep(ZONE_SURFACE[this.zone], p.loco.sprinting ? 1 : 0.75);
  }

  /** Every rendered frame: how loud the beds and music are in the app's current state. */
  mix(state: AppState): void {
    const paused = state === 'paused';
    this.music.setDuck(paused ? PAUSED_MUSIC : 1);
    const bed = state === 'playing' ? 1 : paused ? PAUSED_BED : 0;
    this.ambience.setDuck(bed * (this.fighting ? BOSS_BED : 1));
  }
}
