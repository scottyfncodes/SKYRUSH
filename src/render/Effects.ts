import type { Object3D, Scene } from 'three';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { createRng } from '../core/rng';

const PARTICLES = 48;

/**
 * Pooled debris burst for crashes. Fixed-size instanced mesh; nothing is
 * allocated per frame.
 */
export class CrashBurst {
  private readonly mesh: InstancedMesh;
  private readonly velocities: Vector3[] = [];
  private readonly positions: Vector3[] = [];
  private readonly matrix = new Matrix4();
  private readonly quaternion = new Quaternion();
  private readonly scale = new Vector3();
  private life = 0;
  private readonly rng = createRng(1337);

  constructor(scene: Scene) {
    const geometry = new BoxGeometry(0.6, 0.6, 0.6);
    const material = new MeshBasicMaterial({ color: 0xffa040 });
    this.mesh = new InstancedMesh(geometry, material, PARTICLES);
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    for (let i = 0; i < PARTICLES; i += 1) {
      this.velocities.push(new Vector3());
      this.positions.push(new Vector3());
    }
    scene.add(this.mesh);
  }

  trigger(origin: Vector3): void {
    this.life = 1.6;
    this.mesh.visible = true;
    for (let i = 0; i < PARTICLES; i += 1) {
      const theta = this.rng() * Math.PI * 2;
      const phi = this.rng() * Math.PI * 0.5;
      const speed = 18 + this.rng() * 30;
      this.velocities[i]!.set(
        Math.cos(theta) * Math.cos(phi) * speed,
        Math.sin(phi) * speed + 8,
        Math.sin(theta) * Math.cos(phi) * speed,
      );
      this.positions[i]!.copy(origin);
    }
  }

  update(dt: number): void {
    if (this.life <= 0) return;
    this.life -= dt;
    if (this.life <= 0) {
      this.mesh.visible = false;
      return;
    }
    const size = Math.max(0.1, this.life / 1.6) * 1.4;
    for (let i = 0; i < PARTICLES; i += 1) {
      const velocity = this.velocities[i]!;
      velocity.y -= 25 * dt;
      velocity.multiplyScalar(1 - 0.8 * dt);
      const position = this.positions[i]!.addScaledVector(velocity, dt);
      this.scale.setScalar(size);
      this.matrix.compose(position, this.quaternion, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshBasicMaterial).dispose();
    this.mesh.removeFromParent();
  }
}

export const removeAndDispose = (object: Object3D): void => {
  object.removeFromParent();
};
