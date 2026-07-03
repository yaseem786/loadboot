// permissionEditor.js — Amazon Seller-Central-style per-user permission matrix.
// Shows every permission grouped by category with a checkbox. Check = allow, uncheck =
// remove. Permissions inherited from a role are honored; an explicit override (allow/deny)
// takes precedence (deny always wins, server-side). You can only toggle permissions you
// hold yourself (grant-ceiling, enforced by cc_set_user_permission), and never your own.
import { el, mount } from '../../shared/ui/dom.js';
import { openDrawer } from '../../shared/ui/components.js';
import { listPermissionsFor, setUserPermission } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const CAT_LABEL = (c) => (c || 'other').replace(/_/g, ' ').replace(/\b\w/g, m => m.toUpperCase());
const eff = (p) => (p.override === 'allow') || (p.from_role && p.override !== 'deny');
function tagText(p) {
  if (p.override === 'allow') return '· override: allow';
  if (p.override === 'deny') return '· override: deny';
  if (p.from_role) return '· from role';
  return '· not granted';
}

export async function openPermissionEditor(staff) {
  const body = el('div', null, el('div', { class: 'cc-sub' }, 'Loading permissions…'));
  openDrawer('Permissions', body, { subtitle: staff.email || staff.user_id });
  let perms;
  try { perms = await listPermissionsFor(staff.user_id); }
  catch (e) { mount(body, el('div', { class: 'cc-sub' }, humanizeError(e))); return; }
  if (!perms || !perms.length) { mount(body, el('div', { class: 'cc-sub' }, 'No permissions catalog available.')); return; }

  const groups = {};
  perms.forEach(p => { (groups[p.category] = groups[p.category] || []).push(p); });

  mount(body, [
    el('p', { class: 'cc-sub', style: 'margin-bottom:12px' },
      'Check to allow an action, uncheck to remove it. "From role" means it comes from an assigned role; your override takes precedence and is saved instantly and audited. Greyed rows are permissions you do not hold yourself, so you cannot grant them.'),
    ...Object.keys(groups).sort().map(cat => el('div', { style: 'margin-bottom:16px' }, [
      el('div', { style: 'font-weight:800;margin:6px 0;color:var(--lb-navy,#0f172a);border-bottom:1px solid var(--lb-border,#e2e8f0);padding-bottom:4px' }, CAT_LABEL(cat)),
      ...groups[cat].map(p => {
        const cb = el('input', { type: 'checkbox' });
        cb.checked = eff(p);
        if (!p.can_grant) cb.disabled = true;
        const tag = el('span', { style: 'font-size:.7rem;color:var(--lb-muted,#64748b);margin-left:6px' }, tagText(p));
        cb.addEventListener('change', async () => {
          const want = cb.checked;
          const effect = want ? (p.from_role ? 'inherit' : 'allow') : (p.from_role ? 'deny' : 'inherit');
          cb.disabled = true;
          try {
            await setUserPermission(staff.user_id, p.key, effect);
            p.override = (effect === 'inherit') ? null : effect;
            tag.textContent = tagText(p);
            toast('Saved', 'success');
          } catch (e) { cb.checked = !want; toast(humanizeError(e), 'error'); }
          cb.disabled = !p.can_grant;
        });
        return el('label', { style: 'display:flex;align-items:flex-start;gap:8px;padding:5px 0;cursor:pointer' + (p.can_grant ? '' : ';opacity:.5') }, [
          cb,
          el('div', null, [
            el('span', { style: 'font-weight:600;font-size:.9rem' }, p.key), tag,
            p.description ? el('div', { class: 'cc-sub' }, p.description) : '',
          ]),
        ]);
      }),
    ])),
  ]);
}

export default openPermissionEditor;
