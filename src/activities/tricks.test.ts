import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createFlightState, stepFlight, NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import { flightParametersForBuild } from '../aircraft/performance';
import { defaultBuildFor } from '../aircraft/build';
import { AIRFRAMES, getAirframe } from '../aircraft/parts';
import { TrickTracker, holdPoints, trickMultiplier, type TrickEvent } from './tricks';

const DT = 1 / 120;
const AEROBATIC = { strength: 0.6, aerobatic: true };
const env = { terrainHeight: () => 0, ceiling: 3000 };

/** Flies `seconds` of a scripted input through the real flight model and the tracker. */
const fly = (
  airframeId: string,
  script: (t: number, state: ReturnType<typeof createFlightState>) => Partial<FlightInput>,
  seconds: number,
  options: { altitude?: number; inBox?: boolean; tracker?: TrickTracker } = {},
) => {
  const params = flightParametersForBuild(defaultBuildFor(getAirframe(airframeId)!));
  const state = createFlightState(new Vector3(0, options.altitude ?? 500, 0), new Quaternion(), 95);
  const tracker = options.tracker ?? new TrickTracker();
  const events: TrickEvent[] = [];
  for (let t = 0; t < seconds; t += DT) {
    stepFlight(state, { ...NEUTRAL_INPUT, ...script(t, state) }, params, env, DT, AEROBATIC);
    tracker.step(state, DT, options.inBox ?? true, events);
  }
  return { state, tracker, events, tricks: events.flatMap((e) => (e.type === 'trick' ? [e.award] : [])) };
};

describe('aerobatic control', () => {
  it('lets every aircraft fly a full loop with the stick held back', () => {
    for (const airframe of AIRFRAMES) {
      const { tricks } = fly(airframe.id, () => ({ pitch: 1 }), 9);
      expect(
        tricks.some((trick) => trick.kind === 'loop'),
        airframe.name,
      ).toBe(true);
    }
  });

  it('lets every aircraft roll through 360° with the stick held over', () => {
    for (const airframe of AIRFRAMES) {
      const { tricks } = fly(airframe.id, () => ({ roll: 1 }), 6);
      expect(
        tricks.some((trick) => trick.kind === 'roll'),
        airframe.name,
      ).toBe(true);
    }
  });

  it('holds inverted flight instead of rolling back upright', () => {
    // Roll half way over, then centre the stick and push to hold the nose up.
    const { state } = fly('airframe-sport', (t) => (t < 1.4 ? { roll: 1 } : { pitch: -0.25 }), 4);
    expect(Math.abs(state.bank)).toBeGreaterThan(2.4);
  });
});

describe('TrickTracker', () => {
  it('scores an inverted pass on the way out and grows the chain', () => {
    // Roll until inverted, hold it with a little forward stick, then roll out.
    let rolledOver = false;
    const { tricks } = fly(
      'airframe-scout',
      (t, state) => {
        if (Math.abs(state.bank) > 2.9) rolledOver = true;
        if (!rolledOver) return { roll: 1 };
        return t < 4 ? { pitch: -0.3 } : { roll: 1 };
      },
      6,
    );
    const inverted = tricks.find((trick) => trick.kind === 'inverted');
    expect(inverted).toBeDefined();
    expect(inverted!.points).toBeGreaterThanOrEqual(holdPoints('inverted', 1.5));
  });

  it('pays nothing for figures outside the show box', () => {
    const { tricks, events, tracker } = fly('airframe-scout', () => ({ pitch: 1 }), 6, { inBox: false });
    expect(tricks).toHaveLength(0);
    expect(events.some((e) => e.type === 'outside-box')).toBe(true);
    expect(tracker.score).toBe(0);
  });

  it('pays a low-show bonus below 50 m and halves a repeated figure', () => {
    const high = fly('airframe-scout', () => ({ roll: 1 }), 5, { altitude: 400 }).tricks;
    const low = fly('airframe-scout', () => ({ roll: 1 }), 5, { altitude: 30 }).tricks;
    expect(low[0]!.low).toBe(true);
    expect(high[0]!.low).toBe(false);
    expect(low[0]!.points).toBeGreaterThan(high[0]!.points);
    // Consecutive rolls: the second is a repeat but sits on a bigger multiplier.
    expect(high[1]!.repeat).toBe(true);
    expect(high[1]!.multiplier).toBe(trickMultiplier(2));
  });

  it('loses the chain after the window and on an interruption', () => {
    const tracker = new TrickTracker();
    fly('airframe-scout', () => ({ roll: 1 }), 4, { tracker });
    expect(tracker.chain).toBeGreaterThanOrEqual(2);
    const events: TrickEvent[] = [];
    tracker.interrupt(events);
    expect(tracker.chain).toBe(0);
    expect(events[0]?.type).toBe('chain-lost');
  });

  it('does not count a level turn or straight flight as anything', () => {
    expect(fly('airframe-sport', () => ({}), 10).tricks).toHaveLength(0);
  });
});
