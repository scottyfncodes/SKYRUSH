import { BufferAttribute, BufferGeometry, Matrix4, Mesh, Quaternion, Vector3, type Material } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Procedural geometry for the aircraft: sculpted fuselage bodies, lofted
 * airfoil surfaces, struts and helpers. Everything is built directly in the
 * aircraft frame (+Z nose, +Y up, +X pilot's left, metres) so static parts can
 * be merged per material without nested transforms.
 */

export interface BodyStation {
  z: number;
  /** Half width. */
  w: number;
  /** Height above the centre line. */
  top: number;
  /** Depth below the centre line. */
  bottom: number;
  /** Centre line height. */
  y?: number;
  /** Superellipse exponent: 2 = round, higher = boxier. */
  square?: number;
}

export interface BodySample {
  z: number;
  w: number;
  top: number;
  bottom: number;
  y: number;
  square: number;
}

/** Catmull-Rom style smooth interpolation through stations ordered nose → tail. */
export const sampleBody = (stations: readonly BodyStation[], z: number): BodySample => {
  const n = stations.length;
  const first = stations[0]!;
  const last = stations[n - 1]!;
  const clampZ = Math.min(first.z, Math.max(last.z, z));
  let i = 0;
  while (i < n - 2 && stations[i + 1]!.z > clampZ) i += 1;
  const a = stations[i]!;
  const b = stations[i + 1]!;
  const span = a.z - b.z;
  const t = span > 0 ? (a.z - clampZ) / span : 0;
  const p = stations[Math.max(0, i - 1)]!;
  const q = stations[Math.min(n - 1, i + 2)]!;
  const cr = (pv: number, av: number, bv: number, qv: number): number => {
    const t2 = t * t;
    const t3 = t2 * t;
    const v =
      0.5 *
      (2 * av + (-pv + bv) * t + (2 * pv - 5 * av + 4 * bv - qv) * t2 + (-pv + 3 * av - 3 * bv + qv) * t3);
    // Keep the curve inside its neighbours so the body never bulges past a station.
    return Math.min(Math.max(v, Math.min(av, bv) - 0.02), Math.max(av, bv) + 0.02);
  };
  return {
    z: clampZ,
    w: Math.max(0.002, cr(p.w, a.w, b.w, q.w)),
    top: Math.max(0.002, cr(p.top, a.top, b.top, q.top)),
    bottom: Math.max(0.002, cr(p.bottom, a.bottom, b.bottom, q.bottom)),
    y: cr(p.y ?? 0, a.y ?? 0, b.y ?? 0, q.y ?? 0),
    square: (a.square ?? 2) + ((b.square ?? 2) - (a.square ?? 2)) * t,
  };
};

const superSin = (angle: number, exponent: number): number => {
  const s = Math.sin(angle);
  return Math.sign(s) * Math.abs(s) ** (2 / exponent);
};

/**
 * Point on a body section at angle `phi`, measured from the bottom (0) through the
 * left side (π/2) to the top (π). Matches the body texture's u coordinate (phi / 2π).
 */
export const bodyPoint = (sample: BodySample, phi: number, target = new Vector3()): Vector3 => {
  const x = superSin(phi, sample.square) * sample.w;
  const c = -superSin(phi + Math.PI / 2, sample.square);
  const y = sample.y + (c >= 0 ? c * sample.top : c * sample.bottom);
  return target.set(x, y, sample.z);
};

/**
 * Builds a closed body by sweeping super-elliptical sections along Z.
 * UVs: u runs round the section (0 bottom, 0.25 left, 0.5 top, 0.75 right),
 * v runs nose (0) to tail (1) linearly in Z, so livery textures can be drawn
 * in metres.
 */
export const sculptBody = (stations: readonly BodyStation[], rings = 44, segments = 28): BufferGeometry => {
  const zNose = stations[0]!.z;
  const zTail = stations[stations.length - 1]!.z;
  const length = zNose - zTail;
  const positions: number[] = [];
  const uvs: number[] = [];
  const point = new Vector3();
  for (let i = 0; i <= rings; i += 1) {
    const v = i / rings;
    const sample = sampleBody(stations, zNose - v * length);
    for (let j = 0; j <= segments; j += 1) {
      const u = j / segments;
      bodyPoint(sample, u * Math.PI * 2, point);
      positions.push(point.x, point.y, point.z);
      uvs.push(u, 1 - v);
    }
  }
  const indices: number[] = [];
  const row = segments + 1;
  for (let i = 0; i < rings; i += 1) {
    for (let j = 0; j < segments; j += 1) {
      const a = i * row + j;
      const b = (i + 1) * row + j;
      const c = i * row + j + 1;
      const d = (i + 1) * row + j + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  orientOutward(geometry);
  geometry.computeVertexNormals();
  return geometry;
};

/** Surface of revolution about Z from (z, radius) pairs ordered nose → tail. */
export const revolve = (profile: readonly [number, number][], segments = 24): BufferGeometry =>
  sculptBody(
    profile.map(([z, r]) => ({ z, w: r, top: r, bottom: r })),
    Math.max(8, profile.length * 3),
    segments,
  );

// --- Lofted airfoil surfaces --------------------------------------------------------------

export interface SurfaceStation {
  /** Span position along +X in the surface frame. */
  x: number;
  y: number;
  /** Leading edge z. */
  le: number;
  chord: number;
  /** Thickness ratio. */
  t: number;
  /** Camber as a fraction of chord. */
  camber?: number;
}

const naca = (x: number, t: number): number =>
  5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);

/** Interpolated station at span position x (stations ordered by x). */
export const stationAt = (stations: readonly SurfaceStation[], x: number): SurfaceStation => {
  let i = 0;
  while (i < stations.length - 2 && stations[i + 1]!.x < x) i += 1;
  const a = stations[i]!;
  const b = stations[i + 1] ?? a;
  const span = b.x - a.x;
  const t = span > 0 ? Math.min(1, Math.max(0, (x - a.x) / span)) : 0;
  const lerp = (p: number, q: number) => p + (q - p) * t;
  return {
    x,
    y: lerp(a.y, b.y),
    le: lerp(a.le, b.le),
    chord: lerp(a.chord, b.chord),
    t: lerp(a.t, b.t),
    camber: lerp(a.camber ?? 0, b.camber ?? 0),
  };
};

/** Stations covering [x0, x1], including both ends and every original station between. */
export const stationsBetween = (
  stations: readonly SurfaceStation[],
  x0: number,
  x1: number,
): SurfaceStation[] => {
  const result = [stationAt(stations, x0)];
  for (const station of stations) if (station.x > x0 + 1e-4 && station.x < x1 - 1e-4) result.push(station);
  result.push(stationAt(stations, x1));
  return result;
};

/** Upper surface height of a station at a chord fraction (for decals and attachments). */
export const upperSurfaceY = (station: SurfaceStation, fraction: number): number =>
  station.y +
  naca(Math.max(0.001, fraction), station.t) * station.chord +
  (station.camber ?? 0) * station.chord;

/**
 * Lofts a closed airfoil surface through stations, using the chord range
 * [c0, c1] (0 = leading edge, 1 = trailing edge). Built in the surface frame:
 * span along +X, thickness along +Y, chord running toward −Z.
 */
export const loftSurface = (
  stations: readonly SurfaceStation[],
  c0 = 0,
  c1 = 1,
  pointsPerSide = 7,
): BufferGeometry => {
  const loop: [number, number][] = []; // [chord fraction, side (+1 upper, -1 lower)]
  for (let k = 0; k <= pointsPerSide; k += 1) {
    const s = k / pointsPerSide;
    loop.push([c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(Math.PI * s)), 1]);
  }
  for (let k = pointsPerSide; k >= 0; k -= 1) {
    const s = k / pointsPerSide;
    loop.push([c0 + (c1 - c0) * (0.5 - 0.5 * Math.cos(Math.PI * s)), -1]);
  }
  const loopLength = loop.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  for (const station of stations) {
    for (let k = 0; k < loopLength; k += 1) {
      const [f, side] = loop[k]!;
      const half = naca(Math.max(f, 0.0005), station.t) * station.chord;
      const y = station.y + side * half + (station.camber ?? 0) * station.chord * Math.sin(Math.PI * f);
      positions.push(station.x, y, station.le - f * station.chord);
      uvs.push(f, k / (loopLength - 1));
    }
  }
  const indices: number[] = [];
  for (let i = 0; i < stations.length - 1; i += 1) {
    for (let k = 0; k < loopLength - 1; k += 1) {
      const a = i * loopLength + k;
      const b = (i + 1) * loopLength + k;
      const c = i * loopLength + k + 1;
      const d = (i + 1) * loopLength + k + 1;
      indices.push(a, b, c, b, d, c);
    }
  }
  // End caps (fans from the section centroid).
  const capStart = positions.length / 3;
  for (const [index, station] of [stations[0]!, stations[stations.length - 1]!].entries()) {
    const ring = index === 0 ? 0 : stations.length - 1;
    let cy = 0;
    let cz = 0;
    for (let k = 0; k < loopLength; k += 1) {
      cy += positions[(ring * loopLength + k) * 3 + 1]!;
      cz += positions[(ring * loopLength + k) * 3 + 2]!;
    }
    positions.push(station.x, cy / loopLength, cz / loopLength);
    uvs.push(0.5, 0.5);
    const centre = capStart + index;
    const outward = index === 0 ? -1 : 1;
    for (let k = 0; k < loopLength - 1; k += 1) {
      const a = ring * loopLength + k;
      const b = ring * loopLength + k + 1;
      // The loop runs upper LE→TE then lower TE→LE; that is clockwise seen from +X.
      if (outward > 0) indices.push(centre, b, a);
      else indices.push(centre, a, b);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  orientTube(geometry, stations, loopLength);
  geometry.computeVertexNormals();
  return geometry;
};

/** Makes the first tube face of a body point away from the section centre (flips all faces if not). */
const orientOutward = (geometry: BufferGeometry): void => {
  const pos = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex()!;
  // Find a face away from the degenerate nose: the middle ring.
  const triangles = index.count / 3;
  const probe = Math.floor(triangles / 2) - (Math.floor(triangles / 2) % 2);
  const [a, b, c] = [index.getX(probe * 3), index.getX(probe * 3 + 1), index.getX(probe * 3 + 2)];
  const va = new Vector3().fromBufferAttribute(pos, a);
  const vb = new Vector3().fromBufferAttribute(pos, b);
  const vc = new Vector3().fromBufferAttribute(pos, c);
  const normal = new Vector3().subVectors(vb, va).cross(new Vector3().subVectors(vc, va));
  // Outward from the body axis at that z.
  let cx = 0;
  let cy = 0;
  let count = 0;
  for (let i = 0; i < pos.count; i += 1) {
    if (Math.abs(pos.getZ(i) - va.z) < 1e-4) {
      cx += pos.getX(i);
      cy += pos.getY(i);
      count += 1;
    }
  }
  const out = new Vector3(va.x - cx / count, va.y - cy / count, 0);
  if (normal.dot(out) < 0) flipFaces(geometry);
};

const orientTube = (
  geometry: BufferGeometry,
  stations: readonly SurfaceStation[],
  loopLength: number,
): void => {
  if (stations.length < 2) return;
  const pos = geometry.getAttribute('position') as BufferAttribute;
  const index = geometry.getIndex()!;
  const k = Math.floor(loopLength / 4); // a point on the upper surface
  const tri = k * 6;
  const va = new Vector3().fromBufferAttribute(pos, index.getX(tri));
  const vb = new Vector3().fromBufferAttribute(pos, index.getX(tri + 1));
  const vc = new Vector3().fromBufferAttribute(pos, index.getX(tri + 2));
  const normal = new Vector3().subVectors(vb, va).cross(new Vector3().subVectors(vc, va));
  if (normal.y < 0) {
    // Flip only the tube; caps were wound outward explicitly.
    const tubeIndices = (stations.length - 1) * (loopLength - 1) * 6;
    const array = index.array as Uint16Array | Uint32Array;
    for (let i = 0; i < tubeIndices; i += 3) {
      const tmp = array[i + 1]!;
      array[i + 1] = array[i + 2]!;
      array[i + 2] = tmp;
    }
    // Caps were wound for an outward tube in the default order; flip them too so both agree.
    for (let i = tubeIndices; i < array.length; i += 3) {
      const tmp = array[i + 1]!;
      array[i + 1] = array[i + 2]!;
      array[i + 2] = tmp;
    }
    index.needsUpdate = true;
  }
};

export const flipFaces = (geometry: BufferGeometry): void => {
  const index = geometry.getIndex();
  if (!index) return;
  const array = index.array as Uint16Array | Uint32Array;
  for (let i = 0; i < array.length; i += 3) {
    const tmp = array[i + 1]!;
    array[i + 1] = array[i + 2]!;
    array[i + 2] = tmp;
  }
  index.needsUpdate = true;
};

/** Mirrors a geometry across the YZ plane (left ↔ right), keeping faces outward. */
export const mirrorX = (geometry: BufferGeometry): BufferGeometry => {
  const copy = geometry.clone();
  copy.applyMatrix4(new Matrix4().makeScale(-1, 1, 1));
  flipFaces(copy);
  copy.computeVertexNormals();
  return copy;
};

const _up = new Vector3(0, 1, 0);

/** Cylinder-like rod between two points. Use with a shared unit geometry via `rodMatrix` where possible. */
export const rodMatrix = (from: Vector3, to: Vector3, radius: number, target = new Matrix4()): Matrix4 => {
  const direction = new Vector3().subVectors(to, from);
  const length = direction.length();
  const quaternion = new Quaternion().setFromUnitVectors(_up, direction.normalize());
  const mid = new Vector3().addVectors(from, to).multiplyScalar(0.5);
  return target.compose(mid, quaternion, new Vector3(radius, length, radius));
};

/** Ensures every geometry has the attributes needed to merge (position, normal, uv) and is indexed. */
const normaliseForMerge = (geometry: BufferGeometry): BufferGeometry => {
  const g = geometry;
  if (!g.getIndex()) {
    const count = g.getAttribute('position').count;
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i += 1) indices[i] = i;
    g.setIndex(new BufferAttribute(indices, 1));
  }
  if (!g.getAttribute('normal')) g.computeVertexNormals();
  if (!g.getAttribute('uv')) {
    const count = g.getAttribute('position').count;
    g.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
  }
  for (const name of Object.keys(g.attributes)) {
    if (name !== 'position' && name !== 'normal' && name !== 'uv') g.deleteAttribute(name);
  }
  return g;
};

/**
 * Collects static parts by material and merges each group into one mesh, so an
 * aircraft costs a few draw calls instead of a hundred.
 */
export class StaticBatch {
  private readonly groups = new Map<Material, BufferGeometry[]>();

  add(geometry: BufferGeometry, material: Material, matrix?: Matrix4): void {
    const g = matrix ? geometry.clone().applyMatrix4(matrix) : geometry;
    if (matrix && matrix.determinant() < 0) flipFaces(g);
    const list = this.groups.get(material) ?? [];
    list.push(normaliseForMerge(g));
    this.groups.set(material, list);
  }

  build(): Mesh[] {
    const meshes: Mesh[] = [];
    for (const [material, list] of this.groups) {
      const merged = list.length === 1 ? list[0]! : mergeGeometries(list, false);
      if (!merged) continue;
      for (const g of list) if (g !== merged) g.dispose();
      const mesh = new Mesh(merged, material);
      mesh.castShadow = true;
      meshes.push(mesh);
    }
    this.groups.clear();
    return meshes;
  }
}
