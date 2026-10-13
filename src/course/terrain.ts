import { clamp01, lerp, smoothstep } from '../core/math';
import { hash2 } from '../core/rng';

/**
 * Deterministic procedural terrain for the circuits.
 * A ridged mountain range (shaped per course by a {@link MountainProfile}) with a
 * carved racing valley along the course, optionally flooded up to a sea level.
 * The same function drives both the rendered mesh and the collision queries.
 */

export interface RoutePoint {
  x: number;
  z: number;
  /** Valley floor altitude at this point in metres. */
  floor: number;
}

const fade = (t: number): number => t * t * (3 - 2 * t);

const valueNoise = (x: number, z: number): number => {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = fade(x - ix);
  const fz = fade(z - iz);
  const a = hash2(ix, iz);
  const b = hash2(ix + 1, iz);
  const c = hash2(ix, iz + 1);
  const d = hash2(ix + 1, iz + 1);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
};

const fbm = (x: number, z: number, octaves: number, wavelength: number): number => {
  let amplitude = 0.5;
  let frequency = 1 / wavelength;
  let total = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += valueNoise(x * frequency + i * 17.3, z * frequency - i * 9.1) * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2.1;
  }
  return total / norm;
};

const ridged = (x: number, z: number, octaves: number, wavelength: number): number => {
  let amplitude = 0.5;
  let frequency = 1 / wavelength;
  let total = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const n = valueNoise(x * frequency + i * 31.7, z * frequency + i * 11.9);
    total += (1 - Math.abs(n * 2 - 1)) * amplitude;
    norm += amplitude;
    amplitude *= 0.55;
    frequency *= 2.0;
  }
  return total / norm;
};

/** Shapes the mountains around a course. All lengths and heights in metres. */
export interface MountainProfile {
  /** Shifts the noise field so courses do not share mountains. */
  offsetX: number;
  offsetZ: number;
  ridgeWavelength: number;
  /** Ridge noise below this value is flat ground; higher means fewer, sharper peaks. */
  ridgeThreshold: number;
  ridgeAmplitude: number;
  rollingWavelength: number;
  rollingAmplitude: number;
  /** Altitude of open ground between the ridges. */
  base: number;
  detailAmplitude: number;
  /** Flat-topped mesas: heights snap to steps with a steep riser in the last `sharpness` of each. */
  terrace?: { step: number; sharpness: number };
}

export const DEFAULT_MOUNTAINS: MountainProfile = {
  offsetX: 0,
  offsetZ: 0,
  ridgeWavelength: 1400,
  ridgeThreshold: 0.28,
  ridgeAmplitude: 760,
  rollingWavelength: 2600,
  rollingAmplitude: 140,
  base: -40,
  detailAmplitude: 26,
};

export interface TerrainDefinition {
  route: readonly RoutePoint[];
  /** Half-width (m) of the flat valley floor around the route. */
  valleyWidth: number;
  /** Distance (m) over which the valley blends into the mountains. */
  valleyBlend: number;
  mountains?: MountainProfile;
  /** Water surface altitude. Collision treats water as ground; the seabed is still rendered. */
  seaLevel?: number;
}

export interface Terrain {
  /** Collision surface: the ground, or the water surface where that is higher. */
  heightAt: (x: number, z: number) => number;
  /** The solid ground, ignoring water (equal to heightAt on dry courses). */
  groundAt: (x: number, z: number) => number;
  /** Altitude of the carved valley floor nearest to a point. */
  floorAt: (x: number, z: number) => number;
  /** Horizontal distance from the route polyline. */
  distanceToRoute: (x: number, z: number) => number;
  definition: TerrainDefinition;
}

const terrace = (height: number, step: number, sharpness: number): number => {
  const t = height / step;
  const level = Math.floor(t);
  const riser = clamp01((t - level - (1 - sharpness)) / sharpness);
  return (level + riser * riser * (3 - 2 * riser)) * step;
};

/** Mountain altitude ignoring the valley carve. */
export const mountainHeight = (
  x: number,
  z: number,
  profile: MountainProfile = DEFAULT_MOUNTAINS,
): number => {
  const px = x + profile.offsetX;
  const pz = z + profile.offsetZ;
  const ridge = ridged(px, pz, 5, profile.ridgeWavelength);
  const rolling = fbm(px + 2000, pz - 1500, 4, profile.rollingWavelength);
  let base =
    Math.max(0, ridge - profile.ridgeThreshold) * profile.ridgeAmplitude +
    rolling * profile.rollingAmplitude +
    profile.base;
  if (profile.terrace) base = terrace(base, profile.terrace.step, profile.terrace.sharpness);
  const detail = fbm(px, pz, 3, 180) * profile.detailAmplitude;
  return base + detail;
};

const floorDetail = (x: number, z: number): number => fbm(x * 1.7, z * 1.7, 2, 120) * 7 - 3.5;

export const createTerrain = (definition: TerrainDefinition): Terrain => {
  const { route, valleyWidth, valleyBlend } = definition;
  const mountains = definition.mountains ?? DEFAULT_MOUNTAINS;
  const seaLevel = definition.seaLevel ?? -Infinity;

  const nearestRoute = (x: number, z: number): { distance: number; floor: number } => {
    let best = Infinity;
    let floor = 0;
    for (let i = 0; i < route.length - 1; i += 1) {
      const a = route[i]!;
      const b = route[i + 1]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const lengthSq = dx * dx + dz * dz || 1;
      const t = clamp01(((x - a.x) * dx + (z - a.z) * dz) / lengthSq);
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d = Math.hypot(x - px, z - pz);
      if (d < best) {
        best = d;
        floor = lerp(a.floor, b.floor, t);
      }
    }
    return { distance: best, floor };
  };

  const groundAt = (x: number, z: number): number => {
    const { distance, floor } = nearestRoute(x, z);
    const carve = smoothstep(valleyWidth, valleyWidth + valleyBlend, distance);
    const mountain = mountainHeight(x, z, mountains);
    const valleyFloor = floor + floorDetail(x, z);
    // Inside the valley the floor wins; outside we keep the mountains but never far below the
    // valley. On water courses that guard fades out past the valley so a raised gate (a hop
    // over a ridge) does not leave a plateau standing in the sea.
    let guard = valleyFloor - 20;
    if (definition.seaLevel !== undefined) {
      const outer = valleyWidth + valleyBlend;
      guard -= smoothstep(outer, outer * 2, distance) * 1000;
    }
    const blended = lerp(valleyFloor, Math.max(mountain, guard), carve);
    return blended;
  };

  const heightAt = (x: number, z: number): number => Math.max(groundAt(x, z), seaLevel);

  return {
    heightAt,
    groundAt,
    floorAt: (x, z) => nearestRoute(x, z).floor,
    distanceToRoute: (x, z) => nearestRoute(x, z).distance,
    definition,
  };
};
