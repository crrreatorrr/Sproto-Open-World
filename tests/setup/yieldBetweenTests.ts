import { beforeEach } from 'vitest';

/**
 * Long sim tests run without ever leaving the microtask queue, so a whole file can hold a worker's
 * event loop for minutes and the runner's own messages to it time out after 60 s, failing a run
 * whose tests all passed. A turn of the event loop before each test lets those messages through.
 */
beforeEach(() => new Promise<void>((resolve) => setImmediate(resolve)));
