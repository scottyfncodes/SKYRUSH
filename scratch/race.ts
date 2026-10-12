import { createCircuit } from '../src/course/circuit';
import { RaceSimulation } from '../src/race/RaceSimulation';
import { AI_PERSONALITIES, difficultyMultiplier, type AiPersonality } from '../src/ai/AiPilot';
import { NEUTRAL_INPUT } from '../src/flight/FlightModel';
import { DEFAULT_BUILD } from '../src/aircraft/build';

const circuit = createCircuit();
for (const wins of [0, 2, 5]) {
  const playerAi: AiPersonality = { ...AI_PERSONALITIES[0]!, build: DEFAULT_BUILD, skill: 1, cornerCaution: 0.85 };
  const sim = new RaceSimulation(circuit, [
    { id: 'p', name: 'Player', callsign: 'YOU', isPlayer: true, build: DEFAULT_BUILD },
    { id: 'pa', name: 'PlayerAuto', callsign: 'AUTO', isPlayer: false, build: DEFAULT_BUILD, ai: playerAi },
    ...AI_PERSONALITIES.map((ai) => ({ id: ai.id, name: ai.name, callsign: ai.callsign, isPlayer: false, build: ai.build, ai })),
  ], { aiSkill: difficultyMultiplier(wins) });
  const dt = 1 / 120;
  let t = 0;
  const input = { ...NEUTRAL_INPUT, throttle: 0 };
  while (t < 220) { sim.step(dt, input); t += dt; }
  console.log(`wins=${wins} skill=${difficultyMultiplier(wins).toFixed(3)}`);
  for (const r of sim.racers) {
    console.log('  ', r.config.id.padEnd(14), 'gates', r.gatesPassed, 'missed', r.missedGates, 'crash', r.crashes, 'finish', r.finishTime.toFixed(1), 'alt', r.flight.altitude.toFixed(0));
  }
}
