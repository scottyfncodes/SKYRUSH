import { Quaternion, Vector3 } from 'three';
import { clamp, clamp01, smoothstep } from '../core/math';
import {
  ABSOLUTE_MAX_SPEED,
  AIR_DENSITY,
  GRAVITY,
  gripAtSpeed,
  type FlightParameters,
} from '../aircraft/performance';

/**
 * SKYRUSH simcade flight model.
 *
 * Conventions (body frame): +X right, +Y up, +Z forward.
 * The model is deliberately simple and documented in docs/FLIGHT_MODEL.md:
 *  - control inputs command body rotation rates that respond with a first-order lag;
 *  - velocity is continuously re-aligned toward the nose at a speed-dependent
 *    "grip" rate, so high-speed turns need more room and sloppy inputs bleed energy;
 *  - lift cancels gravity along the body-up axis once above stall speed, so the
 *    aircraft goes where it points while banked or inverted flight sinks;
 *  - boost consumes a finite reserve and pushes engine heat above its equilibrium.
 */

export interface FlightInput {
  pitch: number; // -1..1, positive = nose up
  roll: number; // -1..1, positive = roll right
  yaw: number; // -1..1, positive = nose right
  throttle: number; // 0..1
  boost: boolean;
  airbrake: boolean;
}

export const NEUTRAL_INPUT: Readonly<FlightInput> = Object.freeze({
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 1,
  boost: false,
  airbrake: false,
});

export type GroundContact = 'none' | 'scrape' | 'crash';

export interface FlightState {
  position: Vector3;
  velocity: Vector3;
  orientation: Quaternion;
  /** Body rates in rad/s: x = pitch up, y = yaw right, z = roll right. */
  rates: Vector3;
  throttle: number;
  boostEnergy: number; // 0..1
  heat: number; // 0..1
  overheated: boolean;
  boosting: boolean;
  airbrake: boolean;
  speed: number;
  stalled: boolean;
  angleOfAttack: number; // radians between velocity and nose
  altitude: number; // metres above terrain
  groundContact: GroundContact;
  bank: number; // radians, positive = right wing down
  pitchAngle: number; // radians, positive = nose above horizon
}

export interface FlightEnvironment {
  terrainHeight: (x: number, z: number) => number;
  ceiling: number;
}

export interface FlightAssist {
  /** 0..1, how strongly the aircraft self-levels and damps. */
  strength: number;
}

export const DEFAULT_ASSIST: FlightAssist = { strength: 0.6 };

export const OVERHEAT_CLEAR_THRESHOLD = 0.7;
const OVERHEAT_THRUST_FACTOR = 0.55;
const CONTACT_HEIGHT = 1.5;
/** Assisted steering: roll input commands a bank angle up to this limit (≈72°). */
export const MAX_ASSISTED_BANK = 1.25;
/** Assisted steering: heading change per second at full bank. */
const ASSISTED_TURN_RATE = 1.15;
/** Assisted steering: the nose is kept within this pitch angle (≈57°) so the aircraft never loops. */
const ASSISTED_PITCH_LIMIT = 1.0;
const _worldYaw = new Quaternion();

const _forward = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _dir = new Vector3();
const _accel = new Vector3();
const _dq = new Quaternion();
const _axis = new Vector3();

export const createFlightState = (position: Vector3, orientation: Quaternion, speed: number): FlightState => {
  const forward = new Vector3(0, 0, 1).applyQuaternion(orientation);
  return {
    position: position.clone(),
    velocity: forward.multiplyScalar(speed),
    orientation: orientation.clone(),
    rates: new Vector3(),
    throttle: 1,
    boostEnergy: 1,
    heat: 0.2,
    overheated: false,
    boosting: false,
    airbrake: false,
    speed,
    stalled: false,
    angleOfAttack: 0,
    altitude: 0,
    groundContact: 'none',
    bank: 0,
    pitchAngle: 0,
  };
};

export const copyFlightState = (target: FlightState, source: FlightState): void => {
  target.position.copy(source.position);
  target.velocity.copy(source.velocity);
  target.orientation.copy(source.orientation);
  target.rates.copy(source.rates);
  target.throttle = source.throttle;
  target.boostEnergy = source.boostEnergy;
  target.heat = source.heat;
  target.overheated = source.overheated;
  target.boosting = source.boosting;
  target.airbrake = source.airbrake;
  target.speed = source.speed;
  target.stalled = source.stalled;
  target.angleOfAttack = source.angleOfAttack;
  target.altitude = source.altitude;
  target.groundContact = source.groundContact;
  target.bank = source.bank;
  target.pitchAngle = source.pitchAngle;
};

export const getForward = (state: FlightState, target: Vector3): Vector3 =>
  target.set(0, 0, 1).applyQuaternion(state.orientation);
export const getUp = (state: FlightState, target: Vector3): Vector3 =>
  target.set(0, 1, 0).applyQuaternion(state.orientation);
export const getRight = (state: FlightState, target: Vector3): Vector3 =>
  target.set(1, 0, 0).applyQuaternion(state.orientation);

/** Resets the aircraft to a known-good attitude and speed (used for respawns). */
export const resetFlightState = (
  state: FlightState,
  position: Vector3,
  orientation: Quaternion,
  speed: number,
): void => {
  state.position.copy(position);
  state.orientation.copy(orientation);
  getForward(state, state.velocity).multiplyScalar(speed);
  state.rates.set(0, 0, 0);
  state.speed = speed;
  state.stalled = false;
  state.angleOfAttack = 0;
  state.groundContact = 'none';
  state.heat = Math.min(state.heat, 0.5);
  state.overheated = false;
  state.boosting = false;
  state.airbrake = false;
};

const sanitiseInput = (input: FlightInput): FlightInput => ({
  pitch: clamp(Number.isFinite(input.pitch) ? input.pitch : 0, -1, 1),
  roll: clamp(Number.isFinite(input.roll) ? input.roll : 0, -1, 1),
  yaw: clamp(Number.isFinite(input.yaw) ? input.yaw : 0, -1, 1),
  throttle: clamp01(Number.isFinite(input.throttle) ? input.throttle : 0),
  boost: !!input.boost,
  airbrake: !!input.airbrake,
});

/**
 * Advances the flight state by `dt` seconds. The function mutates `state` and
 * never allocates, so it is safe to call 120 times per second.
 */
export const stepFlight = (
  state: FlightState,
  rawInput: FlightInput,
  params: FlightParameters,
  env: FlightEnvironment,
  dt: number,
  assist: FlightAssist = DEFAULT_ASSIST,
): void => {
  if (!(dt > 0)) return;
  const input = sanitiseInput(rawInput);
  const assistStrength = clamp01(assist.strength);

  // --- Throttle, boost and heat -------------------------------------------------
  state.throttle += clamp(input.throttle - state.throttle, -2.5 * dt, 2.5 * dt);
  state.airbrake = input.airbrake;

  const canBoost = input.boost && state.boostEnergy > 0.015 && !state.overheated && state.throttle > 0.25;
  state.boosting = canBoost;
  if (state.boosting) {
    state.boostEnergy = Math.max(0, state.boostEnergy - dt / params.boostCapacity);
  } else {
    state.boostEnergy = Math.min(1, state.boostEnergy + dt / params.boostRechargeTime);
  }

  const throttleLoad = state.throttle * state.throttle;
  const heatLoad = params.baseLoad * throttleLoad + (state.boosting ? params.boostLoad : 0);
  const heatDelta = heatLoad - state.heat;
  const coolingBonus = state.airbrake ? 1.3 : 1;
  const heatApproach = heatDelta > 0 ? params.heatRate : params.coolRate * coolingBonus;
  state.heat = clamp01(state.heat + heatDelta * (1 - Math.exp(-heatApproach * dt)));
  if (state.heat >= 0.999) state.overheated = true;
  if (state.overheated && state.heat < OVERHEAT_CLEAR_THRESHOLD) state.overheated = false;

  // --- Orientation and control authority -----------------------------------------
  getForward(state, _forward);
  getUp(state, _up);
  getRight(state, _right);
  const speed = state.velocity.length();
  state.speed = speed;
  state.bank = Math.atan2(-_right.y, _up.y);
  state.pitchAngle = Math.asin(clamp(_forward.y, -1, 1));

  const stallSpeed = params.stallSpeed;
  const lowSpeedAuthority = smoothstep(stallSpeed * 0.5, stallSpeed * 1.05, speed);
  const highSpeedStiffness = 1 - 0.35 * smoothstep(params.maxSpeed * 0.8, params.maxSpeed * 1.35, speed);
  const authority = lowSpeedAuthority * highSpeedStiffness;
  state.stalled = speed < stallSpeed * 0.95;

  // Angle of attack penalises sloppy control: a big gap between nose and velocity reduces authority.
  const aoaPenalty = 1 - 0.5 * smoothstep(0.35, 1.1, state.angleOfAttack);

  const stability = params.stability * (0.35 + 0.65 * assistStrength);
  const assisted = assistStrength > 0.05;
  let pitchTarget = input.pitch * params.pitchRate * authority * aoaPenalty;
  let rollTarget: number;
  let yawTarget = input.yaw * params.yawRate * authority;
  let headingRate = 0;

  // Stall: the nose drops until airspeed recovers.
  pitchTarget -= (1 - lowSpeedAuthority) * 0.7;

  const bankSin = Math.sin(state.bank);
  if (assisted) {
    // Assisted steering: the stick commands a bank angle, never a continuous roll,
    // so the aircraft cannot be rolled inverted by holding left or right. A banked
    // aircraft turns on its own (coordinated turn about the world up axis).
    const desiredBank = input.roll * MAX_ASSISTED_BANK;
    rollTarget =
      clamp((desiredBank - state.bank) * 3.2 * (0.6 + 0.4 * stability), -params.rollRate, params.rollRate) *
      authority *
      aoaPenalty;
    const speedFactor = clamp(80 / Math.max(speed, 20), 0.6, 1.15);
    headingRate = bankSin * ASSISTED_TURN_RATE * speedFactor * authority;
    // Soft pitch limit: the nose can always come back toward level but not past the limit.
    const headroomUp = (ASSISTED_PITCH_LIMIT - state.pitchAngle) * 4;
    const headroomDown = (ASSISTED_PITCH_LIMIT + state.pitchAngle) * 4;
    pitchTarget = clamp(pitchTarget, -headroomDown, headroomUp);
    // A little nose-up while banked keeps the turn level without hauling on the stick.
    pitchTarget += Math.abs(bankSin) * 0.12 * authority;
  } else {
    // Direct control: roll input commands a roll rate and only a mild coordinated yaw helps.
    rollTarget = input.roll * params.rollRate * authority * aoaPenalty;
    yawTarget += bankSin * Math.abs(Math.cos(state.bank)) * 0.5 * authority;
    if (Math.abs(input.roll) < 0.05) {
      const level = clamp(-state.bank * 1.8 * stability, -params.rollRate * 0.6, params.rollRate * 0.6);
      rollTarget += level * authority;
    }
  }

  // Stability assistance: settle the nose toward level when the stick is centred.
  if (Math.abs(input.pitch) < 0.05) {
    const targetPitch = 0.03; // slight nose-up bias keeps cruise level despite tiny sink.
    const level = clamp((targetPitch - state.pitchAngle) * 1.2 * stability, -0.5, 0.5);
    pitchTarget += level * authority * Math.cos(state.bank);
  }

  const response = 1 - Math.exp(-params.responsiveness * dt);
  state.rates.x += (pitchTarget - state.rates.x) * response;
  state.rates.y += (yawTarget - state.rates.y) * response;
  state.rates.z += (rollTarget - state.rates.z) * response;

  // Apply body rotations (see conventions at the top of the file).
  _dq.setFromAxisAngle(_axis.set(1, 0, 0), -state.rates.x * dt);
  state.orientation.multiply(_dq);
  _dq.setFromAxisAngle(_axis.set(0, 1, 0), state.rates.y * dt);
  state.orientation.multiply(_dq);
  _dq.setFromAxisAngle(_axis.set(0, 0, 1), -state.rates.z * dt);
  state.orientation.multiply(_dq);
  if (headingRate !== 0) {
    // Heading change about the world up axis keeps bank and pitch intact.
    _worldYaw.setFromAxisAngle(_axis.set(0, 1, 0), headingRate * dt);
    state.orientation.premultiply(_worldYaw);
  }
  state.orientation.normalize();
  getForward(state, _forward);
  getUp(state, _up);

  // --- Forces ------------------------------------------------------------------
  let thrust = params.thrust * state.throttle;
  if (state.boosting) thrust *= params.boostMultiplier;
  if (state.overheated) thrust *= OVERHEAT_THRUST_FACTOR;
  const dragArea = params.dragArea + (state.airbrake ? params.airbrakeDragArea : 0);
  const drag = 0.5 * AIR_DENSITY * dragArea * speed * speed;

  const liftFraction = clamp01((speed / stallSpeed) ** 2);

  _accel.set(0, -GRAVITY, 0);
  _accel.addScaledVector(_forward, thrust / params.mass);
  _accel.addScaledVector(_up, GRAVITY * liftFraction);
  if (assisted) {
    // Assisted turns are altitude-neutral: restore the vertical lift lost to bank.
    const lost = GRAVITY * liftFraction * (1 - Math.max(0, _up.y));
    _accel.y += lost * assistStrength;
  }
  if (speed > 0.01) {
    _dir.copy(state.velocity).divideScalar(speed);
    _accel.addScaledVector(_dir, -drag / params.mass);
  }
  state.velocity.addScaledVector(_accel, dt);

  // --- Velocity alignment ("grip") -------------------------------------------------
  const newSpeed = state.velocity.length();
  if (newSpeed > 0.01) {
    _dir.copy(state.velocity).divideScalar(newSpeed);
    const cosAngle = clamp(_dir.dot(_forward), -1, 1);
    const angle = Math.acos(cosAngle);
    state.angleOfAttack = angle;
    if (angle > 1e-4) {
      const maxTurn = gripAtSpeed(params, newSpeed) * (0.5 + 0.5 * lowSpeedAuthority) * dt;
      const t = Math.min(1, maxTurn / angle);
      _dir.lerp(_forward, t).normalize();
      // Turning bleeds energy proportionally to how far the nose is from the velocity vector.
      const bleed = clamp01(angle * 0.45 * dt);
      state.velocity.copy(_dir).multiplyScalar(newSpeed * (1 - bleed));
    }
  } else {
    state.angleOfAttack = 0;
  }

  // Hard cap for safety.
  const cappedSpeed = state.velocity.length();
  if (cappedSpeed > ABSOLUTE_MAX_SPEED) {
    state.velocity.multiplyScalar(ABSOLUTE_MAX_SPEED / cappedSpeed);
  }

  // --- Integrate position ------------------------------------------------------------
  state.position.addScaledVector(state.velocity, dt);
  state.speed = state.velocity.length();

  // --- Ceiling and ground ---------------------------------------------------------------
  if (state.position.y > env.ceiling) {
    state.position.y = env.ceiling;
    if (state.velocity.y > 0) state.velocity.y *= 0.2;
  }

  const ground = env.terrainHeight(state.position.x, state.position.z);
  state.altitude = state.position.y - ground;
  state.groundContact = 'none';
  if (state.altitude < CONTACT_HEIGHT) {
    const descentRate = -state.velocity.y;
    const scrapeTolerance = 9 * Math.sqrt(params.durability);
    const nosePointingDown = _forward.y < -0.35;
    if (descentRate < scrapeTolerance && !nosePointingDown) {
      state.groundContact = 'scrape';
      state.position.y = ground + CONTACT_HEIGHT;
      state.velocity.y = Math.max(state.velocity.y, 0) + 4;
      state.velocity.multiplyScalar(0.8);
      state.rates.x = Math.max(state.rates.x, 0.6);
      state.speed = state.velocity.length();
      state.altitude = CONTACT_HEIGHT;
    } else {
      state.groundContact = 'crash';
    }
  }
};
