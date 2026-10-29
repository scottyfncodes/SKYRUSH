import type { Texture, Vector3 } from 'three';
import { Color, Group, MathUtils } from 'three';
import type { AircraftSetup } from '../aircraft/build';
import type { FlightInput, FlightState } from '../flight/FlightModel';
import { buildAircraftModel, type AircraftModelHandles } from './aircraftModel';
import { damp } from '../core/math';

const OVERHEAT_COLOR = new Color(0xff4a1a);
/** Altitude (m) above which retractable gear folds away. */
const GEAR_UP_ALTITUDE = 6;

/**
 * Binds a procedural aircraft model to a flight state: pose, control surface
 * animation, propeller spin and blur, gear retraction, exhaust and overheat glow.
 */
export class AircraftView {
  readonly root = new Group();
  private model: AircraftModelHandles;
  private aileron = 0;
  private elevator = 0;
  private rudder = 0;
  private brake = 0;
  private flame = 0;
  private heatGlow = 0;
  private rpm = 0;
  private gear = 1;
  private propAngle = 0;
  private flicker = 0;

  constructor(
    setup: AircraftSetup,
    private readonly envMap: Texture | null = null,
  ) {
    this.model = buildAircraftModel(setup, { envMap });
    this.root.add(this.model.root);
  }

  setSetup(setup: AircraftSetup): void {
    this.root.remove(this.model.root);
    this.model.dispose();
    this.model = buildAircraftModel(setup, { envMap: this.envMap });
    this.root.add(this.model.root);
  }

  get handles(): AircraftModelHandles {
    return this.model;
  }

  syncPose(state: FlightState): void {
    this.root.position.copy(state.position);
    this.root.quaternion.copy(state.orientation);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Snaps gear to its flight position (used when a race starts in the air). */
  setGearDown(down: boolean): void {
    this.gear = down ? 1 : 0;
  }

  /** Animates surfaces and effects from the latest input and flight state. */
  animate(state: FlightState, input: FlightInput, dt: number): void {
    this.aileron = damp(this.aileron, input.roll, 12, dt);
    this.elevator = damp(this.elevator, input.pitch, 12, dt);
    this.rudder = damp(this.rudder, input.yaw, 10, dt);
    this.brake = damp(this.brake, state.airbrake ? 1 : 0, 8, dt);
    const boost = state.boosting ? 1 : 0;
    const flameTarget = (0.35 + state.throttle * 0.5 + boost * 1.4) * (state.overheated ? 0.5 : 1);
    this.flame = damp(this.flame, flameTarget, 9, dt);
    this.heatGlow = damp(this.heatGlow, Math.max(0, (state.heat - 0.55) / 0.45), 4, dt);
    this.rpm = damp(this.rpm, 0.18 + state.throttle * 0.7 + boost * 0.12, 3, dt);
    this.gear = damp(this.gear, state.altitude > GEAR_UP_ALTITUDE ? 0 : 1, 1.6, dt);
    this.flicker += dt * 40;

    const { ailerons, elevators, rudders, airbrakes, exhausts, glows, accentMaterials, props, gearLegs } =
      this.model;
    // Roll right: left aileron trailing edge down, right one up.
    ailerons.left.rotation.x = -this.aileron * 0.45;
    ailerons.right.rotation.x = this.aileron * 0.45;
    for (const elevator of elevators) elevator.rotation.x = this.elevator * 0.42;
    for (const rudder of rudders) {
      // V-tail surfaces are also elevators; only pure rudders follow yaw.
      if (!elevators.includes(rudder)) rudder.rotation.x = this.rudder * 0.4;
    }
    for (const brake of airbrakes) brake.rotation.x = this.brake * 0.9;

    // Propellers: blades turn and fade into a blur disc as RPM rises.
    this.propAngle = (this.propAngle + this.rpm * 70 * dt) % (Math.PI * 2);
    const blur = MathUtils.smoothstep(this.rpm, 0.3, 0.7);
    for (const prop of props) {
      prop.spin.rotation.z = this.propAngle;
      prop.blades.opacity = 1 - blur * 0.82;
      prop.blades.depthWrite = blur < 0.5;
      (prop.disc.material as { opacity: number }).opacity = blur * 0.75;
    }
    for (const leg of gearLegs) leg.pivot.rotation.z = -leg.side * (1 - this.gear) * (Math.PI / 2);

    const flicker = 1 + Math.sin(this.flicker) * 0.08 + Math.sin(this.flicker * 2.7) * 0.05;
    const visible = state.throttle > 0.05;
    for (const exhaust of exhausts) {
      const base = (exhaust.userData.base as number | undefined) ?? 1;
      const length = MathUtils.clamp(this.flame, 0.1, 2.4) * flicker;
      exhaust.scale.set(base * (0.7 + this.flame * 0.2), base * (0.7 + this.flame * 0.2), base * length);
      exhaust.visible = visible;
    }
    for (const glow of glows) {
      glow.visible = visible && this.flame > 0.5;
    }
    const heatMaterial = accentMaterials[1];
    if (heatMaterial) {
      heatMaterial.emissiveIntensity = this.heatGlow * 1.6 + boost * 0.5;
      heatMaterial.emissive.copy(OVERHEAT_COLOR);
    }
  }

  worldPosition(target: Vector3): Vector3 {
    return target.copy(this.root.position);
  }

  dispose(): void {
    this.model.dispose();
  }
}
