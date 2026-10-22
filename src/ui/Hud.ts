import { h } from './dom';
import { formatCredits, formatRaceTime, formatSpeedKmh, ordinal } from '../core/format';

export interface HudState {
  position: number;
  racerCount: number;
  speed: number;
  time: number;
  nextGate: number;
  gateCount: number;
  boost: number;
  heat: number;
  overheated: boolean;
  boosting: boolean;
  airbrake: boolean;
  stalled: boolean;
  gateDistance: number;
  /** Screen-space marker for the next gate, or null when behind the camera. */
  marker: { x: number; y: number; onScreen: boolean; angle: number } | null;
  penalties: number;
  style: { score: number; multiplier: number; comboTime: number; rings: number; ringTotal: number };
}

export type ToastTone = 'skill' | 'ring' | 'tier' | 'break';

const formatMultiplier = (multiplier: number): string =>
  `×${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}`;

export class Hud {
  readonly element: HTMLDivElement;
  private readonly position: HTMLSpanElement;
  private readonly progress: HTMLSpanElement;
  private readonly timer: HTMLSpanElement;
  private readonly penalties: HTMLSpanElement;
  private readonly speed: HTMLSpanElement;
  private readonly gateLabel: HTMLSpanElement;
  private readonly gateDistance: HTMLSpanElement;
  private readonly boostFill: HTMLDivElement;
  private readonly heatFill: HTMLDivElement;
  private readonly heatMeter: HTMLDivElement;
  private readonly boostMeter: HTMLDivElement;
  private readonly marker: HTMLDivElement;
  private readonly markerDistance: HTMLSpanElement;
  private readonly arrow: HTMLDivElement;
  private readonly message: HTMLDivElement;
  private readonly countdown: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly styleBox: HTMLDivElement;
  private readonly styleMultiplier: HTMLSpanElement;
  private readonly styleScore: HTMLSpanElement;
  private readonly styleRings: HTMLSpanElement;
  private readonly comboFill: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private messageTimer = 0;
  private messageTimeout: number | null = null;
  private toastTimeout: number | null = null;
  private lastMultiplier = 1;
  private lastScore = -1;
  private lastRings = -1;

  constructor(parent: HTMLElement) {
    this.position = h('span', { className: 'hud-position__value', dataset: { testid: 'hud-position' } });
    this.progress = h('span', { className: 'hud-progress', dataset: { testid: 'hud-progress' } });
    this.timer = h('span', { className: 'hud-timer__value', dataset: { testid: 'hud-timer' } });
    this.penalties = h('span', { className: 'hud-timer__penalty', dataset: { testid: 'hud-penalty' } });
    this.speed = h('span', { className: 'hud-speed__value', dataset: { testid: 'hud-speed' } });
    this.gateLabel = h('span', { className: 'hud-gate__label', dataset: { testid: 'hud-gate' } });
    this.gateDistance = h('span', { className: 'hud-gate__distance' });
    this.boostFill = h('div', { className: 'meter__fill meter__fill--boost' });
    this.heatFill = h('div', { className: 'meter__fill meter__fill--heat' });
    this.boostMeter = h(
      'div',
      { className: 'meter meter--boost', dataset: { testid: 'hud-boost' } },
      h('span', { className: 'meter__label', text: 'Boost' }),
      h('div', { className: 'meter__track' }, this.boostFill),
    );
    this.heatMeter = h(
      'div',
      { className: 'meter meter--heat', dataset: { testid: 'hud-heat' } },
      h('span', { className: 'meter__label', text: 'Heat' }),
      h('div', { className: 'meter__track' }, this.heatFill),
    );
    this.markerDistance = h('span', { className: 'gate-marker__distance' });
    this.marker = h(
      'div',
      { className: 'gate-marker', dataset: { testid: 'hud-marker' } },
      h('div', { className: 'gate-marker__diamond' }),
      this.markerDistance,
    );
    this.arrow = h('div', { className: 'gate-arrow' }, h('div', { className: 'gate-arrow__shape' }));
    this.message = h('div', { className: 'hud-message', dataset: { testid: 'hud-message' } });
    this.countdown = h('div', { className: 'hud-countdown', dataset: { testid: 'hud-countdown' } });
    this.status = h('div', { className: 'hud-status', dataset: { testid: 'hud-status' } });
    this.styleMultiplier = h('span', {
      className: 'hud-style__mult',
      text: '×1',
      dataset: { testid: 'hud-multiplier' },
    });
    this.styleScore = h('span', {
      className: 'hud-style__score',
      text: '0',
      dataset: { testid: 'hud-style' },
    });
    this.styleRings = h('span', { className: 'hud-style__rings', dataset: { testid: 'hud-rings' } });
    this.comboFill = h('div', { className: 'hud-style__fill' });
    this.styleBox = h(
      'div',
      { className: 'hud-style', attrs: { 'aria-live': 'off' } },
      h('div', { className: 'hud-style__row' }, this.styleMultiplier, this.styleScore, this.styleRings),
      h('div', { className: 'hud-style__track' }, this.comboFill),
    );
    this.toast = h('div', { className: 'hud-toast', dataset: { testid: 'hud-toast' } });

    this.element = h(
      'div',
      { className: 'hud', dataset: { testid: 'hud' } },
      h('div', { className: 'hud-position' }, this.position, this.progress),
      h('div', { className: 'hud-timer' }, this.timer, this.penalties),
      this.styleBox,
      this.toast,
      h('div', { className: 'hud-gate' }, this.gateLabel, this.gateDistance),
      h(
        'div',
        { className: 'hud-speed' },
        this.speed,
        h('span', { className: 'hud-speed__unit', text: 'km/h' }),
      ),
      h('div', { className: 'hud-meters' }, this.boostMeter, this.heatMeter),
      this.marker,
      this.arrow,
      this.message,
      this.countdown,
      this.status,
    );
    this.element.hidden = true;
    parent.appendChild(this.element);
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
    this.clearMessage();
    this.clearToast();
    this.countdown.textContent = '';
  }

  /** One reward line under the combo meter. A newer toast replaces the old one, so they never stack. */
  showToast(text: string, tone: ToastTone, duration = 1.3): void {
    this.toast.textContent = text;
    this.toast.className = `hud-toast hud-toast--${tone}`;
    void this.toast.offsetWidth; // restart the animation
    this.toast.classList.add('is-visible');
    if (this.toastTimeout !== null) window.clearTimeout(this.toastTimeout);
    this.toastTimeout = window.setTimeout(() => this.clearToast(), duration * 1000);
  }

  clearToast(): void {
    this.toast.className = 'hud-toast';
    if (this.toastTimeout !== null) {
      window.clearTimeout(this.toastTimeout);
      this.toastTimeout = null;
    }
  }

  /** Resets per-race HUD caches (restart / new race). */
  resetStyle(): void {
    this.lastMultiplier = 1;
    this.lastScore = -1;
    this.lastRings = -1;
    this.styleBox.classList.remove('is-pulse', 'is-active');
    this.clearToast();
  }

  setCountdown(text: string): void {
    this.countdown.textContent = text;
    this.countdown.classList.remove('is-pop');
    void this.countdown.offsetWidth; // restart animation
    this.countdown.classList.add('is-pop');
  }

  clearCountdown(): void {
    this.countdown.textContent = '';
  }

  showMessage(text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral', duration = 2.2): void {
    this.message.textContent = text;
    this.message.className = `hud-message is-visible hud-message--${tone}`;
    this.messageTimer = duration;
    if (this.messageTimeout !== null) window.clearTimeout(this.messageTimeout);
    this.messageTimeout = window.setTimeout(() => this.clearMessage(), duration * 1000);
  }

  clearMessage(): void {
    this.message.className = 'hud-message';
    this.messageTimer = 0;
    if (this.messageTimeout !== null) {
      window.clearTimeout(this.messageTimeout);
      this.messageTimeout = null;
    }
  }

  update(state: HudState): void {
    this.position.textContent = ordinal(state.position);
    this.progress.textContent = `Gate ${Math.min(state.nextGate + 1, state.gateCount)} / ${state.gateCount}`;
    this.timer.textContent = formatRaceTime(state.time);
    this.penalties.textContent = state.penalties > 0 ? `+${state.penalties}s` : '';
    this.speed.textContent = formatSpeedKmh(state.speed);
    this.gateLabel.textContent =
      state.nextGate >= state.gateCount
        ? 'Finish'
        : state.nextGate === state.gateCount - 1
          ? 'Finish gate'
          : `Next gate ${state.nextGate + 1}`;
    this.gateDistance.textContent = `${Math.round(state.gateDistance)} m`;
    this.boostFill.style.width = `${Math.round(state.boost * 100)}%`;
    this.heatFill.style.width = `${Math.round(state.heat * 100)}%`;
    this.boostMeter.classList.toggle('is-active', state.boosting);
    this.heatMeter.classList.toggle('is-hot', state.heat > 0.75);
    this.heatMeter.classList.toggle('is-overheated', state.overheated);
    this.element.classList.toggle('is-boosting', state.boosting);

    const statusText = state.overheated
      ? 'OVERHEATED: ease off'
      : state.stalled
        ? 'STALL: nose down, throttle up'
        : state.airbrake
          ? 'AIRBRAKE'
          : '';
    if (this.status.textContent !== statusText) this.status.textContent = statusText;
    this.status.classList.toggle('is-visible', statusText.length > 0);
    this.status.classList.toggle('is-warning', state.overheated || state.stalled);

    const style = state.style;
    if (style.score !== this.lastScore) {
      this.lastScore = style.score;
      this.styleScore.textContent = formatCredits(style.score);
    }
    if (style.rings !== this.lastRings) {
      this.lastRings = style.rings;
      this.styleRings.textContent = style.ringTotal > 0 ? `◯ ${style.rings}/${style.ringTotal}` : '';
    }
    if (style.multiplier !== this.lastMultiplier) {
      const up = style.multiplier > this.lastMultiplier;
      this.lastMultiplier = style.multiplier;
      this.styleMultiplier.textContent = formatMultiplier(style.multiplier);
      if (up) {
        this.styleBox.classList.remove('is-pulse');
        void this.styleBox.offsetWidth;
        this.styleBox.classList.add('is-pulse');
      }
    }
    this.styleBox.classList.toggle('is-active', style.multiplier > 1);
    this.comboFill.style.transform = `scaleX(${style.comboTime.toFixed(3)})`;

    if (state.marker && state.marker.onScreen) {
      this.marker.style.display = 'flex';
      this.marker.style.transform = `translate(${state.marker.x}px, ${state.marker.y}px) translate(-50%, -50%)`;
      this.markerDistance.textContent = `${Math.round(state.gateDistance)} m`;
      this.arrow.style.display = 'none';
    } else if (state.marker) {
      this.marker.style.display = 'none';
      this.arrow.style.display = 'block';
      this.arrow.style.transform = `translate(${state.marker.x}px, ${state.marker.y}px) translate(-50%, -50%) rotate(${state.marker.angle}rad)`;
    } else {
      this.marker.style.display = 'none';
      this.arrow.style.display = 'none';
    }
  }

  get hasMessage(): boolean {
    return this.messageTimer > 0;
  }
}
