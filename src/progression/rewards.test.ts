import { describe, expect, it } from 'vitest';
import { DEFAULT_BUILD } from '../aircraft/build';
import { MAX_HISTORY, createDefaultProfile } from './profile';
import { CLEAN_RACE_BONUS, applyRaceOutcome, computeReward, type RaceOutcome } from './rewards';

const PAR = 105;
const FIXED_DATE = new Date('2026-01-02T03:04:05.000Z');

const outcome = (overrides: Partial<RaceOutcome> = {}): RaceOutcome => ({
  circuitId: 'caldera-ridge',
  position: 1,
  racerCount: 4,
  finishTime: 120,
  rawTime: 120,
  missedGates: 0,
  crashes: 0,
  penaltySeconds: 0,
  parTime: PAR,
  build: { ...DEFAULT_BUILD },
  ...overrides,
});

describe('computeReward', () => {
  it('gives decreasing base rewards for positions 1..4', () => {
    const bases = [1, 2, 3, 4].map(
      (position) =>
        computeReward({ position, finishTime: 200, missedGates: 1, crashes: 0, parTime: PAR }).base,
    );
    expect(bases).toEqual([1500, 1000, 700, 500]);
    for (let i = 1; i < bases.length; i += 1) expect(bases[i]!).toBeLessThan(bases[i - 1]!);
  });

  it('clamps out-of-range positions to the table', () => {
    expect(
      computeReward({ position: 0, finishTime: 200, missedGates: 1, crashes: 0, parTime: PAR }).base,
    ).toBe(1500);
    expect(
      computeReward({ position: 9, finishTime: 200, missedGates: 1, crashes: 0, parTime: PAR }).base,
    ).toBe(500);
  });

  it('awards the clean bonus only when no gates were missed and nothing was crashed', () => {
    const clean = computeReward({ position: 2, finishTime: 200, missedGates: 0, crashes: 0, parTime: PAR });
    expect(clean.cleanBonus).toBe(CLEAN_RACE_BONUS);
    expect(
      computeReward({ position: 2, finishTime: 200, missedGates: 1, crashes: 0, parTime: PAR }).cleanBonus,
    ).toBe(0);
    expect(
      computeReward({ position: 2, finishTime: 200, missedGates: 0, crashes: 1, parTime: PAR }).cleanBonus,
    ).toBe(0);
    expect(clean.total).toBe(clean.base + clean.cleanBonus + clean.timeBonus);
  });

  it('awards a time bonus only when faster than par, capped', () => {
    expect(
      computeReward({ position: 1, finishTime: PAR + 5, missedGates: 0, crashes: 0, parTime: PAR }).timeBonus,
    ).toBe(0);
    expect(
      computeReward({ position: 1, finishTime: PAR, missedGates: 0, crashes: 0, parTime: PAR }).timeBonus,
    ).toBe(0);
    expect(
      computeReward({ position: 1, finishTime: PAR - 10, missedGates: 0, crashes: 0, parTime: PAR })
        .timeBonus,
    ).toBe(150);
    expect(
      computeReward({ position: 1, finishTime: PAR - 1000, missedGates: 0, crashes: 0, parTime: PAR })
        .timeBonus,
    ).toBe(600);
    expect(
      computeReward({ position: 1, finishTime: PAR - 40, missedGates: 0, crashes: 0, parTime: PAR })
        .timeBonus,
    ).toBe(600);
    expect(
      computeReward({ position: 1, finishTime: PAR - 39, missedGates: 0, crashes: 0, parTime: PAR })
        .timeBonus,
    ).toBe(585);
  });

  it('totals the three components', () => {
    const reward = computeReward({
      position: 1,
      finishTime: PAR - 10,
      missedGates: 0,
      crashes: 0,
      parTime: PAR,
    });
    expect(reward).toEqual({ base: 1500, cleanBonus: 300, timeBonus: 150, total: 1950 });
  });
});

describe('applyRaceOutcome', () => {
  it('adds credits, increments counters and records the race', () => {
    const profile = createDefaultProfile();
    const result = applyRaceOutcome(
      profile,
      outcome({ position: 1, finishTime: 95, rawTime: 95 }),
      FIXED_DATE,
    );
    expect(result.reward.total).toBe(1500 + 300 + 150);
    expect(result.profile.credits).toBe(profile.credits + result.reward.total);
    expect(result.profile.racesCompleted).toBe(1);
    expect(result.profile.podiums).toBe(1);
    expect(result.profile.wins).toBe(1);
    expect(result.profile.history).toHaveLength(1);
    expect(result.record).toEqual({
      circuitId: 'caldera-ridge',
      position: 1,
      time: 95,
      rawTime: 95,
      missedGates: 0,
      credits: 1950,
      date: '2026-01-02T03:04:05.000Z',
      build: DEFAULT_BUILD,
    });
    expect(result.profile.history[0]).toEqual(result.record);
    // Input untouched.
    expect(profile.racesCompleted).toBe(0);
    expect(profile.credits).toBe(2500);
    expect(profile.history).toEqual([]);
  });

  it('counts podiums for positions 1..3 and wins only for position 1', () => {
    let profile = createDefaultProfile();
    for (const position of [1, 2, 3, 4]) {
      profile = applyRaceOutcome(profile, outcome({ position }), FIXED_DATE).profile;
    }
    expect(profile.racesCompleted).toBe(4);
    expect(profile.podiums).toBe(3);
    expect(profile.wins).toBe(1);
  });

  it('records the best time only when improved', () => {
    const first = applyRaceOutcome(createDefaultProfile(), outcome({ finishTime: 110 }), FIXED_DATE);
    expect(first.newBestTime).toBe(true);
    expect(first.profile.bestTime).toBe(110);
    expect(first.profile.bestTimeBuild).toEqual(DEFAULT_BUILD);

    const slower = applyRaceOutcome(first.profile, outcome({ finishTime: 115 }), FIXED_DATE);
    expect(slower.newBestTime).toBe(false);
    expect(slower.profile.bestTime).toBe(110);

    const equal = applyRaceOutcome(first.profile, outcome({ finishTime: 110 }), FIXED_DATE);
    expect(equal.newBestTime).toBe(false);

    const otherBuild = { ...DEFAULT_BUILD, wings: 'wings-compact' };
    const faster = applyRaceOutcome(
      slower.profile,
      outcome({ finishTime: 100, build: otherBuild }),
      FIXED_DATE,
    );
    expect(faster.newBestTime).toBe(true);
    expect(faster.profile.bestTime).toBe(100);
    expect(faster.profile.bestTimeBuild).toEqual(otherBuild);
  });

  it('keeps history bounded to MAX_HISTORY, newest first', () => {
    let profile = createDefaultProfile();
    for (let i = 0; i < MAX_HISTORY + 3; i += 1) {
      profile = applyRaceOutcome(profile, outcome({ finishTime: 200 + i }), FIXED_DATE).profile;
    }
    expect(profile.history).toHaveLength(MAX_HISTORY);
    expect(profile.history[0]?.time).toBe(200 + MAX_HISTORY + 2);
    expect(profile.history[MAX_HISTORY - 1]?.time).toBe(203);
    expect(profile.racesCompleted).toBe(MAX_HISTORY + 3);
  });

  it('returns newly unlocked parts', () => {
    const firstRace = applyRaceOutcome(createDefaultProfile(), outcome({ position: 4 }), FIXED_DATE);
    expect(firstRace.unlocked.map((part) => part.id)).toEqual(['engine-twin']);

    const podium = applyRaceOutcome(firstRace.profile, outcome({ position: 3 }), FIXED_DATE);
    expect(podium.unlocked.map((part) => part.id).sort()).toEqual(['engine-pulse', 'fuselage-heavy']);

    const nothingNew = applyRaceOutcome(podium.profile, outcome({ position: 1 }), FIXED_DATE);
    expect(nothingNew.unlocked).toEqual([]);
  });

  it('a first-race win unlocks both the twin and the pulse drive', () => {
    const win = applyRaceOutcome(createDefaultProfile(), outcome({ position: 1 }), FIXED_DATE);
    expect(win.unlocked.map((part) => part.id).sort()).toEqual(['engine-pulse', 'engine-twin']);
  });
});
