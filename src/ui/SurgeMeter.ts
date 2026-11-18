import './powers.css';

/** Sprout Surge's meter, above the spell bar. Shown once the power is learned; glows when full. */
export class SurgeMeter {
  private readonly root: HTMLElement;
  private readonly label: HTMLElement;
  private readonly fill: HTMLElement;
  private known = false;
  private value = -1;

  constructor(host: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'surge-meter';
    this.label = document.createElement('div');
    this.label.className = 'label';
    this.label.textContent = 'Surge';
    const track = document.createElement('div');
    track.className = 'track';
    this.fill = document.createElement('div');
    this.fill.className = 'fill';
    track.append(this.fill);
    this.root.append(this.label, track);
    host.append(this.root);
  }

  /** `frac` is the meter from 0 to 1. Writes to the DOM only when something changed. */
  update(known: boolean, frac: number): void {
    if (known !== this.known) {
      this.known = known;
      this.root.classList.toggle('active', known);
    }
    if (!known) return;
    const f = Math.min(1, Math.max(0, frac));
    if (Math.abs(f - this.value) < 1e-3) return;
    this.value = f;
    this.fill.style.transform = `scaleX(${f.toFixed(3)})`;
    const full = f >= 1;
    this.root.classList.toggle('full', full);
    this.label.textContent = full ? 'Surge ready' : 'Surge';
  }
}
