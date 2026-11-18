import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Panels } from '../../src/ui/panels';

/** Just enough DOM for the error panel. */
function fakeEl(): Record<string, unknown> {
  const classes = new Set<string>();
  return {
    className: '', textContent: '', dataset: {},
    classList: {
      add: (c: string) => classes.add(c),
      remove: (c: string) => classes.delete(c),
      contains: (c: string) => classes.has(c),
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
    },
    append() {}, replaceChildren() {}, addEventListener() {}, focus() {},
  };
}

describe('the error panel on the keyboard', () => {
  let press: (code: string, repeat?: boolean) => void;
  beforeEach(() => {
    vi.stubGlobal('document', { createElement: fakeEl });
    vi.stubGlobal('window', {
      addEventListener: (_: string, f: (e: unknown) => void) => {
        press = (code, repeat = false) => f({ code, repeat, preventDefault() {} });
      },
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('a held key moves the focus once', () => {
    const p = new Panels(fakeEl() as unknown as HTMLElement);
    p.showChoice('Slow ground', [{ label: 'Retry', run() {} }, { label: 'Return', run() {} }]);
    press('KeyW', true);
    press('KeyW', true);
    press('KeyW', true);
    expect(p.focusedAction).toBe('Retry');
    press('KeyS');
    expect(p.focusedAction).toBe('Return');
  });

  it('a held Enter confirms nothing', () => {
    const run = vi.fn();
    const p = new Panels(fakeEl() as unknown as HTMLElement);
    p.showChoice('Slow ground', [{ label: 'Retry', run }]);
    press('Enter', true);
    expect(run).not.toHaveBeenCalled();
    press('Enter');
    expect(run).toHaveBeenCalledOnce();
  });
});
