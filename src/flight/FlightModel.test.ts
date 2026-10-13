import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import {
  MAX_ASSISTED_BANK,
  NEUTRAL_INPUT,
  OVERHEAT_CLEAR_THRESHOLD,
  copyFlightState,
  createFlightState,
  getForward,
  getRight,
  getUp,
  resetFlightState,
  stepFlight,
  type FlightEnvironment,
  type FlightInput,
  type FlightState,
} from './FlightModel';
import { flightParametersForBuild, type FlightParameters } from '../aircraft/performance';
import { DEFAULT_BUILD, withPart } from '../aircraft/build';

const DT = 1 / 120;
const FLAT: FlightEnvironment = { terrainHeight: () => 0, ceiling: 900 };
const DEFAULT_PARAMS = flightParametersForBuild(DEFAULT_BUILD);
const TWIN_PARAMS = flightParametersForBuild(withPart(DEFAULT_BUILD, 'engine', 'engine-twin'));

const input = (overrides: Partial<FlightInput> = {}): FlightInput => ({ ...NEUTRAL_INPUT, ...overrides });

/** Level flight at `speed` m/s, 200 m up, facing +Z. */
const level = (speed = 80, altitude = 200): FlightState =>
  createFlightState(new Vector3(0, altitude, 0), new Quaternion(), speed);

const pitched = (radians: number, altitude: number, speed: number): FlightState =>
  createFlightState(
    new Vector3(0, altitude, 0),
    // Positive body-X rotation lowers the nose in this frame, so negate for nose-up.
    new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -radians),
    speed,
  );

const simulate = (
  state: FlightState,
  controls: FlightInput,
  seconds: number,
  params: FlightParameters = DEFAULT_PARAMS,
  dt = DT,
  env: FlightEnvironment = FLAT,
): FlightState => {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i += 1) stepFlight(state, controls, params, env, dt);
  return state;
};

const expectFinite = (state: FlightState): void => {
  for (const value of [
    ...state.position.toArray(),
    ...state.velocity.toArray(),
    ...state.rates.toArray(),
    state.orientation.x,
    state.orientation.y,
    state.orientation.z,
    state.orientation.w,
    state.speed,
    state.heat,
    state.boostEnergy,
    state.throttle,
    state.altitude,
    state.bank,
    state.pitchAngle,
    state.angleOfAttack,
  ]) {
    expect(Number.isFinite(value)).toBe(true);
  }
};

const forward = new Vector3();

describe('createFlightState / resetFlightState', () => {
  it('initialises velocity along the nose and copies the inputs', () => {
    const position = new Vector3(1, 2, 3);
    const state = createFlightState(position, new Quaternion(), 50);
    expect(state.velocity.toArray()).toEqual([0, 0, 50]);
    expect(state.speed).toBe(50);
    expect(state.position).not.toBe(position);
    expect(state.boostEnergy).toBe(1);
    expect(state.overheated).toBe(false);
  });

  it('resetFlightState restores a known-good attitude and clears flags', () => {
    const state = level();
    state.heat = 0.95;
    state.overheated = true;
    state.stalled = true;
    state.rates.set(1, 2, 3);
    state.groundContact = 'crash';
    resetFlightState(state, new Vector3(5, 60, 7), new Quaternion(), 62);
    expect(state.position.toArray()).toEqual([5, 60, 7]);
    expect(state.speed).toBe(62);
    expect(state.velocity.length()).toBeCloseTo(62, 10);
    expect(state.rates.toArray()).toEqual([0, 0, 0]);
    expect(state.overheated).toBe(false);
    expect(state.stalled).toBe(false);
    expect(state.groundContact).toBe('none');
    expect(state.heat).toBeLessThanOrEqual(0.5);
  });

  it('copyFlightState copies every field by value', () => {
    const source = simulate(level(), input({ roll: 0.5, boost: true }), 1);
    const target = level(10);
    copyFlightState(target, source);
    expect(target.position.toArray()).toEqual(source.position.toArray());
    expect(target.velocity.toArray()).toEqual(source.velocity.toArray());
    expect(target.orientation.equals(source.orientation)).toBe(true);
    expect(target.boostEnergy).toBe(source.boostEnergy);
    expect(target.heat).toBe(source.heat);
    expect(target.position).not.toBe(source.position);
  });
});

describe('level flight', () => {
  it('keeps flying for 10 s with neutral input and full throttle', () => {
    const state = simulate(level(), NEUTRAL_INPUT, 10);
    expectFinite(state);
    expect(state.speed).toBeGreaterThan(DEFAULT_PARAMS.stallSpeed);
    expect(state.stalled).toBe(false);
    expect(state.altitude).toBeGreaterThan(0);
    expect(state.position.y).toBeGreaterThan(100);
    expect(state.orientation.length()).toBeCloseTo(1, 6);
    expect(state.position.z).toBeGreaterThan(500);
    expect(Math.abs(state.position.x)).toBeLessThan(1);
    expect(state.groundContact).toBe('none');
  });

  it('converges toward maxSpeed after 60 s of full throttle', () => {
    const state = simulate(level(), NEUTRAL_INPUT, 60);
    expect(state.speed).toBeLessThanOrEqual(DEFAULT_PARAMS.maxSpeed * 1.01);
    expect(state.speed).toBeGreaterThan(DEFAULT_PARAMS.maxSpeed * 0.92);
  });

  it('is deterministic', () => {
    const a = simulate(level(), input({ roll: 0.3, pitch: 0.1, boost: true }), 5);
    const b = simulate(level(), input({ roll: 0.3, pitch: 0.1, boost: true }), 5);
    expect(a.position.toArray()).toEqual(b.position.toArray());
    expect(a.velocity.toArray()).toEqual(b.velocity.toArray());
    expect(a.orientation.toArray()).toEqual(b.orientation.toArray());
    expect(a.heat).toBe(b.heat);
    expect(a.boostEnergy).toBe(b.boostEnergy);
  });
});

describe('control response', () => {
  it('pitch-up input raises the nose (forward.y)', () => {
    const state = level();
    const before = getForward(state, forward).y;
    simulate(state, input({ pitch: 1 }), 1);
    const after = getForward(state, forward).y;
    expect(after).toBeGreaterThan(before + 0.3);
    expect(state.pitchAngle).toBeGreaterThan(0.3);
    expect(state.rates.x).toBeGreaterThan(0);
  });

  it('pitch-down input lowers the nose', () => {
    const state = simulate(level(), input({ pitch: -1 }), 1);
    expect(getForward(state, forward).y).toBeLessThan(-0.3);
    expect(state.pitchAngle).toBeLessThan(-0.3);
  });

  it('roll-right input makes bank positive and roll-left negative', () => {
    const right = simulate(level(), input({ roll: 1 }), 0.5);
    expect(right.bank).toBeGreaterThan(0.3);
    expect(right.rates.z).toBeGreaterThan(0);
    const left = simulate(level(), input({ roll: -1 }), 0.5);
    expect(left.bank).toBeLessThan(-0.3);
  });

  it('yaw-right input turns the nose to the right (+X)', () => {
    const state = simulate(level(), input({ yaw: 1 }), 2);
    // Screen-right is the -X side (the chase camera looks along +Z).
    expect(getForward(state, forward).x).toBeLessThan(-0.1);
  });

  it('self-levels when the stick is centred after a roll', () => {
    const state = simulate(level(), input({ roll: 1 }), 0.4);
    const banked = Math.abs(state.bank);
    simulate(state, NEUTRAL_INPUT, 4);
    expect(Math.abs(state.bank)).toBeLessThan(banked * 0.25);
  });

  it('airbrake reduces speed faster than no airbrake', () => {
    const braked = simulate(level(100), input({ throttle: 0, airbrake: true }), 3);
    const coasting = simulate(level(100), input({ throttle: 0 }), 3);
    expect(braked.airbrake).toBe(true);
    expect(braked.speed).toBeLessThan(coasting.speed - 5);
    expect(coasting.speed).toBeLessThan(100);
  });

  it('throttle follows the input with a lag', () => {
    const state = level();
    stepFlight(state, input({ throttle: 0 }), DEFAULT_PARAMS, FLAT, DT);
    expect(state.throttle).toBeLessThan(1);
    expect(state.throttle).toBeGreaterThan(0.9);
    simulate(state, input({ throttle: 0 }), 2);
    expect(state.throttle).toBe(0);
  });
});

describe('boost', () => {
  it('drains energy while boosting and recovers when released', () => {
    const state = level();
    simulate(state, input({ boost: true }), 2);
    expect(state.boosting).toBe(true);
    expect(state.boostEnergy).toBeCloseTo(1 - 2 / DEFAULT_PARAMS.boostCapacity, 3);
    const drained = state.boostEnergy;
    simulate(state, NEUTRAL_INPUT, 2);
    expect(state.boosting).toBe(false);
    expect(state.boostEnergy).toBeCloseTo(drained + 2 / DEFAULT_PARAMS.boostRechargeTime, 3);
    simulate(state, NEUTRAL_INPUT, 30);
    expect(state.boostEnergy).toBe(1);
  });

  it('increases acceleration', () => {
    const boosted = simulate(level(), input({ boost: true }), 2);
    const plain = simulate(level(), NEUTRAL_INPUT, 2);
    expect(boosted.speed).toBeGreaterThan(plain.speed + 3);
  });

  it('stops when the energy is empty', () => {
    const state = level();
    simulate(state, input({ boost: true }), DEFAULT_PARAMS.boostCapacity + 0.5);
    expect(state.boostEnergy).toBeLessThan(0.05);
    // Once empty the boost flag cannot stay on: holding the button no longer boosts continuously.
    let boostingSteps = 0;
    let idleSteps = 0;
    for (let i = 0; i < 120; i += 1) {
      stepFlight(state, input({ boost: true }), DEFAULT_PARAMS, FLAT, DT);
      if (state.boosting) boostingSteps += 1;
      else idleSteps += 1;
      expect(state.boostEnergy).toBeLessThan(0.05);
    }
    expect(idleSteps).toBeGreaterThan(boostingSteps);
  });

  it('cannot boost at idle throttle', () => {
    const state = level();
    simulate(state, input({ throttle: 0 }), 2);
    stepFlight(state, input({ throttle: 0, boost: true }), DEFAULT_PARAMS, FLAT, DT);
    expect(state.boosting).toBe(false);
    expect(state.boostEnergy).toBe(1);
  });
});

describe('heat', () => {
  it('rises under boost and overheats with the twin turbine, then clears after cooling', () => {
    const state = level();
    const initialHeat = state.heat;
    simulate(state, input({ boost: true }), 1, TWIN_PARAMS);
    expect(state.heat).toBeGreaterThan(initialHeat);
    expect(state.overheated).toBe(false);

    let overheatedAt = -1;
    for (let i = 0; i < 120 * 20 && overheatedAt < 0; i += 1) {
      stepFlight(state, input({ boost: true }), TWIN_PARAMS, FLAT, DT);
      if (state.overheated) overheatedAt = (i + 1) * DT;
    }
    expect(overheatedAt).toBeGreaterThan(0);
    expect(overheatedAt).toBeLessThan(15);
    expect(state.heat).toBeGreaterThan(0.99);
    // Boost is refused while overheated.
    stepFlight(state, input({ boost: true }), TWIN_PARAMS, FLAT, DT);
    expect(state.boosting).toBe(false);

    simulate(state, input({ throttle: 0.1 }), 30, TWIN_PARAMS);
    expect(state.overheated).toBe(false);
    expect(state.heat).toBeLessThan(OVERHEAT_CLEAR_THRESHOLD);
  });

  it('never overheats on the efficient turbine without boost at full throttle', () => {
    const state = simulate(level(), NEUTRAL_INPUT, 60);
    expect(state.overheated).toBe(false);
    expect(state.heat).toBeCloseTo(DEFAULT_PARAMS.baseLoad, 1);
  });

  it('reduces thrust while overheated', () => {
    const overheated = level();
    overheated.heat = 0.95;
    overheated.overheated = true;
    const healthy = level();
    healthy.heat = 0.95;
    simulate(overheated, NEUTRAL_INPUT, 3, TWIN_PARAMS);
    simulate(healthy, NEUTRAL_INPUT, 3, TWIN_PARAMS);
    expect(overheated.overheated).toBe(true);
    expect(overheated.speed).toBeLessThan(healthy.speed - 3);
  });

  it('decreases at low throttle', () => {
    const state = level();
    state.heat = 0.6;
    simulate(state, input({ throttle: 0 }), 3);
    expect(state.heat).toBeLessThan(0.5);
    expect(state.heat).toBeGreaterThanOrEqual(0);
  });

  it('cools faster with the airbrake deployed', () => {
    const braked = level();
    braked.heat = 0.8;
    const plain = level();
    plain.heat = 0.8;
    simulate(braked, input({ throttle: 0, airbrake: true }), 3);
    simulate(plain, input({ throttle: 0 }), 3);
    expect(braked.heat).toBeLessThan(plain.heat);
  });
});

describe('stall', () => {
  it('flags stalled below stall speed and drops the nose with neutral input', () => {
    const state = level(DEFAULT_PARAMS.stallSpeed * 0.6);
    const before = getForward(state, forward).y;
    simulate(state, input({ throttle: 0 }), 1);
    expect(state.stalled).toBe(true);
    expect(getForward(state, forward).y).toBeLessThan(before - 0.2);
    expect(state.pitchAngle).toBeLessThan(-0.2);
  });

  it('is not stalled at cruise speed', () => {
    const state = simulate(level(80), NEUTRAL_INPUT, 1);
    expect(state.stalled).toBe(false);
  });

  it('recovers airspeed after a stall at altitude', () => {
    const state = level(DEFAULT_PARAMS.stallSpeed * 0.6, 600);
    simulate(state, NEUTRAL_INPUT, 15);
    expect(state.stalled).toBe(false);
    expect(state.speed).toBeGreaterThan(DEFAULT_PARAMS.stallSpeed);
    expect(state.groundContact).toBe('none');
  });
});

describe('ground and ceiling', () => {
  it('reports a crash when flying steeply into the terrain', () => {
    const state = pitched(-Math.PI / 3, 100, 80);
    let contact = state.groundContact;
    for (let i = 0; i < 1200 && contact === 'none'; i += 1) {
      stepFlight(state, NEUTRAL_INPUT, DEFAULT_PARAMS, FLAT, DT);
      contact = state.groundContact;
    }
    expect(contact).toBe('crash');
    expect(state.altitude).toBeLessThan(1.5);
    // Hit the ground descending faster than the scrape tolerance (9 m/s at durability 1).
    expect(state.velocity.y).toBeLessThan(-9);
    expect(getForward(state, forward).y).toBeLessThan(0);
  });

  it('reports a scrape with a positive vertical velocity for gentle contact', () => {
    const state = createFlightState(new Vector3(0, 3, 0), new Quaternion(), 80);
    let contact = state.groundContact;
    for (let i = 0; i < 1200 && contact === 'none'; i += 1) {
      stepFlight(state, input({ pitch: -0.1 }), DEFAULT_PARAMS, FLAT, DT);
      contact = state.groundContact;
    }
    expect(contact).toBe('scrape');
    expect(state.velocity.y).toBeGreaterThan(0);
    expect(state.altitude).toBeCloseTo(1.5, 6);
    expect(state.position.y).toBeCloseTo(1.5, 6);
    expect(state.speed).toBeGreaterThan(0);
  });

  it('uses the terrain function for contact', () => {
    const hilly: FlightEnvironment = { terrainHeight: () => 150, ceiling: 900 };
    const state = simulate(level(80, 160), input({ pitch: -0.2 }), 3, DEFAULT_PARAMS, DT, hilly);
    expect(state.groundContact).not.toBe('none');
    expect(state.position.y).toBeLessThanOrEqual(151.5 + 1e-6);
  });

  it('enforces the ceiling', () => {
    const state = pitched(0.5, 880, 100);
    for (let i = 0; i < 600; i += 1) {
      stepFlight(state, input({ pitch: 1 }), DEFAULT_PARAMS, FLAT, DT);
      expect(state.position.y).toBeLessThanOrEqual(FLAT.ceiling);
    }
    expect(state.position.y).toBeGreaterThan(FLAT.ceiling - 20);
  });
});

describe('robustness', () => {
  it('does not produce NaN for a huge dt', () => {
    const state = level();
    stepFlight(state, NEUTRAL_INPUT, DEFAULT_PARAMS, FLAT, 5);
    expectFinite(state);
    expect(state.orientation.length()).toBeCloseTo(1, 6);
    simulate(state, NEUTRAL_INPUT, 20, DEFAULT_PARAMS, 0.5);
    expectFinite(state);
  });

  it('ignores non-positive or NaN dt', () => {
    const state = level();
    const snapshot = state.position.toArray();
    stepFlight(state, NEUTRAL_INPUT, DEFAULT_PARAMS, FLAT, 0);
    stepFlight(state, NEUTRAL_INPUT, DEFAULT_PARAMS, FLAT, -1);
    stepFlight(state, NEUTRAL_INPUT, DEFAULT_PARAMS, FLAT, Number.NaN);
    expect(state.position.toArray()).toEqual(snapshot);
  });

  it('sanitises NaN and out-of-range inputs', () => {
    const garbage: FlightInput = {
      pitch: Number.NaN,
      roll: Number.POSITIVE_INFINITY,
      yaw: -50,
      throttle: Number.NaN,
      boost: true,
      airbrake: false,
    };
    const state = simulate(level(), garbage, 2);
    expectFinite(state);
    expect(state.orientation.length()).toBeCloseTo(1, 6);
    // NaN throttle is treated as zero: the engine spools down.
    expect(state.throttle).toBe(0);
    expect(state.boosting).toBe(false);
  });

  it('gives similar results at 1/30 and 1/120 timesteps in level flight', () => {
    const coarse = simulate(level(), NEUTRAL_INPUT, 20, DEFAULT_PARAMS, 1 / 30);
    const fine = simulate(level(), NEUTRAL_INPUT, 20, DEFAULT_PARAMS, 1 / 120);
    expectFinite(coarse);
    expectFinite(fine);
    expect(Math.abs(coarse.speed - fine.speed)).toBeLessThan(fine.speed * 0.03);
    expect(Math.abs(coarse.position.y - fine.position.y)).toBeLessThan(10);
    expect(Math.abs(coarse.position.z - fine.position.z)).toBeLessThan(fine.position.z * 0.03);
  });

  it('keeps the up vector consistent with the bank angle', () => {
    const state = simulate(level(), input({ roll: 1 }), 0.3);
    const up = getUp(state, new Vector3());
    const right = getRight(state, new Vector3());
    // bank/pitch are sampled before the step's rotation is applied, so allow one step of lag.
    expect(Math.abs(Math.atan2(right.y, up.y) - state.bank)).toBeLessThan(0.05);
    expect(Math.abs(Math.asin(getForward(state, forward).y) - state.pitchAngle)).toBeLessThan(0.05);
  });
});

describe('assisted steering', () => {
  const ASSIST = { strength: 0.6 };
  const heading = (state: FlightState): number => {
    forward.set(0, 0, 1).applyQuaternion(state.orientation);
    return Math.atan2(-forward.x, forward.z); // positive = screen-right (-X)
  };
  const upY = (state: FlightState): number => new Vector3(0, 1, 0).applyQuaternion(state.orientation).y;
  const simulateAssisted = (state: FlightState, controls: FlightInput, seconds: number, strength = 0.6) => {
    let minUpY = 1;
    let maxBank = 0;
    let maxPitch = 0;
    const steps = Math.round(seconds / DT);
    for (let i = 0; i < steps; i += 1) {
      stepFlight(state, controls, DEFAULT_PARAMS, FLAT, DT, { strength });
      minUpY = Math.min(minUpY, upY(state));
      maxBank = Math.max(maxBank, Math.abs(state.bank));
      maxPitch = Math.max(maxPitch, Math.abs(state.pitchAngle));
    }
    return { minUpY, maxBank, maxPitch };
  };

  it('holding roll right banks right up to the limit and never inverts', () => {
    const state = level(90);
    const { minUpY, maxBank } = simulateAssisted(state, input({ roll: 1 }), 4);
    expect(state.bank).toBeGreaterThan(MAX_ASSISTED_BANK - 0.05);
    expect(maxBank).toBeLessThan(MAX_ASSISTED_BANK + 0.05);
    expect(minUpY).toBeGreaterThan(0.2);
  });

  it('a right bank turns right and a left bank turns left', () => {
    const right = level(90);
    simulateAssisted(right, input({ roll: 1 }), 1);
    expect(heading(right)).toBeGreaterThan(0.2);
    const left = level(90);
    simulateAssisted(left, input({ roll: -1 }), 1);
    expect(heading(left)).toBeLessThan(-0.2);
    expect(heading(left)).toBeCloseTo(-heading(right), 1);
  });

  it('half stick gives roughly half the bank', () => {
    const state = level(90);
    simulateAssisted(state, input({ roll: 0.5 }), 4);
    expect(state.bank).toBeGreaterThan(MAX_ASSISTED_BANK * 0.4);
    expect(state.bank).toBeLessThan(MAX_ASSISTED_BANK * 0.6);
  });

  it('releasing the stick levels the wings', () => {
    const state = level(90);
    simulateAssisted(state, input({ roll: 1 }), 2);
    simulateAssisted(state, input(), 3);
    expect(Math.abs(state.bank)).toBeLessThan(0.08);
  });

  it('a sustained banked turn holds altitude within a small band', () => {
    const state = level(90, 300);
    simulateAssisted(state, input({ roll: 0.8 }), 5, ASSIST.strength);
    expect(Math.abs(state.position.y - 300)).toBeLessThan(60);
  });

  it('pulling up for a long time never loops the aircraft', () => {
    const state = level(90);
    const { maxPitch, minUpY } = simulateAssisted(state, input({ pitch: 1 }), 8);
    expect(maxPitch).toBeLessThan(1.1);
    expect(minUpY).toBeGreaterThan(0.3);
    expect(state.position.y).toBeGreaterThan(300);
  });

  it('pushing down is limited symmetrically', () => {
    const state = level(90, 2000);
    const { maxPitch } = simulateAssisted(state, input({ pitch: -1 }), 4);
    expect(maxPitch).toBeLessThan(1.1);
    expect(state.pitchAngle).toBeLessThan(-0.8);
  });

  describe('bank response tuning', () => {
    const FUSELAGES = ['fuselage-needle', 'fuselage-allrounder', 'fuselage-heavy'] as const;
    const paramsFor = (fuselage: string) =>
      flightParametersForBuild(withPart(DEFAULT_BUILD, 'fuselage', fuselage));
    const HEAVY_PARAMS = paramsFor('fuselage-heavy');
    /** Runs assisted flight, calling `each` with the state and elapsed time after every step. */
    const fly = (
      state: FlightState,
      controls: FlightInput,
      seconds: number,
      params: FlightParameters,
      each: (s: FlightState, t: number) => void = () => undefined,
      dt = DT,
    ): void => {
      const steps = Math.round(seconds / dt);
      for (let i = 0; i < steps; i += 1) {
        stepFlight(state, controls, params, FLAT, dt, ASSIST);
        each(state, (i + 1) * dt);
      }
    };
    const timeToHalfBank = (params: FlightParameters, dt = DT): number => {
      let reached = Infinity;
      fly(
        level(90, 2000),
        input({ roll: 1 }),
        1.5,
        params,
        (s, t) => {
          if (reached === Infinity && s.bank > MAX_ASSISTED_BANK / 2) reached = t;
        },
        dt,
      );
      return reached;
    };

    it('turn-in stays quick: half of full bank in under half a second on the default build', () => {
      expect(timeToHalfBank(DEFAULT_PARAMS)).toBeLessThan(0.45);
    });

    it('full stick settles on the bank limit without overshoot on every fuselage', () => {
      for (const fuselage of FUSELAGES) {
        let peak = 0;
        fly(level(90, 2000), input({ roll: 1 }), 3, paramsFor(fuselage), (s) => {
          peak = Math.max(peak, s.bank);
        });
        expect(peak, fuselage).toBeLessThan(MAX_ASSISTED_BANK * 1.01);
      }
    });

    it('releasing a hard turn levels the wings promptly without swinging through level', () => {
      for (const fuselage of FUSELAGES) {
        const params = paramsFor(fuselage);
        const state = level(90, 2000);
        fly(state, input({ roll: 1 }), 2, params);
        let swing = 0;
        let settled = Infinity;
        fly(state, input(), 2, params, (s, t) => {
          swing = Math.max(swing, -s.bank);
          if (Math.abs(s.bank) > 0.05) settled = Infinity;
          else if (settled === Infinity) settled = t;
        });
        expect(swing, fuselage).toBeLessThan(0.03);
        expect(settled, fuselage).toBeLessThan(0.9);
      }
    });

    it('stops turning soon after the stick is released', () => {
      const state = level(90, 2000);
      fly(state, input({ roll: 1 }), 2, DEFAULT_PARAMS);
      const before = heading(state);
      fly(state, input(), 3, DEFAULT_PARAMS);
      // Residual heading change while the wings come back to level.
      expect(Math.abs(heading(state) - before)).toBeLessThan(0.4);
    });

    it('a full reversal settles on the opposite bank without wobble, even on the heavy frame', () => {
      const state = level(90, 2000);
      fly(state, input({ roll: 1 }), 2, HEAVY_PARAMS);
      let peak = 0;
      let lastOutside = 0;
      fly(state, input({ roll: -1 }), 3, HEAVY_PARAMS, (s, t) => {
        peak = Math.max(peak, -s.bank);
        if (Math.abs(s.bank + MAX_ASSISTED_BANK) > 0.05) lastOutside = t;
      });
      expect(peak).toBeLessThan(MAX_ASSISTED_BANK * 1.02);
      expect(lastOutside).toBeLessThan(1.6);
    });

    it('bank response is consistent across simulation step sizes', () => {
      const fine = timeToHalfBank(DEFAULT_PARAMS, 1 / 120);
      const coarse = timeToHalfBank(DEFAULT_PARAMS, 1 / 30);
      expect(Math.abs(fine - coarse)).toBeLessThan(0.05);
    });
  });

  it('with assistance off, roll is a rate and the aircraft can roll inverted', () => {
    const state = level(90);
    const { minUpY } = simulateAssisted(state, input({ roll: 1 }), 3, 0);
    expect(minUpY).toBeLessThan(-0.5);
  });
});
