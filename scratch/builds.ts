import { createCircuit } from '../src/course/circuit';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { AI_PERSONALITIES, type AiPersonality } from '../src/ai/AiPilot';
import { NEUTRAL_INPUT } from '../src/flight/FlightModel';
import { performanceForBuild } from '../src/aircraft/performance';
import { FUSELAGES, ENGINES, WINGS } from '../src/aircraft/parts';

const circuit = createCircuit();
const base = AI_PERSONALITIES[0]!;
const combos: [string, string, string][] = [];
for (const f of FUSELAGES) for (const e of ENGINES) for (const w of WINGS) combos.push([f.id, e.id, w.id]);
for (const [f, e, w] of combos) {
  const build = { fuselage: f, engine: e, wings: w, livery: 'livery-ember' };
  const ai: AiPersonality = { ...base, build, skill: 1, cornerCaution: 0.85, boostHeatLimit: 0.75 };
  const sim = new RaceSimulation(circuit, [
    { id: 'p', name: 'P', callsign: 'P', isPlayer: true, build },
    { id: 'a', name: 'A', callsign: 'A', isPlayer: false, build, ai },
  ], { countdownSeconds: 0 });
  const dt = 1 / 120;
  let t = 0;
  const input = { ...NEUTRAL_INPUT, throttle: 0 };
  while (t < 200 && !sim.racers[1]!.finished) { sim.step(dt, input); t += dt; }
  const r = sim.racers[1]!;
  const p = performanceForBuild(build);
  console.log(`${f.padEnd(20)} ${e.padEnd(17)} ${w.padEnd(15)} time=${r.finishTime.toFixed(1)} raw=${r.rawTime.toFixed(1)} miss=${r.missedGates} crash=${r.crashes} top=${p.topSpeedKmh} acc=${p.accelerationSeconds} turn=${p.turning} stab=${p.stability} heat=${p.heatManagement} boost=${p.boostEndurance}`);
}
