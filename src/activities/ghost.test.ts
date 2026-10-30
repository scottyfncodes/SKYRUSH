import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createCircuit } from '../course/circuit';
import { COURSES } from '../course/courses';
import { defaultBuildFor } from '../aircraft/build';
import { getAirframe } from '../aircraft/parts';
import { createFlightState } from '../flight/FlightModel';
import { createMemoryStorage } from '../progression/save';
import { ACTIVITIES, type PrecisionActivity, type TrialActivity } from './catalog';
import { createPrecisionCircuit } from './places';
import {
  GhostRecorder,
  GHOST_INTERVAL,
  decodeGhost,
  encodeGhost,
  loadGhost,
  recordClubGhost,
  sampleGhost,
  saveGhost,
} from './ghost';
import { factoryPaint } from '../aircraft/paint';

const sport = defaultBuildFor(getAirframe('airframe-sport')!);

describe('ghost recording', () => {
  it('records at a fixed interval and interpolates between samples', () => {
    const recorder = new GhostRecorder();
    const flight = createFlightState(new Vector3(), new Quaternion(), 50);
    for (let i = 0; i <= 20; i += 1) {
      flight.position.set(i * 5, 100, 0);
      recorder.record(i * GHOST_INTERVAL, flight);
    }
    const track = recorder.finish(2, 'You', null);
    expect(track.samples).toHaveLength(21 * 7);
    const position = new Vector3();
    const orientation = new Quaternion();
    expect(sampleGhost(track, 0.55, position, orientation)).toBe(true);
    expect(position.x).toBeCloseTo(27.5, 5);
    expect(sampleGhost(track, 5, position, orientation)).toBe(false);
    expect(sampleGhost(track, -1, position, orientation)).toBe(false);
  });

  it('round-trips through the compact encoding within a few centimetres', () => {
    const recorder = new GhostRecorder();
    const flight = createFlightState(new Vector3(), new Quaternion(), 50);
    for (let i = 0; i < 50; i += 1) {
      flight.position.set(Math.sin(i) * 300.123, 40 + i * 0.77, i * 12.34);
      flight.orientation.setFromAxisAngle(new Vector3(0, 1, 0), i * 0.1);
      recorder.record(i * GHOST_INTERVAL, flight);
    }
    const setup = { build: sport, paint: factoryPaint(sport.airframe) };
    const track = recorder.finish(4.9, 'You', setup);
    const decoded = decodeGhost(encodeGhost(track))!;
    expect(decoded.time).toBe(4.9);
    expect(decoded.setup).toEqual(setup);
    for (let i = 0; i < track.samples.length; i += 1) {
      expect(Math.abs(decoded.samples[i]! - track.samples[i]!)).toBeLessThan(0.06);
    }
  });

  it('rejects malformed ghosts and survives broken storage', () => {
    expect(decodeGhost('nonsense')).toBeNull();
    expect(decodeGhost(JSON.stringify({ v: 1, time: 3, d: '1,2,3' }))).toBeNull();
    const storage = createMemoryStorage();
    expect(loadGhost(storage, 'caldera-ridge')).toBeNull();
    storage.setItem('skyrush.ghost.v1.caldera-ridge', '{"v":1');
    expect(loadGhost(storage, 'caldera-ridge')).toBeNull();
    const track = { time: 1, label: 'You', setup: null, samples: [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 0, 0, 1] };
    expect(saveGhost(storage, 'caldera-ridge', track)).toBe(true);
    expect(loadGhost(storage, 'caldera-ridge')?.samples).toEqual(track.samples);
    const throwing = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('full');
      },
      removeItem: () => undefined,
    };
    expect(loadGhost(throwing, 'caldera-ridge')).toBeNull();
    expect(saveGhost(throwing, 'caldera-ridge', track)).toBe(false);
  });
});

describe('time trials', () => {
  it('set the club ghost between the silver and bronze times on every course', () => {
    for (const course of COURSES) {
      const trial = ACTIVITIES.find(
        (a): a is TrialActivity => a.kind === 'trial' && a.regionId === course.id,
      )!;
      const ghost = recordClubGhost(createCircuit(course.id), sport);
      expect(ghost.time, course.id).toBeGreaterThan(trial.medals.silver);
      expect(ghost.time, course.id).toBeLessThan(trial.medals.bronze);
      // Penalties add to the time but not to the flying, so allow for a missed gate.
      expect(ghost.samples.length / 7, course.id).toBeGreaterThan((ghost.time - 10) / GHOST_INTERVAL);
    }
  });

  it('leave gold within reach of an upgraded aircraft flown flat out', () => {
    const fast = {
      ...defaultBuildFor(getAirframe('airframe-racer')!),
      engine: 'engine-hornet',
      prop: 'prop-scimitar',
    };
    for (const course of COURSES) {
      const trial = ACTIVITIES.find(
        (a): a is TrialActivity => a.kind === 'trial' && a.regionId === course.id,
      )!;
      const ghost = recordClubGhost(createCircuit(course.id), fast, 1);
      expect(ghost.time, course.id).toBeLessThan(trial.medals.gold + 4);
    }
  });
});

describe('precision circuits', () => {
  const precision = ACTIVITIES.filter((a): a is PrecisionActivity => a.kind === 'precision');

  it('keep every gate and the line between them clear of the terrain', () => {
    for (const activity of precision) {
      const circuit = createPrecisionCircuit(createCircuit(activity.regionId), activity);
      const points = [circuit.spawn.position, ...circuit.gates.map((gate) => gate.position)];
      for (const gate of circuit.gates) {
        for (const side of [-1, 0, 1]) {
          const x = gate.position.x + gate.right.x * gate.halfWidth * side;
          const z = gate.position.z + gate.right.z * gate.halfWidth * side;
          expect(gate.position.y - gate.halfHeight, `${activity.id} gate ${gate.index}`).toBeGreaterThan(
            circuit.terrain.heightAt(x, z) + 3,
          );
        }
      }
      for (let i = 0; i < points.length - 1; i += 1) {
        const a = points[i]!;
        const b = points[i + 1]!;
        for (let t = 0; t <= 1; t += 0.05) {
          const x = a.x + (b.x - a.x) * t;
          const z = a.z + (b.z - a.z) * t;
          const y = a.y + (b.y - a.y) * t;
          expect(y, `${activity.id} leg ${i} at ${t.toFixed(2)}`).toBeGreaterThan(
            circuit.terrain.heightAt(x, z) + 4,
          );
        }
      }
    }
  });

  it('are narrower than race gates, have no rings and start facing the first gate', () => {
    for (const activity of precision) {
      const base = createCircuit(activity.regionId);
      const circuit = createPrecisionCircuit(base, activity);
      expect(circuit.gates).toHaveLength(activity.gates.length);
      expect(circuit.rings).toHaveLength(0);
      expect(circuit.terrain).toBe(base.terrain);
      for (const gate of circuit.gates) expect(gate.halfWidth).toBeLessThan(base.gates[1]!.halfWidth);
      const forward = new Vector3(0, 0, 1).applyQuaternion(circuit.spawn.orientation);
      const toGate = circuit.gates[0]!.position.clone().sub(circuit.spawn.position).normalize();
      expect(forward.dot(toGate)).toBeGreaterThan(0.95);
    }
  });
});
