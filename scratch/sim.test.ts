import { it } from 'vitest';
import { createCircuit } from '../src/course/circuit';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { AI_PERSONALITIES } from '../src/ai/AiPilot';
import { NEUTRAL_INPUT } from '../src/flight/FlightModel';
import { DEFAULT_BUILD } from '../src/aircraft/build';

it('ai sim', () => {
  const circuit = createCircuit();
  console.log('length', circuit.length.toFixed(0));
  circuit.gates.forEach((g) => {
    const ground = circuit.terrain.heightAt(g.position.x, g.position.z);
    console.log(`gate ${g.index} y=${g.position.y.toFixed(0)} ground=${ground.toFixed(0)} n=(${g.normal.x.toFixed(2)},${g.normal.z.toFixed(2)})`);
  });
  const sim = new RaceSimulation(circuit, [
    { id: 'p', name: 'Player', callsign: 'YOU', isPlayer: true, build: DEFAULT_BUILD },
    ...AI_PERSONALITIES.map((ai) => ({ id: ai.id, name: ai.name, callsign: ai.callsign, isPlayer: false, build: ai.build, ai })),
  ]);
  const dt = 1 / 120;
  let t = 0;
  const input = { ...NEUTRAL_INPUT, throttle: 0.3 };
  const log: string[] = [];
  while (t < 200) {
    sim.step(dt, input);
    for (const e of sim.drainEvents()) {
      if (e.type === 'gate' || e.type === 'missed' || e.type === 'crash' || e.type === 'finish' || e.type === 'out-of-bounds')
        log.push(`${t.toFixed(1)} ${JSON.stringify(e)}`);
    }
    t += dt;
  }
  console.log(log.join('\n'));
  for (const r of sim.racers) {
    console.log(r.config.id, 'gates', r.gatesPassed, 'missed', r.missedGates, 'crash', r.crashes, 'finish', r.finishTime.toFixed(1), 'alt', r.flight.altitude.toFixed(0), 'speed', r.flight.speed.toFixed(0));
  }
});
