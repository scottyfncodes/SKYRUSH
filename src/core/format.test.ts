import { describe, expect, it } from 'vitest';
import { formatCredits, formatRaceTime, formatSpeedKmh, ordinal } from './format';

describe('formatRaceTime', () => {
  it('formats as mm:ss.mmm with zero padding', () => {
    expect(formatRaceTime(0)).toBe('00:00.000');
    expect(formatRaceTime(5.25)).toBe('00:05.250');
    expect(formatRaceTime(65.5)).toBe('01:05.500');
    expect(formatRaceTime(125.123)).toBe('02:05.123');
    expect(formatRaceTime(600)).toBe('10:00.000');
  });

  it('returns a placeholder for negative or non-finite values', () => {
    expect(formatRaceTime(-1)).toBe('--:--.---');
    expect(formatRaceTime(Number.NaN)).toBe('--:--.---');
    expect(formatRaceTime(Number.POSITIVE_INFINITY)).toBe('--:--.---');
  });
});

describe('ordinal', () => {
  it('handles 1..4', () => {
    expect(ordinal(1)).toBe('1st');
    expect(ordinal(2)).toBe('2nd');
    expect(ordinal(3)).toBe('3rd');
    expect(ordinal(4)).toBe('4th');
  });

  it('uses "th" for the teens', () => {
    expect(ordinal(11)).toBe('11th');
    expect(ordinal(12)).toBe('12th');
    expect(ordinal(13)).toBe('13th');
  });

  it('returns 21st for 21', () => {
    expect(ordinal(21)).toBe('21st');
    expect(ordinal(22)).toBe('22nd');
    expect(ordinal(111)).toBe('111th');
  });
});

describe('other formatters', () => {
  it('converts m/s to whole km/h', () => {
    expect(formatSpeedKmh(100)).toBe('360');
    expect(formatSpeedKmh(27.7)).toBe('100');
  });

  it('formats credits with thousands separators', () => {
    expect(formatCredits(2500)).toBe('2,500');
    expect(formatCredits(1234567.4)).toBe('1,234,567');
  });
});
