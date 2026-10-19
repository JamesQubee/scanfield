// A 30-line hyperscript helper: enough DOM for a game HUD without a framework.

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  attrs?: Record<string, string>;
  on?: Partial<Record<keyof HTMLElementEventMap, (e: Event) => void>>;
  style?: Partial<CSSStyleDeclaration>;
}

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (props.class) el.className = props.class;
  if (props.text !== undefined) el.textContent = props.text;
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) el.setAttribute(k, v);
  if (props.style) Object.assign(el.style, props.style);
  if (props.on) for (const [k, f] of Object.entries(props.on)) el.addEventListener(k, f as EventListener);
  for (const c of children) if (c) el.append(c);
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}
