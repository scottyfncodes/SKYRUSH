import type { FlightInput } from '../flight/FlightModel';
import { applyDeadzone, clamp } from '../core/math';

export type TouchAction = 'pause' | 'recenter';

/**
 * Landscape touch controls: a virtual stick on the left (pitch/roll), a
 * throttle slider plus BOOST and BRAKE buttons on the right. Uses pointer
 * events with capture so every touch is cancelled correctly when it ends,
 * leaves the element or the browser interrupts it.
 */
export class TouchInput {
  readonly element: HTMLDivElement;
  private readonly stick: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly throttleTrack: HTMLDivElement;
  private readonly throttleFill: HTMLDivElement;
  private readonly boostButton: HTMLButtonElement;
  private readonly brakeButton: HTMLButtonElement;
  private readonly pauseButton: HTMLButtonElement;
  private stickPointer: number | null = null;
  private throttlePointer: number | null = null;
  private stickX = 0;
  private stickY = 0;
  private throttle = 1;
  private boost = false;
  private airbrake = false;
  private readonly actionListeners = new Set<(action: TouchAction) => void>();
  private readonly cleanups: (() => void)[] = [];
  lastActivity = 0;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.className = 'touch-controls';
    this.element.dataset.testid = 'touch-controls';
    this.element.innerHTML = `
      <div class="touch-stick" data-testid="touch-stick" aria-label="Flight stick">
        <div class="touch-stick__ring"></div>
        <div class="touch-stick__knob"></div>
        <span class="touch-stick__label">PITCH / ROLL</span>
      </div>
      <div class="touch-right">
        <div class="touch-throttle" data-testid="touch-throttle" aria-label="Throttle">
          <div class="touch-throttle__fill"></div>
          <span class="touch-throttle__label">THR</span>
        </div>
        <div class="touch-buttons">
          <button type="button" class="touch-button touch-button--boost" data-testid="touch-boost" aria-label="Boost">BOOST</button>
          <button type="button" class="touch-button touch-button--brake" data-testid="touch-brake" aria-label="Airbrake">BRAKE</button>
        </div>
      </div>
      <button type="button" class="touch-pause" data-testid="touch-pause" aria-label="Pause">II</button>
    `;
    parent.appendChild(this.element);
    this.stick = this.element.querySelector('.touch-stick') as HTMLDivElement;
    this.knob = this.element.querySelector('.touch-stick__knob') as HTMLDivElement;
    this.throttleTrack = this.element.querySelector('.touch-throttle') as HTMLDivElement;
    this.throttleFill = this.element.querySelector('.touch-throttle__fill') as HTMLDivElement;
    this.boostButton = this.element.querySelector('.touch-button--boost') as HTMLButtonElement;
    this.brakeButton = this.element.querySelector('.touch-button--brake') as HTMLButtonElement;
    this.pauseButton = this.element.querySelector('.touch-pause') as HTMLButtonElement;
    this.bind();
    this.renderThrottle();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | Window | Document,
    type: K | string,
    handler: (event: Event) => void,
    options?: AddEventListenerOptions,
  ): void {
    target.addEventListener(type, handler as EventListener, options);
    this.cleanups.push(() => target.removeEventListener(type, handler as EventListener, options));
  }

  private bind(): void {
    // Stop the page from scrolling or zooming while touching the controls.
    this.listen(this.element, 'touchstart', (e) => e.preventDefault(), { passive: false });
    this.listen(this.element, 'touchmove', (e) => e.preventDefault(), { passive: false });
    this.listen(this.element, 'contextmenu', (e) => e.preventDefault());

    // Virtual stick.
    this.listen(this.stick, 'pointerdown', (event) => {
      const e = event as PointerEvent;
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.stick.setPointerCapture(e.pointerId);
      this.updateStick(e);
    });
    this.listen(this.stick, 'pointermove', (event) => {
      const e = event as PointerEvent;
      if (e.pointerId === this.stickPointer) this.updateStick(e);
    });
    const releaseStick = (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.stickX = 0;
      this.stickY = 0;
      this.lastActivity = performance.now();
      this.renderStick();
    };
    this.listen(this.stick, 'pointerup', releaseStick);
    this.listen(this.stick, 'pointercancel', releaseStick);
    this.listen(this.stick, 'lostpointercapture', releaseStick);

    // Throttle slider.
    this.listen(this.throttleTrack, 'pointerdown', (event) => {
      const e = event as PointerEvent;
      if (this.throttlePointer !== null) return;
      this.throttlePointer = e.pointerId;
      this.throttleTrack.setPointerCapture(e.pointerId);
      this.updateThrottle(e);
    });
    this.listen(this.throttleTrack, 'pointermove', (event) => {
      const e = event as PointerEvent;
      if (e.pointerId === this.throttlePointer) this.updateThrottle(e);
    });
    const releaseThrottle = (event: Event) => {
      const e = event as PointerEvent;
      if (e.pointerId === this.throttlePointer) this.throttlePointer = null;
    };
    this.listen(this.throttleTrack, 'pointerup', releaseThrottle);
    this.listen(this.throttleTrack, 'pointercancel', releaseThrottle);
    this.listen(this.throttleTrack, 'lostpointercapture', releaseThrottle);

    // Hold buttons.
    this.bindHold(this.boostButton, (down) => {
      this.boost = down;
    });
    this.bindHold(this.brakeButton, (down) => {
      this.airbrake = down;
    });

    this.listen(this.pauseButton, 'click', () => this.actionListeners.forEach((l) => l('pause')));

    // Any interruption releases everything.
    this.listen(window, 'blur', () => this.clear());
    this.listen(document, 'visibilitychange', () => {
      if (document.hidden) this.clear();
    });
  }

  private bindHold(button: HTMLButtonElement, setter: (down: boolean) => void): void {
    let activePointer: number | null = null;
    this.listen(button, 'pointerdown', (event) => {
      const e = event as PointerEvent;
      e.preventDefault();
      activePointer = e.pointerId;
      button.setPointerCapture(e.pointerId);
      button.classList.add('is-active');
      setter(true);
      this.lastActivity = performance.now();
    });
    const release = (event: Event) => {
      const e = event as PointerEvent;
      if (activePointer !== null && e.pointerId !== activePointer) return;
      activePointer = null;
      button.classList.remove('is-active');
      setter(false);
      this.lastActivity = performance.now();
    };
    this.listen(button, 'pointerup', release);
    this.listen(button, 'pointercancel', release);
    this.listen(button, 'lostpointercapture', release);
    this.listen(button, 'pointerleave', (event) => {
      // Pointer capture normally keeps the hold alive; this is a safety net.
      const e = event as PointerEvent;
      if (activePointer !== null && !button.hasPointerCapture(e.pointerId)) release(event);
    });
  }

  private updateStick(e: PointerEvent): void {
    const rect = this.stick.getBoundingClientRect();
    const radius = rect.width / 2;
    const dx = (e.clientX - (rect.left + radius)) / radius;
    const dy = (e.clientY - (rect.top + radius)) / radius;
    const length = Math.hypot(dx, dy);
    const scale = length > 1 ? 1 / length : 1;
    this.stickX = dx * scale;
    this.stickY = dy * scale;
    this.lastActivity = performance.now();
    this.renderStick();
  }

  private renderStick(): void {
    const rect = this.stick.getBoundingClientRect();
    const radius = rect.width / 2;
    this.knob.style.transform = `translate(${this.stickX * radius * 0.55}px, ${this.stickY * radius * 0.55}px)`;
  }

  private updateThrottle(e: PointerEvent): void {
    const rect = this.throttleTrack.getBoundingClientRect();
    const t = 1 - (e.clientY - rect.top) / rect.height;
    this.throttle = clamp(t, 0, 1);
    this.lastActivity = performance.now();
    this.renderThrottle();
  }

  private renderThrottle(): void {
    this.throttleFill.style.height = `${Math.round(this.throttle * 100)}%`;
  }

  onAction(listener: (action: TouchAction) => void): () => void {
    this.actionListeners.add(listener);
    return () => this.actionListeners.delete(listener);
  }

  setVisible(visible: boolean): void {
    this.element.classList.toggle('is-visible', visible);
    if (!visible) this.clear();
  }

  clear(): void {
    this.stickPointer = null;
    this.throttlePointer = null;
    this.stickX = 0;
    this.stickY = 0;
    this.boost = false;
    this.airbrake = false;
    this.boostButton.classList.remove('is-active');
    this.brakeButton.classList.remove('is-active');
    this.renderStick();
  }

  resetThrottle(): void {
    this.throttle = 1;
    this.renderThrottle();
  }

  get active(): boolean {
    return this.stickPointer !== null || this.throttlePointer !== null || this.boost || this.airbrake;
  }

  sample(out: FlightInput, options: { invertPitch: boolean; sensitivity: number }): FlightInput {
    const x = applyDeadzone(this.stickX, 0.08);
    const y = applyDeadzone(this.stickY, 0.08);
    // Stick up (negative y) = nose up unless inverted.
    const pitch = (options.invertPitch ? y : -y) * options.sensitivity;
    out.pitch = clamp(pitch, -1, 1);
    out.roll = clamp(x * options.sensitivity, -1, 1);
    out.yaw = 0;
    out.throttle = this.throttle;
    out.boost = this.boost;
    out.airbrake = this.airbrake;
    return out;
  }

  dispose(): void {
    this.cleanups.forEach((fn) => fn());
    this.element.remove();
  }
}
