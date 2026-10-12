import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { distanceAlongGate, testGateCrossing, type GateDefinition } from './gates';

/** A gate at the origin facing +Z, 46 m wide and 30 m tall. */
const gate = (): GateDefinition => ({
  index: 0,
  position: new Vector3(0, 0, 0),
  normal: new Vector3(0, 0, 1),
  right: new Vector3(1, 0, 0),
  halfWidth: 23,
  halfHeight: 15,
  kind: 'standard',
  label: '1',
});

const v = (x: number, y: number, z: number) => new Vector3(x, y, z);

describe('testGateCrossing', () => {
  it('passes a crossing through the centre in the intended direction', () => {
    expect(testGateCrossing(gate(), v(0, 0, -1), v(0, 0, 1))).toBe('passed');
  });

  it('passes a crossing that lands exactly on the plane', () => {
    expect(testGateCrossing(gate(), v(0, 0, -1), v(0, 0, 0))).toBe('passed');
  });

  it('passes crossings inside the bounds plus the margin', () => {
    const g = gate();
    expect(testGateCrossing(g, v(22, 0, -1), v(22, 0, 1))).toBe('passed');
    expect(testGateCrossing(g, v(24.5, 0, -1), v(24.5, 0, 1))).toBe('passed'); // 23 + 2.5 margin
    expect(testGateCrossing(g, v(-24.5, 0, -1), v(-24.5, 0, 1))).toBe('passed');
    expect(testGateCrossing(g, v(0, 17, -1), v(0, 17, 1))).toBe('passed'); // 15 + 2.5 margin
    expect(testGateCrossing(g, v(0, -17, -1), v(0, -17, 1))).toBe('passed');
    // A custom margin changes the forgiveness.
    expect(testGateCrossing(g, v(24.5, 0, -1), v(24.5, 0, 1), 0)).toBe('missed');
    expect(testGateCrossing(g, v(30, 0, -1), v(30, 0, 1), 10)).toBe('passed');
  });

  it('misses crossings outside the bounds laterally', () => {
    const g = gate();
    expect(testGateCrossing(g, v(26, 0, -1), v(26, 0, 1))).toBe('missed');
    expect(testGateCrossing(g, v(-26, 0, -1), v(-26, 0, 1))).toBe('missed');
    expect(testGateCrossing(g, v(200, 0, -1), v(200, 0, 1))).toBe('missed');
  });

  it('misses crossings outside the bounds vertically', () => {
    const g = gate();
    expect(testGateCrossing(g, v(0, 18, -1), v(0, 18, 1))).toBe('missed');
    expect(testGateCrossing(g, v(0, -18, -1), v(0, -18, 1))).toBe('missed');
  });

  it('uses the interpolated intersection point, not the endpoints', () => {
    // Enters well inside laterally, exits far outside, but the plane is crossed near the start.
    expect(testGateCrossing(gate(), v(0, 0, -0.1), v(100, 0, 9.9))).toBe('passed');
    // Mirror: the segment crosses the plane far out although it ends near the centre line.
    expect(testGateCrossing(gate(), v(100, 0, -0.1), v(0, 0, 9.9))).toBe('missed');
  });

  it('reports wrong-way for backwards crossings', () => {
    expect(testGateCrossing(gate(), v(0, 0, 1), v(0, 0, -1))).toBe('wrong-way');
    expect(testGateCrossing(gate(), v(100, 50, 1), v(100, 50, -1))).toBe('wrong-way');
  });

  it('reports none when the plane is not crossed', () => {
    const g = gate();
    expect(testGateCrossing(g, v(0, 0, -5), v(0, 0, -3))).toBe('none');
    expect(testGateCrossing(g, v(0, 0, 3), v(0, 0, 5))).toBe('none');
    expect(testGateCrossing(g, v(0, 0, 2), v(0, 0, 2))).toBe('none');
  });

  it('reports none when moving parallel to the plane', () => {
    const g = gate();
    expect(testGateCrossing(g, v(-5, 0, 0), v(5, 0, 0))).toBe('none');
    expect(testGateCrossing(g, v(-5, 3, 4), v(5, -3, 4))).toBe('none');
    expect(testGateCrossing(g, v(-5, 0, -4), v(5, 0, -4))).toBe('none');
  });

  it('respects a rotated gate frame', () => {
    const rotated: GateDefinition = {
      ...gate(),
      position: new Vector3(100, 50, -200),
      normal: new Vector3(1, 0, 0),
      right: new Vector3(0, 0, -1),
    };
    expect(testGateCrossing(rotated, v(99, 50, -200), v(101, 50, -200))).toBe('passed');
    expect(testGateCrossing(rotated, v(99, 50, -230), v(101, 50, -230))).toBe('missed');
    expect(testGateCrossing(rotated, v(101, 50, -200), v(99, 50, -200))).toBe('wrong-way');
    expect(testGateCrossing(rotated, v(100, 40, -300), v(100, 60, -100))).toBe('none');
  });
});

describe('distanceAlongGate', () => {
  it('is positive ahead of the gate and negative behind it', () => {
    const g = gate();
    expect(distanceAlongGate(g, v(50, 5, 10))).toBe(10);
    expect(distanceAlongGate(g, v(50, 5, -10))).toBe(-10);
    expect(distanceAlongGate(g, v(50, 5, 0))).toBe(0);
  });
});
