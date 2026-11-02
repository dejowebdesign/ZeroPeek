/**
 * Tiny typed DOM builder.
 *
 * Builds elements without ever assigning user data to `innerHTML`. Dynamic text
 * goes through `textContent`, which keeps the client compatible with the strict
 * Content-Security-Policy (see ADR 0002 and ADR 0006).
 */

type Child = Node | string | number | null | undefined | false;

export interface ElementAttributes {
  class?: string;
  id?: string;
  style?: Partial<CSSStyleDeclaration> & Record<string, string>;
  /** Static, trusted markup only (icons defined in code). Never user data. */
  html?: string;
  [key: string]: unknown;
}

/** Create an element. `tag` is a plain tag name, e.g. `button`. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: ElementAttributes | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);

  if (attrs) {
    for (const [key, value] of Object.entries(attrs)) {
      if (value === false || value === null || value === undefined) continue;
      if (key === 'class') {
        node.className = String(value);
      } else if (key === 'style' && typeof value === 'object') {
        for (const [prop, val] of Object.entries(value as Record<string, string>)) {
          if (prop.startsWith('--')) node.style.setProperty(prop, String(val));
          else
            node.style.setProperty(
              prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
              String(val),
            );
        }
      } else if (key === 'html') {
        node.innerHTML = String(value);
      } else if (key.startsWith('on') && typeof value === 'function') {
        node.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
      } else if (value === true) {
        node.setAttribute(key, '');
      } else {
        node.setAttribute(key, String(value));
      }
    }
  }

  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** Replace the contents of a root element with a single screen. */
export function render(root: Element, node: Node): Node {
  root.replaceChildren(node);
  return node;
}

export const $ = <T extends Element = Element>(selector: string): T | null =>
  document.querySelector<T>(selector);
