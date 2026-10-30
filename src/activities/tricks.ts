import { clamp01 } from '../core/math';
import type { FlightState } from '../flight/FlightModel';

/**
 * Aerobatic scoring for air show activities. The detector integrates the body
 * rotation rates the flight model already produces, so a loop is a real 360° of
 * pitch and a roll a real 360° of roll, however the pilot gets there.
 *
 * Pure and deterministic, like StyleTracker: the activity simulation feeds it
 * the flight state each step and it returns awards.
 */

export type TrickKind = 'loop' | 'outside-loop' | 'roll' | 'barrel-roll' | 'inverted' | 'knife-edge';

export interface TrickAward {
  kind: TrickKind;
  name: string;
  points: number;
  multiplier: number;
  chain: number;
  /** Flown below the low-show line (extra points). */
  low: boolean;
  /** Same figure as the last one: worth half. */
  repeat: boolean;
  tierUp: boolean;
}

export type TrickEvent =
  | { type: 'trick'; award: TrickAward }
  | { type: 'outside-box'; kind: TrickKind }
  | { type: 'chain-lost'; chain: number; multiplier: number };

/** Anything events can be pushed to (the activity's own event list). */
export interface TrickSink {
  push(event: TrickEvent): unknown;
}

export const TRICK_NAMES: Record<TrickKind, string> = {
  loop: 'Loop',
  'outside-loop': 'Outside loop',
  roll: 'Aileron roll',
  'barrel-roll': 'Barrel roll',
  inverted: 'Inverted pass',
  'knife-edge': 'Knife edge',
};

export const TRICK_POINTS: Record<TrickKind, number> = {
  loop: 400,
  'outside-loop': 650,
  roll: 250,
  'barrel-roll': 450,
  inverted: 200,
  'knife-edge': 220,
};

/** Fraction of a full turn that counts as a completed loop or roll (forgives a slightly early stop). */
const FULL_TURN = Math.PI * 2 * 0.92;
/** Roll allowed during a loop before it stops being a loop. */
const LOOP_ROLL_TOLERANCE = Math.PI / 2;
/** Pitch accumulated during a roll beyond which it is a barrel roll. */
const BARREL_PITCH = 1.6;
/** A figure is abandoned once its rotation rate stays low this long. */
const SETTLE_SECONDS = 0.9;
const PITCH_ACTIVE_RATE = 0.35;
const ROLL_ACTIVE_RATE = 0.7;
/** Inverted: wings past 150° of bank, nose within 40° of the horizon. */
const INVERTED_BANK = 2.6;
const HOLD_PITCH = 0.7;
/** Knife edge: wings within ±16° of vertical, nose near the horizon. */
const KNIFE_MIN = 1.3;
const KNIFE_MAX = 1.85;
export const INVERTED_MIN_SECONDS = 1.5;
export const KNIFE_MIN_SECONDS = 1.2;
const HOLD_CAP_SECONDS = 6;
/** Figures flown below this height pay a low-show bonus. */
export const LOW_SHOW_ALTITUDE = 50;
const LOW_BONUS = 1.5;
/** Seconds a chain survives without a new figure. */
export const TRICK_CHAIN_WINDOW = 6;
const MAX_MULTIPLIER = 4;

export const trickMultiplier = (chain: number): number =>
  Math.min(MAX_MULTIPLIER, 1 + 0.5 * Math.max(0, chain - 1));

/** Base points for a held figure (inverted, knife edge) from how long it was held. */
export const holdPoints = (kind: 'inverted' | 'knife-edge', seconds: number): number =>
  Math.round(TRICK_POINTS[kind] + Math.min(seconds, HOLD_CAP_SECONDS) * (kind === 'inverted' ? 120 : 150));

export class TrickTracker {
  score = 0;
  chain = 0;
  bestChain = 0;
  bestMultiplier = 1;
  readonly counts: Record<TrickKind, number> = {
    loop: 0,
    'outside-loop': 0,
    roll: 0,
    'barrel-roll': 0,
    inverted: 0,
    'knife-edge': 0,
  };
  private chainTimer = 0;
  private lastKind: TrickKind | null = null;
  private pitchAcc = 0;
  private rollDuringPitch = 0;
  private pitchIdle = 0;
  private rollAcc = 0;
  private pitchDuringRoll = 0;
  private rollIdle = 0;
  private invertedTime = 0;
  private knifeTime = 0;
  private minAltitude = Infinity;

  get multiplier(): number {
    return this.chain > 0 ? trickMultiplier(this.chain) : 1;
  }

  /** 0..1 of the chain window left. */
  get chainFraction(): number {
    return this.chain > 0 ? clamp01(this.chainTimer / TRICK_CHAIN_WINDOW) : 0;
  }

  get figures(): number {
    return Object.values(this.counts).reduce((sum, count) => sum + count, 0);
  }

  /** Distinct figures flown at least once. */
  get variety(): number {
    return Object.values(this.counts).filter((count) => count > 0).length;
  }

  /**
   * Feeds one step of flight. `inBox` says whether the aircraft is inside the
   * show box; figures completed outside it are reported but score nothing.
   */
  step(state: FlightState, dt: number, inBox: boolean, out: TrickSink): void {
    const pitchRate = state.rates.x;
    const rollRate = state.rates.z;
    this.minAltitude = Math.min(this.minAltitude, state.altitude);

    // Loops: integrate pitch while the nose keeps moving.
    if (Math.abs(pitchRate) > PITCH_ACTIVE_RATE) {
      this.pitchIdle = 0;
      this.pitchAcc += pitchRate * dt;
      this.rollDuringPitch += Math.abs(rollRate) * dt;
    } else {
      this.pitchIdle += dt;
      if (this.pitchIdle > SETTLE_SECONDS) this.resetPitch();
    }
    // Rolls: integrate roll while it keeps going.
    if (Math.abs(rollRate) > ROLL_ACTIVE_RATE) {
      this.rollIdle = 0;
      this.rollAcc += rollRate * dt;
      this.pitchDuringRoll += Math.abs(pitchRate) * dt;
    } else {
      this.rollIdle += dt;
      if (this.rollIdle > SETTLE_SECONDS) this.resetRoll();
    }

    if (Math.abs(this.rollAcc) >= FULL_TURN) {
      const kind: TrickKind = this.pitchDuringRoll >= BARREL_PITCH ? 'barrel-roll' : 'roll';
      this.complete(kind, TRICK_POINTS[kind], state, inBox, out);
      this.rollAcc -= Math.sign(this.rollAcc) * Math.PI * 2;
      this.pitchDuringRoll = 0;
      // A barrel roll swallows the pitch it used; it is not also a loop.
      if (kind === 'barrel-roll') this.resetPitch();
    }
    if (Math.abs(this.pitchAcc) >= FULL_TURN) {
      if (this.rollDuringPitch < LOOP_ROLL_TOLERANCE) {
        const kind: TrickKind = this.pitchAcc > 0 ? 'loop' : 'outside-loop';
        this.complete(kind, TRICK_POINTS[kind], state, inBox, out);
      }
      this.resetPitch();
    }

    // Held figures pay out when the pilot leaves them.
    const bank = Math.abs(state.bank);
    const level = Math.abs(state.pitchAngle) < HOLD_PITCH;
    const inverted = bank > INVERTED_BANK && level;
    const knife = bank > KNIFE_MIN && bank < KNIFE_MAX && level;
    if (inverted) this.invertedTime += dt;
    else if (this.invertedTime > 0) {
      if (this.invertedTime >= INVERTED_MIN_SECONDS)
        this.complete('inverted', holdPoints('inverted', this.invertedTime), state, inBox, out);
      this.invertedTime = 0;
    }
    if (knife) this.knifeTime += dt;
    else if (this.knifeTime > 0) {
      if (this.knifeTime >= KNIFE_MIN_SECONDS)
        this.complete('knife-edge', holdPoints('knife-edge', this.knifeTime), state, inBox, out);
      this.knifeTime = 0;
    }

    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) {
        this.chainTimer = 0;
        this.loseChain(out);
      }
    }
  }

  /** Seconds the current inverted or knife-edge hold has lasted (for the HUD). */
  get holding(): { kind: 'inverted' | 'knife-edge'; seconds: number } | null {
    if (this.invertedTime > 0.4) return { kind: 'inverted', seconds: this.invertedTime };
    if (this.knifeTime > 0.4) return { kind: 'knife-edge', seconds: this.knifeTime };
    return null;
  }

  /** A scrape or crash: the chain and any figure in progress are lost. */
  interrupt(out: TrickSink): void {
    this.resetPitch();
    this.resetRoll();
    this.invertedTime = 0;
    this.knifeTime = 0;
    this.loseChain(out);
  }

  private loseChain(out: TrickSink): void {
    if (this.chain >= 2) out.push({ type: 'chain-lost', chain: this.chain, multiplier: this.multiplier });
    this.chain = 0;
    this.chainTimer = 0;
    this.lastKind = null;
  }

  private resetPitch(): void {
    this.pitchAcc = 0;
    this.rollDuringPitch = 0;
    this.pitchIdle = 0;
  }

  private resetRoll(): void {
    this.rollAcc = 0;
    this.pitchDuringRoll = 0;
    this.rollIdle = 0;
  }

  private complete(kind: TrickKind, base: number, state: FlightState, inBox: boolean, out: TrickSink): void {
    if (!inBox) {
      out.push({ type: 'outside-box', kind });
      this.minAltitude = state.altitude;
      return;
    }
    const before = this.multiplier;
    const repeat = this.lastKind === kind;
    this.chain += 1;
    this.bestChain = Math.max(this.bestChain, this.chain);
    this.chainTimer = TRICK_CHAIN_WINDOW;
    this.lastKind = kind;
    const multiplier = this.multiplier;
    this.bestMultiplier = Math.max(this.bestMultiplier, multiplier);
    const low = Math.min(this.minAltitude, state.altitude) < LOW_SHOW_ALTITUDE;
    this.minAltitude = state.altitude;
    const points = Math.round(base * (repeat ? 0.5 : 1) * (low ? LOW_BONUS : 1) * multiplier);
    this.score += points;
    this.counts[kind] += 1;
    out.push({
      type: 'trick',
      award: {
        kind,
        name: TRICK_NAMES[kind],
        points,
        multiplier,
        chain: this.chain,
        low,
        repeat,
        tierUp: multiplier > before,
      },
    });
  }
}
