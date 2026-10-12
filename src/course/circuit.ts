import { Quaternion, Vector3 } from 'three';
import { createTerrain, type RoutePoint, type Terrain } from './terrain';
import type { GateDefinition, GateKind } from './gates';

export interface GateSpec {
  x: number;
  z: number;
  floor: number;
  clearance: number;
  kind?: GateKind;
  width?: number;
  height?: number;
}

export interface Landmark {
  kind: 'tower' | 'hangar' | 'arch' | 'spire' | 'pylon' | 'antenna' | 'grandstand';
  x: number;
  z: number;
  rotation?: number;
  scale?: number;
}

export interface Circuit {
  id: string;
  name: string;
  location: string;
  description: string;
  gates: GateDefinition[];
  terrain: Terrain;
  spawn: { position: Vector3; orientation: Quaternion; speed: number };
  /** Grid slots for the four racers relative to the spawn (right, up, back offsets). */
  gridSlots: readonly { right: number; up: number; back: number }[];
  landmarks: readonly Landmark[];
  length: number; // metres along the gate polyline
  parTime: number; // seconds, used for reward bonuses
  ceiling: number;
  bounds: number; // horizontal radius from origin after which racers are reset
}

const GATE_WIDTH = 46;
const GATE_HEIGHT = 30;

/**
 * Caldera Ridge: the inaugural SKYRUSH test circuit.
 * A fast run north out of the facility, a long climbing sweep over the ridge,
 * a plunge back into the canyon, the Needle chicane, and a sweeping return home.
 */
const GATE_SPECS: readonly GateSpec[] = [
  { x: 0, z: 150, floor: 0, clearance: 52, kind: 'start' },
  { x: 60, z: 760, floor: 4, clearance: 52 },
  { x: 350, z: 1320, floor: 18, clearance: 56 },
  { x: 850, z: 1680, floor: 60, clearance: 66 },
  { x: 1450, z: 1760, floor: 125, clearance: 92, kind: 'summit' },
  { x: 1960, z: 1400, floor: 84, clearance: 70 },
  { x: 2060, z: 800, floor: 32, clearance: 58 },
  { x: 1720, z: 340, floor: 12, clearance: 52 },
  { x: 1260, z: 560, floor: 10, clearance: 50, kind: 'chicane', width: 42 },
  { x: 900, z: 240, floor: 10, clearance: 50, kind: 'chicane', width: 42 },
  { x: 500, z: -260, floor: 2, clearance: 54 },
  { x: -60, z: -660, floor: 0, clearance: 58 },
  { x: -620, z: -440, floor: 16, clearance: 60 },
  { x: -770, z: 160, floor: 42, clearance: 70 },
  { x: -330, z: 620, floor: 20, clearance: 56, kind: 'finish', width: 52 },
];

const SPAWN = { x: 0, z: -420, floor: 0, altitude: 55 };

const ROUTE: readonly RoutePoint[] = [
  { x: SPAWN.x, z: SPAWN.z - 500, floor: 0 },
  { x: SPAWN.x, z: SPAWN.z, floor: 0 },
  ...GATE_SPECS.map(({ x, z, floor }) => ({ x, z, floor })),
  { x: 100, z: 1000, floor: 10 },
];

const LANDMARKS: readonly Landmark[] = [
  { kind: 'hangar', x: -140, z: -520, rotation: 0, scale: 1 },
  { kind: 'hangar', x: 150, z: -560, rotation: 0.1, scale: 1.2 },
  { kind: 'grandstand', x: -120, z: 120, rotation: Math.PI / 2 },
  { kind: 'tower', x: 130, z: -40 },
  { kind: 'pylon', x: 650, z: 1500 },
  { kind: 'spire', x: 1250, z: 2100, scale: 1.4 },
  { kind: 'spire', x: 1750, z: 2050, scale: 1 },
  { kind: 'antenna', x: 1470, z: 1980 },
  { kind: 'arch', x: 1240, z: 560, rotation: 0.35 },
  { kind: 'spire', x: 2350, z: 1100, scale: 1.2 },
  { kind: 'pylon', x: 1080, z: 400 },
  { kind: 'spire', x: 380, z: -720, scale: 0.9 },
  { kind: 'antenna', x: -920, z: -120 },
  { kind: 'spire', x: -1050, z: 400, scale: 1.3 },
  { kind: 'tower', x: -480, z: 800 },
];

const horizontal = (x: number, z: number): Vector3 => new Vector3(x, 0, z).normalize();

export const createCircuit = (): Circuit => {
  const terrain = createTerrain({ route: ROUTE, valleyWidth: 150, valleyBlend: 420 });

  const gates: GateDefinition[] = GATE_SPECS.map((spec, index) => {
    const prev = index === 0 ? { x: SPAWN.x, z: SPAWN.z } : GATE_SPECS[index - 1]!;
    const next = GATE_SPECS[index + 1] ?? { x: spec.x + (spec.x - prev.x), z: spec.z + (spec.z - prev.z) };
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

  let length = 0;
  let previous = new Vector3(SPAWN.x, SPAWN.floor + SPAWN.altitude, SPAWN.z);
  for (const gate of gates) {
    length += gate.position.distanceTo(previous);
    previous = gate.position;
  }

  const spawnOrientation = new Quaternion(); // facing +Z
  return {
    id: 'caldera-ridge',
    name: 'Caldera Ridge',
    location: 'Sector 7 Proving Grounds',
    description:
      'Fifteen gates through a carved canyon: a flat-out opening straight, a long climb over the ridge, the Needle chicane and a sweeping return to the facility.',
    gates,
    terrain,
    spawn: {
      position: new Vector3(SPAWN.x, SPAWN.floor + SPAWN.altitude, SPAWN.z),
      orientation: spawnOrientation,
      speed: 60,
    },
    gridSlots: [
      { right: 0, up: 0, back: 0 },
      { right: -26, up: 6, back: 30 },
      { right: 26, up: 4, back: 36 },
      { right: 0, up: 12, back: 70 },
    ],
    landmarks: LANDMARKS,
    length,
    parTime: 105,
    ceiling: 900,
    bounds: 4200,
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
