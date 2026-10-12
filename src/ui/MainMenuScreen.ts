import { Screen, button, clear, h } from './dom';
import type { PlayerProfile } from '../progression/profile';
import { formatCredits, formatRaceTime } from '../core/format';

export interface MainMenuCallbacks {
  onRace: () => void;
  onGarage: () => void;
  onControls: () => void;
}

export class MainMenuScreen extends Screen {
  private readonly stats: HTMLDivElement;

  constructor(callbacks: MainMenuCallbacks) {
    super('screen--menu', 'main-menu');
    this.stats = h('div', { className: 'menu-stats' });
    const panel = h(
      'div',
      { className: 'menu-panel' },
      h(
        'div',
        { className: 'brand' },
        h('span', { className: 'brand__eyebrow', text: 'Experimental Aircraft Championship' }),
        h('h1', { className: 'brand__title', text: 'SKYRUSH' }),
        h('p', {
          className: 'brand__tagline',
          text: 'Build a machine. Master the course. Build something faster.',
        }),
      ),
      h(
        'div',
        { className: 'menu-actions' },
        button('Race', callbacks.onRace, { variant: 'primary', testId: 'menu-race' }),
        button('Garage', callbacks.onGarage, { testId: 'menu-garage' }),
        button('Controls & Settings', callbacks.onControls, { variant: 'ghost', testId: 'menu-controls' }),
      ),
      this.stats,
    );
    this.element.append(
      panel,
      h('div', { className: 'menu-footer', text: 'Caldera Ridge · Sector 7 Proving Grounds' }),
    );
  }

  update(profile: PlayerProfile): void {
    clear(this.stats);
    const stat = (label: string, value: string, testId: string) =>
      h(
        'div',
        { className: 'stat' },
        h('span', { className: 'stat__label', text: label }),
        h('span', { className: 'stat__value', text: value, dataset: { testid: testId } }),
      );
    this.stats.append(
      stat('Credits', formatCredits(profile.credits), 'menu-credits'),
      stat(
        'Best time',
        profile.bestTime === null ? '--:--.---' : formatRaceTime(profile.bestTime),
        'menu-best',
      ),
      stat('Races', String(profile.racesCompleted), 'menu-races'),
      stat('Wins', String(profile.wins), 'menu-wins'),
    );
  }
}
