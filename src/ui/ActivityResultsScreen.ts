import { CATEGORY_LABELS } from '../aircraft/parts';
import { Screen, button, clear, h } from './dom';
import { formatCredits, formatRaceTime } from '../core/format';
import { KIND_LABELS, MEDAL_NAMES } from '../activities/catalog';
import { medalTargets } from '../activities/medals';
import { LICENCE_RANKS, type AppliedActivity, type LicenceStatus } from '../progression/activities';
import { liveryForBadge } from '../progression/badges';
import { formatActivityValue, medalPips } from './FlightBoardScreen';
import { getCourseSpec } from '../course/courses';

export interface ActivityResultsCallbacks {
  onAgain: () => void;
  onBoard: () => void;
  onGarage: () => void;
}

export interface ActivityResultsData {
  applied: AppliedActivity;
  /** The run's value (time, accuracy or score); null for free flight. */
  value: number | null;
  /** Why the run ended early, in words, or null. */
  failure: string | null;
  /** Kind-specific lines for the highlights row. */
  highlights: { label: string; value: string }[];
  credits: number;
  licence: LicenceStatus;
}

/**
 * Results for every activity except the Grand Prix: the medal, the number that
 * earned it, what it paid and what it unlocked, and the licence progress.
 */
export class ActivityResultsScreen extends Screen {
  private readonly body: HTMLDivElement;
  private readonly onKey: (event: KeyboardEvent) => void;

  constructor(private readonly callbacks: ActivityResultsCallbacks) {
    super('screen--results screen--activity-results', 'activity-results');
    this.body = h('div', { className: 'dialog dialog--results' });
    this.element.append(this.body);
    this.onKey = (event) => {
      if (!this.visible || event.repeat) return;
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        this.callbacks.onAgain();
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  update(data: ActivityResultsData): void {
    clear(this.body);
    const { applied, value, failure } = data;
    const { activity, reward } = applied;
    const course = getCourseSpec(activity.regionId);
    const explore = activity.kind === 'explore';
    const medal = applied.medal;
    const improved = medal > applied.previousMedal;
    const headline = failure
      ? failure
      : explore
        ? applied.discoveries.length > 0
          ? `${applied.discoveries.length} ${applied.discoveries.length === 1 ? 'discovery' : 'discoveries'}`
          : 'Flight logged'
        : medal > 0
          ? `${MEDAL_NAMES[medal]} medal`
          : 'No medal this time';

    const targets = medalTargets(activity);
    const ladder =
      targets && value !== null
        ? h(
            'div',
            { className: 'medal-ladder' },
            ...targets.map((target, index) => {
              const tier = index + 1;
              const label =
                activity.kind === 'precision' && index === 0
                  ? 'Finish'
                  : activity.kind === 'trial' || activity.kind === 'delivery'
                    ? formatRaceTime(target)
                    : formatActivityValue(activity, target);
              return h(
                'span',
                {
                  className: `medal-ladder__step medal-ladder__step--${tier}${medal >= tier ? ' is-won' : ''}`,
                },
                h('span', { className: 'medal-ladder__name', text: MEDAL_NAMES[tier] }),
                h('span', { className: 'medal-ladder__target', text: label }),
              );
            }),
          )
        : null;

    const rankUp = applied.rankAfter > applied.rankBefore;
    const licence = data.licence;
    const unlocks =
      applied.unlocked.length > 0
        ? h(
            'div',
            { className: 'results__unlocks', dataset: { testid: 'activity-unlocks' } },
            h('span', { className: 'eyebrow', text: 'Newly unlocked' }),
            ...applied.unlocked.map((item) =>
              h('span', {
                className: `chip${item.kind === 'airframe' ? ' chip--aircraft' : ''}`,
                text:
                  item.kind === 'airframe'
                    ? `${item.name} ${item.archetype.toLowerCase()}: in the hangar to buy`
                    : `${item.name}: ${CATEGORY_LABELS[item.category].toLowerCase()} now available`,
              }),
            ),
          )
        : null;

    const sections: (HTMLElement | null)[] = [
      h(
        'div',
        { className: 'results__head' },
        h('span', { className: 'eyebrow', text: `${KIND_LABELS[activity.kind]} · ${course?.name ?? ''}` }),
        h('div', { className: 'results__activity', text: activity.name }),
        h(
          'div',
          {
            className: `results__medal results__medal--${failure ? 0 : medal}`,
            dataset: { testid: 'activity-medal' },
          },
          explore ? null : medalPips(failure ? 0 : medal),
          h('span', { className: 'results__medal-text', text: headline }),
          improved && !failure
            ? h('span', { className: 'chip chip--accent chip--pop', text: 'New medal' })
            : null,
        ),
        value !== null && !failure
          ? h(
              'div',
              { className: 'results__time' },
              h('span', {
                className: 'results__time-value',
                text: formatActivityValue(activity, value),
                dataset: { testid: 'activity-value' },
              }),
              applied.newBest && applied.previousBest !== null
                ? h('span', { className: 'chip chip--accent chip--pop', text: 'Personal best' })
                : null,
            )
          : null,
        h(
          'div',
          { className: 'results__actions' },
          button(explore ? 'Fly again' : 'Try again', this.callbacks.onAgain, {
            variant: 'primary',
            testId: 'activity-again',
            className: 'btn--replay',
          }),
          button('Flight board', this.callbacks.onBoard, { testId: 'activity-board' }),
          button('Hangar', this.callbacks.onGarage, { variant: 'ghost', testId: 'activity-garage' }),
        ),
      ),
      data.highlights.length > 0
        ? h(
            'div',
            { className: 'results__highlights', dataset: { testid: 'activity-highlights' } },
            ...data.highlights.map((item) =>
              h(
                'div',
                { className: 'highlight' },
                h('span', { className: 'highlight__label', text: item.label }),
                h('span', { className: 'highlight__value', text: item.value }),
              ),
            ),
          )
        : null,
      ladder,
      ...applied.discoveries.map((discovery) =>
        h(
          'div',
          { className: 'discovery-card', dataset: { testid: 'activity-discovery' } },
          h('span', { className: 'eyebrow', text: 'Discovered' }),
          h('strong', { className: 'discovery-card__name', text: discovery.name }),
          h('p', { className: 'discovery-card__lore', text: discovery.lore }),
        ),
      ),
      ...applied.badges.map((badge) =>
        h(
          'div',
          { className: 'badge-earned' },
          h('span', { className: 'badge-earned__mark', attrs: { 'aria-hidden': 'true' } }),
          h(
            'span',
            { className: 'badge-earned__text' },
            h('strong', { text: `Badge earned: ${badge.name}` }),
            h('span', {
              text: `. ${liveryForBadge(badge.id)?.name ?? 'New'} livery and colour unlocked in the paint shop`,
            }),
          ),
        ),
      ),
      h(
        'div',
        { className: 'results__grid' },
        h(
          'section',
          { className: 'results__section' },
          h('h3', { className: 'panel-title', text: 'Rewards' }),
          line('Completion', reward.completion > 0 ? `+${formatCredits(reward.completion)}` : '–'),
          line('Personal best', reward.personalBest > 0 ? `+${formatCredits(reward.personalBest)}` : '–'),
          line('New medals', reward.medals > 0 ? `+${formatCredits(reward.medals)}` : '–'),
          line('Discoveries', reward.discoveries > 0 ? `+${formatCredits(reward.discoveries)}` : '–'),
          reward.rank > 0 ? line('Licence rank', `+${formatCredits(reward.rank)}`) : null,
          h(
            'div',
            { className: 'results__total' },
            h('span', { text: 'Credits earned' }),
            h('span', { text: `+${formatCredits(reward.total)}`, dataset: { testid: 'activity-credits' } }),
          ),
          h(
            'div',
            { className: 'results__balance' },
            h('span', { text: 'Balance' }),
            h('span', { text: `${formatCredits(data.credits)} cr` }),
          ),
          unlocks,
        ),
        h(
          'section',
          { className: 'results__section' },
          h('h3', { className: 'panel-title', text: 'Pilot licence' }),
          h('span', {
            className: `licence__rank${rankUp ? ' is-new' : ''}`,
            text: rankUp ? `Promoted: ${LICENCE_RANKS[applied.rankAfter]!.name}` : licence.rank.name,
            dataset: { testid: 'activity-rank' },
          }),
          h(
            'div',
            { className: 'progress' },
            h('div', {
              className: 'progress__fill',
              style: { transform: `scaleX(${licence.progress.toFixed(3)})` },
            }),
          ),
          h('span', {
            className: 'licence__next',
            text: licence.next
              ? `${licence.stars} stars · ${licence.next.stars - licence.stars} more for ${licence.next.name}`
              : `${licence.stars} stars · top rank`,
          }),
        ),
      ),
    ];
    this.body.append(...sections.filter((section): section is HTMLElement => section !== null));
  }
}

const line = (label: string, value: string): HTMLElement =>
  h('div', { className: 'results__line' }, h('span', { text: label }), h('span', { text: value }));
