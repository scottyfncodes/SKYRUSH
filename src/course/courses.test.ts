import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createCircuit } from './circuit';
import { COURSES, DEFAULT_COURSE_ID, getCourseSpec, isCourseId } from './courses';
import { RaceSimulation, type RacerConfig } from '../race/RaceSimulation';
import { AI_PERSONALITIES } from '../ai/AiPilot';
import { DEFAULT_BUILD } from '../aircraft/build';
import { NEUTRAL_INPUT } from '../flight/FlightModel';

const DT = 1 / 120;
const IDLE = { ...NEUTRAL_INPUT, throttle: 0 };

const grid = (): RacerConfig[] => [
  { id: 'player', name: 'Player', callsign: 'YOU', isPlayer: true, build: DEFAULT_BUILD },
  ...AI_PERSONALITIES.map((ai) => ({
    id: ai.id,
    name: ai.name,
    callsign: ai.callsign,
    isPlayer: false,
    build: ai.build,
    ai,
  })),
];

describe('course registry', () => {
  it('has four distinct courses with unique ids, names and themes', () => {
    expect(COURSES).toHaveLength(4);
    expect(new Set(COURSES.map((course) => course.id)).size).toBe(COURSES.length);
    expect(new Set(COURSES.map((course) => course.name)).size).toBe(COURSES.length);
    expect(new Set(COURSES.map((course) => course.theme.id)).size).toBe(COURSES.length);
    expect(DEFAULT_COURSE_ID).toBe('caldera-ridge');
  });

  it('looks courses up by id and rejects unknown ids', () => {
    expect(getCourseSpec('coral-coast')?.name).toBe('Coral Coast');
    expect(getCourseSpec('nowhere')).toBeUndefined();
    expect(isCourseId('ember-mesa')).toBe(true);
    expect(isCourseId('nowhere')).toBe(false);
    expect(isCourseId(42)).toBe(false);
  });

  it('falls back to Caldera Ridge for an unknown id', () => {
    expect(createCircuit('nowhere').id).toBe('caldera-ridge');
  });

  it('gives water to exactly the courses with a sea level', () => {
    for (const course of COURSES) {
      expect(!!course.theme.water, course.id).toBe(course.seaLevel !== undefined);
    }
  });
});

describe.each(COURSES.map((course) => [course.id]))('%s', (id) => {
  const circuit = createCircuit(id);

  it('runs from a single start to a single finish', () => {
    expect(circuit.id).toBe(id);
    expect(circuit.gates.length).toBeGreaterThanOrEqual(12);
    expect(circuit.gates[0]!.kind).toBe('start');
    expect(circuit.gates.at(-1)!.kind).toBe('finish');
    expect(circuit.gates.filter((gate) => gate.kind === 'start')).toHaveLength(1);
    expect(circuit.gates.filter((gate) => gate.kind === 'finish')).toHaveLength(1);
    expect(circuit.length).toBeGreaterThan(7000);
    expect(circuit.rings).toHaveLength(6);
  });

  it('keeps every gate and the straight line between gates clear of the terrain', () => {
    const points = [circuit.spawn.position, ...circuit.gates.map((gate) => gate.position)];
    for (let i = 0; i < points.length - 1; i += 1) {
      for (let t = 0; t <= 1; t += 0.02) {
        const p = new Vector3().lerpVectors(points[i]!, points[i + 1]!, t);
        expect(p.y - circuit.terrain.heightAt(p.x, p.z), `segment ${i} at ${t.toFixed(2)}`).toBeGreaterThan(
          30,
        );
      }
    }
  });

  it('places bonus rings low over the ground or water', () => {
    for (const ring of circuit.rings) {
      const clearance = ring.position.y - circuit.terrain.heightAt(ring.position.x, ring.position.z);
      expect(clearance, `ring ${ring.index}`).toBeGreaterThan(8);
      expect(clearance, `ring ${ring.index}`).toBeLessThan(16);
    }
  });

  it('spawns the grid above the ground facing the start gate', () => {
    const { spawn, terrain, gates } = circuit;
    const forward = new Vector3(0, 0, 1).applyQuaternion(spawn.orientation);
    const toStart = new Vector3().subVectors(gates[0]!.position, spawn.position).normalize();
    expect(forward.dot(toStart)).toBeGreaterThan(0.9);
    for (const slot of circuit.gridSlots) {
      const position = spawn.position.clone().add(new Vector3(slot.right, slot.up, -slot.back));
      expect(position.y - terrain.heightAt(position.x, position.z)).toBeGreaterThan(20);
    }
  });

  it('keeps every gate well inside the reset bounds', () => {
    for (const gate of circuit.gates) {
      expect(Math.hypot(gate.position.x, gate.position.z)).toBeLessThan(circuit.bounds - 1000);
    }
  });

  it('has scenery taller than the racing line around it (mountains, mesas or islands)', () => {
    const lowestGate = Math.min(...circuit.gates.map((gate) => gate.position.y));
    let taller = 0;
    for (const radius of [900, 1600, 2400]) {
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
        const x = circuit.center.x + Math.cos(angle) * radius;
        const z = circuit.center.z + Math.sin(angle) * radius;
        if (circuit.terrain.groundAt(x, z) > lowestGate) taller += 1;
      }
    }
    expect(taller).toBeGreaterThanOrEqual(6);
  });

  it('every AI pilot finishes cleanly, and par sits just above the default-build lap', () => {
    const race = new RaceSimulation(circuit, grid(), { aiSkill: 1 });
    let elapsed = 0;
    while (elapsed < 160 && race.racers.some((racer) => racer.config.ai && !racer.finished)) {
      race.step(DT, IDLE);
      elapsed += DT;
    }
    const ai = race.racers.filter((racer) => racer.config.ai);
    for (const racer of ai) {
      expect(racer.finished, racer.config.id).toBe(true);
      expect(racer.crashes, racer.config.id).toBe(0);
      expect(racer.missedGates, racer.config.id).toBe(0);
    }
    // ORBIT flies the player's starting build: par is a stretch goal, not a gimme.
    const orbit = ai.find((racer) => racer.config.id === 'ai-precision')!;
    expect(circuit.parTime).toBeGreaterThan(orbit.finishTime);
    expect(circuit.parTime).toBeLessThan(orbit.finishTime * 1.1);
  });
});
