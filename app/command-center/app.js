// lb-cdn-bump 2026-08-15: force fresh Netlify blob upload (corrupt-deploy recovery) — no code changes.
// app.js — Command Center V1 bootstrap.
// Flow: validate env -> require session (else login) -> load staff context ->
// deny if not staff -> render shell + guarded hash router. Every privileged action
// is re-authorized server-side; the client only hides what it shows.
// Scope: full ops suite (65+ screens across Overview/Operations/CRM/Support/SEO/
// Reporting/Comms/Finance/Marketing/Admin) — see views/shell.js NAV for the map.
// CC CUT 2 Sep 2026: 21-item nav; merged screens run as tabs (TABBED below); 6 dead views retired.
import { el, mount } from '../shared/ui/dom.js';
import ENV from '../shared/env.js';
import { getSession, getUser, onAuthChange } from '../shared/session.js';
import { isFlagEnabled, claimStaffInvite } from '../shared/api.js';
import { loadStaffContext, isStaff, can, clearStaffContext } from '../shared/permissions.js';
import { mountOfflineBanner } from '../shared/connectivity.js';
import { createRouter } from '../shared/router.js';
import { renderShell } from './views/shell.js';
import { renderTabbed } from './views/_tabbed.js';
import { renderDispatch } from './views/dispatch.js';
import { renderCarriers } from './views/carriers.js';
import { renderLoads } from './views/loads.js';
import { renderDocuments } from './views/documents.js';
import { renderBookingRequests } from './views/bookingRequests.js';
import { renderSafetyDesk } from './views/safetyDesk.js';
import '../shared/ui/chatWidget.js';
import { renderSettings } from './views/settings.js';
import { renderStaffRoles } from './views/staffRoles.js';
import { renderAudit } from './views/audit.js';
import { renderFlags } from './views/flags.js';
import { renderAutomation } from './views/automation.js';
import { renderCRM } from './views/crm.js';
import { renderCompliance } from './views/compliance.js';
import { renderTrips } from './views/trips.js';
import { renderComms } from './views/comms.js';
import { renderFinance } from './views/finance.js';
import { renderFinanceAnalytics } from './views/financeAnalytics.js';
import { renderSystemHealth } from './views/systemHealth.js';
import { renderTemplates } from './views/templates.js';
import { renderAudiences } from './views/audiences.js';
import { renderCampaignManager } from './views/campaignManager.js';
import { renderDeliveryHealth } from './views/deliveryHealth.js';
import { renderMarketingIntel } from './views/marketingIntel.js';
import { renderOutreach } from './views/outreach.js';
import { renderLiveChat } from './views/liveChat.js';
import { renderEmailLoads } from './views/emailLoads.js';
import { renderAccountHealth } from './views/accountHealth.js';
import { renderSmartMatch } from './views/smartMatch.js';
import { renderAnalytics } from './views/analytics.js';
import { renderContent } from './views/content.js';
import { renderIntegrations } from './views/integrations.js';
import { renderRadar } from './views/radar.js';
import { renderAgents } from './views/agents.js';
import { renderDispatchers } from './views/dispatchers.js';
import { renderFleet } from './views/fleet.js';
import { renderFleetExpiry } from './views/fleetExpiry.js';
import { renderPartnerCompliance } from './views/partnerCompliance.js';
import { renderContactsDirectory } from './views/contactsDirectory.js';
import { renderAnalyticsWeb } from './views/analyticsWeb.js';
import { renderForms } from './views/forms.js';
import { renderSeo } from './views/seo.js';
import { renderCarrier360 } from './views/carrier360.js';
import { renderBroker360 } from './views/broker360.js';
import { renderPartners } from './views/partners.js';
import { renderPartnerIntake } from './views/partnerIntake.js';
import { renderMarketRatesCC } from './views/marketRates.js';
import { renderRateStandards } from './views/rateStandards.js';
import { renderVerificationCenter } from './views/verificationCenter.js';
import { renderPodReview } from './views/podReview.js';
import { renderLoadIntake } from './views/loadIntake.js';
import { renderControlTower } from './views/controlTower.js';
import { renderExceptionCenter } from './views/exceptionCenter.js';
import { renderWorkflowBuilder } from './views/workflowBuilder.js';
import { renderReferrals } from './views/referrals.js';
import { renderBI } from './views/bi.js';
import { renderCarrierScorecards } from './views/carrierScorecards.js';
import { renderBrokerSla } from './views/brokerSla.js';
import { renderBrandKit } from './views/brandKit.js';
import { renderPluginMarketplace } from './views/pluginMarketplace.js';
import { renderFormBuilder } from './views/formBuilder.js';
import { renderEmailBuilder } from './views/emailBuilder.js';
import { renderSupport } from './views/support.js';
import { initTelemetry } from '../shared/telemetry.js';
initTelemetry();  // real-user error + Core Web Vitals capture
import { renderReports } from './views/reports.js';
import { renderNotifications } from './views/notifications.js';
import { renderAutomationsAdmin } from './views/automationsAdmin.js';
import { renderActionCenter } from './views/actionCenter.js';
import { renderOpsMap } from './views/opsMap.js';
import { renderAnnouncements } from './views/announcements.js';
import { renderPlaceholder } from './views/placeholder.js';
import { renderLogin } from './views/login.js';
import { registerAppSW } from '../shared/sw-register.js';


// PWA real-app behaviour: remember this portal so the installed app opens here next
// launch — but ONLY once a staff session exists. An accidental tap into the staff
// login page must never hijack where the app opens from then on.
import('../shared/session.js').then((s) => s.getSession()).then((sess) => {
  if (sess) { try { localStorage.setItem('lb_last_portal', '/app/command-center/'); } catch (_) {} }
}).catch(() => {});

registerAppSW();
const root = document.getElementById('lb-app');

// Premium opening splash: keep it visible briefly so the animation is seen, then fade.
const _splashStart = Date.now();
let _splashGone = false;
function dismissSplash() {
  if (_splashGone) return; _splashGone = true;
  const s = document.getElementById('cc-splash');
  if (!s) return;
  const wait = Math.max(0, 2200 - (Date.now() - _splashStart));
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

  if (!isStaff()) {
    // Pending email invite? Claim it (provisions staff access + role), then re-verify.
    try { const _r = await claimStaffInvite(); if (_r && _r.claimed) { try { await loadStaffContext(true); } catch (_) {} } } catch (_) {}
  }
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
  let automationEnabled = false, crmEnabled = false, complianceEnabled = false, dispatchEnabled = false, commsEnabled = false, financeEnabled = false;
  try { automationEnabled = await isFlagEnabled('automation_core_enabled'); } catch (_) { automationEnabled = false; }
  try { crmEnabled = await isFlagEnabled('crm_enabled'); } catch (_) { crmEnabled = false; }
  try { complianceEnabled = await isFlagEnabled('compliance_enabled'); } catch (_) { complianceEnabled = false; }
  try { dispatchEnabled = await isFlagEnabled('dispatch_enabled'); } catch (_) { dispatchEnabled = false; }
  try { commsEnabled = await isFlagEnabled('comms_enabled'); } catch (_) { commsEnabled = false; }
  try { financeEnabled = await isFlagEnabled('finance_enabled'); } catch (_) { financeEnabled = false; }
  let analyticsEnabled = false, contentEnabled = false, integrationsEnabled = false, fleetEnabled = false;
  try { analyticsEnabled = await isFlagEnabled('analytics_enabled'); } catch (_) { analyticsEnabled = false; }
  try { contentEnabled = await isFlagEnabled('content_enabled'); } catch (_) { contentEnabled = false; }
  try { integrationsEnabled = await isFlagEnabled('integrations_enabled'); } catch (_) { integrationsEnabled = false; }
  try { fleetEnabled = await isFlagEnabled('fleet_enabled'); } catch (_) { fleetEnabled = false; }
  // Control Tower Wave A flags (default OFF until the owner enables them in production)
  let webAnalyticsEnabled = false, formsEnabled = false, seoEnabled = false;
  try { webAnalyticsEnabled = await isFlagEnabled('web_analytics_enabled'); } catch (_) { webAnalyticsEnabled = false; }
  try { formsEnabled = await isFlagEnabled('forms_enabled'); } catch (_) { formsEnabled = false; }
  try { seoEnabled = await isFlagEnabled('seo_enabled'); } catch (_) { seoEnabled = false; }
  // Control Tower Waves B–F flags (default OFF until the owner enables them)
  let entity360Enabled = false, partnersEnabled = false, supportEnabled = false, reportsEnabled = false, automationsAdminEnabled = false, notificationsCenterEnabled = false, teamChatEnabled = false;
  try { entity360Enabled = await isFlagEnabled('entity360_enabled'); } catch (_) { entity360Enabled = false; }
  try { partnersEnabled = await isFlagEnabled('partners_enabled'); } catch (_) { partnersEnabled = false; }
  try { supportEnabled = await isFlagEnabled('support_enabled'); } catch (_) { supportEnabled = false; }
  try { reportsEnabled = await isFlagEnabled('reports_enabled'); } catch (_) { reportsEnabled = false; }
  try { automationsAdminEnabled = await isFlagEnabled('automations_admin_enabled'); } catch (_) { automationsAdminEnabled = false; }
  try { notificationsCenterEnabled = await isFlagEnabled('notifications_center_enabled'); } catch (_) { notificationsCenterEnabled = false; }
  try { teamChatEnabled = await isFlagEnabled('team_chat_enabled'); } catch (_) { teamChatEnabled = false; }
  let opsMapEnabled = false;
  try { opsMapEnabled = await isFlagEnabled('ops_map_enabled'); } catch (_) { opsMapEnabled = false; }
  let announcementsEnabled = false, campaignsEnabled = false;
  try { announcementsEnabled = await isFlagEnabled('announcements_enabled'); } catch (_) { announcementsEnabled = false; }
  try { campaignsEnabled = await isFlagEnabled('campaigns_enabled'); } catch (_) { campaignsEnabled = false; }
  let googleDataEnabled = false;
  try { googleDataEnabled = await isFlagEnabled('google_data_enabled'); } catch (_) { googleDataEnabled = false; }
  // Old Gemini-based AI Copilot removed 2026-07-01 on owner instruction — replaced by the deterministic
  // AI Load Pilot in Load Intake (cc_load_advisor / cc_dispatch_plan), which needs no external API key.
  // Global Dispatch Marketplace (Load Intake / AI Pilot / Control Tower / Exception Center)
  let loadMarketplaceEnabled = false;
  try { loadMarketplaceEnabled = await isFlagEnabled('load_marketplace'); } catch (_) { loadMarketplaceEnabled = false; }
  // WEB-2 multi-level referral engine (default OFF in production until owner + legal sign-off).
  let referralProgramEnabled = false;
  try { referralProgramEnabled = await isFlagEnabled('referral_program'); } catch (_) { referralProgramEnabled = false; }

  const user = await getUser();
  const shell = renderShell(root, user, { automation: automationEnabled, crm: crmEnabled, compliance: complianceEnabled, dispatch: dispatchEnabled, comms: commsEnabled, finance: financeEnabled, analytics: analyticsEnabled, content: contentEnabled, integrations: integrationsEnabled, fleet: fleetEnabled, webAnalytics: webAnalyticsEnabled, forms: formsEnabled, seo: seoEnabled, partners: partnersEnabled, support: supportEnabled, reports: reportsEnabled, automationsAdmin: automationsAdminEnabled, notificationsCenter: notificationsCenterEnabled, teamChat: teamChatEnabled, opsMap: opsMapEnabled, announcements: announcementsEnabled, campaigns: campaignsEnabled, googleData: googleDataEnabled, load_marketplace: loadMarketplaceEnabled, referral_program: referralProgramEnabled });
  const { content, setActive } = shell;
  mountOfflineBanner();
  root.setAttribute('aria-busy', 'false');

  const anyOf = (...perms) => perms.some(p => can(p));
  const denied = () => renderPlaceholder(content, 'Not available', 'You do not have permission to view this area.');
  const guard = (perms, render) => () => (perms.some(p => can(p)) ? render() : denied());


  // ── CC CUT, 2 Sep 2026: merged screens. One nav item, the old views as tabs, old routes deep-link
  //    to their tab. Permission checks are the ORIGINAL per-route checks, moved onto the tab.
  const loadsPerm = () => anyOf('loads.create', 'loads.assign', 'loads.publish', 'carriers.view');
  const TABBED = {
    loads: { nav: '/loads', tabs: [
      { id: 'board', label: 'Loads & trips', path: '/loads', allowed: loadsPerm, render: (h, q) => renderLoads(h, q.get('id')) },
      { id: 'dispatch', label: 'Dispatch board', path: '/dispatch', allowed: loadsPerm, render: (h) => renderDispatch(h) },
      { id: 'trips', label: 'Trip board', path: '/trips', allowed: () => dispatchEnabled && can('dispatch.view'), render: (h, q) => renderTrips(h, q.get('id')) },
      { id: 'tower', label: 'Control tower', path: '/control-tower', allowed: () => loadMarketplaceEnabled && can('dispatch.view'), render: (h) => renderControlTower(h) },
      { id: 'intake', label: 'Load intake', path: '/load-intake', allowed: () => loadMarketplaceEnabled && (can('dispatch.view') || can('loads.create')), render: (h) => renderLoadIntake(h) },
      { id: 'email', label: 'Email loads', path: '/email-loads', allowed: () => can('comm.view') || can('support.view') || can('dispatch.manage'), render: (h) => renderEmailLoads(h) },
      { id: 'matching', label: 'Smart matching', path: '/matching', allowed: () => can('carriers.view'), render: (h) => renderSmartMatch(h) },
    ] },
    carriers: { nav: '/carriers', tabs: [
      { id: 'directory', label: 'Directory', path: '/carriers', allowed: () => anyOf('carriers.view', 'carriers.edit', 'carriers.approve'), render: (h) => renderCarriers(h) },
      { id: 'fleet', label: 'Fleet & drivers', path: '/fleet', allowed: () => fleetEnabled && can('fleet.view'), render: (h) => renderFleet(h) },
      { id: 'scorecards', label: 'Scorecards', path: '/carrier-scorecards', allowed: () => can('carriers.view') || can('dispatch.view'), render: (h) => renderCarrierScorecards(h) },
      { id: 'contacts', label: 'Contacts', path: '/contacts', allowed: () => can('carriers.view') || can('partners.view'), render: (h) => renderContactsDirectory(h) },
    ] },
    compliance: { nav: '/compliance', tabs: [
      { id: 'onboarding', label: 'Onboarding & compliance', path: '/compliance', allowed: () => complianceEnabled && can('compliance.view'), render: (h) => renderCompliance(h) },
      { id: 'fmcsa', label: 'FMCSA verification', path: '/verification', allowed: () => can('compliance.view'), render: (h) => renderVerificationCenter(h) },
      { id: 'expiry', label: 'License & medical expiry', path: '/fleet-expiry', allowed: () => can('fleet.view') || can('carriers.view'), render: (h) => renderFleetExpiry(h) },
      { id: 'partners', label: 'Broker & shipper re-verification', path: '/partner-compliance', allowed: () => can('compliance.view') || can('partners.view'), render: (h) => renderPartnerCompliance(h) },
      { id: 'health', label: 'Account health', path: '/account-health', allowed: () => can('carriers.view') || can('dispatch.view'), render: (h) => renderAccountHealth(h) },
    ] },
    partners: { nav: '/partners', tabs: [
      { id: 'directory', label: 'Directory', path: '/partners', allowed: () => partnersEnabled && can('partners.view'), render: (h) => renderPartners(h) },
      { id: 'sla', label: 'Broker SLA', path: '/broker-sla', allowed: () => partnersEnabled && can('partners.view'), render: (h) => renderBrokerSla(h) },
    ] },
    team: { nav: '/dispatchers', tabs: [
      { id: 'dispatchers', label: 'Dispatchers', path: '/dispatchers', allowed: () => anyOf('carriers.approve', 'dispatch.manage'), render: (h) => renderDispatchers(h) },
      { id: 'agents', label: 'Referral partners & payouts', path: '/agents', allowed: () => anyOf('carriers.approve', 'dispatch.manage'), render: (h) => renderAgents(h) },
      { id: 'referrals', label: 'Referral program', path: '/referrals', allowed: () => referralProgramEnabled && can('finance.view'), render: (h) => renderReferrals(h) },
    ] },
    finance: { nav: '/finance', tabs: [
      { id: 'invoices', label: 'Invoices & settlements', path: '/finance', allowed: () => financeEnabled && can('finance.view'), render: (h, q) => renderFinance(h, q.get('id')) },
      { id: 'analytics', label: 'Finance analytics', path: '/finance-analytics', allowed: () => financeEnabled && can('finance.view'), render: (h) => renderFinanceAnalytics(h) },
    ] },
    crm: { nav: '/crm', tabs: [
      { id: 'crm', label: 'CRM & outreach', path: '/crm', allowed: () => crmEnabled && can('crm.view'), render: (h) => renderCRM(h) },
      { id: 'delivery', label: 'Deliverability', path: '/delivery', allowed: () => can('content.view') || can('content.manage') || can('settings.manage'), render: (h) => renderDeliveryHealth(h) },
    ] },
    forms: { nav: '/forms', tabs: [
      { id: 'inbox', label: 'Inbox', path: '/forms', allowed: () => formsEnabled && can('forms.view'), render: (h, q) => renderForms(h, q.get('id')) },
      { id: 'builder', label: 'Form builder', path: '/form-builder', allowed: () => can('content.view') || can('content.manage'), render: (h) => renderFormBuilder(h) },
    ] },
    bi: { nav: '/bi', tabs: [
      { id: 'bi', label: 'Business Intelligence', path: '/bi', allowed: () => can('analytics.view') || can('reports.view'), render: (h) => renderBI(h) },
      { id: 'analytics', label: 'Business analytics', path: '/analytics', allowed: () => analyticsEnabled && can('analytics.view'), render: (h) => renderAnalytics(h) },
      { id: 'reports', label: 'Reports & exports', path: '/reports', allowed: () => reportsEnabled && can('reports.view'), render: (h) => renderReports(h) },
    ] },
    web: { nav: '/web-analytics', tabs: [
      { id: 'web', label: 'Website analytics', path: '/web-analytics', allowed: () => webAnalyticsEnabled && can('analytics.view'), render: (h) => renderAnalyticsWeb(h) },
      { id: 'intel', label: 'Marketing intelligence', path: '/marketing-intel', allowed: () => can('analytics.view') || can('comm.manage') || can('comm.send'), render: (h) => renderMarketingIntel(h) },
      { id: 'seo', label: 'SEO & redirects', path: '/seo', allowed: () => seoEnabled && can('seo.view'), render: (h) => renderSeo(h) },
      { id: 'content', label: 'Content & posts', path: '/content', allowed: () => contentEnabled && can('content.view'), render: (h) => renderContent(h) },
    ] },
    templates: { nav: '/templates', tabs: [
      { id: 'studio', label: 'Template Studio', path: '/templates', allowed: () => can('content.view'), render: (h) => renderTemplates(h) },
      { id: 'builder', label: 'Email builder', path: '/email-builder', allowed: () => can('content.view') || can('content.manage'), render: (h) => renderEmailBuilder(h) },
      { id: 'campaigns', label: 'Campaign manager', path: '/campaign-manager', allowed: () => can('content.view'), render: (h) => renderCampaignManager(h) },
      { id: 'audiences', label: 'Audiences', path: '/audiences', allowed: () => can('content.view'), render: (h) => renderAudiences(h) },
      { id: 'announcements', label: 'Announcements', path: '/announcements', allowed: () => announcementsEnabled && can('announce.view'), render: (h) => renderAnnouncements(h) },
    ] },
    automation: { nav: '/automation', tabs: [
      { id: 'queue', label: 'Task queue', path: '/automation', allowed: () => automationEnabled, render: (h) => renderAutomation(h) },
      { id: 'rules', label: 'Automation rules', path: '/automations', allowed: () => automationsAdminEnabled, render: (h) => renderAutomationsAdmin(h) },
      { id: 'workflows', label: 'Workflow builder', path: '/workflows', allowed: () => loadMarketplaceEnabled && (can('settings.manage') || can('content.manage')), render: (h) => renderWorkflowBuilder(h) },
    ] },
    settings: { nav: '/settings', tabs: [
      { id: 'settings', label: 'Settings', path: '/settings', allowed: () => can('settings.manage'), render: (h) => renderSettings(h) },
      { id: 'staff', label: 'Staff & roles', path: '/staff', allowed: () => anyOf('users.manage', 'roles.manage', 'staff.suspend'), render: (h) => renderStaffRoles(h) },
      { id: 'brand', label: 'Brand kit', path: '/brand-kit', allowed: () => can('content.view') || can('content.manage'), render: (h) => renderBrandKit(h) },
      { id: 'flags', label: 'Feature flags', path: '/flags', allowed: () => can('flags.manage'), render: (h) => renderFlags(h) },
      { id: 'audit', label: 'Audit log', path: '/audit', allowed: () => can('audit.view'), render: (h) => renderAudit(h) },
      { id: 'health', label: 'System health', path: '/health', allowed: () => true, render: (h) => renderSystemHealth(h) },
      { id: 'plugins', label: 'Plugins', path: '/plugins', allowed: () => can('settings.manage'), render: (h) => renderPluginMarketplace(h) },
    ] },
  };
  const tabbed = (key, tabId) => ({ query }) => {
    const def = TABBED[key]; setActive(def.nav);
    renderTabbed(content, { key, tabs: def.tabs, initial: tabId, query });
  };

  const router = createRouter({
    '/': () => { setActive('/'); renderActionCenter(content, ctx, user); }, // Action Center IS the dashboard (old counts-only overview retired)
    '/radar': () => { setActive('/'); renderRadar(content); },
    '/agents': tabbed('team', 'agents'),
    '/dispatchers': tabbed('team', 'dispatchers'),
    '/fleet': tabbed('carriers', 'fleet'),
    '/fleet-expiry': tabbed('compliance', 'expiry'),
    '/partner-compliance': tabbed('compliance', 'partners'),
    '/contacts': tabbed('carriers', 'contacts'),
    '/dispatch': tabbed('loads', 'dispatch'),
    '/carriers': tabbed('carriers', 'directory'),
    '/loads': tabbed('loads', 'board'),
    '/documents': () => { setActive('/documents'); guard(['documents.view', 'documents.review'], () => renderDocuments(content))(); },
    '/booking-requests': () => { setActive('/loads'); guard(['loads.assign', 'loads.publish', 'carriers.view'], () => renderBookingRequests(content))(); },
    '/safety': () => { setActive('/compliance'); guard(['compliance.approve', 'carriers.view'], () => renderSafetyDesk(content))(); },
    '/automation': tabbed('automation', 'queue'),
    '/crm': tabbed('crm', 'crm'),
    '/compliance': tabbed('compliance', 'onboarding'),
    '/trips': tabbed('loads', 'trips'),
    '/comms': () => { setActive('/live-chat'); if (commsEnabled && can('comm.view')) renderComms(content); else denied(); },
    '/finance': tabbed('finance', 'invoices'),
    '/finance-analytics': tabbed('finance', 'analytics'),
    '/health': tabbed('settings', 'health'),
    '/webhooks': () => { setActive('/integrations'); if (integrationsEnabled && can('integrations.view')) renderIntegrations(content); else denied(); }, // retired: Integrations has the Webhooks tab
    '/templates': tabbed('templates', 'studio'),
    '/audiences': tabbed('templates', 'audiences'),
    '/campaign-manager': tabbed('templates', 'campaigns'),
    '/delivery': tabbed('crm', 'delivery'),
    '/account-health': tabbed('compliance', 'health'),
    '/marketing-intel': tabbed('web', 'intel'),
    '/outreach': () => { setActive('/crm'); if (can('marketing.view') || can('carriers.approve') || can('dispatch.manage')) renderOutreach(content); else denied(); },
    '/email-loads': tabbed('loads', 'email'),
    '/live-chat': () => { setActive('/live-chat'); if (can('comm.view') || can('support.view') || can('dispatch.manage')) renderLiveChat(content); else denied(); },
    '/matching': tabbed('loads', 'matching'),
    '/analytics': tabbed('bi', 'analytics'),
    '/web-analytics': tabbed('web', 'web'),
    '/forms': tabbed('forms', 'inbox'),
    '/seo': tabbed('web', 'seo'),
    '/carrier': ({ query }) => { setActive('/carriers'); if (entity360Enabled && can('carriers.view')) renderCarrier360(content, query.get('id')); else denied(); },
    '/broker': ({ query }) => { setActive('/partners'); if (can('partners.view') || can('dispatch.manage')) renderBroker360(content, query.get('id')); else denied(); },
    '/partners': tabbed('partners', 'directory'),
    '/partner-intake': ({ query }) => { setActive('/partner-intake'); if (partnersEnabled && can('partners.view')) renderPartnerIntake(content, query.get('id')); else denied(); },
    '/market-rates': () => { setActive('/market-rates'); renderMarketRatesCC(content); },
    '/rate-standards': () => { setActive('/rate-standards'); if (can('dispatch.manage') || can('settings.manage')) renderRateStandards(content); else denied(); },
    '/verification': tabbed('compliance', 'fmcsa'),
    '/pod-review': () => { setActive('/loads'); if (can('dispatch.manage') || can('finance.manage') || can('compliance.manage')) renderPodReview(content); else denied(); },
    '/load-intake': tabbed('loads', 'intake'),
    '/control-tower': tabbed('loads', 'tower'),
    '/exceptions': () => { setActive('/loads'); if (can('dispatch.view')) renderExceptionCenter(content); else denied(); },
    '/workflows': tabbed('automation', 'workflows'),
    '/referrals': tabbed('team', 'referrals'),
    '/bi': tabbed('bi', 'bi'),
    '/carrier-scorecards': tabbed('carriers', 'scorecards'),
    '/broker-sla': tabbed('partners', 'sla'),
    '/brand-kit': tabbed('settings', 'brand'),
    '/plugins': tabbed('settings', 'plugins'),
    '/form-builder': tabbed('forms', 'builder'),
    '/email-builder': tabbed('templates', 'builder'),
    '/support': ({ query }) => { setActive('/support'); if (supportEnabled && can('support.view')) renderSupport(content, query.get('id')); else denied(); },
    '/reports': tabbed('bi', 'reports'),
    '/notifications': () => { setActive('/'); if (notificationsCenterEnabled) renderNotifications(content); else denied(); },
    '/map': () => { setActive('/loads'); if (opsMapEnabled) renderOpsMap(content); else denied(); },
    '/announcements': tabbed('templates', 'announcements'),
    '/google': tabbed('web', 'web'), // googleData is already embedded inside analyticsWeb (analyticsWeb.js:199)
    '/automations': tabbed('automation', 'rules'),
    '/content': tabbed('web', 'content'),
    '/integrations': () => { setActive('/integrations'); if (integrationsEnabled && can('integrations.view')) renderIntegrations(content); else denied(); },
    '/staff': tabbed('settings', 'staff'),
    '/audit': tabbed('settings', 'audit'),
    '/flags': tabbed('settings', 'flags'),
    '/settings': tabbed('settings', 'settings'),
  }, {
    notFound: () => { setActive('/'); renderActionCenter(content, ctx, user); },
    onError: () => renderPlaceholder(content, 'Something went wrong', 'Please retry or pick another section.'),
  });
  router.start();
  dismissSplash();

  // React to sign-out in another tab.
  onAuthChange((s) => { if (!s) { clearStaffContext(); location.reload(); } });
}

boot().catch((e) => fatal(e && e.lbFatal ? e.message : 'Unexpected error starting the Command Center.'));
