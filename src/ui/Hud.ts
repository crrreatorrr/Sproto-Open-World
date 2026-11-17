import type { GamepadInput } from '../input/Gamepad';
import { KEYS, PAD } from '../input/bindings';
import { promptLabel } from '../input/glyphs';

/**
 * M0 HUD: control prompts that follow the last device used (keyboard + mouse or a pad, with the
 * pad's own glyphs), plus a "click to look" hint when the mouse isn't captured.
 */
export class Hud {
  readonly root: HTMLElement;
  private readonly prompts: HTMLElement;
  private readonly clickHint: HTMLElement;
  private last = '';

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.prompts = document.createElement('div');
    this.prompts.className = 'prompts';
    this.clickHint = document.createElement('div');
    this.clickHint.className = 'click-hint';
    this.clickHint.textContent = 'Click to look around';
    this.root.append(this.prompts, this.clickHint);
    host.appendChild(this.root);
  }

  set visible(v: boolean) {
    this.root.classList.toggle('active', v);
  }

  update(pad: GamepadInput, mouseLocked: boolean): void {
    const d = pad.device, s = pad.style;
    const p = (keys: readonly string[], padB: readonly string[]) => promptLabel(d, s, keys, padB);
    const move = d === 'gamepad' ? 'Left stick' : `${p(KEYS.forward, [])}${p(KEYS.left, [])}${p(KEYS.back, [])}${p(KEYS.right, [])}`;
    const items: [string, string][] = [
      [move, 'Move'],
      [p(KEYS.sprint, PAD.sprint), 'Sprint'],
      [p(KEYS.jump, PAD.jump), 'Jump'],
      [p(KEYS.pause, PAD.pause), 'Pause'],
    ];
    const html = items.map(([k, v]) => `<span class="prompt"><kbd>${k}</kbd>${v}</span>`).join('');
    if (html !== this.last) {
      this.last = html;
      this.prompts.innerHTML = html;
    }
    this.clickHint.classList.toggle('active', d === 'kbm' && !mouseLocked);
  }
}
