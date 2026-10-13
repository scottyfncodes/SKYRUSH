import {
  BufferAttribute,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  IcosahedronGeometry,
  InstancedMesh,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
} from 'three';
import type { CourseTheme, ScatterKind, ScatterRule } from '../course/themes';
import type { Terrain } from '../course/terrain';
import { createRng } from '../core/rng';

/** Paints a whole geometry one colour (as a vertex colour) and returns it non-indexed. */
const painted = (geometry: BufferGeometry, color: number): BufferGeometry => {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry;
  const c = new Color(color);
  const count = flat.attributes.position!.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    colors[i * 3] = c.r;
    colors[i * 3 + 1] = c.g;
    colors[i * 3 + 2] = c.b;
  }
  flat.setAttribute('color', new BufferAttribute(colors, 3));
  flat.deleteAttribute('uv');
  return flat;
};

/** Concatenates non-indexed geometries that share position/normal/color attributes. */
const merge = (parts: BufferGeometry[]): BufferGeometry => {
  let total = 0;
  for (const part of parts) total += part.attributes.position!.count;
  const positions = new Float32Array(total * 3);
  const normals = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);
  let offset = 0;
  for (const part of parts) {
    part.computeVertexNormals();
    positions.set(part.attributes.position!.array as Float32Array, offset * 3);
    normals.set(part.attributes.normal!.array as Float32Array, offset * 3);
    colors.set(part.attributes.color!.array as Float32Array, offset * 3);
    offset += part.attributes.position!.count;
    part.dispose();
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new BufferAttribute(positions, 3));
  merged.setAttribute('normal', new BufferAttribute(normals, 3));
  merged.setAttribute('color', new BufferAttribute(colors, 3));
  merged.computeBoundingSphere();
  return merged;
};

/** Irregular rock: an icosahedron with deterministically jittered vertices. */
const boulderGeometry = (color: number): BufferGeometry => {
  const geometry = new IcosahedronGeometry(1, 1);
  const position = geometry.attributes.position as BufferAttribute;
  const rng = createRng(77);
  const seen = new Map<string, number>();
  for (let i = 0; i < position.count; i += 1) {
    const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    let scale = seen.get(key);
    if (scale === undefined) {
      scale = 0.75 + rng() * 0.45;
      seen.set(key, scale);
    }
    position.setXYZ(
      i,
      position.getX(i) * scale * 1.2,
      position.getY(i) * scale * 0.75,
      position.getZ(i) * scale,
    );
  }
  geometry.translate(0, 0.35, 0);
  return merge([painted(geometry, color)]);
};

const pineGeometry = (snowy: boolean): BufferGeometry => {
  const parts = [painted(new CylinderGeometry(0.35, 0.55, 3, 5, 1, true).translate(0, 1.5, 0), 0x4a3426)];
  const tiers: [number, number, number][] = [
    [3.6, 6, 4.5],
    [2.8, 5, 7.5],
    [1.9, 4.2, 10.2],
  ];
  // Open-ended cones: their bases are never seen from the air and would add a third more triangles.
  tiers.forEach(([radius, height, y], index) => {
    parts.push(
      painted(
        new ConeGeometry(radius, height, 7, 1, true).translate(0, y, 0),
        index === 2 ? 0x2f5236 : 0x27452d,
      ),
    );
    if (snowy) {
      parts.push(
        painted(
          new ConeGeometry(radius * 0.55, height * 0.32, 7, 1, true).translate(0, y + height * 0.36, 0),
          0xf1f5fa,
        ),
      );
    }
  });
  return merge(parts);
};

const palmGeometry = (): BufferGeometry => {
  const parts: BufferGeometry[] = [];
  // Gently curving trunk from stacked, offset segments.
  let x = 0;
  for (let i = 0; i < 5; i += 1) {
    const segment = new CylinderGeometry(0.32 - i * 0.03, 0.4 - i * 0.03, 2.4, 6, 1, true);
    segment.rotateZ(-0.08 * i);
    segment.translate(x, 1.2 + i * 2.3, 0);
    parts.push(painted(segment, i % 2 === 0 ? 0x8a6a48 : 0x7a5c3e));
    x += 0.22 * i;
  }
  const top = new Vector3(x, 11.6, 0);
  for (let i = 0; i < 7; i += 1) {
    const frond = new ConeGeometry(0.9, 6.5, 4);
    frond.scale(1, 1, 0.25);
    frond.rotateZ(Math.PI / 2 + 0.5);
    frond.translate(2.8, -0.9, 0);
    frond.rotateY((i / 7) * Math.PI * 2);
    frond.translate(top.x, top.y, top.z);
    parts.push(painted(frond, i % 2 === 0 ? 0x2f7a33 : 0x3c8f3a));
  }
  return merge(parts);
};

const cactusGeometry = (): BufferGeometry => {
  const green = 0x5d7a44;
  const parts = [painted(new CylinderGeometry(0.55, 0.65, 7, 7).translate(0, 3.5, 0), green)];
  for (const [side, height, y] of [
    [1, 2.4, 3.2],
    [-1, 1.8, 4.2],
  ] as const) {
    parts.push(
      painted(new CylinderGeometry(0.38, 0.38, 1.6, 6).rotateZ(Math.PI / 2).translate(side * 1, y, 0), green),
    );
    parts.push(
      painted(new CylinderGeometry(0.36, 0.4, height, 6).translate(side * 1.7, y + height / 2, 0), green),
    );
  }
  return merge(parts);
};

const shrubGeometry = (color: number): BufferGeometry => {
  const geometry = new DodecahedronGeometry(1, 0);
  geometry.scale(1.4, 0.75, 1.2);
  geometry.translate(0, 0.45, 0);
  return merge([painted(geometry, color)]);
};

const geometryFor = (kind: ScatterKind, theme: CourseTheme): BufferGeometry => {
  switch (kind) {
    case 'pine':
      return pineGeometry(!!theme.landmarkSnow);
    case 'palm':
      return palmGeometry();
    case 'boulder':
      return boulderGeometry(theme.terrain.rock);
    case 'cactus':
      return cactusGeometry();
    case 'shrub':
      return shrubGeometry(theme.terrain.vegetation);
  }
};

export interface ScatterOptions {
  center: { x: number; z: number };
  /** Half-size of the square to populate. */
  extent: number;
  seed: number;
}

/**
 * Deterministic instanced props (trees, rocks, cacti) placed on suitable ground and
 * kept clear of the racing corridor. Purely visual: they have no collision.
 */
/** Props are grouped into square tiles this wide so the camera only draws tiles in view. */
const TILE_SIZE = 1000;

export const createScatter = (
  theme: CourseTheme,
  terrain: Terrain,
  seaLevel: number | null,
  options: ScatterOptions,
): { meshes: InstancedMesh[]; dispose: () => void } => {
  const meshes: InstancedMesh[] = [];
  const disposables: { dispose: () => void }[] = [];
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  const up = new Vector3(0, 1, 0);
  const tint = new Color();

  theme.scatter.forEach((rule: ScatterRule, ruleIndex) => {
    const rng = createRng(options.seed * 31 + ruleIndex * 977);
    const geometry = geometryFor(rule.kind, theme);
    const material = new MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.9,
      metalness: 0,
      flatShading: true,
    });
    disposables.push(geometry, material);
    const tiles = new Map<string, { matrices: Matrix4[]; shades: number[] }>();
    let placed = 0;
    const attempts = rule.count * 5;
    for (let attempt = 0; attempt < attempts && placed < rule.count; attempt += 1) {
      const x = options.center.x + (rng() * 2 - 1) * options.extent;
      const z = options.center.z + (rng() * 2 - 1) * options.extent;
      const y = terrain.groundAt(x, z);
      if (y < rule.minAltitude || y > rule.maxAltitude) continue;
      if (seaLevel !== null && y < seaLevel + 0.8) continue;
      const dx = terrain.groundAt(x + 4, z) - y;
      const dz = terrain.groundAt(x, z + 4) - y;
      // Same measure as the terrain colouring: (1 - normal.y) × 1.6.
      const slope = Math.min(1, (1 - 1 / Math.sqrt(1 + (dx * dx + dz * dz) / 16)) * 1.6);
      if (slope > rule.maxSlope) continue;
      if (terrain.distanceToRoute(x, z) < rule.routeClearance) continue;
      const s = rule.scale[0] + rng() * (rule.scale[1] - rule.scale[0]);
      position.set(x, y - 0.3 * s, z);
      quaternion.setFromAxisAngle(up, rng() * Math.PI * 2);
      scale.set(s * (0.85 + rng() * 0.3), s, s * (0.85 + rng() * 0.3));
      const key = `${Math.floor(x / TILE_SIZE)},${Math.floor(z / TILE_SIZE)}`;
      let tile = tiles.get(key);
      if (!tile) {
        tile = { matrices: [], shades: [] };
        tiles.set(key, tile);
      }
      tile.matrices.push(new Matrix4().compose(position, quaternion, scale));
      tile.shades.push(0.82 + rng() * 0.3);
      placed += 1;
    }
    for (const tile of tiles.values()) {
      const mesh = new InstancedMesh(geometry, material, tile.matrices.length);
      tile.matrices.forEach((matrix, i) => {
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, tint.setRGB(tile.shades[i]!, tile.shades[i]!, tile.shades[i]!));
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      // Bounds per tile let three.js frustum-cull tiles behind or beside the camera.
      mesh.computeBoundingSphere();
      meshes.push(mesh);
    }
  });

  return { meshes, dispose: () => disposables.forEach((d) => d.dispose()) };
};
