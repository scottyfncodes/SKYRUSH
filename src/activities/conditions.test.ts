import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createFlightState, stepFlight, NEUTRAL_INPUT } from '../flight/FlightModel';
import { flightParametersForBuild } from '../aircraft/performance';
import { defaultBuildFor } from '../aircraft/build';
import { getAirframe } from '../aircraft/parts';
import { CALDERA_THEME } from '../course/themes';
import {
  CLEAR_CONDITIONS,
  describeConditions,
  gradeTheme,
  mixColor,
  sampleWind,
  type Conditions,
} from './conditions';

const DT = 1 / 120;
const params = (id = 'airframe-sport') => flightParametersForBuild(defaultBuildFor(getAirframe(id)!));

describe('wind in the flight model', () => {
  it('drifts the aircraft downwind while its airspeed is unchanged', () => {
    const still = createFlightState(new Vector3(0, 300, 0), new Quaternion(), 80);
    const windy = createFlightState(new Vector3(0, 300, 0), new Quaternion(), 80);
    const wind = new Vector3(8, 0, 0);
    for (let i = 0; i < 600; i += 1) {
      stepFlight(still, NEUTRAL_INPUT, params(), { terrainHeight: () => 0, ceiling: 2000 }, DT);
      stepFlight(windy, NEUTRAL_INPUT, params(), { terrainHeight: () => 0, ceiling: 2000, wind }, DT);
    }
    expect(windy.position.x - still.position.x).toBeGreaterThan(35);
    expect(Math.abs(windy.speed - still.speed)).toBeLessThan(2);
  });

  it('flies identically with a zero wind vector', () => {
    const a = createFlightState(new Vector3(0, 300, 0), new Quaternion(), 80);
    const b = createFlightState(new Vector3(0, 300, 0), new Quaternion(), 80);
    const input = { ...NEUTRAL_INPUT, roll: 0.5, pitch: 0.2 };
    for (let i = 0; i < 300; i += 1) {
      stepFlight(a, input, params(), { terrainHeight: () => 0, ceiling: 2000 }, DT);
      stepFlight(b, input, params(), { terrainHeight: () => 0, ceiling: 2000, wind: new Vector3() }, DT);
    }
    expect(a.position.distanceTo(b.position)).toBeLessThan(1e-6);
  });
});

describe('float gear on water', () => {
  const descend = (id: string, water: boolean) => {
    const state = createFlightState(new Vector3(0, 6, 0), new Quaternion(), 50);
    state.velocity.y = -2;
    const env = { terrainHeight: () => 0, ceiling: 2000, isWater: () => water };
    const contacts = new Set<string>();
    for (let i = 0; i < 360; i += 1) {
      stepFlight(state, { ...NEUTRAL_INPUT, pitch: -0.2, throttle: 0.3 }, params(id), env, DT);
      contacts.add(state.groundContact);
    }
    return contacts;
  };

  it('lets a floatplane settle onto water without a scrape', () => {
    const contacts = descend('airframe-seaplane', true);
    expect(contacts.has('splash')).toBe(true);
    expect(contacts.has('scrape')).toBe(false);
    expect(contacts.has('crash')).toBe(false);
  });

  it('still scrapes wheels on water and floats on dry ground', () => {
    expect(descend('airframe-sport', true).has('splash')).toBe(false);
    expect(descend('airframe-seaplane', false).has('splash')).toBe(false);
  });
});

describe('conditions', () => {
  it('has no wind in clear weather and steady wind in a breeze', () => {
    const out = new Vector3();
    sampleWind(CLEAR_CONDITIONS, 12, 100, 100, out);
    expect(out.length()).toBe(0);
    const breezy: Conditions = { time: 'authored', weather: 'breezy', windHeading: Math.PI / 2 };
    sampleWind(breezy, 12, 100, 100, out);
    expect(out.x).toBeGreaterThan(3);
    expect(Math.abs(out.z)).toBeLessThan(out.x);
  });

  it('is deterministic for the same time and place', () => {
    const gusty: Conditions = { time: 'dawn', weather: 'gusty', windHeading: 1 };
    const a = new Vector3();
    const b = new Vector3();
    expect(sampleWind(gusty, 33.3, 10, 20, a)).toBe(sampleWind(gusty, 33.3, 10, 20, b));
    expect(a.equals(b)).toBe(true);
  });

  it('leaves the authored theme alone in clear authored light', () => {
    expect(gradeTheme(CALDERA_THEME, CLEAR_CONDITIONS)).toBe(CALDERA_THEME);
  });

  it('pulls the fog in and lowers the sun for fog at dusk', () => {
    const graded = gradeTheme(CALDERA_THEME, { time: 'dusk', weather: 'fog', windHeading: 0 });
    expect(graded.fog.far).toBeLessThan(CALDERA_THEME.fog.far * 0.5);
    expect(graded.sun.direction[1]).toBeLessThan(CALDERA_THEME.sun.direction[1]);
    expect(graded.sun.intensity).toBeLessThan(CALDERA_THEME.sun.intensity);
    expect(graded.mood).toContain('Fog');
  });

  it('blends colours channel by channel', () => {
    expect(mixColor(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(mixColor(0xff0000, 0x0000ff, 1)).toBe(0x0000ff);
  });

  it('describes conditions in plain words', () => {
    expect(describeConditions({ time: 'dawn', weather: 'gusty', windHeading: 0 })).toBe(
      'Dawn · Gusty, 29 km/h wind',
    );
    expect(describeConditions(CLEAR_CONDITIONS, 'Desert canyon · golden afternoon')).toBe(
      'Golden afternoon · Clear',
    );
  });
});
