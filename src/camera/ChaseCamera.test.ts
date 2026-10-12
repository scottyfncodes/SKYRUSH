import { describe, expect, it } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { ChaseCamera, BASE_FOV } from './ChaseCamera';
import { createFlightState } from '../flight/FlightModel';

const state = (speed: number, boosting = false) => {
  const s = createFlightState(new Vector3(0, 100, 0), new Quaternion(), speed);
  s.boosting = boosting;
  return s;
};

/** Longest half-extent of any aircraft model (the Needle is 10.6 m long). */
const AIRCRAFT_HALF_LENGTH = 5.5;

describe('ChaseCamera framing', () => {
  it('sits about 30% closer than the original 17 m follow distance', () => {
    const camera = new ChaseCamera(16 / 9);
    const s = state(0);
    camera.snap(s);
    const distance = camera.distanceToAircraft(s);
    const original = Math.hypot(17, 5.2);
    expect(distance).toBeLessThan(original * 0.75);
    expect(distance).toBeGreaterThan(original * 0.6);
  });

  it('never puts the aircraft inside the near plane, even at rest', () => {
    const camera = new ChaseCamera(844 / 390);
    const s = state(0);
    camera.snap(s);
    expect(camera.distanceToAircraft(s) - AIRCRAFT_HALF_LENGTH).toBeGreaterThan(camera.camera.near + 2);
  });

  it('keeps the field of view close to the base value (no fish-eye)', () => {
    const camera = new ChaseCamera(16 / 9);
    camera.snap(state(0));
    expect(camera.camera.fov).toBeCloseTo(BASE_FOV, 0);
    const fast = state(140, true);
    for (let i = 0; i < 300; i += 1) camera.update(fast, 1 / 60);
    expect(camera.camera.fov).toBeLessThanOrEqual(BASE_FOV + 13);
  });

  it('pulls back slightly with speed and boost so speed still reads', () => {
    const camera = new ChaseCamera(16 / 9);
    const slow = state(0);
    camera.snap(slow);
    const near = camera.distanceToAircraft(slow);
    const fast = state(140, true);
    camera.snap(fast);
    const far = camera.distanceToAircraft(fast);
    expect(far).toBeGreaterThan(near + 2);
    expect(far).toBeLessThan(near + 6);
  });

  it('looks ahead of the aircraft, not at it, so the route stays visible', () => {
    const camera = new ChaseCamera(16 / 9);
    const s = state(80);
    camera.snap(s, new Vector3(0, 100, 600));
    const forward = new Vector3();
    camera.camera.getWorldDirection(forward);
    expect(forward.z).toBeGreaterThan(0.9);
  });
});
