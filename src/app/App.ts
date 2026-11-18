import * as THREE from 'three';
import { AssetLoader } from '../assets/AssetLoader';
import { AudioManager } from '../audio/AudioManager';
import { CameraRig } from '../camera/CameraRig';
import { SANDBOX } from '../content/sandbox';
import { Overlay } from '../debug/Overlay';
import { GAMEPAD, KEYS, PAD } from '../input/bindings';
import { CommandBuilder } from '../input/CommandBuilder';
import { applyControlPrefs, loadControlPrefs, saveControlPrefs } from '../input/controlPrefs';
import { Input } from '../input/Input';
import { Renderer } from '../render/Renderer';
import { PlayerView } from '../render/views/PlayerView';
import { initPhysics } from '../sim/physics/PhysicsWorld';
import { SimWorld } from '../sim/SimWorld';
import { Hud } from '../ui/Hud';
import { MenuNav } from '../ui/MenuNav';
import { Menus } from '../ui/menus';
import { Panels } from '../ui/panels';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { FixedLoop } from './loop';

export type AppState = 'title' | 'loading' | 'playing' | 'paused' | 'error';

const LOCAL_PLAYER = 0;
/** How long a lost WebGL context may take to come back before we offer a reload (plan §2.9). */
const CONTEXT_RESTORE_TIMEOUT_MS = 10_000;

/**
 * The game shell: app state machine, the fixed-step loop, and the wiring between devices, sim,
 * renderer, camera and UI. The sim only ever receives commands from here.
 */
export class App {
  state: AppState = 'title';
  readonly input: Input;
  readonly assets = new AssetLoader();
  readonly renderer: Renderer;
  readonly rig: CameraRig;
  readonly nav: MenuNav;
  readonly menus: Menus;
  readonly panels: Panels;
  readonly hud: Hud;
  readonly overlay: Overlay;
  readonly audio = new AudioManager();
  readonly loop = new FixedLoop();
  readonly commands: CommandBuilder;
  sim: SimWorld | null = null;
  player: PlayerView | null = null;
  private settings: Settings;
  private lastTime = 0;
  private simMs = 0;
  private orbit = 0;
  private clipIndex = 0;
  private clipName = '';
  private contextTimer = 0;
  private readonly target = new THREE.Vector3();
  /** Pointer lock was released by us (pausing): don't treat it as the player leaving. */
  private releasingLock = false;

  constructor(host: HTMLElement, private readonly physicsReady: Promise<void>) {
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    host.appendChild(canvas);
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, this.assets);
    this.rig = new CameraRig(this.renderer.camera);
    this.commands = new CommandBuilder(this.input);
    this.settings = loadSettings();
    const prefs = loadControlPrefs();
    applyControlPrefs(prefs);
    this.applySettings(this.settings);

    const ui = document.createElement('div');
    ui.className = 'ui';
    host.appendChild(ui);
    this.hud = new Hud(ui);
    this.nav = new MenuNav(this.input);
    this.menus = new Menus(ui, this.nav, this.input, {
      play: () => void this.play(),
      resume: () => this.resume(),
      quitToTitle: () => this.quitToTitle(),
      settingsChanged: (s) => {
        this.settings = s;
        this.applySettings(s);
        saveSettings(s);
      },
      controlsChanged: (p) => {
        applyControlPrefs(p);
        saveControlPrefs(p);
      },
    }, this.settings, prefs);
    this.panels = new Panels(ui);
    this.overlay = new Overlay(ui);
    this.nav.onMove = () => this.audio.play('uiHover');
    this.nav.onConfirm = () => {
      this.audio.play('uiClick');
      this.input.pad.rumble(GAMEPAD.rumble.uiConfirm);
    };

    this.bindWindowEvents(canvas);
    this.renderer.buildLevel(SANDBOX);
    // Rapier failing to start is fatal and is said so up front, not when Play is pressed.
    physicsReady.catch((err) => {
      this.state = 'error';
      this.nav.reset(null);
      this.panels.showError(`The physics engine could not start: ${errorText(err)}`, 'Retry', () => location.reload());
    });
  }

  start(): void {
    this.toTitle();
    // Warm the player model while the title is up, so Play is quick.
    void this.assets.template('player');
    void this.assets.template('staff_sproto');
    requestAnimationFrame((t) => this.frame(t));
  }

  private applySettings(s: Settings): void {
    this.rig.mouseScale = s.mouseSensitivity;
    this.rig.padScale = s.padSensitivity;
    this.rig.invertY = s.invertY;
    this.input.pad.rumbleEnabled = s.rumble;
  }

  private bindWindowEvents(canvas: HTMLCanvasElement): void {
    // Focus loss or pointer lock loss while playing: pause (plan §2.9).
    window.addEventListener('blur', () => {
      if (this.state === 'playing') this.pause();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });
    this.input.onLockChange((locked) => {
      if (this.releasingLock) {
        this.releasingLock = false;
        return;
      }
      if (!locked && this.state === 'playing' && this.input.pad.device === 'kbm') this.pause();
    });
    canvas.addEventListener('click', () => {
      if (this.state === 'playing') this.input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote' && (import.meta.env.DEV || import.meta.env.VITE_QA === '1')) this.overlay.toggle();
      if (this.overlay.open && this.state === 'playing') {
        if (e.code === 'BracketRight') this.cycleClip(1);
        if (e.code === 'BracketLeft') this.cycleClip(-1);
      }
    });
    // WebGL context loss: pause, veil, and offer a reload if it doesn't come back.
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.state === 'playing') this.pause();
      this.panels.showVeil('Restoring graphics…');
      this.contextTimer = window.setTimeout(() => {
        this.panels.showError('The graphics device was lost and did not come back.', 'Reload', () => location.reload());
      }, CONTEXT_RESTORE_TIMEOUT_MS);
    });
    canvas.addEventListener('webglcontextrestored', () => {
      window.clearTimeout(this.contextTimer);
      this.panels.hideVeil();
      this.panels.hideError();
    });
  }

  private toTitle(): void {
    this.state = 'title';
    this.hud.visible = false;
    this.nav.reset(this.menus.title);
  }

  async play(): Promise<void> {
    if (this.state === 'loading') return;
    this.state = 'loading';
    this.nav.reset(null);
    this.panels.showVeil('Loading…');
    try {
      await this.physicsReady;
    } catch (err) {
      this.state = 'error';
      this.panels.showError(`The physics engine could not start: ${errorText(err)}`, 'Retry', () => location.reload());
      return;
    }
    try {
      const sim = new SimWorld(SANDBOX, 1);
      const entity = sim.spawnPlayer(LOCAL_PLAYER);
      const view = new PlayerView(this.assets);
      await view.load('staff_sproto');
      this.renderer.scene.add(view.root);
      this.sim = sim;
      this.player = view;
      this.target.set(entity.tf.pos.x, entity.tf.pos.y, entity.tf.pos.z);
      this.rig.snap(this.target, entity.tf.yaw);
      this.loop.reset();
      this.commands.clear();
      this.panels.hideVeil();
      this.state = 'playing';
      this.hud.visible = true;
      this.input.requestLock();
    } catch (err) {
      this.state = 'error';
      this.panels.showError(`The game could not start: ${errorText(err)}`, 'Back to title', () => {
        this.panels.hideError();
        this.toTitle();
      });
    }
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.commands.clear();
    this.input.clearHeld();
    if (this.input.locked) {
      this.releasingLock = true;
      this.input.releaseLock();
    }
    this.hud.visible = false;
    this.nav.reset(this.menus.pause);
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.nav.reset(null);
    this.state = 'playing';
    this.hud.visible = true;
    this.loop.reset();
    this.commands.clear();
    if (this.input.pad.device === 'kbm') this.input.requestLock();
  }

  quitToTitle(): void {
    this.player?.dispose();
    this.player = null;
    this.sim?.dispose();
    this.sim = null;
    this.toTitle();
  }

  private cycleClip(dir: number): void {
    const a = this.player?.animator;
    if (!a) return;
    const names = a.clipNames;
    this.clipIndex = (this.clipIndex + dir + names.length) % names.length;
    this.clipName = names[this.clipIndex];
    a.playOnce(this.clipName);
  }

  private frame(time: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const dt = this.lastTime ? Math.min(0.1, (time - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = time;
    const frameStart = performance.now();
    const pad = this.input.pad;
    pad.update();

    if (this.panels.errorOpen) {
      if (pad.wasPressed(['a'])) this.panels.confirmError();
    } else if (this.nav.open) {
      this.nav.frame(dt);
      this.menus.frame(dt, pad);
    }

    if (this.state === 'playing' && this.sim && this.player) this.playFrame(dt);
    else this.idleFrame(dt);

    this.renderer.render();
    this.hud.update(pad, this.input.locked);
    const p = this.sim?.playerEntity(LOCAL_PLAYER);
    this.overlay.update(dt, this.renderer.renderer, {
      frameMs: performance.now() - frameStart,
      simMs: this.simMs,
      ticks: this.sim?.now ?? 0,
      hash: this.sim?.hash() ?? 0,
      device: pad.device === 'gamepad' ? `pad (${pad.style})` : 'keyboard + mouse',
      pos: p ? p.tf.pos : null,
      grounded: p?.loco?.grounded ?? false,
      speed: p?.loco?.speed ?? 0,
      clip: this.clipName || '(locomotion)',
    });
    this.input.endFrame();
  }

  private playFrame(dt: number): void {
    const sim = this.sim!;
    const view = this.player!;
    const pad = this.input.pad;
    if (this.input.wasPressed(KEYS.pause) || pad.wasPressed(PAD.pause)) {
      this.pause();
      return;
    }
    if (this.overlay.open) {
      if (pad.wasPressed(['right'])) this.cycleClip(1);
      if (pad.wasPressed(['left'])) this.cycleClip(-1);
    }
    // Look: raw mouse, then the right stick.
    const m = this.input.consumeMouseDelta();
    if (m.x || m.y) this.rig.rotateMouse(m.x, m.y);
    if (pad.look.x || pad.look.y) this.rig.rotatePad(pad.look.x, pad.look.y, dt);

    this.commands.frame();
    const ticks = this.loop.advance(dt);
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      sim.tick(new Map([[LOCAL_PLAYER, this.commands.take(this.rig.yaw)]]));
      for (const e of sim.events) {
        if (e.type === 'land' && e.fallSpeed > 6) {
          const k = Math.min(1, (e.fallSpeed - 6) / 10);
          if (this.settings.shake) this.rig.addTrauma(0.15 + 0.25 * k);
          pad.rumble(GAMEPAD.rumble.land, 0.6 + k);
        }
      }
    }
    if (ticks) this.simMs = (performance.now() - t0) / ticks;

    const p = sim.playerEntity(LOCAL_PLAYER);
    if (!p) return;
    view.update(p, this.loop.alpha, dt);
    this.target.copy(view.root.position);
    this.rig.update(dt, this.target, sim.view(), p.loco?.sprinting ?? false);
    this.renderer.follow(this.target);
  }

  /** Title and pause: a slow orbit over the yard (paused keeps the frozen scene). */
  private idleFrame(dt: number): void {
    if (this.state === 'paused' || this.state === 'loading') return;
    this.orbit += dt * 0.08;
    const cam = this.renderer.camera;
    cam.position.set(Math.sin(this.orbit) * 22, 9, Math.cos(this.orbit) * 22);
    cam.lookAt(0, 1.5, 0);
    this.target.set(0, 0, 0);
    this.renderer.follow(this.target);
  }

  /** State for the QA API and the smoke test. */
  qaState(): Record<string, unknown> {
    const p = this.sim?.playerEntity(LOCAL_PLAYER);
    const top = this.nav.top?.el.id ?? null;
    return {
      state: this.state,
      screen: top,
      focused: this.nav.focused()?.textContent ?? null,
      tick: this.sim?.now ?? 0,
      hash: this.sim?.hash() ?? 0,
      device: this.input.pad.device,
      padConnected: this.input.pad.connected,
      player: p ? { pos: { ...p.tf.pos }, grounded: p.loco?.grounded ?? false, speed: p.loco?.speed ?? 0 } : null,
      staffMounted: this.player?.staffMounted ?? false,
      clips: this.player?.animator?.clipNames ?? [],
      errorOpen: this.panels.errorOpen,
      drawCalls: this.renderer.renderer.info.render.calls,
    };
  }
}

/** Kick off physics while the shell loads; exported for main.ts. */
export function startPhysics(): Promise<void> {
  return initPhysics();
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
