import { Quaternion, Vector3 } from 'three';
import { lookOrientation, type Circuit } from '../course/circuit';
import type { BonusRing, GateDefinition } from '../course/gates';
import type { DeliveryActivity, DiscoverySpec, PrecisionActivity, SegmentRef, ShowActivity } from './catalog';

/** A point on the racing line with its direction of travel. */
export interface SegmentPoint {
  x: number;
  z: number;
  /** Unit horizontal direction of travel along the segment. */
  normal: Vector3;
  right: Vector3;
}

/** Resolves a racing-line reference to a point, clamped to the course's gates. */
export const resolveSegment = (circuit: Circuit, ref: SegmentRef): SegmentPoint => {
  const gates = circuit.gates;
  const index = Math.max(0, Math.min(ref.after, gates.length - 2));
  const from = gates[index]!.position;
  const to = gates[index + 1]!.position;
  const normal = new Vector3(to.x - from.x, 0, to.z - from.z).normalize();
  const right = new Vector3(normal.z, 0, -normal.x);
  const lateral = ref.lateral ?? 0;
  return {
    x: from.x + (to.x - from.x) * ref.t + right.x * lateral,
    z: from.z + (to.z - from.z) * ref.t + right.z * lateral,
    normal,
    right,
  };
};

/** Highest ground across a span centred on (x, z) along `right`. */
const groundAcross = (circuit: Circuit, x: number, z: number, right: Vector3, halfSpan: number): number => {
  let ground = -Infinity;
  for (const offset of [-halfSpan, -halfSpan / 2, 0, halfSpan / 2, halfSpan]) {
    ground = Math.max(ground, circuit.terrain.heightAt(x + right.x * offset, z + right.z * offset));
  }
  return ground;
};

/**
 * A precision run on a region's terrain: narrow gates placed along the racing
 * line, a spawn a short run-up before the first one, no bonus rings.
 */
export const createPrecisionCircuit = (base: Circuit, activity: PrecisionActivity): Circuit => {
  const gates: GateDefinition[] = activity.gates.map((spec, index) => {
    const point = resolveSegment(base, spec);
    const ground = groundAcross(base, point.x, point.z, point.right, spec.width / 2);
    const last = index === activity.gates.length - 1;
    return {
      index,
      position: new Vector3(point.x, ground + spec.agl, point.z),
      normal: point.normal,
      right: point.right,
      halfWidth: spec.width / 2,
      halfHeight: spec.height / 2,
      kind: index === 0 ? 'start' : last ? 'finish' : 'chicane',
      label: index === 0 ? 'START' : last ? 'FINISH' : `${index + 1}`,
    };
  });
  // Re-aim each gate at the line between its neighbours, so offsets read as a slalom.
  for (let i = 0; i < gates.length; i += 1) {
    const prev = gates[i - 1]?.position;
    const next = gates[i + 1]?.position;
    const here = gates[i]!.position;
    const from = prev ?? here;
    const to = next ?? here;
    const direction = new Vector3(to.x - from.x, 0, to.z - from.z);
    if (direction.lengthSq() > 1) {
      direction.normalize();
      gates[i]!.normal.copy(direction);
      gates[i]!.right.set(direction.z, 0, -direction.x);
    }
  }
  const first = gates[0]!;
  const spawn = first.position.clone().addScaledVector(first.normal, -380);
  const spawnGround = base.terrain.heightAt(spawn.x, spawn.z);
  spawn.y = Math.max(first.position.y + 4, spawnGround + 30);
  let length = spawn.distanceTo(first.position);
  for (let i = 1; i < gates.length; i += 1) length += gates[i]!.position.distanceTo(gates[i - 1]!.position);
  return {
    ...base,
    id: base.id,
    gates,
    rings: [],
    spawn: {
      position: spawn,
      orientation: lookOrientation(spawn, first.position, new Quaternion()),
      speed: 58,
    },
    length,
    parTime: activity.timeLimit,
  };
};

/** A delivery stop on the ground (or water) with its hook zone. */
export interface ResolvedStop {
  name: string;
  kind: 'pickup' | 'drop';
  water: boolean;
  /** Ground (or water surface) under the stop. */
  position: Vector3;
}

export const HOOK_RADIUS = 45;

export const resolveStops = (circuit: Circuit, activity: DeliveryActivity): ResolvedStop[] =>
  activity.stops.map((stop) => {
    const point = resolveSegment(circuit, stop);
    return {
      name: stop.name,
      kind: stop.kind,
      water: stop.water === true,
      position: new Vector3(point.x, circuit.terrain.heightAt(point.x, point.z), point.z),
    };
  });

/** The show box floor: the lowest ground at its centre (box heights are above this). */
export const showFloor = (circuit: Circuit, activity: ShowActivity): number =>
  circuit.terrain.heightAt(activity.box.x, activity.box.z);

/** A discovery placed on the terrain. Trails carry their rings. */
export interface ResolvedDiscovery {
  spec: DiscoverySpec;
  /** Where the object stands (ground or water surface; for trails, the first ring). */
  position: Vector3;
  rings: BonusRing[];
}

export const TRAIL_RINGS = 5;
export const TRAIL_RING_RADIUS = 9;
/** Rings sit this far above the highest ground around them. */
const TRAIL_CLEARANCE = 28;
/** Fly within this distance (horizontal) and height window of a discovery to find it. */
export const DISCOVERY_RADIUS = 130;
export const DISCOVERY_HEIGHT = 170;

/** Finds the highest ground within `radius` of (x, z): cairns go on the actual summit. */
const summitNear = (circuit: Circuit, x: number, z: number, radius = 160): { x: number; z: number } => {
  let best = { x, z, h: circuit.terrain.heightAt(x, z) };
  for (let dx = -radius; dx <= radius; dx += 20) {
    for (let dz = -radius; dz <= radius; dz += 20) {
      const h = circuit.terrain.heightAt(x + dx, z + dz);
      if (h > best.h) best = { x: x + dx, z: z + dz, h };
    }
  }
  return { x: best.x, z: best.z };
};

export const resolveDiscovery = (circuit: Circuit, spec: DiscoverySpec): ResolvedDiscovery => {
  const { terrain } = circuit;
  if (spec.kind === 'trail' && spec.to) {
    const rings: BonusRing[] = [];
    const dx = spec.to.x - spec.x;
    const dz = spec.to.z - spec.z;
    const normal = new Vector3(dx, 0, dz).normalize();
    const right = new Vector3(normal.z, 0, -normal.x);
    for (let i = 0; i < TRAIL_RINGS; i += 1) {
      const t = i / (TRAIL_RINGS - 1);
      const x = spec.x + dx * t;
      const z = spec.z + dz * t;
      // Clear the ground across the ring and along the approach to it.
      const ground = Math.max(
        groundAcross(circuit, x, z, right, TRAIL_RING_RADIUS * 2),
        groundAcross(circuit, x, z, normal, 70),
      );
      rings.push({
        index: i,
        position: new Vector3(x, ground + TRAIL_CLEARANCE, z),
        normal,
        radius: TRAIL_RING_RADIUS,
      });
    }
    return { spec, position: rings[0]!.position.clone(), rings };
  }
  const place = spec.kind === 'cairn' ? summitNear(circuit, spec.x, spec.z) : { x: spec.x, z: spec.z };
  return { spec, position: new Vector3(place.x, terrain.heightAt(place.x, place.z), place.z), rings: [] };
};
