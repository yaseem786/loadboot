// loading.js — consistent loading / empty / error states for async views.
import { el, mount } from './ui/dom.js';

export function showLoading(host, label = 'Loading…') {
  mount(host, el('div', { class: 'lb-state lb-loading' }, [
    el('div', { class: 'lb-spinner', 'aria-hidden': 'true' }),
    el('p', null, label),
  ]));
}

export function showEmpty(host, label = 'Nothing here yet.') {
  mount(host, el('div', { class: 'lb-state lb-empty' }, [el('p', null, label)]));
}

export function showError(host, label = 'Something went wrong.', onRetry) {
  const children = [el('p', null, label)];
  if (onRetry) children.push(el('button', { class: 'lb-btn lb-btn-secondary', onClick: onRetry }, 'Retry'));
  mount(host, el('div', { class: 'lb-state lb-error', role: 'alert' }, children));
}

export default { showLoading, showEmpty, showError };
