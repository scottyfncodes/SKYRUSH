import { Screen, button, clear, h } from './dom';
import { RIVALS, rivalLine } from '../progression/rivals';
import type { PlayerProfile } from '../progression/profile';
import { AI_PERSONALITIES } from '../ai/AiPilot';
import { buildName } from '../aircraft/build';
import { getAirframe, getItem } from '../aircraft/parts';
import { getCourseSpec } from '../course/courses';
import { airframeSilhouette } from './silhouette';

export interface RivalsCallbacks {
  onBack: () => void;
  onChallenge: (rivalId: string) => void;
}

/**
 * The three rival pilots: who they are, the record against them, and the
 * fuselage section each stakes in a one-on-one challenge race.
 */
export class RivalsScreen extends Screen {
  private readonly body: HTMLDivElement;

  constructor(private readonly callbacks: RivalsCallbacks) {
    super('screen--rivals', 'rivals');
    this.body = h('div', { className: 'rivals' });
    this.element.append(this.body);
  }

  update(profile: PlayerProfile): void {
    clear(this.body);
    const course = getCourseSpec(profile.selectedCircuit);
    const cards = RIVALS.map((rival) => {
      const pilot = AI_PERSONALITIES.find((ai) => ai.id === rival.id);
      const record = profile.rivals[rival.id] ?? { wins: 0, losses: 0 };
      const prize = getItem(rival.prize);
      const owned = profile.ownedParts.includes(rival.prize);
      const airframe = pilot ? getAirframe(pilot.build.airframe) : undefined;
      return h(
        'article',
        { className: 'rival-card', dataset: { testid: `rival-${rival.id}` } },
        h(
          'div',
          { className: 'rival-card__head' },
          h('span', { className: 'rival-card__callsign', text: rival.callsign }),
          h('span', { className: 'rival-card__temperament', text: rival.temperament }),
        ),
        h('h2', { className: 'rival-card__name', text: rival.name }),
        pilot
          ? h(
              'div',
              { className: 'rival-card__aircraft' },
              h(
                'span',
                { className: 'rival-card__art' },
                airframeSilhouette(pilot.build.airframe, pilot.build),
              ),
              h('span', { text: airframe ? `Flies the ${buildName(pilot.build)}` : '' }),
            )
          : null,
        h('p', { className: 'rival-card__bio', text: rival.bio }),
        h('blockquote', {
          className: 'rival-card__quote',
          text: `“${rivalLine(rival.grid, record.wins + record.losses)}”`,
        }),
        h(
          'dl',
          { className: 'rival-card__facts' },
          h('dt', { text: 'Record' }),
          h('dd', {
            text: `You ${record.wins} · ${record.losses} ${rival.callsign}`,
            dataset: { testid: `rival-record-${rival.id}` },
          }),
          h('dt', { text: 'At stake' }),
          h('dd', {
            text: prize ? `${prize.name}${owned ? ' (yours)' : ''}` : '',
            dataset: { testid: `rival-prize-${rival.id}` },
          }),
        ),
        button('Challenge', () => this.callbacks.onChallenge(rival.id), {
          variant: 'primary',
          testId: `rival-challenge-${rival.id}`,
          className: 'btn--block',
        }),
      );
    });
    this.body.append(
      h(
        'header',
        { className: 'rivals__head' },
        button('Back', this.callbacks.onBack, { variant: 'ghost', testId: 'rivals-back' }),
        h(
          'div',
          { className: 'rivals__title' },
          h('span', { className: 'eyebrow', text: 'One on one' }),
          h('h1', { className: 'rivals__heading', text: 'Rivals' }),
          h('p', {
            className: 'rivals__intro',
            text: `Beat a rival head to head and they hand over a section off their workbench. Bolt it onto a Workshop Special.${course ? ` Challenges run on ${course.name}.` : ''}`,
          }),
        ),
      ),
      h('div', { className: 'rivals__grid' }, ...cards),
    );
  }
}
