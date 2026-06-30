// app.js — Command Center V1 bootstrap.
// Flow: validate env -> require session (else login) -> load staff context ->
// deny if not staff -> render shell + guarded hash router. Every privileged action
// is re-authorized server-side; the client only hides what it shows.
// V1 scope: Overview, Carriers, Loads, Dispatch, Documents, Staff & Roles, Audit,
// Feature Flags, Settings. Deferred modules are intentionally absent.
import { el, mount } from '../shared/ui/dom.js';
import ENV from '../shared/env.js';
import { getSession, getUser, onAuthChange } from '../shared/session.js';
import { isFlagEnabled } from '../shared/api.js';
import { loadStaffContext, isStaff, can, clearStaffContext } from '../shared/permissions.js';
import { mountOfflineBanner } from '../shared/connectivity.js';
import { createRouter } from '../shared/router.js';
import { renderShell } from './views/shell.js';
import { renderOverview } from './views/overview.js';
import { renderDispatch } from './views/dispatch.js';
import { renderCarriers } from './views/carriers.js';
import { renderLoads } from './views/loads.js';
import { renderDocuments } from './views/documents.js';
import { renderSettings } from './views/settings.js';
import { renderStaffRoles } from './views/staffRoles.js';
import { renderAudit } from './views/audit.js';
import { renderFlags } from './views/flags.js';
import { renderAutomation } from './views/automation.js';
import { renderCRM } from './views/crm.js';
import { renderCompliance } from './views/compliance.js';
import { renderTrips } from './views/trips.js';
import { renderPlaceholder } from './views/placeholder.js';
import { renderLogin } from './views/login.js';
import { registerAppSW } from '../shared/sw-register.js';

registerAppSW();
const root = document.getElementById('lb-app');

// Premium opening splash: keep it visible briefly so the animation is seen, then fade.
const _splashStart = Date.now();
let _splashGone = false;
function dismissSplash() {
  if (_splashGone) return; _splashGone = true;
  const s = document.getElementById('cc-splash');
  if (!s) return;
  const wait = Math.max(0, 1100 - (Date.now() - _splashStart));
  setTimeout(() => { s.classList.add('done'); setTimeout(() => s.remove(), 600); }, wait);
}
setTimeout(dismissSplash, 7000);

function fatal(message) {
  mount(root, el('div', { class: 'cc-deny' }, [
    el('h2', null, 'Command Center unavailable'),
    el('p', { style: 'color:var(--lb-muted)' }, message),
  ]));
  root.setAttribute('aria-busy', 'false');
  dismissSplash();
}

function denyNotStaff() {
  mount(root, el('div', { class: 'cc-deny' }, [
    el('h2', null, 'No staff access'),
    el('p', { style: 'color:var(--lb-muted)' },
      'Your account is signed in but is not an active staff member of LoadBoot. If you believe this is an error, contact an owner.'),
    el('button', { class: 'lb-btn lb-btn-secondary', style: 'margin-top:14px', onClick: async () => {
      const { signOut } = await import('../shared/session.js'); await signOut(); location.reload();
    } }, 'Sign out'),
  ]));
  dismissSplash();
}

async function boot() {
  root.setAttribute('aria-busy', 'true');

  const session = await getSession();
  if (!session) {
    renderLogin(root, () => boot());
    root.setAttribute('aria-busy', 'false');
    dismissSplash();
    return;
  }

  // The Command Center is gated behind a feature flag AND staff membership.
  let ccEnabled = true;
  try { ccEnabled = await isFlagEnabled('command_center_enabled'); } catch (_) { ccEnabled = false; }

  let ctx;
  try { ctx = await loadStaffContext(true); }
  catch (e) { fatal('Could not verify your access. Please check your connection and retry.'); return; }

  if (!isStaff()) { denyNotStaff(); return; }
  if (!ccEnabled) {
    // Owners can still get in to flip the flag; everyone else sees a maintenance notice.
    if (!can('flags.manage')) {
      fatal('The Command Center is not enabled yet. An owner can enable it under Feature Flags.');
      return;
    }
  }

  // optional engine flags (nav items hide when off, so production without the
  // automation backend never reaches its RPCs)
  let automationEnabled = false, crmEnabled = false, complianceEnabled = false, dispatchEnabled = false;
  try { automationEnabled = await isFlagEnabled('automation_core_enabled'); } catch (_) { automationEnabled = false; }
  try { crmEnabled = await isFlagEnabled('crm_enabled'); } catch (_) { crmEnabled = false; }
  try { complianceEnabled = await isFlagEnabled('compliance_enabled'); } catch (_) { complianceEnabled = false; }
  try { dispatchEnabled = await isFlagEnabled('dispatch_enabled'); } catch (_) { dispatchEnabled = false; }

  const user = await getUser();
  const shell = renderShell(root, user, { automation: automationEnabled, crm: crmEnabled, compliance: complianceEnabled, dispatch: dispatchEnabled });
  const { content, setActive } = shell;
  mountOfflineBanner();
  root.setAttribute('aria-busy', 'false');

  const anyOf = (...perms) => perms.some(p => can(p));
  const denied = () => renderPlaceholder(content, 'Not available', 'You do not have permission to view this area.');
  const guard = (perms, render) => () => (perms.some(p => can(p)) ? render() : denied());

  const router = createRouter({
    '/': () => { setActive('/'); renderOverview(content, ctx, shell); },
    '/dispatch': () => { setActive('/dispatch'); guard(['loads.create', 'loads.assign', 'loads.publish', 'carriers.view'], () => renderDispatch(content))(); },
    '/carriers': () => { setActive('/carriers'); guard(['carriers.view', 'carriers.edit', 'carriers.approve'], () => renderCarriers(content))(); },
    '/loads': () => { setActive('/loads'); guard(['loads.create', 'loads.assign', 'loads.publish', 'carriers.view'], () => renderLoads(content))(); },
    '/documents': () => { setActive('/documents'); guard(['documents.view', 'documents.review'], () => renderDocuments(content))(); },
    '/automation': () => { setActive('/automation'); if (automationEnabled) renderAutomation(content); else renderPlaceholder(content, 'Not available', 'The automation engine is not enabled in this environment.'); },
    '/crm': () => { setActive('/crm'); if (crmEnabled && can('crm.view')) renderCRM(content); else denied(); },
    '/compliance': () => { setActive('/compliance'); if (complianceEnabled && can('compliance.view')) renderCompliance(content); else denied(); },
    '/trips': () => { setActive('/trips'); if (dispatchEnabled && can('dispatch.view')) renderTrips(content); else denied(); },
    '/staff': () => { setActive('/staff'); if (anyOf('users.manage', 'roles.manage', 'staff.suspend')) renderStaffRoles(content); else denied(); },
    '/audit': () => { setActive('/audit'); if (can('audit.view')) renderAudit(content); else renderPlaceholder(content, 'Not available', 'You do not have permission to view the audit log.'); },
    '/flags': () => { setActive('/flags'); if (can('flags.manage')) renderFlags(content); else renderPlaceholder(content, 'Not available', 'You do not have permission to manage feature flags.'); },
    '/settings': () => { setActive('/settings'); guard(['settings.manage'], () => renderSettings(content))(); },
  }, {
    notFound: () => { setActive('/'); renderOverview(content, ctx, shell); },
    onError: () => renderPlaceholder(content, 'Something went wrong', 'Please retry or pick another section.'),
  });
  router.start();
  dismissSplash();

  // React to sign-out in another tab.
  onAuthChange((s) => { if (!s) { clearStaffContext(); location.reload(); } });
}

boot().catch((e) => fatal(e && e.lbFatal ? e.message : 'Unexpected error starting the Command Center.'));
