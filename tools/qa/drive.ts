/**
 * Manual QA for the playable bodies, in the running game (dev server only). In the browser console
 * of a dev build, after starting a game (`?yard=1&localsave=0` is the quickest):
 *
 *   const qa = await import('/tools/qa/drive.ts');
 *   await qa.gunRun();     // gun in hand: stand, run, slide, dash, sights, fire, reload, grapple
 *   await qa.staffRun();   // staff in hand: stand, run, slide, dash, cast, swing, guard
 *
 * Each step is drawn from a camera in front of or beside the player (the game's own camera sits
 * behind them) and laid out as a captioned grid over the page: `[base clip + upper layer]`.
 * It presses the game's real keys, so the sim does the moving; `qa.clear()` removes the grid.
 */
import * as THREE from 'three';

interface QaApp {
  state: string;
  pause(): void;
  resume(): void;
  renderer: { renderer: THREE.WebGLRenderer; scene: THREE.Scene; camera: THREE.PerspectiveCamera; canvas: HTMLCanvasElement };
  player: { fired(): void; root: THREE.Object3D; animator: { currentClip: string | null; upperClip: string | null } };
  sim: {
    playerEntity(p: number): { progress: { abilities: Record<string, boolean> }; tf: { pos: { x: number; y: number; z: number } } };
    gunRuntime(p: number): { runtime: { reloadTicks: number; mag: number } } | null;
    movementTech(p: number): { slidingTicks: number; dashTicks: number; grapple: { active: boolean; anchor: { x: number; y: number; z: number }; ticks: number } | null } | null;
  };
}
const app = (window as unknown as { __qa: { app: QaApp } }).__qa.app;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
export const key = (code: string, down = true) => window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
export async function tap(code: string, ms = 60): Promise<void> {
  key(code);
  await sleep(ms);
  key(code, false);
}

export function clear(): void {
  document.getElementById('qa-grid')?.remove();
}

function grid(cols: number): HTMLElement {
  clear();
  const box = document.createElement('div');
  box.id = 'qa-grid';
  box.style.cssText = `position:fixed;inset:0;z-index:99999;display:grid;grid-template-columns:repeat(${cols},1fr);grid-auto-rows:1fr;background:#222;gap:2px`;
  document.body.appendChild(box);
  return box;
}

/** Draw the player from `yawOff` radians round from straight ahead of them (0 = facing the camera). */
export function tile(label: string, yawOff = 0.6, dist = 3.6): void {
  const r = app.renderer, p = app.player.root.position;
  const box = document.getElementById('qa-grid') ?? grid(4);
  const yaw = app.player.root.rotation.y + yawOff;
  const cam = r.camera.clone();
  cam.fov = 34;
  cam.updateProjectionMatrix();
  cam.position.set(p.x + Math.sin(yaw) * dist, p.y + 1.2, p.z + Math.cos(yaw) * dist);
  cam.lookAt(p.x, p.y + 0.9, p.z);
  r.renderer.render(r.scene, cam);
  const cell = document.createElement('div');
  cell.style.cssText = 'position:relative;overflow:hidden';
  const img = new Image();
  img.src = r.canvas.toDataURL('image/jpeg', 0.9);
  img.style.cssText = 'width:100%;height:100%;object-fit:cover';
  const cap = document.createElement('div');
  cap.textContent = `${label} [${app.player.animator.currentClip}+${app.player.animator.upperClip}]`;
  cap.style.cssText = 'position:absolute;left:4px;top:2px;font:11px monospace;color:#fff;background:#0008;padding:1px 3px';
  cell.append(img, cap);
  box.appendChild(cell);
}
const FRONT = 0.55, SIDE = -1.5;
const both = (label: string) => {
  tile(label, FRONT);
  tile(`${label} side`, SIDE);
};

/**
 * Unlock the movement abilities, and keep the game running for the run: it pauses itself when the
 * window loses focus, which an automated browser does all the time.
 */
function begin(): () => void {
  app.sim.playerEntity(0).progress.abilities = { slide: true, dash: true, doubleJump: true, grapple: true };
  const pause = app.pause;
  app.pause = () => undefined;
  if (app.state === 'paused') app.resume();
  return () => { app.pause = pause; };
}

/** Run forward, slide, dash: shared by both runs. */
async function moves(): Promise<void> {
  key('KeyW');
  await sleep(700);
  both('run');
  key('ShiftLeft');
  await sleep(500);
  await tap('ControlLeft');
  await sleep(220);
  both('slide');
  key('ShiftLeft', false);
  await sleep(1300);
  await tap('AltLeft', 40);
  await sleep(40);
  both('dash');
  key('KeyW', false);
  await sleep(700);
}

export async function gunRun(): Promise<unknown> {
  const end = begin();
  grid(4);
  await sleep(300);
  both('stand');
  await moves();
  key('KeyQ');
  await sleep(450);
  both('sights');
  key('KeyQ', false);
  await sleep(400);
  // The trigger pull, as the sim's gun events start it (the fire button differs by layout).
  app.player.fired();
  await sleep(90);
  both('fire');
  await sleep(600);
  // The reload key also casts on some layouts, so start the reload on the sim's own state.
  const rt = app.sim.gunRuntime(0)?.runtime;
  if (rt) rt.reloadTicks = 90;
  await sleep(650);
  both('reload');
  await sleep(1500);
  key('KeyG');
  await sleep(350);
  both('grapple');
  const tech = app.sim.movementTech(0);
  key('KeyG', false);
  end();
  return { grapple: tech?.grapple, mag: rt?.mag };
}

export async function staffRun(): Promise<void> {
  const end = begin();
  grid(4);
  await sleep(300);
  both('stand');
  await moves();
  key('Digit2');
  await sleep(250);
  both('cast');
  key('Digit2', false);
  await sleep(900);
  const canvas = app.renderer.canvas;
  canvas.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true }));
  await sleep(180);
  both('swing');
  canvas.dispatchEvent(new MouseEvent('mouseup', { button: 0, bubbles: true }));
  await sleep(900);
  key('KeyQ');
  await sleep(350);
  both('guard');
  key('KeyQ', false);
  end();
}
