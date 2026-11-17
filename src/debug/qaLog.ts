/**
 * The QA event log for the M1a gate (plan M1a (b)): rendered-frame-stamped entries for a light or
 * heavy press latched, the tick that took it, the attack starting, the first frame its pose shows,
 * and every hit with its spark, sound, number and hit-stop. Read through `__qa.log()` (debug/qa.ts).
 * Recording is on only in dev and QA builds.
 */
export interface QaEntry {
  /** Rendered frame (App.frame calls). */
  frame: number;
  kind: 'press' | 'command' | 'attackStart' | 'pose' | 'hit' | 'hitstop' | 'spark' | 'sound' | 'number';
  /** Sim tick, where one applies. */
  tick?: number;
  /** Hit number (pairs reactions with their hit), or the button / move. */
  hit?: number;
  what?: string;
}

export const QA_LOG_ENABLED = import.meta.env.DEV || import.meta.env.VITE_QA === '1';

const MAX = 4000;

export class QaLog {
  frame = 0;
  readonly entries: QaEntry[] = [];

  add(e: Omit<QaEntry, 'frame'>): void {
    if (!QA_LOG_ENABLED) return;
    if (this.entries.length >= MAX) this.entries.splice(0, MAX / 2);
    this.entries.push({ frame: this.frame, ...e });
  }

  clear(): void {
    this.entries.length = 0;
  }
}

export const qaLog = new QaLog();
