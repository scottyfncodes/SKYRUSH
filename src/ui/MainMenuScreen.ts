import { Screen, button, clear, h } from './dom';
import { bestTimeFor, type PlayerProfile } from '../progression/profile';
import { formatCredits, formatRaceTime } from '../core/format';
import { getCourseSpec } from '../course/courses';
import { createCourseSelector } from './CoursePicker';

export interface MainMenuCallbacks {
  onRace: () => void;
  onSelectCourse: (courseId: string) => void;
  onGarage: () => void;
  onControls: () => void;
}

export class MainMenuScreen extends Screen {
  private readonly stats: HTMLDivElement;
  private readonly course: HTMLDivElement;
  private readonly footer: HTMLDivElement;

  constructor(private readonly callbacks: MainMenuCallbacks) {
    super('screen--menu', 'main-menu');
    this.stats = h('div', { className: 'menu-stats' });
    this.course = h('div', { className: 'menu-course' });
    this.footer = h('div', { className: 'menu-footer', dataset: { testid: 'menu-footer' } });
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
      this.course,
      h(
        'div',
        { className: 'menu-actions' },
        button('Race', callbacks.onRace, { variant: 'primary', testId: 'menu-race' }),
        button('Garage', callbacks.onGarage, { testId: 'menu-garage' }),
        button('Controls & Settings', callbacks.onControls, { variant: 'ghost', testId: 'menu-controls' }),
      ),
      this.stats,
    );
    this.element.append(panel, this.footer);
  }

  update(profile: PlayerProfile): void {
    const course = getCourseSpec(profile.selectedCircuit);
    this.footer.textContent = course ? `${course.name} · ${course.location}` : '';
    clear(this.course);
    this.course.append(
      createCourseSelector({
        selectedId: profile.selectedCircuit,
        bestTimes: profile.bestTimes,
        onSelect: this.callbacks.onSelectCourse,
      }),
    );
    const best = bestTimeFor(profile, profile.selectedCircuit);
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
      stat('Best time', best === null ? '--:--.---' : formatRaceTime(best), 'menu-best'),
      stat('Best style', profile.bestStyle > 0 ? formatCredits(profile.bestStyle) : '–', 'menu-style'),
      stat('Races', String(profile.racesCompleted), 'menu-races'),
      stat('Wins', String(profile.wins), 'menu-wins'),
    );
  }
}
