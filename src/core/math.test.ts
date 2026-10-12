import { describe, expect, it } from 'vitest';
import {
  applyDeadzone,
  clamp,
  clamp01,
  damp,
  lerp,
  moveToward,
  roundTo,
  smoothstep,
  wrapAngle,
} from './math';

describe('math helpers', () => {
  it('clamps', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(clamp(0.5, 0, 1)).toBe(0.5);
    expect(clamp01(2)).toBe(1);
    expect(clamp01(-2)).toBe(0);
  });

  it('lerps and damps toward the target', () => {
    expect(lerp(0, 10, 0.25)).toBe(2.5);
    const once = damp(0, 10, 5, 0.1);
    expect(once).toBeGreaterThan(0);
    expect(once).toBeLessThan(10);
    expect(damp(0, 10, 5, 100)).toBeCloseTo(10, 6);
  });

  it('smoothstep is clamped and monotonic', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 0.25)).toBeLessThan(smoothstep(0, 1, 0.75));
  });

  it('moveToward never overshoots', () => {
    expect(moveToward(0, 10, 3)).toBe(3);
    expect(moveToward(9, 10, 3)).toBe(10);
    expect(moveToward(10, 0, 3)).toBe(7);
  });

  it('wrapAngle keeps angles in [-pi, pi]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 12);
    expect(wrapAngle(-Math.PI * 1.5)).toBeCloseTo(Math.PI / 2, 12);
    expect(wrapAngle(0.5)).toBe(0.5);
  });

  it('applyDeadzone re-normalises the usable range', () => {
    expect(applyDeadzone(0.1, 0.2)).toBe(0);
    expect(applyDeadzone(1, 0.2)).toBeCloseTo(1, 12);
    expect(applyDeadzone(-1, 0.2)).toBeCloseTo(-1, 12);
    expect(applyDeadzone(0.6, 0.2)).toBeCloseTo(0.5, 12);
  });

  it('roundTo rounds to the requested decimals', () => {
    expect(roundTo(1.23456, 2)).toBe(1.23);
    expect(roundTo(1.5, 0)).toBe(2);
  });
});
