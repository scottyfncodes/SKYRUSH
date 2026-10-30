import { Screen, button, clear, h } from './dom';
import type { PlayerSettings } from '../progression/profile';
import { createSettingsPanel } from './SettingsPanel';
import { createControlsPanel } from './BriefingScreen';

export interface PauseCallbacks {
  onResume: () => void;
  onRestart: () => void;
  onQuit: () => void;
  onSettings: (patch: Partial<PlayerSettings>) => void;
}

export class PauseScreen extends Screen {
  private readonly body: HTMLDivElement;

  constructor(
    private readonly callbacks: PauseCallbacks,
    private readonly isTouch: boolean,
    private readonly mode: 'pause' | 'settings' = 'pause',
  ) {
    super(mode === 'pause' ? 'screen--pause' : 'screen--settings', mode === 'pause' ? 'pause' : 'settings');
    this.body = h('div', { className: 'dialog dialog--pause' });
    this.element.append(this.body);
  }

  /** `labels` renames Restart and Quit for activities (for example "End flight" in free flight). */
  update(settings: PlayerSettings, labels: { restart?: string; quit?: string } = {}): void {
    clear(this.body);
    const actions =
      this.mode === 'pause'
        ? h(
            'div',
            { className: 'dialog__actions' },
            button('Resume', this.callbacks.onResume, { variant: 'primary', testId: 'pause-resume' }),
            button(labels.restart ?? 'Restart race', this.callbacks.onRestart, { testId: 'pause-restart' }),
            button(labels.quit ?? 'Quit to hangar', this.callbacks.onQuit, {
              variant: 'ghost',
              testId: 'pause-quit',
            }),
          )
        : h(
            'div',
            { className: 'dialog__actions' },
            button('Back', this.callbacks.onResume, { variant: 'primary', testId: 'settings-back' }),
          );
    this.body.append(
      h('h2', { className: 'dialog__title', text: this.mode === 'pause' ? 'Paused' : 'Controls & settings' }),
      actions,
      h(
        'div',
        { className: 'dialog__columns' },
        h(
          'section',
          {},
          h('h3', { className: 'panel-title', text: 'Assistance' }),
          createSettingsPanel(settings, this.callbacks.onSettings),
        ),
        h(
          'section',
          { className: 'dialog__controls' },
          h('h3', { className: 'panel-title', text: 'Controls' }),
          createControlsPanel(this.isTouch),
        ),
      ),
    );
  }
}
