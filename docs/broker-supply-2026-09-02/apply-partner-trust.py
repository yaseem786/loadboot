#!/usr/bin/env python3
"""apply-partner-trust.py — idempotent patcher for the broker tiered-trust UI (bl_bp_0312).
Edits app/partner/app.js (5 edits) + app/shared/api.js (1 block). Re-runs safely on any base.
Refuses to run if an anchor is missing (never patches blind)."""
import re, sys, pathlib
ROOT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else '.')
APP = ROOT / 'app/partner/app.js'
API = ROOT / 'app/shared/api.js'

def patch(path, edits):
    s = path.read_text(encoding='utf-8')
    n = 0
    for key, old, new in edits:
        if key in s:
            print(f'  = {path.name}: {key} already applied'); continue
        if s.count(old) != 1:
            raise SystemExit(f'ABORT {path.name}: anchor for {key} found {s.count(old)}x (need exactly 1)')
        s = s.replace(old, new); n += 1
        print(f'  + {path.name}: {key}')
    path.write_text(s, encoding='utf-8')
    return n

# ---------------- api.js ----------------
api_edits = [(
  'partnerTrustStatus',
  "export const partnerRegister = (kind, company, mc) => rpc('cc_partner_register', { p_kind: kind, p_company: company, p_mc: mc ?? null });",
  "export const partnerRegister = (kind, company, mc) => rpc('cc_partner_register', { p_kind: kind, p_company: company, p_mc: mc ?? null });\n"
  "// bl_bp_0312 — broker tiered trust (screen in seconds, documents later)\n"
  "export const partnerBrokerScreen = (mc, dot) => rpc('partner_broker_screen', { p_mc: mc ?? null, p_dot: dot ?? null });\n"
  "export const partnerAgentDeclare = (parentMc, parentCompany, contactEmail) => rpc('partner_agent_declare', { p_parent_mc: parentMc, p_parent_company: parentCompany ?? null, p_contact_email: contactEmail ?? null });\n"
  "export const partnerTrustStatus = () => rpc('partner_trust_status');\n"
  "export const partnerAgentConfirmGet = (token) => rpc('partner_agent_confirm_get', { p_token: token });\n"
  "export const partnerAgentConfirm = (token, decision, name, note) => rpc('partner_agent_confirm', { p_token: token, p_decision: decision, p_name: name ?? null, p_note: note ?? null });\n"
  "export const ccBrokerTrustQueue = () => rpc('cc_broker_trust_queue');\n"
  "export const ccBrokerTrustSet = (org, action, note) => rpc('cc_broker_trust_set', { p_org: org, p_action: action, p_note: note ?? null });\n"
)]

# ---------------- app.js ----------------
app_edits = [
(
  "from './broker-trust.js'",
  "import { renderFmcsaOnly } from '../carrier/profile-view.js';",
  "import { renderFmcsaOnly } from '../carrier/profile-view.js';\nimport { mountBrokerTrust, kickoffScreening } from './broker-trust.js';\nimport { partnerTrustStatus } from '../shared/api.js';",
),
# signup: agent option + parent fields
(
  "opt('agent', 'Broker Agent'",
  "        opt('facility', 'Facility / Warehouse', 'Schedule dock appointments and manage check-ins.'),\n      ]),\n      mcWrap,",
  "        opt('facility', 'Facility / Warehouse', 'Schedule dock appointments and manage check-ins.'),\n"
  "        opt('agent', 'Broker Agent', 'Post under the brokerage you work for — they confirm you with one click.'),\n"
  "      ]),\n      mcWrap, agentWrap,",
),
(
  "const agentWrap =",
  "  const showMc = (kind) => { mcWrap.style.display = (kind === 'broker') ? 'block' : 'none'; };",
  "  // bl_bp_0312 — agents post under a parent brokerage's authority (no own MC).\n"
  "  const agMc = h('input', { class: 'cp-in', type: 'text', placeholder: 'Brokerage MC number', inputmode: 'numeric', autocomplete: 'off' });\n"
  "  const agCo = h('input', { class: 'cp-in', type: 'text', placeholder: 'Brokerage legal name', style: 'margin-top:8px' });\n"
  "  const agEm = h('input', { class: 'cp-in', type: 'email', placeholder: 'Their compliance / ops email (optional)', style: 'margin-top:8px' });\n"
  "  const agentWrap = h('div', { style: 'display:none;margin-top:12px' }, [agMc, agCo, agEm,\n"
  "    h('div', { class: 'cp-row-s', style: 'margin-top:6px;color:#94a3b8' }, 'We screen the brokerage on FMCSA, then email their FMCSA-listed contact one link to confirm you. Loads you post show their name and MC.')]);\n"
  "  const showMc = (kind) => { mcWrap.style.display = (kind === 'broker') ? 'block' : 'none'; agentWrap.style.display = (kind === 'agent') ? 'block' : 'none'; };",
),
(
  "kickoffScreening(",
  "    btn.disabled = true; btn.textContent = 'Setting up…';\n    try { await partnerRegister(chosen, company.value.trim(), mcDigits || null); appView(user); }",
  "    let agentInfo = null;\n"
  "    if (chosen === 'agent') {\n"
  "      const pm = String(agMc.value || '').replace(/[^0-9]/g, '');\n"
  "      if (!pm) { err.textContent = 'Enter the MC number of the brokerage you post for.'; btn.disabled = false; return; }\n"
  "      if (!agCo.value.trim()) { err.textContent = 'Enter the brokerage legal name.'; btn.disabled = false; return; }\n"
  "      agentInfo = { parentMc: pm, parentCompany: agCo.value.trim(), contactEmail: agEm.value.trim() || null };\n"
  "    }\n"
  "    const regKind = chosen === 'agent' ? 'broker' : chosen;\n"
  "    btn.disabled = true; btn.textContent = 'Setting up…';\n"
  "    try { await partnerRegister(regKind, company.value.trim(), mcDigits || null); await kickoffScreening(regKind, mcDigits, agentInfo); appView(user); }",
),
# dashboard: trust gate replaces verifyGateCard for brokers; unfolds the post form when can_post flips
(
  "trustGateHost",
  "      mount(bContent, h('div', null, [bdHero(), bdRate9, obHero, bdAttention(), payablesCard(), bdKpis(), h('div', { id: 'bd-postload' }, [ov.onboarded ? (postFoldOpen ?",
  "      const trustGate = () => { const trustGateHost = h('div'); mountBrokerTrust(trustGateHost, { goPacket: () => bgo('onboarding'), goPost: () => { __trustCanPost = true; postFoldOpen = true; brender(); }, onStatus: (s9) => { if (s9 && s9.can_post && !__trustCanPost) { __trustCanPost = true; brender(); } } }); return trustGateHost; };\n"
  "      mount(bContent, h('div', null, [bdHero(), bdRate9, obHero, bdAttention(), payablesCard(), bdKpis(), h('div', { id: 'bd-postload' }, [(ov.onboarded || (ov.kind === 'broker' && __trustCanPost)) ? (postFoldOpen ?",
),
(
  "let __trustCanPost",
  "async function brokerDash(user, ov) {",
  "async function brokerDash(user, ov) {\n  // bl_bp_0312: FMCSA-screened brokers post before the packet is verified.\n  let __trustCanPost = false;\n  if (ov.kind === 'broker' && !ov.onboarded) { try { const t9 = await partnerTrustStatus(); __trustCanPost = !!(t9 && t9.can_post); } catch (_) {} }",
),
(
  "postFoldBanner()) : (ov.kind === 'broker' ? trustGate() : verifyGateCard(ov))",
  "postFoldBanner()) : verifyGateCard(ov)]), myLoadsCard, bdNetwork(), bdActivity()]));",
  "postFoldBanner()) : (ov.kind === 'broker' ? trustGate() : verifyGateCard(ov))]), myLoadsCard, bdNetwork(), bdActivity()]));",
),
# onboarding hero: honest wording for a screened-but-not-verified broker
(
  "Cleared to post — verification lifts your limits",
  "    else if (sub.length) mount(obHero, mk('#0883F7', '⏳', '#eff6ff', '#1d4ed8', 'Onboarding under review', '#1d4ed8', sub.length + ' item(s) with our team — you\\u2019ll be notified as each is verified (usually within 1 business day).', 'Track status →'));",
  "    else if (ov.kind === 'broker' && __trustCanPost) mount(obHero, mk('#0883F7', '🛡', '#eff6ff', '#1d4ed8', 'Cleared to post — verification lifts your limits', '#1d4ed8', 'Your broker authority is verified live on FMCSA. Post now (limited open postings); the verification packet unlocks unlimited postings and instant booking for carriers.', 'Verification packet →'));\n"
  "    else if (sub.length) mount(obHero, mk('#0883F7', '⏳', '#eff6ff', '#1d4ed8', 'Onboarding under review', '#1d4ed8', sub.length + ' item(s) with our team — you\\u2019ll be notified as each is verified (usually within 1 business day).', 'Track status →'));",
),
(
  "Finish onboarding to start posting' — bl_bp_0312 wording",
  "    else mount(obHero, mk('#d97706', '📋', '#fef3c7', '#b45309', 'Finish onboarding to start posting', '#b45309', 'A few required items are still missing — the guided steps take about 10 minutes.', 'Start →'));",
  "    else if (ov.kind === 'broker') mount(obHero, mk('#0883F7', '⚡', '#eff6ff', '#1d4ed8', 'Post your first load in minutes', '#1d4ed8', 'Screen your broker authority live on FMCSA — no documents to start. The verification packet comes later, only where it matters.', 'Start →')); /* 'Finish onboarding to start posting' — bl_bp_0312 wording */\n"
  "    else mount(obHero, mk('#d97706', '📋', '#fef3c7', '#b45309', 'Finish onboarding to start posting', '#b45309', 'A few required items are still missing — the guided steps take about 10 minutes.', 'Start →'));",
),
]

print('api.js'); patch(API, api_edits)
print('app.js'); patch(APP, app_edits)
print('done')
