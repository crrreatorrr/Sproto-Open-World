import { describe, expect, it } from 'vitest';
import { GEOMETRIES_PER_FRAME, GEOMETRY_BYTES_PER_FRAME, TEXTURES_PER_FRAME, TEXTURE_BYTES_PER_FRAME, UploadBudget } from '../../src/world/UploadBudget';

describe('the upload budget spreads GPU uploads over frames', () => {
  it('runs small jobs up to the count cap, in order', () => {
    const b = new UploadBudget();
    const ran: number[] = [];
    for (let i = 0; i < 10; i++) b.geometry(() => ran.push(i), 100);
    b.run();
    expect(ran).toEqual([...Array(GEOMETRIES_PER_FRAME).keys()]);
    b.run();
    expect(ran.length).toBe(Math.min(10, GEOMETRIES_PER_FRAME * 2));
  });

  it('stops a frame at the byte cap, however few jobs that is', () => {
    const b = new UploadBudget();
    let ran = 0;
    const big = Math.ceil(TEXTURE_BYTES_PER_FRAME * 0.6);
    for (let i = 0; i < 4; i++) b.texture(() => ran++, big);
    b.run();
    // The second job would pass the cap: it waits for the next frame.
    expect(ran).toBe(1);
    b.run();
    expect(ran).toBe(2);
  });

  it('always runs one job, even one larger than a whole frame of budget', () => {
    const b = new UploadBudget();
    let ran = 0;
    b.geometry(() => ran++, GEOMETRY_BYTES_PER_FRAME * 10);
    b.geometry(() => ran++, 10);
    b.run();
    expect(ran).toBe(1);
    b.run();
    expect(ran).toBe(2);
    expect(b.pending).toBe(0);
  });

  it('counts jobs with no size as small ones', () => {
    const b = new UploadBudget();
    let ran = 0;
    for (let i = 0; i < 5; i++) b.texture(() => ran++);
    b.run();
    expect(ran).toBe(TEXTURES_PER_FRAME);
  });

  it('a job that throws does not stop the queue', () => {
    const b = new UploadBudget();
    let ran = 0;
    b.geometry(() => { throw new Error('boom'); });
    b.geometry(() => ran++);
    expect(() => b.run()).not.toThrow();
    expect(ran).toBe(1);
  });
});
