// flags.js — Feature Flags (functional in 2A). Reads/writes via flags.manage RPCs.
import { el, mount } from '../../shared/ui/dom.js';
import { getFeatureFlags, setFeatureFlag } from '../../shared/api.js';
import { showLoading, showError } from '../../shared/loading.js';
import { humanizeError, toast } from '../../shared/errors.js';

function flagRow(f, onToggle) {
  const input = el('input', { type: 'checkbox' });
  input.checked = !!f.enabled;
  input.addEventListener('change', async () => {
    input.disabled = true;
    try {
      await setFeatureFlag(f.key, input.checked);
      toast('Flag "' + f.key + '" ' + (input.checked ? 'enabled' : 'disabled') + '.', 'success');
      onToggle();
    } catch (e) {
      input.checked = !input.checked; // revert
      toast(humanizeError(e), 'error');
    }
    input.disabled = false;
  });
  return el('div', { class: 'cc-flag' }, [
    el('div', null, [el('div', { class: 'k' }, f.key), el('div', { class: 'd' }, f.description || '')]),
    el('label', { class: 'cc-switch' }, [input, el('span', { class: 'track' })]),
  ]);
}

export async function renderFlags(host) {
  const body = el('div', { class: 'lb-card' });
  mount(host, el('div', null, [
    el('div', { class: 'cc-section-head' }, [el('div', null, [
      el('h2', null, 'Feature flags'),
      el('p', null, 'Flags gate feature exposure only — never authorization. All start OFF.')])]),
    body,
  ]));
  async function load() {
    showLoading(body, 'Loading flags…');
    try {
      const flags = await getFeatureFlags();
      if (!flags || !flags.length) { mount(body, el('div', { class: 'cc-sub' }, 'No feature flags defined yet.')); return; }
    mount(body, (flags || []).map(f => flagRow(f, load)));
    } catch (e) { showError(body, humanizeError(e), load); }
  }
  await load();
}

export default renderFlags;
