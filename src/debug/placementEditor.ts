import * as THREE from 'three';
import type { App } from '../app/App';
import type { Screen } from '../ui/MenuNav';
import placementsText from '../../world-src/sproutvale/placements.json?raw';

/**
 * The in-game placement editor (M7). Dev server only: main.ts imports this module behind
 * `import.meta.env.DEV`, and scripts/check-prod-debug.mjs fails a production build that contains it.
 *
 * F9 (or LB + RB + View on a pad) pauses and opens it over the world. Pick a mark, nudge it, and copy
 * the whole of world-src/sproutvale/placements.json with the changes in. Paste that over the file and
 * run `npm run bake:world -- sproutvale`. Marks only keep props clear and name places: anything
 * spawned at a mark (villagers, camps, chests) also has its position in sproutvaleContent.ts, and a
 * content test checks the two agree.
 */

const REGION_SIZE = 512;
const STEPS = [0.5, 1, 2, 5, 10] as const;
const YAW_STEP = 15;
const CHORD = ['lb', 'rb', 'back'] as const;
const PILLAR_HEIGHT = 7;
const COLOR = { mark: new THREE.Color(0x7fe8ff), moved: new THREE.Color(0xffa040), selected: new THREE.Color(0xfff06a) };

interface Mark {
  id: string;
  kind: string;
  at: [number, number];
  yaw?: number;
}

interface Placed {
  at: [number, number];
  yaw: number;
}

const round = (v: number) => Math.round(v * 100) / 100;
const clampToRegion = (v: number) => Math.max(0, Math.min(REGION_SIZE, round(v)));

/** The file's text with the moved marks rewritten in place, so its layout and every other line stay as they are. */
export function patchPlacements(text: string, moved: ReadonlyMap<string, Placed>): { text: string; missed: string[] } {
  const lines = text.split('\n');
  const from = lines.findIndex((l) => l.includes('"marks": ['));
  const missed: string[] = [];
  for (const [id, p] of moved) {
    const head = `{ "id": "${id}",`;
    const i = lines.findIndex((l, n) => n > from && l.trimStart().startsWith(head));
    if (i < 0) {
      missed.push(id);
      continue;
    }
    const at = `"at": [${p.at[0]}, ${p.at[1]}]`;
    const yaw = `"yaw": ${p.yaw}`;
    let line = lines[i].replace(/"at": \[[^\]]*\]/, at);
    if (/"yaw": -?[\d.]+/.test(line)) line = line.replace(/"yaw": -?[\d.]+/, yaw);
    else if (p.yaw !== 0) line = line.replace(at, `${at}, ${yaw}`);
    lines[i] = line;
  }
  return { text: lines.join('\n'), missed };
}

class PlacementEditor {
  private readonly marks: Mark[] = (JSON.parse(placementsText) as { marks: Mark[] }).marks;
  private readonly moved = new Map<string, Placed>();
  private readonly screen: Screen;
  private readonly el: HTMLElement;
  private readonly fallback = document.createElement('textarea');
  private readonly group = new THREE.Group();
  private readonly pillars: THREE.InstancedMesh;
  private readonly arrow: THREE.Mesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly savedPos = new THREE.Vector3();
  private readonly savedRot = new THREE.Quaternion();
  private readonly focus = new THREE.Vector3();
  private order: number[] = [];
  private cursor = 0;
  private step = 1;
  private note = '';
  private opened = false;
  private chordDown = false;

  constructor(private readonly app: App) {
    this.el = document.createElement('section');
    this.el.id = 'screen-placement-editor';
    this.el.className = 'screen placement-editor';
    const host = document.createElement('div');
    host.className = 'menus';
    host.append(this.el);
    app.menus.root.parentElement!.append(host);
    this.screen = {
      el: this.el,
      render: () => this.render(),
      onBack: () => this.close(),
      onAdjust: (item, dir) => this.adjust(item.dataset.edit ?? '', dir),
    };
    const style = document.createElement('style');
    style.textContent = `
      .screen.placement-editor { align-items: flex-end; justify-content: flex-start; background: none; pointer-events: none; padding: 16px; }
      .placement-editor .panel { pointer-events: auto; width: min(380px, 94vw); max-height: 100%; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 12px; border-radius: 12px; background: var(--panel); border: 2px solid var(--panel-edge); }
      .placement-editor h2 { font-size: 18px; margin: 0; }
      .placement-editor .btn { font-size: 15px; padding: 6px 12px; }
      .placement-editor .note { font-size: 13px; }
      .placement-editor textarea { display: none; width: 100%; height: 90px; font: 11px ui-monospace, Menlo, monospace; }
      .placement-editor textarea.active { display: block; }
    `;
    document.head.append(style);
    this.fallback.readOnly = true;
    this.pillars = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.22, 0.22, PILLAR_HEIGHT, 8).translate(0, PILLAR_HEIGHT / 2, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false, toneMapped: false, fog: false }),
      this.marks.length,
    );
    this.pillars.frustumCulled = false;
    // Points along +z at yaw 0, the way a mark faces.
    this.arrow = new THREE.Mesh(
      new THREE.ConeGeometry(0.55, 1.8, 12).rotateX(Math.PI / 2).translate(0, 0.6, 1.5),
      new THREE.MeshBasicMaterial({ color: COLOR.selected, toneMapped: false, fog: false }),
    );
    this.group.add(this.pillars, this.arrow);
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'F9' || e.repeat) return;
      e.preventDefault();
      this.toggle();
    });
    const tick = () => {
      requestAnimationFrame(tick);
      this.frame();
    };
    requestAnimationFrame(tick);
  }

  // --- Opening and closing ----------------------------------------------------------------------

  private toggle(): void {
    if (this.app.nav.has(this.screen)) this.close();
    else this.open();
  }

  private open(): void {
    const app = this.app;
    if (!app.stream?.region || !app.sim) return;
    if (app.state === 'playing') app.pause();
    if (app.state !== 'paused') return;
    const me = app.sim.playerEntity(0)?.tf.pos;
    // Nearest first, so the marks around you come up first.
    const dist = (m: Mark) => (me ? Math.hypot(m.at[0] - me.x, m.at[1] - me.z) : 0);
    this.order = this.marks.map((_, i) => i).sort((a, b) => dist(this.marks[a]) - dist(this.marks[b]));
    this.cursor = 0;
    this.note = '';
    this.savedPos.copy(app.renderer.camera.position);
    this.savedRot.copy(app.renderer.camera.quaternion);
    app.renderer.scene.add(this.group);
    this.opened = true;
    app.nav.push(this.screen);
  }

  private close(): void {
    if (this.app.nav.top === this.screen) this.app.nav.pop();
    this.cleanUp();
  }

  private cleanUp(): void {
    if (!this.opened) return;
    this.opened = false;
    this.group.removeFromParent();
    this.app.renderer.camera.position.copy(this.savedPos);
    this.app.renderer.camera.quaternion.copy(this.savedRot);
  }

  // --- Editing ----------------------------------------------------------------------------------

  private get mark(): Mark {
    return this.marks[this.order[this.cursor] ?? 0];
  }

  private placed(m: Mark): Placed {
    return this.moved.get(m.id) ?? { at: m.at, yaw: m.yaw ?? 0 };
  }

  private put(m: Mark, p: Placed): void {
    const same = p.at[0] === m.at[0] && p.at[1] === m.at[1] && p.yaw === (m.yaw ?? 0);
    if (same) this.moved.delete(m.id);
    else this.moved.set(m.id, p);
  }

  private adjust(what: string, dir: -1 | 1): void {
    const m = this.mark;
    const p = this.placed(m);
    const move = dir * STEPS[this.step];
    switch (what) {
      case 'mark':
        this.cursor = (this.cursor + dir + this.order.length) % this.order.length;
        break;
      case 'x':
        this.put(m, { ...p, at: [clampToRegion(p.at[0] + move), p.at[1]] });
        break;
      case 'z':
        this.put(m, { ...p, at: [p.at[0], clampToRegion(p.at[1] + move)] });
        break;
      case 'yaw':
        this.put(m, { ...p, yaw: ((p.yaw + dir * YAW_STEP + 540) % 360) - 180 });
        break;
      case 'step':
        this.step = (this.step + dir + STEPS.length) % STEPS.length;
        break;
      default:
        return;
    }
    this.note = '';
    this.app.nav.refresh();
  }

  private toPlayer(): void {
    const me = this.app.sim?.playerEntity(0)?.tf.pos;
    if (!me) return;
    const m = this.mark;
    this.put(m, { ...this.placed(m), at: [clampToRegion(me.x), clampToRegion(me.z)] });
    this.say(`${m.id} moved to the player.`);
  }

  private goTo(): void {
    const p = this.placed(this.mark);
    this.app.qaTeleport(p.at[0], p.at[1]);
    this.say(`Player sent to ${this.mark.id}.`);
  }

  private reset(): void {
    this.moved.delete(this.mark.id);
    this.say(`${this.mark.id} is back where the file has it.`);
  }

  private say(note: string): void {
    this.note = note;
    this.app.nav.refresh();
  }

  private async copy(): Promise<void> {
    const { text, missed } = patchPlacements(placementsText, this.moved);
    if (missed.length) return this.say(`Could not find ${missed.join(', ')} in the file.`);
    JSON.parse(text);
    this.fallback.value = text;
    try {
      await navigator.clipboard.writeText(text);
      this.fallback.classList.remove('active');
      this.say(`Copied placements.json with ${this.moved.size} moved. Paste it over world-src/sproutvale/placements.json, then run npm run bake:world -- sproutvale.`);
    } catch {
      this.fallback.classList.add('active');
      this.say('The browser refused the clipboard: copy the text below by hand.');
      this.fallback.select();
    }
  }

  // --- Screen -----------------------------------------------------------------------------------

  private row(label: string, edit: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn';
    b.textContent = label;
    b.dataset.nav = '';
    b.dataset.edit = edit;
    b.addEventListener('click', onClick);
    return b;
  }

  private render(): void {
    const m = this.mark;
    const p = this.placed(m);
    const panel = document.createElement('div');
    panel.className = 'panel';
    const title = document.createElement('h2');
    title.textContent = 'Placement editor';
    const hint = document.createElement('p');
    hint.className = 'note';
    hint.textContent = '← → change the row. Back closes.';
    const ground = this.app.stream?.heightAt(p.at[0], p.at[1]);
    const note = document.createElement('p');
    note.className = 'note';
    note.textContent = this.note || (ground === null || ground === undefined ? 'This spot is not loaded: use Go to mark to see it.' : `Ground height here: ${ground.toFixed(2)} m.`);
    panel.append(
      title,
      hint,
      this.row(`Mark ${this.cursor + 1}/${this.order.length}: ${m.id} (${m.kind})${this.moved.has(m.id) ? ' *' : ''}`, 'mark', () => this.adjust('mark', 1)),
      this.row(`X: ${p.at[0]}`, 'x', () => this.adjust('x', 1)),
      this.row(`Z: ${p.at[1]}`, 'z', () => this.adjust('z', 1)),
      this.row(`Yaw: ${p.yaw}°`, 'yaw', () => this.adjust('yaw', 1)),
      this.row(`Step: ${STEPS[this.step]} m`, 'step', () => this.adjust('step', 1)),
      this.row('Move mark to player', '', () => this.toPlayer()),
      this.row('Go to mark', '', () => this.goTo()),
      this.row('Reset this mark', '', () => this.reset()),
      this.row(`Copy JSON (${this.moved.size} moved)`, '', () => void this.copy()),
      this.row('Close', '', () => this.close()),
      note,
      this.fallback,
    );
    this.el.replaceChildren(panel);
  }

  // --- Every frame ------------------------------------------------------------------------------

  private frame(): void {
    const pad = this.app.input.pad;
    const chord = CHORD.every((b) => pad.isDown([b]));
    if (chord && !this.chordDown) this.toggle();
    this.chordDown = chord;
    if (!this.opened) return;
    // Something else closed the menus (quit to title, a lost context).
    if (!this.app.nav.has(this.screen)) return this.cleanUp();
    this.drawMarks();
    this.aimCamera();
  }

  private groundAt(x: number, z: number): number | null {
    return this.app.stream?.heightAt(x, z) ?? null;
  }

  private drawMarks(): void {
    const selected = this.mark;
    this.marks.forEach((m, i) => {
      const p = this.placed(m);
      const y = this.groundAt(p.at[0], p.at[1]);
      if (y === null) this.matrix.makeScale(0, 0, 0);
      else this.matrix.makeTranslation(p.at[0], y, p.at[1]);
      this.pillars.setMatrixAt(i, this.matrix);
      this.pillars.setColorAt(i, m === selected ? COLOR.selected : this.moved.has(m.id) ? COLOR.moved : COLOR.mark);
    });
    this.pillars.instanceMatrix.needsUpdate = true;
    if (this.pillars.instanceColor) this.pillars.instanceColor.needsUpdate = true;
  }

  /** Look north at the selected mark from above, the same way up as the Map tab. */
  private aimCamera(): void {
    const p = this.placed(this.mark);
    const y = this.groundAt(p.at[0], p.at[1]) ?? this.app.sim?.playerEntity(0)?.tf.pos.y ?? 0;
    this.focus.set(p.at[0], y, p.at[1]);
    this.arrow.position.copy(this.focus);
    this.arrow.rotation.y = THREE.MathUtils.degToRad(p.yaw);
    const cam = this.app.renderer.camera;
    cam.position.set(this.focus.x, y + 16, this.focus.z - 14);
    cam.lookAt(this.focus);
    this.app.renderer.follow(this.focus);
  }
}

/** Start the editor (dev server only). */
export function installPlacementEditor(app: App): void {
  new PlacementEditor(app);
}
