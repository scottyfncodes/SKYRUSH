import { Quaternion, Vector3 } from 'three';
import { clamp, clamp01, wrapAngle } from '../core/math';
import type { AircraftBuild } from '../aircraft/build';
import type { FlightParameters } from '../aircraft/performance';
import { MAX_ASSISTED_BANK, type FlightInput, type FlightState } from '../flight/FlightModel';
import type { Circuit } from '../course/circuit';

export type AiStyle = 'precision' | 'aggressive' | 'speed';

export interface AiPersonality {
  id: string;
  name: string;
  callsign: string;
  style: AiStyle;
  build: AircraftBuild;
  /** How early the pilot slows for corners (1 = textbook, <1 = late braking). */
  cornerCaution: number;
  /** Minimum corner speed as a fraction of top speed. */
  cornerSpeedFloor: number;
  /** Heat level above which the pilot refuses to boost. */
  boostHeatLimit: number;
  /** Maximum angle (rad) to the next gate for the pilot to consider boosting. */
  boostAlignment: number;
  /** Steering gain multiplier. */
  gain: number;
  maxBank: number; // radians
  lineOffset: number; // metres right of gate centre
  /** 0..1 overall throttle ceiling: the player must be able to win. */
  skill: number;
}

export const AI_PERSONALITIES: readonly AiPersonality[] = [
  {
    id: 'ai-precision',
    name: 'Mira Castellan',
    callsign: 'ORBIT',
    style: 'precision',
    build: {
      fuselage: 'fuselage-allrounder',
      engine: 'engine-efficient',
      wings: 'wings-balanced',
      livery: 'livery-glacier',
    },
    cornerCaution: 0.9,
    cornerSpeedFloor: 0.62,
    boostHeatLimit: 0.6,
    boostAlignment: 0.12,
    gain: 1.0,
    maxBank: 1.05,
    lineOffset: 0,
    skill: 1.0,
  },
  {
    id: 'ai-aggressive',
    name: 'Dax Reyes',
    callsign: 'VANDAL',
    style: 'aggressive',
    build: {
      fuselage: 'fuselage-needle',
      engine: 'engine-efficient',
      wings: 'wings-compact',
      livery: 'livery-signal',
    },
    cornerCaution: 0.8,
    cornerSpeedFloor: 0.72,
    boostHeatLimit: 0.85,
    boostAlignment: 0.22,
    gain: 1.25,
    maxBank: 1.25,
    lineOffset: -7,
    skill: 0.84,
  },
  {
    id: 'ai-speed',
    name: 'Jun Okafor',
    callsign: 'LONGSHOT',
    style: 'speed',
    build: {
      fuselage: 'fuselage-heavy',
      engine: 'engine-twin',
      wings: 'wings-balanced',
      livery: 'livery-midnight',
    },
    cornerCaution: 1.1,
    cornerSpeedFloor: 0.5,
    boostHeatLimit: 0.75,
    boostAlignment: 0.08,
    gain: 0.9,
    maxBank: 0.95,
    lineOffset: 7,
    skill: 0.95,
  },
];

/**
 * Opponent skill ramps with the player's wins so a new pilot can podium with the
 * starter aircraft while an experienced one still gets a fight.
 */
export const difficultyMultiplier = (wins: number): number => clamp(0.78 + 0.044 * wins, 0.78, 1.0);

const _target = new Vector3();
const _toTarget = new Vector3();
const _cruiseForward = new Vector3();
const _forward = new Vector3();
const _inverse = new Quaternion();
const _local = new Vector3();
const _toNext = new Vector3();
const _toAfter = new Vector3();

/**
 * Waypoint-following controller. Deterministic given the same state.
 * Steers toward the next gate (biased toward the one after when close),
 * banks into turns, slows for sharp corners, boosts on straights, and
 * pulls up when the terrain ahead rises.
 */
export const computeAiInput = (
  state: FlightState,
  params: FlightParameters,
  circuit: Circuit,
  nextGateIndex: number,
  personality: AiPersonality,
  out: FlightInput,
  skillMultiplier = 1,
): FlightInput => {
  const gates = circuit.gates;
  const gate = gates[Math.min(nextGateIndex, gates.length - 1)]!;
  const after = gates[Math.min(nextGateIndex + 1, gates.length - 1)]!;

  // Aim point: the gate centre shifted along the gate's width for a racing line.
  _target.copy(gate.position).addScaledVector(gate.right, personality.lineOffset);
  _toTarget.subVectors(_target, state.position);
  const distance = _toTarget.length();

  // When very close to the gate, start looking at the next one so the exit is smooth.
  if (distance < 70 && nextGateIndex + 1 < gates.length) {
    _toAfter.subVectors(after.position, state.position).normalize();
    _toTarget
      .normalize()
      .lerp(_toAfter, clamp01((70 - distance) / 70) * 0.6)
      .normalize();
  } else {
    _toTarget.normalize();
  }

  _forward.set(0, 0, 1).applyQuaternion(state.orientation);

  // Horizontal heading error (positive = target is to the pilot's right, i.e. the -X side).
  const headingNow = Math.atan2(-_forward.x, _forward.z);
  const headingTarget = Math.atan2(-_toTarget.x, _toTarget.z);
  const yawError = wrapAngle(headingTarget - headingNow);

  // Vertical: desired climb angle toward the target plus a terrain margin.
  const horizontalDistance = Math.max(10, Math.hypot(_toTarget.x, _toTarget.z) * distance);
  let desiredPitch = Math.atan2(_toTarget.y * distance, horizontalDistance);

  const speed = Math.max(state.speed, 10);
  const lookAheadSeconds = 2.2;
  const aheadX = state.position.x + _forward.x * speed * lookAheadSeconds;
  const aheadZ = state.position.z + _forward.z * speed * lookAheadSeconds;
  const groundAhead = circuit.terrain.heightAt(aheadX, aheadZ);
  const groundHere = circuit.terrain.heightAt(state.position.x, state.position.z);
  const clearanceAhead = state.position.y - groundAhead;
  const clearanceHere = state.position.y - groundHere;
  const minClearance = 45;
  let terrainPanic = 0;
  if (clearanceAhead < minClearance || clearanceHere < 30) {
    terrainPanic = clamp01((minClearance - Math.min(clearanceAhead, clearanceHere)) / 25);
    desiredPitch = Math.max(desiredPitch, 0.25 + terrainPanic * 0.3);
  }

  const gain = personality.gain;
  const desiredBank =
    clamp(yawError * 2.2 * gain, -personality.maxBank, personality.maxBank) * (1 - terrainPanic);
  // AI pilots fly with assisted steering, where roll input is a bank-angle command.
  const roll = clamp(desiredBank / MAX_ASSISTED_BANK, -1, 1);

  // Pull into the turn while banked, plus a vertical correction.
  _inverse.copy(state.orientation).invert();
  _local.copy(_toTarget).applyQuaternion(_inverse);
  const verticalCorrection = (desiredPitch - state.pitchAngle) * 2.4 * gain;
  const turnPull = Math.abs(Math.sin(state.bank)) * clamp01(Math.abs(yawError) * 2.5) * 0.35;
  let pitch = clamp(verticalCorrection + turnPull + _local.y * 0.8, -0.6, 1);
  if (terrainPanic > 0) pitch = Math.max(pitch, 0.5 + terrainPanic * 0.5);
  const yaw = clamp(yawError * 1.2 * gain, -1, 1);

  // Speed management: slow for the turn through the upcoming gate.
  // Lower skill means a more cautious pilot: earlier braking, slower corners, less boost.
  const skill = clamp01(personality.skill * skillMultiplier);
  const caution = personality.cornerCaution * (1.9 - 0.9 * skill);
  _toNext.subVectors(gate.position, state.position).normalize();
  _toAfter.subVectors(after.position, gate.position).normalize();
  const turnAngle = nextGateIndex + 1 < gates.length ? Math.acos(clamp(_toNext.dot(_toAfter), -1, 1)) : 0;
  const cornerSpeed =
    params.maxSpeed *
    clamp(1 - (turnAngle / Math.PI) * 1.4 * caution, personality.cornerSpeedFloor * skill, 1);
  const brakingDistance = speed * 2.4 * caution;
  const inBrakingZone = distance < brakingDistance && turnAngle > 0.3;
  const misaligned = Math.abs(yawError) > 0.8;

  const throttleCap = 0.5 + 0.5 * skill;
  let throttle = throttleCap;
  let airbrake = false;
  if (inBrakingZone && speed > cornerSpeed) {
    throttle = clamp(throttleCap * (cornerSpeed / speed) * 0.7, 0.3, 1);
    airbrake = speed > cornerSpeed * 1.2 && turnAngle > 0.6;
  }
  if (misaligned) {
    throttle = Math.min(throttle, 0.55);
    airbrake = airbrake || speed > params.maxSpeed * 0.75;
  }
  if (state.stalled) {
    throttle = 1;
    airbrake = false;
  }

  const straightAhead = Math.abs(yawError) < personality.boostAlignment && distance > 220 && turnAngle < 0.45;
  const boost =
    straightAhead &&
    !inBrakingZone &&
    !state.overheated &&
    state.heat < personality.boostHeatLimit * skill &&
    state.boostEnergy > 0.25 &&
    skill > 0.78 &&
    terrainPanic === 0;

  out.pitch = pitch;
  out.roll = roll;
  out.yaw = yaw;
  out.throttle = throttle;
  out.boost = boost;
  out.airbrake = airbrake;
  return out;
};

/**
 * Post-finish cruise: fly straight ahead at a safe height over the terrain so
 * finished racers never plough into the scenery while the results come up.
 */
export const computeCruiseInput = (state: FlightState, circuit: Circuit, out: FlightInput): FlightInput => {
  _cruiseForward.set(0, 0, 1).applyQuaternion(state.orientation);
  const horizontal = Math.hypot(_cruiseForward.x, _cruiseForward.z) || 1;
  const dirX = _cruiseForward.x / horizontal;
  const dirZ = _cruiseForward.z / horizontal;
  const speed = Math.max(state.speed, 20);
  let highest = circuit.terrain.heightAt(state.position.x, state.position.z);
  for (let seconds = 1; seconds <= 4; seconds += 1) {
    const h = circuit.terrain.heightAt(
      state.position.x + dirX * speed * seconds,
      state.position.z + dirZ * speed * seconds,
    );
    if (h > highest) highest = h;
  }
  const targetAltitude = highest + 120;
  const altitudeError = targetAltitude - state.position.y;
  const desiredPitch = clamp(altitudeError / 200, -0.15, 0.45);
  out.pitch = clamp((desiredPitch - state.pitchAngle) * 2.5, -0.6, 1);
  out.roll = 0; // assisted steering levels the wings on its own
  out.yaw = 0;
  out.throttle = 0.6;
  out.boost = false;
  out.airbrake = false;
  return out;
};
