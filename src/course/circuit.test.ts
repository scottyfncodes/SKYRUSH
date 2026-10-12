import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { createCircuit, lookOrientation } from './circuit';

describe('createCircuit', () => {
  const circuit = createCircuit();

  it('has at least 10 gates in order, starting with start and ending with finish', () => {
    expect(circuit.gates.length).toBeGreaterThanOrEqual(10);
    circuit.gates.forEach((gate, index) => expect(gate.index).toBe(index));
    expect(circuit.gates[0]?.kind).toBe('start');
    expect(circuit.gates[circuit.gates.length - 1]?.kind).toBe('finish');
    expect(circuit.gates[0]?.label).toBe('START');
    expect(circuit.gates[circuit.gates.length - 1]?.label).toBe('FINISH');
    expect(circuit.gates.filter((gate) => gate.kind === 'start')).toHaveLength(1);
    expect(circuit.gates.filter((gate) => gate.kind === 'finish')).toHaveLength(1);
  });

  it('places every gate centre at least 30 m above the terrain', () => {
    for (const gate of circuit.gates) {
      const ground = circuit.terrain.heightAt(gate.position.x, gate.position.z);
      expect(gate.position.y - ground, `gate ${gate.index}`).toBeGreaterThanOrEqual(30);
    }
  });

  it('gives every gate a unit normal perpendicular to a unit right vector, both horizontal', () => {
    for (const gate of circuit.gates) {
      expect(gate.normal.length()).toBeCloseTo(1, 10);
      expect(gate.right.length()).toBeCloseTo(1, 10);
      expect(gate.normal.dot(gate.right)).toBeCloseTo(0, 10);
      expect(gate.normal.y).toBe(0);
      expect(gate.right.y).toBe(0);
      expect(gate.halfWidth).toBeGreaterThan(0);
      expect(gate.halfHeight).toBeGreaterThan(0);
    }
  });

  it('points each gate normal roughly toward the next gate', () => {
    for (let i = 0; i < circuit.gates.length - 1; i += 1) {
      const gate = circuit.gates[i]!;
      const next = circuit.gates[i + 1]!;
      const toNext = new Vector3().subVectors(next.position, gate.position);
      toNext.y = 0;
      toNext.normalize();
      expect(gate.normal.dot(toNext), `gate ${i}`).toBeGreaterThan(0);
    }
  });

  it('has a length over 5000 m and sane metadata', () => {
    expect(circuit.length).toBeGreaterThan(5000);
    expect(circuit.parTime).toBeGreaterThan(0);
    expect(circuit.ceiling).toBeGreaterThan(0);
    expect(circuit.bounds).toBeGreaterThan(0);
    expect(circuit.gridSlots.length).toBeGreaterThanOrEqual(4);
    expect(circuit.spawn.speed).toBeGreaterThan(0);
    expect(circuit.id).toBe('caldera-ridge');
  });

  it('spawns above the terrain facing the start gate', () => {
    const { spawn, terrain, gates } = circuit;
    expect(spawn.position.y - terrain.heightAt(spawn.position.x, spawn.position.z)).toBeGreaterThan(30);
    const forward = new Vector3(0, 0, 1).applyQuaternion(spawn.orientation);
    const toStart = new Vector3().subVectors(gates[0]!.position, spawn.position).normalize();
    expect(forward.dot(toStart)).toBeGreaterThan(0.9);
    for (const slot of circuit.gridSlots) {
      const position = spawn.position.clone().add(new Vector3(slot.right, slot.up, -slot.back));
      expect(position.y - terrain.heightAt(position.x, position.z)).toBeGreaterThan(20);
    }
  });

  it('builds a deterministic terrain with a low valley floor along the route and mountains far away', () => {
    const other = createCircuit();
    const samples: [number, number][] = [
      [0, 0],
      [0, 500],
      [60, 760],
      [350, 1320],
      [-60, -660],
    ];
    for (const [x, z] of samples) expect(circuit.terrain.heightAt(x, z)).toBe(other.terrain.heightAt(x, z));

    const routeHeights = samples.map(([x, z]) => circuit.terrain.heightAt(x, z));
    const farSamples: [number, number][] = [
      [3000, 3000],
      [-3000, 3000],
      [3000, -3000],
      [-3000, -3000],
      [3500, 0],
      [0, 3500],
      [-3500, 0],
      [0, -3500],
    ];
    const farHeights = farSamples.map(([x, z]) => circuit.terrain.heightAt(x, z));
    expect(Math.min(...farHeights)).toBeGreaterThan(Math.max(...routeHeights) + 50);
    for (const [x, z] of samples) expect(circuit.terrain.distanceToRoute(x, z)).toBeLessThan(150);
    for (const [x, z] of farSamples) expect(circuit.terrain.distanceToRoute(x, z)).toBeGreaterThan(1000);
  });
});

describe('lookOrientation', () => {
  const forwardOf = (q: Quaternion) => new Vector3(0, 0, 1).applyQuaternion(q);
  const rightOf = (q: Quaternion) => new Vector3(1, 0, 0).applyQuaternion(q);

  it('faces from one point toward another', () => {
    const from = new Vector3(10, 20, 30);
    const to = new Vector3(110, 20, 30);
    const q = lookOrientation(from, to);
    const forward = forwardOf(q);
    expect(forward.x).toBeCloseTo(1, 10);
    expect(forward.y).toBeCloseTo(0, 10);
    expect(forward.z).toBeCloseTo(0, 10);
    expect(q.length()).toBeCloseTo(1, 10);
  });

  it('keeps the wings level while pitching toward the target', () => {
    const q = lookOrientation(new Vector3(0, 0, 0), new Vector3(0, 100, 100));
    const forward = forwardOf(q);
    expect(forward.y).toBeCloseTo(Math.SQRT1_2, 10);
    expect(forward.z).toBeCloseTo(Math.SQRT1_2, 10);
    expect(rightOf(q).y).toBeCloseTo(0, 10);
    const down = lookOrientation(new Vector3(0, 0, 0), new Vector3(0, -100, 100));
    expect(forwardOf(down).y).toBeCloseTo(-Math.SQRT1_2, 10);
  });

  it('writes into the supplied target quaternion', () => {
    const target = new Quaternion();
    const result = lookOrientation(new Vector3(0, 0, 0), new Vector3(-50, 0, 0), target);
    expect(result).toBe(target);
    expect(forwardOf(target).x).toBeCloseTo(-1, 10);
  });
});
