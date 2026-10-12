import { Screen, button, clear, h } from './dom';
import {
  LIVERIES,
  describeUnlock,
  partsForCategory,
  type AircraftPart,
  type PartCategory,
} from '../aircraft/parts';
import { partStatus, type PlayerProfile } from '../progression/profile';
import { performanceForBuild, type PerformanceSummary } from '../aircraft/performance';
import { withPart, type AircraftBuild } from '../aircraft/build';
import { formatCredits } from '../core/format';

export type GarageTab = PartCategory | 'livery';

export interface GarageCallbacks {
  onBack: () => void;
  onRace: () => void;
  onInstall: (category: PartCategory, partId: string) => void;
  onPurchase: (partId: string) => void;
  onLivery: (liveryId: string) => void;
  /** Called when the player highlights a part so the 3D preview can show it. */
  onPreview: (build: AircraftBuild) => void;
}

const TABS: { id: GarageTab; label: string }[] = [
  { id: 'fuselage', label: 'Fuselage' },
  { id: 'engine', label: 'Engine' },
  { id: 'wings', label: 'Wings' },
  { id: 'livery', label: 'Livery' },
];

const STAT_ROWS: {
  key: keyof PerformanceSummary['ratings'];
  label: string;
  hint: string;
  value: (s: PerformanceSummary) => string;
}[] = [
  {
    key: 'topSpeed',
    label: 'Top speed',
    hint: 'Maximum level-flight speed',
    value: (s) => `${s.topSpeedKmh} km/h`,
  },
  {
    key: 'acceleration',
    label: 'Acceleration',
    hint: '0 to 250 km/h from a standstill',
    value: (s) => `${s.accelerationSeconds.toFixed(1)} s`,
  },
  {
    key: 'turning',
    label: 'Turning',
    hint: 'Pitch authority and how tightly velocity follows the nose',
    value: (s) => `${s.turning}`,
  },
  {
    key: 'stability',
    label: 'Stability',
    hint: 'Self-levelling strength and damping',
    value: (s) => `${s.stability}`,
  },
  {
    key: 'heat',
    label: 'Heat management',
    hint: 'How long you can boost before overheating, and how fast it cools',
    value: (s) => `${s.heatManagement}`,
  },
  {
    key: 'boost',
    label: 'Boost endurance',
    hint: 'Seconds of continuous boost from a full reserve',
    value: (s) => `${s.boostEndurance.toFixed(1)} s`,
  },
];

export class GarageScreen extends Screen {
  private tab: GarageTab = 'fuselage';
  private selectedId: string | null = null;
  private profile: PlayerProfile | null = null;
  private readonly tabs: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly detail: HTMLDivElement;
  private readonly stats: HTMLDivElement;
  private readonly credits: HTMLSpanElement;
  private readonly buildSummary: HTMLDivElement;

  constructor(private readonly callbacks: GarageCallbacks) {
    super('screen--garage', 'garage');
    this.tabs = h('div', { className: 'garage-tabs', attrs: { role: 'tablist' } });
    this.list = h('div', { className: 'garage-list' });
    this.detail = h('div', { className: 'garage-detail' });
    this.stats = h('div', { className: 'garage-stats' });
    this.credits = h('span', { className: 'topbar__credits', dataset: { testid: 'garage-credits' } });
    this.buildSummary = h('div', { className: 'garage-build' });

    const topbar = h(
      'div',
      { className: 'topbar' },
      button('Back', callbacks.onBack, { variant: 'ghost', testId: 'garage-back' }),
      h('div', { className: 'topbar__title', text: 'Garage' }),
      h(
        'div',
        { className: 'topbar__right' },
        h('span', { className: 'topbar__label', text: 'Credits' }),
        this.credits,
      ),
    );
    const left = h('aside', { className: 'garage-left' }, this.tabs, this.list);
    const right = h(
      'aside',
      { className: 'garage-right' },
      h('h2', { className: 'panel-title', text: 'Performance' }),
      this.stats,
      this.buildSummary,
      button('Race', callbacks.onRace, {
        variant: 'primary',
        testId: 'garage-race',
        className: 'btn--block',
      }),
    );
    this.element.append(topbar, left, right, this.detail);
  }

  update(profile: PlayerProfile): void {
    this.profile = profile;
    this.credits.textContent = formatCredits(profile.credits);
    if (this.selectedId === null)
      this.selectedId = profile.build[this.tab === 'livery' ? 'livery' : this.tab];
    this.renderTabs();
    this.renderList();
    this.renderDetail();
    this.renderStats();
  }

  private setTab(tab: GarageTab): void {
    this.tab = tab;
    if (this.profile) this.selectedId = this.profile.build[tab === 'livery' ? 'livery' : tab];
    if (this.profile) this.update(this.profile);
  }

  private select(id: string): void {
    this.selectedId = id;
    if (this.profile) {
      this.update(this.profile);
      this.callbacks.onPreview(this.previewBuild());
    }
  }

  /** The build the 3D preview and comparison should show (installed build with the highlighted part). */
  previewBuild(): AircraftBuild {
    if (!this.profile) throw new Error('Garage not initialised');
    const build = this.profile.build;
    if (!this.selectedId) return build;
    if (this.tab === 'livery') return { ...build, livery: this.selectedId };
    return withPart(build, this.tab, this.selectedId);
  }

  private renderTabs(): void {
    clear(this.tabs);
    for (const tab of TABS) {
      const el = h('button', {
        className: `tab${tab.id === this.tab ? ' is-active' : ''}`,
        text: tab.label,
        attrs: { type: 'button', role: 'tab', 'aria-selected': String(tab.id === this.tab) },
        dataset: { testid: `garage-tab-${tab.id}` },
        on: { click: () => this.setTab(tab.id) },
      });
      this.tabs.append(el);
    }
  }

  private renderList(): void {
    clear(this.list);
    const profile = this.profile;
    if (!profile) return;
    if (this.tab === 'livery') {
      for (const livery of LIVERIES) {
        const installed = profile.build.livery === livery.id;
        const card = h(
          'button',
          {
            className: `part-card${this.selectedId === livery.id ? ' is-selected' : ''}${installed ? ' is-installed' : ''}`,
            attrs: { type: 'button' },
            dataset: { testid: `part-${livery.id}` },
            on: { click: () => this.select(livery.id) },
          },
          h('span', {
            className: 'part-card__swatch',
            style: {
              background: `linear-gradient(135deg, #${livery.base.toString(16).padStart(6, '0')} 55%, #${livery.accent.toString(16).padStart(6, '0')} 55%)`,
            },
          }),
          h(
            'span',
            { className: 'part-card__body' },
            h('span', { className: 'part-card__name', text: livery.name }),
            h('span', { className: 'part-card__meta', text: installed ? 'Applied' : 'Free' }),
          ),
        );
        this.list.append(card);
      }
      return;
    }
    for (const part of partsForCategory(this.tab)) {
      const status = partStatus(profile, part);
      const meta =
        status === 'installed'
          ? 'Installed'
          : status === 'owned'
            ? 'Owned'
            : status === 'locked'
              ? 'Locked'
              : `${formatCredits(part.price)} cr`;
      const card = h(
        'button',
        {
          className: `part-card part-card--${status}${this.selectedId === part.id ? ' is-selected' : ''}`,
          attrs: { type: 'button' },
          dataset: { testid: `part-${part.id}`, status },
          on: { click: () => this.select(part.id) },
        },
        h('span', { className: `part-card__icon part-card__icon--${part.category}` }),
        h(
          'span',
          { className: 'part-card__body' },
          h('span', { className: 'part-card__name', text: part.name }),
          h('span', { className: 'part-card__meta', text: meta }),
        ),
      );
      this.list.append(card);
    }
  }

  private renderDetail(): void {
    clear(this.detail);
    const profile = this.profile;
    if (!profile || !this.selectedId) return;
    if (this.tab === 'livery') {
      const livery = LIVERIES.find((l) => l.id === this.selectedId);
      if (!livery) return;
      const applied = profile.build.livery === livery.id;
      this.detail.append(
        h(
          'div',
          { className: 'detail__text' },
          h('h3', { className: 'detail__name', text: livery.name }),
          h('p', { className: 'detail__desc', text: 'Factory paint scheme. Liveries are free to apply.' }),
        ),
        h(
          'div',
          { className: 'detail__actions' },
          button(applied ? 'Applied' : 'Apply', () => this.callbacks.onLivery(livery.id), {
            variant: 'primary',
            testId: 'garage-action',
            disabled: applied,
          }),
        ),
      );
      return;
    }
    const part = partsForCategory(this.tab).find((p) => p.id === this.selectedId) as AircraftPart | undefined;
    if (!part) return;
    const status = partStatus(profile, part);
    let action: HTMLButtonElement;
    let note = '';
    switch (status) {
      case 'installed':
        action = button('Installed', () => undefined, {
          variant: 'primary',
          testId: 'garage-action',
          disabled: true,
        });
        break;
      case 'owned':
        action = button('Install', () => this.callbacks.onInstall(part.category, part.id), {
          variant: 'primary',
          testId: 'garage-action',
        });
        break;
      case 'available':
        action = button(`Buy for ${formatCredits(part.price)} cr`, () => this.callbacks.onPurchase(part.id), {
          variant: 'primary',
          testId: 'garage-action',
        });
        break;
      case 'unaffordable':
        action = button(`Buy for ${formatCredits(part.price)} cr`, () => undefined, {
          variant: 'primary',
          testId: 'garage-action',
          disabled: true,
        });
        note = `Need ${formatCredits(part.price - profile.credits)} more credits. Race to earn more.`;
        break;
      case 'locked':
        action = button('Locked', () => undefined, {
          variant: 'primary',
          testId: 'garage-action',
          disabled: true,
        });
        note = describeUnlock(part.unlock);
        break;
    }
    this.detail.append(
      h(
        'div',
        { className: 'detail__text' },
        h('span', { className: 'detail__tagline', text: part.tagline }),
        h('h3', { className: 'detail__name', text: part.name }),
        h('p', { className: 'detail__desc', text: part.description }),
      ),
      h(
        'div',
        { className: 'detail__actions' },
        action,
        note
          ? h('span', { className: 'detail__note', text: note, dataset: { testid: 'garage-note' } })
          : null,
      ),
    );
  }

  private renderStats(): void {
    clear(this.stats);
    clear(this.buildSummary);
    const profile = this.profile;
    if (!profile) return;
    const current = performanceForBuild(profile.build);
    const preview = performanceForBuild(this.previewBuild());
    const comparing = this.tab !== 'livery' && this.selectedId !== profile.build[this.tab];
    for (const row of STAT_ROWS) {
      const currentRating = current.ratings[row.key];
      const previewRating = preview.ratings[row.key];
      const delta = previewRating - currentRating;
      const deltaClass = delta > 0 ? 'is-better' : delta < 0 ? 'is-worse' : '';
      const bar = h(
        'div',
        { className: 'stat-bar', title: row.hint },
        h('div', { className: 'stat-bar__fill', style: { width: `${currentRating}%` } }),
        comparing
          ? h('div', {
              className: `stat-bar__preview ${deltaClass}`,
              style: { left: `${Math.min(currentRating, previewRating)}%`, width: `${Math.abs(delta)}%` },
            })
          : null,
      );
      this.stats.append(
        h(
          'div',
          { className: 'stat-row', dataset: { testid: `stat-${row.key}` } },
          h(
            'div',
            { className: 'stat-row__head' },
            h('span', { className: 'stat-row__label', text: row.label }),
            h('span', {
              className: `stat-row__value ${comparing ? deltaClass : ''}`,
              text: comparing ? row.value(preview) : row.value(current),
              dataset: { testid: `stat-${row.key}-value` },
            }),
          ),
          bar,
          comparing && delta !== 0
            ? h('span', {
                className: `stat-row__delta ${deltaClass}`,
                text: `${delta > 0 ? '+' : ''}${delta}`,
              })
            : null,
        ),
      );
    }
    const mass = h(
      'div',
      { className: 'build-line' },
      h('span', { text: 'Mass' }),
      h('span', {
        text: `${Math.round(comparing ? preview.mass : current.mass)} kg`,
        dataset: { testid: 'stat-mass' },
      }),
    );
    const stall = h(
      'div',
      { className: 'build-line' },
      h('span', { text: 'Stall speed' }),
      h('span', { text: `${comparing ? preview.stallSpeedKmh : current.stallSpeedKmh} km/h` }),
    );
    this.buildSummary.append(mass, stall);
    if (comparing)
      this.buildSummary.append(
        h('div', {
          className: 'build-line build-line--hint',
          text: 'Comparing against your installed build',
        }),
      );
  }
}
