import type * as THREE from 'three';
import { hex } from '../sim/hash';

export interface OverlayStats {
  fps: number;
  frameMs: number;
  simMs: number;
  ticks: number;
  hash: number;
  device: string;
  pos: { x: number; y: number; z: number } | null;
  grounded: boolean;
  speed: number;
  clip: string;
  /** The frame-data timeline (debug/frameData.ts). */
  combat: string[];
}

/**
 * The debug overlay (` key, plan §8): performance, sim state, the player's frame-data timeline,
 * and a clip viewer: [ and ] (or the pad's D-pad ← →) cycle through the player's clips and play
 * the selected one.
 */
export class Overlay {
  readonly root: HTMLElement;
  open = false;
  private fpsAcc = 0;
  private fpsFrames = 0;
  private fps = 0;

  constructor(host: HTMLElement) {
    this.root = document.createElement('pre');
    this.root.className = 'overlay';
    host.appendChild(this.root);
  }

  toggle(): void {
    this.open = !this.open;
    this.root.classList.toggle('active', this.open);
  }

  update(dt: number, renderer: THREE.WebGLRenderer, s: Omit<OverlayStats, 'fps'>): void {
    this.fpsAcc += dt;
    this.fpsFrames++;
    if (this.fpsAcc >= 0.5) {
      this.fps = this.fpsFrames / this.fpsAcc;
      this.fpsAcc = 0;
      this.fpsFrames = 0;
    }
    if (!this.open) return;
    const info = renderer.info;
    const p = s.pos;
    this.root.textContent = [
      `fps ${this.fps.toFixed(0)}   frame ${s.frameMs.toFixed(1)} ms   sim ${s.simMs.toFixed(2)} ms`,
      `draws ${info.render.calls}   tris ${(info.render.triangles / 1000).toFixed(1)}k   geo ${info.memory.geometries}   tex ${info.memory.textures}`,
      `tick ${s.ticks}   hash ${hex(s.hash)}   device ${s.device}`,
      p ? `pos ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}   ${s.grounded ? 'grounded' : 'airborne'}   ${s.speed.toFixed(2)} m/s` : 'no player',
      `clip viewer: [ ] or D-pad ← →   ${s.clip}`,
      '',
      ...s.combat,
    ].join('\n');
  }
}
