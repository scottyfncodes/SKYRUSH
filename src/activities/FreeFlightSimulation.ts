import { Quaternion, Vector3 } from 'three';
import { clamp, clamp01 } from '../core/math';
import type { AircraftBuild } from '../aircraft/build';
import { flightParametersForBuild, type FlightParameters } from '../aircraft/performance';
import {
  createFlightState,
  resetFlightState,
  stepFlight,
  type FlightAssist,
  type FlightEnvironment,
  type FlightInput,
  type FlightState,
} from '../flight/FlightModel';
import { lookOrientation, type Circuit } from '../course/circuit';
import { testRingCrossing } from '../course/gates';
import { flightEnvironmentFor } from '../race/RaceSimulation';
import { sampleWind, type Conditions } from './conditions';
import type { DeliveryActivity, ExploreActivity, ShowActivity } from './catalog';
import { discoveriesIn } from './catalog';
import {
  DISCOVERY_HEIGHT,
  DISCOVERY_RADIUS,
  HOOK_RADIUS,
  resolveDiscovery,
  resolveStops,
  showFloor,
  type ResolvedDiscovery,
  type ResolvedStop,
} from './places';
import { TrickTracker, type TrickEvent } from './tricks';

/**
 * Solo flight for the activities that are not about gates: air shows, deliveries
 * and free flight. One aircraft, the region's terrain, the conditions' wind, and
 * an objective. Discoveries can be found in any of them.
 *
 * Pure and deterministic like RaceSimulation: rendering, audio and the DOM read
 * its state and drain its events.
 */

export type FreeFlightActivity = ShowActivity | DeliveryActivity | ExploreActivity;
export type FreeFlightPhase = 'countdown' | 'flying' | 'finished';

export type FreeFlightEvent =
  | { type: 'countdown'; value: number }
  | { type: 'go' }
  | { type: 'crash' }
  | { type: 'respawn' }
  | { type: 'scrape' }
  | { type: 'splash' }
  | { type: 'overheat' }
  | { type: 'out-of-bounds' }
  | { type: 'box'; inside: boolean }
  | { type: 'hook'; stop: number; kind: 'pickup' | 'drop'; name: string }
  | { type: 'hook-miss'; stop: number; reason: 'fast' | 'high'; value: number }
  | { type: 'strain'; condition: number }
  | { type: 'cargo-lost' }
  | { type: 'discovery'; id: string }
  | { type: 'trail-ring'; id: string; collected: number; total: number }
  | { type: 'time-up' }
  | { type: 'complete' }
  | TrickEvent;

export interface FreeFlightOptions {
  assist: FlightAssist;
  conditions: Conditions;
  /** Discoveries already in the player's log (rendered as found, no event). */
  discovered?: ReadonlySet<string>;
  countdownSeconds?: number;
}

export interface FreeFlightResult {
  activityId: string;
  completed: boolean;
  /** Why an unfinished run ended. */
  failure: 'cargo-lost' | null;
  /** Seconds flown after GO. */
  time: number;
  crashes: number;
  /** Air show score. */
  score: number;
  figures: number;
  variety: number;
  bestChain: number;
  /** Cargo condition 0..100 at the end of a delivery. */
  condition: number;
  /** Discoveries found on this flight (not already in the log). */
  discoveries: string[];
  /** Distance flown (m). */
  distance: number;
}

const RESPAWN_DELAY = 1.6;
const RESPAWN_SPEED = 62;
const GROUNDED_ALTITUDE = 5;
const GROUNDED_SECONDS = 1.2;
/** Safe points are logged this often and respawns use one from about this long ago. */
const SAFE_INTERVAL = 0.5;
const SAFE_LOOKBACK = 6;
/** Cargo damage (condition points) for a scrape and a crash, and per second per 30° over the bank limit. */
export const CARGO_SCRAPE_DAMAGE = 12;
export const CARGO_CRASH_DAMAGE = 35;
export const CARGO_BANK_DAMAGE = 14;
const SCRAPE_COOLDOWN = 0.6;
/** Pitch rate (rad/s) above which hauling on the stick shakes the cargo. */
const CARGO_PITCH_RATE = 1.0;
const CARGO_PITCH_DAMAGE = 10;
/** Discovery signal: the HUD shows the distance to the nearest unfound thing inside this range. */
export const SIGNAL_RANGE = 900;

/** Flight parameters with a cargo aboard: heavier, slower to respond, a higher stall speed. */
export const withCargo = (params: FlightParameters, cargoMass: number): FlightParameters => {
  if (cargoMass <= 0) return params;
  const ratio = (params.mass + cargoMass) / params.mass;
  return {
    ...params,
    mass: params.mass + cargoMass,
    stallSpeed: params.stallSpeed * Math.sqrt(ratio),
    responsiveness: params.responsiveness / Math.sqrt(ratio),
    pitchRate: params.pitchRate / ratio ** 0.35,
    rollRate: params.rollRate / ratio ** 0.35,
    grip: params.grip / ratio ** 0.25,
  };
};

const _q = new Quaternion();
const _forward = new Vector3();
const _toCenter = new Vector3();

export class FreeFlightSimulation {
  readonly flight: FlightState;
  readonly baseParams: FlightParameters;
  params: FlightParameters;
  phase: FreeFlightPhase;
  /** Seconds since GO. */
  clock = 0;
  countdown: number;
  readonly tricks: TrickTracker | null;
  readonly stops: ResolvedStop[];
  readonly discoveries: ResolvedDiscovery[];
  readonly found = new Set<string>();
  /** Trail ring indexes flown through, per trail discovery id. */
  readonly trailProgress = new Map<string, Set<number>>();
  /** Index of the next delivery stop. */
  nextStop = 0;
  carrying = false;
  condition = 100;
  crashes = 0;
  distance = 0;
  respawnTimer = 0;
  inBox = true;
  readonly input: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 1, boost: false, airbrake: false };
  readonly previousPosition: Vector3;
  private readonly environment: FlightEnvironment;
  private readonly wind = new Vector3();
  private events: FreeFlightEvent[] = [];
  private lastCountdownValue: number;
  private groundedTimer = 0;
  private safeTimer = 0;
  private readonly safePoints: { position: Vector3; orientation: Quaternion }[] = [];
  private failure: FreeFlightResult['failure'] = null;
  private readonly showFloor: number;
  /** Zone the aircraft is currently inside without a valid pass (one hook-miss per entry). */
  private missedZone = -1;
  private strainTimer = 0;
  private scrapeCooldown = 0;

  constructor(
    readonly circuit: Circuit,
    readonly activity: FreeFlightActivity,
    build: AircraftBuild,
    readonly options: FreeFlightOptions,
  ) {
    this.baseParams = flightParametersForBuild(build);
    this.params = this.baseParams;
    this.environment = { ...flightEnvironmentFor(circuit), wind: this.wind };
    this.flight = createFlightState(circuit.spawn.position, circuit.spawn.orientation, circuit.spawn.speed);
    this.flight.throttle = 0.6;
    this.previousPosition = circuit.spawn.position.clone();
    this.countdown = activity.kind === 'explore' ? 0 : (options.countdownSeconds ?? 3);
    this.phase = this.countdown > 0 ? 'countdown' : 'flying';
    this.lastCountdownValue = Math.ceil(this.countdown) + 1;
    this.tricks = activity.kind === 'show' ? new TrickTracker() : null;
    this.stops = activity.kind === 'delivery' ? resolveStops(circuit, activity) : [];
    this.showFloor = activity.kind === 'show' ? showFloor(circuit, activity) : 0;
    this.discoveries = discoveriesIn(circuit.id).map((spec) => resolveDiscovery(circuit, spec));
    for (const id of options.discovered ?? []) this.found.add(id);
    this.logSafePoint();
  }

  get assist(): FlightAssist {
    return this.options.assist;
  }

  /** Seconds left in a timed air show (0 for other activities). */
  get timeLeft(): number {
    return this.activity.kind === 'show' ? Math.max(0, this.activity.duration - this.clock) : 0;
  }

  get windVector(): Vector3 {
    return this.wind;
  }

  /** Discoveries in this region not yet found (in the log or on this flight). */
  get undiscovered(): ResolvedDiscovery[] {
    return this.discoveries.filter((discovery) => !this.found.has(discovery.spec.id));
  }

  /** Distance to the nearest undiscovered thing within signal range, or null. */
  get signal(): { distance: number; discovery: ResolvedDiscovery } | null {
    let best: { distance: number; discovery: ResolvedDiscovery } | null = null;
    for (const discovery of this.undiscovered) {
      const distance = Math.hypot(
        discovery.position.x - this.flight.position.x,
        discovery.position.z - this.flight.position.z,
      );
      if (distance < SIGNAL_RANGE && (!best || distance < best.distance)) best = { distance, discovery };
    }
    return best;
  }

  /** The current delivery stop, or null once everything is delivered. */
  get currentStop(): ResolvedStop | null {
    return this.stops[this.nextStop] ?? null;
  }

  drainEvents(): FreeFlightEvent[] {
    const events = this.events;
    this.events = [];
    return events;
  }

  step(dt: number, input: FlightInput): void {
    if (this.phase === 'countdown') {
      this.countdown -= dt;
      const value = Math.max(0, Math.ceil(this.countdown));
      if (value < this.lastCountdownValue) {
        this.lastCountdownValue = value;
        if (value > 0) this.events.push({ type: 'countdown', value });
      }
      this.flight.throttle = clamp01(input.throttle);
      if (this.countdown <= 0) {
        this.phase = 'flying';
        this.events.push({ type: 'go' });
      }
      return;
    }
    if (this.phase === 'finished') {
      // Keep flying after the end so the view does not freeze behind the results.
      this.stepAircraft(dt, input);
      return;
    }
    this.clock += dt;

    if (this.respawnTimer > 0) {
      this.respawnTimer -= dt;
      if (this.respawnTimer <= 0) this.respawn();
      return;
    }

    this.stepAircraft(dt, input);
    const flight = this.flight;
    this.distance += flight.position.distanceTo(this.previousPosition);

    const grounded =
      flight.altitude < GROUNDED_ALTITUDE &&
      flight.groundContact !== 'splash' &&
      (flight.groundContact === 'scrape' || flight.speed < this.params.stallSpeed);
    this.groundedTimer = grounded ? this.groundedTimer + dt : 0;
    if (flight.groundContact === 'crash' || this.groundedTimer >= GROUNDED_SECONDS) {
      this.crash();
      return;
    }
    this.scrapeCooldown = Math.max(0, this.scrapeCooldown - dt);
    if (flight.groundContact === 'scrape') {
      // One knock per contact: bouncing along the ground for a few frames is one scrape.
      if (this.scrapeCooldown <= 0) {
        this.events.push({ type: 'scrape' });
        this.tricks?.interrupt(this.events);
        this.damageCargo(CARGO_SCRAPE_DAMAGE);
      }
      this.scrapeCooldown = SCRAPE_COOLDOWN;
    } else if (flight.groundContact === 'splash') {
      this.events.push({ type: 'splash' });
    }

    if (Math.hypot(flight.position.x, flight.position.z) > this.circuit.bounds) {
      this.events.push({ type: 'out-of-bounds' });
      this.tricks?.interrupt(this.events);
      this.respawnTimer = RESPAWN_DELAY * 0.5;
      return;
    }

    this.safeTimer += dt;
    if (this.safeTimer >= SAFE_INTERVAL) {
      this.safeTimer = 0;
      if (flight.altitude > 30 && !flight.stalled) this.logSafePoint();
    }

    this.stepDiscoveries();
    switch (this.activity.kind) {
      case 'show':
        this.stepShow(dt);
        break;
      case 'delivery':
        this.stepDelivery(dt, this.activity);
        break;
      case 'explore':
        break;
    }
  }

  /** Ends a free flight (from the pause menu). Other activities end on their own. */
  endFlight(): void {
    if (this.phase === 'finished') return;
    this.phase = 'finished';
    this.events.push({ type: 'complete' });
  }

  result(): FreeFlightResult {
    const tricks = this.tricks;
    const delivered = this.activity.kind === 'delivery' && this.nextStop >= this.stops.length;
    const completed =
      this.activity.kind === 'delivery'
        ? delivered
        : this.activity.kind === 'show'
          ? this.clock >= this.activity.duration
          : this.phase === 'finished';
    return {
      activityId: this.activity.id,
      completed,
      failure: this.failure,
      time: this.clock,
      crashes: this.crashes,
      score: tricks?.score ?? 0,
      figures: tricks?.figures ?? 0,
      variety: tricks?.variety ?? 0,
      bestChain: tricks?.bestChain ?? 0,
      condition: Math.round(this.condition),
      discoveries: this.discoveries
        .map((discovery) => discovery.spec.id)
        .filter((id) => this.found.has(id) && !(this.options.discovered?.has(id) ?? false)),
      distance: this.distance,
    };
  }

  private stepAircraft(dt: number, input: FlightInput): void {
    const flight = this.flight;
    this.environment.rollGust = sampleWind(
      this.options.conditions,
      this.clock,
      flight.position.x,
      flight.position.z,
      this.wind,
    );
    Object.assign(this.input, input);
    this.previousPosition.copy(flight.position);
    const wasOverheated = flight.overheated;
    stepFlight(flight, this.input, this.params, this.environment, dt, this.options.assist);
    if (!wasOverheated && flight.overheated && this.phase !== 'finished')
      this.events.push({ type: 'overheat' });
  }

  private crash(): void {
    this.crashes += 1;
    this.groundedTimer = 0;
    this.respawnTimer = RESPAWN_DELAY;
    this.flight.velocity.set(0, 0, 0);
    this.flight.speed = 0;
    this.events.push({ type: 'crash' });
    this.tricks?.interrupt(this.events);
    this.damageCargo(CARGO_CRASH_DAMAGE);
  }

  private logSafePoint(): void {
    this.safePoints.push({
      position: this.flight.position.clone(),
      orientation: this.flight.orientation.clone(),
    });
    const keep = Math.ceil(SAFE_LOOKBACK / SAFE_INTERVAL) + 1;
    if (this.safePoints.length > keep) this.safePoints.shift();
  }

  /** Back in the air at a safe point from a few seconds ago, heading toward the middle of the region. */
  private respawn(): void {
    const safe = this.safePoints[0] ?? {
      position: this.circuit.spawn.position,
      orientation: this.circuit.spawn.orientation,
    };
    const position = safe.position.clone();
    const ground = this.circuit.terrain.heightAt(position.x, position.z);
    position.y = Math.max(position.y + 20, ground + 60);
    let orientation = safe.orientation;
    _toCenter.set(this.circuit.center.x - position.x, 0, this.circuit.center.z - position.z);
    if (Math.hypot(position.x, position.z) > this.circuit.bounds * 0.85 && _toCenter.lengthSq() > 1) {
      orientation = lookOrientation(position, position.clone().add(_toCenter), _q);
    } else {
      // Level the wings on the way back in.
      _forward.set(0, 0, 1).applyQuaternion(safe.orientation);
      _forward.y = 0;
      if (_forward.lengthSq() < 1e-4) _forward.set(0, 0, 1);
      orientation = lookOrientation(position, position.clone().add(_forward), _q);
    }
    resetFlightState(this.flight, position, orientation, RESPAWN_SPEED);
    this.flight.boostEnergy = Math.max(this.flight.boostEnergy, 0.4);
    this.previousPosition.copy(position);
    this.groundedTimer = 0;
    this.safePoints.length = 0;
    this.logSafePoint();
    this.events.push({ type: 'respawn' });
  }

  // --- Air show ------------------------------------------------------------------------------

  private stepShow(dt: number): void {
    const activity = this.activity as ShowActivity;
    const { box } = activity;
    const p = this.flight.position;
    const inBox =
      Math.abs(p.x - box.x) < box.half &&
      Math.abs(p.z - box.z) < box.half &&
      p.y - this.showFloor < box.ceiling;
    if (inBox !== this.inBox) {
      this.inBox = inBox;
      this.events.push({ type: 'box', inside: inBox });
    }
    this.tricks!.step(this.flight, dt, inBox, this.events);
    if (this.clock >= activity.duration) {
      this.phase = 'finished';
      this.events.push({ type: 'time-up' });
    }
  }

  // --- Delivery -------------------------------------------------------------------------------

  private stepDelivery(dt: number, activity: DeliveryActivity): void {
    const stop = this.currentStop;
    const flight = this.flight;
    if (stop) {
      const horizontal = Math.hypot(flight.position.x - stop.position.x, flight.position.z - stop.position.z);
      const height = flight.position.y - stop.position.y;
      const inZone = horizontal < HOOK_RADIUS && height < activity.hookHeight + 25;
      if (inZone) {
        const tooHigh = height > activity.hookHeight;
        const tooFast = flight.speed * 3.6 > activity.hookSpeedKmh;
        if (!tooHigh && !tooFast) {
          this.hook(stop);
        } else if (this.missedZone !== this.nextStop) {
          this.missedZone = this.nextStop;
          this.events.push(
            tooFast
              ? {
                  type: 'hook-miss',
                  stop: this.nextStop,
                  reason: 'fast',
                  value: Math.round(flight.speed * 3.6),
                }
              : { type: 'hook-miss', stop: this.nextStop, reason: 'high', value: Math.round(height) },
          );
        }
      } else if (horizontal > HOOK_RADIUS * 1.5) {
        this.missedZone = -1;
      }
    }

    if (this.carrying) {
      const limit = (activity.cargo.bankLimit * Math.PI) / 180;
      const bank = Math.abs(flight.bank);
      // Past knife edge (or inverted) counts as fully over the limit.
      const bankExcess = bank > Math.PI / 2 ? Math.PI / 2 : Math.max(0, bank - limit);
      const pitchExcess = Math.max(0, Math.abs(flight.rates.x) - CARGO_PITCH_RATE);
      const damage = (bankExcess / (Math.PI / 6)) * CARGO_BANK_DAMAGE + pitchExcess * CARGO_PITCH_DAMAGE;
      if (damage > 0) {
        this.damageCargo(damage * dt);
        this.strainTimer -= dt;
        if (this.strainTimer <= 0) {
          this.strainTimer = 0.8;
          this.events.push({ type: 'strain', condition: Math.round(this.condition) });
        }
      } else {
        this.strainTimer = 0;
      }
    }
  }

  private hook(stop: ResolvedStop): void {
    const activity = this.activity as DeliveryActivity;
    this.events.push({ type: 'hook', stop: this.nextStop, kind: stop.kind, name: stop.name });
    this.missedZone = -1;
    if (stop.kind === 'pickup') {
      this.carrying = true;
      this.params = withCargo(this.baseParams, activity.cargo.mass);
    }
    this.nextStop += 1;
    if (this.nextStop >= this.stops.length) {
      this.carrying = false;
      this.params = this.baseParams;
      this.phase = 'finished';
      this.events.push({ type: 'complete' });
    }
  }

  private damageCargo(amount: number): void {
    if (!this.carrying || amount <= 0) return;
    this.condition = clamp(this.condition - amount, 0, 100);
    if (this.condition <= 0) {
      this.carrying = false;
      this.params = this.baseParams;
      this.failure = 'cargo-lost';
      this.phase = 'finished';
      this.events.push({ type: 'cargo-lost' });
    }
  }

  // --- Discoveries ------------------------------------------------------------------------------

  private stepDiscoveries(): void {
    const p = this.flight.position;
    for (const discovery of this.discoveries) {
      const id = discovery.spec.id;
      if (this.found.has(id)) continue;
      if (discovery.rings.length > 0) {
        let progress = this.trailProgress.get(id);
        for (const ring of discovery.rings) {
          if (progress?.has(ring.index)) continue;
          if (testRingCrossing(ring, this.previousPosition, p)) {
            if (!progress) {
              progress = new Set();
              this.trailProgress.set(id, progress);
            }
            progress.add(ring.index);
            this.events.push({
              type: 'trail-ring',
              id,
              collected: progress.size,
              total: discovery.rings.length,
            });
          }
        }
        if (progress && progress.size >= discovery.rings.length) this.discover(id);
        continue;
      }
      const horizontal = Math.hypot(p.x - discovery.position.x, p.z - discovery.position.z);
      const height = p.y - discovery.position.y;
      if (horizontal < DISCOVERY_RADIUS && height > -10 && height < DISCOVERY_HEIGHT) this.discover(id);
    }
  }

  private discover(id: string): void {
    this.found.add(id);
    this.events.push({ type: 'discovery', id });
  }
}
