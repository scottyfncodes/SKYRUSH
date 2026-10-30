import { Screen, button, clear, h } from './dom';
import { activeBuild, type PlayerProfile } from '../progression/profile';
import { getAirframe } from '../aircraft/parts';
import { flightParametersForBuild, summarisePerformance } from '../aircraft/performance';
import { formatCredits, formatRaceTime } from '../core/format';
import { getCourseSpec } from '../course/courses';
import { createCourseSelector } from './CoursePicker';
import {
  KIND_LABELS,
  MEDAL_NAMES,
  activitiesIn,
  discoveriesIn,
  type Activity,
  type MedalTier,
} from '../activities/catalog';
import { describeConditions } from '../activities/conditions';
import { activityFit, FIT_LABELS } from '../activities/fit';
import { medalTargets } from '../activities/medals';
import { activityRecord, discoveriesLeft, licenceStatus, suggestNext } from '../progression/activities';

export interface FlightBoardCallbacks {
  onBack: () => void;
  onFly: (activityId: string) => void;
  onSelectRegion: (regionId: string) => void;
  onSelectActivity: (activityId: string) => void;
}

/** How an activity's value reads: a time, an accuracy or a score. */
export const formatActivityValue = (activity: Activity, value: number): string => {
  switch (activity.kind) {
    case 'trial':
    case 'delivery':
      return formatRaceTime(value);
    case 'precision':
      return `${Math.round(value)}%`;
    case 'show':
      return formatCredits(Math.round(value));
    default:
      return '–';
  }
};

/** Three medal marks, filled up to the tier won. */
export const medalPips = (medal: MedalTier): HTMLElement =>
  h(
    'span',
    {
      className: 'medal-pips',
      attrs: { 'aria-label': medal > 0 ? `${MEDAL_NAMES[medal]} medal` : 'No medal yet', role: 'img' },
    },
    ...[1, 2, 3].map((tier) =>
      h('span', { className: `medal-pip medal-pip--${tier}${medal >= tier ? ' is-won' : ''}` }),
    ),
  );

/**
 * The flight board: every activity in a region, laid out like a departures
 * board. One row opens at a time to show what is asked, the medal targets and
 * how well the aircraft in the hangar suits it, with the button to fly.
 */
export class FlightBoardScreen extends Screen {
  private readonly side: HTMLDivElement;
  private readonly board: HTMLDivElement;
  private profile: PlayerProfile | null = null;

  constructor(private readonly callbacks: FlightBoardCallbacks) {
    super('screen--board', 'flight-board');
    this.side = h('div', { className: 'board-side' });
    this.board = h('div', { className: 'board', dataset: { testid: 'board-list' } });
    this.element.append(this.side, this.board);
  }

  update(profile: PlayerProfile): void {
    this.profile = profile;
    const regionId = profile.selectedCircuit;
    const course = getCourseSpec(regionId);
    const activities = activitiesIn(regionId);
    const selected =
      activities.find((activity) => activity.id === profile.selectedActivity) ??
      suggestNext(profile, regionId)?.activity ??
      activities[0]!;
    const build = activeBuild(profile);
    const params = flightParametersForBuild(build);
    const summary = summarisePerformance(params);
    const airframe = getAirframe(build.airframe);

    // --- Side: back, region, licence, hint --------------------------------------------------------
    clear(this.side);
    const licence = licenceStatus(profile);
    const suggestion = suggestNext(profile, regionId);
    const sideParts: (HTMLElement | null)[] = [
      h(
        'div',
        { className: 'board-side__top' },
        button('Back', this.callbacks.onBack, { variant: 'ghost', testId: 'board-back' }),
        h('span', { className: 'board-side__credits', text: `${formatCredits(profile.credits)} cr` }),
      ),
      createCourseSelector({
        selectedId: regionId,
        bestTimes: profile.bestTimes,
        onSelect: this.callbacks.onSelectRegion,
      }),
      h(
        'div',
        { className: 'licence', dataset: { testid: 'board-licence' } },
        h(
          'div',
          { className: 'licence__head' },
          h('span', { className: 'eyebrow', text: 'Pilot licence' }),
          h('span', { className: 'licence__stars', text: `${licence.stars} / ${licence.total} stars` }),
        ),
        h('span', { className: 'licence__rank', text: licence.rank.name }),
        h(
          'div',
          {
            className: 'progress',
            attrs: {
              role: 'progressbar',
              'aria-valuemin': '0',
              'aria-valuemax': '100',
              'aria-valuenow': String(Math.round(licence.progress * 100)),
              'aria-label': 'Progress to the next licence rank',
            },
          },
          h('div', {
            className: 'progress__fill',
            style: { transform: `scaleX(${licence.progress.toFixed(3)})` },
          }),
        ),
        h('span', {
          className: 'licence__next',
          text: licence.next
            ? `${licence.next.stars - licence.stars} more for ${licence.next.name}. Medals and discoveries earn stars.`
            : 'Top rank. Every medal is yours to chase.',
        }),
      ),
      suggestion
        ? h(
            'button',
            {
              className: 'board-hint',
              attrs: { type: 'button' },
              dataset: { testid: 'board-hint' },
              on: { click: () => this.callbacks.onSelectActivity(suggestion.activity.id) },
            },
            h('span', { className: 'eyebrow', text: 'Next up' }),
            h('span', { className: 'board-hint__text', text: suggestion.text }),
          )
        : null,
    ];
    this.side.append(...sideParts.filter((part): part is HTMLElement => part !== null));

    // --- Board -----------------------------------------------------------------------------------
    clear(this.board);
    this.board.append(
      h(
        'div',
        { className: 'board__head' },
        h('span', { className: 'board__title', text: course ? course.name : 'Flight board' }),
        h('span', {
          className: 'board__aircraft',
          text: airframe ? `Flying the ${airframe.name}` : '',
        }),
      ),
    );
    for (const activity of activities) {
      const record = activityRecord(profile, activity.id);
      const open = activity.id === selected.id;
      const fit = activityFit(activity, params, summary);
      const status =
        activity.kind === 'explore'
          ? `${discoveriesIn(regionId).length - discoveriesLeft(profile, regionId)}/${discoveriesIn(regionId).length} found`
          : activity.kind === 'race'
            ? profile.bestTimes[regionId]
              ? formatRaceTime(profile.bestTimes[regionId]!)
              : 'No time yet'
            : record.best !== null
              ? formatActivityValue(activity, record.best)
              : 'Not flown';
      const row = h(
        'div',
        {
          className: `board-row board-row--${activity.kind}${open ? ' is-open' : ''}`,
          dataset: { testid: `board-row-${activity.kind}`, activity: activity.id },
        },
        h(
          'button',
          {
            className: 'board-row__summary',
            attrs: { type: 'button', 'aria-expanded': String(open) },
            on: { click: () => this.callbacks.onSelectActivity(activity.id) },
          },
          h('span', { className: 'board-row__kind', text: KIND_LABELS[activity.kind] }),
          h(
            'span',
            { className: 'board-row__name' },
            h('span', { className: 'board-row__title', text: activity.name }),
            h('span', { className: 'board-row__brief', text: activity.brief }),
          ),
          h('span', { className: 'board-row__status', text: status }),
          activity.kind === 'race' || activity.kind === 'explore'
            ? h('span', { className: 'medal-pips medal-pips--none' })
            : medalPips(record.medal),
        ),
        open ? this.details(activity, fit.rating, fit.text) : null,
      );
      this.board.append(row);
    }
    this.board.querySelector('.is-open')?.scrollIntoView?.({ block: 'nearest' });
  }

  private details(activity: Activity, rating: string, fitText: string): HTMLElement {
    const course = getCourseSpec(activity.regionId);
    const targets = medalTargets(activity);
    const labels = ['Bronze', 'Silver', 'Gold'];
    const targetText = (value: number, index: number): string => {
      if (activity.kind === 'precision' && index === 0) return 'Finish';
      if (activity.kind === 'trial' || activity.kind === 'delivery') return `≤ ${formatRaceTime(value)}`;
      return `≥ ${formatActivityValue(activity, value)}`;
    };
    const conditionLine =
      activity.kind === 'delivery'
        ? `Cargo ${activity.condition.bronze} / ${activity.condition.silver} / ${activity.condition.gold}% for each medal`
        : null;
    return h(
      'div',
      { className: 'board-row__details' },
      h('p', { className: 'board-row__instructions', text: activity.instructions }),
      h(
        'div',
        { className: 'board-row__facts' },
        h('span', { className: 'fact', text: describeConditions(activity.conditions, course?.theme.mood) }),
        h(
          'span',
          { className: `fact fact--fit fact--${rating}`, dataset: { testid: 'board-fit' } },
          h('strong', { text: FIT_LABELS[rating as keyof typeof FIT_LABELS] }),
          h('span', { text: fitText }),
        ),
      ),
      targets
        ? h(
            'div',
            { className: 'board-row__targets' },
            ...targets.map((value, index) =>
              h(
                'span',
                { className: `target target--${index + 1}` },
                h('span', { className: 'target__label', text: labels[index] }),
                h('span', { className: 'target__value', text: targetText(value, index) }),
              ),
            ),
            conditionLine ? h('span', { className: 'target__note', text: conditionLine }) : null,
          )
        : null,
      h(
        'div',
        { className: 'board-row__actions' },
        button(
          activity.kind === 'explore' ? 'Take off' : activity.kind === 'race' ? 'Race' : 'Fly',
          () => this.callbacks.onFly(activity.id),
          { variant: 'primary', testId: 'board-fly' },
        ),
      ),
    );
  }

  /** Re-renders with the last profile (after a region or row change). */
  refresh(profile: PlayerProfile | null = this.profile): void {
    if (profile) this.update(profile);
  }
}
