import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { AI_PERSONALITIES, computeAiInput, computeCruiseInput, difficultyMultiplier } from './AiPilot';
import { createCircuit } from '../course/circuit';
import { isValidBuild } from '../aircraft/build';
import { flightParametersForBuild } from '../aircraft/performance';
import { NEUTRAL_INPUT, createFlightState, type FlightInput } from '../flight/FlightModel';
import { RaceSimulation, type RacerConfig } from '../race/RaceSimulation';

const circuit = createCircuit();
const IDLE: FlightInput = { ...NEUTRAL_INPUT, throttle: 0 };

const playerConfig: RacerConfig = {
  id: 'player',
  name: 'Player',
  callsign: 'YOU',
  isPlayer: true,
  build: AI_PERSONALITIES[0]!.build,
};

const expectInputInRange = (input: FlightInput): void => {
  expect(input.pitch).toBeGreaterThanOrEqual(-1);
  expect(input.pitch).toBeLessThanOrEqual(1);
  expect(input.roll).toBeGreaterThanOrEqual(-1);
  expect(input.roll).toBeLessThanOrEqual(1);
  expect(input.yaw).toBeGreaterThanOrEqual(-1);
  expect(input.yaw).toBeLessThanOrEqual(1);
  expect(input.throttle).toBeGreaterThanOrEqual(0);
  expect(input.throttle).toBeLessThanOrEqual(1);
  expect(typeof input.boost).toBe('boolean');
  expect(typeof input.airbrake).toBe('boolean');
};

describe('AI_PERSONALITIES', () => {
  it('has three distinct personalities with valid builds', () => {
    expect(AI_PERSONALITIES).toHaveLength(3);
    expect(new Set(AI_PERSONALITIES.map((p) => p.id)).size).toBe(3);
    expect(new Set(AI_PERSONALITIES.map((p) => p.style)).size).toBe(3);
    for (const personality of AI_PERSONALITIES) {
      expect(isValidBuild(personality.build)).toBe(true);
      expect(personality.skill).toBeGreaterThan(0);
      expect(personality.skill).toBeLessThanOrEqual(1);
    }
  });
});

describe('difficultyMultiplier', () => {
  it('is clamped to [0.78, 1] and rises with wins', () => {
    expect(difficultyMultiplier(0)).toBe(0.78);
    expect(difficultyMultiplier(-5)).toBe(0.78);
    expect(difficultyMultiplier(2)).toBeCloseTo(0.868, 10);
    expect(difficultyMultiplier(5)).toBe(1);
    expect(difficultyMultiplier(100)).toBe(1);
    for (let wins = 0; wins < 20; wins += 1) {
      expect(difficultyMultiplier(wins)).toBeGreaterThanOrEqual(0.78);
      expect(difficultyMultiplier(wins)).toBeLessThanOrEqual(1);
      expect(difficultyMultiplier(wins + 1)).toBeGreaterThanOrEqual(difficultyMultiplier(wins));
    }
  });
});

describe('computeAiInput', () => {
  it('returns bounded inputs and writes into the supplied object', () => {
    for (const personality of AI_PERSONALITIES) {
      const params = flightParametersForBuild(personality.build);
      const state = createFlightState(circuit.spawn.position, circuit.spawn.orientation, 60);
      const out: FlightInput = { ...NEUTRAL_INPUT };
      const result = computeAiInput(state, params, circuit, 0, personality, out);
      expect(result).toBe(out);
      expectInputInRange(out);
    }
  });

  it('steers toward the next gate', () => {
    const personality = AI_PERSONALITIES[0]!;
    const params = flightParametersForBuild(personality.build);
    const gate = circuit.gates[0]!;
    const out: FlightInput = { ...NEUTRAL_INPUT };
    // Start left of the gate, facing +Z: the gate is to the right so the pilot banks right.
    const left = createFlightState(
      gate.position.clone().add(new Vector3(-300, 0, -600)),
      new Quaternion(),
      70,
    );
    computeAiInput(left, params, circuit, 0, personality, out);
    expect(out.roll).toBeGreaterThan(0);
    expect(out.yaw).toBeGreaterThan(0);
    // Mirror.
    const right = createFlightState(
      gate.position.clone().add(new Vector3(300, 0, -600)),
      new Quaternion(),
      70,
    );
    computeAiInput(right, params, circuit, 0, personality, out);
    expect(out.roll).toBeLessThan(0);
    expect(out.yaw).toBeLessThan(0);
    // Below the gate: pitch up.
    const low = createFlightState(gate.position.clone().add(new Vector3(0, -40, -600)), new Quaternion(), 70);
    computeAiInput(low, params, circuit, 0, personality, out);
    expect(out.pitch).toBeGreaterThan(0);
  });

  it('pulls up when the terrain ahead is close', () => {
    const personality = AI_PERSONALITIES[0]!;
    const params = flightParametersForBuild(personality.build);
    const out: FlightInput = { ...NEUTRAL_INPUT };
    const ground = circuit.terrain.heightAt(circuit.spawn.position.x, circuit.spawn.position.z);
    const low = createFlightState(
      new Vector3(circuit.spawn.position.x, ground + 10, circuit.spawn.position.z),
      circuit.spawn.orientation,
      70,
    );
    computeAiInput(low, params, circuit, 0, personality, out);
    expect(out.pitch).toBeGreaterThanOrEqual(0.5);
    expect(out.boost).toBe(false);
  });

  it('goes to full throttle when stalled', () => {
    const personality = AI_PERSONALITIES[1]!;
    const params = flightParametersForBuild(personality.build);
    const state = createFlightState(circuit.spawn.position, circuit.spawn.orientation, 20);
    state.stalled = true;
    const out: FlightInput = { ...NEUTRAL_INPUT };
    computeAiInput(state, params, circuit, 0, personality, out);
    expect(out.throttle).toBe(1);
    expect(out.airbrake).toBe(false);
  });

  it('lower skill multiplier lowers the throttle ceiling', () => {
    const personality = AI_PERSONALITIES[0]!;
    const params = flightParametersForBuild(personality.build);
    // Far behind the start gate on the centre line: a straight with no braking zone.
    const state = createFlightState(
      circuit.gates[0]!.position.clone().add(new Vector3(0, 0, -800)),
      circuit.spawn.orientation,
      90,
    );
    const full: FlightInput = { ...NEUTRAL_INPUT };
    const reduced: FlightInput = { ...NEUTRAL_INPUT };
    computeAiInput(state, params, circuit, 0, personality, full, 1);
    computeAiInput(state, params, circuit, 0, personality, reduced, 0.78);
    expect(reduced.throttle).toBeLessThan(full.throttle);
    expect(reduced.boost).toBe(false);
  });

  it('is deterministic for the same state', () => {
    const personality = AI_PERSONALITIES[2]!;
    const params = flightParametersForBuild(personality.build);
    const state = createFlightState(circuit.spawn.position, circuit.spawn.orientation, 60);
    const a: FlightInput = { ...NEUTRAL_INPUT };
    const b: FlightInput = { ...NEUTRAL_INPUT };
    computeAiInput(state, params, circuit, 3, personality, a);
    computeAiInput(state, params, circuit, 3, personality, b);
    expect(a).toEqual(b);
  });
});

describe('computeCruiseInput', () => {
  it('climbs when below the safe altitude and lets assisted steering level the wings', () => {
    const ground = circuit.terrain.heightAt(0, 0);
    const state = createFlightState(new Vector3(0, ground + 20, 0), new Quaternion(), 60);
    state.bank = 0.5;
    const out: FlightInput = { ...NEUTRAL_INPUT };
    computeCruiseInput(state, circuit, out);
    expect(out.pitch).toBeGreaterThan(0);
    // Under assisted steering a zero roll command is a "wings level" command.
    expect(out.roll).toBe(0);
    expect(out.boost).toBe(false);
    expect(out.airbrake).toBe(false);
    expect(out.yaw).toBe(0);
    expectInputInRange(out);
  });

  it('descends gently when far above the safe altitude', () => {
    const state = createFlightState(new Vector3(0, 800, 0), new Quaternion(), 60);
    const out: FlightInput = { ...NEUTRAL_INPUT };
    computeCruiseInput(state, circuit, out);
    expect(out.pitch).toBeLessThan(0);
  });
});

describe('AI gate progression', () => {
  it('every personality passes the first 3 gates within 40 s of the start without crashing', () => {
    const configs: RacerConfig[] = [
      playerConfig,
      ...AI_PERSONALITIES.map((ai) => ({
        id: ai.id,
        name: ai.name,
        callsign: ai.callsign,
        isPlayer: false,
        build: ai.build,
        ai,
      })),
    ];
    const race = new RaceSimulation(circuit, configs, { countdownSeconds: 0 });
    const dt = 1 / 120;
    race.step(dt, IDLE); // consume the (zero) countdown
    expect(race.phase).toBe('racing');
    while (race.clock < 40 && race.racers.some((racer) => racer.config.ai && racer.gatesPassed < 3)) {
      race.step(dt, IDLE);
    }
    for (const racer of race.racers) {
      if (!racer.config.ai) continue;
      expect(racer.gatesPassed, racer.config.id).toBeGreaterThanOrEqual(3);
      expect(racer.crashes, racer.config.id).toBe(0);
      expect(racer.missedGates, racer.config.id).toBe(0);
      expect(racer.splitTimes[2]!, racer.config.id).toBeLessThan(40);
    }
  });
});
