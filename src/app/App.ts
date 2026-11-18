import * as THREE from 'three';
import { AssetLoader } from '../assets/AssetLoader';
import { MODELS, type ModelKey } from '../assets/manifest';
import { AudioManager } from '../audio/AudioManager';
import { CameraRig } from '../camera/CameraRig';
import { ITEMS } from '../content/items';
import { QUESTS } from '../content/quests';
import { SANDBOX } from '../content/sandbox';
import { SPELLS, WOVEN, type SpellId } from '../content/spells';
import { worldLevel } from '../content/world/level';
import { SPROUTVALE_CONTENT } from '../content/world/sproutvaleContent';
import { frameDataLines, targetLines } from '../debug/frameData';
import { Overlay } from '../debug/Overlay';
import { QA_LOG_ENABLED, qaLog } from '../debug/qaLog';
import { GAMEPAD, KEYS, PAD } from '../input/bindings';
import { CommandBuilder } from '../input/CommandBuilder';
import { applyControlPrefs, loadControlPrefs, saveControlPrefs } from '../input/controlPrefs';
import { promptLabel } from '../input/glyphs';
import { Input } from '../input/Input';
import { RUMBLE, TRAUMA } from '../render/fx/feedback';
import { HitFx, type SparkStyle } from '../render/fx/HitFx';
import { Renderer } from '../render/Renderer';
import { PlayerView } from '../render/views/PlayerView';
import { WorldViews, enemyDef } from '../render/views/WorldViews';
import { loadSave, writeSave } from '../save/SaveStore';
import type { SaveFile } from '../save/schema';
import { BTN, type UiAction } from '../sim/commands';
import type { Entity, EntityId } from '../sim/entity';
import type { SimEvent } from '../sim/events';
import { initPhysics } from '../sim/physics/PhysicsWorld';
import { SimWorld } from '../sim/SimWorld';
import type { ReadonlySimView } from '../sim/view';
import { DamageNumbers, type NumberStyle, type Projector } from '../ui/DamageNumbers';
import { Hud, type HudCombat, type HudStatus } from '../ui/Hud';
import { MenuNav, type Screen } from '../ui/MenuNav';
import { Menus } from '../ui/menus';
import { Panels } from '../ui/panels';
import { Tutorial } from '../ui/tutorial';
import { Reveals, affinityToast } from '../ui/Reveals';
import { RpgHud, type HudRpgState } from '../ui/RpgHud';
import { RpgMenus } from '../ui/rpgMenus';
import { compassOffset, headingTo, interactLabel, trackedQuest } from '../ui/rpgText';
import { loadSettings, saveSettings, type Settings } from '../ui/settings';
import { FixedLoop } from './loop';
import { WorldSession } from './WorldSession';

export type AppState = 'title' | 'loading' | 'playing' | 'paused' | 'error';

const LOCAL_PLAYER = 0;
/** How long a lost WebGL context may take to come back before we offer a reload (plan §2.9). */
const CONTEXT_RESTORE_TIMEOUT_MS = 10_000;
/** The enemy bar stays on the enemy you hit last for this long (ms) when nothing is locked. */
const ENEMY_BAR_MS = 6000;
/** Combat sounds, loaded when play starts so the first hit isn't the one that waits on a file. */
const COMBAT_SOUNDS = [
  'clash', 'hurt', 'dodge', 'shieldBlock', 'shieldPerfect', 'shieldUp', 'rugWhoosh', 'carpetWhoosh', 'pillarHit', 'lockBeep', 'stunCharge', 'bossSlam',
  'boltCast', 'boltHit', 'blastExplode', 'noMana', 'roundLose',
] as const;
const PARAMS = new URLSearchParams(location.search);
/** `?sandbox=1`: the M1b wave runner (plan §9 M1b), on the flat yard level. */
const WAVE_SANDBOX = PARAMS.get('sandbox') === '1';
/**
 * Which level Play starts: Sproutvale, the streamed world (M2), by default; `?yard=1` keeps the M1
 * training yard and `?sandbox=1` the wave runner, both on the flat yard level.
 */
export type GameMode = 'world' | 'yard' | 'waves';
const MODE: GameMode = WAVE_SANDBOX ? 'waves' : PARAMS.get('yard') === '1' ? 'yard' : 'world';
/** Blast shakes the camera less the further it is from you (m at which it stops). */
const BLAST_SHAKE_RANGE = 16;
/** Autosave every 5 minutes of play when out of combat (plan §2.8), on top of the event saves. */
const AUTOSAVE_SEC = 300;

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
  readonly world: WorldViews;
  readonly fx = new HitFx();
  readonly numbers: DamageNumbers;
  /** Weakness and resistance reveals and their toasts: remembered for the session (plan §4.6). */
  readonly reveals = new Reveals();
  sim: SimWorld | null = null;
  player: PlayerView | null = null;
  /** The local player's entity id. */
  private playerId: EntityId | null = null;
  private lastHitEnemy: EntityId | null = null;
  private lastHitAt = 0;
  private readonly screenFlash: HTMLElement;
  /** QA: hits counted so far, and the attack whose first pose was logged. */
  private hitCount = 0;
  private posedAction: object | null = null;
  private castPosed: object | null = null;
  private readonly lockPos = new THREE.Vector3();
  private readonly v3 = new THREE.Vector3();
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
  readonly mode: GameMode = MODE;
  /** The streamed world (world mode only). */
  readonly stream: WorldSession | null;
  /** The player is held behind the loading veil until their cells have colliders (plan §3.2). */
  private groundWait = false;
  /** QA teleport waiting for the target cell's heights, to set the player down on the ground. */
  private pendingDrop: { x: number; z: number } | null = null;
  private frameCount = 0;
  /** The RPG HUD layer and menus (plan §5; world mode). */
  readonly rpgHud: RpgHud;
  readonly rpgMenus: RpgMenus;
  private readonly tutorial = new Tutorial();
  /** The save found at boot (or on returning to the title): Continue loads it. */
  private bootSave: SaveFile | null = null;
  /** An event asked for a save; written once after this frame's ticks. */
  private saveWanted = false;
  /** Seconds of play since the last save (the 5-minute autosave). */
  private sinceSave = 0;
  /** Saves written this session (QA). */
  private saves = 0;
  /** The staff model shown on the player, to swap it when the equipment changes. */
  private staffShown = '';

  constructor(host: HTMLElement, private readonly physicsReady: Promise<void>) {
    const canvas = document.createElement('canvas');
    canvas.className = 'game-canvas';
    host.appendChild(canvas);
    this.input = new Input(canvas);
    this.renderer = new Renderer(canvas, this.assets);
    this.world = new WorldViews(this.assets, this.fx);
    this.renderer.scene.add(this.world.root, this.fx.root);
    this.rig = new CameraRig(this.renderer.camera);
    this.commands = new CommandBuilder(this.input);
    this.settings = loadSettings();
    const prefs = loadControlPrefs();
    applyControlPrefs(prefs);
    this.applySettings(this.settings);

    const ui = document.createElement('div');
    ui.className = 'ui';
    host.appendChild(ui);
    this.numbers = new DamageNumbers(ui);
    this.hud = new Hud(ui);
    this.rpgHud = new RpgHud(this.hud.root);
    this.rpgHud.enabled = MODE === 'world';
    this.screenFlash = document.createElement('div');
    this.screenFlash.className = 'screen-flash';
    ui.appendChild(this.screenFlash);
    this.nav = new MenuNav(this.input);
    this.menus = new Menus(ui, this.nav, this.input, {
      play: () => void this.play(),
      continueGame: () => void this.play(this.bootSave),
      character: () => this.nav.push(this.rpgMenus.character),
      questLog: () => this.nav.push(this.rpgMenus.quests),
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
    this.menus.rpgMenus = MODE === 'world';
    this.rpgMenus = new RpgMenus(ui, this.nav, {
      view: () => this.sim?.view() ?? null,
      player: () => this.sim?.playerEntity(LOCAL_PLAYER),
      choices: () => this.sim?.view().dialogueChoices(LOCAL_PLAYER) ?? [],
      send: (a) => this.sendUi(a),
      interactGlyph: () => promptLabel(this.input.pad.device, this.input.pad.style, KEYS.interact, PAD.interact),
      resume: () => this.resume(),
    });
    this.panels = new Panels(ui);
    this.overlay = new Overlay(ui);
    this.nav.onMove = () => this.audio.play('uiHover');
    this.nav.onConfirm = () => {
      this.audio.play('uiClick');
      this.input.pad.rumble(GAMEPAD.rumble.uiConfirm);
    };

    if (QA_LOG_ENABLED) this.bindQaLog();
    this.bindWindowEvents(canvas);
    window.addEventListener('resize', () => this.rpgHud.setCompassWidth(compassWidth()));
    this.rpgHud.setCompassWidth(compassWidth());
    this.stream = MODE === 'world' ? new WorldSession(this.renderer, this.assets) : null;
    if (!this.stream) {
      this.renderer.yardLook();
      this.renderer.buildLevel(SANDBOX);
    } else {
      // Daylight from the first frame; the manifest's own fog band replaces this when it arrives.
      this.renderer.worldLook({ fog: { near: 80, far: 180, farPlane: 450 } });
    }
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
    void this.assets.template('brute');
    if (WAVE_SANDBOX) for (const k of ['grunt', 'slinger', 'wisp'] as const) void this.assets.template(k);
    // The world streams in behind the title (around the player start), so Play is quick.
    this.stream?.load().catch((err: unknown) => console.warn('[world] the region manifest could not load yet', err));
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
    if (MODE === 'world') this.readSave();
    this.nav.reset(this.menus.title);
  }

  /**
   * Look for a save (plan §2.8) and tell the title: Continue when there is one, and a notice when
   * it was damaged (the backup loaded instead, or nothing could be).
   */
  private readSave(): void {
    let r: ReturnType<typeof loadSave>;
    try {
      r = loadSave();
    } catch (err) {
      r = { save: null, fromBackup: false, error: errorText(err) };
    }
    this.bootSave = r.save;
    const notice = r.save && r.fromBackup
      ? 'Your last save was damaged; loaded the backup.'
      : !r.save && r.error
        ? "Your save couldn't be loaded; starting fresh."
        : '';
    if (r.error) console.warn('[save]', r.error);
    this.menus.setSave(!!r.save, notice);
  }

  /** Queue a menu intent for the next tick. */
  private sendUi(a: UiAction): void {
    this.commands.queueUi(a);
  }

  /**
   * Write the autosave (plan §2.8): the sim's state as a SaveFile, stamped with the app's clock.
   * A full or blocked storage is said on screen, never fatal.
   */
  private writeSaveNow(): void {
    const sim = this.sim;
    const region = this.stream?.region;
    if (!sim || !region) return;
    this.sinceSave = 0;
    let ok = false;
    try {
      ok = writeSave(sim.toSave({ savedAt: new Date().toISOString(), build: __BUILD_ID__, region: region.manifest.id }));
    } catch (err) {
      console.warn('[save] could not write', err);
    }
    if (ok) {
      this.saves++;
      this.rpgHud.saved();
    } else this.hud.toast("Couldn't save: the browser's storage is full or blocked.");
  }

  /** Start a session: a new game, or `save` restored on top of it (Continue). */
  async play(save: SaveFile | null = null): Promise<void> {
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
    if (this.stream) {
      try {
        await this.stream.load();
      } catch (err) {
        this.state = 'error';
        this.panels.showError(`Sproutvale could not load: ${errorText(err)}`, 'Retry', () => {
          this.panels.hideError();
          this.state = 'title';
          void this.play();
        });
        return;
      }
    }
    try {
      const region = this.stream?.region;
      const sim = new SimWorld(region ? worldLevel(region.manifest) : SANDBOX, 1);
      const entity = sim.spawnPlayer(LOCAL_PLAYER);
      // The sandbox's dummies and Brute (bare test worlds stay empty), the wave runner, or
      // Sproutvale's villagers, shrines, chest and training yard (its camps arrive in M4). A save
      // goes on top of the fresh world, so opened chests and found shrines come back as they were.
      if (WAVE_SANDBOX) sim.startWaves();
      else if (this.stream) sim.populateWorld(SPROUTVALE_CONTENT);
      else sim.populate();
      if (save && this.stream) sim.applySave(save);
      if (this.stream) {
        this.stream.attach(sim);
        this.groundWait = true;
      }
      const view = new PlayerView(this.assets);
      const staff = this.staffModel(entity.progress?.equipment.staff);
      await view.load(staff);
      this.staffShown = staff;
      this.renderer.scene.add(view.root);
      this.sim = sim;
      this.player = view;
      this.playerId = entity.id;
      this.audio.preload(COMBAT_SOUNDS);
      this.target.set(entity.tf.pos.x, entity.tf.pos.y, entity.tf.pos.z);
      this.rig.snap(this.target, entity.tf.yaw);
      this.loop.reset();
      this.commands.clear();
      this.commands.clearUi();
      this.saveWanted = false;
      this.sinceSave = 0;
      this.rpgHud.clearFeed();
      this.state = 'playing';
      if (this.groundWait) this.panels.showVeil('Loading Sproutvale…');
      else this.panels.hideVeil();
      this.hud.visible = !this.groundWait;
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
    this.commands.clearUi();
    this.player?.dispose();
    this.player = null;
    this.playerId = null;
    this.lastHitEnemy = null;
    this.world.clear();
    this.fx.clear();
    this.numbers.clear();
    this.hud.showDeath(false);
    this.stream?.detach();
    this.groundWait = false;
    this.pendingDrop = null;
    this.panels.hideVeil();
    this.sim?.dispose();
    this.sim = null;
    this.toTitle();
  }

  /**
   * The cell-load timeout's way out (plan §2.9): a fresh world session that keeps the player's
   * progress (the current state goes through a SaveFile, so it resumes at the last shrine, or at
   * the start before one is found). Cells already fetched stay cached.
   */
  private returnToStart(): void {
    this.panels.hideError();
    const sim = this.sim;
    const region = this.stream?.region;
    const save = sim && region ? sim.toSave({ savedAt: new Date().toISOString(), build: __BUILD_ID__, region: region.manifest.id }) : null;
    this.quitToTitle();
    void this.play(save);
  }

  /** The cell-load timeout (plan §2.9): Retry, or Return to start, pad or mouse. */
  private groundTimeout(): void {
    if (this.panels.errorOpen) return;
    this.panels.showChoice('The ground around you is taking too long to load. Check your connection.', [
      {
        label: 'Retry',
        run: () => {
          this.panels.hideError();
          this.stream?.retry();
          this.panels.showVeil('Loading Sproutvale…');
        },
      },
      { label: this.sim?.playerEntity(LOCAL_PLAYER)?.progress?.lastShrine ? 'Return to last shrine' : 'Return to start', run: () => this.returnToStart() },
    ]);
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
    qaLog.frame++;
    const frameStart = performance.now();
    const pad = this.input.pad;
    pad.update();

    if (this.panels.errorOpen) {
      if (pad.wasPressed(['left', 'up'])) this.panels.move(-1);
      if (pad.wasPressed(['right', 'down'])) this.panels.move(1);
      if (pad.wasPressed(['a'])) this.panels.confirmError();
    } else if (this.nav.open) {
      this.nav.frame(dt);
      this.menus.frame(dt, pad);
      this.rpgMenus.frame(dt);
    }
    // An equip or a track chosen in the pause menu reaches the sim through one tick of its own.
    if (this.state === 'paused' && this.sim && this.commands.hasUi && !this.groundWait) this.pausedTick();

    if (this.state === 'playing' && this.sim && this.player) this.playFrame(dt);
    else this.idleFrame(dt);

    this.frameCount++;
    this.renderer.render();
    this.hud.update(pad, this.input.locked);
    const p = this.sim?.playerEntity(LOCAL_PLAYER);
    const fs = this.renderer.frameStats();
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
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
      combat: this.overlay.open ? [...frameDataLines(p, this.sim?.now ?? 0), '', ...targetLines(p?.combat?.lock != null ? this.sim?.get(p.combat.lock) : undefined)] : [],
      frame: fs,
      heapMb: mem ? mem.usedJSHeapSize / 1048576 : null,
      world: this.overlay.open && this.stream ? this.stream.overlayLines(p ? p.tf.pos : null) : [],
    });
    this.input.endFrame();
  }

  private playFrame(dt: number): void {
    const sim = this.sim!;
    const view = this.player!;
    const simView = sim.view();
    const pad = this.input.pad;
    if (this.input.wasPressed(KEYS.pause) || pad.wasPressed(PAD.pause)) {
      this.pause();
      return;
    }
    // Menus the sim opens (dialogue, shop, shrine) follow the player's progress.
    const menu = this.syncSimMenus(sim.playerEntity(LOCAL_PLAYER));
    if (!menu && this.mode === 'world') {
      if (this.input.wasPressed(KEYS.questLog) || pad.wasPressed(PAD.questLog)) return this.openFromPlay(this.rpgMenus.quests);
      if (this.input.wasPressed(KEYS.inventory)) return this.openFromPlay(this.rpgMenus.character);
    }
    if (this.overlay.open) {
      if (pad.wasPressed(['right'])) this.cycleClip(1);
      if (pad.wasPressed(['left'])) this.cycleClip(-1);
    }
    // Look: raw mouse, then the right stick. Locked on (plan §4.1), the camera turns itself to the
    // target and horizontal look becomes the target switch (CommandBuilder), so it doesn't turn yaw.
    // In a menu the sticks drive the menu and the camera frames the speaker.
    const locked = this.lockPoint(simView, sim.playerEntity(LOCAL_PLAYER)) !== null;
    const m = this.input.consumeMouseDelta();
    if (!menu) {
      if (m.x || m.y) this.rig.rotateMouse(locked ? 0 : m.x, m.y);
      if (pad.look.x || pad.look.y) this.rig.rotatePad(locked ? 0 : pad.look.x, pad.look.y, dt);
    }

    if (menu) {
      // Gameplay input is suppressed while a menu is up: the ticks get idle moves (plus the
      // menu's queued intents). F / pad Y still advance a dialogue.
      this.commands.clear();
      if (this.input.wasPressed(KEYS.interact) || pad.wasPressed(PAD.interact)) this.rpgMenus.interactPressed();
    } else this.commands.frame({ locked, mouseDx: m.x, dt });
    // Streaming runs before the ticks, so colliders queued now are built at the top of this frame's ticks.
    const held = this.streamFrame(simView);
    const ticks = this.loop.advance(dt);
    const t0 = performance.now();
    for (let i = 0; i < ticks; i++) {
      // Behind the veil the player is frozen by the sim anyway; their input is dropped, not buffered.
      const cmd = this.commands.take(this.rig.yaw);
      sim.tick(held ? new Map() : new Map([[LOCAL_PLAYER, cmd]]));
      this.afterTick(simView);
    }
    if (ticks) this.simMs = (performance.now() - t0) / ticks;

    const p = sim.playerEntity(LOCAL_PLAYER);
    if (!p) return;
    this.autosave(simView, p, dt, held);
    this.syncEquipment(p);
    view.update(p, this.loop.alpha, dt);
    const a = p.combat?.action;
    if (QA_LOG_ENABLED && a?.kind === 'attack' && view.attackShown && a !== this.posedAction) {
      this.posedAction = a;
      qaLog.add({ kind: 'pose', tick: sim.now, what: a.move });
    }
    if (QA_LOG_ENABLED && a?.kind === 'cast' && view.castShown && a !== this.castPosed) {
      this.castPosed = a;
      qaLog.add({ kind: 'castPose', tick: sim.now, what: a.spell });
    }
    this.world.sync(simView, this.loop.alpha, dt);
    this.fx.update(dt);
    this.target.copy(view.root.position);
    this.rig.update(dt, this.target, simView, p.loco?.sprinting ?? false, this.speakerPoint(simView, p) ?? this.lockPoint(simView, p));
    this.renderer.follow(this.target);
    // Screen-space UI projects through this frame's camera.
    this.renderer.camera.updateMatrixWorld();
    this.numbers.update(dt, this.project);
    this.hud.combat(this.hudCombat(simView, p), dt);
    this.rpgFrame(simView, p, dt, !!menu);
  }

  /**
   * Open or close the menus the sim drives (plan §5: the sim owns the cursor): dialogue while
   * `progress.dialogue` is set, else the shop, else the shrine. Returns the open one, or null.
   */
  private syncSimMenus(p: Readonly<Entity> | undefined): Screen | null {
    const want = this.rpgMenus.wanted(p?.progress);
    if (want) {
      if (!this.nav.has(want)) {
        this.rpgMenus.opened(want);
        this.nav.reset(want);
        this.commands.clear();
        // Free the mouse so the menu can be clicked; keyboard and pad work either way.
        if (this.input.locked) {
          this.releasingLock = true;
          this.input.releaseLock();
        }
      }
      return want;
    }
    if (this.rpgMenus.isSimScreen(this.nav.top)) {
      this.nav.reset(null);
      if (this.input.pad.device === 'kbm') this.input.requestLock();
    }
    return null;
  }

  /** Character or Quest log straight from play (I, J, pad View): paused, and Back returns to play. */
  private openFromPlay(screen: Screen): void {
    this.pause();
    this.nav.reset(screen);
  }

  /** While paused, queued menu intents (equip, track) get one tick so the menu shows the result. */
  private pausedTick(): void {
    const sim = this.sim!;
    this.commands.clear();
    sim.tick(new Map([[LOCAL_PLAYER, this.commands.take(this.rig.yaw)]]));
    this.afterTick(sim.view());
  }

  /**
   * Autosave (plan §2.8): when an event asked for it (shrine rest, quest step or completion, level
   * up), and every 5 minutes of play out of combat. Never while dead or held behind the veil.
   */
  private autosave(view: ReadonlySimView, p: Readonly<Entity>, dt: number, held: boolean): void {
    if (this.mode !== 'world' || !p.progress) return;
    const dead = p.combat?.action?.kind === 'dead';
    const fighting = view.entities.some((e) => e.brain && e.brain.target === p.id && (e.brain.state === 'engage' || e.brain.state === 'leash'));
    if (!fighting && !dead) this.sinceSave += dt;
    if (this.sinceSave >= AUTOSAVE_SEC && !fighting) this.saveWanted = true;
    if (this.saveWanted && !dead && !held) {
      this.saveWanted = false;
      this.writeSaveNow();
    }
  }

  /** The staff in the player's hands follows the equipment (the robe tint waits for M4's art). */
  private syncEquipment(p: Readonly<Entity>): void {
    const id = p.progress?.equipment.staff;
    if (!id || !this.player) return;
    const key = this.staffModel(id);
    if (key === this.staffShown) return;
    this.staffShown = key;
    void this.player.setStaff(key);
  }

  private staffModel(item: string | undefined): ModelKey {
    const key = item ? ITEMS[item]?.staff?.model : undefined;
    return key && key in MODELS ? (key as ModelKey) : 'staff_sproto';
  }

  /**
   * In a dialogue the camera turns to frame the speaker's face (plan §5). It aims a little to the
   * speaker's left, so the speaker stands right of centre instead of behind the player's head.
   */
  private speakerPoint(view: ReadonlySimView, p: Readonly<Entity>): THREE.Vector3 | null {
    const npc = p.progress?.dialogue?.npc;
    if (!npc) return null;
    const e = view.entities.find((x) => x.npc?.id === npc);
    if (!e) return null;
    const v = this.world.get(e.id);
    const pos = v?.root.position ?? e.tf.pos;
    const me = this.player?.root.position ?? p.tf.pos;
    const yaw = Math.atan2(pos.x - me.x, pos.z - me.z);
    // Screen-left of the player → speaker line is (cos yaw, −sin yaw) (the camera's right is −that).
    const side = 1.3;
    return this.lockPos.set(pos.x + Math.cos(yaw) * side, pos.y + (v?.height ?? e.body?.height ?? 1.8) * 0.85, pos.z - Math.sin(yaw) * side);
  }

  /** The RPG HUD: level, Sprouts, tonics, tracker, compass and the interact prompt (world mode). */
  private rpgFrame(view: ReadonlySimView, p: Readonly<Entity>, dt: number, inMenu: boolean): void {
    const pr = p.progress;
    if (this.mode !== 'world' || !pr) return;
    const tracker = trackedQuest(pr);
    let marker: HudRpgState['compass']['marker'] = null;
    const at = tracker?.marker ? view.locate(tracker.marker) : null;
    if (at) marker = { offset: compassOffset(this.rig.yaw, headingTo(p.tf.pos, at)), dist: Math.hypot(at.x - p.tf.pos.x, at.z - p.tf.pos.z) };
    let prompt: HudRpgState['prompt'] = null;
    const t = inMenu || p.combat?.action?.kind === 'dead' ? null : view.interactTarget(LOCAL_PLAYER);
    if (t) {
      if (t.kind === 'shrine') this.rpgMenus.nameShrine(t.id, t.name);
      prompt = { key: promptLabel(this.input.pad.device, this.input.pad.style, KEYS.interact, PAD.interact), text: interactLabel(t.kind, t.name) };
    }
    this.rpgHud.update({ level: pr.level, xp: pr.xp, points: pr.points, sprouts: pr.sprouts, tonics: pr.tonics, tracker, compass: { camYaw: this.rig.yaw, marker }, prompt }, dt);
  }

  /**
   * The world's frame while playing: stream around the player, then hold them behind the veil
   * until their cell and its neighbours have colliders (plan §3.2, §2.9). Returns true while held.
   */
  private streamFrame(view: ReadonlySimView): boolean {
    const w = this.stream;
    const p = this.sim?.playerEntity(LOCAL_PLAYER);
    if (!w || !p) return false;
    w.frame({ x: p.tf.pos.x, z: p.tf.pos.z, vx: p.tf.vel.x, vz: p.tf.vel.z }, view, view.now);
    if (this.pendingDrop) this.dropPending();
    const ground = w.ground(view, p.tf.pos);
    if (ground === 'ready') {
      if (this.groundWait) {
        this.groundWait = false;
        this.panels.hideVeil();
        this.panels.hideError();
        this.hud.visible = true;
      }
      return false;
    }
    if (!this.groundWait) {
      this.groundWait = true;
      this.hud.visible = false;
      this.panels.showVeil('Loading Sproutvale…');
    }
    if (ground === 'timeout') this.groundTimeout();
    return true;
  }

  /** Everything that reacts to one sim tick: QA stamps, then each event's feedback. */
  private afterTick(view: ReadonlySimView): void {
    if (QA_LOG_ENABLED && this.playerId !== null) {
      const a = view.get(this.playerId)?.combat?.action;
      // An attack's t is 0 only on the tick that started it (it advances before a new one starts).
      if (a?.kind === 'attack' && a.t === 0) qaLog.add({ kind: 'attackStart', tick: view.now, what: a.move });
    }
    for (const e of view.events) {
      this.present(view, e);
      // First-time hints teach the world's rules as they come up (not in the yard or the sandbox).
      if (this.mode === 'world') {
        const tip = this.tutorial.tip(e, this.playerId, this.input.pad.device === 'gamepad' ? 'pad' : 'kbm');
        if (tip) this.hud.toast(tip);
      }
    }
  }

  /**
   * Feedback for one sim event (plan §1 Feedback, §4.6): sounds, sparks, damage numbers, camera
   * trauma and rumble, on the frame the event's tick ran. Hit-stop itself is the sim's.
   */
  private present(view: ReadonlySimView, e: SimEvent): void {
    const me = this.playerId;
    const pad = this.input.pad;
    switch (e.type) {
      case 'land':
        if (e.entity === me && e.fallSpeed > 6) {
          const k = Math.min(1, (e.fallSpeed - 6) / 10);
          this.shake(0.15 + 0.25 * k);
          pad.rumble(GAMEPAD.rumble.land, 0.6 + k);
        }
        return;
      case 'swing': {
        if (e.entity === me) {
          this.audio.play(e.heavy ? 'carpetWhoosh' : 'rugWhoosh', 0.94 + Math.random() * 0.12);
          return;
        }
        const ent = view.get(e.entity);
        const mv = enemyDef(ent)?.moves.find((x) => x.id === e.move);
        // The unblockable slam hits the ground: a slam, not a whoosh. Bigger bodies swing lower.
        if (mv?.unblockable) this.audio.play('bossSlam');
        else this.audio.play('rugWhoosh', ent?.view.model === 'brute' ? 0.72 : 0.86);
        return;
      }
      case 'hit':
        this.presentHit(view, e);
        return;
      case 'block': {
        this.fx.burst(e.pos, 'block');
        this.audio.play('shieldBlock', 0.95 + Math.random() * 0.1);
        if (e.guardBreak) this.audio.play('clash', 0.6);
        if (e.target === me) {
          pad.rumble(e.guardBreak ? RUMBLE.hurt : RUMBLE.block);
          this.shake(e.guardBreak ? TRAUMA.guardBreak : TRAUMA.block);
        }
        return;
      }
      case 'parry':
        this.fx.burst(e.pos, 'parry');
        this.fx.ring(e.pos, 0xbfe8ff, 0.3, 2.6, 0.32);
        this.audio.play('shieldPerfect');
        if (e.target === me) {
          pad.rumble(RUMBLE.parry);
          this.shake(TRAUMA.parry);
          this.flashScreen();
        }
        return;
      case 'dodgePerfect': {
        const pos = e.entity === me && this.player ? this.player.root.position : view.get(e.entity)?.tf.pos;
        if (pos) this.fx.ring(pos, 0x8ff0ff, 0.4, 2.2, 0.3);
        this.audio.play('shieldUp', 1.35, 0.8);
        if (e.entity === me) pad.rumble(RUMBLE.perfectDodge);
        return;
      }
      case 'dodge':
        this.audio.play('dodge', 0.95 + Math.random() * 0.1);
        return;
      case 'noStamina':
        if (e.entity === me) {
          this.hud.flashStamina();
          this.audio.play('noMana', 1.2, 0.7);
        }
        return;
      case 'stagger':
        // Poise broken: a heavy thud on top of the hit.
        if (e.entity !== me) this.audio.play('pillarHit', 0.6);
        return;
      case 'telegraph':
        this.world.event(view, e);
        if (e.unblockable) this.audio.play('stunCharge');
        return;
      case 'fire': {
        // Spells sound on their `cast` event; enemy shots here (a hex lower and softer than a coin).
        const pr = view.get(e.projectile)?.projectile;
        if (pr?.spell) return;
        this.audio.play('boltCast', pr?.kind === 'arcane' ? 0.85 : 1.6, 0.6);
        return;
      }
      case 'death':
        if (e.entity === me) {
          this.audio.play('roundLose');
          // The world sends you back to the last shrine you rested at (plan §2.9).
          if (this.mode === 'world') this.hud.showDeath(true, 'You fell', 'You will wake at the last shrine you rested at');
          else this.hud.showDeath(true);
          pad.rumble(RUMBLE.hurt, 1.2);
          this.shake(TRAUMA.death);
        } else {
          this.audio.play('pillarHit', 0.75);
          if (this.lastHitEnemy === e.entity) this.lastHitEnemy = null;
        }
        return;
      case 'respawn':
        if (e.entity === me) {
          this.hud.showDeath(false);
          const p = view.get(e.entity);
          if (p) {
            this.target.set(p.tf.pos.x, p.tf.pos.y, p.tf.pos.z);
            this.rig.snap(this.target, p.tf.yaw);
          }
        }
        return;
      case 'lock':
        if (e.entity === me && e.target !== null) this.audio.play('lockBeep');
        return;
      default:
        this.presentSpell(view, e);
        return;
    }
  }

  /**
   * Spells, statuses and waves (M1b): sounds, rumble and trauma here; their world visuals in
   * WorldViews; the spell bar, banners and toasts in the HUD.
   */
  private presentSpell(view: ReadonlySimView, e: SimEvent): void {
    const me = this.playerId;
    const pad = this.input.pad;
    const qa = (kind: Parameters<typeof qaLog.add>[0]['kind'], what?: string) => QA_LOG_ENABLED && qaLog.add({ kind, tick: view.now, what });
    switch (e.type) {
      case 'castStart':
        qa('castStart', e.spell);
        if (e.entity === me && e.woven) {
          // Woven (plan §1): a cyan rune at the hands and a bright chime.
          const p = this.player?.root;
          if (p) this.world.spells.rune({ x: p.position.x + Math.sin(p.rotation.y) * 0.5, y: p.position.y + 1.3, z: p.position.z + Math.cos(p.rotation.y) * 0.5 });
          this.audio.play('shieldUp', 1.7, 0.7);
        }
        return;
      case 'cast':
        qa('cast', e.spell);
        if (e.spell === 'bolt') this.audio.play('boltCast', e.woven ? 1.15 : 1);
        else if (e.spell === 'blast') this.audio.play('boltCast', 0.62, 1.2);
        if (e.entity === me) pad.rumble(RUMBLE.cast);
        return;
      case 'noMana':
        qa('noMana', e.spell);
        if (e.entity === me) {
          this.hud.flashSpell(e.spell, 'mana');
          this.audio.play('noMana');
        }
        return;
      case 'cooldown':
        qa('cooldown', e.spell);
        if (e.entity === me) {
          this.hud.flashSpell(e.spell, 'cooldown');
          this.audio.play('uiHover', 0.7, 0.8);
        }
        return;
      case 'explode': {
        qa('explode', e.spell ?? undefined);
        this.world.event(view, e);
        this.audio.play('blastExplode', 0.95 + Math.random() * 0.1);
        const p = this.player?.root.position;
        const d = p ? Math.hypot(p.x - e.pos.x, p.z - e.pos.z) : BLAST_SHAKE_RANGE;
        this.shake(TRAUMA.blast * Math.max(0.25, 1 - d / BLAST_SHAKE_RANGE));
        if (e.entity === me) pad.rumble(RUMBLE.blast);
        return;
      }
      case 'nova':
        qa('nova');
        this.world.event(view, e);
        this.audio.play('shieldPerfect', 0.6);
        this.audio.play('shieldBlock', 1.5, 0.6);
        if (e.entity === me) {
          this.shake(TRAUMA.nova);
          pad.rumble(RUMBLE.nova);
        }
        return;
      case 'zap':
        qa('zap');
        this.world.event(view, e);
        this.audio.play('boltHit', 1.5);
        this.audio.play('boltCast', 1.9, 0.6);
        if (e.entity === me) pad.rumble(RUMBLE.zap);
        return;
      case 'status': {
        qa('status', `${e.status}x${e.stacks}`);
        // A status landing reveals the type's affinity to it (plan §4.6).
        const def = enemyDef(view.get(e.entity));
        if (def) this.reveals.reveal(def.id, e.status, e.affinity);
        return;
      }
      case 'frozen':
        this.world.event(view, e);
        this.audio.play('shieldBlock', 0.55);
        return;
      case 'interrupt': {
        // A ranged wind-up cut short (a Bolt, or Shock): a bright crack on the caster.
        const t = view.get(e.entity);
        const v = this.world.get(e.entity);
        if (t) {
          const pos = v?.root.position ?? t.tf.pos;
          this.fx.burst({ x: pos.x, y: pos.y + (v?.height ?? 1.8) * 0.7, z: pos.z }, 'shock');
        }
        this.audio.play('clash', 1.35, 0.8);
        return;
      }
      case 'blink':
        this.world.event(view, e);
        this.audio.play('shieldUp', 1.6, 0.6);
        return;
      case 'wave':
        qa('wave', String(e.wave));
        // `wave` counts on through the loops (1, 2, 3, 4…).
        this.hud.waveBanner(`Wave ${e.wave}`, `${e.enemies} enemies`);
        this.audio.play('shieldUp', 0.8);
        return;
      case 'waveClear':
        qa('waveClear', String(e.wave));
        this.hud.waveBanner('Wave cleared');
        this.audio.play('shieldPerfect', 1.2);
        return;
      default:
        this.presentRpg(view, e);
        return;
    }
  }

  /**
   * RPG events (M3) for the local player: banners for the big moments (a quest started or done, a
   * level), feed lines for the small ones, the refusal's reason as a toast, and the autosave
   * triggers (plan §2.8).
   */
  private presentRpg(view: ReadonlySimView, e: SimEvent): void {
    if (!('entity' in e) || e.entity !== this.playerId) return;
    const hud = this.rpgHud;
    const quest = (id: string) => QUESTS[id]?.title ?? id;
    switch (e.type) {
      case 'xp':
        if (e.amount > 0) hud.feed(`+${e.amount} XP`, 'level');
        return;
      case 'levelUp':
        this.hud.waveBanner('Level up!', `Level ${e.level} · +${e.points} skill points`);
        this.hud.toast(`+${e.points} skill points: spend them on the Skills tab.`);
        hud.feed(`Reached level ${e.level}`, 'level');
        this.audio.play('shieldPerfect', 1.3);
        this.saveWanted = true;
        return;
      case 'itemGained':
        hud.feed(`Got ${ITEMS[e.item]?.name ?? e.item}${e.count > 1 ? ` ×${e.count}` : ''}`, 'item');
        return;
      case 'currency':
        // Sprouts from the ground pulse the counter; a chest's or a reward's gets a line too.
        if (e.amount > 0 && !view.events.some((x) => x.type === 'pickup' && x.kind === 'sprouts')) hud.feed(`+${e.amount} Sprouts`, 'item');
        return;
      case 'equip':
        hud.feed(`Equipped ${ITEMS[e.item]?.name ?? e.item}`, 'item');
        return;
      case 'bought':
        hud.feed(`Bought ${ITEMS[e.item]?.name ?? e.item} for ${e.price} Sprouts`, 'item');
        this.audio.play('uiClick', 0.8);
        return;
      case 'refused':
        this.rpgMenus.event(e);
        this.hud.toast(e.reason);
        this.audio.play('noMana', 1.1, 0.6);
        return;
      case 'drink':
        this.audio.play('shieldUp', 0.7, 0.6);
        return;
      case 'pickup':
        this.audio.play('uiHover', e.kind === 'heart' ? 0.8 : 1.5, 0.7);
        return;
      case 'interact':
        if (e.kind === 'chest') this.audio.play('shieldBlock', 0.6);
        return;
      case 'shrineRest':
        this.world.event(view, e);
        hud.feed('Rested: health and tonics restored', 'info');
        this.rpgMenus.event(e);
        this.audio.play('shieldPerfect', 0.8);
        this.saveWanted = true;
        return;
      case 'questStarted':
        this.hud.waveBanner('New quest', quest(e.quest));
        hud.feed(`New quest: ${quest(e.quest)}`, 'quest');
        this.audio.play('shieldUp', 1.1);
        return;
      case 'questStep':
        hud.feed(`Quest updated: ${quest(e.quest)}`, 'quest');
        this.audio.play('uiClick', 1.3);
        this.saveWanted = true;
        return;
      case 'questComplete':
        this.hud.waveBanner('Quest complete', quest(e.quest));
        hud.feed(`Quest complete: ${quest(e.quest)}`, 'quest');
        this.audio.play('shieldPerfect', 1.1);
        this.saveWanted = true;
        return;
      case 'spellLearned':
        hud.feed(`Learned ${SPELLS[e.spell as SpellId]?.name ?? e.spell}`, 'level');
        this.hud.toast(`New spell: ${SPELLS[e.spell as SpellId]?.name ?? e.spell}`);
        return;
      case 'skillSpent':
      case 'skillsReset':
      case 'spellEquipped':
        // Saved like a rest, so a reload keeps it.
        this.audio.play('uiClick', 1.1);
        this.saveWanted = true;
        return;
      default:
        return;
    }
  }

  /**
   * A hit: spark, sound, damage number, flinch, trauma and rumble, all on this frame (the M1a gate
   * checks it in the QA log: every `hit` has its spark, sound and number on the same frame).
   */
  private presentHit(view: ReadonlySimView, e: Extract<SimEvent, { type: 'hit' }>): void {
    const me = this.playerId;
    const mine = e.attacker === me || view.get(e.attacker)?.projectile?.owner === me;
    const hurt = e.target === me;
    const n = ++this.hitCount;
    const qa = (kind: 'hit' | 'spark' | 'sound' | 'number' | 'hitstop') => QA_LOG_ENABLED && qaLog.add({ kind, tick: view.now, hit: n, what: kind === 'hit' ? e.move : undefined });
    qa('hit');
    // Damage numbers and sparks take their style from the hit's affinity (plan §4.6): Weak! and Resisted.
    const style: NumberStyle = hurt ? 'hurt' : e.affinity === 'weak' ? 'weak' : e.affinity === 'resist' ? 'resist' : e.crit ? 'crit' : 'normal';
    // Spell hits (the sim names the move after the spell) spark in the spell's colour.
    const spell = e.move in SPELLS ? (e.move as SpellId) : null;
    const spellSpark: SparkStyle | null = spell === 'blast' ? 'fire' : spell === 'chainZap' ? 'shock' : spell === 'frostNova' ? 'frost' : spell ? 'arcane' : null;
    const spark: SparkStyle = style === 'normal' ? (spellSpark ?? (e.heavy ? 'heavy' : 'normal')) : style === 'weak' || style === 'resist' || !spellSpark ? style : spellSpark;
    if (this.fx.burst(e.pos, spark) > 0) qa('spark');
    // Resisted hits sound dull (plan §4.6), weak and critical ones bright.
    const rate = e.affinity === 'resist' ? 0.7 : e.affinity === 'weak' ? 1.12 : e.crit ? 1.2 : 0.95 + Math.random() * 0.1;
    if (this.audio.play(hurt ? 'hurt' : spell ? 'boltHit' : e.heavy ? 'pillarHit' : 'clash', hurt ? 1 : rate)) qa('sound');
    if (!hurt) this.revealHit(view, e);
    this.numbers.spawn(e.pos, e.damage, style);
    qa('number');
    const hs = Math.max(view.get(e.attacker)?.combat?.hitstop ?? 0, view.get(e.target)?.combat?.hitstop ?? 0);
    if (hs > 0 || e.hitstop > 0) qa('hitstop');
    this.world.event(view, e);
    if (mine) {
      this.lastHitEnemy = e.target;
      this.lastHitAt = performance.now();
      this.shake(e.crit ? TRAUMA.crit : e.heavy ? TRAUMA.heavyHit : TRAUMA.lightHit);
      this.input.pad.rumble(e.heavy || e.crit ? RUMBLE.heavyHit : RUMBLE.lightHit);
    }
    if (hurt) {
      this.shake(TRAUMA.hurt);
      this.input.pad.rumble(RUMBLE.hurt);
    }
  }

  /**
   * The first hit of each damage kind on an enemy type reveals its icon (plan §4.6), and the first
   * Weak! and the first Resisted of the session each get a toast explaining them.
   */
  private revealHit(view: ReadonlySimView, e: Extract<SimEvent, { type: 'hit' }>): void {
    const def = enemyDef(view.get(e.target));
    if (!def) return;
    this.reveals.reveal(def.id, e.kind, e.affinity);
    if (e.affinity !== 'normal' && this.reveals.firstToast(e.affinity)) this.hud.toast(affinityToast(def, e.kind, e.affinity));
  }

  private shake(amount: number): void {
    if (this.settings.shake) this.rig.addTrauma(amount);
  }

  /** A white screen flash (parry); off with the shake setting (motion sensitivity). */
  private flashScreen(): void {
    if (!this.settings.shake) return;
    const el = this.screenFlash;
    el.classList.remove('go');
    void el.offsetWidth;
    el.classList.add('go');
  }

  /** The player's lock target's chest (interpolated with its view), or null when not locked. */
  private lockPoint(view: ReadonlySimView, p: Readonly<Entity> | undefined): THREE.Vector3 | null {
    const id = p?.combat?.lock;
    if (id === null || id === undefined) return null;
    const t = view.get(id);
    if (!t) return null;
    const v = this.world.get(id);
    const pos = v?.root.position ?? t.tf.pos;
    const h = v?.height ?? t.body?.height ?? 1.8;
    return this.lockPos.set(pos.x, pos.y + h * 0.6, pos.z);
  }

  /** World → screen pixels through the current camera. */
  private readonly project: Projector = (p) => {
    const v = this.v3.set(p.x, p.y, p.z).project(this.renderer.camera);
    const visible = v.z < 1 && Math.abs(v.x) <= 1.1 && Math.abs(v.y) <= 1.1;
    return { x: ((v.x + 1) / 2) * window.innerWidth, y: ((1 - v.y) / 2) * window.innerHeight, visible };
  };

  private hudCombat(view: ReadonlySimView, p: Readonly<Entity>): HudCombat {
    const v = p.vitals;
    const lock = p.combat?.lock ?? null;
    let enemyId = lock;
    if (enemyId === null && this.lastHitEnemy !== null && performance.now() - this.lastHitAt < ENEMY_BAR_MS) enemyId = this.lastHitEnemy;
    let enemy: HudCombat['enemy'] = null;
    const t = enemyId !== null ? view.get(enemyId) : undefined;
    if (t?.vitals && t.combat?.action?.kind !== 'dead') {
      const tv = this.world.get(t.id);
      const pos = tv?.root.position ?? t.tf.pos;
      const h = tv?.height ?? t.body?.height ?? 1.8;
      const s = this.project({ x: pos.x, y: pos.y + h + 0.35, z: pos.z });
      const def = enemyDef(t);
      enemy = { ...s, name: def?.name ?? 'Enemy', hp: t.vitals.hp, hpMax: t.vitals.hpMax, affinities: def ? this.reveals.list(def.id) : [], statuses: hudStatuses(t) };
    }
    const lp = this.lockPoint(view, p);
    const c = p.combat;
    const a = c?.action;
    return {
      player: v ? { hp: v.hp, hpMax: v.hpMax, stamina: v.stamina, staminaMax: v.staminaMax, mana: v.mana, manaMax: v.manaMax } : null,
      enemy,
      reticle: lp ? this.project(lp) : null,
      spells: v && c
        ? { mana: v.mana, cooldowns: c.cooldowns ?? {}, casting: a?.kind === 'cast' ? a.spell : null, woven: view.now - c.lastHitTick <= WOVEN.window, learned: this.mode === 'world' ? p.progress?.spells : undefined }
        : null,
      wave: view.wave ? { ...view.wave } : null,
    };
  }

  /** QA timing hooks (dev and QA builds): presses latched and the ticks that took them. */
  private bindQaLog(): void {
    const which = (bits: number) => (bits & BTN.heavy ? 'heavy' : bits & BTN.light ? 'light' : null);
    this.commands.onLatch = (pressed) => {
      const w = which(pressed);
      if (w) qaLog.add({ kind: 'press', what: w });
    };
    this.commands.onTake = (cmd) => {
      const w = which(cmd.pressed);
      if (w) qaLog.add({ kind: 'command', tick: this.sim?.now ?? 0, what: w });
    };
  }

  /**
   * Title and pause: a slow orbit over the yard, or over the world's player start while its cells
   * stream in (paused keeps the frozen scene, and keeps streaming around the player).
   */
  private idleFrame(dt: number): void {
    const w = this.stream;
    if (w && this.state !== 'playing') {
      const p = this.sim?.playerEntity(LOCAL_PLAYER);
      const start = w.start;
      if (p) w.frame({ x: p.tf.pos.x, z: p.tf.pos.z, vx: 0, vz: 0 }, this.sim!.view(), this.sim!.now);
      else if (start) w.frame({ x: start.pos[0], z: start.pos[2], vx: 0, vz: 0 }, null, this.frameCount);
    }
    if (this.state === 'paused' || this.state === 'loading') return;
    this.orbit += dt * 0.08;
    const cam = this.renderer.camera;
    const c = w?.start?.pos;
    if (w && c) {
      // Sproutvale: stand at the start and pan slowly across the valley (the start sits near the
      // south edge, so an orbit around it would mostly show the boundary cliff).
      const ground = w.heightAt(c[0], c[2]) ?? c[1];
      const a = Math.sin(this.orbit * 0.6) * 1.1;
      cam.position.set(c[0], ground + 7, c[2] - 6);
      cam.lookAt(c[0] + Math.sin(a) * 60, ground + 2, c[2] + Math.cos(a) * 60);
      this.target.set(c[0], ground, c[2]);
    } else {
      cam.position.set(Math.sin(this.orbit) * 22, 9, Math.cos(this.orbit) * 22);
      cam.lookAt(0, 1.5, 0);
      this.target.set(0, 0, 0);
    }
    this.renderer.follow(this.target);
  }

  /**
   * QA (dev and QA builds): put the player at (x, z). They are held in the air over the cell until
   * its heights are decoded, then set down on the terrain; the sim keeps them frozen until the
   * cell's colliders exist. Moves the sim entity directly: a debug cheat, not a gameplay path.
   */
  qaTeleport(x: number, z: number): boolean {
    const sim = this.sim;
    const p = sim?.playerEntity(LOCAL_PLAYER);
    const region = this.stream?.region;
    if (!sim || !p || !region) return false;
    const y = this.stream!.heightAt(x, z);
    this.placePlayer(x, y ?? region.manifest.heightRange.max + 2, z);
    this.pendingDrop = y === null ? { x, z } : null;
    return true;
  }

  private dropPending(): void {
    const d = this.pendingDrop!;
    const y = this.stream?.heightAt(d.x, d.z) ?? null;
    if (y === null) return;
    this.pendingDrop = null;
    this.placePlayer(d.x, y, d.z);
  }

  private placePlayer(x: number, y: number, z: number): void {
    // A little above the surface: the character controller settles onto it on the first tick.
    const pos = { x, y: y + 0.05, z };
    this.sim!.teleportPlayer(LOCAL_PLAYER, pos);
    this.target.set(pos.x, pos.y, pos.z);
    this.player?.root.position.copy(this.target);
    this.rig.snap(this.target, this.rig.yaw);
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
      player: p
        ? {
            id: p.id,
            pos: { ...p.tf.pos },
            yaw: p.tf.yaw,
            grounded: p.loco?.grounded ?? false,
            speed: p.loco?.speed ?? 0,
            action: p.combat?.action?.kind ?? null,
            cast: p.combat?.action?.kind === 'cast' ? { ...p.combat.action } : null,
            hp: p.vitals?.hp ?? null,
            mana: p.vitals?.mana ?? null,
            manaMax: p.vitals?.manaMax ?? null,
            cooldowns: { ...(p.combat?.cooldowns ?? {}) },
            lock: p.combat?.lock ?? null,
          }
        : null,
      sandbox: WAVE_SANDBOX,
      mode: this.mode,
      groundWait: this.groundWait,
      waitingForGround: this.sim?.view().waitingForGround ?? false,
      errorAction: this.panels.focusedAction,
      world: this.stream?.qa() ?? null,
      frameStats: { ...this.renderer.frameStats() },
      gpuMemory: { ...this.renderer.renderer.info.memory },
      heap: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null,
      wave: this.sim?.view().wave ?? null,
      projectiles: (this.sim?.entities ?? [])
        .filter((e) => e.projectile)
        .map((e) => ({ id: e.id, model: e.view.model, spell: e.projectile!.spell ?? null, owner: e.projectile!.owner, pos: { ...e.tf.pos }, viewShown: !!this.world.get(e.id) })),
      toast: this.hud.toastText,
      camYaw: this.rig.yaw,
      enemies: (this.sim?.entities ?? [])
        .filter((e) => e.kind === 'enemy' || e.kind === 'boss')
        .map((e) => ({
          id: e.id, def: e.brain?.def ?? null, model: e.view.model, pos: { ...e.tf.pos }, hp: e.vitals?.hp ?? null, action: e.combat?.action?.kind ?? null,
          statuses: Object.keys(e.statuses ?? {}).filter((k) => k !== 'slowAcc'), viewShown: !!this.world.get(e.id),
        })),
      staffMounted: this.player?.staffMounted ?? false,
      clips: this.player?.animator?.clipNames ?? [],
      errorOpen: this.panels.errorOpen,
      drawCalls: this.renderer.renderer.info.render.calls,
      rpg: p?.progress ? JSON.parse(JSON.stringify(p.progress)) : null,
      rpgWorld: this.sim ? JSON.parse(JSON.stringify(this.sim.view().world)) : null,
      interact: this.sim?.view().interactTarget(LOCAL_PLAYER) ?? null,
      choices: this.sim?.view().dialogueChoices(LOCAL_PLAYER) ?? [],
      typing: this.rpgMenus.typing,
      tracker: this.rpgHud.trackerText,
      prompt: this.rpgHud.promptText,
      markerShown: this.rpgHud.markerShown,
      feed: this.rpgHud.feedText,
      saves: this.saves,
      deathShown: this.hud.deathShown,
      objects: (this.sim?.entities ?? [])
        .filter((e) => e.npc || e.interactable || e.pickup)
        .map((e) => ({ id: e.npc?.id ?? e.interactable?.id ?? null, kind: e.npc ? 'npc' : (e.interactable?.kind ?? 'pickup'), used: e.interactable?.used ?? false, pos: { ...e.tf.pos }, viewShown: !!this.world.get(e.id) })),
    };
  }
}

/** The statuses under an enemy's health bar: Frozen replaces Chill while it lasts. */
function hudStatuses(t: Readonly<Entity>): HudStatus[] {
  const s = t.statuses;
  const out: HudStatus[] = [];
  if (s?.burn) out.push({ id: 'burn', stacks: 1 });
  if (t.combat?.action?.kind === 'frozen') out.push({ id: 'frozen', stacks: 1 });
  else if (s?.chill) out.push({ id: 'chill', stacks: s.chill.stacks });
  if (s?.shock) out.push({ id: 'shock', stacks: 1 });
  return out;
}

/** Kick off physics while the shell loads; exported for main.ts. */
export function startPhysics(): Promise<void> {
  return initPhysics();
}

/** The compass bar's width: 440 px, narrower on a small window (App passes it to the HUD on resize). */
function compassWidth(): number {
  return Math.min(440, Math.round(window.innerWidth * 0.6));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
