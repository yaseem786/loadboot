window.__rpcCalls = [];
const now = () => new Date().toISOString();
const S = window.__stub = { has_org: true, tier: 'agent_pending', identity: null, screening: { outcome: 'pass', mc: '700002', legal_name: 'ACME FREIGHT LLC', pending: false },
  agent: { parent_mc: '700002', parent_legal_name: 'ACME FREIGHT LLC', sent_at: now(), contact_source: 'fmcsa' }, can_post: false, reason: 'Waiting for ACME FREIGHT LLC to confirm', posting_limit: 3, active_postings: 0, agreement_ok: false, packet_required_done: 0, packet_required_total: 8,
  parents: [
    { id: 'p1', mc: '700002', name: 'ACME FREIGHT LLC', status: 'pending', on_loadboot: false, has_fmcsa_email: true, fmcsa_domain: 'acmefreight.com', sent_to: 'ops@acmefreight.com, dispatch@acmefreight.com', sent_at: now(), contact_source: 'fmcsa', code_live: true, open: 0, loads: 0 },
    { id: 'p2', mc: '700001', name: 'BIG BROKER LLC', status: 'pending', on_loadboot: true, loadboot_name: 'Big Broker LLC', has_fmcsa_email: true, sent_to: 'owner@bigbroker.com, ops@bigbroker.com', sent_at: now(), contact_source: 'loadboot', code_live: true, open: 0, loads: 0 },
    { id: 'p3', mc: '700003', name: 'GHOST LOGISTICS INC', status: 'pending', on_loadboot: false, has_fmcsa_email: false, fmcsa_domain: null, sent_to: null, sent_at: null, contact_source: null, code_live: false, open: 0, loads: 0 },
    { id: 'p4', mc: '700004', name: 'OLD CO', status: 'revoked', revoked_at: now(), revoked_by: 'owner@old.com', open: 0, loads: 3 },
  ] };
const rec = (name, args) => { window.__rpcCalls.push({ name, args }); };
export const partnerTrustStatus = async () => { rec('partner_trust_status'); return JSON.parse(JSON.stringify(S)); };
export const partnerBrokerScreen = async () => ({ queued: true });
export const partnerAgentDeclare = async (a, b, c) => { rec('partner_agent_declare', { a, b, c }); const ex = S.parents.find((p) => p.mc === a); if (ex) { ex.status = 'screening'; } else S.parents.push({ id: 'p' + (S.parents.length + 1), mc: a, name: b, status: 'screening', has_fmcsa_email: true }); return { queued: true, parent_id: 'px' }; };
export const currentAgreement = async () => ({ available: true, version: 3, title: 'Master Broker Agreement', body_md: 'terms…', accepted: false });
export const acceptAgreement = async () => ({ ok: true });
export const fmcsaVerify = async () => null;
export const partnerIdentityResend = async () => ({ sent: true });
export const partnerIdentityRequestCall = async () => ({ ok: true });
export const partnerAgentsList = async () => { rec('partner_agents_list'); return { agents: [ { org_id: 'a', parent_id: 'p2', name: 'Alex Agency', email: 'agent@gmail.com', since: now(), status: 'pending', tier: 'agent_confirmed', loads: 0, open: 0, other_brokerages: 1 }, { org_id: 'b', parent_id: 'p9', name: 'Old Agent', email: 'o@x.com', since: now(), status: 'revoked', revoked_at: now(), tier: 'agent_confirmed', loads: 3, open: 0, other_brokerages: 0 } ], invites: [] }; };
export const partnerAgentDecide = async (o, d, n) => { rec('partner_agent_decide', { o, d, n }); return { ok: true }; };
export const partnerAgentInvite = async () => ({ ok: true });
export const partnerAgentInviteRevoke = async () => ({ ok: true });
export const partnerVerifyCall = async (purpose) => { rec('partner_verify_call', { purpose }); return { ok: false, why: 'no call' }; };
export const partnerVerifyCode = async (code) => { rec('partner_verify_code', { code }); if (code !== '123456') return { ok: false, why: 'That code does not match. Check the email your brokerage received (codes are 6 digits, valid 7 days).' }; const p = S.parents.find((x) => x.id === 'p1'); p.status = 'confirmed'; p.confirmed_at = now(); p.confirmed_by = 'code from the confirmation email (o**@acmefreight.com)'; S.tier = 'agent_confirmed'; S.can_post = true; return { ok: true, tier: S.tier, parent_id: 'p1', parent: 'ACME FREIGHT LLC · MC-700002' }; };
export const partnerAgentParentRemove = async (id) => { rec('partner_agent_parent_remove', { id }); S.parents = S.parents.filter((p) => p.id !== id); return { ok: true }; };
export const partnerAgentParentResend = async (id) => { rec('partner_agent_parent_resend', { id }); return { sent: true, to: ['o**@acmefreight.com'] }; };
