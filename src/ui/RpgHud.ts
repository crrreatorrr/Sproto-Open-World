import { CARDINALS, compassOffset, levelProgress, type QuestLine } from './rpgText';

/** The compass bar shows this far either side of straight ahead (radians). */
const COMPASS_SPAN = (100 * Math.PI) / 180;
/** Feed lines (item gained, quest updated…) stay this long (s), at most this many at once. */
const FEED_SEC = 4.5;
const FEED_MAX = 5;
/** The "Saved" mark stays up this long (s). */
const SAVED_SEC = 2.2;

export interface HudRpgState {
  level: number;
  xp: number;
  /** Attribute points waiting at a shrine. */
  points: number;
  sprouts: number;
  tonics: { charges: number; max: number };
  tracker: QuestLine | null;
  /** Camera yaw for the compass, and the tracked step's marker (heading offset in radians, metres away). */
  compass: { camYaw: number; marker: { offset: number; dist: number } | null };
  /** The interact prompt: the device's glyph and the verb ("Talk to Elder Pepe"), or null. */
  prompt: { key: string; text: string } | null;
  /** In the saddle: the gallop button on the active device, and what it does next. */
  ride: { key: string; text: string } | null;
}

const div = (cls: string, html = ''): HTMLDivElement => {
  const d = document.createElement('div');
  d.className = cls;
  if (html) d.innerHTML = html;
  return d;
};

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/**
 * The RPG half of the HUD (plan §5): level and XP, Sprouts and tonic charges, the quest tracker,
 * the compass bar with the tracked step's marker, the interact prompt, a feed of small
 * notifications, and the autosave mark. It lives inside the Hud's root, so it shows and hides
 * with it. Writes to the DOM only when a value changes; no layout reads.
 */
export class RpgHud {
  private readonly root: HTMLElement;
  private readonly levelEl: HTMLElement;
  private readonly xpFill: HTMLElement;
  private readonly counters: HTMLElement;
  private readonly tracker: HTMLElement;
  private readonly compass: HTMLElement;
  private readonly marks: { el: HTMLElement; heading: number; x: number; shown: boolean }[];
  private readonly marker: HTMLElement;
  private readonly prompt: HTMLElement;
  private readonly feedEl: HTMLElement;
  private readonly savedEl: HTMLElement;
  private readonly feedItems: { el: HTMLElement; left: number }[] = [];
  private savedLeft = 0;
  private last = { level: '', xp: -1, counters: '', tracker: '', prompt: '', marker: '' };
  private compassWidth = 440;
  private markerX = NaN;

  constructor(host: HTMLElement) {
    this.root = div('rpg-hud');
    const level = div('rpg-level');
    this.levelEl = div('lv');
    const xp = div('xp');
    this.xpFill = div('fill');
    xp.append(this.xpFill);
    level.append(this.levelEl, xp);
    this.counters = div('rpg-counters');
    this.tracker = div('tracker');
    this.compass = div('compass');
    const strip = div('strip');
    this.marks = CARDINALS.map((c) => {
      const el = div(`mark${c.label.length === 1 ? ' cardinal' : ''}`, c.label);
      strip.append(el);
      return { el, heading: c.heading, x: NaN, shown: true };
    });
    this.marker = div('quest-marker');
    strip.append(this.marker);
    this.compass.append(strip, div('centre'));
    this.prompt = div('interact-prompt');
    this.feedEl = div('feed');
    this.savedEl = div('saved', 'Saved');
    this.root.append(level, this.counters, this.tracker, this.compass, this.prompt, this.feedEl, this.savedEl);
    host.appendChild(this.root);
  }

  /** Show or hide the RPG layer (the yard and the wave sandbox have no RPG state). */
  set enabled(on: boolean) {
    this.root.classList.toggle('active', on);
  }

  /** The tracker's text as shown (QA). */
  get trackerText(): string {
    return this.tracker.textContent ?? '';
  }

  /** The interact prompt as shown, or null (QA). */
  get promptText(): string | null {
    return this.last.prompt ? (this.prompt.textContent ?? null) : null;
  }

  /** The feed's lines (QA). */
  get feedText(): string[] {
    return this.feedItems.map((f) => f.el.textContent ?? '');
  }

  /** The compass marker is on the bar (QA). */
  get markerShown(): boolean {
    return this.last.marker !== '';
  }

  update(s: HudRpgState, dt: number): void {
    const lp = levelProgress(s.level, s.xp);
    const level = `Lv ${s.level}${s.points > 0 ? '<b title="Skill points to spend on the Skills tab">+</b>' : ''}`;
    if (level !== this.last.level) {
      this.last.level = level;
      this.levelEl.innerHTML = level;
    }
    const xp = Math.round(lp.frac * 1000) / 1000;
    if (xp !== this.last.xp) {
      this.last.xp = xp;
      this.xpFill.style.transform = `scaleX(${xp})`;
    }
    const counters = `<span class="sprouts"><i></i>${s.sprouts}</span><span class="tonics${s.tonics.charges === 0 ? ' empty' : ''}"><i></i>${s.tonics.charges}/${s.tonics.max}</span>`;
    if (counters !== this.last.counters) {
      const gained = this.last.counters !== '' && this.counters.querySelector('.sprouts')?.textContent !== String(s.sprouts);
      this.last.counters = counters;
      this.counters.innerHTML = counters;
      if (gained) this.counters.querySelector('.sprouts')?.classList.add('pulse');
    }
    this.trackerState(s.tracker);
    this.compassState(s.compass);
    const ride = s.ride ? `<span class="ride-hint"><kbd>${esc(s.ride.key)}</kbd>${esc(s.ride.text)}</span>` : '';
    const prompt = (s.prompt ? `<kbd>${esc(s.prompt.key)}</kbd>${esc(s.prompt.text)}` : '') + ride;
    if (prompt !== this.last.prompt) {
      this.last.prompt = prompt;
      this.prompt.innerHTML = prompt;
      this.prompt.classList.toggle('active', !!prompt);
    }
    this.tick(dt);
  }

  /** Fade the feed and the saved mark (also while the RPG state is missing, e.g. dead). */
  tick(dt: number): void {
    for (let i = this.feedItems.length - 1; i >= 0; i--) {
      const f = this.feedItems[i];
      f.left -= dt;
      if (f.left <= 0) {
        f.el.remove();
        this.feedItems.splice(i, 1);
      }
    }
    if (this.savedLeft > 0) {
      this.savedLeft -= dt;
      if (this.savedLeft <= 0) this.savedEl.classList.remove('active');
    }
  }

  /** A small line in the feed ("Got Sprout Seed", "Quest updated"); `kind` colours it. */
  feed(text: string, kind: 'item' | 'quest' | 'level' | 'info' = 'info'): void {
    const el = div(`line ${kind}`);
    el.textContent = text;
    this.feedEl.append(el);
    this.feedItems.push({ el, left: FEED_SEC });
    while (this.feedItems.length > FEED_MAX) this.feedItems.shift()!.el.remove();
  }

  /** The autosave went through. */
  saved(): void {
    this.savedLeft = SAVED_SEC;
    this.savedEl.classList.remove('active');
    void this.savedEl.offsetWidth;
    this.savedEl.classList.add('active');
  }

  /** The bar's width in px (App passes it on resize, so the frame loop never reads layout). */
  setCompassWidth(px: number): void {
    this.compassWidth = px;
    for (const m of this.marks) m.x = NaN;
    this.markerX = NaN;
  }

  clearFeed(): void {
    for (const f of this.feedItems) f.el.remove();
    this.feedItems.length = 0;
  }

  private trackerState(q: QuestLine | null): void {
    const html = q
      ? `<div class="title">${esc(q.title)}</div><div class="step">${esc(q.step)}</div>${q.lines.map((l) => `<div class="obj${l.done ? ' done' : ''}">${esc(l.text)}</div>`).join('')}`
      : '';
    if (html === this.last.tracker) return;
    this.last.tracker = html;
    this.tracker.innerHTML = html;
    this.tracker.classList.toggle('active', !!q);
    if (q) {
      this.tracker.classList.remove('bump');
      void this.tracker.offsetWidth;
      this.tracker.classList.add('bump');
    }
  }

  private compassState(c: HudRpgState['compass']): void {
    const half = this.compassWidth / 2;
    const place = (offset: number) => half + (offset / COMPASS_SPAN) * half;
    for (const m of this.marks) {
      const off = compassOffset(c.camYaw, m.heading);
      const shown = Math.abs(off) < COMPASS_SPAN;
      if (shown !== m.shown) {
        m.shown = shown;
        m.el.style.visibility = shown ? '' : 'hidden';
      }
      if (!shown) continue;
      const x = Math.round(place(off) * 2) / 2;
      if (x !== m.x) {
        m.x = x;
        m.el.style.transform = `translateX(${x}px) translateX(-50%)`;
      }
    }
    const mk = c.marker;
    // Off the bar: the marker waits at the nearer edge, pointing the way to turn.
    const side = mk ? (mk.offset > COMPASS_SPAN ? 'right' : mk.offset < -COMPASS_SPAN ? 'left' : 'on') : '';
    const label = mk ? `${side}|${Math.round(mk.dist)}` : '';
    if (label !== this.last.marker) {
      this.last.marker = label;
      this.marker.className = `quest-marker${mk ? ` active ${side}` : ''}`;
      this.marker.innerHTML = mk ? `<span>${Math.round(mk.dist)} m</span>` : '';
    }
    if (mk) {
      const off = Math.max(-COMPASS_SPAN, Math.min(COMPASS_SPAN, mk.offset));
      const x = Math.round(place(off) * 2) / 2;
      if (x !== this.markerX) {
        this.markerX = x;
        this.marker.style.transform = `translateX(${x}px) translateX(-50%)`;
      }
    }
  }
}
