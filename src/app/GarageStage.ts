import {
  AmbientLight,
  CircleGeometry,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  RingGeometry,
  Scene,
  SpotLight,
  Vector3,
} from 'three';
import type { ResolvedBuild } from '../aircraft/build';
import { AircraftView } from '../render/AircraftView';
import { NEUTRAL_INPUT, createFlightState, type FlightInput } from '../flight/FlightModel';
import { PALETTE } from '../render/materials';
import { clamp, damp } from '../core/math';
import type { Renderer } from '../render/Renderer';

/**
 * Studio presentation of the player's aircraft for the menu and garage.
 * Slow turntable with pointer-drag orbit and a subtle idle animation.
 */
export class GarageStage {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private view: AircraftView;
  private yaw = 0.6;
  private pitch = 0.18;
  private targetYaw = 0.6;
  private targetPitch = 0.18;
  private autoRotate = true;
  private dragging = false;
  private pointerId: number | null = null;
  private lastX = 0;
  private lastY = 0;
  private time = 0;
  private readonly idleState;
  private readonly idleInput: FlightInput = { ...NEUTRAL_INPUT, throttle: 0.35 };
  private readonly cleanups: (() => void)[] = [];
  /** Horizontal offset so the aircraft sits between the garage side panels. */
  focusOffset = 0;

  constructor(
    build: ResolvedBuild,
    private readonly renderer: Renderer,
  ) {
    this.camera = new PerspectiveCamera(38, renderer.aspect, 0.1, 400);
    this.scene.background = new Color(0x0f141d);
    this.scene.fog = new Fog(0x0f141d, 40, 120);

    this.scene.add(new HemisphereLight(0xdfe8ff, 0x2a2420, 1.4));
    this.scene.add(new AmbientLight(0xffffff, 0.15));
    const key = new DirectionalLight(0xfff1dc, 3.0);
    key.position.set(10, 14, 8);
    key.castShadow = renderer.options.shadows;
    if (key.castShadow) {
      key.shadow.mapSize.set(1024, 1024);
      key.shadow.camera.left = -14;
      key.shadow.camera.right = 14;
      key.shadow.camera.top = 14;
      key.shadow.camera.bottom = -14;
      key.shadow.camera.near = 1;
      key.shadow.camera.far = 60;
      key.shadow.bias = -0.0005;
    }
    this.scene.add(key);
    const rim = new SpotLight(0x2dd4ea, 60, 80, Math.PI / 5, 0.6, 1.2);
    rim.position.set(-14, 8, -12);
    this.scene.add(rim);
    const fill = new DirectionalLight(0xffc27a, 0.9);
    fill.position.set(-6, 3, 12);
    this.scene.add(fill);

    const floor = new Mesh(
      new CircleGeometry(40, 48),
      new MeshStandardMaterial({ color: 0x151b25, roughness: 0.85, metalness: 0.2 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -2.4;
    floor.receiveShadow = renderer.options.shadows;
    this.scene.add(floor);
    const ring = new Mesh(
      new RingGeometry(9.5, 10, 64),
      new MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amber, emissiveIntensity: 0.9 }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = -2.35;
    this.scene.add(ring);
    const ring2 = new Mesh(
      new RingGeometry(16, 16.2, 64),
      new MeshStandardMaterial({ color: 0x2b3442, emissive: 0x2b3442, emissiveIntensity: 0.5 }),
    );
    ring2.rotation.x = -Math.PI / 2;
    ring2.position.y = -2.35;
    this.scene.add(ring2);

    this.view = new AircraftView(build);
    this.scene.add(this.view.root);
    this.idleState = createFlightState(new Vector3(0, 0, 0), this.view.root.quaternion, 0);
    this.idleState.throttle = 0.35;
    this.bind(renderer.canvas);
  }

  private bind(canvas: HTMLCanvasElement): void {
    const down = (event: PointerEvent) => {
      if (!this.interactive) return;
      this.dragging = true;
      this.pointerId = event.pointerId;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.autoRotate = false;
      canvas.setPointerCapture(event.pointerId);
    };
    const move = (event: PointerEvent) => {
      if (!this.dragging || event.pointerId !== this.pointerId) return;
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
      this.targetYaw += dx * 0.008;
      this.targetPitch = clamp(this.targetPitch + dy * 0.005, -0.3, 0.9);
    };
    const up = (event: PointerEvent) => {
      if (event.pointerId !== this.pointerId) return;
      this.dragging = false;
      this.pointerId = null;
      window.setTimeout(() => {
        if (!this.dragging) this.autoRotate = true;
      }, 2500);
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
    });
  }

  /** Whether pointer drags should orbit (false while another screen covers the canvas). */
  interactive = true;

  setBuild(build: ResolvedBuild): void {
    this.view.setBuild(build);
  }

  update(dt: number): void {
    this.time += dt;
    if (this.autoRotate) this.targetYaw += dt * 0.25;
    this.yaw = damp(this.yaw, this.targetYaw, 6, dt);
    this.pitch = damp(this.pitch, this.targetPitch, 6, dt);
    const radius = 19;
    const x = Math.sin(this.yaw) * Math.cos(this.pitch) * radius;
    const z = Math.cos(this.yaw) * Math.cos(this.pitch) * radius;
    const y = Math.sin(this.pitch) * radius + 1.5;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.focusOffset, 0, 0);
    this.camera.aspect = this.renderer.aspect;
    this.camera.updateProjectionMatrix();

    // Gentle hover and exhaust idle.
    this.view.root.position.y = Math.sin(this.time * 0.9) * 0.15;
    this.view.root.rotation.z = Math.sin(this.time * 0.7) * 0.02;
    this.idleState.throttle = 0.35 + Math.sin(this.time * 2.1) * 0.05;
    this.view.animate(this.idleState, this.idleInput, dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.cleanups.forEach((fn) => fn());
    this.view.dispose();
  }
}
