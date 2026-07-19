// app.js — Command Center V1 bootstrap.
// Flow: validate env -> require session (else login) -> load staff context ->
// deny if not staff -> render shell + guarded hash router. Every privileged action
// is re-authorized server-side; the client only hides what it shows.
// Scope: full ops suite (65+ screens across Overview/Operations/CRM/Support/SEO/
// Reporting/Comms/Finance/Marketing/Admin) — see views/shell.js NAV for the map.
import { el, mount } from '../shared/ui/dom.js';
import ENV from '../shared/env.js';
import { getSession, getUser, onAuthChange } from '../shared/session.js';
import { isFlagEnabled, claimStaffInvite } from '../shared/api.js';
import { loadStaffContext, isStaff, can, clearStaffContext } from '../shared/permissions.js';
import { mountOfflineBanner } from '../shared/connectivity.js';
import { createRouter } from '../shared/router.js';
import { renderShell } from './views/shell.js';
import { renderOverview } from './views/overview.js';
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
import { renderSystemModules } from './views/systemModules.js';
import { renderSystemHealth } from './views/systemHealth.js';
import { renderWebhooks } from './views/webhooks.js';
import { renderTemplates } from './views/templates.js';
import { renderAudiences } from './views/audiences.js';
import { renderCampaignManager } from './views/campaignManager.js';
import { renderDeliveryHealth } from './views/deliveryHealth.js';
import { renderMarketingAnalytics } from './views/marketingAnalytics.js';
import { renderMarketingIntel } from './views/marketingIntel.js';
import { renderAccountHealth } from './views/accountHealth.js';
import { renderSmartMatch } from './views/smartMatch.js';
import { renderAnalytics } from './views/analytics.js';
import { renderContent } from './views/content.js';
import { renderIntegrations } from './views/integrations.js';
import { renderRadar } from './views/radar.js';
import { renderAgents } from './views/agents.js';
import { renderFleet } from './views/fleet.js';
import { renderFleetExpiry } from './views/fleetExpiry.js';
import { renderContactsDirectory } from './views/contactsDirectory.js';
import { renderManagement } from './views/management.js';
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
import { renderReports } from './views/reports.js';
import { renderNotifications } from './views/notifications.js';
import { renderAutomationsAdmin } from './views/automationsAdmin.js';
import { renderChat } from './views/chat.js';
import { renderActionCenter } from './views/actionCenter.js';
import { renderOpsMap } from './views/opsMap.js';
import { renderAnnouncements } from './views/announcements.js';
import { renderCampaigns } from './views/campaigns.js';
import { renderGoogleData } from './views/googleData.js';
import { renderPlaceholder } from './views/placeholder.js';
import { renderLogin } from './views/login.js';
import { registerAppSW } from '../shared/sw-register.js';


// PWA real-app behaviour: remember this portal so the installed app opens here next launch.
try { localStorage.setItem('lb_last_portal', '/app/command-center/'); } catch (_) {}

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
  let actionCenterEnabled = false, opsMapEnabled = false;
  try { actionCenterEnabled = await isFlagEnabled('action_center_enabled'); } catch (_) { actionCenterEnabled = false; }
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

  const router = createRouter({
    '/': () => { setActive('/'); if (actionCenterEnabled) renderActionCenter(content, ctx, user); else renderOverview(content, ctx, shell); },
    '/radar': () => { setActive('/radar'); renderRadar(content); },
    '/agents': () => { setActive('/agents'); guard(['carriers.approve', 'dispatch.manage'], () => renderAgents(content))(); },
    '/management': () => { setActive('/management'); renderManagement(content); },
    '/fleet': () => { setActive('/fleet'); if (fleetEnabled && can('fleet.view')) renderFleet(content); else denied(); },
    '/fleet-expiry': () => { setActive('/fleet-expiry'); if (can('fleet.view') || can('carriers.view')) renderFleetExpiry(content); else denied(); },
    '/contacts': () => { setActive('/contacts'); if (can('carriers.view') || can('partners.view')) renderContactsDirectory(content); else denied(); },
    '/dispatch': () => { setActive('/dispatch'); guard(['loads.create', 'loads.assign', 'loads.publish', 'carriers.view'], () => renderDispatch(content))(); },
    '/carriers': () => { setActive('/carriers'); guard(['carriers.view', 'carriers.edit', 'carriers.approve'], () => renderCarriers(content))(); },
    '/loads': () => { setActive('/loads'); guard(['loads.create', 'loads.assign', 'loads.publish', 'carriers.view'], () => renderLoads(content))(); },
    '/documents': () => { setActive('/documents'); guard(['documents.view', 'documents.review'], () => renderDocuments(content))(); },
    '/booking-requests': () => { setActive('/booking-requests'); guard(['loads.assign', 'loads.publish', 'carriers.view'], () => renderBookingRequests(content))(); },
    '/safety': () => { setActive('/safety'); guard(['compliance.approve', 'carriers.view'], () => renderSafetyDesk(content))(); },
    '/automation': () => { setActive('/automation'); if (automationEnabled) renderAutomation(content); else renderPlaceholder(content, 'Not available', 'The automation engine is not enabled in this environment.'); },
    '/crm': () => { setActive('/crm'); if (crmEnabled && can('crm.view')) renderCRM(content); else denied(); },
    '/compliance': () => { setActive('/compliance'); if (complianceEnabled && can('compliance.view')) renderCompliance(content); else denied(); },
    '/trips': () => { setActive('/trips'); if (dispatchEnabled && can('dispatch.view')) renderTrips(content); else denied(); },
    '/comms': () => { setActive('/comms'); if (commsEnabled && can('comm.view')) renderComms(content); else denied(); },
    '/finance': () => { setActive('/finance'); if (financeEnabled && can('finance.view')) renderFinance(content); else denied(); },
    '/finance-analytics': () => { setActive('/finance-analytics'); if (financeEnabled && can('finance.view')) renderFinanceAnalytics(content); else denied(); },
    '/modules': () => { setActive('/modules'); if (can('settings.manage')) renderSystemModules(content); else denied(); },
    '/health': () => { setActive('/health'); renderSystemHealth(content); },
    '/webhooks': () => { setActive('/webhooks'); if (can('integrations.view')) renderWebhooks(content); else denied(); },
    '/templates': () => { setActive('/templates'); if (can('content.view')) renderTemplates(content); else denied(); },
    '/audiences': () => { setActive('/audiences'); if (can('content.view')) renderAudiences(content); else denied(); },
    '/campaign-manager': () => { setActive('/campaign-manager'); if (can('content.view')) renderCampaignManager(content); else denied(); },
    '/delivery': () => { setActive('/delivery'); if (can('content.view') || can('content.manage') || can('settings.manage')) renderDeliveryHealth(content); else denied(); },
    '/marketing-analytics': () => { setActive('/marketing-analytics'); if (can('content.view')) renderMarketingAnalytics(content); else denied(); },
    '/account-health': () => { setActive('/account-health'); if (can('carriers.view') || can('dispatch.view')) renderAccountHealth(content); else denied(); },
    '/marketing-intel': () => { setActive('/marketing-intel'); if (can('analytics.view') || can('comm.manage') || can('comm.send')) renderMarketingIntel(content); else denied(); },
    '/matching': () => { setActive('/matching'); if (can('carriers.view')) renderSmartMatch(content); else denied(); },
    '/analytics': () => { setActive('/analytics'); if (analyticsEnabled && can('analytics.view')) renderAnalytics(content); else denied(); },
    '/web-analytics': () => { setActive('/web-analytics'); if (webAnalyticsEnabled && can('analytics.view')) renderAnalyticsWeb(content); else denied(); },
    '/forms': () => { setActive('/forms'); if (formsEnabled && can('forms.view')) renderForms(content); else denied(); },
    '/seo': () => { setActive('/seo'); if (seoEnabled && can('seo.view')) renderSeo(content); else denied(); },
    '/carrier': ({ query }) => { setActive('/carriers'); if (entity360Enabled && can('carriers.view')) renderCarrier360(content, query.get('id')); else denied(); },
    '/broker': ({ query }) => { setActive('/partners'); if (can('partners.view') || can('dispatch.manage')) renderBroker360(content, query.get('id')); else denied(); },
    '/partners': () => { setActive('/partners'); if (partnersEnabled && can('partners.view')) renderPartners(content); else denied(); },
    '/partner-intake': () => { setActive('/partner-intake'); if (partnersEnabled && can('partners.view')) renderPartnerIntake(content); else denied(); },
    '/market-rates': () => { setActive('/market-rates'); renderMarketRatesCC(content); },
    '/rate-standards': () => { setActive('/rate-standards'); if (can('dispatch.manage') || can('settings.manage')) renderRateStandards(content); else denied(); },
    '/verification': () => { setActive('/verification'); if (can('compliance.view')) renderVerificationCenter(content); else denied(); },
    '/pod-review': () => { setActive('/pod-review'); if (can('dispatch.manage') || can('finance.manage') || can('compliance.manage')) renderPodReview(content); else denied(); },
    '/load-intake': () => { setActive('/load-intake'); if (can('dispatch.view') || can('loads.create')) renderLoadIntake(content); else denied(); },
    '/control-tower': () => { setActive('/control-tower'); if (can('dispatch.view')) renderControlTower(content); else denied(); },
    '/exceptions': () => { setActive('/exceptions'); if (can('dispatch.view')) renderExceptionCenter(content); else denied(); },
    '/workflows': () => { setActive('/workflows'); if (can('settings.manage') || can('content.manage')) renderWorkflowBuilder(content); else denied(); },
    '/referrals': () => { setActive('/referrals'); if (referralProgramEnabled && can('finance.view')) renderReferrals(content); else denied(); },
    '/bi': () => { setActive('/bi'); if (can('analytics.view') || can('reports.view')) renderBI(content); else denied(); },
    '/carrier-scorecards': () => { setActive('/carrier-scorecards'); if (can('carriers.view') || can('dispatch.view')) renderCarrierScorecards(content); else denied(); },
    '/broker-sla': () => { setActive('/broker-sla'); if (partnersEnabled && can('partners.view')) renderBrokerSla(content); else denied(); },
    '/brand-kit': () => { setActive('/brand-kit'); if (can('content.view') || can('content.manage')) renderBrandKit(content); else denied(); },
    '/plugins': () => { setActive('/plugins'); if (can('settings.manage')) renderPluginMarketplace(content); else denied(); },
    '/form-builder': () => { setActive('/form-builder'); if (can('content.view') || can('content.manage')) renderFormBuilder(content); else denied(); },
    '/email-builder': () => { setActive('/email-builder'); if (can('content.view') || can('content.manage')) renderEmailBuilder(content); else denied(); },
    '/support': () => { setActive('/support'); if (supportEnabled && can('support.view')) renderSupport(content); else denied(); },
    '/reports': () => { setActive('/reports'); if (reportsEnabled && can('reports.view')) renderReports(content); else denied(); },
    '/notifications': () => { setActive('/notifications'); if (notificationsCenterEnabled) renderNotifications(content); else denied(); },
    '/chat': () => { setActive('/chat'); if (teamChatEnabled) renderChat(content); else denied(); },
    '/map': () => { setActive('/map'); if (opsMapEnabled) renderOpsMap(content); else denied(); },
    '/announcements': () => { setActive('/announcements'); if (announcementsEnabled && can('announce.view')) renderAnnouncements(content); else denied(); },
    '/campaigns': () => { setActive('/campaigns'); if (campaignsEnabled && can('campaigns.view')) renderCampaigns(content); else denied(); },
    '/google': () => { setActive('/google'); if (googleDataEnabled && can('analytics.view')) renderGoogleData(content); else denied(); },
    '/automations': () => { setActive('/automations'); if (automationsAdminEnabled) renderAutomationsAdmin(content); else denied(); },
    '/content': () => { setActive('/content'); if (contentEnabled && can('content.view')) renderContent(content); else denied(); },
    '/integrations': () => { setActive('/integrations'); if (integrationsEnabled && can('integrations.view')) renderIntegrations(content); else denied(); },
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
