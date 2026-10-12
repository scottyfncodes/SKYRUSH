import { describe, expect, it } from 'vitest';
import { createTerrain, mountainHeight, type TerrainDefinition } from './terrain';

const definition: TerrainDefinition = {
  route: [
    { x: 0, z: -500, floor: 0 },
    { x: 0, z: 500, floor: 20 },
    { x: 500, z: 1000, floor: 40 },
  ],
  valleyWidth: 150,
  valleyBlend: 420,
};

describe('terrain', () => {
  it('is deterministic', () => {
    const a = createTerrain(definition);
    const b = createTerrain(definition);
    for (const [x, z] of [
      [0, 0],
      [123.4, -567.8],
      [2500, 2500],
      [-3000, 1000],
    ] as const) {
      expect(a.heightAt(x, z)).toBe(b.heightAt(x, z));
      expect(mountainHeight(x, z)).toBe(mountainHeight(x, z));
      expect(Number.isFinite(a.heightAt(x, z))).toBe(true);
    }
  });

  it('measures distance to the route polyline and interpolates the floor', () => {
    const terrain = createTerrain(definition);
    expect(terrain.distanceToRoute(0, 0)).toBe(0);
    expect(terrain.distanceToRoute(100, 0)).toBe(100);
    expect(terrain.distanceToRoute(0, -1500)).toBe(1000);
    expect(terrain.floorAt(0, -500)).toBe(0);
    expect(terrain.floorAt(0, 0)).toBe(10);
    expect(terrain.floorAt(0, 500)).toBe(20);
  });

  it('keeps the valley floor near the route within a few metres of the floor altitude', () => {
    const terrain = createTerrain(definition);
    for (let z = -500; z <= 500; z += 100) {
      for (const x of [-100, 0, 100]) {
        const height = terrain.heightAt(x, z);
        const floor = terrain.floorAt(x, z);
        expect(Math.abs(height - floor)).toBeLessThanOrEqual(4);
      }
    }
  });

  it('never dips far below the valley floor outside the valley', () => {
    const terrain = createTerrain(definition);
    for (const [x, z] of [
      [1500, 0],
      [-2000, 300],
      [3000, 3000],
      [0, -4000],
    ] as const) {
      expect(terrain.heightAt(x, z)).toBeGreaterThanOrEqual(terrain.floorAt(x, z) - 20 - 4);
    }
  });
});
