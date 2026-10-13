// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import { KeyboardInput } from './KeyboardInput';
import { STICK_EXPO, TouchInput } from './TouchInput';

const OPTIONS = { invertPitch: false, sensitivity: 1 };
const DT = 1 / 120;

describe('KeyboardInput', () => {
  const keyboard = new KeyboardInput();
  const out: FlightInput = { ...NEUTRAL_INPUT };
  const press = (code: string) => window.dispatchEvent(new KeyboardEvent('keydown', { code }));
  const lift = (code: string) => window.dispatchEvent(new KeyboardEvent('keyup', { code }));
  /** Samples until roll reaches `target`, returning the time taken. */
  const timeToRoll = (target: number): number => {
    let t = 0;
    while (Math.abs(keyboard.sample(DT, out, OPTIONS).roll - target) > 1e-9 && t < 2) t += DT;
    return t;
  };

  afterEach(() => {
    keyboard.detach();
  });

  it('ramps a held key to full deflection so taps stay gentle', () => {
    keyboard.attach();
    keyboard.setEnabled(true);
    press('KeyD');
    expect(keyboard.sample(DT, out, OPTIONS).roll).toBeLessThan(0.1);
    expect(timeToRoll(1)).toBeGreaterThan(0.1);
  });

  it('reverses through centre at the release rate', () => {
    keyboard.attach();
    keyboard.setEnabled(true);
    press('KeyD');
    timeToRoll(1);
    lift('KeyD');
    press('KeyA');
    // Back through centre at 10/s, then out to full at 6/s: ≈0.27 s rather than 0.33 s.
    expect(timeToRoll(-1)).toBeLessThan(0.3);
  });
});

describe('TouchInput', () => {
  const out: FlightInput = { ...NEUTRAL_INPUT };
  const withStick = (x: number, y: number): FlightInput => {
    const touch = new TouchInput(document.body);
    Object.assign(touch as unknown as { stickX: number; stickY: number }, { stickX: x, stickY: y });
    touch.sample(out, OPTIONS);
    touch.dispose();
    return out;
  };

  it('full deflection still commands full roll and pitch', () => {
    expect(withStick(1, 0).roll).toBeCloseTo(1, 9);
    expect(withStick(-1, 0).roll).toBeCloseTo(-1, 9);
    expect(withStick(0, -1).pitch).toBeCloseTo(1, 9);
  });

  it('small thumb movements give proportionally finer commands', () => {
    const small = withStick(0.25, 0).roll;
    expect(small).toBeGreaterThan(0);
    expect(small).toBeLessThan(0.2);
    expect(STICK_EXPO).toBeGreaterThan(0);
    expect(STICK_EXPO).toBeLessThan(0.5);
  });

  it('a centred stick commands nothing', () => {
    const centred = withStick(0.05, -0.05);
    expect(Math.abs(centred.roll)).toBe(0);
    expect(Math.abs(centred.pitch)).toBe(0);
  });
});
