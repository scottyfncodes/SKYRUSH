import { describe, expect, it } from 'vitest';
import { Euler, Quaternion, Vector3 } from 'three';
import { RaceSimulation, type RaceEvent, type Racer, type RacerConfig } from './RaceSimulation';
import { createCircuit, lookOrientation } from '../course/circuit';
import type { GateDefinition } from '../course/gates';
import { AI_PERSONALITIES } from '../ai/AiPilot';
import { DEFAULT_BUILD, defaultBuildFor } from '../aircraft/build';
import { getAirframe } from '../aircraft/parts';
import { flightParametersForBuild } from '../aircraft/performance';
import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';

const circuit = createCircuit();
const DT = 1 / 120;
const IDLE: FlightInput = { ...NEUTRAL_INPUT, throttle: 0 };
const CRUISE: FlightInput = { ...NEUTRAL_INPUT };

const playerConfig: RacerConfig = {
  id: 'player',
  name: 'Player',
  callsign: 'YOU',
  isPlayer: true,
  build: DEFAULT_BUILD,
};

const aiConfigs = (): RacerConfig[] =>
  AI_PERSONALITIES.map((ai) => ({
    id: ai.id,
    name: ai.name,
    callsign: ai.callsign,
    isPlayer: false,
    build: ai.build,
    ai,
  }));

const fullGrid = (): RacerConfig[] => [playerConfig, ...aiConfigs()];

/** A race already in the 'racing' phase with the player alone on the grid. */
const soloRace = (): RaceSimulation => {
  const race = new RaceSimulation(circuit, [playerConfig], { countdownSeconds: 0 });
  race.step(DT, IDLE);
  expect(race.phase).toBe('racing');
  race.drainEvents();
  return race;
};

/**
 * Teleports the racer to just behind a gate's plane, flying along its normal at 80 m/s,
 * optionally offset along the gate's right vector and vertically.
 */
const placeBeforeGate = (racer: Racer, gate: GateDefinition, right = 0, up = 0): void => {
  const position = gate.position
    .clone()
    .addScaledVector(gate.normal, -0.3)
    .addScaledVector(gate.right, right);
  position.y += up;
  const ahead = position.clone().add(gate.normal);
  const orientation = lookOrientation(position, ahead, new Quaternion());
  racer.flight.position.copy(position);
  racer.flight.orientation.copy(orientation);
  racer.flight.velocity.copy(gate.normal).multiplyScalar(80);
  racer.flight.speed = 80;
  racer.flight.rates.set(0, 0, 0);
  racer.previousPosition.copy(position);
};

const run = (race: RaceSimulation, seconds: number, input: FlightInput): RaceEvent[] => {
  const events: RaceEvent[] = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i += 1) {
    race.step(DT, input);
    events.push(...race.drainEvents());
  }
  return events;
};

const forwardOf = (racer: Racer): Vector3 => new Vector3(0, 0, 1).applyQuaternion(racer.flight.orientation);

describe('construction and countdown', () => {
  it('requires exactly one player', () => {
    expect(() => new RaceSimulation(circuit, aiConfigs())).toThrow();
  });

  it('starts in countdown with clock 0 and all counters zero (restart semantics)', () => {
    const race = new RaceSimulation(circuit, fullGrid());
    expect(race.phase).toBe('countdown');
    expect(race.clock).toBe(0);
    expect(race.countdown).toBe(3);
    expect(race.racers).toHaveLength(4);
    expect(race.player.config.id).toBe('player');
    expect(race.gateCount).toBe(circuit.gates.length);
    for (const racer of race.racers) {
      expect(racer.nextGate).toBe(0);
      expect(racer.gatesPassed).toBe(0);
      expect(racer.missedGates).toBe(0);
      expect(racer.crashes).toBe(0);
      expect(racer.penaltySeconds).toBe(0);
      expect(racer.finished).toBe(false);
      expect(racer.finishTime).toBe(0);
      expect(racer.splitTimes).toEqual([]);
      expect(racer.flight.speed).toBe(circuit.spawn.speed);
    }
    expect(race.drainEvents()).toEqual([]);
    // Grid slots are distinct.
    const positions = race.racers.map((racer) => racer.flight.position.toArray().join(','));
    expect(new Set(positions).size).toBe(4);
  });

  it('emits countdown 3, 2, 1 then go and enters racing with clock 0', () => {
    const race = new RaceSimulation(circuit, fullGrid());
    const events: RaceEvent[] = [];
    let goStep = -1;
    for (let i = 0; i < 120 * 4; i += 1) {
      race.step(DT, IDLE);
      for (const event of race.drainEvents()) {
        events.push(event);
        if (event.type === 'go') goStep = i;
      }
      if (goStep >= 0) break;
    }
    expect(events).toEqual([
      { type: 'countdown', value: 3 },
      { type: 'countdown', value: 2 },
      { type: 'countdown', value: 1 },
      { type: 'go' },
    ]);
    expect(race.phase).toBe('racing');
    expect(race.clock).toBe(0);
    expect(goStep).toBeGreaterThanOrEqual(359);
    expect(goStep).toBeLessThanOrEqual(361);
    // Nobody moved during the countdown.
    for (const racer of race.racers) {
      expect(racer.gatesPassed).toBe(0);
      expect(racer.flight.position.z).toBeLessThanOrEqual(circuit.spawn.position.z);
    }
  });

  it('pausing (not stepping) leaves the state unchanged', () => {
    const race = new RaceSimulation(circuit, fullGrid(), { countdownSeconds: 0 });
    run(race, 5, CRUISE);
    const clock = race.clock;
    const snapshot = race.racers.map((racer) => ({
      position: racer.flight.position.toArray(),
      velocity: racer.flight.velocity.toArray(),
      gates: racer.gatesPassed,
    }));
    race.drainEvents();
    race.getStandings();
    expect(race.clock).toBe(clock);
    race.racers.forEach((racer, index) => {
      expect(racer.flight.position.toArray()).toEqual(snapshot[index]!.position);
      expect(racer.flight.velocity.toArray()).toEqual(snapshot[index]!.velocity);
      expect(racer.gatesPassed).toBe(snapshot[index]!.gates);
    });
    // Restart: a fresh simulation is back at the beginning.
    const restarted = new RaceSimulation(circuit, fullGrid());
    expect(restarted.phase).toBe('countdown');
    expect(restarted.clock).toBe(0);
    expect(restarted.racers.every((racer) => racer.gatesPassed === 0 && racer.progress === 0)).toBe(true);
  });
});

describe('gate ordering', () => {
  it('crossing gates in order emits gate events and increments gatesPassed', () => {
    const race = soloRace();
    const player = race.player;
    const gates = circuit.gates;
    for (let i = 0; i < 3; i += 1) {
      placeBeforeGate(player, gates[i]!);
      race.step(DT, CRUISE);
      const events = race.drainEvents();
      const gateEvents = events.filter((event) => event.type === 'gate');
      expect(gateEvents).toHaveLength(1);
      expect(gateEvents[0]).toEqual({
        type: 'gate',
        racerId: 'player',
        gate: i,
        isPlayer: true,
        time: race.clock,
      });
      expect(player.gatesPassed).toBe(i + 1);
      expect(player.nextGate).toBe(i + 1);
      expect(player.splitTimes).toHaveLength(i + 1);
      expect(player.lastGateTime).toBe(race.clock);
    }
    expect(player.missedGates).toBe(0);
    expect(player.penaltySeconds).toBe(0);
  });

  it('crossing the current gate plane outside the bounds raises missed with a penalty and advances', () => {
    const race = soloRace();
    const player = race.player;
    const gate = circuit.gates[0]!;
    placeBeforeGate(player, gate, 0, gate.halfHeight + 40);
    race.step(DT, CRUISE);
    const events = race.drainEvents();
    expect(events.filter((event) => event.type === 'gate')).toHaveLength(0);
    expect(events).toContainEqual({ type: 'missed', racerId: 'player', gate: 0, isPlayer: true, penalty: 4 });
    expect(player.missedGates).toBe(1);
    expect(player.penaltySeconds).toBe(4);
    expect(player.nextGate).toBe(1);
    expect(player.gatesPassed).toBe(0);

    // Lateral miss on the next gate with a custom penalty.
    const custom = new RaceSimulation(circuit, [playerConfig], { countdownSeconds: 0, missPenalty: 7 });
    custom.step(DT, IDLE);
    custom.drainEvents();
    const gate1 = circuit.gates[1]!;
    placeBeforeGate(custom.player, gate1, gate1.halfWidth + 40, 0);
    custom.player.nextGate = 1;
    custom.step(DT, CRUISE);
    const missed = custom.drainEvents().find((event) => event.type === 'missed');
    expect(missed).toEqual({ type: 'missed', racerId: 'player', gate: 1, isPlayer: true, penalty: 7 });
    expect(custom.player.penaltySeconds).toBe(7);
    expect(custom.player.nextGate).toBe(2);
  });

  it('crossing a later gate plane does nothing for ordering', () => {
    const race = soloRace();
    const player = race.player;
    placeBeforeGate(player, circuit.gates[3]!);
    race.step(DT, CRUISE);
    const events = race.drainEvents();
    expect(events.filter((event) => event.type === 'gate' || event.type === 'missed')).toHaveLength(0);
    expect(player.nextGate).toBe(0);
    expect(player.gatesPassed).toBe(0);
    expect(player.missedGates).toBe(0);
  });

  it('crossing the current gate backwards does not advance', () => {
    const race = soloRace();
    const player = race.player;
    const gate = circuit.gates[0]!;
    placeBeforeGate(player, gate);
    // Flip to the far side flying back through the gate.
    player.flight.position.copy(gate.position).addScaledVector(gate.normal, 0.3);
    player.previousPosition.copy(player.flight.position);
    player.flight.velocity.copy(gate.normal).multiplyScalar(-80);
    player.flight.orientation.copy(
      lookOrientation(player.flight.position, player.flight.position.clone().sub(gate.normal)),
    );
    race.step(DT, CRUISE);
    const events = race.drainEvents();
    expect(events.filter((event) => event.type === 'gate' || event.type === 'missed')).toHaveLength(0);
    expect(player.nextGate).toBe(0);
  });

  it('raises wrong-way after flying away from the next gate for several seconds', () => {
    const race = soloRace();
    const player = race.player;
    const gate = circuit.gates[0]!;
    // Start well ahead of the start gate, facing straight away from it, high enough to avoid the terrain.
    const position = gate.position.clone().addScaledVector(gate.normal, 200);
    position.y += 200;
    const orientation = lookOrientation(position, position.clone().add(gate.normal));
    player.flight.position.copy(position);
    player.flight.orientation.copy(orientation);
    player.flight.velocity.copy(gate.normal).multiplyScalar(80);
    player.previousPosition.copy(position);
    const events = run(race, 5, CRUISE);
    expect(events.some((event) => event.type === 'wrong-way' && event.racerId === 'player')).toBe(true);
  });
});

describe('crash and respawn', () => {
  it('an aircraft stalled on the ground counts as a crash and respawns instead of getting stuck', () => {
    const race = soloRace();
    const player = race.player;
    // Settle gently onto rising terrain, slow and nose-up: a scrape, not a crash. Before the
    // grounded check the aircraft then slid along the ground at a crawl, even at full throttle.
    const position = new Vector3(-911, 0, 1038.1);
    position.y = circuit.terrain.heightAt(position.x, position.z) + 1.4;
    const orientation = new Quaternion().setFromEuler(new Euler(0.3, 4.8, 0));
    player.flight.position.copy(position);
    player.flight.orientation.copy(orientation);
    player.flight.velocity.set(0, 0, 1).applyQuaternion(orientation).multiplyScalar(27);
    player.flight.velocity.y = -1;
    player.previousPosition.copy(position);
    const events = run(race, 4, { ...NEUTRAL_INPUT, pitch: 0.4 });
    expect(events.some((event) => event.type === 'scrape')).toBe(true);
    expect(events.find((event) => event.type === 'crash')).toEqual({
      type: 'crash',
      racerId: 'player',
      isPlayer: true,
      penalty: 6,
    });
    expect(events.some((event) => event.type === 'respawn')).toBe(true);
    const ground = circuit.terrain.heightAt(player.flight.position.x, player.flight.position.z);
    expect(player.flight.position.y - ground).toBeGreaterThan(5);
  });

  it('a fast scrape bounces off without counting as a crash', () => {
    const race = soloRace();
    const player = race.player;
    const position = new Vector3(300, 0, 300);
    position.y = circuit.terrain.heightAt(position.x, position.z) + 1.4;
    player.flight.position.copy(position);
    player.flight.orientation.identity();
    player.flight.velocity.set(0, -1, 80);
    player.flight.speed = 80;
    player.previousPosition.copy(position);
    const events = run(race, 0.5, { ...NEUTRAL_INPUT, pitch: 0.4 });
    expect(events.some((event) => event.type === 'scrape')).toBe(true);
    expect(events.some((event) => event.type === 'crash')).toBe(false);
  });

  it('a crash applies a penalty, starts the respawn timer, then respawns above terrain', () => {
    const race = soloRace();
    const player = race.player;
    const dive: FlightInput = { ...NEUTRAL_INPUT, pitch: -1 };
    let crash: RaceEvent | undefined;
    let crashClock = -1;
    for (let i = 0; i < 120 * 20 && !crash; i += 1) {
      race.step(DT, dive);
      crash = race.drainEvents().find((event) => event.type === 'crash');
      if (crash) crashClock = race.clock;
    }
    expect(crash).toEqual({ type: 'crash', racerId: 'player', isPlayer: true, penalty: 6 });
    expect(crashClock).toBeGreaterThan(0);
    expect(player.crashes).toBe(1);
    expect(player.penaltySeconds).toBe(6);
    expect(player.respawnTimer).toBeGreaterThan(0);
    expect(player.flight.speed).toBe(0);

    // While the respawn timer runs the aircraft stays put and nothing else happens.
    const frozen = player.flight.position.toArray();
    race.step(DT, dive);
    expect(player.flight.position.toArray()).toEqual(frozen);
    expect(race.drainEvents()).toEqual([]);

    let respawn: RaceEvent | undefined;
    let respawnClock = -1;
    for (let i = 0; i < 120 * 5 && !respawn; i += 1) {
      race.step(DT, dive);
      respawn = race.drainEvents().find((event) => event.type === 'respawn');
      if (respawn) respawnClock = race.clock;
    }
    expect(respawn).toEqual({ type: 'respawn', racerId: 'player', isPlayer: true });
    expect(respawnClock - crashClock).toBeGreaterThan(1.5);
    expect(respawnClock - crashClock).toBeLessThan(1.7);
    expect(player.respawnTimer).toBeLessThanOrEqual(0);
    // Respawned back at the spawn (no gate passed yet), above the ground and flying.
    const ground = circuit.terrain.heightAt(player.flight.position.x, player.flight.position.z);
    expect(player.flight.position.y - ground).toBeGreaterThanOrEqual(35);
    expect(player.flight.position.distanceTo(circuit.spawn.position)).toBeLessThan(40);
    expect(player.flight.speed).toBeCloseTo(62, 6);
    expect(player.flight.groundContact).toBe('none');
    expect(player.flight.overheated).toBe(false);
    expect(player.flight.boostEnergy).toBeGreaterThanOrEqual(0.4);
    // Facing the start gate.
    const toGate = new Vector3().subVectors(circuit.gates[0]!.position, player.flight.position).normalize();
    expect(forwardOf(player).dot(toGate)).toBeGreaterThan(0.99);
    // Counters survive the respawn.
    expect(player.crashes).toBe(1);
    expect(player.penaltySeconds).toBe(6);
  });

  it('respawn() places the racer just past its last gate facing the next gate', () => {
    const race = soloRace();
    const player = race.player;
    player.nextGate = 5;
    player.gatesPassed = 5;
    race.respawn(player);
    const last = circuit.gates[4]!;
    const next = circuit.gates[5]!;
    expect(player.flight.position.distanceTo(last.position)).toBeLessThan(60);
    const ground = circuit.terrain.heightAt(player.flight.position.x, player.flight.position.z);
    expect(player.flight.position.y - ground).toBeGreaterThanOrEqual(35);
    const toNext = new Vector3().subVectors(next.position, player.flight.position).normalize();
    expect(forwardOf(player).dot(toNext)).toBeGreaterThan(0.99);
    expect(player.previousPosition.toArray()).toEqual(player.flight.position.toArray());
    expect(player.wrongWayTimer).toBe(0);
    expect(player.nextGate).toBe(5);
    // The respawned racer does not immediately re-trigger its last gate.
    race.step(DT, CRUISE);
    expect(
      race.drainEvents().filter((event) => event.type === 'gate' || event.type === 'missed'),
    ).toHaveLength(0);
    expect(player.nextGate).toBe(5);
  });

  it('a tougher airframe pays a smaller crash penalty', () => {
    const cruiser = defaultBuildFor(getAirframe('airframe-cruiser')!);
    const heavy = new RaceSimulation(circuit, [{ ...playerConfig, build: cruiser }], { countdownSeconds: 0 });
    heavy.step(DT, IDLE);
    const events = run(heavy, 20, { ...NEUTRAL_INPUT, pitch: -1 });
    const crash = events.find((event) => event.type === 'crash');
    expect(crash).toBeDefined();
    expect(crash?.type === 'crash' && crash.penalty).toBe(
      Math.round(3 + 3 / flightParametersForBuild(cruiser).durability),
    );
    expect(flightParametersForBuild(cruiser).durability).toBeGreaterThan(1.2);
  });
});

describe('finishing', () => {
  it('finish events carry the finish time including penalties and end the race for the player', () => {
    const race = soloRace();
    const player = race.player;
    const gates = circuit.gates;
    const events: RaceEvent[] = [];
    for (let i = 0; i < gates.length; i += 1) {
      const gate = gates[i]!;
      // Miss gate 2 deliberately, pass the rest.
      placeBeforeGate(player, gate, 0, i === 2 ? gate.halfHeight + 40 : 0);
      race.step(DT, CRUISE);
      events.push(...race.drainEvents());
    }
    expect(player.finished).toBe(true);
    expect(player.gatesPassed).toBe(gates.length - 1);
    expect(player.missedGates).toBe(1);
    expect(player.penaltySeconds).toBe(4);
    expect(player.rawTime).toBeCloseTo(race.clock, 10);
    expect(player.finishTime).toBeCloseTo(player.rawTime + 4, 10);
    const finish = events.find((event) => event.type === 'finish');
    expect(finish).toEqual({
      type: 'finish',
      racerId: 'player',
      isPlayer: true,
      position: 1,
      time: player.finishTime,
    });
    expect(race.phase).toBe('finished');
    const standing = race.getStandings()[0]!;
    expect(standing.finished).toBe(true);
    expect(standing.finishTime).toBe(player.finishTime);
    expect(standing.rawTime).toBe(player.rawTime);
    expect(standing.penaltySeconds).toBe(4);
    expect(standing.missedGates).toBe(1);
    expect(standing.gatesPassed).toBe(gates.length - 1);

    // A finished racer keeps flying (cruise) but no longer triggers gates.
    const before = player.flight.position.clone();
    placeBeforeGate(player, gates[0]!);
    race.step(DT, CRUISE);
    expect(race.drainEvents().filter((event) => event.type === 'gate')).toHaveLength(0);
    expect(player.gatesPassed).toBe(gates.length - 1);
    expect(player.flight.position.equals(before)).toBe(false);
  });

  it('a full AI race completes with every AI racer finishing cleanly', () => {
    const race = new RaceSimulation(circuit, fullGrid());
    const finishEvents: Extract<RaceEvent, { type: 'finish' }>[] = [];
    let elapsed = 0;
    while (elapsed < 155 && race.racers.some((racer) => racer.config.ai && !racer.finished)) {
      race.step(DT, IDLE);
      elapsed += DT;
      for (const event of race.drainEvents()) if (event.type === 'finish') finishEvents.push(event);
    }
    expect(race.clock).toBeLessThan(150);
    const ai = race.racers.filter((racer) => racer.config.ai);
    expect(ai).toHaveLength(3);
    for (const racer of ai) {
      expect(racer.finished, racer.config.id).toBe(true);
      expect(racer.gatesPassed, racer.config.id).toBe(race.gateCount);
      expect(racer.missedGates, racer.config.id).toBe(0);
      expect(racer.crashes, racer.config.id).toBe(0);
      expect(racer.penaltySeconds, racer.config.id).toBe(0);
      expect(racer.finishTime, racer.config.id).toBeGreaterThan(0);
      expect(racer.finishTime, racer.config.id).toBeLessThan(150);
      expect(racer.finishTime).toBe(racer.rawTime + racer.penaltySeconds);
      expect(racer.splitTimes).toHaveLength(race.gateCount);
    }
    // The idle player never finishes, so the race phase is still 'racing'.
    expect(race.player.finished).toBe(false);
    expect(race.phase).toBe('racing');

    // Finish events: one per AI, carrying its finish time, in finishing order.
    expect(finishEvents).toHaveLength(3);
    for (const event of finishEvents) {
      const racer = race.racers.find((r) => r.config.id === event.racerId)!;
      expect(event.time).toBe(racer.finishTime);
      expect(event.isPlayer).toBe(false);
    }
    const times = finishEvents.map((event) => event.time);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(finishEvents.map((event) => event.position)).toEqual([1, 2, 3]);

    // Standings: positions 1..4 unique, finishers ahead of the unfinished player, ordered by time.
    const standings = race.getStandings();
    expect(standings.map((standing) => standing.position)).toEqual([1, 2, 3, 4]);
    expect(new Set(standings.map((standing) => standing.racerId)).size).toBe(4);
    expect(standings.slice(0, 3).every((standing) => standing.finished)).toBe(true);
    expect(standings[3]!.isPlayer).toBe(true);
    expect(standings[3]!.finished).toBe(false);
    for (let i = 1; i < 3; i += 1) {
      expect(standings[i]!.finishTime).toBeGreaterThanOrEqual(standings[i - 1]!.finishTime);
    }
  });
});

describe('standings and projection', () => {
  it('ranks racers by progress before anyone finishes', () => {
    const race = soloRace();
    const standings = race.getStandings();
    expect(standings).toHaveLength(1);
    expect(standings[0]).toMatchObject({ racerId: 'player', position: 1, finished: false, gatesPassed: 0 });

    const grid = new RaceSimulation(circuit, fullGrid(), { countdownSeconds: 0 });
    grid.step(DT, IDLE);
    // Teleport the player through the first two gates: it should lead.
    for (let i = 0; i < 2; i += 1) {
      placeBeforeGate(grid.player, circuit.gates[i]!);
      grid.step(DT, CRUISE);
    }
    const lead = grid.getStandings();
    expect(lead[0]!.isPlayer).toBe(true);
    expect(lead[0]!.gatesPassed).toBe(2);
    expect(lead.map((standing) => standing.position)).toEqual([1, 2, 3, 4]);
  });

  it('projectFinalStandings returns positions for all racers without touching the live state', () => {
    const race = new RaceSimulation(circuit, fullGrid(), { countdownSeconds: 0 });
    run(race, 20, IDLE);
    expect(race.phase).toBe('racing');
    const clock = race.clock;
    const snapshot = race.racers.map((racer) => ({
      position: racer.flight.position.toArray(),
      velocity: racer.flight.velocity.toArray(),
      orientation: racer.flight.orientation.toArray(),
      heat: racer.flight.heat,
      nextGate: racer.nextGate,
      gatesPassed: racer.gatesPassed,
      finished: racer.finished,
      penalty: racer.penaltySeconds,
      splits: [...racer.splitTimes],
    }));

    const projected = race.projectFinalStandings(150, 1 / 60);
    expect(projected).toHaveLength(4);
    expect(projected.map((standing) => standing.position)).toEqual([1, 2, 3, 4]);
    expect(new Set(projected.map((standing) => standing.racerId)).size).toBe(4);
    const projectedAi = projected.filter((standing) => !standing.isPlayer);
    expect(projectedAi.every((standing) => standing.finished)).toBe(true);
    for (const standing of projectedAi) expect(standing.finishTime).toBeGreaterThan(clock);

    expect(race.clock).toBe(clock);
    expect(race.phase).toBe('racing');
    race.racers.forEach((racer, index) => {
      const saved = snapshot[index]!;
      expect(racer.flight.position.toArray()).toEqual(saved.position);
      expect(racer.flight.velocity.toArray()).toEqual(saved.velocity);
      expect(racer.flight.orientation.toArray()).toEqual(saved.orientation);
      expect(racer.flight.heat).toBe(saved.heat);
      expect(racer.nextGate).toBe(saved.nextGate);
      expect(racer.gatesPassed).toBe(saved.gatesPassed);
      expect(racer.finished).toBe(saved.finished);
      expect(racer.penaltySeconds).toBe(saved.penalty);
      expect(racer.splitTimes).toEqual(saved.splits);
    });
    expect(race.drainEvents()).toEqual([]);
  });
});
