import type { FlightInput } from '../flight/FlightModel';
import { clamp, moveToward } from '../core/math';

export interface KeyBindings {
  pitchUp: string[];
  pitchDown: string[];
  rollLeft: string[];
  rollRight: string[];
  yawLeft: string[];
  yawRight: string[];
  throttleDown: string[];
  boost: string[];
  airbrake: string[];
  pause: string[];
  restart: string[];
  recenter: string[];
}

/** Published in the in-game controls panel; keep the two in sync. */
export const DEFAULT_BINDINGS: KeyBindings = {
  pitchUp: ['KeyW', 'ArrowUp'],
  pitchDown: ['KeyS', 'ArrowDown'],
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleDown: ['KeyX', 'ControlLeft', 'ControlRight'],
  boost: ['ShiftLeft', 'ShiftRight'],
  airbrake: ['Space'],
  pause: ['Escape', 'KeyP'],
  restart: ['KeyR'],
  recenter: ['KeyC'],
};

export type KeyboardAction = 'pause' | 'restart' | 'recenter';

/**
 * Keyboard flight input. Axes ramp toward the pressed direction so taps give
 * fine control while holds reach full deflection. Clears itself on blur and
 * visibility changes so throttle or boost can never stick.
 */
export class KeyboardInput {
  private readonly pressed = new Set<string>();
  private pitch = 0;
  private roll = 0;
  private yaw = 0;
  private throttle = 1;
  private enabled = false;
  private readonly actionListeners = new Set<(action: KeyboardAction) => void>();
  private readonly onKeyDown: (event: KeyboardEvent) => void;
  private readonly onKeyUp: (event: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  readonly bindings: KeyBindings;
  /** Last time (ms) any bound key changed; used to decide which device is active. */
  lastActivity = 0;

  constructor(bindings: KeyBindings = DEFAULT_BINDINGS) {
    this.bindings = bindings;
    this.onKeyDown = (event) => {
      if (!this.enabled) return;
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (this.isBound(event.code)) {
        event.preventDefault();
        if (!event.repeat) {
          this.pressed.add(event.code);
          this.lastActivity = performance.now();
          this.dispatchAction(event.code);
        }
      }
    };
    this.onKeyUp = (event) => {
      if (this.pressed.delete(event.code)) this.lastActivity = performance.now();
    };
    this.onBlur = () => this.clear();
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('visibilitychange', this.onBlur);
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('visibilitychange', this.onBlur);
    this.clear();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) this.clear();
  }

  onAction(listener: (action: KeyboardAction) => void): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  clear(): void {
    this.pressed.clear();
    this.pitch = 0;
    this.roll = 0;
    this.yaw = 0;
  }

  private isBound(code: string): boolean {
    return Object.values(this.bindings).some((codes) => codes.includes(code));
  }

  private dispatchAction(code: string): void {
    let action: KeyboardAction | null = null;
    if (this.bindings.pause.includes(code)) action = 'pause';
    else if (this.bindings.restart.includes(code)) action = 'restart';
    else if (this.bindings.recenter.includes(code)) action = 'recenter';
    if (action) this.actionListeners.forEach((listener) => listener(action!));
  }

  private axis(negative: string[], positive: string[]): number {
    const neg = negative.some((code) => this.pressed.has(code)) ? 1 : 0;
    const pos = positive.some((code) => this.pressed.has(code)) ? 1 : 0;
    return pos - neg;
  }

  get hasAnyPressed(): boolean {
    return this.pressed.size > 0;
  }

  /** Samples the keyboard into a flight input; `dt` drives axis ramping. */
  sample(dt: number, out: FlightInput, options: { invertPitch: boolean; sensitivity: number }): FlightInput {
    const rate = 6 * options.sensitivity;
    const release = 10;
    const pitchTarget =
      this.axis(this.bindings.pitchDown, this.bindings.pitchUp) * (options.invertPitch ? -1 : 1);
    const rollTarget = this.axis(this.bindings.rollLeft, this.bindings.rollRight);
    const yawTarget = this.axis(this.bindings.yawLeft, this.bindings.yawRight);
    this.pitch = moveToward(this.pitch, pitchTarget, (pitchTarget === 0 ? release : rate) * dt);
    this.roll = moveToward(this.roll, rollTarget, (rollTarget === 0 ? release : rate) * dt);
    this.yaw = moveToward(this.yaw, yawTarget, (yawTarget === 0 ? release : rate) * dt);
    const throttleDown = this.bindings.throttleDown.some((code) => this.pressed.has(code));
    this.throttle = moveToward(this.throttle, throttleDown ? 0.2 : 1, 1.5 * dt);

    out.pitch = clamp(this.pitch, -1, 1);
    out.roll = clamp(this.roll, -1, 1);
    out.yaw = clamp(this.yaw, -1, 1);
    out.throttle = this.throttle;
    out.boost = this.bindings.boost.some((code) => this.pressed.has(code));
    out.airbrake = this.bindings.airbrake.some((code) => this.pressed.has(code));
    return out;
  }
}
