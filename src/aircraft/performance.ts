import { clamp, clamp01 } from '../core/math';
import { resolveBuild, type AircraftBuild, type ResolvedBuild } from './build';

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.2;
const DRAG_FACTOR = 0.5 * AIR_DENSITY; // drag = DRAG_FACTOR * dragArea * v²
const LIFT_FACTOR = 0.5 * AIR_DENSITY * 1.4; // 1.4 ≈ usable CL max
const REFERENCE_SPEED = 80; // m/s where wing "grip" values are specified
const REFERENCE_MASS = 1370; // kg, the default build
/** Airspeed (m/s) at which a propeller's thrust bias is neutral. */
export const PROP_REFERENCE_SPEED = 100;
/** A propeller never drops below this fraction of its rated thrust. */
const PROP_MIN_FACTOR = 0.3;
export const ABSOLUTE_MAX_SPEED = 210; // m/s safety cap

/** Parameters consumed directly by the flight model. */
export interface FlightParameters {
  mass: number;
  thrust: number;
  /** Propeller thrust bias against airspeed (see `thrustAtSpeed`). Zero for a neutral prop. */
  propBias: number;
  boostMultiplier: number;
  dragArea: number;
  airbrakeDragArea: number;
  liftArea: number;
  stallSpeed: number;
  maxSpeed: number;
  pitchRate: number;
  rollRate: number;
  yawRate: number;
  responsiveness: number;
  stability: number;
  grip: number;
  gripExponent: number;
  baseLoad: number;
  boostLoad: number;
  heatRate: number;
  coolRate: number;
  boostCapacity: number;
  boostRechargeTime: number;
  durability: number;
}

export type RatingKey =
  | 'topSpeed'
  | 'acceleration'
  | 'climb'
  | 'retention'
  | 'agility'
  | 'turning'
  | 'stability'
  | 'lowSpeed'
  | 'toughness'
  | 'heat'
  | 'boost';

/** Player-facing summary. Every value is measured from the flight parameters above. */
export interface PerformanceSummary {
  mass: number;
  topSpeedKmh: number;
  accelerationSeconds: number; // 0 → 250 km/h
  /** Steady climb gradient at 200 km/h, percent. */
  climbPercent: number;
  /** Deceleration when coasting at 320 km/h with the throttle closed (m/s²). */
  coastDecel: number;
  /** Full roll-rate in degrees per second. */
  rollDegPerSec: number;
  turning: number; // 0..100 rating
  stability: number; // 0..100 rating
  heatManagement: number; // 0..100 rating
  boostEndurance: number; // seconds of continuous boost
  stallSpeedKmh: number;
  /** Highest descent rate (m/s) that is still a scrape rather than a crash. */
  scrapeTolerance: number;
  ratings: Record<RatingKey, number>;
}

/**
 * Diminishing returns: values inside [low, high] pass through unchanged, and
 * anything beyond counts half, so stacking parts never runs away.
 */
export const soften = (value: number, low: number, high: number): number => {
  if (value > high) return high + (value - high) * 0.5;
  if (value < low) return low - (low - value) * 0.5;
  return value;
};

/** Thrust (N) at an airspeed, before boost and overheat. */
export const thrustAtSpeed = (params: Pick<FlightParameters, 'thrust' | 'propBias'>, speed: number): number =>
  params.thrust * Math.max(PROP_MIN_FACTOR, 1 + params.propBias * (1 - speed / PROP_REFERENCE_SPEED));

/** Level-flight speed where thrust equals drag. */
const solveMaxSpeed = (thrust: number, bias: number, dragArea: number): number => {
  const c = DRAG_FACTOR * dragArea;
  const b = (thrust * bias) / PROP_REFERENCE_SPEED;
  const k = thrust * (1 + bias);
  return (-b + Math.sqrt(b * b + 4 * c * k)) / (2 * c);
};

export const computeFlightParameters = (resolved: ResolvedBuild): FlightParameters => {
  const { airframe, frame, engine, prop, wings, tail, gear } = resolved;
  const wingArea = airframe.wingScale * airframe.wingScale;
  const engines = engine.visual.twin ? 2 : 1;
  const mass =
    airframe.mass * frame.massFactor +
    engine.mass +
    prop.mass * engines +
    wings.mass * wingArea +
    tail.mass +
    gear.mass;
  const dragArea =
    airframe.dragArea +
    engine.dragArea +
    prop.dragArea * engines +
    wings.dragArea * wingArea +
    tail.dragArea +
    gear.dragArea;
  const liftArea = wings.liftArea * wingArea;
  const thrust = engine.thrust * prop.efficiency;
  const maxSpeed = Math.min(solveMaxSpeed(thrust, prop.bias, dragArea), ABSOLUTE_MAX_SPEED);
  const stallSpeed = Math.sqrt((mass * GRAVITY) / (LIFT_FACTOR * liftArea));
  const massFactor = Math.sqrt(REFERENCE_MASS / mass);
  const responseFactor = clamp(frame.responsiveness * tail.responsiveness, 0.85, 1.15);
  return {
    mass,
    thrust,
    propBias: prop.bias,
    boostMultiplier: engine.boostMultiplier,
    dragArea,
    airbrakeDragArea: 1.6 + wings.dragArea * wingArea,
    liftArea,
    stallSpeed,
    maxSpeed,
    pitchRate: airframe.pitchRate * tail.pitchFactor * (0.85 + 0.15 * massFactor),
    // Bigger wings damp roll more.
    rollRate: (wings.rollRate * airframe.rollFactor) / Math.sqrt(airframe.wingScale),
    yawRate: 0.55 * massFactor * tail.yawFactor,
    responsiveness: airframe.responsiveness * responseFactor,
    stability: clamp(
      soften(airframe.stability + wings.stability + tail.stability + frame.stability, 0.6, 1.3),
      0.4,
      2,
    ),
    grip: wings.grip * (0.7 + 0.3 * massFactor),
    gripExponent: wings.gripExponent,
    baseLoad: engine.baseLoad,
    boostLoad: engine.boostLoad,
    heatRate: engine.heatRate,
    coolRate: Math.max(0.04, engine.coolRate + airframe.coolingBonus),
    boostCapacity: engine.boostCapacity,
    boostRechargeTime: engine.boostRechargeTime,
    durability: Math.max(0.4, soften(airframe.durability + frame.durability + gear.durability, 0.5, 1.4)),
  };
};

/** Alignment rate (rad/s) of velocity toward the nose at a given airspeed. */
export const gripAtSpeed = (
  params: Pick<FlightParameters, 'grip' | 'gripExponent'>,
  speed: number,
): number => {
  const ratio = REFERENCE_SPEED / Math.max(speed, 15);
  return params.grip * clamp(ratio ** params.gripExponent, 0.35, 2.2);
};

/** Time to accelerate from standstill to `targetSpeed` in level flight with full throttle. */
export const timeToSpeed = (params: FlightParameters, targetSpeed: number, maxTime = 60): number => {
  const dt = 0.02;
  let speed = 0;
  let time = 0;
  while (speed < targetSpeed && time < maxTime) {
    const drag = DRAG_FACTOR * params.dragArea * speed * speed;
    const accel = (thrustAtSpeed(params, speed) - drag) / params.mass;
    if (accel <= 0.001) return maxTime;
    speed += accel * dt;
    time += dt;
  }
  return time;
};

/** Steady climb gradient (sin of the climb angle) at an airspeed with full throttle. */
export const climbGradient = (params: FlightParameters, speed: number): number =>
  (thrustAtSpeed(params, speed) - DRAG_FACTOR * params.dragArea * speed * speed) / (params.mass * GRAVITY);

/** Deceleration (m/s²) from drag alone at an airspeed: how quickly coasting bleeds speed. */
export const coastDeceleration = (params: FlightParameters, speed: number): number =>
  (DRAG_FACTOR * params.dragArea * speed * speed) / params.mass;

/** Seconds of continuous boost from the full-throttle heat equilibrium until overheating. */
export const secondsOfBoostBeforeOverheat = (
  params: Pick<FlightParameters, 'baseLoad' | 'boostLoad' | 'heatRate'>,
): number => {
  const load = params.baseLoad + params.boostLoad;
  if (load <= 1) return Infinity;
  const start = Math.min(params.baseLoad, 0.999);
  return Math.log((load - start) / (load - 1)) / params.heatRate;
};

/** Scrape tolerance as used by the flight model's ground contact check. */
export const scrapeTolerance = (params: Pick<FlightParameters, 'durability'>): number =>
  9 * Math.sqrt(params.durability);

const rate = (value: number, worst: number, best: number): number =>
  Math.round(clamp01((value - worst) / (best - worst)) * 100);

const CLIMB_SPEED = 200 / 3.6;
const COAST_SPEED = 320 / 3.6;

export const summarisePerformance = (params: FlightParameters): PerformanceSummary => {
  const accelerationSeconds = timeToSpeed(params, 250 / 3.6);
  const turningScore = params.pitchRate * 0.5 + gripAtSpeed(params, 90) * 0.5 + params.rollRate * 0.12;
  const agilityScore = params.rollRate * 0.25 + params.responsiveness * 0.08;
  // Seconds of boost before overheating from the full-throttle equilibrium, plus how fast it cools back.
  const boostWindow = secondsOfBoostBeforeOverheat(params);
  const heatScore = Math.min(boostWindow, 14) / 14 + params.coolRate * 2;
  const climb = climbGradient(params, CLIMB_SPEED);
  const coast = coastDeceleration(params, COAST_SPEED);
  const tolerance = scrapeTolerance(params);
  return {
    mass: params.mass,
    topSpeedKmh: Math.round(params.maxSpeed * 3.6),
    accelerationSeconds: Math.round(accelerationSeconds * 10) / 10,
    climbPercent: Math.round(clamp01(climb) * 100),
    coastDecel: Math.round(coast * 10) / 10,
    rollDegPerSec: Math.round((params.rollRate * 180) / Math.PI),
    turning: rate(turningScore, 1.0, 2.0),
    stability: rate(params.stability, 0.5, 1.7),
    heatManagement: rate(heatScore, 0.3, 1.5),
    boostEndurance: params.boostCapacity,
    stallSpeedKmh: Math.round(params.stallSpeed * 3.6),
    scrapeTolerance: Math.round(tolerance * 10) / 10,
    ratings: {
      topSpeed: rate(params.maxSpeed, 80, 150),
      acceleration: rate(-accelerationSeconds, -20, -6),
      climb: rate(climb, 0.25, 0.75),
      retention: rate(-coast, -6.5, -3),
      agility: rate(agilityScore, 0.8, 1.7),
      turning: rate(turningScore, 1.0, 2.0),
      stability: rate(params.stability, 0.5, 1.7),
      lowSpeed: rate(-params.stallSpeed, -46, -26),
      toughness: rate(tolerance, 6.5, 12),
      heat: rate(heatScore, 0.3, 1.5),
      boost: rate(params.boostCapacity, 2.5, 7),
    },
  };
};

export const performanceForBuild = (build: AircraftBuild): PerformanceSummary =>
  summarisePerformance(computeFlightParameters(resolveBuild(build)));

export const flightParametersForBuild = (build: AircraftBuild): FlightParameters =>
  computeFlightParameters(resolveBuild(build));

// --- Build character ----------------------------------------------------------------------

export type Specialty = 'Speed' | 'Agility' | 'Climb' | 'Endurance' | 'Stability';

export const SPECIALTY_AXES: Record<Specialty, readonly RatingKey[]> = {
  Speed: ['topSpeed', 'retention'],
  Agility: ['agility', 'turning'],
  Climb: ['climb', 'acceleration'],
  Endurance: ['heat', 'boost'],
  Stability: ['stability', 'lowSpeed', 'toughness'],
};

export interface BuildCharacter {
  /** e.g. "Speed", "Agility · Climb" or "Balanced". */
  label: string;
  /** Axes in descending order of how far they stand out. */
  leading: Specialty[];
  scores: Record<Specialty, number>;
}

/**
 * A build's character emerges from its parts: each axis averages its ratings,
 * and the axes that stand clearly above the build's own average lead the label.
 */
export const buildCharacter = (summary: PerformanceSummary): BuildCharacter => {
  const scores = {} as Record<Specialty, number>;
  for (const [axis, keys] of Object.entries(SPECIALTY_AXES) as [Specialty, readonly RatingKey[]][]) {
    scores[axis] = keys.reduce((sum, key) => sum + summary.ratings[key], 0) / keys.length;
  }
  const values = Object.values(scores);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const leading = (Object.keys(scores) as Specialty[])
    .filter((axis) => scores[axis] >= mean + 10)
    .sort((a, b) => scores[b] - scores[a])
    .slice(0, 2);
  return { label: leading.length === 0 ? 'Balanced' : leading.join(' · '), leading, scores };
};
