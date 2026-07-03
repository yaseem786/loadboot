// settings.js — typed system settings (settings.manage). Reads/writes via the
// allowlisted get_setting / set_setting RPCs. Only known, typed keys are exposed;
// the server validates type + bounds and audits every change.
import { el, mount } from '../../shared/ui/dom.js';
import { getSetting, setSetting } from '../../shared/api.js';
import { showLoading, showError } from '../../shared/loading.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, card } from '../../shared/ui/components.js';
import { mountAvatarEditor } from '../../shared/ui/avatar.js';
import { getUser } from '../../shared/session.js';

const DEFS = [
  { key: 'support_email', type: 'string', label: 'Support email',
    desc: 'Shown to carriers across the platform.' },
  { key: 'command_center_banner', type: 'string', label: 'Command Center banner',
    desc: 'Optional announcement shown to staff (leave blank for none).' },
  { key: 'staff_invite_ttl_hours', type: 'number', label: 'Staff invite expiry (hours)',
    desc: 'How long a staff invitation link stays valid (1–336).' },
];

function settingRow(def, value) {
  const input = el('input', {
    type: def.type === 'number' ? 'number' : 'text',
    value: value == null ? '' : String(value),
    style: 'width:240px;border:1px solid var(--lb-border);border-radius:10px;padding:9px 11px;font:inherit',
  });
  const save = el('button', { class: 'cc-btn-sm cc-btn-green', onClick: async () => {
    save.disabled = true;
    try {
      const raw = input.value.trim();
      const val = def.type === 'number' ? Number(raw) : raw;
      await setSetting(def.key, val);
      toast(def.label + ' saved.', 'success');
    } catch (e) { toast(humanizeError(e), 'error'); }
    save.disabled = false;
  } }, [icon('check', 15), 'Save']);
  return el('div', { class: 'cc-set-row' }, [
    el('div', null, [el('div', { class: 'k' }, def.label), el('div', { class: 'd' }, def.desc)]),
    el('div', { style: 'display:flex;gap:8px;align-items:center' }, [input, save]),
  ]);
}

export async function renderSettings(host) {
  const body = el('div');
  const profileHost = el('div');
  const profileCard = card([el('h3', { class: 'cc-card-title' }, 'Your profile photo'), el('div', { class: 'cc-sub', style: 'margin-bottom:10px' }, 'Personalises your account across the Command Center. Replaces the default logo avatar.'), profileHost]);
  mount(host, el('div', null, [
    sectionHead('Settings', 'Typed, validated system settings. Every change is audited.'),
    profileCard,
    body,
  ]));
  (async () => { let u = null; try { u = await getUser(); } catch (_) {} try { mountAvatarEditor(profileHost, { name: (u && u.email) || 'Staff' }); } catch (_) {} })();
  showLoading(body, 'Loading settings…');
  try {
    const values = await Promise.all(DEFS.map(d => getSetting(d.key).catch(() => null)));
    mount(body, card(DEFS.map((d, i) => settingRow(d, values[i]))));
  } catch (e) { showError(body, humanizeError(e), () => renderSettings(host)); }
}

export default renderSettings;
