import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  Matrix4,
  Quaternion,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  type Camera,
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

const PUFFS = 90;
const _offset = new Vector3();

/**
 * Engine strain: grey smoke trails engines running hot, and a blowout throws out a
 * burst of black smoke. One pooled instanced mesh for every racer; nothing is
 * allocated per frame.
 */
export class EngineSmoke {
  private readonly mesh: InstancedMesh;
  private readonly material: MeshBasicMaterial;
  private readonly positions: Vector3[] = [];
  private readonly velocities: Vector3[] = [];
  private readonly ages = new Float32Array(PUFFS);
  private readonly lives = new Float32Array(PUFFS);
  private readonly sizes = new Float32Array(PUFFS);
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private next = 0;
  private readonly rng = createRng(4242);

  constructor(scene: Scene) {
    this.material = new MeshBasicMaterial({
      color: 0x3b3936,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(new IcosahedronGeometry(1, 1), this.material, PUFFS);
    this.mesh.frustumCulled = false;
    for (let i = 0; i < PUFFS; i += 1) {
      this.positions.push(new Vector3());
      this.velocities.push(new Vector3());
      this.lives[i] = 0;
      this.ages[i] = 1;
      this.matrix.makeScale(0, 0, 0);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    scene.add(this.mesh);
  }

  private emit(origin: Vector3, velocity: Vector3, size: number, life: number): void {
    const i = this.next;
    this.next = (this.next + 1) % PUFFS;
    this.positions[i]!.copy(origin);
    this.velocities[i]!.copy(velocity).multiplyScalar(0.25);
    this.velocities[i]!.y += 1.5 + this.rng() * 2;
    this.ages[i] = 0;
    this.lives[i] = life;
    this.sizes[i] = size;
  }

  /** Trails smoke from an engine running hot: more and darker toward overheat. */
  trail(position: Vector3, orientation: Quaternion, velocity: Vector3, heat: number, dt: number): void {
    const strain = smoothstep(0.78, 1, heat);
    if (strain <= 0 || this.rng() > strain * dt * 22) return;
    _offset
      .set((this.rng() - 0.5) * 0.6, 0.1, -2.2)
      .applyQuaternion(orientation)
      .add(position);
    this.emit(_offset, velocity, 0.5 + strain * 0.6, 1.2 + strain);
  }

  /** A blowout: a dense burst of black smoke around the engine. */
  burst(position: Vector3, orientation: Quaternion, velocity: Vector3): void {
    for (let k = 0; k < 18; k += 1) {
      _offset
        .set((this.rng() - 0.5) * 2.4, (this.rng() - 0.3) * 1.6, 1 - this.rng() * 4)
        .applyQuaternion(orientation)
        .add(position);
      this.emit(_offset, velocity, 0.9 + this.rng() * 0.9, 1.8 + this.rng());
    }
  }

  update(dt: number): void {
    for (let i = 0; i < PUFFS; i += 1) {
      const life = this.lives[i]!;
      if (life <= 0) continue;
      const age = (this.ages[i] = this.ages[i]! + dt / life);
      if (age >= 1) {
        this.lives[i] = 0;
        this.matrix.makeScale(0, 0, 0);
        this.mesh.setMatrixAt(i, this.matrix);
        continue;
      }
      const position = this.positions[i]!.addScaledVector(this.velocities[i]!, dt);
      this.velocities[i]!.multiplyScalar(1 - Math.min(1, dt * 1.5));
      // Puffs swell, then shrink away as they thin out.
      const s = this.sizes[i]! * (0.6 + age * 2.4) * (age > 0.7 ? (1 - age) / 0.3 : 1);
      this.matrix.compose(position, this.quaternion, this.scale.set(s, s, s));
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  reset(): void {
    this.lives.fill(0);
    this.matrix.makeScale(0, 0, 0);
    for (let i = 0; i < PUFFS; i += 1) this.mesh.setMatrixAt(i, this.matrix);
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.removeFromParent();
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

const RAIN_DROPS = 420;
const RAIN_BOX = 46;
const RAIN_FALL = 28;
const _rel = new Vector3();

/**
 * Rain streaks in a box that travels with the camera. Each drop falls with the
 * wind and is drawn along its motion relative to the aircraft, so the rain
 * slants harder the faster you fly. One draw call, no allocation per frame.
 */
export class RainStreaks {
  private readonly lines: LineSegments;
  private readonly material: LineBasicMaterial;
  private readonly positions: Float32Array;
  private readonly offsets: Float32Array;
  private readonly rng = createRng(911);

  constructor(
    scene: Scene,
    private readonly intensity: number,
  ) {
    this.positions = new Float32Array(RAIN_DROPS * 6);
    this.offsets = new Float32Array(RAIN_DROPS * 3);
    for (let i = 0; i < RAIN_DROPS * 3; i += 1) this.offsets[i] = (this.rng() - 0.5) * RAIN_BOX;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    this.material = new LineBasicMaterial({
      color: 0xdfe8f0,
      transparent: true,
      opacity: 0.28 * intensity,
      depthWrite: false,
      fog: false,
    });
    this.lines = new LineSegments(geometry, this.material);
    this.lines.frustumCulled = false;
    scene.add(this.lines);
  }

  /** `velocity` is the aircraft's ground velocity, `wind` the air mass velocity. */
  update(camera: Camera, velocity: Vector3, wind: Vector3, dt: number): void {
    _rel.set(wind.x - velocity.x, -RAIN_FALL - velocity.y, wind.z - velocity.z);
    const streak = clamp01(0.03 + _rel.length() * 0.0009);
    const half = RAIN_BOX / 2;
    const o = this.offsets;
    const p = this.positions;
    const c = camera.position;
    for (let i = 0; i < RAIN_DROPS; i += 1) {
      const k = i * 3;
      for (let axis = 0; axis < 3; axis += 1) {
        let value = o[k + axis]! + (axis === 0 ? _rel.x : axis === 1 ? _rel.y : _rel.z) * dt;
        if (value > half) value -= RAIN_BOX;
        else if (value < -half) value += RAIN_BOX;
        o[k + axis] = value;
      }
      const j = i * 6;
      p[j] = c.x + o[k]!;
      p[j + 1] = c.y + o[k + 1]!;
      p[j + 2] = c.z + o[k + 2]!;
      p[j + 3] = p[j]! - _rel.x * streak;
      p[j + 4] = p[j + 1]! - _rel.y * streak;
      p[j + 5] = p[j + 2]! - _rel.z * streak;
    }
    (this.lines.geometry.attributes.position as BufferAttribute).needsUpdate = true;
    this.material.opacity = 0.28 * this.intensity;
  }

  dispose(): void {
    this.lines.geometry.dispose();
    this.material.dispose();
    this.lines.removeFromParent();
  }
}
