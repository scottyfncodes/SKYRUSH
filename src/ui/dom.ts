type Child = Node | string | number | null | undefined | false;

type Props<K extends keyof HTMLElementTagNameMap> = Partial<{
  className: string;
  text: string;
  html: string;
  attrs: Record<string, string>;
  dataset: Record<string, string>;
  on: Partial<{ [E in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[E]) => void }>;
  style: Partial<CSSStyleDeclaration>;
}> &
  Partial<Pick<HTMLElementTagNameMap[K], 'id' | 'title'>>;

/** Tiny element factory to keep screens readable without a framework. */
export const h = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props<K> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag);
  if (props.className) element.className = props.className;
  if (props.id) element.id = props.id;
  if (props.title) element.title = props.title;
  if (props.text !== undefined) element.textContent = props.text;
  if (props.html !== undefined) element.innerHTML = props.html;
  if (props.attrs) for (const [key, value] of Object.entries(props.attrs)) element.setAttribute(key, value);
  if (props.dataset) for (const [key, value] of Object.entries(props.dataset)) element.dataset[key] = value;
  if (props.style) Object.assign(element.style, props.style);
  if (props.on) {
    for (const [event, handler] of Object.entries(props.on)) {
      if (handler) element.addEventListener(event, handler as EventListener);
    }
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : String(child));
  }
  return element;
};

export const clear = (element: HTMLElement): void => {
  while (element.firstChild) element.removeChild(element.firstChild);
};

export const button = (
  label: string,
  onClick: () => void,
  options: {
    variant?: 'primary' | 'secondary' | 'ghost';
    testId?: string;
    disabled?: boolean;
    className?: string;
  } = {},
): HTMLButtonElement => {
  const el = h('button', {
    className: `btn btn--${options.variant ?? 'secondary'}${options.className ? ` ${options.className}` : ''}`,
    text: label,
    attrs: { type: 'button' },
    on: { click: onClick },
  });
  if (options.testId) el.dataset.testid = options.testId;
  if (options.disabled) el.disabled = true;
  return el;
};

/** Base class for full-screen overlays. */
export class Screen {
  readonly element: HTMLDivElement;

  constructor(className: string, testId: string) {
    this.element = h('div', { className: `screen ${className}` });
    this.element.dataset.testid = testId;
    this.element.hidden = true;
  }

  show(): void {
    this.element.hidden = false;
    this.element.classList.add('is-visible');
  }

  hide(): void {
    this.element.hidden = true;
    this.element.classList.remove('is-visible');
  }

  get visible(): boolean {
    return !this.element.hidden;
  }
}
