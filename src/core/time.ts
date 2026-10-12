/**
 * Fixed-step accumulator. The simulation always advances in `step` seconds
 * increments and never more than `maxSteps` per frame, so a background tab
 * or a long stall cannot explode the physics.
 */
export class FixedStepClock {
  private accumulator = 0;

  constructor(
    public readonly step = 1 / 120,
    public readonly maxSteps = 8,
  ) {}

  /** Returns the number of fixed steps to simulate for a frame delta (seconds). */
  advance(frameDelta: number): number {
    const bounded = Math.min(Math.max(frameDelta, 0), this.step * this.maxSteps);
    this.accumulator += bounded;
    let steps = 0;
    while (this.accumulator >= this.step && steps < this.maxSteps) {
      this.accumulator -= this.step;
      steps += 1;
    }
    if (steps === this.maxSteps) this.accumulator = 0;
    return steps;
  }

  /** Interpolation alpha for rendering between fixed steps. */
  get alpha(): number {
    return this.accumulator / this.step;
  }

  reset(): void {
    this.accumulator = 0;
  }
}
