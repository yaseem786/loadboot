// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// settings.js — typed system settings (settings.manage). Reads/writes via the
// allowlisted get_setting / set_setting RPCs. Only known, typed keys are exposed;
// the server validates type + bounds and audits every change.
import { el, mount } from '../../shared/ui/dom.js';
import { getSetting, setSetting, adminUserUpdate, adminNote, getContactChannel, setContactChannel } from '../../shared/api.js';
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
  // ---- User account admin: change any user's login email/password (audited) ----
  const uaEmail = el('input', { placeholder: 'User\u2019s current email', style: 'width:100%;border:1px solid var(--lb-border);border-radius:10px;padding:10px 11px;font:inherit;box-sizing:border-box' });
  const uaNewEmail = el('input', { placeholder: 'New email (optional)', style: 'width:100%;border:1px solid var(--lb-border);border-radius:10px;padding:10px 11px;font:inherit;box-sizing:border-box;margin-top:8px' });
  const uaNewPass = el('input', { placeholder: 'New password (optional, min 8)', type: 'text', style: 'width:100%;border:1px solid var(--lb-border);border-radius:10px;padding:10px 11px;font:inherit;box-sizing:border-box;margin-top:8px' });
  const uaMsg = el('div', { class: 'cc-sub', style: 'margin-top:8px;min-height:1.2em' });
  const uaBtn = el('button', { class: 'cc-btn-sm cc-btn-green', style: 'margin-top:10px', onClick: async () => {
    const em = uaEmail.value.trim(); const ne = uaNewEmail.value.trim(); const np = uaNewPass.value;
    uaMsg.textContent = ''; uaMsg.style.color = '';
    if (!em) { uaMsg.textContent = 'Enter the user\u2019s current email.'; return; }
    if (!ne && !np) { uaMsg.textContent = 'Enter a new email and/or a new password.'; return; }
    if (np && np.length < 8) { uaMsg.textContent = 'Password must be at least 8 characters.'; return; }
    if (!confirm('Change login credentials for ' + em + '?\n\nThis takes effect immediately and the user\u2019s old ' + (np ? 'password' : 'email') + ' stops working.')) return;
    uaBtn.disabled = true; uaBtn.textContent = 'Applying\u2026';
    try {
      await adminUserUpdate({ email: em, new_email: ne || null, new_password: np || null });
      try { await adminNote('admin.user_credentials', em, 'changed: ' + [ne ? 'email\u2192' + ne : null, np ? 'password' : null].filter(Boolean).join(', ')); } catch (_) {}
      uaMsg.style.color = 'var(--lb-green, #16a34a)'; uaMsg.textContent = '\u2713 Updated. Tell the user their new sign-in details.';
      uaEmail.value = uaNewEmail.value = uaNewPass.value = '';
    } catch (e) { uaMsg.textContent = humanizeError ? humanizeError(e) : ((e && e.message) || 'Failed.'); }
    uaBtn.disabled = false; uaBtn.textContent = 'Update credentials';
  } }, 'Update credentials');
  const userAdminCard = card([
    el('h3', { class: 'cc-card-title' }, 'User account admin'),
    el('div', { class: 'cc-sub', style: 'margin-bottom:10px' }, 'Change any user\u2019s login email or reset their password (support cases: lost email access, locked out). Staff-only \u2014 every change is audited under your name.'),
    uaEmail, uaNewEmail, uaNewPass, uaMsg, uaBtn,
  ]);
  // bl_wa_0391 — the contact switch. One setting, every surface: the marketing site, the automatic
  // carrier e-mails, the outreach drip and the e-mail signature all read it at send time.
  const chanHost = el('div');
  const chanCard = card([
    el('h3', { class: 'cc-card-title' }, 'How carriers reach us'),
    el('div', { class: 'cc-sub', style: 'margin-bottom:12px' },
      'Sets the contact shown on loadboot.com, in every automatic e-mail, in the outreach drip and in the signature. Changing it here changes all of them \u2014 nothing is hard-coded any more.'),
    chanHost,
  ]);
  mount(host, el('div', null, [
    sectionHead('Settings', 'Typed, validated system settings. Every change is audited.'),
    profileCard,
    chanCard,
    userAdminCard,
    body,
  ]));
  (async () => {
    const CH = [
      { v: 'phone',    t: 'Call',     d: 'Phone number only' },
      { v: 'whatsapp', t: 'WhatsApp', d: 'WhatsApp number only' },
      { v: 'both',     t: 'Both',     d: 'WhatsApp shown beside the phone' },
    ];
    async function paint() {
      let c = null;
      try { c = await getContactChannel(); } catch (e) { mount(chanHost, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
      const cur = (c && c.channel) || 'phone';
      const row = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' }, CH.map((x) =>
        el('button', {
          class: 'cc-btn' + (x.v === cur ? ' pri' : ''),
          title: x.d,
          onClick: async (ev) => {
            if (x.v === cur) return;
            const b2 = ev.currentTarget; b2.disabled = true;
            try {
              const r = await setContactChannel(x.v, null);
              if (r && r.ok === false) throw new Error(r.error || 'Could not change it.');
              toast('Carriers now see: ' + x.t);
              await paint();
            } catch (e) { toast(humanizeError(e)); b2.disabled = false; }
          },
        }, x.t)));
      const wa = (c && c.whatsapp) || {}, ph = (c && c.phone) || {};
      // bl_wa_0392 — say out loud which channel is live right now, not just which button is highlighted.
      const meta = CH.filter((x) => x.v === cur)[0] || CH[0];
      const liveTxt = cur === 'phone' ? (ph.display || '\u2014')
        : cur === 'whatsapp' ? (wa.display || '\u2014')
        : (wa.display || '\u2014') + '  +  ' + (ph.display || '\u2014');
      const dot = el('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:50%;background:' + (cur === 'phone' ? '#0883F7' : '#25D366') + ';margin-right:8px;vertical-align:middle' });
      const statusLine = el('div', {
        style: 'display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px;padding:10px 12px;border:1px solid rgba(255,255,255,.10);border-radius:10px;background:rgba(255,255,255,.03)',
      }, [
        el('span', { style: 'font-weight:700' }, [dot, 'Active now: ' + meta.t]),
        el('span', { class: 'cc-sub' }, liveTxt),
        el('span', { class: 'cc-sub' }, cur === 'whatsapp'
          ? '\u00b7 Call links are hidden on the website while this is on.'
          : cur === 'both'
            ? '\u00b7 Website, e-mails and signature show both.'
            : '\u00b7 WhatsApp is not shown anywhere.'),
      ]);
      mount(chanHost, el('div', null, [
        statusLine,
        row,
        el('div', { class: 'cc-sub', style: 'margin-top:12px;line-height:1.7' }, [
          el('div', null, 'WhatsApp  ' + (wa.display || '\u2014')),
          el('div', null, 'Phone  ' + (ph.display || '\u2014')),
        ]),
      ]));
    }
    paint();
  })();
  (async () => { let u = null; try { u = await getUser(); } catch (_) {} try { mountAvatarEditor(profileHost, { name: (u && u.email) || 'Staff' }); } catch (_) {} })();
  showLoading(body, 'Loading settings…');
  try {
    const values = await Promise.all(DEFS.map(d => getSetting(d.key).catch(() => null)));
    mount(body, card(DEFS.map((d, i) => settingRow(d, values[i]))));
  } catch (e) { showError(body, humanizeError(e), () => renderSettings(host)); }
}

export default renderSettings;
