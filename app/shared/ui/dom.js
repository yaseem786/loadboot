// dom.js — tiny safe DOM helpers. `el()` never sets innerHTML from data, so values
// are inserted as text nodes (XSS-safe by construction).
export function el(tag, attrs, children) {
  const node = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') for (const d in v) node.dataset[d] = v[d];
    else if (k.slice(0, 2) === 'on' && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') node.innerHTML = v;        // only for trusted, code-defined markup
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  if (children != null) appendChildren(node, children);
  return node;
}

function appendChildren(node, children) {
  if (Array.isArray(children)) children.forEach(c => appendChildren(node, c));
  else if (children instanceof Node) node.appendChild(children);
  else node.appendChild(document.createTextNode(String(children)));
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
export function mount(node, child) { clear(node); appendChildren(node, child); }
export function text(s) { return document.createTextNode(s == null ? '' : String(s)); }

export default { el, clear, mount, text };
