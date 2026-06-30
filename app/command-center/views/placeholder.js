// placeholder.js — honest "not built yet" panel for Phase 2A non-functional modules.
// No fake metrics or dev data — the addendum forbids fake data in a production-like build.
import { el, mount } from '../../shared/ui/dom.js';

export function renderPlaceholder(host, title, description) {
  mount(host, el('div', { class: 'lb-placeholder' }, [
    el('span', { class: 'lb-badge lb-badge-amber' }, 'Coming in a later phase'),
    el('h3', null, title),
    el('p', null, description || 'This area is part of the planned build and is not yet functional.'),
  ]));
}

export default renderPlaceholder;
