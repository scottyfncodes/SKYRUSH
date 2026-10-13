import { describe, expect, it } from 'vitest';
import { DEFAULT_MOUNTAINS, createTerrain, mountainHeight, type TerrainDefinition } from './terrain';

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

describe('mountain profiles', () => {
  it('the default profile reproduces the original Caldera mountains', () => {
    expect(mountainHeight(1234, -567)).toBe(mountainHeight(1234, -567, DEFAULT_MOUNTAINS));
  });

  it('terraces snap mesas to flat steps', () => {
    const profile = { ...DEFAULT_MOUNTAINS, detailAmplitude: 0, terrace: { step: 50, sharpness: 0.2 } };
    let onStep = 0;
    let samples = 0;
    for (let x = -2000; x < 2000; x += 37) {
      const height = mountainHeight(x, 913, profile);
      samples += 1;
      if (Math.abs(height / 50 - Math.round(height / 50)) < 0.02) onStep += 1;
    }
    // Without terraces only ~4% of heights would land this close to a multiple of 50.
    expect(onStep / samples).toBeGreaterThan(0.5);
  });
});

describe('sea level', () => {
  const flooded = createTerrain({
    ...definition,
    route: definition.route.map((point) => ({ ...point, floor: -8 })),
    seaLevel: 0,
  });

  it('treats water as the collision surface but keeps the seabed for rendering', () => {
    expect(flooded.groundAt(0, 0)).toBeLessThan(0);
    expect(flooded.heightAt(0, 0)).toBe(0);
    for (const [x, z] of [
      [0, 0],
      [1800, 2200],
      [-2500, -900],
    ] as const) {
      expect(flooded.heightAt(x, z)).toBe(Math.max(0, flooded.groundAt(x, z)));
    }
  });

  it('leaves dry courses unchanged', () => {
    const dry = createTerrain(definition);
    expect(dry.heightAt(321, 654)).toBe(dry.groundAt(321, 654));
  });
});
