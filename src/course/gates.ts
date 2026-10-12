import { Vector3 } from 'three';

export type GateKind = 'standard' | 'start' | 'finish' | 'chicane' | 'summit';

export interface GateDefinition {
  index: number; // 0-based order
  position: Vector3; // centre of the gate
  normal: Vector3; // unit vector, intended direction of travel through the gate
  right: Vector3; // unit vector along the gate's width
  halfWidth: number;
  halfHeight: number;
  kind: GateKind;
  label: string;
}

export type GateCrossing = 'none' | 'passed' | 'missed' | 'wrong-way';

const _prevRel = new Vector3();
const _currRel = new Vector3();
const _point = new Vector3();

/**
 * Tests the segment prev→curr against the gate plane.
 * - 'passed': crossed the plane in the intended direction inside the (forgiving) bounds.
 * - 'missed': crossed the plane in the intended direction but outside the bounds.
 * - 'wrong-way': crossed the plane against the intended direction.
 * - 'none': did not cross the plane.
 */
export const testGateCrossing = (
  gate: GateDefinition,
  prev: Vector3,
  curr: Vector3,
  margin = 2.5,
): GateCrossing => {
  _prevRel.subVectors(prev, gate.position);
  _currRel.subVectors(curr, gate.position);
  const dPrev = _prevRel.dot(gate.normal);
  const dCurr = _currRel.dot(gate.normal);
  if (dPrev < 0 && dCurr >= 0) {
    const t = dPrev / (dPrev - dCurr);
    _point.copy(_prevRel).lerp(_currRel, t);
    const lateral = _point.dot(gate.right);
    const vertical = _point.y;
    const inside =
      Math.abs(lateral) <= gate.halfWidth + margin && Math.abs(vertical) <= gate.halfHeight + margin;
    return inside ? 'passed' : 'missed';
  }
  if (dPrev >= 0 && dCurr < 0) return 'wrong-way';
  return 'none';
};

/** Signed distance ahead of (positive) or behind (negative) the gate plane. */
export const distanceAlongGate = (gate: GateDefinition, point: Vector3): number =>
  _currRel.subVectors(point, gate.position).dot(gate.normal);
