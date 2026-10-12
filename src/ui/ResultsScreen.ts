import { Screen, button, clear, h } from './dom';
import type { Standing } from '../race/RaceSimulation';
import type { AppliedResult } from '../progression/rewards';
import { formatCredits, formatRaceTime, ordinal } from '../core/format';

export interface ResultsCallbacks {
  onRaceAgain: () => void;
  onGarage: () => void;
  onMenu: () => void;
}

export interface ResultsData {
  standings: Standing[];
  player: Standing;
  applied: AppliedResult;
  credits: number;
}

export class ResultsScreen extends Screen {
  private readonly body: HTMLDivElement;

  constructor(private readonly callbacks: ResultsCallbacks) {
    super('screen--results', 'results');
    this.body = h('div', { className: 'dialog dialog--results' });
    this.element.append(this.body);
  }

  update(data: ResultsData): void {
    clear(this.body);
    const { player, applied, standings } = data;
    const reward = applied.reward;
    const rows = standings.map((s) =>
      h(
        'tr',
        { className: s.isPlayer ? 'is-player' : '' },
        h('td', { text: ordinal(s.position) }),
        h('td', { text: s.isPlayer ? 'You' : `${s.callsign} · ${s.name}` }),
        h('td', { text: s.finished ? formatRaceTime(s.finishTime) : 'DNF' }),
        h('td', { text: s.penaltySeconds > 0 ? `+${s.penaltySeconds}s` : '—' }),
      ),
    );
    const unlocks =
      applied.unlocked.length > 0
        ? h(
            'div',
            { className: 'results__unlocks', dataset: { testid: 'results-unlocks' } },
            h('span', { className: 'eyebrow', text: 'Newly unlocked' }),
            ...applied.unlocked.map((part) =>
              h('span', { className: 'chip', text: `${part.name} — now available to buy` }),
            ),
          )
        : null;
    this.body.append(
      h(
        'div',
        { className: 'results__head' },
        h('span', { className: 'eyebrow', text: 'Race complete' }),
        h('div', {
          className: 'results__position',
          text: ordinal(player.position),
          dataset: { testid: 'results-position' },
        }),
        h(
          'div',
          { className: 'results__time' },
          h('span', {
            className: 'results__time-value',
            text: formatRaceTime(player.finishTime),
            dataset: { testid: 'results-time' },
          }),
          applied.newBestTime ? h('span', { className: 'chip chip--accent', text: 'New best' }) : null,
        ),
      ),
      h(
        'div',
        { className: 'results__grid' },
        h(
          'section',
          { className: 'results__section' },
          h('h3', { className: 'panel-title', text: 'Rewards' }),
          line('Finishing position', `+${formatCredits(reward.base)}`),
          line('Clean run bonus', reward.cleanBonus > 0 ? `+${formatCredits(reward.cleanBonus)}` : 'Missed'),
          line('Time bonus vs par', reward.timeBonus > 0 ? `+${formatCredits(reward.timeBonus)}` : '—'),
          line(
            'Gate penalties',
            player.missedGates > 0 ? `${player.missedGates} missed (+${player.missedGates * 4}s)` : 'None',
            player.missedGates > 0 ? 'is-worse' : '',
          ),
          line(
            'Crashes',
            player.crashes > 0 ? `${player.crashes}` : 'None',
            player.crashes > 0 ? 'is-worse' : '',
          ),
          h(
            'div',
            { className: 'results__total' },
            h('span', { text: 'Credits earned' }),
            h('span', { text: `+${formatCredits(reward.total)}`, dataset: { testid: 'results-credits' } }),
          ),
          h(
            'div',
            { className: 'results__balance' },
            h('span', { text: 'Balance' }),
            h('span', { text: `${formatCredits(data.credits)} cr`, dataset: { testid: 'results-balance' } }),
          ),
          unlocks,
        ),
        h(
          'section',
          { className: 'results__section' },
          h('h3', { className: 'panel-title', text: 'Standings' }),
          h(
            'table',
            { className: 'standings', dataset: { testid: 'results-standings' } },
            h('tbody', {}, ...rows),
          ),
        ),
      ),
      h(
        'div',
        { className: 'dialog__actions dialog__actions--row' },
        button('Race again', this.callbacks.onRaceAgain, { variant: 'primary', testId: 'results-again' }),
        button('Garage', this.callbacks.onGarage, { testId: 'results-garage' }),
        button('Main menu', this.callbacks.onMenu, { variant: 'ghost', testId: 'results-menu' }),
      ),
    );
  }
}

const line = (label: string, value: string, className = ''): HTMLElement =>
  h(
    'div',
    { className: `results__line ${className}` },
    h('span', { text: label }),
    h('span', { text: value }),
  );
