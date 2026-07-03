// staffRoles.js — Staff & Roles (functional in 2A).
// Lists staff + their roles (get_staff_directory), and offers privileged actions
// (assign/revoke role, suspend/reactivate, revoke sessions) — each server-authorized
// and audited. Server guards (self-mutation, last-owner) are surfaced as friendly errors.
import { el, mount } from '../../shared/ui/dom.js';
import { getStaffDirectory, getRolesCatalog, assignRole, revokeRole, setStaffStatus, revokeStaffSessions, listCarrierOrgs } from '../../shared/api.js';
import { can } from '../../shared/permissions.js';
import { openPermissionEditor } from './permissionEditor.js';
import { showLoading, showError } from '../../shared/loading.js';
import { humanizeError, toast } from '../../shared/errors.js';

let _roles = null;
let _carrierOrgs = null;

function badgeForStatus(s) {
  return el('span', { class: 'lb-badge ' + (s === 'active' ? 'lb-badge-green' : 'lb-badge-red') }, s);
}

// UI gate that mirrors the server: role assign/revoke RPCs require staff.assign_role
// OR roles.assign (NOT roles.manage, which is role-definition admin only).
function canAssignRoles() { return can('staff.assign_role') || can('roles.assign'); }

function assignmentChips(assignments, onRevoke) {
  if (!assignments || !assignments.length) return el('span', { style: 'color:var(--lb-muted)' }, 'no roles');
  return el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px' }, assignments.map(a => {
    const label = a.role_key + (a.scope_type === 'global' ? '' : ' · ' + a.scope_type);
    const chip = el('span', { class: 'lb-badge lb-badge-gray', style: 'display:inline-flex;gap:6px;align-items:center' }, [label]);
    if (canAssignRoles() && onRevoke) {
      const x = el('button', { class: 'lb-btn', style: 'padding:0 6px;background:transparent;color:var(--lb-red);border:0', title: 'Revoke', onClick: () => onRevoke(a) }, '✕');
      chip.appendChild(x);
    }
    return chip;
  }));
}

function staffRow(s, reload) {
  const actions = el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap' });
  // Suspend/reactivate requires staff.suspend (same as the server RPC).
  if (can('staff.suspend')) {
    const next = s.status === 'active' ? 'suspended' : 'active';
    actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: async (e) => {
      e.target.disabled = true;
      try { await setStaffStatus(s.user_id, next); toast('Staff ' + next + '.', 'success'); reload(); }
      catch (ex) { toast(humanizeError(ex), 'error'); e.target.disabled = false; }
    } }, s.status === 'active' ? 'Suspend' : 'Reactivate'));
  }
  // Session revoke requires sessions.revoke (same as the server RPC).
  if (can('sessions.revoke')) {
    actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: async (e) => {
      e.target.disabled = true;
      try { await revokeStaffSessions(s.user_id); toast('Session-revoke requested.', 'success'); }
      catch (ex) { toast(humanizeError(ex), 'error'); }
      e.target.disabled = false;
    } }, 'Revoke sessions'));
  }
  if (can('staff.assign_role') || can('roles.assign')) {
    actions.appendChild(el('button', { class: 'lb-btn lb-btn-secondary', onClick: () => openPermissionEditor(s) }, 'Permissions'));
  }
  return el('tr', null, [
    el('td', null, [el('div', { style: 'font-weight:600' }, s.email || s.user_id),
      s.contact_name ? el('div', { class: 'd', style: 'color:var(--lb-muted);font-size:.82rem' }, s.contact_name) : '']),
    el('td', null, [badgeForStatus(s.status), s.is_owner ? el('span', { class: 'lb-badge lb-badge-amber', style: 'margin-left:6px' }, 'owner') : '']),
    el('td', null, assignmentChips(s.assignments, canAssignRoles() ? async (a) => {
      if (!confirm('Revoke role "' + a.role_key + '" from this staff member?')) return;
      try { await revokeRole(a.assignment_id); toast('Role revoked.', 'success'); reload(); }
      catch (ex) { toast(humanizeError(ex), 'error'); }
    } : null)),
    el('td', null, actions),
  ]);
}

function assignForm(staff, reload) {
  if (!canAssignRoles()) return el('div');
  const userSel = el('select', null, [el('option', { value: '' }, 'Select staff…')].concat(
    staff.map(s => el('option', { value: s.user_id }, s.email || s.user_id))));
  const roleSel = el('select', null, [el('option', { value: '' }, 'Select role…')].concat(
    (_roles || []).map(r => el('option', { value: r.role_key }, r.role_key))));
  // Scope: global, or carrier-scoped (child access to one carrier). The server validates
  // every assignment (grant-ceiling, owner protection, non-null target), so the UI only
  // shapes the request. Carrier-scoped assignments require a target carrier organization.
  const scopeSel = el('select', null, [
    el('option', { value: 'global' }, 'Global (all access for the role)'),
    el('option', { value: 'assigned_carrier' }, 'Carrier only (child access)'),
  ]);
  const carrierSel = el('select', { hidden: true }, [el('option', { value: '' }, 'Select carrier…')].concat(
    (_carrierOrgs || []).map(c => el('option', { value: c.id }, c.name))));
  scopeSel.addEventListener('change', () => { carrierSel.hidden = scopeSel.value !== 'assigned_carrier'; });
  const btn = el('button', { class: 'lb-btn lb-btn-primary', onClick: async () => {
    if (!userSel.value || !roleSel.value) { toast('Pick a staff member and role.', 'error'); return; }
    const scope = scopeSel.value;
    if (scope === 'assigned_carrier' && !carrierSel.value) { toast('Pick a carrier for carrier-scoped access.', 'error'); return; }
    btn.disabled = true;
    try {
      await assignRole({ userId: userSel.value, roleKey: roleSel.value, scopeType: scope,
        carrierOrg: scope === 'assigned_carrier' ? carrierSel.value : null });
      toast(scope === 'global' ? 'Role assigned (global).' : 'Role assigned (carrier-scoped).', 'success'); reload();
    } catch (ex) { toast(humanizeError(ex), 'error'); }
    btn.disabled = false;
  } }, 'Assign role');
  return el('div', { class: 'lb-card', style: 'margin-bottom:18px' }, [
    el('div', { style: 'font-family:var(--lb-head);font-weight:700;margin-bottom:10px' }, 'Assign a role'),
    el('div', { class: 'cc-toolbar' }, [userSel, roleSel, scopeSel, carrierSel, btn]),
    el('p', { style: 'color:var(--lb-muted);font-size:.8rem;margin-top:6px' },
      'Global grants the role everywhere; carrier-scoped grants it for a single carrier only (staff child access). You cannot modify your own assignments, grant beyond your own permissions, or grant Owner unless you are an Owner — the server enforces all three.'),
  ]);
}

export async function renderStaffRoles(host) {
  const body = el('div');
  mount(host, el('div', null, [
    el('div', { class: 'cc-section-head' }, [el('div', null, [
      el('h2', null, 'Staff & roles'),
      el('p', null, 'Manage who has access and what they can do. Actions are audited.')])]),
    body,
  ]));
  async function reload() {
    showLoading(body, 'Loading staff…');
    try {
      if (!_roles) { try { _roles = await getRolesCatalog(); } catch (_) { _roles = []; } }
      if (!_carrierOrgs) { try { _carrierOrgs = await listCarrierOrgs(); } catch (_) { _carrierOrgs = []; } }
      const staff = await getStaffDirectory();
      const table = el('table', { class: 'lb-table' }, [
        el('thead', null, el('tr', null, [el('th', null, 'Staff'), el('th', null, 'Status'),
          el('th', null, 'Roles'), el('th', null, 'Actions')])),
        el('tbody', null, (staff || []).map(s => staffRow(s, reload))),
      ]);
      mount(body, [assignForm(staff || [], reload), el('div', { class: 'lb-card' }, table)]);
    } catch (e) { showError(body, humanizeError(e), reload); }
  }
  await reload();
}

export default renderStaffRoles;
