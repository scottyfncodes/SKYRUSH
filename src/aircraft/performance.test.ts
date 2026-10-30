import { describe, expect, it } from 'vitest';
import {
  CUSTOM_AIRFRAME_ID,
  DEFAULT_BUILD,
  buildName,
  defaultBuildFor,
  effectiveAirframe,
  isValidBuild,
  withPart,
  withSection,
  type AircraftBuild,
} from './build';
import { AIRFRAMES, COMPONENT_CATEGORIES, SECTIONS, getAirframe } from './parts';
import {
  ABSOLUTE_MAX_SPEED,
  AIR_DENSITY,
  buildCharacter,
  climbGradient,
  flightParametersForBuild,
  gripAtSpeed,
  performanceForBuild,
  secondsOfBoostBeforeOverheat,
  soften,
  summarisePerformance,
  thrustAtSpeed,
  timeToSpeed,
  type FlightParameters,
  type RatingKey,
} from './performance';

/** Every compatible build: airframes × every part each slot accepts. */
const allBuilds = (): AircraftBuild[] => {
  const builds: AircraftBuild[] = [];
  for (const airframe of AIRFRAMES.filter((a) => a.id !== CUSTOM_AIRFRAME_ID)) {
    let partial: AircraftBuild[] = [defaultBuildFor(airframe)];
    for (const category of COMPONENT_CATEGORIES) {
      partial = partial.flatMap((build) =>
        airframe.accepts[category].map((id) => withPart(build, category, id)),
      );
    }
    builds.push(...partial);
  }
  return builds;
};
const BUILDS = allBuilds();
const SPORT = DEFAULT_BUILD;
const on = (airframe: string): AircraftBuild => defaultBuildFor(getAirframe(airframe)!);

describe('computeFlightParameters', () => {
  it('the starter build keeps the handling the original default build had', () => {
    const params = flightParametersForBuild(SPORT);
    expect(params.mass).toBe(1370);
    expect(params.dragArea).toBeCloseTo(1.35, 10);
    expect(params.thrust).toBe(9000);
    expect(params.propBias).toBe(0);
    expect(params.stability).toBeCloseTo(1, 10);
    expect(params.pitchRate).toBeCloseTo(1.3, 10);
    expect(params.rollRate).toBeCloseTo(2.4, 10);
    expect(params.durability).toBeCloseTo(1, 10);
  });

  it('yields finite, sane parameters for every compatible build', () => {
    expect(BUILDS.length).toBeGreaterThan(5000);
    for (const build of BUILDS) {
      const params = flightParametersForBuild(build);
      for (const [key, value] of Object.entries(params)) {
        if (typeof value === 'boolean') continue;
        expect(Number.isFinite(value), key).toBe(true);
        if (key !== 'propBias') expect(value, key).toBeGreaterThan(0);
      }
      expect(params.maxSpeed).toBeLessThanOrEqual(ABSOLUTE_MAX_SPEED);
      expect(params.stallSpeed).toBeLessThan(params.maxSpeed * 0.5);
      expect(params.stability).toBeGreaterThanOrEqual(0.4);
      expect(params.stability).toBeLessThanOrEqual(2);
    }
  }, 30_000);

  it('top speed is where thrust equals drag, prop curve included', () => {
    for (const build of [SPORT, withPart(SPORT, 'prop', 'prop-four'), withPart(SPORT, 'prop', 'prop-two')]) {
      const params = flightParametersForBuild(build);
      const drag = 0.5 * AIR_DENSITY * params.dragArea * params.maxSpeed ** 2;
      expect(thrustAtSpeed(params, params.maxSpeed)).toBeCloseTo(drag, 3);
    }
  });

  it('heavier parts increase mass; twin engines carry two propellers', () => {
    const efficient = flightParametersForBuild(SPORT);
    const twin = flightParametersForBuild(withPart(SPORT, 'engine', 'engine-twin'));
    expect(twin.mass - efficient.mass).toBe(560 - 300 + 40);
    const reinforced = flightParametersForBuild(withPart(SPORT, 'frame', 'frame-reinforced'));
    const light = flightParametersForBuild(withPart(SPORT, 'frame', 'frame-light'));
    expect(reinforced.mass).toBeGreaterThan(efficient.mass);
    expect(light.mass).toBeLessThan(efficient.mass);
  });
});

describe('component trade-offs', () => {
  const rating = (build: AircraftBuild, key: RatingKey) => performanceForBuild(build).ratings[key];

  it('racing wings: less drag and faster roll, worse low-speed handling', () => {
    const compact = flightParametersForBuild(withPart(SPORT, 'wings', 'wings-compact'));
    const base = flightParametersForBuild(SPORT);
    expect(compact.dragArea).toBeLessThan(base.dragArea);
    expect(compact.rollRate).toBeGreaterThan(base.rollRate);
    expect(compact.stallSpeed).toBeGreaterThan(base.stallSpeed);
  });

  it('high-lift wings: better slow flight and stability, more drag', () => {
    const highlift = flightParametersForBuild(withPart(SPORT, 'wings', 'wings-highlift'));
    const base = flightParametersForBuild(SPORT);
    expect(highlift.stallSpeed).toBeLessThan(base.stallSpeed);
    expect(highlift.stability).toBeGreaterThan(base.stability);
    expect(highlift.maxSpeed).toBeLessThan(base.maxSpeed);
  });

  it('frames: lightweight is quicker and frailer, reinforced is steadier and tougher', () => {
    const base = flightParametersForBuild(SPORT);
    const light = flightParametersForBuild(withPart(SPORT, 'frame', 'frame-light'));
    const tough = flightParametersForBuild(withPart(SPORT, 'frame', 'frame-reinforced'));
    expect(light.responsiveness).toBeGreaterThan(base.responsiveness);
    expect(light.durability).toBeLessThan(base.durability);
    expect(tough.stability).toBeGreaterThan(base.stability);
    expect(tough.durability).toBeGreaterThan(base.durability);
    expect(tough.responsiveness).toBeLessThan(base.responsiveness);
  });

  it('engines: high output climbs and runs hot, efficient refills boost faster', () => {
    const base = performanceForBuild(SPORT);
    const hornet = performanceForBuild(withPart(SPORT, 'engine', 'engine-hornet'));
    const albatross = performanceForBuild(withPart(SPORT, 'engine', 'engine-albatross'));
    expect(hornet.ratings.climb).toBeGreaterThan(base.ratings.climb);
    expect(hornet.ratings.heat).toBeLessThan(base.ratings.heat);
    expect(albatross.ratings.boost).toBeGreaterThan(base.ratings.boost);
    expect(albatross.topSpeedKmh).toBeLessThan(base.topSpeedKmh);
  });

  it('propellers: four blades pull harder off the line, two blades run faster at the top', () => {
    const four = flightParametersForBuild(withPart(SPORT, 'prop', 'prop-four'));
    const two = flightParametersForBuild(withPart(SPORT, 'prop', 'prop-two'));
    const target = 250 / 3.6;
    expect(timeToSpeed(four, target)).toBeLessThan(timeToSpeed(two, target));
    expect(climbGradient(four, 55)).toBeGreaterThan(climbGradient(two, 55));
    expect(two.maxSpeed).toBeGreaterThan(four.maxSpeed);
  });

  it('a bigger stabiliser is more predictable and less nimble; the V-tail is the reverse', () => {
    expect(rating(withPart(SPORT, 'tail', 'tail-big'), 'stability')).toBeGreaterThan(
      rating(SPORT, 'stability'),
    );
    expect(rating(withPart(SPORT, 'tail', 'tail-big'), 'agility')).toBeLessThan(rating(SPORT, 'agility'));
    expect(rating(withPart(SPORT, 'tail', 'tail-vee'), 'stability')).toBeLessThan(rating(SPORT, 'stability'));
    expect(rating(withPart(SPORT, 'tail', 'tail-vee'), 'agility')).toBeGreaterThan(rating(SPORT, 'agility'));
  });

  it('gear: retractable cuts drag, tundra tyres and floats add toughness', () => {
    const base = flightParametersForBuild(SPORT);
    expect(flightParametersForBuild(withPart(SPORT, 'gear', 'gear-retract')).dragArea).toBeLessThan(
      base.dragArea,
    );
    expect(flightParametersForBuild(withPart(SPORT, 'gear', 'gear-tundra')).durability).toBeGreaterThan(
      base.durability,
    );
    const bush = on('airframe-bush');
    expect(flightParametersForBuild(withPart(bush, 'gear', 'gear-floats')).durability).toBeGreaterThan(
      flightParametersForBuild(withPart(bush, 'gear', 'gear-light')).durability,
    );
  });
});

describe('balance', () => {
  it('stacking parts has diminishing returns', () => {
    expect(soften(1, 0.6, 1.3)).toBe(1);
    expect(soften(1.9, 0.6, 1.3)).toBeCloseTo(1.6, 10);
    expect(soften(0.2, 0.6, 1.3)).toBeCloseTo(0.4, 10);
    // The most stable bush build is not twice as stable as the starter.
    const steady = flightParametersForBuild({
      ...on('airframe-bush'),
      frame: 'frame-reinforced',
      wings: 'wings-glider',
      tail: 'tail-big',
    });
    expect(steady.stability).toBeLessThan(1.8);
  });

  it('no single build leads every category', () => {
    const keys: RatingKey[] = ['topSpeed', 'agility', 'climb', 'stability', 'lowSpeed', 'toughness', 'boost'];
    const best = Object.fromEntries(keys.map((key) => [key, 0])) as Record<RatingKey, number>;
    const summaries = BUILDS.filter((_, i) => i % 3 === 0).map((build) => performanceForBuild(build).ratings);
    for (const ratings of summaries) for (const key of keys) best[key] = Math.max(best[key], ratings[key]);
    for (const ratings of summaries) {
      const leads = keys.filter((key) => ratings[key] >= best[key] - 10).length;
      expect(leads).toBeLessThan(5);
    }
  }, 30_000);

  it('the fastest build is not the most forgiving one', () => {
    const fastest = BUILDS.reduce((a, b) =>
      flightParametersForBuild(a).maxSpeed >= flightParametersForBuild(b).maxSpeed ? a : b,
    );
    const params = flightParametersForBuild(fastest);
    expect(params.stallSpeed).toBeGreaterThan(flightParametersForBuild(SPORT).stallSpeed);
  }, 30_000);

  it('each aircraft has a different character out of the factory', () => {
    const labels = AIRFRAMES.map(
      (airframe) => buildCharacter(performanceForBuild(defaultBuildFor(airframe))).label,
    );
    expect(new Set(labels).size).toBeGreaterThanOrEqual(4);
    expect(buildCharacter(performanceForBuild(on('airframe-scout'))).leading[0]).toBe('Agility');
    expect(buildCharacter(performanceForBuild(on('airframe-bush'))).leading[0]).toBe('Stability');
    expect(buildCharacter(performanceForBuild(on('airframe-racer'))).leading).toContain('Speed');
  });

  it('the starter is viable: it reaches race pace and climbs out of a valley', () => {
    const params = flightParametersForBuild(SPORT);
    expect(params.maxSpeed * 3.6).toBeGreaterThan(350);
    expect(climbGradient(params, 55)).toBeGreaterThan(0.35);
  });
});

describe('gripAtSpeed / timeToSpeed', () => {
  it('grip falls off with speed and is clamped', () => {
    const params = flightParametersForBuild(SPORT);
    expect(gripAtSpeed(params, 40)).toBeGreaterThan(gripAtSpeed(params, 80));
    expect(gripAtSpeed(params, 80)).toBeCloseTo(params.grip, 10);
    expect(gripAtSpeed(params, 1)).toBeCloseTo(params.grip * 2.2, 10);
    expect(gripAtSpeed(params, 10_000)).toBeCloseTo(params.grip * 0.35, 10);
  });

  it('is shorter for more thrust and returns maxTime when unreachable', () => {
    const base = flightParametersForBuild(SPORT);
    const stronger: FlightParameters = { ...base, thrust: base.thrust * 1.5 };
    const target = 250 / 3.6;
    expect(timeToSpeed(stronger, target)).toBeLessThan(timeToSpeed(base, target));
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
    expect(seconds).toBeGreaterThan(0);
    expect(secondsOfBoostBeforeOverheat({ baseLoad: 0.6, boostLoad: 1.0, heatRate: 0.4 })).toBeLessThan(
      seconds,
    );
  });
});

describe('summarisePerformance', () => {
  it('keeps every rating in 0..100', () => {
    for (const build of BUILDS.filter((_, i) => i % 7 === 0)) {
      const summary = performanceForBuild(build);
      for (const rating of Object.values(summary.ratings)) {
        expect(Number.isInteger(rating)).toBe(true);
        expect(rating).toBeGreaterThanOrEqual(0);
        expect(rating).toBeLessThanOrEqual(100);
      }
      expect(summary.topSpeedKmh).toBeGreaterThan(0);
      expect(summary.accelerationSeconds).toBeGreaterThan(0);
    }
  }, 30_000);

  it('mirrors the top-level values in the ratings block', () => {
    const params = flightParametersForBuild(SPORT);
    const summary = summarisePerformance(params);
    expect(summary.ratings.turning).toBe(summary.turning);
    expect(summary.ratings.stability).toBe(summary.stability);
    expect(summary.ratings.heat).toBe(summary.heatManagement);
    expect(summary.boostEndurance).toBe(params.boostCapacity);
    expect(summary.scrapeTolerance).toBeCloseTo(9, 5);
  });

  it('every slot swap that is allowed changes the numbers', () => {
    for (const airframe of AIRFRAMES.filter((a) => a.id !== CUSTOM_AIRFRAME_ID)) {
      const base = performanceForBuild(defaultBuildFor(airframe));
      for (const category of COMPONENT_CATEGORIES) {
        for (const id of airframe.accepts[category]) {
          if (id === airframe.defaults[category]) continue;
          expect(
            performanceForBuild(withPart(defaultBuildFor(airframe), category, id)),
            `${airframe.id} ${id}`,
          ).not.toEqual(base);
        }
      }
    }
  });
});

describe('Workshop Special (kitbashed sections)', () => {
  const special = defaultBuildFor(getAirframe(CUSTOM_AIRFRAME_ID)!);
  const ids = (category: string) => SECTIONS.filter((s) => s.category === category).map((s) => s.id);

  it('with Meridian sections it flies exactly like a Meridian', () => {
    const meridian = flightParametersForBuild(DEFAULT_BUILD);
    const kit = flightParametersForBuild(special);
    for (const key of Object.keys(meridian) as (keyof typeof meridian)[]) {
      expect(Number(kit[key]), key).toBeCloseTo(Number(meridian[key]), 9);
    }
    expect(buildName(special)).toBe('Meridian Special');
  });

  it('every combination of sections becomes a valid aircraft with sane numbers', () => {
    let count = 0;
    for (const nose of ids('nose'))
      for (const cabin of ids('cabin'))
        for (const boom of ids('boom')) {
          let build = withSection(special, 'nose', nose);
          build = withSection(build, 'cabin', cabin);
          build = withSection(build, 'boom', boom);
          expect(isValidBuild(build), `${nose} ${cabin} ${boom}`).toBe(true);
          const params = flightParametersForBuild(build);
          for (const [key, value] of Object.entries(params))
            if (typeof value !== 'boolean') expect(Number.isFinite(value), key).toBe(true);
          expect(params.stallSpeed).toBeLessThan(params.maxSpeed * 0.5);
          count += 1;
        }
    expect(count).toBe(343);
  });

  it('sections carry their handling: a racer nose and boom are slipperier, a bush cabin tougher', () => {
    const base = flightParametersForBuild(special);
    const slick = flightParametersForBuild(
      withSection(withSection(special, 'nose', 'nose-racer'), 'boom', 'boom-racer'),
    );
    expect(slick.dragArea).toBeLessThan(base.dragArea);
    const tough = flightParametersForBuild(withSection(special, 'cabin', 'cabin-bush'));
    expect(tough.durability).toBeGreaterThan(base.durability);
    expect(tough.stallSpeed).toBeLessThan(base.stallSpeed);
  });

  it('fit rules follow the sections', () => {
    // A Petrel nose has no engine bay: single engines need the Petrel's pylon cabin.
    const capped = effectiveAirframe(withSection(special, 'nose', 'nose-seaplane'))!;
    expect(capped.accepts.engine).not.toContain('engine-efficient');
    expect(capped.accepts.engine).toContain('engine-twin');
    // Wings and gear follow the cabin; tails follow the boom.
    const floaty = effectiveAirframe(withSection(special, 'cabin', 'cabin-seaplane'))!;
    expect(floaty.accepts.gear).toEqual(['gear-floats']);
    const racerBoom = effectiveAirframe(withSection(special, 'boom', 'boom-racer'))!;
    expect(racerBoom.accepts.tail).not.toContain('tail-twin');
    // Swapping repairs parts that no longer fit.
    const swapped = withSection(special, 'cabin', 'cabin-seaplane');
    expect(swapped.gear).toBe('gear-floats');
  });

  it('a Thunderpod build is the fastest straight-line machine and pays for it', () => {
    const pods = flightParametersForBuild({ ...DEFAULT_BUILD, engine: 'engine-pod' });
    const twin = flightParametersForBuild({ ...DEFAULT_BUILD, engine: 'engine-twin' });
    expect(pods.maxSpeed).toBeGreaterThan(twin.maxSpeed);
    expect(pods.mass).toBeGreaterThan(twin.mass);
    expect(pods.boostCapacity).toBeLessThan(twin.boostCapacity);
  });
});
