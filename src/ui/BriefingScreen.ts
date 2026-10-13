import { Screen, button, clear, h } from './dom';
import type { Circuit } from '../course/circuit';
import { bestTimeFor, type PlayerProfile, type PlayerSettings } from '../progression/profile';
import { createCourseGrid } from './CoursePicker';
import { AI_PERSONALITIES } from '../ai/AiPilot';
import { formatRaceTime } from '../core/format';
import { createSettingsPanel } from './SettingsPanel';

export interface BriefingCallbacks {
  onStart: () => void;
  onBack: () => void;
  onSettings: (patch: Partial<PlayerSettings>) => void;
  onSelectCourse: (courseId: string) => void;
}

export class BriefingScreen extends Screen {
  private readonly body: HTMLDivElement;

  constructor(
    private readonly callbacks: BriefingCallbacks,
    private readonly isTouch: boolean,
  ) {
    super('screen--briefing', 'briefing');
    this.body = h('div', { className: 'briefing' });
    this.element.append(this.body);
  }

  update(circuit: Circuit, profile: PlayerProfile): void {
    clear(this.body);
    const opponents = h(
      'ul',
      { className: 'opponents' },
      ...AI_PERSONALITIES.map((ai) =>
        h(
          'li',
          { className: 'opponent' },
          h('span', { className: 'opponent__callsign', text: ai.callsign }),
          h('span', { className: 'opponent__name', text: ai.name }),
          h('span', {
            className: 'opponent__style',
            text:
              ai.style === 'precision'
                ? 'Clean lines, consistent speed'
                : ai.style === 'aggressive'
                  ? 'Late braking, risky corners'
                  : 'Fast straights, wide corners',
          }),
        ),
      ),
    );
    const best = bestTimeFor(profile, circuit.id);
    const card = h(
      'div',
      { className: 'briefing__card' },
      h(
        'section',
        { className: 'briefing__section' },
        h('h3', { className: 'panel-title', text: 'Course' }),
        createCourseGrid({
          selectedId: circuit.id,
          bestTimes: profile.bestTimes,
          onSelect: this.callbacks.onSelectCourse,
        }),
      ),
      h(
        'div',
        { className: 'briefing__head' },
        h('span', { className: 'eyebrow', text: circuit.location }),
        h('h2', { className: 'briefing__title', text: circuit.name }),
        h('p', { className: 'briefing__desc', text: circuit.description }),
      ),
      h(
        'div',
        { className: 'briefing__style', dataset: { testid: 'briefing-style' } },
        h('span', { className: 'eyebrow', text: 'Style' }),
        h('p', {
          text: 'Thread gates dead centre, skim low over the terrain, dive through the gold rings and overtake to build your multiplier and refill boost. Missing a gate or touching the ground breaks the combo.',
        }),
      ),
      h(
        'div',
        { className: 'briefing__facts' },
        fact('Length', `${(circuit.length / 1000).toFixed(1)} km`),
        fact('Gates', String(circuit.gates.length)),
        fact('Par', formatRaceTime(circuit.parTime)),
        fact('Your best', best === null ? '--:--.---' : formatRaceTime(best)),
      ),
      h(
        'div',
        { className: 'briefing__columns' },
        h(
          'section',
          { className: 'briefing__section' },
          h('h3', { className: 'panel-title', text: 'Opponents' }),
          opponents,
        ),
        h(
          'section',
          { className: 'briefing__section' },
          h('h3', { className: 'panel-title', text: 'Controls' }),
          createControlsPanel(this.isTouch),
        ),
      ),
      h(
        'section',
        { className: 'briefing__section' },
        h('h3', { className: 'panel-title', text: 'Flight assistance' }),
        createSettingsPanel(profile.settings, this.callbacks.onSettings),
      ),
      h(
        'div',
        { className: 'briefing__actions' },
        button('Back', this.callbacks.onBack, { variant: 'ghost', testId: 'briefing-back' }),
        button('Start race', this.callbacks.onStart, { variant: 'primary', testId: 'briefing-start' }),
      ),
    );
    this.body.append(card);
  }
}

const fact = (label: string, value: string): HTMLElement =>
  h(
    'div',
    { className: 'fact' },
    h('span', { className: 'fact__label', text: label }),
    h('span', { className: 'fact__value', text: value }),
  );

export const createControlsPanel = (isTouch: boolean): HTMLElement => {
  const rows: [string, string][] = isTouch
    ? [
        ['Left stick', 'Left / right banks and turns; up / down pitches (push up to climb)'],
        ['Throttle slider', 'Drag up or down for engine power'],
        ['BOOST', 'Hold for a burst of thrust (watch the heat)'],
        ['BRAKE', 'Hold to deploy the airbrake before tight turns'],
        ['II', 'Pause, restart or adjust assistance'],
      ]
    : [
        ['W / ↑', 'Nose up (climb)'],
        ['S / ↓', 'Nose down (dive)'],
        ['A / D or ← / →', 'Bank and turn left / right'],
        ['Q / E', 'Yaw left / right'],
        ['Shift', 'Boost (hold)'],
        ['Space', 'Airbrake (hold)'],
        ['X / Ctrl', 'Ease off the throttle (hold)'],
        ['C', 'Recenter camera'],
        ['M', 'Sound on / off'],
        ['R', 'Restart race'],
        ['Esc / P', 'Pause'],
      ];
  return h(
    'dl',
    { className: 'controls', dataset: { testid: 'controls-panel' } },
    ...rows.flatMap(([key, action]) => [
      h('dt', { className: 'controls__key', text: key }),
      h('dd', { className: 'controls__action', text: action }),
    ]),
  );
};
