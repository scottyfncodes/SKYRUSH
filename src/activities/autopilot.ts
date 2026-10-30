import { Vector3 } from 'three';
import { clamp, clamp01 } from '../core/math';
import { MAX_ASSISTED_BANK, type FlightInput, type FlightState } from '../flight/FlightModel';
import type { FlightParameters } from '../aircraft/performance';

const _forward = new Vector3();

/**
 * A simple point-to-point pilot for assisted steering: turns toward a target,
 * holds a target height and airspeed, and climbs away from rising ground. Used
 * by tests and the e2e harness to fly activities the way a careful pilot would.
 */
export const steerToPoint = (
  state: FlightState,
  params: FlightParameters,
  heightAt: (x: number, z: number) => number,
  target: { x: number; y: number; z: number },
  targetSpeed: number,
  out: FlightInput,
): FlightInput => {
  _forward.set(0, 0, 1).applyQuaternion(state.orientation);
  const dx = target.x - state.position.x;
  const dz = target.z - state.position.z;
  const horizontal = Math.max(1, Math.hypot(dx, dz));
  const headingNow = Math.atan2(-_forward.x, _forward.z);
  const headingTarget = Math.atan2(-dx, dz);
  let yawError = headingTarget - headingNow;
  while (yawError > Math.PI) yawError -= Math.PI * 2;
  while (yawError < -Math.PI) yawError += Math.PI * 2;

  const speed = Math.max(state.speed, 10);
  let safeY = target.y;
  for (const seconds of [0, 1, 2, 3, 4]) {
    const ground = heightAt(
      state.position.x + _forward.x * speed * seconds,
      state.position.z + _forward.z * speed * seconds,
    );
    safeY = Math.max(safeY, ground + (seconds === 0 ? 12 : 14 + seconds * 3));
  }
  const desiredPitch = clamp(Math.atan2(safeY - state.position.y, Math.min(horizontal, 600)), -0.35, 0.5);
  const bank = clamp(yawError * 2, -1, 1) * (state.position.y < safeY - 15 ? 0.4 : 1);
  out.roll = clamp(bank / MAX_ASSISTED_BANK, -1, 1);
  out.pitch = clamp((desiredPitch - state.pitchAngle) * 2.6 + Math.abs(Math.sin(state.bank)) * 0.2, -0.7, 1);
  out.yaw = clamp(yawError, -1, 1) * 0.6;
  const speedError = targetSpeed - state.speed;
  out.throttle = clamp01(0.55 + speedError * 0.08);
  out.airbrake = speedError < -6;
  out.boost = false;
  if (state.speed < params.stallSpeed * 1.1) {
    out.throttle = 1;
    out.airbrake = false;
  }
  return out;
};

/** The few things the delivery pilot needs from a free-flight simulation. */
interface DeliveryFlight {
  flight: FlightState;
  params: FlightParameters;
  nextStop: number;
  currentStop: { position: Vector3 } | null;
  circuit: {
    gates: readonly { position: Vector3 }[];
    terrain: { heightAt: (x: number, z: number) => number };
  };
}

/**
 * Flies a delivery the way its route is meant to be flown: along the valley (the
 * racing line's gates) toward each stop, then slow and low over the hook.
 */
export class DeliveryAutopilot {
  private gate = 0;

  constructor(
    private readonly stops: readonly { after: number }[],
    private readonly hookSpeedKmh: number,
  ) {}

  steer(sim: DeliveryFlight, out: FlightInput): FlightInput {
    const stop = sim.currentStop;
    const spec = this.stops[sim.nextStop];
    if (!stop || !spec) return out;
    const p = sim.flight.position;
    const gates = sim.circuit.gates;
    while (this.gate <= spec.after) {
      const g = gates[this.gate]!.position;
      if (Math.hypot(g.x - p.x, g.z - p.z) > 140) break;
      this.gate += 1;
    }
    const via = this.gate <= spec.after ? gates[this.gate]!.position : null;
    const distance = Math.hypot(p.x - stop.position.x, p.z - stop.position.z);
    const approach = !via && distance < 650;
    const hookSpeed = Math.max(this.hookSpeedKmh / 3.6 - 6, sim.params.stallSpeed * 1.25);
    const target = via
      ? { x: via.x, y: via.y, z: via.z }
      : { x: stop.position.x, y: stop.position.y + (approach ? 20 : 50), z: stop.position.z };
    return steerToPoint(
      sim.flight,
      sim.params,
      sim.circuit.terrain.heightAt,
      target,
      approach ? hookSpeed : sim.params.maxSpeed * 0.75,
      out,
    );
  }
}

/** A scripted display: alternating loops and rolls, as the e2e harness flies an air show. */
export const showPilot = (time: number, out: FlightInput): FlightInput => {
  const phase = time % 9;
  out.pitch = phase < 4.5 ? 1 : 0;
  out.roll = phase >= 5 ? 1 : 0;
  out.yaw = 0;
  out.throttle = 1;
  out.boost = false;
  out.airbrake = false;
  return out;
};
