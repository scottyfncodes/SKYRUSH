import { describe, expect, it } from 'vitest';
import { createRng, hash2 } from './rng';

describe('createRng', () => {
  it('is deterministic for a seed and produces values in [0, 1)', () => {
    const a = createRng(1234);
    const b = createRng(1234);
    for (let i = 0; i < 100; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('differs between seeds', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });
});

describe('hash2', () => {
  it('is deterministic and in [0, 1)', () => {
    expect(hash2(3, 7)).toBe(hash2(3, 7));
    for (const [x, y] of [
      [0, 0],
      [1, 2],
      [-5, 9],
      [123, -456],
    ] as const) {
      const value = hash2(x, y);
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
    expect(hash2(1, 2)).not.toBe(hash2(2, 1));
  });
});
