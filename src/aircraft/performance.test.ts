import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD, withPart, type AircraftBuild } from './build';
import { ENGINES, FUSELAGES, WINGS } from './parts';
import {
  ABSOLUTE_MAX_SPEED,
  flightParametersForBuild,
  gripAtSpeed,
  performanceForBuild,
  secondsOfBoostBeforeOverheat,
  summarisePerformance,
  timeToSpeed,
  type FlightParameters,
} from './performance';

const allBuilds = (): AircraftBuild[] => {
  const builds: AircraftBuild[] = [];
  for (const fuselage of FUSELAGES) {
    for (const engine of ENGINES) {
      for (const wings of WINGS) {
        builds.push({
          fuselage: fuselage.id,
          engine: engine.id,
          wings: wings.id,
          livery: DEFAULT_BUILD.livery,
        });
      }
    }
  }
  return builds;
};

const finitePositive = (value: number): void => {
  expect(Number.isFinite(value)).toBe(true);
  expect(value).toBeGreaterThan(0);
};

describe('computeFlightParameters', () => {
  it('yields finite, positive parameters for every build combination', () => {
    const builds = allBuilds();
    expect(builds).toHaveLength(27);
    for (const build of builds) {
      const params = flightParametersForBuild(build);
      for (const [key, value] of Object.entries(params)) {
        expect(typeof value, key).toBe('number');
        finitePositive(value);
      }
      expect(params.maxSpeed).toBeLessThanOrEqual(ABSOLUTE_MAX_SPEED);
      expect(params.stallSpeed).toBeLessThan(params.maxSpeed);
    }
  });

  it('heavier engines increase mass', () => {
    const efficient = flightParametersForBuild(withPart(DEFAULT_BUILD, 'engine', 'engine-efficient'));
    const pulse = flightParametersForBuild(withPart(DEFAULT_BUILD, 'engine', 'engine-pulse'));
    const twin = flightParametersForBuild(withPart(DEFAULT_BUILD, 'engine', 'engine-twin'));
    expect(pulse.mass).toBeGreaterThan(efficient.mass);
    expect(twin.mass).toBeGreaterThan(pulse.mass);
    expect(twin.mass - efficient.mass).toBe(560 - 300);
  });

  it('the twin turbine has a higher top speed than the efficient turbine', () => {
    for (const fuselage of FUSELAGES) {
      for (const wings of WINGS) {
        const base: AircraftBuild = { ...DEFAULT_BUILD, fuselage: fuselage.id, wings: wings.id };
        const twin = flightParametersForBuild(withPart(base, 'engine', 'engine-twin'));
        const efficient = flightParametersForBuild(withPart(base, 'engine', 'engine-efficient'));
        expect(twin.maxSpeed).toBeGreaterThan(efficient.maxSpeed);
      }
    }
  });

  it('high-lift wings give a lower stall speed than compact wings', () => {
    const highlift = flightParametersForBuild(withPart(DEFAULT_BUILD, 'wings', 'wings-highlift'));
    const compact = flightParametersForBuild(withPart(DEFAULT_BUILD, 'wings', 'wings-compact'));
    expect(highlift.stallSpeed).toBeLessThan(compact.stallSpeed);
  });

  it('compact wings give a higher roll rate', () => {
    const compact = flightParametersForBuild(withPart(DEFAULT_BUILD, 'wings', 'wings-compact'));
    const balanced = flightParametersForBuild(withPart(DEFAULT_BUILD, 'wings', 'wings-balanced'));
    const highlift = flightParametersForBuild(withPart(DEFAULT_BUILD, 'wings', 'wings-highlift'));
    expect(compact.rollRate).toBeGreaterThan(balanced.rollRate);
    expect(balanced.rollRate).toBeGreaterThan(highlift.rollRate);
  });

  it('the heavy fuselage has a lower pitch rate and higher stability than the needle', () => {
    const heavy = flightParametersForBuild(withPart(DEFAULT_BUILD, 'fuselage', 'fuselage-heavy'));
    const needle = flightParametersForBuild(withPart(DEFAULT_BUILD, 'fuselage', 'fuselage-needle'));
    expect(heavy.pitchRate).toBeLessThan(needle.pitchRate);
    expect(heavy.stability).toBeGreaterThan(needle.stability);
    expect(heavy.durability).toBeGreaterThan(needle.durability);
  });

  it('stability is clamped to 0.4..2', () => {
    for (const build of allBuilds()) {
      const { stability } = flightParametersForBuild(build);
      expect(stability).toBeGreaterThanOrEqual(0.4);
      expect(stability).toBeLessThanOrEqual(2);
    }
  });

  it('gripAtSpeed falls off with speed and is clamped', () => {
    const params = flightParametersForBuild(DEFAULT_BUILD);
    expect(gripAtSpeed(params, 40)).toBeGreaterThan(gripAtSpeed(params, 80));
    expect(gripAtSpeed(params, 80)).toBeGreaterThan(gripAtSpeed(params, 160));
    expect(gripAtSpeed(params, 80)).toBeCloseTo(params.grip, 10);
    expect(gripAtSpeed(params, 1)).toBeCloseTo(params.grip * 2.2, 10);
    expect(gripAtSpeed(params, 10_000)).toBeCloseTo(params.grip * 0.35, 10);
  });
});

describe('timeToSpeed', () => {
  it('is shorter for more thrust', () => {
    const base = flightParametersForBuild(DEFAULT_BUILD);
    const stronger: FlightParameters = { ...base, thrust: base.thrust * 1.5 };
    const target = 250 / 3.6;
    expect(timeToSpeed(stronger, target)).toBeLessThan(timeToSpeed(base, target));
    const twin = flightParametersForBuild(withPart(DEFAULT_BUILD, 'engine', 'engine-twin'));
    expect(timeToSpeed(twin, target)).toBeLessThan(timeToSpeed(base, target));
  });

  it('returns maxTime when the target cannot be reached', () => {
    const base = flightParametersForBuild(DEFAULT_BUILD);
    // The integration loop may overshoot maxTime by at most one 0.02 s step.
    const unreachable = timeToSpeed(base, base.maxSpeed * 2, 30);
    expect(unreachable).toBeGreaterThanOrEqual(30);
    expect(unreachable).toBeLessThanOrEqual(30.02);
    expect(timeToSpeed({ ...base, thrust: 0 }, 10, 30)).toBe(30);
  });
});

describe('secondsOfBoostBeforeOverheat', () => {
  it('is infinite when the combined load stays below 1 and finite otherwise', () => {
    expect(secondsOfBoostBeforeOverheat({ baseLoad: 0.3, boostLoad: 0.5, heatRate: 0.2 })).toBe(Infinity);
    const seconds = secondsOfBoostBeforeOverheat({ baseLoad: 0.6, boostLoad: 1.0, heatRate: 0.2 });
    expect(Number.isFinite(seconds)).toBe(true);
    expect(seconds).toBeGreaterThan(0);
    // A faster heat rate overheats sooner.
    expect(secondsOfBoostBeforeOverheat({ baseLoad: 0.6, boostLoad: 1.0, heatRate: 0.4 })).toBeLessThan(
      seconds,
    );
  });
});

describe('summarisePerformance', () => {
  it('keeps every rating in 0..100 for every build', () => {
    for (const build of allBuilds()) {
      const summary = performanceForBuild(build);
      const ratings = [
        summary.turning,
        summary.stability,
        summary.heatManagement,
        ...Object.values(summary.ratings),
      ];
      for (const rating of ratings) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
      expect(summary.topSpeedKmh).toBeGreaterThan(0);
      expect(summary.stallSpeedKmh).toBeGreaterThan(0);
      expect(summary.accelerationSeconds).toBeGreaterThan(0);
      expect(summary.mass).toBeGreaterThan(0);
    }
  });

  it('changes when a part is swapped', () => {
    const base = performanceForBuild(DEFAULT_BUILD);
    const twin = performanceForBuild(withPart(DEFAULT_BUILD, 'engine', 'engine-twin'));
    const compact = performanceForBuild(withPart(DEFAULT_BUILD, 'wings', 'wings-compact'));
    const heavy = performanceForBuild(withPart(DEFAULT_BUILD, 'fuselage', 'fuselage-heavy'));
    expect(twin).not.toEqual(base);
    expect(twin.topSpeedKmh).toBeGreaterThan(base.topSpeedKmh);
    expect(compact).not.toEqual(base);
    expect(compact.stallSpeedKmh).toBeGreaterThan(base.stallSpeedKmh);
    expect(heavy).not.toEqual(base);
    expect(heavy.mass).toBeGreaterThan(base.mass);
    expect(heavy.ratings.stability).toBeGreaterThan(base.ratings.stability);
  });

  it('mirrors the top-level ratings in the ratings block', () => {
    const summary = summarisePerformance(flightParametersForBuild(DEFAULT_BUILD));
    expect(summary.ratings.turning).toBe(summary.turning);
    expect(summary.ratings.stability).toBe(summary.stability);
    expect(summary.ratings.heat).toBe(summary.heatManagement);
    expect(summary.boostEndurance).toBe(flightParametersForBuild(DEFAULT_BUILD).boostCapacity);
  });
});
