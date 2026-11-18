import { Howler } from 'howler';
import type { Surface, ZoneId } from './zones';

/** The small sounds that come and go over a zone's bed. */
type Life = 'birds' | 'crickets' | 'hawk' | 'creak' | 'owl' | 'pebbles';

interface Bed {
  /** Wind: loudness and how bright it is (low-pass, Hz). */
  wind: number;
  cut: number;
  /** Running water. */
  water: number;
  /** A low hum under everything: loudness and pitch (Hz). */
  drone: number;
  hz: number;
  life: readonly Life[];
  /** Seconds between two of them. */
  every: readonly [number, number];
}

const BEDS: Record<ZoneId, Bed> = {
  village: { wind: 0.07, cut: 520, water: 0, drone: 0, hz: 55, life: ['birds'], every: [3, 8] },
  orchard: { wind: 0.09, cut: 640, water: 0, drone: 0, hz: 55, life: ['birds', 'crickets'], every: [2.5, 6] },
  meadow: { wind: 0.09, cut: 700, water: 0, drone: 0, hz: 55, life: ['crickets', 'birds'], every: [3, 7] },
  hill: { wind: 0.17, cut: 980, water: 0, drone: 0, hz: 55, life: ['hawk'], every: [9, 18] },
  millrun: { wind: 0.06, cut: 480, water: 0.085, drone: 0, hz: 55, life: ['creak', 'birds'], every: [6, 13] },
  thornwood: { wind: 0.1, cut: 340, water: 0, drone: 0.05, hz: 55, life: ['owl', 'creak'], every: [8, 16] },
  quarry: { wind: 0.13, cut: 420, water: 0, drone: 0.08, hz: 41, life: ['pebbles'], every: [5, 12] },
};

/** How fast one bed turns into the next (time constant, s). */
const BLEND = 1.4;
const NOISE_SEC = 4;
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

interface Graph {
  ctx: AudioContext;
  noise: AudioBuffer;
  /** The bed's bus, and the effects' bus (footsteps). */
  bus: GainNode;
  fx: GainNode;
  windGain: GainNode;
  windCut: BiquadFilterNode;
  waterGain: GainNode;
  droneGain: GainNode;
  drone: OscillatorNode;
}

/**
 * The world's ambient beds and footsteps, drawn live with Web Audio, so they cost no download: wind
 * and water from one loop of noise, a low hum in the dark places, and small sounds scattered over
 * them (birds, crickets, an owl, falling pebbles). Moving between zones blends one bed into the next.
 * Everything runs under Howler's master volume. Without Web Audio it stays silent.
 */
export class Ambience {
  private g: Graph | null = null;
  private zone: ZoneId = 'village';
  /** The bed the graph is blending to. */
  private playing: ZoneId | null = null;
  private volume = 0.7;
  private effects = 1;
  private duck = 0;
  private nextLife = 2;

  constructor() {
    document.addEventListener('visibilitychange', () => this.applyBus());
  }

  /** Build the sound graph (once): needs the audio context, which exists once play has been pressed. */
  start(): void {
    if (this.g || !Howler.usingWebAudio || !Howler.ctx) return;
    try {
      // Howler would suspend the context after 30 s without a Howl playing, and the beds with it.
      Howler.autoSuspend = false;
      this.g = this.build(Howler.ctx, Howler.masterGain);
      this.setZone(this.zone);
      this.applyBus();
    } catch {
      // Audio is optional.
      this.g = null;
    }
  }

  private build(ctx: AudioContext, out: GainNode): Graph {
    const noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * NOISE_SEC), ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(out);
    const fx = ctx.createGain();
    fx.gain.value = this.effects;
    fx.connect(out);

    const source = ctx.createBufferSource();
    source.buffer = noise;
    source.loop = true;

    const windCut = ctx.createBiquadFilter();
    windCut.type = 'lowpass';
    const windGain = ctx.createGain();
    windGain.gain.value = 0;
    source.connect(windCut).connect(windGain).connect(bus);
    // Gusts: a slow swell on the wind's own loudness.
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.11;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.025;
    gust.connect(gustDepth).connect(windGain.gain);

    const waterBand = ctx.createBiquadFilter();
    waterBand.type = 'bandpass';
    waterBand.frequency.value = 1100;
    waterBand.Q.value = 0.5;
    const waterGain = ctx.createGain();
    waterGain.gain.value = 0;
    source.connect(waterBand).connect(waterGain).connect(bus);

    const drone = ctx.createOscillator();
    drone.type = 'triangle';
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0;
    drone.connect(droneGain).connect(bus);

    source.start();
    gust.start();
    drone.start();
    return { ctx, noise, bus, fx, windGain, windCut, waterGain, droneGain, drone };
  }

  /** Blend to a zone's bed. */
  setZone(zone: ZoneId): void {
    this.zone = zone;
    const g = this.g;
    if (!g || zone === this.playing) return;
    this.playing = zone;
    const b = BEDS[zone];
    const t = g.ctx.currentTime;
    g.windGain.gain.setTargetAtTime(b.wind, t, BLEND);
    g.windCut.frequency.setTargetAtTime(b.cut, t, BLEND);
    g.waterGain.gain.setTargetAtTime(b.water, t, BLEND);
    g.droneGain.gain.setTargetAtTime(b.drone, t, BLEND);
    g.drone.frequency.setTargetAtTime(b.hz, t, BLEND);
  }

  setVolumes(ambience: number, effects: number): void {
    this.volume = ambience;
    this.effects = effects;
    this.applyBus();
    const g = this.g;
    if (g) g.fx.gain.setTargetAtTime(effects, g.ctx.currentTime, 0.05);
  }

  /** How much of the bed to hear: 1 in play, less under a menu or a boss, 0 at the title. */
  setDuck(k: number): void {
    if (k === this.duck) return;
    this.duck = k;
    this.applyBus();
  }

  private applyBus(): void {
    const g = this.g;
    if (!g) return;
    const k = document.hidden ? 0 : this.volume * this.duck;
    g.bus.gain.setTargetAtTime(k, g.ctx.currentTime, document.hidden ? 0.03 : 0.5);
  }

  /** Once per frame in play: scatter the zone's small sounds. */
  frame(dt: number): void {
    const g = this.g;
    if (!g || g.ctx.state !== 'running' || this.duck <= 0) return;
    this.nextLife -= dt;
    if (this.nextLife > 0) return;
    const b = BEDS[this.zone];
    this.nextLife = rand(b.every[0], b.every[1]);
    try {
      this.playLife(g, b.life[Math.floor(Math.random() * b.life.length)]);
    } catch {
      // Audio is optional.
    }
  }

  /** One footfall of the local player. */
  footstep(surface: Surface, loud: number): void {
    const g = this.g;
    if (!g || g.ctx.state !== 'running') return;
    const t = g.ctx.currentTime;
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    const f = g.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = (surface === 'stone' ? 2600 : surface === 'dirt' ? 1300 : 800) * rand(0.85, 1.15);
    const env = g.ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime((surface === 'grass' ? 0.11 : 0.15) * loud, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0008, t + (surface === 'stone' ? 0.07 : 0.11));
    src.connect(f).connect(env).connect(g.fx);
    src.start(t, rand(0, NOISE_SEC - 0.3), 0.14);
  }

  private playLife(g: Graph, life: Life): void {
    const t = g.ctx.currentTime + 0.02;
    const pan = rand(-0.8, 0.8);
    switch (life) {
      case 'birds': {
        const base = rand(2300, 3400);
        const notes = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < notes; i++) this.tone(g, 'sine', base * rand(0.9, 1.1), base * rand(1.1, 1.35), t + i * rand(0.13, 0.19), 0.08, 0.022, pan);
        return;
      }
      case 'crickets':
        for (let i = 0; i < 7; i++) this.tone(g, 'sine', 4300, 4300, t + i * 0.055, 0.03, 0.009, pan);
        return;
      case 'hawk':
        this.tone(g, 'sine', 2300, 1450, t, 1, 0.018, pan);
        return;
      case 'owl':
        this.tone(g, 'triangle', 390, 345, t, 0.34, 0.04, pan);
        this.tone(g, 'triangle', 380, 330, t + 0.5, 0.5, 0.035, pan);
        return;
      case 'creak':
        this.tone(g, 'sawtooth', 74, 102, t, 0.55, 0.012, pan);
        return;
      case 'pebbles': {
        const n = 3 + Math.floor(Math.random() * 4);
        let at = t;
        for (let i = 0; i < n; i++) {
          this.tick(g, at, 0.05 * (1 - i / (n + 1)), pan);
          at += rand(0.07, 0.2);
        }
        return;
      }
    }
  }

  /** A short gliding note, panned. */
  private tone(g: Graph, type: OscillatorType, from: number, to: number, at: number, dur: number, gain: number, pan: number): void {
    const o = g.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + dur);
    const env = g.ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + Math.min(0.03, dur * 0.3));
    env.gain.linearRampToValueAtTime(0, at + dur);
    const p = g.ctx.createStereoPanner();
    p.pan.value = pan;
    o.connect(env).connect(p).connect(g.bus);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  /** A stone's click: a sliver of the noise through a narrow band. */
  private tick(g: Graph, at: number, gain: number, pan: number): void {
    const src = g.ctx.createBufferSource();
    src.buffer = g.noise;
    const f = g.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = rand(1500, 2600);
    f.Q.value = 3;
    const env = g.ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0005, at + 0.04);
    const p = g.ctx.createStereoPanner();
    p.pan.value = pan;
    src.connect(f).connect(env).connect(p).connect(g.bus);
    src.start(at, rand(0, NOISE_SEC - 0.2), 0.06);
  }
}
