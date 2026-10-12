import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Camera,
  type Quaternion,
  type Scene,
  Vector3,
} from 'three';
import { createRng } from '../core/rng';
import { clamp01, smoothstep } from '../core/math';

const STREAKS = 56;
const STREAK_NEAR = -3;
const STREAK_FAR = -70;

/**
 * Peripheral speed streaks in camera space. They only appear near top speed or
 * while boosting, stay away from the centre of the screen (where the aircraft
 * and the next gate are), and cost one draw call.
 */
export class SpeedLines {
  private readonly group = new Group();
  private readonly lines: LineSegments;
  private readonly material: LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly angle = new Float32Array(STREAKS);
  /** Off-axis slope (tan of the angle from the view axis): streaks never cross the centre. */
  private readonly slope = new Float32Array(STREAKS);
  private readonly depth = new Float32Array(STREAKS);
  private readonly rng = createRng(4242);
  private intensity = 0;

  constructor(scene: Scene) {
    this.positions = new Float32Array(STREAKS * 6);
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.material = new LineBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    this.lines = new LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    this.group.add(this.lines);
    this.group.visible = false;
    for (let i = 0; i < STREAKS; i += 1)
      this.respawn(i, STREAK_FAR + this.rng() * (STREAK_NEAR - STREAK_FAR));
    scene.add(this.group);
  }

  private respawn(i: number, depth: number): void {
    this.angle[i] = this.rng() * Math.PI * 2;
    // Between ~14° and ~38° off the view axis: the centre of the screen stays clear.
    this.slope[i] = 0.25 + this.rng() * 0.53;
    this.depth[i] = depth;
  }

  /** `level` is 0..1 (how fast it feels); `speed` drives the streak motion in m/s. */
  update(camera: Camera, level: number, speed: number, dt: number): void {
    this.intensity += (level - this.intensity) * (1 - Math.exp(-6 * dt));
    const opacity = clamp01(this.intensity) * 0.34;
    this.material.opacity = opacity;
    this.group.visible = opacity > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(camera.position);
    this.group.quaternion.copy(camera.quaternion);
    const advance = speed * 0.9 * dt;
    const length = 3 + this.intensity * 12;
    const p = this.positions;
    for (let i = 0; i < STREAKS; i += 1) {
      let z = this.depth[i]! + advance;
      if (z > STREAK_NEAR) {
        this.respawn(i, STREAK_FAR + (z - STREAK_NEAR));
        z = this.depth[i]!;
      }
      this.depth[i] = z;
      // Points on a cone around the view axis, so streaks fan outward as they approach.
      const cx = Math.cos(this.angle[i]!) * this.slope[i]!;
      const cy = Math.sin(this.angle[i]!) * this.slope[i]! * 0.75;
      const tail = z - length;
      const o = i * 6;
      p[o] = -z * cx;
      p[o + 1] = -z * cy;
      p[o + 2] = z;
      p[o + 3] = -tail * cx;
      p[o + 4] = -tail * cy;
      p[o + 5] = tail;
    }
    (this.lines.geometry.attributes.position as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
    this.group.removeFromParent();
  }
}

const TRAIL_SAMPLES = 44;
const TRAIL_HALF_WIDTH = 0.14;
/** Trail samples fade out as they pass close to the camera so they never smear across the view. */
const TRAIL_CAMERA_FADE_NEAR = 7;
const TRAIL_CAMERA_FADE_FAR = 20;
const _tip = new Vector3();
const _up = new Vector3();

/**
 * Wingtip vapour trails: two ribbons sampled from the wingtips each frame.
 * They thicken with speed and hard turns, so a committed high-speed turn
 * leaves a visible arc behind the aircraft. Fixed buffers, no per-frame allocation.
 */
export class Contrails {
  private readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  /** Ring buffers: [tip][sample] world position, ribbon up vector and intensity. */
  private readonly points: Vector3[][] = [[], []];
  private readonly ups: Vector3[][] = [[], []];
  private readonly strength: Float32Array[] = [
    new Float32Array(TRAIL_SAMPLES),
    new Float32Array(TRAIL_SAMPLES),
  ];
  private head = 0;
  private count = 0;
  private readonly color = new Color();

  constructor(scene: Scene, color: number) {
    this.color.setHex(color);
    const vertices = 2 * TRAIL_SAMPLES * 2;
    this.positions = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 4);
    const indices: number[] = [];
    for (let tip = 0; tip < 2; tip += 1) {
      const base = tip * TRAIL_SAMPLES * 2;
      for (let i = 0; i < TRAIL_SAMPLES - 1; i += 1) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
        this.points[tip]!.push(new Vector3());
        this.ups[tip]!.push(new Vector3());
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 4));
    geometry.setIndex(indices);
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  setColor(color: number): void {
    this.color.setHex(color);
  }

  /** Drops the trail (after a respawn or restart) so it never streaks across a teleport. */
  reset(): void {
    this.count = 0;
    this.head = 0;
    this.mesh.visible = false;
  }

  update(
    position: Vector3,
    orientation: Quaternion,
    tips: readonly Vector3[],
    intensity: number,
    cameraPosition: Vector3,
  ): void {
    const slot = this.head;
    _up.set(0, 1, 0).applyQuaternion(orientation);
    for (let tip = 0; tip < 2; tip += 1) {
      const local = tips[tip];
      if (!local) continue;
      _tip.copy(local).applyQuaternion(orientation).add(position);
      this.points[tip]![slot]!.copy(_tip);
      this.ups[tip]![slot]!.copy(_up);
      this.strength[tip]![slot] = clamp01(intensity);
    }
    this.head = (this.head + 1) % TRAIL_SAMPLES;
    this.count = Math.min(TRAIL_SAMPLES, this.count + 1);

    let any = false;
    for (let tip = 0; tip < 2; tip += 1) {
      const base = tip * TRAIL_SAMPLES * 2;
      for (let i = 0; i < TRAIL_SAMPLES; i += 1) {
        // i = 0 is the newest sample.
        const valid = i < this.count;
        const index = (slot - i + TRAIL_SAMPLES) % TRAIL_SAMPLES;
        const point = this.points[tip]![index]!;
        const up = this.ups[tip]![index]!;
        const fade = 1 - i / (TRAIL_SAMPLES - 1);
        const nearCamera = smoothstep(
          TRAIL_CAMERA_FADE_NEAR,
          TRAIL_CAMERA_FADE_FAR,
          point.distanceTo(cameraPosition),
        );
        const alpha = valid ? this.strength[tip]![index]! * fade * fade * nearCamera * 0.6 : 0;
        if (alpha > 0.01) any = true;
        const width = TRAIL_HALF_WIDTH * (0.4 + 0.6 * fade);
        const v = (base + i * 2) * 3;
        this.positions[v] = point.x + up.x * width;
        this.positions[v + 1] = point.y + up.y * width;
        this.positions[v + 2] = point.z + up.z * width;
        this.positions[v + 3] = point.x - up.x * width;
        this.positions[v + 4] = point.y - up.y * width;
        this.positions[v + 5] = point.z - up.z * width;
        const c = (base + i * 2) * 4;
        for (let k = 0; k < 2; k += 1) {
          this.colors[c + k * 4] = this.color.r;
          this.colors[c + k * 4 + 1] = this.color.g;
          this.colors[c + k * 4 + 2] = this.color.b;
          this.colors[c + k * 4 + 3] = alpha;
        }
      }
    }
    this.mesh.visible = any;
    const geometry = this.mesh.geometry;
    (geometry.attributes.position as BufferAttribute).needsUpdate = true;
    (geometry.attributes.color as BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.removeFromParent();
  }
}
