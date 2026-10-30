import { describe, expect, it } from 'vitest';
import {
  COMBO_WINDOW,
  MAX_MULTIPLIER,
  NEAR_MISS_CLEARANCE,
  NEAR_MISS_COOLDOWN,
  NEAR_MISS_EXIT,
  NEAR_MISS_MIN_SPEED,
  OVERTAKE_COOLDOWN,
  PERFECT_GATE_OFFSET,
  STYLE_CREDIT_CAP,
  STYLE_POINTS,
  StyleTracker,
  multiplierForChain,
  nearMissBase,
  styleCredits,
  terrainClearance,
  terrainWarning,
} from './StyleTracker';

const DT = 1 / 120;
const FAST = 90;

/** Feeds a clearance for `seconds` at a fixed speed and collects any awards. */
const fly = (tracker: StyleTracker, clearance: number, seconds: number, speed = FAST) => {
  const awards = [];
  for (let t = 0; t < seconds; t += DT) {
    const award = tracker.proximity(clearance, speed, DT);
    tracker.update(DT);
    if (award) awards.push(award);
  }
  return awards;
};

/** A complete skim: arm high, dip into the band, climb back out. */
const skim = (tracker: StyleTracker, low = 5, seconds = 0.6) => [
  ...fly(tracker, 40, 0.1),
  ...fly(tracker, low, seconds),
  ...fly(tracker, 40, 0.1),
];

describe('multiplier and scoring', () => {
  it('starts at ×1 and climbs 0.5 every two skill moves up to ×4', () => {
    expect(multiplierForChain(0)).toBe(1);
    expect(multiplierForChain(1)).toBe(1);
    expect(multiplierForChain(2)).toBe(1.5);
    expect(multiplierForChain(4)).toBe(2);
    expect(multiplierForChain(6)).toBe(2.5);
    expect(multiplierForChain(12)).toBe(MAX_MULTIPLIER);
    expect(multiplierForChain(50)).toBe(MAX_MULTIPLIER);
    expect(multiplierForChain(-3)).toBe(1);
  });

  it('applies the multiplier after the chain increments and reports tier ups', () => {
    const tracker = new StyleTracker();
    const first = tracker.award('ring');
    expect(first).toMatchObject({ points: STYLE_POINTS.ring, multiplier: 1, chain: 1, tierUp: false });
    const second = tracker.award('ring');
    expect(second).toMatchObject({
      points: STYLE_POINTS.ring * 1.5,
      multiplier: 1.5,
      chain: 2,
      tierUp: true,
    });
    expect(tracker.score).toBe(STYLE_POINTS.ring * 2.5);
  });

  it('clean gates score and keep the combo alive but do not extend the chain', () => {
    const tracker = new StyleTracker();
    tracker.award('near-miss');
    tracker.award('near-miss');
    const gate = tracker.gate(0.9);
    expect(gate.kind).toBe('gate');
    expect(gate.chain).toBe(2);
    expect(gate.points).toBe(STYLE_POINTS.gate * 1.5);
    expect(tracker.cleanGates).toBe(1);
    expect(tracker.perfectGates).toBe(0);
  });

  it('a pass inside the perfect radius is a perfect gate; just outside is a normal gate', () => {
    const tracker = new StyleTracker();
    expect(tracker.gate(0).kind).toBe('perfect-gate');
    expect(tracker.gate(PERFECT_GATE_OFFSET).kind).toBe('perfect-gate');
    expect(tracker.gate(PERFECT_GATE_OFFSET + 0.01).kind).toBe('gate');
    expect(tracker.perfectGates).toBe(2);
    expect(tracker.cleanGates).toBe(3);
  });

  it('style credits scale with score and are capped', () => {
    expect(styleCredits(0)).toBe(0);
    expect(styleCredits(-100)).toBe(0);
    expect(styleCredits(2500)).toBe(100);
    expect(styleCredits(1e9)).toBe(STYLE_CREDIT_CAP);
  });
});

describe('combo breaks', () => {
  it('mistakes break the chain and report what was lost', () => {
    const tracker = new StyleTracker();
    for (let i = 0; i < 4; i += 1) tracker.award('perfect-gate');
    const lost = tracker.breakCombo('missed-gate');
    expect(lost).toEqual({ reason: 'missed-gate', chain: 4, multiplier: 2 });
    expect(tracker.chain).toBe(0);
    expect(tracker.multiplier).toBe(1);
    // Best values survive the break for the results screen.
    expect(tracker.bestChain).toBe(4);
    expect(tracker.bestMultiplier).toBe(2);
  });

  it('breaking with no chain reports nothing', () => {
    const tracker = new StyleTracker();
    expect(tracker.breakCombo('crash')).toBeNull();
    tracker.gate(1);
    expect(tracker.breakCombo('scrape')).toBeNull();
  });

  it('the chain times out after the combo window without gates or moves', () => {
    const tracker = new StyleTracker();
    tracker.award('overtake');
    expect(tracker.update(COMBO_WINDOW - 0.1)).toBeNull();
    expect(tracker.comboFraction).toBeGreaterThan(0);
    const expired = tracker.update(0.2);
    expect(expired).toMatchObject({ reason: 'timeout', chain: 1 });
    expect(tracker.comboFraction).toBe(0);
  });

  it('a clean gate refreshes the combo window', () => {
    const tracker = new StyleTracker();
    tracker.award('ring');
    tracker.update(COMBO_WINDOW - 1);
    tracker.gate(1);
    expect(tracker.update(COMBO_WINDOW - 1)).toBeNull();
    expect(tracker.chain).toBe(1);
  });
});

describe('duplicate prevention', () => {
  it('each ring can only be collected once per race', () => {
    const tracker = new StyleTracker();
    expect(tracker.ring(2)).not.toBeNull();
    expect(tracker.ring(2)).toBeNull();
    expect(tracker.ring(3)).not.toBeNull();
    expect(tracker.rings).toBe(2);
    expect(tracker.chain).toBe(2);
  });

  it('re-passing the same opponent only scores after the cooldown', () => {
    const tracker = new StyleTracker();
    expect(tracker.overtake('ai-1', 10)).not.toBeNull();
    expect(tracker.overtake('ai-1', 10 + OVERTAKE_COOLDOWN - 1)).toBeNull();
    expect(tracker.overtake('ai-2', 11)).not.toBeNull();
    expect(tracker.overtake('ai-1', 10 + OVERTAKE_COOLDOWN)).not.toBeNull();
    expect(tracker.overtakes).toBe(3);
  });
});

describe('near misses', () => {
  it('pays once when the aircraft climbs back out of the band', () => {
    const tracker = new StyleTracker();
    fly(tracker, 40, 0.1);
    expect(fly(tracker, 4, 1)).toHaveLength(0); // nothing while still low
    const awards = fly(tracker, 40, 0.1);
    expect(awards).toHaveLength(1);
    expect(awards[0]!.kind).toBe('near-miss');
    expect(tracker.nearMisses).toBe(1);
  });

  it('pays more for closer and longer skims, within bounds', () => {
    expect(nearMissBase(NEAR_MISS_CLEARANCE, 0)).toBe(STYLE_POINTS['near-miss']);
    expect(nearMissBase(3, 0.5)).toBeGreaterThan(nearMissBase(8, 0.5));
    expect(nearMissBase(3, 2)).toBeGreaterThan(nearMissBase(3, 0.3));
    expect(nearMissBase(0, 100)).toBe(STYLE_POINTS['near-miss'] + 150 + 100);
  });

  it('needs the aircraft to start from above the exit height (no award at spawn or after respawn)', () => {
    const tracker = new StyleTracker();
    expect([...fly(tracker, 5, 1), ...fly(tracker, 40, 0.2)]).toHaveLength(0);
    tracker.resetProximity();
    expect([...fly(tracker, 5, 1), ...fly(tracker, 40, 0.2)]).toHaveLength(0);
  });

  it('ignores single-frame grazes and slow flight', () => {
    const tracker = new StyleTracker();
    fly(tracker, 40, 0.1);
    fly(tracker, 5, DT * 2);
    expect(fly(tracker, 40, 0.1)).toHaveLength(0);
    // The graze paid nothing, so it must not have used up the cooldown: a real skim still pays.
    expect(skim(tracker, 5, 1)).toHaveLength(1);
    const slow = new StyleTracker();
    fly(slow, 40, 0.1, NEAR_MISS_MIN_SPEED - 5);
    expect([...fly(slow, 5, 1, NEAR_MISS_MIN_SPEED - 5), ...fly(slow, 40, 0.1)]).toHaveLength(0);
  });

  it('touching the ground during the skim cancels the payout and breaks the combo', () => {
    const tracker = new StyleTracker();
    tracker.award('ring');
    fly(tracker, 40, 0.1);
    fly(tracker, 3, 0.5);
    expect(tracker.breakCombo('scrape')).not.toBeNull();
    expect(fly(tracker, 40, 0.2)).toHaveLength(0);
  });

  it('cannot be farmed by bobbing at the edge of the band', () => {
    const tracker = new StyleTracker();
    fly(tracker, 40, 0.1);
    let awards = 0;
    // Oscillate between just inside the band and just below the exit height for 20 s.
    for (let i = 0; i < 40; i += 1) {
      awards += fly(tracker, NEAR_MISS_CLEARANCE - 1, 0.25).length;
      awards += fly(tracker, NEAR_MISS_EXIT - 1, 0.25).length;
    }
    expect(awards).toBe(0);
  });

  it('rate limits back-to-back skims with a cooldown', () => {
    const tracker = new StyleTracker();
    expect(skim(tracker)).toHaveLength(1);
    expect(skim(tracker)).toHaveLength(0); // within the cooldown
    fly(tracker, 40, NEAR_MISS_COOLDOWN);
    expect(skim(tracker)).toHaveLength(1);
  });
});

describe('terrainClearance', () => {
  const flat = () => 10;

  it('is the height above flat ground', () => {
    expect(terrainClearance(0, 30, 0, 1, 0, flat)).toBe(20);
  });

  it('detects a canyon wall rising beside the aircraft', () => {
    // Wall on the +x side, 6 m away and higher than the aircraft.
    const wall = (x: number) => (x >= 5 ? 200 : 10);
    expect(terrainClearance(0, 40, 0, 1, 0, wall)).toBe(6);
    // Same wall but the aircraft is above it: only the ground counts.
    expect(terrainClearance(0, 260, 0, 1, 0, wall)).toBe(250);
  });

  it('handles a degenerate right vector', () => {
    expect(terrainClearance(0, 30, 0, 0, 0, flat)).toBe(20);
  });
});

describe('terrainWarning', () => {
  it('warns only when low and closing on the ground fast', () => {
    expect(terrainWarning(40, -25)).toBe(true);
    expect(terrainWarning(40, -5)).toBe(false);
    expect(terrainWarning(400, -60)).toBe(false);
    expect(terrainWarning(60, 10)).toBe(false);
  });
});
