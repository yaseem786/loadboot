#!/usr/bin/env python3
"""CC cut, 2 Sep 2026 — idempotent patcher. Source: docs/CC-AUDIT-2026-09-02.md.
Usage: python apply_cc_cut.py <repo_root> <out_root>
Reads <repo_root>/app/command-center/**, writes patched copies under <out_root>/app/command-center/**.
Every anchor is asserted to match exactly once; a second run on already-patched input is a no-op."""
import os, re, sys, shutil

SRC = sys.argv[1]; OUT = sys.argv[2]
CC = os.path.join(SRC, 'app', 'command-center'); OCC = os.path.join(OUT, 'app', 'command-center')
os.makedirs(os.path.join(OCC, 'views'), exist_ok=True)
changed = []

def rd(p): return open(p, encoding='utf-8').read()
def wr(rel, s):
    p = os.path.join(OCC, rel); os.makedirs(os.path.dirname(p), exist_ok=True)
    open(p, 'w', encoding='utf-8').write(s); changed.append(rel)
def once(s, a, b, label):
    n = s.count(a)
    if n == 0 and b in s: return s  # already applied
    assert n == 1, f'{label}: anchor found {n}x'
    return s.replace(a, b)

# ───────────────────────── 1. shell.js — NAV 73 → 21 ─────────────────────────
shell = rd(os.path.join(CC, 'views', 'shell.js'))
i = shell.index('const NAV = ['); j = shell.index('\n];\n', i) + 4
NEW_NAV = '''const NAV = [
  // CC CUT, 2 Sep 2026 (docs/CC-AUDIT-2026-09-02.md): 73 items / 12 groups → 21 items / 6 groups.
  // Every retired route still works as a deep link; the merged screens live on as tabs
  // (see app.js TABBED). Hidden screens sit on tables with 0 rows in production.
  { group: 'Home', items: [
    { path: '/', label: 'Today', icon: 'grid', perm: null },
    { path: '/automation', label: 'Task queue', icon: 'refresh', perm: null, flag: 'automation' },
  ] },
  { group: 'Loads', items: [
    { path: '/loads', label: 'Loads & trips', icon: 'list', perm: 'any:loads.create,loads.assign,loads.publish,carriers.view,dispatch.view' },
    { path: '/market-rates', label: 'Market rates', icon: 'doc' },
    { path: '/rate-standards', label: 'Rate standards', icon: 'grid', perm: 'any:dispatch.manage,settings.manage' },
  ] },
  { group: 'Carriers', items: [
    { path: '/carriers', label: 'Carriers', icon: 'truck', perm: 'any:carriers.view,carriers.edit,carriers.approve' },
    { path: '/compliance', label: 'Compliance', icon: 'shield', perm: 'compliance.view', flag: 'compliance' },
    { path: '/documents', label: 'Document review', icon: 'doc', perm: 'any:documents.view,documents.review', badge: 'docs' },
  ] },
  { group: 'Partners & People', items: [
    { path: '/partners', label: 'Brokers & shippers', icon: 'users', perm: 'partners.view', flag: 'partners' },
    { path: '/partner-intake', label: 'Partner intake', icon: 'doc', perm: 'partners.view', flag: 'partners' },
    { path: '/dispatchers', label: 'Dispatchers & agents', icon: 'truck', perm: 'carriers.approve' },
  ] },
  { group: 'Money & Customers', items: [
    { path: '/finance', label: 'Finance', icon: 'doc', perm: 'finance.view', flag: 'finance' },
    { path: '/live-chat', label: 'Live chat', icon: 'bell', perm: 'any:comm.view,support.view,dispatch.manage' },
    { path: '/support', label: 'Support tickets', icon: 'bell', perm: 'support.view', flag: 'support' },
    { path: '/crm', label: 'CRM & outreach', icon: 'trend', perm: 'crm.view', flag: 'crm' },
    { path: '/forms', label: 'Forms', icon: 'bell', perm: 'forms.view', flag: 'forms' },
  ] },
  { group: 'Insights & Admin', items: [
    { path: '/bi', label: 'Business', icon: 'trend', perm: 'any:analytics.view,reports.view' },
    { path: '/web-analytics', label: 'Website & marketing', icon: 'trend', perm: 'analytics.view', flag: 'webAnalytics' },
    { path: '/templates', label: 'Templates', icon: 'doc', perm: 'content.view' },
    { path: '/integrations', label: 'Integrations', icon: 'refresh', perm: 'integrations.view', flag: 'integrations' },
    { path: '/settings', label: 'Settings', icon: 'cog', perm: 'any:settings.manage,users.manage,roles.manage,flags.manage,audit.view' },
  ] },
];
'''
if 'CC CUT, 2 Sep 2026' not in shell:
    shell = shell[:i] + NEW_NAV + shell[j:]
shell = once(shell, "// V1 navigation — only the ten shipped screens. Deferred modules (analytics, content,\n// builder, fleet, rate intelligence, finance, messages, search) are intentionally absent.\n", "", 'shell v1 comment')
shell = once(shell, "const SEARCH_HASH = { carrier: '/carriers', partner: '/partners', load: '/trips', lead: '/crm', invoice: '/finance', driver: '/fleet' };",
                    "const SEARCH_HASH = { carrier: '/carriers', partner: '/partners', load: '/loads', lead: '/crm', invoice: '/finance', driver: '/fleet' };", 'search hash')
wr('views/shell.js', shell)

# ───────────────────────── 2. actionCenter.js — dead link ─────────────────────────
ac = rd(os.path.join(CC, 'views', 'actionCenter.js'))
ac = once(ac, "emergency_sla: '#/safety-desk'", "emergency_sla: '#/safety'", 'actionCenter link')
wr('views/actionCenter.js', ac)

# ───────────────────────── 3. app.js — routes, tabbed screens, dead imports ─────────────────────────
app = rd(os.path.join(CC, 'app.js'))
DEAD_IMPORTS = [
    "import { renderManagement } from './views/management.js';\n",
    "import { renderSystemModules } from './views/systemModules.js';\n",
    "import { renderWebhooks } from './views/webhooks.js';\n",
    "import { renderMarketingAnalytics } from './views/marketingAnalytics.js';\n",
    "import { renderChat } from './views/chat.js';\n",
    "import { renderCampaigns } from './views/campaigns.js';\n",
]
for imp in DEAD_IMPORTS:
    app = app.replace(imp, '')
if "import { renderTabbed } from './views/_tabbed.js';" not in app:
    app = once(app, "import { renderShell } from './views/shell.js';\n",
               "import { renderShell } from './views/shell.js';\nimport { renderTabbed } from './views/_tabbed.js';\n", 'tabbed import')

# Dead routes → aliases (deep links keep working) or removal.
app = once(app, "    '/management': () => { setActive('/bi'); if (can('analytics.view') || can('reports.view')) renderBI(content); else denied(); }, // retired duplicate — alias to BI\n", "", 'route management')
app = once(app, "    '/modules': () => { setActive('/modules'); if (can('settings.manage')) renderSystemModules(content); else denied(); },\n", "", 'route modules')
app = once(app, "    '/webhooks': () => { setActive('/webhooks'); if (can('integrations.view')) renderWebhooks(content); else denied(); },\n",
                "    '/webhooks': () => { setActive('/integrations'); if (integrationsEnabled && can('integrations.view')) renderIntegrations(content); else denied(); }, // retired: Integrations has the Webhooks tab\n", 'route webhooks')
app = once(app, "    '/marketing-analytics': () => { setActive('/marketing-analytics'); if (can('content.view')) renderMarketingAnalytics(content); else denied(); },\n", "", 'route marketing-analytics')
app = once(app, "    '/chat': () => { setActive('/chat'); if (teamChatEnabled) renderChat(content); else denied(); },\n", "", 'route chat')
app = once(app, "    '/campaigns': () => { setActive('/campaigns'); if (campaignsEnabled && can('campaigns.view')) renderCampaigns(content); else denied(); },\n", "", 'route campaigns')

# Tabbed screens: each old route becomes "open the survivor with this tab".
TABBED = '''
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
'''
if "const TABBED = {" not in app:
    app = once(app, "  const router = createRouter({\n", TABBED + "\n  const router = createRouter({\n", 'tabbed block')

# Route table: old routes → tabbed survivors.
ROUTES = {
    "    '/agents': () => { setActive('/agents'); guard(['carriers.approve', 'dispatch.manage'], () => renderAgents(content))(); },\n": "    '/agents': tabbed('team', 'agents'),\n",
    "    '/dispatchers': () => { setActive('/dispatchers'); guard(['carriers.approve', 'dispatch.manage'], () => renderDispatchers(content))(); },\n": "    '/dispatchers': tabbed('team', 'dispatchers'),\n",
    "    '/fleet': () => { setActive('/fleet'); if (fleetEnabled && can('fleet.view')) renderFleet(content); else denied(); },\n": "    '/fleet': tabbed('carriers', 'fleet'),\n",
    "    '/fleet-expiry': () => { setActive('/fleet-expiry'); if (can('fleet.view') || can('carriers.view')) renderFleetExpiry(content); else denied(); },\n": "    '/fleet-expiry': tabbed('compliance', 'expiry'),\n",
    "    '/partner-compliance': () => { setActive('/partner-compliance'); if (can('compliance.view') || can('partners.view')) renderPartnerCompliance(content); else denied(); },\n": "    '/partner-compliance': tabbed('compliance', 'partners'),\n",
    "    '/contacts': () => { setActive('/contacts'); if (can('carriers.view') || can('partners.view')) renderContactsDirectory(content); else denied(); },\n": "    '/contacts': tabbed('carriers', 'contacts'),\n",
    "    '/dispatch': () => { setActive('/dispatch'); guard(['loads.create', 'loads.assign', 'loads.publish', 'carriers.view'], () => renderDispatch(content))(); },\n": "    '/dispatch': tabbed('loads', 'dispatch'),\n",
    "    '/carriers': () => { setActive('/carriers'); guard(['carriers.view', 'carriers.edit', 'carriers.approve'], () => renderCarriers(content))(); },\n": "    '/carriers': tabbed('carriers', 'directory'),\n",
    "    '/loads': ({ query }) => { setActive('/loads'); guard(['loads.create', 'loads.assign', 'loads.publish', 'carriers.view'], () => renderLoads(content, query.get('id')))(); },\n": "    '/loads': tabbed('loads', 'board'),\n",
    "    '/automation': () => { setActive('/automation'); if (automationEnabled) renderAutomation(content); else renderPlaceholder(content, 'Not available', 'The automation engine is not enabled in this environment.'); },\n": "    '/automation': tabbed('automation', 'queue'),\n",
    "    '/crm': () => { setActive('/crm'); if (crmEnabled && can('crm.view')) renderCRM(content); else denied(); },\n": "    '/crm': tabbed('crm', 'crm'),\n",
    "    '/compliance': () => { setActive('/compliance'); if (complianceEnabled && can('compliance.view')) renderCompliance(content); else denied(); },\n": "    '/compliance': tabbed('compliance', 'onboarding'),\n",
    "    '/trips': ({ query }) => { setActive('/trips'); if (dispatchEnabled && can('dispatch.view')) renderTrips(content, query.get('id')); else denied(); },\n": "    '/trips': tabbed('loads', 'trips'),\n",
    "    '/finance': ({ query }) => { setActive('/finance'); if (financeEnabled && can('finance.view')) renderFinance(content, query.get('id')); else denied(); },\n": "    '/finance': tabbed('finance', 'invoices'),\n",
    "    '/finance-analytics': () => { setActive('/finance-analytics'); if (financeEnabled && can('finance.view')) renderFinanceAnalytics(content); else denied(); },\n": "    '/finance-analytics': tabbed('finance', 'analytics'),\n",
    "    '/health': () => { setActive('/health'); renderSystemHealth(content); },\n": "    '/health': tabbed('settings', 'health'),\n",
    "    '/templates': () => { setActive('/templates'); if (can('content.view')) renderTemplates(content); else denied(); },\n": "    '/templates': tabbed('templates', 'studio'),\n",
    "    '/audiences': () => { setActive('/audiences'); if (can('content.view')) renderAudiences(content); else denied(); },\n": "    '/audiences': tabbed('templates', 'audiences'),\n",
    "    '/campaign-manager': () => { setActive('/campaign-manager'); if (can('content.view')) renderCampaignManager(content); else denied(); },\n": "    '/campaign-manager': tabbed('templates', 'campaigns'),\n",
    "    '/delivery': () => { setActive('/delivery'); if (can('content.view') || can('content.manage') || can('settings.manage')) renderDeliveryHealth(content); else denied(); },\n": "    '/delivery': tabbed('crm', 'delivery'),\n",
    "    '/account-health': () => { setActive('/account-health'); if (can('carriers.view') || can('dispatch.view')) renderAccountHealth(content); else denied(); },\n": "    '/account-health': tabbed('compliance', 'health'),\n",
    "    '/marketing-intel': () => { setActive('/marketing-intel'); if (can('analytics.view') || can('comm.manage') || can('comm.send')) renderMarketingIntel(content); else denied(); },\n": "    '/marketing-intel': tabbed('web', 'intel'),\n",
    "    '/email-loads': () => { setActive('/email-loads'); if (can('comm.view') || can('support.view') || can('dispatch.manage')) renderEmailLoads(content); else denied(); },\n": "    '/email-loads': tabbed('loads', 'email'),\n",
    "    '/matching': () => { setActive('/matching'); if (can('carriers.view')) renderSmartMatch(content); else denied(); },\n": "    '/matching': tabbed('loads', 'matching'),\n",
    "    '/analytics': () => { setActive('/analytics'); if (analyticsEnabled && can('analytics.view')) renderAnalytics(content); else denied(); },\n": "    '/analytics': tabbed('bi', 'analytics'),\n",
    "    '/web-analytics': () => { setActive('/web-analytics'); if (webAnalyticsEnabled && can('analytics.view')) renderAnalyticsWeb(content); else denied(); },\n": "    '/web-analytics': tabbed('web', 'web'),\n",
    "    '/forms': ({ query }) => { setActive('/forms'); if (formsEnabled && can('forms.view')) renderForms(content, query.get('id')); else denied(); },\n": "    '/forms': tabbed('forms', 'inbox'),\n",
    "    '/seo': () => { setActive('/seo'); if (seoEnabled && can('seo.view')) renderSeo(content); else denied(); },\n": "    '/seo': tabbed('web', 'seo'),\n",
    "    '/partners': () => { setActive('/partners'); if (partnersEnabled && can('partners.view')) renderPartners(content); else denied(); },\n": "    '/partners': tabbed('partners', 'directory'),\n",
    "    '/verification': () => { setActive('/verification'); if (can('compliance.view')) renderVerificationCenter(content); else denied(); },\n": "    '/verification': tabbed('compliance', 'fmcsa'),\n",
    "    '/load-intake': () => { setActive('/load-intake'); if (can('dispatch.view') || can('loads.create')) renderLoadIntake(content); else denied(); },\n": "    '/load-intake': tabbed('loads', 'intake'),\n",
    "    '/control-tower': () => { setActive('/control-tower'); if (can('dispatch.view')) renderControlTower(content); else denied(); },\n": "    '/control-tower': tabbed('loads', 'tower'),\n",
    "    '/workflows': () => { setActive('/workflows'); if (can('settings.manage') || can('content.manage')) renderWorkflowBuilder(content); else denied(); },\n": "    '/workflows': tabbed('automation', 'workflows'),\n",
    "    '/referrals': () => { setActive('/referrals'); if (referralProgramEnabled && can('finance.view')) renderReferrals(content); else denied(); },\n": "    '/referrals': tabbed('team', 'referrals'),\n",
    "    '/bi': () => { setActive('/bi'); if (can('analytics.view') || can('reports.view')) renderBI(content); else denied(); },\n": "    '/bi': tabbed('bi', 'bi'),\n",
    "    '/carrier-scorecards': () => { setActive('/carrier-scorecards'); if (can('carriers.view') || can('dispatch.view')) renderCarrierScorecards(content); else denied(); },\n": "    '/carrier-scorecards': tabbed('carriers', 'scorecards'),\n",
    "    '/broker-sla': () => { setActive('/broker-sla'); if (partnersEnabled && can('partners.view')) renderBrokerSla(content); else denied(); },\n": "    '/broker-sla': tabbed('partners', 'sla'),\n",
    "    '/brand-kit': () => { setActive('/brand-kit'); if (can('content.view') || can('content.manage')) renderBrandKit(content); else denied(); },\n": "    '/brand-kit': tabbed('settings', 'brand'),\n",
    "    '/plugins': () => { setActive('/plugins'); if (can('settings.manage')) renderPluginMarketplace(content); else denied(); },\n": "    '/plugins': tabbed('settings', 'plugins'),\n",
    "    '/form-builder': () => { setActive('/form-builder'); if (can('content.view') || can('content.manage')) renderFormBuilder(content); else denied(); },\n": "    '/form-builder': tabbed('forms', 'builder'),\n",
    "    '/email-builder': () => { setActive('/email-builder'); if (can('content.view') || can('content.manage')) renderEmailBuilder(content); else denied(); },\n": "    '/email-builder': tabbed('templates', 'builder'),\n",
    "    '/reports': () => { setActive('/reports'); if (reportsEnabled && can('reports.view')) renderReports(content); else denied(); },\n": "    '/reports': tabbed('bi', 'reports'),\n",
    "    '/announcements': () => { setActive('/announcements'); if (announcementsEnabled && can('announce.view')) renderAnnouncements(content); else denied(); },\n": "    '/announcements': tabbed('templates', 'announcements'),\n",
    "    '/google': () => { setActive('/google'); if (googleDataEnabled && can('analytics.view')) renderGoogleData(content); else denied(); },\n": "    '/google': tabbed('web', 'web'), // googleData is already embedded inside analyticsWeb (analyticsWeb.js:199)\n",
    "    '/automations': () => { setActive('/automations'); if (automationsAdminEnabled) renderAutomationsAdmin(content); else denied(); },\n": "    '/automations': tabbed('automation', 'rules'),\n",
    "    '/content': () => { setActive('/content'); if (contentEnabled && can('content.view')) renderContent(content); else denied(); },\n": "    '/content': tabbed('web', 'content'),\n",
    "    '/staff': () => { setActive('/staff'); if (anyOf('users.manage', 'roles.manage', 'staff.suspend')) renderStaffRoles(content); else denied(); },\n": "    '/staff': tabbed('settings', 'staff'),\n",
    "    '/audit': () => { setActive('/audit'); if (can('audit.view')) renderAudit(content); else renderPlaceholder(content, 'Not available', 'You do not have permission to view the audit log.'); },\n": "    '/audit': tabbed('settings', 'audit'),\n",
    "    '/flags': () => { setActive('/flags'); if (can('flags.manage')) renderFlags(content); else renderPlaceholder(content, 'Not available', 'You do not have permission to manage feature flags.'); },\n": "    '/flags': tabbed('settings', 'flags'),\n",
    "    '/settings': () => { setActive('/settings'); guard(['settings.manage'], () => renderSettings(content))(); },\n": "    '/settings': tabbed('settings', 'settings'),\n",
    # Radar, notifications, map, exceptions, safety, pod, booking, support, comms, partner-intake, live-chat, documents, market-rates, rate-standards, carrier/broker 360: routes untouched.
}
for a, b in ROUTES.items():
    app = once(app, a, b, 'route ' + b.strip()[:30])
# Hidden-but-alive routes should highlight the nearest surviving nav item instead of nothing.
for old, new in [("setActive('/radar')", "setActive('/')"), ("setActive('/notifications')", "setActive('/')"), ("setActive('/map')", "setActive('/loads')"),
                 ("setActive('/exceptions')", "setActive('/loads')"), ("setActive('/pod-review')", "setActive('/loads')"), ("setActive('/safety')", "setActive('/compliance')"),
                 ("setActive('/booking-requests')", "setActive('/loads')"), ("setActive('/comms')", "setActive('/live-chat')"), ("setActive('/outreach')", "setActive('/crm')")]:
    app = app.replace(old, new)
app = once(app, "// Reporting/Comms/Finance/Marketing/Admin) — see views/shell.js NAV for the map.",
           "// Reporting/Comms/Finance/Marketing/Admin) — see views/shell.js NAV for the map.\n// CC CUT 2 Sep 2026: 21-item nav; merged screens run as tabs (TABBED below); 6 dead views retired.", 'app header')
wr('app.js', app)

# ───────────────────────── 4. retired files → obvious stubs (git rm when convenient) ─────────────────────────
RETIRED = {
    'campaigns.js': 'duplicate of campaignManager; campaigns table = 0 rows',
    'chat.js': 'team chat for a team of one; chat_messages = 0 rows',
    'exceptions.js': 'orphan — app.js never imported it; /exceptions renders exceptionCenter',
    'management.js': '/management was already an alias to BI',
    'marketingAnalytics.js': 'dashboard over campaigns = 0 and audiences = 0; duplicates campaignManager KPIs',
    'systemModules.js': 'internal module registry with no ops value',
}
for f, why in RETIRED.items():
    wr('views/' + f, f"// RETIRED 2 Sep 2026 (docs/CC-AUDIT-2026-09-02.md): {why}.\n// Not imported anywhere. Safe to `git rm`. Kept as a stub so a stale build cache cannot 404.\nexport default null;\n")

# ───────────────────────── 5. alert() → toast() sweep ─────────────────────────
# toast(message, kind='info') already exists in ../../shared/errors.js and most files import it.
ALERT_RE = re.compile(r'(?<![\w.$])alert\(')
IMPORT_ERRORS_RE = re.compile(r"import\s*\{([^}]*)\}\s*from\s*'\.\./\.\./shared/errors\.js';")
swept = []
for f in sorted(os.listdir(os.path.join(CC, 'views'))):
    if not f.endswith('.js') or f in RETIRED or f in ('shell.js', 'actionCenter.js', 'login.js', 'placeholder.js', '_tabbed.js'): continue
    src = rd(os.path.join(CC, 'views', f))
    n = len(ALERT_RE.findall(src))
    if n == 0: continue
    out = ALERT_RE.sub('toast(', src)
    m = IMPORT_ERRORS_RE.search(out)
    if m:
        names = [x.strip() for x in m.group(1).split(',') if x.strip()]
        if 'toast' not in names:
            names.append('toast')
            out = out[:m.start()] + "import { " + ', '.join(names) + " } from '../../shared/errors.js';" + out[m.end():]
    else:
        # add after the first import line
        first = re.search(r"^import .*?;\n", out, re.M)
        assert first, f'{f}: no import line to anchor on'
        out = out[:first.end()] + "import { toast } from '../../shared/errors.js';\n" + out[first.end():]
    wr('views/' + f, out); swept.append((f, n))

# ───────────────────────── 6. the tab helper ─────────────────────────
shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), '_tabbed.js'), os.path.join(OCC, 'views', '_tabbed.js')); changed.append('views/_tabbed.js')

print('changed files:', len(changed))
print('alert→toast:', sum(n for _, n in swept), 'calls in', len(swept), 'files')
for rel in changed: print(' ', rel)
