import { h } from './dom';

export const createRotatePrompt = (parent: HTMLElement): HTMLDivElement => {
  const el = h(
    'div',
    { className: 'rotate-prompt', dataset: { testid: 'rotate-prompt' } },
    h('div', { className: 'rotate-prompt__icon' }),
    h('p', { className: 'rotate-prompt__text', text: 'Rotate your device to landscape to race.' }),
  );
  parent.appendChild(el);
  return el;
};

export const createFatalScreen = (parent: HTMLElement, title: string, detail: string): HTMLDivElement => {
  const el = h(
    'div',
    { className: 'screen screen--fatal', dataset: { testid: 'fatal' } },
    h(
      'div',
      { className: 'dialog' },
      h('h2', { className: 'dialog__title', text: title }),
      h('p', { className: 'dialog__text', text: detail }),
    ),
  );
  parent.appendChild(el);
  return el;
};

export const createLoadingScreen = (parent: HTMLElement): HTMLDivElement => {
  const el = h(
    'div',
    { className: 'screen screen--loading', dataset: { testid: 'loading' } },
    h('div', { className: 'brand__title brand__title--small', text: 'SKYRUSH' }),
    h('div', { className: 'loading__bar' }),
  );
  parent.appendChild(el);
  return el;
};
