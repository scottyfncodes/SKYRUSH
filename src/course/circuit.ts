import { Quaternion, Vector3 } from 'three';
import { createTerrain, type RoutePoint, type Terrain } from './terrain';
import type { BonusRing, GateDefinition } from './gates';
import { DEFAULT_COURSE_ID, getCourseSpec, type CourseSpec, type Landmark } from './courses';
import type { CourseTheme } from './themes';

export type { GateSpec, Landmark } from './courses';

export interface Circuit {
  id: string;
  name: string;
  location: string;
  description: string;
  gates: GateDefinition[];
  /** Optional low-level rings off the racing line: points and boost for players who dive for them. */
  rings: BonusRing[];
  terrain: Terrain;
  spawn: { position: Vector3; orientation: Quaternion; speed: number };
  /** Grid slots for the four racers relative to the spawn (right, up, back offsets). */
  gridSlots: readonly { right: number; up: number; back: number }[];
  landmarks: readonly Landmark[];
  length: number; // metres along the gate polyline
  parTime: number; // seconds, used for reward bonuses
  ceiling: number;
  bounds: number; // horizontal radius from origin after which racers are reset
  /** Water surface altitude, when the course has water. */
  seaLevel: number | null;
  /** Centre of the course's gates, used to centre the rendered terrain. */
  center: { x: number; z: number };
  character: string;
  theme: CourseTheme;
}

const GATE_WIDTH = 46;
const GATE_HEIGHT = 30;

export const RING_RADIUS = 7.5;

const horizontal = (x: number, z: number): Vector3 => new Vector3(x, 0, z).normalize();

/** Builds a course by id (defaults to Caldera Ridge; unknown ids fall back to it too). */
export const createCircuit = (id: string = DEFAULT_COURSE_ID): Circuit =>
  buildCircuit(getCourseSpec(id) ?? getCourseSpec(DEFAULT_COURSE_ID)!);

const buildCircuit = (course: CourseSpec): Circuit => {
  const { spawn: spawnSpec, gates: gateSpecs } = course;
  const route: RoutePoint[] = [
    { x: spawnSpec.x, z: spawnSpec.z - 500, floor: spawnSpec.floor },
    { x: spawnSpec.x, z: spawnSpec.z, floor: spawnSpec.floor },
    ...gateSpecs.map(({ x, z, floor }) => ({ x, z, floor })),
    ...course.tail,
  ];
  const terrain = createTerrain({
    route,
    valleyWidth: course.valleyWidth,
    valleyBlend: course.valleyBlend,
    mountains: course.mountains,
    seaLevel: course.seaLevel,
  });

  const gates: GateDefinition[] = gateSpecs.map((spec, index) => {
    const prev = index === 0 ? { x: spawnSpec.x, z: spawnSpec.z } : gateSpecs[index - 1]!;
    const next = gateSpecs[index + 1] ?? { x: spec.x + (spec.x - prev.x), z: spec.z + (spec.z - prev.z) };
    const normal = horizontal(next.x - prev.x, next.z - prev.z);
    const right = new Vector3(normal.z, 0, -normal.x);
    const width = spec.width ?? GATE_WIDTH;
    const height = spec.height ?? GATE_HEIGHT;
    const kind = spec.kind ?? 'standard';
    return {
      index,
      position: new Vector3(spec.x, spec.floor + spec.clearance, spec.z),
      normal,
      right,
      halfWidth: width / 2,
      halfHeight: height / 2,
      kind,
      label: kind === 'finish' ? 'FINISH' : kind === 'start' ? 'START' : `${index + 1}`,
    };
  });

  const rings: BonusRing[] = course.rings.map((spec, index) => {
    const from = gates[spec.after]!.position;
    const to = gates[spec.after + 1]!.position;
    const normal = horizontal(to.x - from.x, to.z - from.z);
    const right = new Vector3(normal.z, 0, -normal.x);
    const x = from.x + (to.x - from.x) * spec.t + right.x * spec.lateral;
    const z = from.z + (to.z - from.z) * spec.t + right.z * spec.lateral;
    let ground = -Infinity;
    for (const offset of [-RING_RADIUS * 1.6, 0, RING_RADIUS * 1.6]) {
      ground = Math.max(ground, terrain.heightAt(x + right.x * offset, z + right.z * offset));
    }
    return { index, position: new Vector3(x, ground + spec.height, z), normal, radius: RING_RADIUS };
  });

  let length = 0;
  let previous = new Vector3(spawnSpec.x, spawnSpec.floor + spawnSpec.altitude, spawnSpec.z);
  for (const gate of gates) {
    length += gate.position.distanceTo(previous);
    previous = gate.position;
  }

  let minX = spawnSpec.x;
  let maxX = spawnSpec.x;
  let minZ = spawnSpec.z;
  let maxZ = spawnSpec.z;
  for (const gate of gateSpecs) {
    minX = Math.min(minX, gate.x);
    maxX = Math.max(maxX, gate.x);
    minZ = Math.min(minZ, gate.z);
    maxZ = Math.max(maxZ, gate.z);
  }

  const spawnOrientation = new Quaternion(); // facing +Z
  return {
    id: course.id,
    name: course.name,
    location: course.location,
    description: course.description,
    character: course.character,
    theme: course.theme,
    seaLevel: course.seaLevel ?? null,
    center: { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2 },
    gates,
    rings,
    terrain,
    spawn: {
      position: new Vector3(spawnSpec.x, spawnSpec.floor + spawnSpec.altitude, spawnSpec.z),
      orientation: spawnOrientation,
      speed: 60,
    },
    gridSlots: [
      { right: 0, up: 0, back: 0 },
      { right: -26, up: 6, back: 30 },
      { right: 26, up: 4, back: 36 },
      { right: 0, up: 12, back: 70 },
    ],
    landmarks: course.landmarks as Landmark[],
    length,
    parTime: course.parTime,
    ceiling: course.ceiling,
    bounds: course.bounds,
  };
};

/** Orientation that faces from `from` toward `to` with the wings level. */
export const lookOrientation = (from: Vector3, to: Vector3, target = new Quaternion()): Quaternion => {
  const forward = new Vector3().subVectors(to, from).normalize();
  const yaw = Math.atan2(forward.x, forward.z);
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y)));
  const qYaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const qPitch = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -pitch);
  return target.copy(qYaw).multiply(qPitch);
};
