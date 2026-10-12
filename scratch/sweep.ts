import { createCircuit } from '../src/course/circuit';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { AI_PERSONALITIES, difficultyMultiplier, type AiPersonality } from '../src/ai/AiPilot';
import { NEUTRAL_INPUT } from '../src/flight/FlightModel';

const circuit = createCircuit();
const run = (ai: AiPersonality, mult: number) => {
  const sim = new RaceSimulation(circuit, [
    { id: 'p', name: 'P', callsign: 'P', isPlayer: true, build: ai.build },
    { id: 'a', name: 'A', callsign: 'A', isPlayer: false, build: ai.build, ai },
  ], { countdownSeconds: 0, aiSkill: mult });
  const dt = 1 / 120; let t = 0; const input = { ...NEUTRAL_INPUT, throttle: 0 };
  while (t < 220 && !sim.racers[1]!.finished) { sim.step(dt, input); t += dt; }
  const r = sim.racers[1]!;
  return `${r.finishTime.toFixed(1)}${r.missedGates ? ' m' + r.missedGates : ''}${r.crashes ? ' c' + r.crashes : ''}`;
};
const agg = AI_PERSONALITIES[1]!;
for (const skill of [0.8, 0.84, 0.88]) for (const caution of [0.7, 0.8]) {
  const ai = { ...agg, skill, cornerCaution: caution };
  console.log(`aggressive skill=${skill} caution=${caution}: w0=${run(ai, difficultyMultiplier(0))} w2=${run(ai, difficultyMultiplier(2))} w5=${run(ai, difficultyMultiplier(5))}`);
}
const spd = AI_PERSONALITIES[2]!;
for (const skill of [0.9, 0.95]) for (const caution of [1.1, 1.3]) {
  const ai = { ...spd, skill, cornerCaution: caution };
  console.log(`speed skill=${skill} caution=${caution}: w0=${run(ai, difficultyMultiplier(0))} w2=${run(ai, difficultyMultiplier(2))} w5=${run(ai, difficultyMultiplier(5))}`);
}
const pre = AI_PERSONALITIES[0]!;
for (const skill of [0.96, 1.0]) for (const caution of [0.9, 1.0]) {
  const ai = { ...pre, skill, cornerCaution: caution };
  console.log(`precision skill=${skill} caution=${caution}: w0=${run(ai, difficultyMultiplier(0))} w2=${run(ai, difficultyMultiplier(2))} w5=${run(ai, difficultyMultiplier(5))}`);
}
