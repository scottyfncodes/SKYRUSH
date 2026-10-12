import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { BOOST_REWARD, RaceSimulation, type RaceEvent, type Racer, type RacerConfig } from './RaceSimulation';
import { createCircuit, lookOrientation, RING_RADIUS } from '../course/circuit';
import { gateCrossingOffset, testRingCrossing, type GateDefinition } from '../course/gates';
import { DEFAULT_BUILD } from '../aircraft/build';
import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import { STYLE_POINTS } from '../style/StyleTracker';

const circuit = createCircuit();
const DT = 1 / 120;
const IDLE: FlightInput = { ...NEUTRAL_INPUT, throttle: 0 };
const CRUISE: FlightInput = { ...NEUTRAL_INPUT };

const player: RacerConfig = {
  id: 'player',
  name: 'P',
  callsign: 'YOU',
  isPlayer: true,
  build: DEFAULT_BUILD,
};

const soloRace = (): RaceSimulation => {
  const race = new RaceSimulation(circuit, [player], { countdownSeconds: 0 });
  race.step(DT, IDLE);
  race.drainEvents();
  return race;
};

const place = (racer: Racer, position: Vector3, direction: Vector3, speed = 80): void => {
  const orientation = lookOrientation(position, position.clone().add(direction), new Quaternion());
  racer.flight.position.copy(position);
  racer.flight.orientation.copy(orientation);
  racer.flight.velocity.copy(direction).normalize().multiplyScalar(speed);
  racer.flight.speed = speed;
  racer.flight.rates.set(0, 0, 0);
  racer.previousPosition.copy(position);
};

const placeBeforeGate = (racer: Racer, gate: GateDefinition, right = 0, up = 0): void => {
  const position = gate.position
    .clone()
    .addScaledVector(gate.normal, -0.3)
    .addScaledVector(gate.right, right);
  position.y += up;
  place(racer, position, gate.normal);
};

const run = (race: RaceSimulation, seconds: number, input: FlightInput): RaceEvent[] => {
  const events: RaceEvent[] = [];
  for (let i = 0; i < Math.round(seconds / DT); i += 1) {
    race.step(DT, input);
    events.push(...race.drainEvents());
  }
  return events;
};

const styleEvents = (events: RaceEvent[]) =>
  events.filter((e): e is Extract<RaceEvent, { type: 'style' }> => e.type === 'style');

describe('gate geometry helpers', () => {
  const gate = circuit.gates[3]!;
  const crossing = (right: number, up: number) => {
    const from = gate.position.clone().addScaledVector(gate.normal, -1).addScaledVector(gate.right, right);
    from.y += up;
    return [from, from.clone().addScaledVector(gate.normal, 2)] as const;
  };

  it('gateCrossingOffset is 0 at the centre, 1 on the frame and null when not crossing forward', () => {
    expect(gateCrossingOffset(gate, ...crossing(0, 0))).toBeCloseTo(0, 5);
    expect(gateCrossingOffset(gate, ...crossing(gate.halfWidth, 0))).toBeCloseTo(1, 5);
    expect(gateCrossingOffset(gate, ...crossing(0, gate.halfHeight))).toBeCloseTo(1, 5);
    const [a, b] = crossing(0, 0);
    expect(gateCrossingOffset(gate, b, a)).toBeNull();
  });

  it('testRingCrossing needs the forward direction and the ring radius', () => {
    const ring = circuit.rings[0]!;
    const before = ring.position.clone().addScaledVector(ring.normal, -1);
    const after = ring.position.clone().addScaledVector(ring.normal, 1);
    expect(testRingCrossing(ring, before, after)).toBe(true);
    expect(testRingCrossing(ring, after, before)).toBe(false);
    const wide = new Vector3(0, ring.radius + 0.5, 0);
    expect(testRingCrossing(ring, before.clone().add(wide), after.clone().add(wide))).toBe(false);
  });
});

describe('bonus ring placement', () => {
  it('places six rings low over the terrain but never inside it', () => {
    expect(circuit.rings).toHaveLength(6);
    for (const ring of circuit.rings) {
      const ground = circuit.terrain.heightAt(ring.position.x, ring.position.z);
      const clearance = ring.position.y - ground;
      // Low enough to be a real dive, high enough that the bottom of the ring clears the ground.
      expect(clearance).toBeGreaterThanOrEqual(RING_RADIUS + 2);
      expect(clearance).toBeLessThanOrEqual(20);
      expect(ring.normal.y).toBe(0);
    }
  });

  it('every ring has a clear straight line from the previous gate and to the next gate', () => {
    const specs = circuit.rings.map((ring) => {
      // Find the gate segment the ring belongs to (the closest segment midpoint).
      let best = 0;
      let bestDistance = Infinity;
      for (let i = 0; i < circuit.gates.length - 1; i += 1) {
        const mid = circuit.gates[i]!.position.clone().lerp(circuit.gates[i + 1]!.position, 0.5);
        const d = Math.hypot(mid.x - ring.position.x, mid.z - ring.position.z);
        if (d < bestDistance) {
          bestDistance = d;
          best = i;
        }
      }
      return { ring, from: circuit.gates[best]!.position, to: circuit.gates[best + 1]!.position };
    });
    for (const { ring, from, to } of specs) {
      for (const [a, b] of [
        [from, ring.position],
        [ring.position, to],
      ] as const) {
        for (let t = 0.05; t <= 0.95; t += 0.05) {
          const p = a.clone().lerp(b, t);
          expect(p.y - circuit.terrain.heightAt(p.x, p.z)).toBeGreaterThan(6);
        }
      }
    }
  });
});

describe('style scoring in the race', () => {
  it('a dead-centre gate pass is a perfect gate that refunds boost', () => {
    const race = soloRace();
    race.player.flight.boostEnergy = 0.5;
    placeBeforeGate(race.player, circuit.gates[0]!);
    const events = styleEvents(run(race, 0.1, CRUISE));
    expect(events.map((e) => e.award.kind)).toEqual(['perfect-gate']);
    expect(events[0]!.gate).toBe(0);
    expect(race.style.perfectGates).toBe(1);
    expect(race.player.flight.boostEnergy).toBeGreaterThanOrEqual(0.5 + BOOST_REWARD.perfectGate - 0.01);
  });

  it('an edge pass scores a normal gate and does not grow the chain', () => {
    const race = soloRace();
    const gate = circuit.gates[0]!;
    placeBeforeGate(race.player, gate, gate.halfWidth - 3);
    const events = styleEvents(run(race, 0.1, CRUISE));
    expect(events.map((e) => e.award.kind)).toEqual(['gate']);
    expect(events[0]!.award.points).toBe(STYLE_POINTS.gate);
    expect(race.style.chain).toBe(0);
  });

  it('a missed gate breaks the combo', () => {
    const race = soloRace();
    race.style.award('ring');
    race.style.award('ring');
    const gate = circuit.gates[0]!;
    placeBeforeGate(race.player, gate, gate.halfWidth + 20);
    const events = run(race, 0.1, CRUISE);
    const broken = events.find((e) => e.type === 'combo-break');
    expect(broken).toMatchObject({ combo: { reason: 'missed-gate', chain: 2 } });
    expect(race.style.chain).toBe(0);
  });

  it('flying through a bonus ring scores once and refills boost', () => {
    const race = soloRace();
    const ring = circuit.rings[0]!;
    race.player.flight.boostEnergy = 0.2;
    place(race.player, ring.position.clone().addScaledVector(ring.normal, -0.5), ring.normal);
    const events = styleEvents(run(race, 0.1, CRUISE));
    expect(events.map((e) => e.award.kind)).toEqual(['ring']);
    expect(events[0]!.ring).toBe(0);
    expect(race.player.flight.boostEnergy).toBeGreaterThanOrEqual(0.2 + BOOST_REWARD.ring - 0.01);
    // Flying back through the same ring pays nothing.
    place(race.player, ring.position.clone().addScaledVector(ring.normal, -0.5), ring.normal);
    expect(styleEvents(run(race, 0.1, CRUISE))).toHaveLength(0);
    expect(race.style.rings).toBe(1);
  });

  it('a low pass over the valley floor that climbs back out is a near miss', () => {
    const race = soloRace();
    const flight = race.player.flight;
    // Start high over the first straight, heading along +Z.
    const start = new Vector3(0, 0, -100);
    start.y = circuit.terrain.heightAt(start.x, start.z) + 40;
    place(race.player, start, new Vector3(0, 0, 1), 90);
    run(race, 0.05, CRUISE);
    // Teleport into the band, hold it briefly, then climb out.
    const low = flight.position.clone();
    low.y = circuit.terrain.heightAt(low.x, low.z) + 5;
    place(race.player, low, new Vector3(0, 0, 1), 90);
    let events = run(race, 0.3, CRUISE);
    const high = flight.position.clone();
    high.y = circuit.terrain.heightAt(high.x, high.z) + 40;
    place(race.player, high, new Vector3(0, 0, 1), 90);
    events = events.concat(run(race, 0.05, CRUISE));
    expect(styleEvents(events).map((e) => e.award.kind)).toContain('near-miss');
    expect(race.style.nearMisses).toBe(1);
  });

  it('a crash breaks the combo and a fresh simulation starts with clean style state', () => {
    const race = soloRace();
    race.style.award('overtake');
    race.style.award('overtake');
    const flight = race.player.flight;
    const position = new Vector3(0, 0, 0);
    position.y = circuit.terrain.heightAt(0, 0) + 3;
    place(race.player, position, new Vector3(0, -1, 0.3), 80);
    const events = run(race, 0.2, CRUISE);
    expect(events.some((e) => e.type === 'crash')).toBe(true);
    expect(events.find((e) => e.type === 'combo-break')).toMatchObject({ combo: { reason: 'crash' } });
    expect(flight.speed).toBe(0);

    const restarted = soloRace();
    expect(restarted.style.score).toBe(0);
    expect(restarted.style.chain).toBe(0);
    expect(restarted.style.rings).toBe(0);
  });

  it('passing an opponent scores an overtake, rate limited per opponent', () => {
    const ai: RacerConfig = { ...player, id: 'ai', isPlayer: false };
    const race = new RaceSimulation(circuit, [player, ai], { countdownSeconds: 0 });
    race.step(DT, IDLE);
    race.drainEvents();
    const [me, rival] = race.racers as [Racer, Racer];
    const leap = () => {
      // Put the player well along the course ahead of the rival.
      me.nextGate = 2;
      placeBeforeGate(me, circuit.gates[2]!, 0, -40);
    };
    const fallBack = () => {
      me.nextGate = 0;
      place(me, circuit.spawn.position.clone().add(new Vector3(0, 0, -200)), new Vector3(0, 0, 1));
    };
    rival.nextGate = 1;
    placeBeforeGate(rival, circuit.gates[1]!, 0, -40);
    fallBack();
    run(race, 0.05, IDLE);
    leap();
    const first = styleEvents(run(race, 0.05, IDLE)).filter((e) => e.award.kind === 'overtake');
    expect(first).toHaveLength(1);
    fallBack();
    run(race, 0.05, IDLE);
    leap();
    const second = styleEvents(run(race, 0.05, IDLE)).filter((e) => e.award.kind === 'overtake');
    expect(second).toHaveLength(0);
    expect(race.style.overtakes).toBe(1);
  });

  it('AI racers never generate style events', () => {
    const ai: RacerConfig = { ...player, id: 'ai', isPlayer: false };
    const race = new RaceSimulation(circuit, [player, ai], { countdownSeconds: 0 });
    race.step(DT, IDLE);
    race.drainEvents();
    placeBeforeGate(race.racers[1]!, circuit.gates[0]!);
    // The player idles far from any gate.
    const events = run(race, 0.1, IDLE);
    expect(events.some((e) => e.type === 'gate' && !e.isPlayer)).toBe(true);
    expect(styleEvents(events)).toHaveLength(0);
  });
});
