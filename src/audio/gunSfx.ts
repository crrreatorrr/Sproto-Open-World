/**
 * The gun classes' shots, synthesized like Sproto Shooter's (src/audio/sfx.js there): no files to load.
 * They play through Howler's AudioContext and master gain, so the volume settings apply.
 */
import { Howler } from 'howler';
import type { GunDef } from '../content/classes';

type Shape = OscillatorType;

let noiseBuf: AudioBuffer | null = null;
const recent = new Map<string, number[]>();

/** At most `max` of one sound inside `win` ms: a held MG doesn't stack into a roar. */
function throttle(name: string, max: number, win = 50): boolean {
  const now = performance.now();
  const arr = (recent.get(name) ?? []).filter((t) => now - t < win);
  if (arr.length >= max) return false;
  arr.push(now);
  recent.set(name, arr);
  return true;
}

const jitter = (x: number, amt = 0.08) => x * (1 + (Math.random() * 2 - 1) * amt);

function out(ctx: AudioContext): AudioNode {
  return (Howler as unknown as { masterGain?: GainNode }).masterGain ?? ctx.destination;
}

function tone(ctx: AudioContext, gain: number, o: { freq: number; end?: number; dur: number; type?: Shape; vol: number; delay?: number }): void {
  const t = ctx.currentTime + (o.delay ?? 0);
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = o.type ?? 'square';
  osc.frequency.setValueAtTime(o.freq, t);
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.end ?? o.freq), t + o.dur);
  g.gain.setValueAtTime(o.vol * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
  osc.connect(g);
  g.connect(out(ctx));
  osc.start(t);
  osc.stop(t + o.dur + 0.02);
}

function noise(
  ctx: AudioContext,
  gain: number,
  o: { dur: number; vol: number; freq: number; end?: number; q?: number; type?: BiquadFilterType; delay?: number },
): void {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const t = ctx.currentTime + (o.delay ?? 0);
  const s = ctx.createBufferSource();
  s.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = o.type ?? 'lowpass';
  f.frequency.setValueAtTime(o.freq, t);
  if (o.q !== undefined) f.Q.value = o.q;
  if (o.end) f.frequency.exponentialRampToValueAtTime(o.end, t + o.dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(o.vol * gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + o.dur);
  s.connect(f);
  f.connect(g);
  g.connect(out(ctx));
  s.start(t, Math.random() * 0.5);
  s.stop(t + o.dur + 0.02);
}

export type GunshotType = GunDef['type'] | 'handgun' | 'machinepistol';

function withAudio(gain: number, key: string, max: number, win: number, fn: (ctx: AudioContext, v: number) => void): void {
  try {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx || gain <= 0 || !throttle(key, max, win)) return;
    if (ctx.state === 'suspended') void ctx.resume();
    fn(ctx, gain * 0.5);
  } catch {
    // Audio is optional.
  }
}

/** One shot of `type`, at `gain` (0–1, the effects volume). Never throws: audio is optional. */
export function playGunshot(type: GunshotType, gain: number): void {
  withAudio(gain, 'shot', 3, 50, (ctx, v) => {
    switch (type) {
      case 'mg':
        noise(ctx, v, { dur: 0.06, vol: 0.25, freq: jitter(2600) });
        tone(ctx, v, { freq: jitter(220), end: 90, dur: 0.06, vol: 0.12 });
        break;
      case 'shotgun':
        noise(ctx, v, { dur: 0.25, vol: 0.5, freq: jitter(1400), end: 200 });
        tone(ctx, v, { freq: 110, end: 40, dur: 0.2, type: 'sine', vol: 0.4 });
        break;
      case 'sniper':
        noise(ctx, v, { dur: 0.35, vol: 0.45, freq: jitter(3200), end: 300 });
        tone(ctx, v, { freq: 900, end: 60, dur: 0.3, type: 'sawtooth', vol: 0.2 });
        break;
      case 'handgun':
        noise(ctx, v, { dur: 0.08, vol: 0.3, freq: jitter(2200), end: 700 });
        tone(ctx, v, { freq: jitter(320), end: 110, dur: 0.07, vol: 0.15 });
        break;
      case 'machinepistol':
        noise(ctx, v, { dur: 0.04, vol: 0.2, freq: jitter(3000) });
        tone(ctx, v, { freq: jitter(280), end: 120, dur: 0.04, vol: 0.1 });
        break;
      case 'bazooka':
        noise(ctx, v, { dur: 0.3, vol: 0.4, freq: 600, end: 150 });
        tone(ctx, v, { freq: 160, end: 60, dur: 0.3, type: 'triangle', vol: 0.3 });
        break;
      case 'raygun':
        tone(ctx, v, { freq: jitter(1800), end: 420, dur: 0.12, type: 'sawtooth', vol: 0.16 });
        tone(ctx, v, { freq: jitter(3600), end: 900, dur: 0.08, type: 'sine', vol: 0.1 });
        break;
      case 'bigbullets':
        noise(ctx, v, { dur: 0.45, vol: 0.55, freq: 700, end: 90 });
        tone(ctx, v, { freq: 90, end: 30, dur: 0.45, type: 'sine', vol: 0.55 });
        break;
      case 'duckgun':
        tone(ctx, v, { freq: jitter(240), end: 120, dur: 0.16, type: 'triangle', vol: 0.4 });
        tone(ctx, v, { freq: jitter(820), end: 560, dur: 0.12, type: 'square', vol: 0.14, delay: 0.03 });
        noise(ctx, v, { dur: 0.12, vol: 0.2, freq: 1200, end: 300 });
        break;
    }
  });
}

/** Mechanical magazine click on reload start (or latch on `'end'`). */
export function playReloadSfx(gain: number, phase: 'start' | 'end' = 'start'): void {
  withAudio(gain, 'reload', 2, 100, (ctx, v) => {
    if (phase === 'end') {
      tone(ctx, v, { freq: 900, end: 1200, dur: 0.06, vol: 0.15 });
    } else {
      tone(ctx, v, { freq: 700, end: 500, dur: 0.05, vol: 0.12 });
      tone(ctx, v, { freq: 500, end: 700, dur: 0.05, vol: 0.12, delay: 0.15 });
    }
  });
}

/** Empty-magazine dry-fire click. */
export function playDryFireSfx(gain: number): void {
  withAudio(gain, 'empty', 1, 300, (ctx, v) => {
    tone(ctx, v, { freq: 1800, end: 1700, dur: 0.03, vol: 0.12 });
  });
}

/** Headshot / weak-spot critical hit chime. */
export function playCritSfx(gain: number): void {
  withAudio(gain, 'crit', 2, 60, (ctx, v) => {
    tone(ctx, v, { freq: jitter(1100), end: 500, dur: 0.12, type: 'triangle', vol: 0.35 });
    tone(ctx, v, { freq: 1650, end: 900, dur: 0.08, type: 'sine', vol: 0.2, delay: 0.02 });
  });
}

/** Subtle body-hit confirmation tick. */
export function playHitmarkerSfx(gain: number): void {
  withAudio(gain, 'hit', 3, 50, (ctx, v) => {
    tone(ctx, v, { freq: jitter(500), end: 300, dur: 0.04, type: 'square', vol: 0.08 });
  });
}

/** Grapple hook launch zip. */
export function playGrappleSfx(gain: number): void {
  withAudio(gain, 'grapple', 2, 100, (ctx, v) => {
    noise(ctx, v, { dur: 0.18, vol: 0.2, freq: 2500, type: 'bandpass', q: 3 });
    tone(ctx, v, { freq: 300, end: 900, dur: 0.18, type: 'sawtooth', vol: 0.12 });
  });
}

/** Explosive blast (bazooka, bigbullets, barrels). */
export function playExplosionSfx(gain: number, radius = 3.5): void {
  withAudio(gain, 'boom', 3, 80, (ctx, v) => {
    const big = radius > 3;
    noise(ctx, v, { dur: big ? 0.7 : 0.4, vol: big ? 0.7 : 0.4, freq: 1500, end: 80 });
    tone(ctx, v, { freq: 90, end: 30, dur: 0.5, type: 'sine', vol: 0.5 });
  });
}
