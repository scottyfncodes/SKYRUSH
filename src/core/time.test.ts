import { describe, expect, it } from 'vitest';
import { FixedStepClock } from './time';

// Dyadic step sizes keep the accumulator arithmetic exact so step counts are unambiguous.
const STEP = 0.125;

describe('FixedStepClock', () => {
  it('produces the expected number of steps for a frame delta', () => {
    const clock = new FixedStepClock(STEP, 8);
    expect(clock.advance(0.5)).toBe(4);
    expect(clock.alpha).toBe(0);
  });

  it('carries a partial step over to the next frame', () => {
    const clock = new FixedStepClock(STEP, 8);
    expect(clock.advance(0.0625)).toBe(0);
    expect(clock.alpha).toBeCloseTo(0.5, 12);
    expect(clock.advance(0.0625)).toBe(1);
    expect(clock.alpha).toBe(0);
  });

  it('caps at maxSteps for a huge delta and drops the backlog', () => {
    const clock = new FixedStepClock(STEP, 8);
    expect(clock.advance(100)).toBe(8);
    expect(clock.alpha).toBe(0);
    // The backlog must not leak into the next frame.
    expect(clock.advance(0)).toBe(0);
  });

  it('ignores negative deltas', () => {
    const clock = new FixedStepClock(STEP, 8);
    clock.advance(0.0625);
    const alphaBefore = clock.alpha;
    expect(clock.advance(-5)).toBe(0);
    expect(clock.alpha).toBe(alphaBefore);
  });

  it('keeps alpha in [0, 1)', () => {
    const clock = new FixedStepClock(STEP, 8);
    const deltas = [0.3, 0.01, 0.2, 0.9, 2, 0.125, 0.0001, -1, 50];
    for (const delta of deltas) {
      clock.advance(delta);
      expect(clock.alpha).toBeGreaterThanOrEqual(0);
      expect(clock.alpha).toBeLessThan(1);
    }
  });

  it('uses a 120 Hz step and 8 max steps by default', () => {
    const clock = new FixedStepClock();
    expect(clock.step).toBeCloseTo(1 / 120, 12);
    expect(clock.maxSteps).toBe(8);
    let steps = 0;
    for (let i = 0; i < 240; i += 1) steps += clock.advance(1 / 120);
    expect(steps).toBe(240);
    expect(clock.advance(1)).toBe(8);
  });

  it('reset clears the accumulator', () => {
    const clock = new FixedStepClock(STEP, 8);
    clock.advance(0.0625);
    clock.reset();
    expect(clock.alpha).toBe(0);
    expect(clock.advance(0.0625)).toBe(0);
  });
});
