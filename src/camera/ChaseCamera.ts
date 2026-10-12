import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { clamp, damp } from '../core/math';
import type { FlightState } from '../flight/FlightModel';

const _forward = new Vector3();
const _up = new Vector3();
const _desired = new Vector3();
const _look = new Vector3();
const _gateDir = new Vector3();
const _worldUp = new Vector3(0, 1, 0);
const _blendUp = new Vector3();

/** Base vertical field of view. Kept close to the original so the zoom comes from distance, not distortion. */
export const BASE_FOV = 62;
/** Extra follow distance at top speed and while boosting, so speed still reads. */
const SPEED_STRETCH = 2.5;
const BOOST_STRETCH = 1.5;

/**
 * Smooth third-person chase camera.
 * Sits behind and above the aircraft, blends its roll partially with the
 * horizon so steep banks stay readable, and biases the look target toward
 * the next gate so the route is visible before the turn.
 */
export class ChaseCamera {
  readonly camera: PerspectiveCamera;
  private readonly position = new Vector3();
  private readonly target = new Vector3();
  private readonly upVector = new Vector3(0, 1, 0);
  private fov = BASE_FOV;
  private initialised = false;
  /** Follow distance behind the aircraft at rest (m). ~30% closer than the original 17 m. */
  distance = 12.5;
  /** Camera height above the aircraft (m). */
  height = 4.0;
  positionDamping = 7;
  targetDamping = 10;
  rollFollow = 0.45;

  constructor(aspect: number) {
    this.camera = new PerspectiveCamera(this.fov, aspect, 0.5, 9000);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Snap to the ideal position (used after respawn, restart or recenter). */
  snap(state: FlightState, nextGate?: Vector3): void {
    this.initialised = false;
    this.update(state, 1, nextGate);
  }

  update(state: FlightState, dt: number, nextGate?: Vector3): void {
    _forward.set(0, 0, 1).applyQuaternion(state.orientation);
    _up.set(0, 1, 0).applyQuaternion(state.orientation);
    _blendUp.copy(_worldUp).lerp(_up, this.rollFollow).normalize();

    const speedFactor = clamp(state.speed / 140, 0, 1);
    const boostStretch = state.boosting ? BOOST_STRETCH : 0;
    const distance = this.distance + speedFactor * SPEED_STRETCH + boostStretch;
    _desired.copy(state.position).addScaledVector(_forward, -distance).addScaledVector(_blendUp, this.height);

    // Look ahead of the nose, nudged toward the next gate.
    _look.copy(state.position).addScaledVector(_forward, 45);
    if (nextGate) {
      _gateDir.subVectors(nextGate, state.position);
      const gateDistance = _gateDir.length();
      if (gateDistance > 1) {
        _gateDir.divideScalar(gateDistance);
        const bias = clamp(1 - gateDistance / 900, 0.1, 0.35);
        _look.addScaledVector(_gateDir, 45 * bias);
      }
    }

    if (!this.initialised) {
      this.position.copy(_desired);
      this.target.copy(_look);
      this.upVector.copy(_blendUp);
      this.initialised = true;
    } else {
      const positionT = 1 - Math.exp(-this.positionDamping * dt);
      const targetT = 1 - Math.exp(-this.targetDamping * dt);
      this.position.lerp(_desired, positionT);
      this.target.lerp(_look, targetT);
      this.upVector.lerp(_blendUp, targetT).normalize();
    }

    const targetFov = BASE_FOV + speedFactor * 6 + (state.boosting ? 6 : 0);
    this.fov = damp(this.fov, targetFov, 4, dt);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    this.camera.position.copy(this.position);
    this.camera.up.copy(this.upVector);
    this.camera.lookAt(this.target);
  }

  /** Distance from the camera to the aircraft (m); exposed for tests. */
  distanceToAircraft(state: FlightState): number {
    return this.camera.position.distanceTo(state.position);
  }

  /** Quaternion helper for garage presentation reuse. */
  static readonly identity = new Quaternion();
}
