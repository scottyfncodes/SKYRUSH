import { clamp01 } from '../core/math';

/**
 * Style scoring layered on top of the race: skilful flying (threading a gate
 * dead centre, skimming the terrain, flying through bonus rings, overtaking)
 * builds a chain, the chain sets a multiplier, and mistakes break it.
 *
 * Pure and deterministic: the race simulation feeds it facts, it returns
 * awards. Nothing here knows about rendering, audio or the DOM.
 */

export type StyleKind = 'gate' | 'perfect-gate' | 'near-miss' | 'ring' | 'overtake';
export type ComboBreakReason = 'crash' | 'missed-gate' | 'scrape' | 'out-of-bounds' | 'timeout';

export interface StyleAward {
  kind: StyleKind;
  /** Points actually added (base × multiplier, rounded). */
  points: number;
  /** Multiplier applied to this award. */
  multiplier: number;
  chain: number;
  /** True when this award raised the multiplier to a new tier. */
  tierUp: boolean;
}

export interface ComboBreak {
  reason: ComboBreakReason;
  /** Chain length that was lost. */
  chain: number;
  multiplier: number;
}

export interface StyleSnapshot {
  score: number;
  chain: number;
  multiplier: number;
  /** 0..1 fraction of the combo window remaining (0 when there is no chain). */
  comboTime: number;
  bestMultiplier: number;
  bestChain: number;
  perfectGates: number;
  cleanGates: number;
  nearMisses: number;
  rings: number;
  overtakes: number;
}

export const STYLE_POINTS: Readonly<Record<StyleKind, number>> = Object.freeze({
  gate: 100,
  'perfect-gate': 250,
  'near-miss': 150,
  ring: 300,
  overtake: 200,
});

/** Skill moves that extend the chain. A clean gate only keeps the chain alive. */
const CHAIN_KINDS: ReadonlySet<StyleKind> = new Set(['perfect-gate', 'near-miss', 'ring', 'overtake']);

/** Seconds a chain survives without a gate or skill move. Gates are ~5–8 s apart. */
export const COMBO_WINDOW = 10;
export const MAX_MULTIPLIER = 4;

/** Normalised gate offset (0 = centre, 1 = frame) at or below which a pass is "perfect". */
export const PERFECT_GATE_OFFSET = 0.38;

/** Near-miss band: terrain closer than this (m) while fast counts as a skim. */
export const NEAR_MISS_CLEARANCE = 9;
/** The skim ends (and pays out) once clearance rises above this (m). Hysteresis prevents bobbing exploits. */
export const NEAR_MISS_EXIT = 15;
/** Minimum airspeed (m/s, ≈180 km/h) for a skim to count. */
export const NEAR_MISS_MIN_SPEED = 50;
/** Minimum time inside the band so a single-frame graze cannot pay out. */
export const NEAR_MISS_MIN_TIME = 0.2;
/** Minimum time between two near-miss awards. */
export const NEAR_MISS_COOLDOWN = 2.5;
/** Seconds before the same opponent can be overtaken for points again. */
export const OVERTAKE_COOLDOWN = 12;

/** Multiplier for a chain length: ×1, then +0.5 every two skill moves, capped at ×4. */
export const multiplierForChain = (chain: number): number =>
  Math.min(MAX_MULTIPLIER, 1 + 0.5 * Math.floor(Math.max(0, chain) / 2));

/** Credits paid for a style score at the end of a race (capped so it never outweighs position). */
export const STYLE_CREDIT_DIVISOR = 25;
export const STYLE_CREDIT_CAP = 500;
export const styleCredits = (score: number): number =>
  Math.max(0, Math.min(STYLE_CREDIT_CAP, Math.floor(score / STYLE_CREDIT_DIVISOR)));

/** Near-miss bonus on top of the base: closer and longer skims pay more, both capped. */
export const nearMissBase = (minClearance: number, duration: number): number => {
  const closeness = clamp01((NEAR_MISS_CLEARANCE - minClearance) / (NEAR_MISS_CLEARANCE - 1.5));
  const length = clamp01(duration / 2.5);
  return Math.round(STYLE_POINTS['near-miss'] + closeness * 150 + length * 100);
};

export class StyleTracker {
  score = 0;
  chain = 0;
  bestMultiplier = 1;
  bestChain = 0;
  perfectGates = 0;
  cleanGates = 0;
  nearMisses = 0;
  overtakes = 0;
  readonly ringsCollected = new Set<number>();
  private comboTimer = 0;

  // Near-miss episode state.
  private armed = false;
  private inSkim = false;
  private skimTime = 0;
  private skimMin = Infinity;
  private skimFailed = false;
  private nearMissCooldown = 0;

  private readonly overtakeTimes = new Map<string, number>();

  get multiplier(): number {
    return multiplierForChain(this.chain);
  }

  get rings(): number {
    return this.ringsCollected.size;
  }

  /** 0..1 fraction of the combo window remaining (0 when there is no chain). */
  get comboFraction(): number {
    return this.chain > 0 ? clamp01(this.comboTimer / COMBO_WINDOW) : 0;
  }

  snapshot(): StyleSnapshot {
    return {
      score: this.score,
      chain: this.chain,
      multiplier: this.multiplier,
      comboTime: this.comboFraction,
      bestMultiplier: this.bestMultiplier,
      bestChain: this.bestChain,
      perfectGates: this.perfectGates,
      cleanGates: this.cleanGates,
      nearMisses: this.nearMisses,
      rings: this.rings,
      overtakes: this.overtakes,
    };
  }

  /** Awards a style move. Chain moves raise the chain before the multiplier is applied. */
  award(kind: StyleKind, base: number = STYLE_POINTS[kind]): StyleAward {
    const before = this.multiplier;
    if (CHAIN_KINDS.has(kind)) {
      this.chain += 1;
      this.bestChain = Math.max(this.bestChain, this.chain);
    }
    const multiplier = this.multiplier;
    this.bestMultiplier = Math.max(this.bestMultiplier, multiplier);
    this.comboTimer = COMBO_WINDOW;
    const points = Math.round(base * multiplier);
    this.score += points;
    switch (kind) {
      case 'gate':
        this.cleanGates += 1;
        break;
      case 'perfect-gate':
        this.cleanGates += 1;
        this.perfectGates += 1;
        break;
      case 'near-miss':
        this.nearMisses += 1;
        break;
      case 'overtake':
        this.overtakes += 1;
        break;
      case 'ring':
        break;
    }
    return { kind, points, multiplier, chain: this.chain, tierUp: multiplier > before };
  }

  /** Scores a gate pass from its normalised offset (0 centre … 1 frame). */
  gate(offset: number): StyleAward {
    return this.award(offset <= PERFECT_GATE_OFFSET ? 'perfect-gate' : 'gate');
  }

  /** Collects a bonus ring once; returns null if it was already collected this race. */
  ring(index: number): StyleAward | null {
    if (this.ringsCollected.has(index)) return null;
    this.ringsCollected.add(index);
    return this.award('ring');
  }

  /** Awards an overtake unless the same opponent was passed for points recently. */
  overtake(opponentId: string, clock: number): StyleAward | null {
    const last = this.overtakeTimes.get(opponentId);
    if (last !== undefined && clock - last < OVERTAKE_COOLDOWN) return null;
    this.overtakeTimes.set(opponentId, clock);
    return this.award('overtake');
  }

  /** Breaks the chain. Returns null when there was nothing to lose. */
  breakCombo(reason: ComboBreakReason): ComboBreak | null {
    if (reason === 'scrape' || reason === 'crash') this.skimFailed = true;
    if (this.chain === 0 && this.comboTimer <= 0) return null;
    const lost: ComboBreak = { reason, chain: this.chain, multiplier: this.multiplier };
    this.chain = 0;
    this.comboTimer = 0;
    return lost.chain > 0 ? lost : null;
  }

  /** Advances timers. Returns a timeout break when the chain expires. */
  update(dt: number): ComboBreak | null {
    this.nearMissCooldown = Math.max(0, this.nearMissCooldown - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.comboTimer = 0;
        if (this.chain > 0) return this.breakCombo('timeout');
      }
    }
    return null;
  }

  /**
   * Feeds the current terrain clearance. A skim starts when the aircraft drops
   * into the near band at speed and pays out once, when it climbs back out
   * without touching the ground. The band has to be re-armed by climbing above
   * the exit height, and awards are rate limited, so hovering at the edge of the
   * band or flying along the floor cannot farm points.
   */
  proximity(clearance: number, speed: number, dt: number): StyleAward | null {
    if (!this.inSkim) {
      if (clearance > NEAR_MISS_EXIT) this.armed = true;
      if (this.armed && clearance < NEAR_MISS_CLEARANCE && speed >= NEAR_MISS_MIN_SPEED) {
        this.inSkim = true;
        this.armed = false;
        this.skimTime = 0;
        this.skimMin = clearance;
        this.skimFailed = false;
      }
      return null;
    }
    this.skimTime += dt;
    this.skimMin = Math.min(this.skimMin, clearance);
    const exited = clearance > NEAR_MISS_EXIT;
    const tooSlow = speed < NEAR_MISS_MIN_SPEED * 0.8;
    if (!exited && !tooSlow) return null;
    this.inSkim = false;
    this.armed = exited;
    if (this.skimFailed || this.skimTime < NEAR_MISS_MIN_TIME || this.nearMissCooldown > 0) return null;
    this.nearMissCooldown = NEAR_MISS_COOLDOWN;
    return this.award('near-miss', nearMissBase(this.skimMin, this.skimTime));
  }

  /** A safe touchdown (floats on water): the current skim no longer counts as a near miss. */
  touchedGround(): void {
    this.skimFailed = true;
  }

  /** Called after a respawn: an interrupted skim never pays out and the band must re-arm. */
  resetProximity(): void {
    this.inSkim = false;
    this.armed = false;
    this.skimFailed = false;
  }
}

/**
 * Distance to the nearest terrain around the aircraft: the height above the
 * ground, or the lateral distance to a canyon wall that rises above it,
 * whichever is smaller. `rightX/rightZ` is the horizontal right vector.
 */
export const terrainClearance = (
  x: number,
  y: number,
  z: number,
  rightX: number,
  rightZ: number,
  heightAt: (x: number, z: number) => number,
): number => {
  let clearance = y - heightAt(x, z);
  const length = Math.hypot(rightX, rightZ);
  if (length < 1e-6) return clearance;
  const rx = rightX / length;
  const rz = rightZ / length;
  for (const distance of [6, 12]) {
    if (distance >= clearance) break;
    for (const side of [-1, 1]) {
      const ground = heightAt(x + rx * distance * side, z + rz * distance * side);
      // A wall beside the aircraft that rises above it is a near obstacle at that distance.
      if (ground > y - 1) clearance = Math.min(clearance, distance);
    }
  }
  return clearance;
};
