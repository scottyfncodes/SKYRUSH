import { NEUTRAL_INPUT, type FlightInput } from '../flight/FlightModel';
import { KeyboardInput, type KeyboardAction } from './KeyboardInput';
import { TouchInput } from './TouchInput';

export type InputAction = KeyboardAction;
export type InputDevice = 'keyboard' | 'touch';

export interface InputOptions {
  invertPitch: boolean;
  sensitivity: number;
}

/**
 * Merges keyboard and touch input. Whichever device the player touched most
 * recently drives the aircraft, so a laptop with a touchscreen still works.
 */
export class InputManager {
  readonly keyboard: KeyboardInput;
  readonly touch: TouchInput;
  private readonly current: FlightInput = { ...NEUTRAL_INPUT };
  private readonly listeners = new Set<(action: InputAction) => void>();
  private readonly unsubscribers: (() => void)[] = [];
  options: InputOptions = { invertPitch: false, sensitivity: 1 };
  preferredDevice: InputDevice;

  constructor(touchParent: HTMLElement, preferredDevice: InputDevice) {
    this.keyboard = new KeyboardInput();
    this.touch = new TouchInput(touchParent);
    this.preferredDevice = preferredDevice;
    this.keyboard.attach();
    this.unsubscribers.push(this.keyboard.onAction((action) => this.listeners.forEach((l) => l(action))));
    this.unsubscribers.push(this.touch.onAction((action) => this.listeners.forEach((l) => l(action))));
  }

  onAction(listener: (action: InputAction) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  setEnabled(enabled: boolean): void {
    this.keyboard.setEnabled(enabled);
    this.touch.setVisible(enabled && this.preferredDevice === 'touch');
    if (!enabled) this.touch.clear();
  }

  get activeDevice(): InputDevice {
    if (this.touch.lastActivity > this.keyboard.lastActivity) return 'touch';
    if (this.keyboard.lastActivity > this.touch.lastActivity) return 'keyboard';
    return this.preferredDevice;
  }

  sample(dt: number): FlightInput {
    if (this.activeDevice === 'touch') {
      this.touch.sample(this.current, this.options);
    } else {
      this.keyboard.sample(dt, this.current, this.options);
    }
    return this.current;
  }

  reset(): void {
    this.keyboard.clear();
    this.touch.clear();
    this.touch.resetThrottle();
  }

  dispose(): void {
    this.unsubscribers.forEach((fn) => fn());
    this.keyboard.detach();
    this.touch.dispose();
  }
}
