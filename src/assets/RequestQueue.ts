/**
 * The shooter's NOW/LATER request queue (plan §3.3): at most `parallel` jobs run at once; NOW jobs
 * jump every waiting LATER job. One queue is shared by model loads and cell fetches, so streaming
 * and prop templates compete for the same few connections instead of flooding the network.
 */
export type Priority = 'now' | 'later';

export interface Ticket<T> {
  readonly promise: Promise<T>;
  /** Drop a waiting job (its promise rejects with a `cancelled` error) or abort a running one. */
  cancel(): void;
  /** Move a waiting LATER job to the NOW lane. */
  promote(): void;
}

interface Waiting {
  start(): void;
  priority: Priority;
  cancelled: boolean;
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export class RequestQueue {
  private readonly now: Waiting[] = [];
  private readonly later: Waiting[] = [];
  private running = 0;

  constructor(readonly parallel: number) {}

  /** Jobs waiting for a slot. */
  get queued(): number {
    return this.now.length + this.later.length;
  }

  /** Jobs running now. */
  get active(): number {
    return this.running;
  }

  run<T>(job: (signal: AbortSignal) => Promise<T>, priority: Priority = 'now'): Ticket<T> {
    const ctl = new AbortController();
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    let started = false;
    const w: Waiting = {
      priority,
      cancelled: false,
      start: () => {
        started = true;
        this.running++;
        let p: Promise<T>;
        try {
          p = job(ctl.signal);
        } catch (err) {
          p = Promise.reject(err);
        }
        p.then(resolve, reject).finally(() => {
          this.running--;
          this.pump();
        });
      },
    };
    (priority === 'now' ? this.now : this.later).push(w);
    this.pump();
    return {
      promise,
      cancel: () => {
        if (w.cancelled) return;
        w.cancelled = true;
        if (started) ctl.abort();
        else {
          this.remove(w);
          reject(new CancelledError());
        }
      },
      promote: () => {
        if (started || w.cancelled || w.priority === 'now') return;
        this.remove(w);
        w.priority = 'now';
        this.now.push(w);
      },
    };
  }

  private remove(w: Waiting): void {
    const lane = w.priority === 'now' ? this.now : this.later;
    const i = lane.indexOf(w);
    if (i >= 0) lane.splice(i, 1);
  }

  private pump(): void {
    while (this.running < this.parallel) {
      const next = this.now.shift() ?? this.later.shift();
      if (!next) return;
      next.start();
    }
  }
}
