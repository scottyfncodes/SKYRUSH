import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createCircuit, lookOrientation, type Circuit } from '../course/circuit';
import { defaultBuildFor, type AircraftBuild } from '../aircraft/build';
import { getAirframe } from '../aircraft/parts';
import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import {
  ACTIVITIES,
  DISCOVERIES,
  type DeliveryActivity,
  type ExploreActivity,
  type ShowActivity,
} from './catalog';
import { FreeFlightSimulation, withCargo, type FreeFlightEvent } from './FreeFlightSimulation';
import { HOOK_RADIUS, resolveDiscovery, showFloor } from './places';
import { steerToPoint } from './autopilot';
import { CLEAR_CONDITIONS } from './conditions';
import { flightParametersForBuild } from '../aircraft/performance';

const DT = 1 / 60;
const ASSIST = { strength: 0.6 };
const circuits = new Map<string, Circuit>();
const circuitFor = (id: string): Circuit => {
  let circuit = circuits.get(id);
  if (!circuit) {
    circuit = createCircuit(id);
    circuits.set(id, circuit);
  }
  return circuit;
};
const build = (airframe: string): AircraftBuild => defaultBuildFor(getAirframe(airframe)!);
const deliveries = ACTIVITIES.filter((a): a is DeliveryActivity => a.kind === 'delivery');
const shows = ACTIVITIES.filter((a): a is ShowActivity => a.kind === 'show');

/**
 * Flies a delivery the way the route is meant to be flown: along the valley
 * (the racing line's gates) to each stop, then slow and low over it.
 */
const flyDelivery = (activity: DeliveryActivity, airframe: string, conditions = activity.conditions) => {
  const circuit = circuitFor(activity.regionId);
  const sim = new FreeFlightSimulation(circuit, activity, build(airframe), {
    assist: ASSIST,
    conditions,
    countdownSeconds: 0,
  });
  const input: FlightInput = { ...NEUTRAL_INPUT };
  const events: FreeFlightEvent[] = [];
  let gate = 0;
  for (let t = 0; t < 400 && sim.phase !== 'finished'; t += DT) {
    const stopSpec = activity.stops[sim.nextStop]!;
    const stop = sim.currentStop!;
    const p = sim.flight.position;
    // Follow the gates up to the stop's segment, then head for the stop itself.
    while (gate <= stopSpec.after) {
      const g = circuit.gates[gate]!.position;
      if (Math.hypot(g.x - p.x, g.z - p.z) > 140) break;
      gate += 1;
    }
    const viaGate = gate <= stopSpec.after ? circuit.gates[gate]!.position : null;
    const distance = Math.hypot(p.x - stop.position.x, p.z - stop.position.z);
    const approach = !viaGate && distance < 650;
    const hookSpeed = Math.max(activity.hookSpeedKmh / 3.6 - 6, sim.params.stallSpeed * 1.25);
    const target = viaGate
      ? { x: viaGate.x, y: viaGate.y, z: viaGate.z }
      : { x: stop.position.x, y: stop.position.y + (approach ? 20 : 50), z: stop.position.z };
    steerToPoint(
      sim.flight,
      sim.params,
      circuit.terrain.heightAt,
      target,
      approach ? hookSpeed : sim.params.maxSpeed * 0.75,
      input,
    );
    sim.step(DT, input);
    events.push(...sim.drainEvents());
  }
  return { sim, events, result: sim.result() };
};

describe('delivery activities', () => {
  it('can be completed with the bush plane in good condition', () => {
    for (const activity of deliveries) {
      const { result, events } = flyDelivery(activity, 'airframe-bush');
      expect(result.completed, activity.id).toBe(true);
      expect(result.condition, activity.id).toBeGreaterThan(activity.condition.silver);
      expect(result.time, activity.id).toBeLessThan(activity.medals.bronze);
      expect(events.filter((e) => e.type === 'hook')).toHaveLength(activity.stops.length);
    }
  });

  it('can be completed with the starter aircraft', () => {
    for (const activity of deliveries) {
      expect(flyDelivery(activity, 'airframe-sport').result.completed, activity.id).toBe(true);
    }
  });

  it('refuses a hook pass that is too fast and says by how much', () => {
    const activity = deliveries[0]!;
    const circuit = circuitFor(activity.regionId);
    const sim = new FreeFlightSimulation(circuit, activity, build('airframe-racer'), {
      assist: ASSIST,
      conditions: CLEAR_CONDITIONS,
      countdownSeconds: 0,
    });
    const stop = sim.currentStop!;
    sim.flight.position.set(stop.position.x, stop.position.y + 20, stop.position.z - HOOK_RADIUS - 5);
    sim.flight.velocity.set(0, 0, 90);
    sim.previousPosition.copy(sim.flight.position);
    const events: FreeFlightEvent[] = [];
    for (let i = 0; i < 60; i += 1) {
      sim.step(DT, { ...NEUTRAL_INPUT, throttle: 1 });
      events.push(...sim.drainEvents());
    }
    const miss = events.find((e) => e.type === 'hook-miss');
    expect(miss).toMatchObject({ reason: 'fast' });
    expect(sim.carrying).toBe(false);
  });

  it('makes cargo heavier and raises the stall speed', () => {
    const params = flightParametersForBuild(build('airframe-sport'));
    const loaded = withCargo(params, 420);
    expect(loaded.mass).toBe(params.mass + 420);
    expect(loaded.stallSpeed).toBeGreaterThan(params.stallSpeed * 1.1);
    expect(loaded.responsiveness).toBeLessThan(params.responsiveness);
  });

  it('damages fragile cargo in steep banks', () => {
    const activity = deliveries.find((a) => a.cargo.bankLimit <= 40)!;
    const circuit = circuitFor(activity.regionId);
    const sim = new FreeFlightSimulation(circuit, activity, build('airframe-bush'), {
      assist: { strength: 0 },
      conditions: CLEAR_CONDITIONS,
      countdownSeconds: 0,
    });
    sim.carrying = true;
    sim.flight.position.y += 300;
    for (let i = 0; i < 120; i += 1) sim.step(DT, { ...NEUTRAL_INPUT, roll: 1, throttle: 1 });
    expect(sim.condition).toBeLessThan(95);
  });
});

describe('air shows', () => {
  it('put the show box over open, low ground', () => {
    for (const activity of shows) {
      const circuit = circuitFor(activity.regionId);
      const floor = showFloor(circuit, activity);
      const { x, z, half } = activity.box;
      for (let dx = -0.7; dx <= 0.7; dx += 0.35) {
        for (let dz = -0.7; dz <= 0.7; dz += 0.35) {
          const ground = circuit.terrain.heightAt(x + dx * half, z + dz * half);
          expect(ground - floor, `${activity.id} ${dx},${dz}`).toBeLessThan(90);
        }
      }
    }
  });

  it('time out after the display and score figures flown in the box', () => {
    const activity = shows[0]!;
    const circuit = circuitFor(activity.regionId);
    const sim = new FreeFlightSimulation(circuit, activity, build('airframe-scout'), {
      assist: { strength: 0.6, aerobatic: true },
      conditions: CLEAR_CONDITIONS,
      countdownSeconds: 0,
    });
    // Start over the middle of the box at a safe height and loop and roll repeatedly.
    sim.flight.position.set(activity.box.x, showFloor(circuit, activity) + 260, activity.box.z - 200);
    sim.previousPosition.copy(sim.flight.position);
    for (let t = 0; t < activity.duration + 2; t += DT) {
      const phase = t % 9;
      sim.step(DT, { ...NEUTRAL_INPUT, pitch: phase < 4.5 ? 1 : 0, roll: phase >= 5 ? 1 : 0 });
    }
    const result = sim.result();
    expect(sim.phase).toBe('finished');
    expect(result.completed).toBe(true);
    expect(result.figures).toBeGreaterThan(5);
    expect(result.score).toBeGreaterThan(activity.medals.bronze);
  });
});

describe('discoveries', () => {
  it('sit on the rendered terrain inside the region bounds', () => {
    for (const spec of DISCOVERIES) {
      const circuit = circuitFor(spec.regionId);
      const resolved = resolveDiscovery(circuit, spec);
      expect(Math.hypot(resolved.position.x, resolved.position.z), spec.id).toBeLessThan(
        circuit.bounds * 0.8,
      );
      expect(Math.abs(resolved.position.x - circuit.center.x), spec.id).toBeLessThan(3600);
      expect(Math.abs(resolved.position.z - circuit.center.z), spec.id).toBeLessThan(3600);
      for (const ring of resolved.rings) {
        const ground = circuit.terrain.heightAt(ring.position.x, ring.position.z);
        expect(ring.position.y - ring.radius, spec.id).toBeGreaterThan(ground + 8);
      }
    }
  });

  it('are found by flying to them, once each', () => {
    const regions = new Set(DISCOVERIES.map((d) => d.regionId));
    for (const regionId of regions) {
      const circuit = circuitFor(regionId);
      const activity = ACTIVITIES.find(
        (a): a is ExploreActivity => a.kind === 'explore' && a.regionId === regionId,
      )!;
      const sim = new FreeFlightSimulation(circuit, activity, build('airframe-sport'), {
        assist: ASSIST,
        conditions: CLEAR_CONDITIONS,
      });
      const found: string[] = [];
      for (const discovery of sim.discoveries) {
        const points: { position: Vector3; normal?: Vector3 }[] =
          discovery.rings.length > 0 ? discovery.rings : [{ position: discovery.position }];
        for (const point of points) {
          // Put the aircraft just short of the point, aimed through it, and let it fly.
          const target = point.position.clone();
          if (discovery.rings.length === 0) target.y += 60;
          const direction = point.normal ?? new Vector3(0, 0, 1);
          sim.flight.position.copy(target).addScaledVector(direction, -40);
          sim.previousPosition.copy(sim.flight.position);
          lookOrientation(sim.flight.position, target, sim.flight.orientation);
          sim.flight.velocity.copy(direction).multiplyScalar(70);
          for (let i = 0; i < 90; i += 1) {
            sim.step(DT, { ...NEUTRAL_INPUT, throttle: 0.7 });
            for (const event of sim.drainEvents()) if (event.type === 'discovery') found.push(event.id);
          }
        }
      }
      expect(found.sort(), regionId).toEqual(
        DISCOVERIES.filter((d) => d.regionId === regionId)
          .map((d) => d.id)
          .sort(),
      );
      expect(sim.result().discoveries).toHaveLength(5);
    }
  });

  it('are not reported again when already in the log', () => {
    const spec = DISCOVERIES[0]!;
    const circuit = circuitFor(spec.regionId);
    const activity = ACTIVITIES.find(
      (a): a is ExploreActivity => a.kind === 'explore' && a.regionId === spec.regionId,
    )!;
    const sim = new FreeFlightSimulation(circuit, activity, build('airframe-sport'), {
      assist: ASSIST,
      conditions: CLEAR_CONDITIONS,
      discovered: new Set([spec.id]),
    });
    expect(sim.undiscovered.some((d) => d.spec.id === spec.id)).toBe(false);
    sim.endFlight();
    expect(sim.result()).toMatchObject({ completed: true, discoveries: [] });
  });
});
