import { h } from './dom';
import type { PlayerSettings } from '../progression/profile';

/** Assist slider, pitch inversion, sensitivity and audio toggles shared by briefing and pause. */
export const createSettingsPanel = (
  settings: PlayerSettings,
  onChange: (patch: Partial<PlayerSettings>) => void,
): HTMLElement => {
  const assistValue = h('span', {
    className: 'setting__value',
    text: `${Math.round(settings.assist * 100)}%`,
  });
  const assist = h('input', {
    className: 'setting__range',
    attrs: {
      type: 'range',
      min: '0',
      max: '100',
      step: '10',
      value: String(Math.round(settings.assist * 100)),
      'aria-label': 'Flight assistance strength',
    },
    dataset: { testid: 'setting-assist' },
    on: {
      input: (event) => {
        const value = Number((event.target as HTMLInputElement).value) / 100;
        assistValue.textContent = `${Math.round(value * 100)}%`;
        onChange({ assist: value });
      },
    },
  });
  const sensitivityValue = h('span', {
    className: 'setting__value',
    text: `${settings.sensitivity.toFixed(1)}×`,
  });
  const sensitivity = h('input', {
    className: 'setting__range',
    attrs: {
      type: 'range',
      min: '50',
      max: '150',
      step: '10',
      value: String(Math.round(settings.sensitivity * 100)),
      'aria-label': 'Control sensitivity',
    },
    dataset: { testid: 'setting-sensitivity' },
    on: {
      input: (event) => {
        const value = Number((event.target as HTMLInputElement).value) / 100;
        sensitivityValue.textContent = `${value.toFixed(1)}×`;
        onChange({ sensitivity: value });
      },
    },
  });
  const toggle = (label: string, key: 'invertPitch' | 'audio' | 'haptics', testId: string) => {
    const input = h('input', {
      attrs: { type: 'checkbox', 'aria-label': label },
      dataset: { testid: testId },
      on: { change: (event) => onChange({ [key]: (event.target as HTMLInputElement).checked }) },
    });
    input.checked = settings[key];
    return h(
      'label',
      { className: 'setting setting--toggle' },
      input,
      h('span', { className: 'setting__label', text: label }),
    );
  };
  return h(
    'div',
    { className: 'settings' },
    h(
      'label',
      { className: 'setting' },
      h('span', { className: 'setting__label', text: 'Assistance' }),
      assist,
      assistValue,
    ),
    h('p', {
      className: 'setting__hint',
      text: 'Above 0%, left and right set a bank angle and the aircraft turns itself; the nose cannot loop. At 0% every axis is a raw rotation rate.',
    }),
    h(
      'label',
      { className: 'setting' },
      h('span', { className: 'setting__label', text: 'Sensitivity' }),
      sensitivity,
      sensitivityValue,
    ),
    toggle('Invert pitch (push forward to dive)', 'invertPitch', 'setting-invert'),
    toggle('Sound', 'audio', 'setting-audio'),
    toggle('Vibration on big moments (where supported)', 'haptics', 'setting-haptics'),
  );
};
