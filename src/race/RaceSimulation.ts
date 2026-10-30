import { Quaternion, Vector3 } from 'three';
import { clamp01 } from '../core/math';
import type { AircraftBuild } from '../aircraft/build';
import { flightParametersForBuild, type FlightParameters } from '../aircraft/performance';
import {
  copyFlightState,
  createFlightState,
  resetFlightState,
  stepFlight,
  type FlightAssist,
  type FlightEnvironment,
  type FlightInput,
  type FlightState,
  DEFAULT_ASSIST,
  NEUTRAL_INPUT,
} from '../flight/FlightModel';
import { lookOrientation, type Circuit } from '../course/circuit';
import { gateCrossingOffset, testGateCrossing, testRingCrossing } from '../course/gates';
import {
  StyleTracker,
  terrainClearance,
  type ComboBreak,
  type ComboBreakReason,
  type StyleAward,
} from '../style/StyleTracker';
import { computeAiInput, computeCruiseInput, type AiPersonality } from '../ai/AiPilot';
import { sampleWind, type Conditions } from '../activities/conditions';

export type RacePhase = 'countdown' | 'racing' | 'finished';

export interface RacerConfig {
  id: string;
  name: string;
  callsign: string;
  isPlayer: boolean;
  build: AircraftBuild;
  ai?: AiPersonality;
}

export interface Racer {
  config: RacerConfig;
  params: FlightParameters;
  flight: FlightState;
  previousPosition: Vector3;
  input: FlightInput;
  nextGate: number;
  gatesPassed: number;
  missedGates: number;
  penaltySeconds: number;
  crashes: number;
  finished: boolean;
  /** Elapsed race clock when the finish gate was crossed (before penalties). */
  rawTime: number;
  /** rawTime + penalties; what the standings use. */
  finishTime: number;
  progress: number;
  position: number;
  respawnTimer: number;
  wrongWayTimer: number;
  /** Seconds spent stuck low on the terrain (scraping or too slow to fly); a crash once it runs out. */
  groundedTimer: number;
  lastGateTime: number;
  splitTimes: number[];
  /** Normalised offset (0 centre … 1 frame) of each gate passed, for accuracy scoring. */
  gateOffsets: number[];
  /** Strict runs only: why the run ended early. */
  failed: 'missed-gate' | 'crash' | 'time' | null;
}

export type RaceEvent =
  | { type: 'countdown'; value: number }
  | { type: 'go' }
  | { type: 'gate'; racerId: string; gate: number; isPlayer: boolean; time: number }
  | { type: 'missed'; racerId: string; gate: number; isPlayer: boolean; penalty: number }
  | { type: 'wrong-way'; racerId: string; isPlayer: boolean }
  | { type: 'crash'; racerId: string; isPlayer: boolean; penalty: number }
  | { type: 'respawn'; racerId: string; isPlayer: boolean }
  | { type: 'scrape'; racerId: string; isPlayer: boolean }
  | { type: 'overheat'; racerId: string; isPlayer: boolean }
  | { type: 'out-of-bounds'; racerId: string; isPlayer: boolean }
  | { type: 'finish'; racerId: string; isPlayer: boolean; position: number; time: number }
  /** Player-only style scoring. `ring` is set for bonus-ring awards, `gate` for gate awards. */
  | { type: 'style'; award: StyleAward; ring?: number; gate?: number }
  | { type: 'combo-break'; combo: ComboBreak };

export interface RaceOptions {
  assist?: FlightAssist;
  /** Multiplier applied to every AI pilot's skill (see difficultyMultiplier). */
  aiSkill?: number;
  countdownSeconds?: number;
  missPenalty?: number;
  outOfBoundsPenalty?: number;
  /** Weather: the wind every aircraft flies through. Default still air. */
  conditions?: Conditions;
  /** Precision runs: a missed gate or a crash ends the player's run. */
  strict?: boolean;
}

export interface Standing {
  racerId: string;
  name: string;
  callsign: string;
  isPlayer: boolean;
  position: number;
  finished: boolean;
  finishTime: number;
  rawTime: number;
  penaltySeconds: number;
  missedGates: number;
  crashes: number;
  gatesPassed: number;
}

/** AI pilots always fly with the default assistance, independent of the player's setting. */
const AI_ASSIST: FlightAssist = { strength: 0.6 };
const RESPAWN_DELAY = 1.6;
const RESPAWN_SPEED = 62;
const WRONG_WAY_SECONDS = 3.5;
/** Below this height an aircraft that is scraping, or too slow to fly, counts as grounded. */
const GROUNDED_ALTITUDE = 5;
/** Grounded for this long means the aircraft is stuck on the terrain and is treated as a crash. */
const GROUNDED_SECONDS = 1.2;
/** Boost energy refunded to the player for skilful moves (fraction of a full tank). */
export const BOOST_REWARD = { perfectGate: 0.12, ring: 0.25, nearMiss: 0.08 } as const;
const _tmp = new Vector3();
const _q = new Quaternion();

const makeInput = (): FlightInput => ({ ...NEUTRAL_INPUT });

/** The flight environment for a course: its terrain, ceiling and (on water courses) where the water is. */
export const flightEnvironmentFor = (circuit: Circuit): FlightEnvironment => {
  const { terrain, seaLevel } = circuit;
  return {
    terrainHeight: terrain.heightAt,
    ceiling: circuit.ceiling,
    isWater: seaLevel === null ? undefined : (x, z) => terrain.groundAt(x, z) < seaLevel,
  };
};

export class RaceSimulation {
  readonly racers: Racer[];
  readonly player: Racer;
  phase: RacePhase = 'countdown';
  /** Race clock in seconds; starts at 0 on GO. */
  clock = 0;
  countdown: number;
  private lastCountdownValue: number;
  private events: RaceEvent[] = [];
  private finishedCount = 0;
  readonly assist: FlightAssist;
  readonly missPenalty: number;
  readonly outOfBoundsPenalty: number;
  readonly aiSkill: number;
  private readonly environment: FlightEnvironment;
  private readonly wind = new Vector3();
  readonly conditions: Conditions | null;
  readonly strict: boolean;
  /** Style scoring for the player. Recreated with the simulation, so restarts never carry state over. */
  readonly style = new StyleTracker();
  private readonly playerAhead = new Map<string, boolean>();

  constructor(
    readonly circuit: Circuit,
    configs: readonly RacerConfig[],
    options: RaceOptions = {},
  ) {
    this.assist = options.assist ?? DEFAULT_ASSIST;
    this.missPenalty = options.missPenalty ?? 4;
    this.outOfBoundsPenalty = options.outOfBoundsPenalty ?? 2;
    this.aiSkill = options.aiSkill ?? 1;
    this.countdown = options.countdownSeconds ?? 3;
    this.conditions = options.conditions ?? null;
    this.strict = options.strict === true;
    this.environment = { ...flightEnvironmentFor(circuit), wind: this.conditions ? this.wind : undefined };
    this.lastCountdownValue = Math.ceil(this.countdown) + 1;

    const spawnForward = new Vector3(0, 0, 1).applyQuaternion(circuit.spawn.orientation);
    const spawnRight = new Vector3(1, 0, 0).applyQuaternion(circuit.spawn.orientation);

    this.racers = configs.map((config, index) => {
      const slot = circuit.gridSlots[index % circuit.gridSlots.length]!;
      const position = circuit.spawn.position
        .clone()
        .addScaledVector(spawnRight, slot.right)
        .addScaledVector(spawnForward, -slot.back);
      position.y += slot.up;
      const params = flightParametersForBuild(config.build);
      const flight = createFlightState(position, circuit.spawn.orientation, circuit.spawn.speed);
      flight.throttle = 0.35;
      return {
        config,
        params,
        flight,
        previousPosition: position.clone(),
        input: makeInput(),
        nextGate: 0,
        gatesPassed: 0,
        missedGates: 0,
        penaltySeconds: 0,
        crashes: 0,
        finished: false,
        rawTime: 0,
        finishTime: 0,
        progress: 0,
        position: index + 1,
        respawnTimer: 0,
        wrongWayTimer: 0,
        groundedTimer: 0,
        lastGateTime: 0,
        splitTimes: [],
        gateOffsets: [],
        failed: null,
      };
    });
    const player = this.racers.find((racer) => racer.config.isPlayer);
    if (!player) throw new Error('A race needs exactly one player racer');
    this.player = player;
  }

  /** The wind right now (zero in still air). */
  get windVector(): Vector3 {
    return this.wind;
  }

  get gateCount(): number {
    return this.circuit.gates.length;
  }

  /** Drains and returns events raised since the last call. */
  drainEvents(): RaceEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  /** Advances the race by a fixed `dt` using the supplied player input. */
  step(dt: number, playerInput: FlightInput): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const value = Math.max(0, Math.ceil(this.countdown));
      if (value < this.lastCountdownValue) {
        this.lastCountdownValue = value;
        if (value > 0) this.events.push({ type: 'countdown', value });
      }
      // Hold the aircraft on the grid; keep the engine audio alive via throttle.
      for (const racer of this.racers) {
        racer.flight.throttle = racer.config.isPlayer ? clamp01(playerInput.throttle) : 0.5;
        racer.flight.speed = this.circuit.spawn.speed;
      }
      if (this.countdown <= 0) {
        this.phase = 'racing';
        this.clock = 0;
        this.events.push({ type: 'go' });
      }
      return;
    }

    this.clock += dt;
    for (const racer of this.racers) {
      this.stepRacer(racer, dt, racer.config.isPlayer ? playerInput : null);
    }
    this.updateStandings();
    this.trackOvertakes();
  }

  private pushStyle(award: StyleAward | null, extra: { ring?: number; gate?: number } = {}): void {
    if (award) this.events.push({ type: 'style', award, ...extra });
  }

  private breakCombo(reason: ComboBreakReason): void {
    const lost = this.style.breakCombo(reason);
    if (lost) this.events.push({ type: 'combo-break', combo: lost });
  }

  private refundBoost(amount: number): void {
    const flight = this.player.flight;
    flight.boostEnergy = Math.min(1, flight.boostEnergy + amount);
  }

  /** Overtakes score when the player moves ahead of an opponent (rate limited per opponent). */
  private trackOvertakes(): void {
    const player = this.player;
    const active = !player.finished && player.respawnTimer <= 0;
    for (const racer of this.racers) {
      if (racer === player) continue;
      const ahead = player.progress > racer.progress;
      const before = this.playerAhead.get(racer.config.id);
      this.playerAhead.set(racer.config.id, ahead);
      if (active && before === false && ahead && !racer.finished) {
        this.pushStyle(this.style.overtake(racer.config.id, this.clock));
      }
    }
  }

  /** Player-only style work after the flight step: proximity skims, rings and the combo clock. */
  private stepPlayerStyle(racer: Racer, dt: number): void {
    const { flight } = racer;
    _tmp.set(1, 0, 0).applyQuaternion(flight.orientation);
    const clearance = terrainClearance(
      flight.position.x,
      flight.position.y,
      flight.position.z,
      _tmp.x,
      _tmp.z,
      this.circuit.terrain.heightAt,
    );
    const skim = this.style.proximity(clearance, flight.speed, dt);
    if (skim) {
      this.refundBoost(BOOST_REWARD.nearMiss);
      this.pushStyle(skim);
    }
    for (const ring of this.circuit.rings) {
      if (this.style.ringsCollected.has(ring.index)) continue;
      if (testRingCrossing(ring, racer.previousPosition, flight.position)) {
        const award = this.style.ring(ring.index);
        if (award) {
          this.refundBoost(BOOST_REWARD.ring);
          this.pushStyle(award, { ring: ring.index });
        }
      }
    }
    const expired = this.style.update(dt);
    if (expired) this.events.push({ type: 'combo-break', combo: expired });
  }

  private stepRacer(racer: Racer, dt: number, playerInput: FlightInput | null): void {
    const { flight, config } = racer;
    const isPlayer = config.isPlayer;

    if (racer.respawnTimer > 0) {
      racer.respawnTimer -= dt;
      if (racer.respawnTimer <= 0) {
        this.respawn(racer);
        this.events.push({ type: 'respawn', racerId: config.id, isPlayer });
      }
      return;
    }

    if (racer.finished) {
      // Finished racers cruise ahead at a safe height while the results come up.
      computeCruiseInput(flight, this.circuit, racer.input);
    } else if (playerInput) {
      racer.input.pitch = playerInput.pitch;
      racer.input.roll = playerInput.roll;
      racer.input.yaw = playerInput.yaw;
      racer.input.throttle = playerInput.throttle;
      racer.input.boost = playerInput.boost;
      racer.input.airbrake = playerInput.airbrake;
    } else if (config.ai) {
      computeAiInput(
        flight,
        racer.params,
        this.circuit,
        racer.nextGate,
        config.ai,
        racer.input,
        this.aiSkill,
      );
    }

    racer.previousPosition.copy(flight.position);
    const wasOverheated = flight.overheated;
    if (this.conditions)
      this.environment.rollGust = sampleWind(
        this.conditions,
        this.clock,
        flight.position.x,
        flight.position.z,
        this.wind,
      );
    stepFlight(flight, racer.input, racer.params, this.environment, dt, isPlayer ? this.assist : AI_ASSIST);

    if (!wasOverheated && flight.overheated) {
      this.events.push({ type: 'overheat', racerId: config.id, isPlayer });
    }

    // A gentle scrape bleeds speed; repeated scrapes or a stall on the ground would leave the
    // aircraft sliding along the terrain forever, so being grounded too long counts as a crash.
    // Floats planing on the water are taxiing, not stuck.
    const grounded =
      flight.altitude < GROUNDED_ALTITUDE &&
      flight.groundContact !== 'splash' &&
      (flight.groundContact === 'scrape' || flight.speed < racer.params.stallSpeed);
    racer.groundedTimer = grounded ? racer.groundedTimer + dt : 0;
    const stuck = racer.groundedTimer >= GROUNDED_SECONDS;

    if (flight.groundContact === 'crash' || stuck) {
      racer.groundedTimer = 0;
      const penalty = Math.round(3 + 3 / racer.params.durability);
      racer.crashes += 1;
      racer.penaltySeconds += penalty;
      racer.respawnTimer = RESPAWN_DELAY;
      flight.velocity.set(0, 0, 0);
      flight.speed = 0;
      this.events.push({ type: 'crash', racerId: config.id, isPlayer, penalty });
      if (isPlayer && !racer.finished) this.breakCombo('crash');
      if (isPlayer && this.strict && !racer.finished) this.failPlayer('crash');
      return;
    }
    if (flight.groundContact === 'scrape') {
      this.events.push({ type: 'scrape', racerId: config.id, isPlayer });
      if (isPlayer && !racer.finished) this.breakCombo('scrape');
    } else if (flight.groundContact === 'splash' && isPlayer) {
      // A float touchdown is safe, but it is not a near miss.
      this.style.touchedGround();
    }

    const horizontal = Math.hypot(flight.position.x, flight.position.z);
    if (horizontal > this.circuit.bounds) {
      racer.penaltySeconds += this.outOfBoundsPenalty;
      racer.respawnTimer = RESPAWN_DELAY * 0.5;
      this.events.push({ type: 'out-of-bounds', racerId: config.id, isPlayer });
      if (isPlayer && !racer.finished) this.breakCombo('out-of-bounds');
      return;
    }

    if (racer.finished) return;
    if (isPlayer) this.stepPlayerStyle(racer, dt);

    const gate = this.circuit.gates[racer.nextGate]!;
    const crossing = testGateCrossing(gate, racer.previousPosition, flight.position);
    if (crossing === 'passed') {
      racer.gatesPassed += 1;
      racer.nextGate += 1;
      racer.lastGateTime = this.clock;
      racer.splitTimes.push(this.clock);
      this.events.push({ type: 'gate', racerId: config.id, gate: gate.index, isPlayer, time: this.clock });
      if (isPlayer) {
        const offset = gateCrossingOffset(gate, racer.previousPosition, flight.position) ?? 1;
        racer.gateOffsets.push(offset);
        const award = this.style.gate(offset);
        if (award.kind === 'perfect-gate') this.refundBoost(BOOST_REWARD.perfectGate);
        this.pushStyle(award, { gate: gate.index });
      }
      if (racer.nextGate >= this.gateCount) this.finish(racer);
    } else if (crossing === 'missed') {
      racer.missedGates += 1;
      racer.penaltySeconds += this.missPenalty;
      racer.nextGate += 1;
      racer.lastGateTime = this.clock;
      racer.splitTimes.push(this.clock);
      this.events.push({
        type: 'missed',
        racerId: config.id,
        gate: gate.index,
        isPlayer,
        penalty: this.missPenalty,
      });
      if (isPlayer) this.breakCombo('missed-gate');
      if (isPlayer && this.strict) {
        this.failPlayer('missed-gate');
        return;
      }
      if (racer.nextGate >= this.gateCount) this.finish(racer);
    }

    if (!racer.finished) {
      // Wrong-way detection: heading away from the next gate for several seconds.
      const next = this.circuit.gates[racer.nextGate]!;
      _tmp.subVectors(next.position, flight.position).normalize();
      const forward = _tmp.dot(this.forwardOf(flight));
      if (forward < -0.35 && flight.speed > 20) {
        racer.wrongWayTimer += dt;
        if (racer.wrongWayTimer >= WRONG_WAY_SECONDS) {
          racer.wrongWayTimer = 0;
          this.events.push({ type: 'wrong-way', racerId: config.id, isPlayer });
        }
      } else {
        racer.wrongWayTimer = 0;
      }
    }
  }

  private forwardOf(flight: FlightState): Vector3 {
    return new Vector3(0, 0, 1).applyQuaternion(flight.orientation);
  }

  private finish(racer: Racer): void {
    racer.finished = true;
    racer.rawTime = this.clock;
    racer.finishTime = this.clock + racer.penaltySeconds;
    this.finishedCount += 1;
    this.updateStandings();
    this.events.push({
      type: 'finish',
      racerId: racer.config.id,
      isPlayer: racer.config.isPlayer,
      position: racer.position,
      time: racer.finishTime,
    });
    if (racer.config.isPlayer) this.phase = 'finished';
  }

  /** Ends the player's strict run early (a miss, a crash, or out of time). */
  failPlayer(reason: NonNullable<Racer['failed']>): void {
    const player = this.player;
    if (player.finished) return;
    player.failed = reason;
    this.finish(player);
  }

  /** Average accuracy (0..100) of the gates the player has passed: 100 is dead centre every time. */
  get playerAccuracy(): number {
    const offsets = this.player.gateOffsets;
    if (offsets.length === 0) return 0;
    const sum = offsets.reduce((total, offset) => total + Math.max(0, 1 - offset), 0);
    return (sum / offsets.length) * 100;
  }

  /** Places the racer just past its last gate (or the start), facing the next gate. */
  respawn(racer: Racer): void {
    const gates = this.circuit.gates;
    const nextIndex = Math.min(racer.nextGate, gates.length - 1);
    const next = gates[nextIndex]!;
    let position: Vector3;
    if (racer.nextGate === 0) {
      position = this.circuit.spawn.position.clone();
    } else {
      const last = gates[racer.nextGate - 1]!;
      position = last.position.clone().addScaledVector(last.normal, 45);
      position.y += 6;
    }
    const ground = this.circuit.terrain.heightAt(position.x, position.z);
    if (position.y < ground + 35) position.y = ground + 35;
    const orientation = lookOrientation(position, next.position, _q);
    resetFlightState(racer.flight, position, orientation, RESPAWN_SPEED);
    racer.flight.boostEnergy = Math.max(racer.flight.boostEnergy, 0.4);
    racer.previousPosition.copy(position);
    racer.wrongWayTimer = 0;
    racer.groundedTimer = 0;
    if (racer.config.isPlayer) this.style.resetProximity();
  }

  /** Progress along the course in gates (fractional), used for live positions. */
  private computeProgress(racer: Racer): number {
    if (racer.finished) return this.gateCount + 1;
    const gates = this.circuit.gates;
    const next = gates[Math.min(racer.nextGate, gates.length - 1)]!;
    const previousPoint =
      racer.nextGate === 0 ? this.circuit.spawn.position : gates[racer.nextGate - 1]!.position;
    const segment = Math.max(1, previousPoint.distanceTo(next.position));
    const remaining = racer.flight.position.distanceTo(next.position);
    return racer.nextGate + clamp01(1 - remaining / segment);
  }

  updateStandings(): void {
    for (const racer of this.racers) racer.progress = this.computeProgress(racer);
    const ordered = [...this.racers].sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.progress - a.progress;
    });
    ordered.forEach((racer, index) => {
      racer.position = index + 1;
    });
  }

  getStandings(): Standing[] {
    this.updateStandings();
    return [...this.racers]
      .sort((a, b) => a.position - b.position)
      .map((racer) => ({
        racerId: racer.config.id,
        name: racer.config.name,
        callsign: racer.config.callsign,
        isPlayer: racer.config.isPlayer,
        position: racer.position,
        finished: racer.finished,
        finishTime: racer.finishTime,
        rawTime: racer.rawTime,
        penaltySeconds: racer.penaltySeconds,
        missedGates: racer.missedGates,
        crashes: racer.crashes,
        gatesPassed: racer.gatesPassed,
      }));
  }

  /**
   * Projects the final standings by simulating the AI racers that have not yet
   * finished on cloned state. The live simulation is untouched so the visible
   * aircraft keep flying naturally.
   */
  projectFinalStandings(maxSeconds = 240, dt = 1 / 60): Standing[] {
    const clone = new RaceSimulation(
      this.circuit,
      this.racers.map((racer) => racer.config),
      { assist: this.assist, missPenalty: this.missPenalty, countdownSeconds: 0, aiSkill: this.aiSkill },
    );
    clone.phase = 'racing';
    clone.clock = this.clock;
    clone.finishedCount = this.finishedCount;
    clone.racers.forEach((target, index) => {
      const source = this.racers[index]!;
      copyFlightState(target.flight, source.flight);
      target.previousPosition.copy(source.previousPosition);
      target.nextGate = source.nextGate;
      target.gatesPassed = source.gatesPassed;
      target.missedGates = source.missedGates;
      target.penaltySeconds = source.penaltySeconds;
      target.crashes = source.crashes;
      target.finished = source.finished;
      target.rawTime = source.rawTime;
      target.finishTime = source.finishTime;
      target.respawnTimer = source.respawnTimer;
      target.groundedTimer = source.groundedTimer;
      target.position = source.position;
      target.splitTimes = [...source.splitTimes];
    });
    const neutral: FlightInput = { ...NEUTRAL_INPUT, throttle: 0.5 };
    let elapsed = 0;
    while (elapsed < maxSeconds && clone.racers.some((racer) => !racer.finished)) {
      clone.step(dt, neutral);
      elapsed += dt;
    }
    // Anyone still unfinished is classified behind the finishers by progress.
    return clone.getStandings();
  }
}
