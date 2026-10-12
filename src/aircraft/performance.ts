import { clamp, clamp01 } from '../core/math';
import { resolveBuild, type AircraftBuild, type ResolvedBuild } from './build';

export const GRAVITY = 9.81;
export const AIR_DENSITY = 1.2;
const DRAG_FACTOR = 0.5 * AIR_DENSITY; // drag = DRAG_FACTOR * dragArea * v²
const LIFT_FACTOR = 0.5 * AIR_DENSITY * 1.4; // 1.4 ≈ usable CL max
const REFERENCE_SPEED = 80; // m/s where wing "grip" values are specified
const REFERENCE_MASS = 1370; // kg, the default build
export const ABSOLUTE_MAX_SPEED = 210; // m/s safety cap

/** Parameters consumed directly by the flight model. */
export interface FlightParameters {
  mass: number;
  thrust: number;
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

/** Player-facing summary with explained attributes. */
export interface PerformanceSummary {
  mass: number;
  topSpeedKmh: number;
  accelerationSeconds: number; // 0 → 250 km/h
  turning: number; // 0..100 rating
  stability: number; // 0..100 rating
  heatManagement: number; // 0..100 rating
  boostEndurance: number; // seconds of continuous boost
  stallSpeedKmh: number;
  ratings: {
    topSpeed: number;
    acceleration: number;
    turning: number;
    stability: number;
    heat: number;
    boost: number;
  };
}

export const computeFlightParameters = (resolved: ResolvedBuild): FlightParameters => {
  const { fuselage, engine, wings } = resolved;
  const mass = fuselage.mass + engine.mass + wings.mass;
  const dragArea = fuselage.dragArea + engine.dragArea + wings.dragArea;
  const maxSpeed = Math.min(Math.sqrt(engine.thrust / (DRAG_FACTOR * dragArea)), ABSOLUTE_MAX_SPEED);
  const stallSpeed = Math.sqrt((mass * GRAVITY) / (LIFT_FACTOR * wings.liftArea));
  const massFactor = Math.sqrt(REFERENCE_MASS / mass);
  return {
    mass,
    thrust: engine.thrust,
    boostMultiplier: engine.boostMultiplier,
    dragArea,
    airbrakeDragArea: 1.6 + wings.dragArea,
    liftArea: wings.liftArea,
    stallSpeed,
    maxSpeed,
    pitchRate: fuselage.pitchRate * (0.85 + 0.15 * massFactor),
    rollRate: wings.rollRate * fuselage.rollFactor,
    yawRate: 0.55 * massFactor,
    responsiveness: fuselage.responsiveness,
    stability: clamp(fuselage.stability + wings.stability, 0.4, 2),
    grip: wings.grip * (0.7 + 0.3 * massFactor),
    gripExponent: wings.gripExponent,
    baseLoad: engine.baseLoad,
    boostLoad: engine.boostLoad,
    heatRate: engine.heatRate,
    coolRate: Math.max(0.04, engine.coolRate + fuselage.coolingBonus),
    boostCapacity: engine.boostCapacity,
    boostRechargeTime: engine.boostRechargeTime,
    durability: fuselage.durability,
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
    const accel = (params.thrust - drag) / params.mass;
    if (accel <= 0.001) return maxTime;
    speed += accel * dt;
    time += dt;
  }
  return time;
};

/** Seconds of continuous boost from the full-throttle heat equilibrium until overheating. */
export const secondsOfBoostBeforeOverheat = (
  params: Pick<FlightParameters, 'baseLoad' | 'boostLoad' | 'heatRate'>,
): number => {
  const load = params.baseLoad + params.boostLoad;
  if (load <= 1) return Infinity;
  const start = Math.min(params.baseLoad, 0.999);
  return Math.log((load - start) / (load - 1)) / params.heatRate;
};

const rate = (value: number, worst: number, best: number): number =>
  Math.round(clamp01((value - worst) / (best - worst)) * 100);

export const summarisePerformance = (params: FlightParameters): PerformanceSummary => {
  const accelerationSeconds = timeToSpeed(params, 250 / 3.6);
  const turningScore = params.pitchRate * 0.5 + gripAtSpeed(params, 90) * 0.5 + params.rollRate * 0.12;
  // Seconds of boost before overheating from the full-throttle equilibrium, plus how fast it cools back.
  const boostWindow = secondsOfBoostBeforeOverheat(params);
  const heatScore = Math.min(boostWindow, 8) / 8 + params.coolRate * 2;
  const summary: PerformanceSummary = {
    mass: params.mass,
    topSpeedKmh: Math.round(params.maxSpeed * 3.6),
    accelerationSeconds: Math.round(accelerationSeconds * 10) / 10,
    turning: rate(turningScore, 1.0, 2.0),
    stability: rate(params.stability, 0.5, 1.7),
    heatManagement: rate(heatScore, 0.3, 1.3),
    boostEndurance: params.boostCapacity,
    stallSpeedKmh: Math.round(params.stallSpeed * 3.6),
    ratings: {
      topSpeed: rate(params.maxSpeed, 80, 150),
      acceleration: rate(-accelerationSeconds, -20, -6),
      turning: rate(turningScore, 1.0, 2.0),
      stability: rate(params.stability, 0.5, 1.7),
      heat: rate(heatScore, 0.3, 1.3),
      boost: rate(params.boostCapacity, 2.5, 6),
    },
  };
  return summary;
};

export const performanceForBuild = (build: AircraftBuild): PerformanceSummary =>
  summarisePerformance(computeFlightParameters(resolveBuild(build)));

export const flightParametersForBuild = (build: AircraftBuild): FlightParameters =>
  computeFlightParameters(resolveBuild(build));
