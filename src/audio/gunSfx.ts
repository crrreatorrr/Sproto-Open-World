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

function noise(ctx: AudioContext, gain: number, o: { dur: number; vol: number; freq: number; end?: number; type?: BiquadFilterType; delay?: number }): void {
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

/** One shot of `type`, at `gain` (0–1, the effects volume). Never throws: audio is optional. */
export function playGunshot(type: GunDef['type'], gain: number): void {
  try {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx || gain <= 0 || !throttle('shot', 3)) return;
    if (ctx.state === 'suspended') void ctx.resume();
    const v = gain * 0.5;
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
  } catch {
    // Audio is optional.
  }
}
