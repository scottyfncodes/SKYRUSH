import type { Vector3 } from 'three';
import { Color, Group, MathUtils } from 'three';
import type { ResolvedBuild } from '../aircraft/build';
import type { FlightInput, FlightState } from '../flight/FlightModel';
import { buildAircraftModel, type AircraftModelHandles } from './aircraftModel';
import { damp } from '../core/math';

const OVERHEAT_COLOR = new Color(0xff4a1a);
const _tmpColor = new Color();

/**
 * Binds a procedural aircraft model to a flight state: pose, control surface
 * animation, exhaust scaling, overheat glow and crash visibility.
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

  constructor(build: ResolvedBuild) {
    this.model = buildAircraftModel(build);
    this.root.add(this.model.root);
  }

  setBuild(build: ResolvedBuild): void {
    this.root.remove(this.model.root);
    this.model.dispose();
    this.model = buildAircraftModel(build);
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

  /** Animates surfaces and effects from the latest input and flight state. */
  animate(state: FlightState, input: FlightInput, dt: number): void {
    this.aileron = damp(this.aileron, input.roll, 12, dt);
    this.elevator = damp(this.elevator, input.pitch, 12, dt);
    this.rudder = damp(this.rudder, input.yaw, 10, dt);
    this.brake = damp(this.brake, state.airbrake ? 1 : 0, 8, dt);
    const flameTarget = state.throttle * (state.boosting ? 1.9 : 1) * (state.overheated ? 0.6 : 1);
    this.flame = damp(this.flame, flameTarget, 9, dt);
    this.heatGlow = damp(this.heatGlow, Math.max(0, (state.heat - 0.55) / 0.45), 4, dt);

    const { ailerons, elevators, rudders, airbrakes, exhausts, glows, accentMaterials } = this.model;
    ailerons.left.rotation.x = this.aileron * 0.5;
    ailerons.right.rotation.x = -this.aileron * 0.5;
    for (const elevator of elevators) elevator.rotation.x = this.elevator * 0.45;
    for (const rudder of rudders) rudder.rotation.y = -this.rudder * 0.4;
    airbrakes.forEach((brake, index) => {
      brake.rotation.x = -this.brake * 0.9;
      brake.rotation.z = (index === 0 ? 1 : -1) * this.brake * 0.15;
    });

    const flicker = 1 + Math.sin(performance.now() * 0.05) * 0.06;
    for (const exhaust of exhausts) {
      const length = MathUtils.clamp(this.flame, 0.05, 2.2) * flicker;
      exhaust.scale.y = length;
      exhaust.position.z = exhaust.userData.baseZ ?? (exhaust.userData.baseZ = exhaust.position.z);
      exhaust.position.z = (exhaust.userData.baseZ as number) - (length - 1) * 1.2;
      exhaust.visible = state.throttle > 0.05;
    }
    for (const glow of glows) {
      const s = 0.8 + this.flame * 0.5;
      glow.scale.set(s, s, 1);
      glow.visible = state.throttle > 0.05;
    }
    const heatMaterial = accentMaterials[1];
    if (heatMaterial) {
      heatMaterial.emissiveIntensity = this.heatGlow * 1.6;
      _tmpColor.copy(OVERHEAT_COLOR);
      heatMaterial.emissive.copy(_tmpColor);
    }
  }

  worldPosition(target: Vector3): Vector3 {
    return target.copy(this.root.position);
  }

  dispose(): void {
    this.model.dispose();
  }
}
