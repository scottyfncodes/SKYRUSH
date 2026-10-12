import { clamp01, lerp, smoothstep } from '../core/math';
import { hash2 } from '../core/rng';

/**
 * Deterministic procedural terrain for the Caldera Ridge circuit.
 * A rugged desert mountain range with a carved racing valley along the course.
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

export interface TerrainDefinition {
  route: readonly RoutePoint[];
  /** Half-width (m) of the flat valley floor around the route. */
  valleyWidth: number;
  /** Distance (m) over which the valley blends into the mountains. */
  valleyBlend: number;
}

export interface Terrain {
  heightAt: (x: number, z: number) => number;
  /** Altitude of the carved valley floor nearest to a point. */
  floorAt: (x: number, z: number) => number;
  /** Horizontal distance from the route polyline. */
  distanceToRoute: (x: number, z: number) => number;
  definition: TerrainDefinition;
}

/** Rugged mountain altitude ignoring the valley carve. */
export const mountainHeight = (x: number, z: number): number => {
  const ridge = ridged(x, z, 5, 1400);
  const rolling = fbm(x + 2000, z - 1500, 4, 2600);
  const base = Math.max(0, ridge - 0.28) * 760 + rolling * 140 - 40;
  const detail = fbm(x, z, 3, 180) * 26;
  return base + detail;
};

const floorDetail = (x: number, z: number): number => fbm(x * 1.7, z * 1.7, 2, 120) * 7 - 3.5;

export const createTerrain = (definition: TerrainDefinition): Terrain => {
  const { route, valleyWidth, valleyBlend } = definition;

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

  const heightAt = (x: number, z: number): number => {
    const { distance, floor } = nearestRoute(x, z);
    const carve = smoothstep(valleyWidth, valleyWidth + valleyBlend, distance);
    const mountain = mountainHeight(x, z);
    const valleyFloor = floor + floorDetail(x, z);
    // Inside the valley the floor wins; outside we keep the mountains but never below the valley.
    const blended = lerp(valleyFloor, Math.max(mountain, valleyFloor - 20), carve);
    return blended;
  };

  return {
    heightAt,
    floorAt: (x, z) => nearestRoute(x, z).floor,
    distanceToRoute: (x, z) => nearestRoute(x, z).distance,
    definition,
  };
};
