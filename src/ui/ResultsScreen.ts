import { CATEGORY_LABELS } from '../aircraft/parts';
import { Screen, button, clear, h } from './dom';
import type { Standing } from '../race/RaceSimulation';
import type { AppliedResult } from '../progression/rewards';
import { liveryForBadge, type RunStyleStats } from '../progression/badges';
import { formatCredits, formatRaceTime, ordinal } from '../core/format';
import { prefersReducedMotion } from './haptics';

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
  style: RunStyleStats;
  gateCount: number;
}

const COUNT_UP_SECONDS = 0.9;

const formatMultiplier = (multiplier: number): string =>
  `×${Number.isInteger(multiplier) ? multiplier : multiplier.toFixed(1)}`;

export class ResultsScreen extends Screen {
  private readonly body: HTMLDivElement;
  private countFrame = 0;
  private readonly onKey: (event: KeyboardEvent) => void;

  constructor(private readonly callbacks: ResultsCallbacks) {
    super('screen--results', 'results');
    this.body = h('div', { className: 'dialog dialog--results' });
    this.element.append(this.body);
    // Enter replays immediately, so keyboard players never need the mouse between runs.
    this.onKey = (event) => {
      if (!this.visible || event.repeat) return;
      if (event.code === 'Enter' || event.code === 'NumpadEnter') {
        event.preventDefault();
        this.callbacks.onRaceAgain();
      }
    };
    window.addEventListener('keydown', this.onKey);
  }

  override hide(): void {
    super.hide();
    if (this.countFrame) cancelAnimationFrame(this.countFrame);
    this.countFrame = 0;
  }

  update(data: ResultsData): void {
    clear(this.body);
    const { player, applied, standings, style } = data;
    const reward = applied.reward;
    const rows = standings.map((s) =>
      h(
        'tr',
        { className: s.isPlayer ? 'is-player' : '' },
        h('td', { text: ordinal(s.position) }),
        h('td', { text: s.isPlayer ? 'You' : `${s.callsign} · ${s.name}` }),
        h('td', { text: s.finished ? formatRaceTime(s.finishTime) : 'DNF' }),
        h('td', { text: s.penaltySeconds > 0 ? `+${s.penaltySeconds}s` : '–' }),
      ),
    );
    const unlocks =
      applied.unlocked.length > 0
        ? h(
            'div',
            { className: 'results__unlocks', dataset: { testid: 'results-unlocks' } },
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

    const styleValue = h('span', {
      className: 'highlight__value',
      text: formatCredits(style.score),
      dataset: { testid: 'results-style' },
    });
    const highlights = h(
      'div',
      { className: 'results__highlights', dataset: { testid: 'results-highlights' } },
      highlight('Style', styleValue, applied.newBestStyle && style.score > 0 ? 'Record' : null),
      highlight('Best combo', formatMultiplier(style.bestMultiplier)),
      highlight('Perfect gates', `${style.perfectGates}/${data.gateCount}`),
      highlight('Near misses', String(style.nearMisses)),
      highlight('Rings', `${style.rings}/${style.ringTotal}`),
    );

    const badges =
      applied.badges.length > 0
        ? h(
            'div',
            { className: 'results__badges', dataset: { testid: 'results-badges' } },
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
                    text: `. ${liveryForBadge(badge.id)?.name ?? 'new'} livery and colour unlocked in the paint shop`,
                  }),
                ),
              ),
            ),
          )
        : null;

    const next = applied.next;
    const goal = next
      ? h(
          'div',
          { className: 'results__goal', dataset: { testid: 'results-next' } },
          h(
            'div',
            { className: 'results__goal-text' },
            h('span', { className: 'eyebrow', text: 'Next unlock' }),
            h('span', {
              className: 'results__goal-name',
              text: `${next.badge.name}${next.livery ? ` → ${next.livery.name} livery` : ''}`,
            }),
            h('span', { className: 'results__goal-hint', text: next.badge.goal }),
          ),
          h(
            'div',
            {
              className: 'progress',
              attrs: {
                role: 'progressbar',
                'aria-valuemin': '0',
                'aria-valuemax': '100',
                'aria-valuenow': String(Math.round(next.progress * 100)),
                'aria-label': `${next.badge.name} progress`,
              },
            },
            h('div', {
              className: 'progress__fill',
              style: { transform: `scaleX(${next.progress.toFixed(3)})` },
            }),
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
          applied.newBestTime
            ? h('span', { className: 'chip chip--accent chip--pop', text: 'New best' })
            : null,
        ),
        h(
          'div',
          { className: 'results__actions' },
          button('Race again', this.callbacks.onRaceAgain, {
            variant: 'primary',
            testId: 'results-again',
            className: 'btn--replay',
          }),
          button('Hangar', this.callbacks.onGarage, { testId: 'results-garage' }),
          button('Menu', this.callbacks.onMenu, { variant: 'ghost', testId: 'results-menu' }),
        ),
      ),
      highlights,
      ...(badges ? [badges] : []),
      ...(goal ? [goal] : []),
      h(
        'div',
        { className: 'results__grid' },
        h(
          'section',
          { className: 'results__section' },
          h('h3', { className: 'panel-title', text: 'Rewards' }),
          line('Finishing position', `+${formatCredits(reward.base)}`),
          line('Clean run bonus', reward.cleanBonus > 0 ? `+${formatCredits(reward.cleanBonus)}` : 'Missed'),
          line('Time bonus vs par', reward.timeBonus > 0 ? `+${formatCredits(reward.timeBonus)}` : '–'),
          line('Style bonus', reward.styleBonus > 0 ? `+${formatCredits(reward.styleBonus)}` : '–'),
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
    );
    this.countUp(styleValue, style.score);
  }

  /** Counts the style score up quickly. Skipped under reduced motion; never blocks input. */
  private countUp(element: HTMLElement, target: number): void {
    if (this.countFrame) cancelAnimationFrame(this.countFrame);
    this.countFrame = 0;
    if (target <= 0 || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / (COUNT_UP_SECONDS * 1000));
      const eased = 1 - (1 - t) ** 3;
      element.textContent = formatCredits(Math.round(target * eased));
      this.countFrame = t < 1 ? requestAnimationFrame(tick) : 0;
    };
    element.textContent = '0';
    this.countFrame = requestAnimationFrame(tick);
  }
}

const highlight = (label: string, value: HTMLElement | string, flag: string | null = null): HTMLElement =>
  h(
    'div',
    { className: 'highlight' },
    h('span', { className: 'highlight__label', text: label }),
    typeof value === 'string' ? h('span', { className: 'highlight__value', text: value }) : value,
    flag ? h('span', { className: 'chip chip--accent chip--pop highlight__flag', text: flag }) : null,
  );

const line = (label: string, value: string, className = ''): HTMLElement =>
  h(
    'div',
    { className: `results__line ${className}` },
    h('span', { text: label }),
    h('span', { text: value }),
  );
