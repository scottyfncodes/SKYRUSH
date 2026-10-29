import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  Fog,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  SRGBColorSpace,
  Scene,
  Vector3,
  type Material,
  type BufferGeometry,
  type Texture,
  type WebGLRenderTarget,
} from 'three';
import type { AircraftSetup } from '../aircraft/build';
import { AircraftView } from '../render/AircraftView';
import { NEUTRAL_INPUT, createFlightState, type FlightInput } from '../flight/FlightModel';
import { createEnvironmentMap } from '../render/envMap';
import { clamp, damp } from '../core/math';
import type { Renderer } from '../render/Renderer';

/** Where the camera looks for each hangar section. */
export type HangarFocus = 'overview' | 'engine' | 'prop' | 'wings' | 'tail' | 'gear' | 'frame' | 'paint';

const FOCUS: Record<
  HangarFocus,
  { yaw: number; pitch: number; zoom: number; target: [number, number, number] }
> = {
  overview: { yaw: 0.75, pitch: 0.2, zoom: 1, target: [0, 0, 0] },
  frame: { yaw: 1.35, pitch: 0.14, zoom: 0.95, target: [0, 0.2, -0.5] },
  engine: { yaw: 0.55, pitch: 0.1, zoom: 0.72, target: [0, 0.1, 2.6] },
  prop: { yaw: 0.25, pitch: 0.06, zoom: 0.66, target: [0, 0.1, 3.2] },
  wings: { yaw: 0.9, pitch: 0.62, zoom: 1.05, target: [0, 0, 0.4] },
  tail: { yaw: 2.45, pitch: 0.22, zoom: 0.75, target: [0, 0.6, -3.2] },
  gear: { yaw: 0.95, pitch: -0.02, zoom: 0.78, target: [0, -0.9, 0.6] },
  paint: { yaw: 1.5, pitch: 0.16, zoom: 0.95, target: [0, 0.1, 0] },
};

const FLOOR_Y = -2.2;
const _target = new Vector3();

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * The hangar: a sunlit workshop with the hangar door open to the sky. The
 * aircraft sits on its own gear on the painted floor; the player can orbit,
 * zoom and pinch, and the camera eases toward whichever part is being changed.
 */
export class GarageStage {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private view: AircraftView;
  private readonly environment: WebGLRenderTarget;
  private yaw = FOCUS.overview.yaw;
  private pitch = FOCUS.overview.pitch;
  private targetYaw = FOCUS.overview.yaw;
  private targetPitch = FOCUS.overview.pitch;
  private zoom = 1;
  private targetZoom = 1;
  private userZoom = 1;
  private readonly lookAt = new Vector3();
  private readonly targetLookAt = new Vector3();
  private autoRotate = true;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private time = 0;
  private reveal = 0;
  private readonly idleState;
  private readonly idleInput: FlightInput = { ...NEUTRAL_INPUT, throttle: 0.2 };
  private readonly cleanups: (() => void)[] = [];
  private readonly disposables: { dispose: () => void }[] = [];
  private readonly shadow: Mesh;
  private readonly key: DirectionalLight;
  private resumeTimer = 0;
  /**
   * The part of the screen (CSS px) the aircraft should fill: the gap between the
   * hangar's panels, or right of the menu. Null uses the whole screen.
   */
  frame: ScreenRect | null = null;
  /** Whether pointer drags should orbit (false while another screen covers the canvas). */
  interactive = true;

  constructor(
    setup: AircraftSetup,
    private readonly renderer: Renderer,
  ) {
    this.camera = new PerspectiveCamera(36, renderer.aspect, 0.1, 500);
    const haze = 0xe9dcc4;
    this.scene.background = new Color(0x1a2338);
    this.scene.fog = new Fog(haze, 70, 260);

    this.environment = createEnvironmentMap(renderer.gl, {
      zenith: 0x5f86b8,
      horizon: 0xf3dfbd,
      ground: 0x4a4038,
      sun: [0.2, 0.5, 1],
      sunColor: 0xfff0d6,
      panels: [
        { color: 0xffe8c8, direction: [0, 1, 0], size: 9 },
        { color: 0x9fc6ff, direction: [-1, 0.3, -0.6], size: 6 },
      ],
    });

    this.scene.add(new HemisphereLight(0xe4ecff, 0x6d5a46, 1.1));
    this.scene.add(new AmbientLight(0xffffff, 0.1));
    // Work lamps from the front; low sun pours in through the open door behind the aircraft.
    this.key = new DirectionalLight(0xfff0dc, 2.6);
    this.key.position.set(9, 12, 16);
    this.key.castShadow = renderer.options.shadows;
    if (this.key.castShadow) {
      this.key.shadow.mapSize.set(1024, 1024);
      const cam = this.key.shadow.camera;
      cam.left = -14;
      cam.right = 14;
      cam.top = 14;
      cam.bottom = -14;
      cam.near = 1;
      cam.far = 60;
      this.key.shadow.bias = -0.0006;
    }
    this.scene.add(this.key);
    const fill = new DirectionalLight(0xa9c6ff, 0.8);
    fill.position.set(-12, 6, -6);
    this.scene.add(fill);
    const rim = new DirectionalLight(0xffc27a, 2.2);
    rim.position.set(-6, 7, -18);
    this.scene.add(rim);

    this.buildHangar();

    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      new MeshBasicMaterial({
        map: this.track(blobTexture()),
        transparent: true,
        depthWrite: false,
        opacity: 0.55,
      }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = FLOOR_Y + 0.01;
    this.scene.add(this.shadow);
    this.disposables.push(this.shadow.geometry, this.shadow.material as Material);

    this.view = new AircraftView(setup, this.environment.texture);
    this.scene.add(this.view.root);
    this.place();
    this.idleState = createFlightState(new Vector3(0, 0, 0), this.view.root.quaternion, 0);
    this.idleState.throttle = 0.2;
    this.bind(renderer.canvas);
  }

  private track<T extends { dispose: () => void }>(item: T): T {
    this.disposables.push(item);
    return item;
  }

  private buildHangar(): void {
    const add = (geometry: BufferGeometry, material: Material, x: number, y: number, z: number) => {
      const mesh = new Mesh(geometry, material);
      mesh.position.set(x, y, z);
      this.scene.add(mesh);
      this.disposables.push(geometry, material);
      return mesh;
    };
    // Painted concrete floor with a turntable ring and a taxi line out of the door.
    const floor = add(
      new PlaneGeometry(140, 140),
      new MeshStandardMaterial({ map: this.track(floorTexture()), roughness: 0.82, metalness: 0.02 }),
      0,
      FLOOR_Y,
      0,
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = this.renderer.options.shadows;

    // Ink-blue corrugated walls; the far end is the open door, framing the aircraft against the sky.
    const wallMaterial = new MeshStandardMaterial({
      map: this.track(wallTexture()),
      roughness: 0.7,
      metalness: 0.3,
    });
    const back = add(new PlaneGeometry(70, 26), wallMaterial, 0, FLOOR_Y + 13, 34);
    back.rotation.y = Math.PI;
    const left = add(new PlaneGeometry(64, 26), wallMaterial.clone(), 32, FLOOR_Y + 13, 2);
    left.rotation.y = -Math.PI / 2;
    const right = add(new PlaneGeometry(64, 26), wallMaterial.clone(), -32, FLOOR_Y + 13, 2);
    right.rotation.y = Math.PI / 2;

    // The open door: a wide view of sky and distant mesas behind the front of the hangar.
    add(
      new PlaneGeometry(90, 34),
      new MeshBasicMaterial({ map: this.track(outsideTexture()), fog: false }),
      0,
      FLOOR_Y + 14,
      -52,
    );
    // Door frame and header beam.
    const steel = new MeshStandardMaterial({ color: 0x1b2232, roughness: 0.6, metalness: 0.5 });
    add(new BoxGeometry(64, 2.2, 1.2), steel, 0, FLOOR_Y + 19, -30);
    add(new BoxGeometry(1.6, 20, 1.6), steel.clone(), 31, FLOOR_Y + 9, -30);
    add(new BoxGeometry(1.6, 20, 1.6), steel.clone(), -31, FLOOR_Y + 9, -30);

    // Roof trusses.
    const truss = new MeshStandardMaterial({ color: 0x232b3c, roughness: 0.7, metalness: 0.4 });
    for (let i = 0; i < 5; i += 1) {
      add(new BoxGeometry(64, 0.5, 0.5), i === 0 ? truss : truss.clone(), 0, FLOOR_Y + 21, -24 + i * 12);
    }
    // Hanging work lamps.
    const lamp = new MeshBasicMaterial({ color: 0xfff1d2 });
    const shade = new MeshStandardMaterial({ color: 0xe0442a, roughness: 0.5, metalness: 0.2 });
    for (const [x, z] of [
      [-9, -6],
      [9, -6],
      [0, 8],
    ] as const) {
      add(new BoxGeometry(1.8, 0.5, 1.8), shade.clone(), x, FLOOR_Y + 15.5, z);
      add(new BoxGeometry(1.3, 0.08, 1.3), lamp.clone(), x, FLOOR_Y + 15.2, z);
    }
    this.disposables.push(lamp, shade, truss, steel, wallMaterial);

    // Workshop props: a vermilion tool chest, crates and wheel chocks.
    const chest = new MeshStandardMaterial({ color: 0xe0442a, roughness: 0.4, metalness: 0.3 });
    add(new BoxGeometry(2.4, 2.2, 1.1), chest, -15, FLOOR_Y + 1.1, -16);
    add(
      new BoxGeometry(2.5, 0.12, 1.15),
      new MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5 }),
      -15,
      FLOOR_Y + 2.26,
      -16,
    );
    const crate = new MeshStandardMaterial({ map: this.track(crateTexture()), roughness: 0.85 });
    add(new BoxGeometry(2.2, 2.2, 2.2), crate, 15, FLOOR_Y + 1.1, -17);
    add(new BoxGeometry(1.6, 1.6, 1.6), crate.clone(), 16.6, FLOOR_Y + 0.8, -14.6);
    add(new BoxGeometry(1.6, 1.6, 1.6), crate.clone(), 15.2, FLOOR_Y + 3, -17);
    const drum = new MeshStandardMaterial({ color: 0x1f6f6b, roughness: 0.5, metalness: 0.4 });
    add(new BoxGeometry(1, 1.5, 1), drum, -18.5, FLOOR_Y + 0.75, -12);
  }

  private bind(canvas: HTMLCanvasElement): void {
    const down = (event: PointerEvent) => {
      if (!this.interactive) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.autoRotate = false;
      window.clearTimeout(this.resumeTimer);
      canvas.setPointerCapture(event.pointerId);
      if (this.pointers.size === 2) this.pinchDistance = this.currentPinch();
    };
    const move = (event: PointerEvent) => {
      const last = this.pointers.get(event.pointerId);
      if (!last) return;
      const dx = event.clientX - last.x;
      const dy = event.clientY - last.y;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (this.pointers.size === 1) {
        this.targetYaw -= dx * 0.008;
        this.targetPitch = clamp(this.targetPitch + dy * 0.005, -0.08, 1.1);
      } else if (this.pointers.size === 2) {
        const distance = this.currentPinch();
        if (this.pinchDistance > 0) this.setUserZoom(this.userZoom * (this.pinchDistance / distance));
        this.pinchDistance = distance;
      }
    };
    const up = (event: PointerEvent) => {
      if (!this.pointers.delete(event.pointerId)) return;
      if (this.pointers.size < 2) this.pinchDistance = 0;
      if (this.pointers.size === 0) {
        window.clearTimeout(this.resumeTimer);
        this.resumeTimer = window.setTimeout(() => {
          if (this.pointers.size === 0) this.autoRotate = true;
        }, 6000);
      }
    };
    const wheel = (event: WheelEvent) => {
      if (!this.interactive) return;
      event.preventDefault();
      this.setUserZoom(this.userZoom * Math.exp(event.deltaY * 0.0012));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanups.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
      window.clearTimeout(this.resumeTimer);
    });
  }

  private currentPinch(): number {
    const [a, b] = [...this.pointers.values()];
    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private setUserZoom(value: number): void {
    this.userZoom = clamp(value, 0.55, 1.6);
  }

  /** Sits the aircraft on its gear on the floor, nose slightly up for tail-draggers. */
  private place(): void {
    const { stance, radius } = this.view.handles;
    const root = this.view.root;
    root.rotation.set(-stance.restPitch, 0, 0);
    root.position.set(0, FLOOR_Y - stance.ground, 0);
    this.shadow.scale.set(radius * 1.25, radius * 1.45, 1);
  }

  setSetup(setup: AircraftSetup): void {
    this.view.setSetup(setup);
    this.view.setGearDown(true);
    this.place();
  }

  /** Eases the camera toward a part of the aircraft. */
  setFocus(focus: HangarFocus): void {
    const f = FOCUS[focus];
    // Keep orbiting from the nearest equivalent angle so the camera never spins the long way round.
    const turns = Math.round((this.yaw - f.yaw) / (Math.PI * 2));
    this.targetYaw = f.yaw + turns * Math.PI * 2;
    this.targetPitch = f.pitch;
    this.targetZoom = f.zoom;
    this.targetLookAt.set(...f.target);
    this.autoRotate = focus === 'overview';
  }

  /** A slow sweep in from low and far: the first look at a new aircraft. */
  playReveal(): void {
    this.reveal = 1;
    this.yaw = this.targetYaw - 1.6;
    this.pitch = -0.05;
    this.zoom = 1.9;
    this.setFocus('overview');
  }

  update(dt: number): void {
    this.time += dt;
    if (this.autoRotate) this.targetYaw += dt * 0.12;
    const revealEase = this.reveal > 0 ? 1.4 : 6;
    this.reveal = Math.max(0, this.reveal - dt * 0.4);
    this.yaw = damp(this.yaw, this.targetYaw, revealEase * 0.6, dt);
    this.pitch = damp(this.pitch, this.targetPitch, revealEase * 0.6, dt);
    this.zoom = damp(this.zoom, this.targetZoom * this.userZoom, revealEase * 0.6, dt);
    this.lookAt.lerp(this.targetLookAt, 1 - Math.exp(-4 * dt));
    // Fit the aircraft into the free part of the screen: back the camera off until its
    // span fits the frame's width and its height fits the frame's height.
    const width = this.renderer.width;
    const height = this.renderer.height;
    const frame = this.frame ?? { left: 0, top: 0, right: width, bottom: height };
    const frameW = Math.max(120, frame.right - frame.left);
    const frameH = Math.max(90, frame.bottom - frame.top);
    this.camera.fov = this.renderer.aspect < 1.2 ? 50 : 36;
    const tanHalf = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    const subject = this.view.handles.radius * 0.82;
    const fit = Math.max(
      (subject * height) / (tanHalf * frameW * 0.92),
      (subject * 0.62 * height) / (tanHalf * frameH * 0.9),
    );
    const radius = Math.max(6, fit) * this.zoom;
    const root = this.view.root.position;
    const target = _target.set(this.lookAt.x, this.lookAt.y + root.y, this.lookAt.z);
    const x = Math.sin(this.yaw) * Math.cos(this.pitch) * radius;
    const z = Math.cos(this.yaw) * Math.cos(this.pitch) * radius;
    const y = Math.sin(this.pitch) * radius;
    this.camera.position.set(target.x + x, Math.max(FLOOR_Y + 0.5, target.y + y), target.z + z);
    this.camera.lookAt(target);
    this.camera.aspect = this.renderer.aspect;
    // Shift the projection so the aircraft centres in the free frame, not the screen.
    const centreX = (frame.left + frame.right) / 2;
    const centreY = (frame.top + frame.bottom) / 2;
    this.camera.setViewOffset(width, height, width / 2 - centreX, height / 2 - centreY, width, height);
    this.camera.updateProjectionMatrix();

    // Idle engine: prop ticking over, a little shimmer.
    this.idleState.throttle = 0.12 + Math.sin(this.time * 1.7) * 0.02;
    this.idleState.altitude = 0;
    this.view.animate(this.idleState, this.idleInput, dt);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.cleanups.forEach((fn) => fn());
    this.view.dispose();
    this.environment.dispose();
    for (const item of this.disposables) item.dispose();
  }
}

// --- Procedural hangar textures ----------------------------------------------------------------

const canvasTexture = (
  width: number,
  height: number,
  draw: (ctx: CanvasRenderingContext2D) => void,
): Texture => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (ctx) draw(ctx);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
};

const floorTexture = (): Texture =>
  canvasTexture(1024, 1024, (ctx) => {
    ctx.fillStyle = '#b9ae9b';
    ctx.fillRect(0, 0, 1024, 1024);
    // Expansion joints.
    ctx.fillStyle = 'rgba(60,52,44,0.25)';
    for (let i = 0; i <= 1024; i += 128) {
      ctx.fillRect(i, 0, 2, 1024);
      ctx.fillRect(0, i, 1024, 2);
    }
    // Oil stains and wear.
    for (let i = 0; i < 40; i += 1) {
      const x = (Math.sin(i * 12.9898) * 43758.5453) % 1;
      const y = (Math.sin(i * 78.233) * 12345.678) % 1;
      const gradient = ctx.createRadialGradient(
        512 + x * 400,
        512 + y * 400,
        0,
        512 + x * 400,
        512 + y * 400,
        40,
      );
      gradient.addColorStop(0, 'rgba(50,42,36,0.18)');
      gradient.addColorStop(1, 'rgba(50,42,36,0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 1024, 1024);
    }
    // Turntable circle and parking marks in sun-faded yellow.
    ctx.strokeStyle = 'rgba(232,184,74,0.85)';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(512, 512, 118, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(512, 512, 128, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = 'rgba(232,184,74,0.85)';
    ctx.fillRect(507, 640, 10, 384);
    for (let y = 660; y < 1024; y += 48) ctx.fillRect(470, y, 84, 6);
    ctx.save();
    ctx.translate(512, 330);
    ctx.fillStyle = 'rgba(224,68,42,0.75)';
    ctx.font = `700 64px Georgia, 'Times New Roman', serif`;
    ctx.textAlign = 'center';
    ctx.fillText('BAY 3', 0, 0);
    ctx.restore();
  });

const wallTexture = (): Texture =>
  canvasTexture(512, 256, (ctx) => {
    ctx.fillStyle = '#1f2a40';
    ctx.fillRect(0, 0, 512, 256);
    for (let x = 0; x < 512; x += 16) {
      const gradient = ctx.createLinearGradient(x, 0, x + 16, 0);
      gradient.addColorStop(0, 'rgba(255,255,255,0.05)');
      gradient.addColorStop(0.5, 'rgba(0,0,0,0.18)');
      gradient.addColorStop(1, 'rgba(255,255,255,0.05)');
      ctx.fillStyle = gradient;
      ctx.fillRect(x, 0, 16, 256);
    }
    ctx.fillStyle = 'rgba(241,232,212,0.75)';
    ctx.font = `700 22px 'Courier New', monospace`;
    ctx.fillText('SKYRUSH AERO WORKS', 150, 60);
    ctx.fillStyle = 'rgba(232,184,74,0.7)';
    ctx.fillRect(0, 230, 512, 10);
  });

const outsideTexture = (): Texture =>
  canvasTexture(1024, 512, (ctx) => {
    const sky = ctx.createLinearGradient(0, 0, 0, 512);
    sky.addColorStop(0, '#5f86b8');
    sky.addColorStop(0.62, '#f0d9b2');
    sky.addColorStop(0.72, '#e8c99a');
    sky.addColorStop(1, '#a88a66');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, 1024, 512);
    // Distant mesas.
    ctx.fillStyle = '#c08a62';
    ctx.beginPath();
    ctx.moveTo(0, 370);
    const tops = [
      [80, 330],
      [180, 330],
      [210, 360],
      [420, 352],
      [450, 300],
      [610, 300],
      [640, 350],
      [820, 344],
      [860, 318],
      [960, 318],
      [990, 360],
      [1024, 362],
    ];
    for (const [x, y] of tops) ctx.lineTo(x!, y!);
    ctx.lineTo(1024, 512);
    ctx.lineTo(0, 512);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#9c6c4c';
    ctx.fillRect(0, 380, 1024, 132);
    // A painted runway edge.
    ctx.fillStyle = '#6b5a4a';
    ctx.fillRect(0, 420, 1024, 92);
    ctx.fillStyle = 'rgba(241,232,212,0.8)';
    for (let x = 20; x < 1024; x += 90) ctx.fillRect(x, 460, 46, 6);
    // Soft clouds.
    ctx.fillStyle = 'rgba(255,248,236,0.55)';
    for (const [x, y, r] of [
      [180, 120, 50],
      [240, 110, 70],
      [300, 125, 45],
      [720, 80, 60],
      [790, 90, 40],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * 1.8, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  });

const crateTexture = (): Texture =>
  canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#a07a4e';
    ctx.fillRect(0, 0, 256, 256);
    ctx.strokeStyle = '#6e5233';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, 242, 242);
    ctx.beginPath();
    ctx.moveTo(10, 10);
    ctx.lineTo(246, 246);
    ctx.stroke();
    ctx.fillStyle = '#17233b';
    ctx.font = `700 26px 'Courier New', monospace`;
    ctx.fillText('SPARES', 74, 140);
  });

const blobTexture = (): Texture =>
  canvasTexture(128, 128, (ctx) => {
    const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    gradient.addColorStop(0, 'rgba(20,16,12,0.85)');
    gradient.addColorStop(0.55, 'rgba(20,16,12,0.4)');
    gradient.addColorStop(1, 'rgba(20,16,12,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
  });
