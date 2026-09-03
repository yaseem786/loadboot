// STUB supabase client for the Playwright harness — records every rpc into window.__rpcCalls
window.__rpcCalls = [];
window.__state = { screening: null, agreement: false, agent: null, trust_tier: 'new', fmcsaVerify: { found: true } };
const user = { id: 'u1', email: 'broker@test.com', user_metadata: { partner_kind: 'broker', name: 'Test Broker' } };
const session = { user, access_token: 'x' };
function trust() {
  const s = window.__state;
  const scr = s.screening;
  const tier = s.agent ? (s.agent.confirmed_at ? 'agent_confirmed' : (scr && scr.outcome === 'pass' ? 'agent_pending' : 'new')) : (scr && scr.outcome === 'pass' ? 'screened' : 'new');
  const can = (tier === 'screened' || tier === 'agent_confirmed') && s.agreement;
  return { has_org: true, org: 'o1', company: 'Test Tier Brokerage', kind: 'broker', org_status: 'pending', mc: scr && scr.mc || null, tier, can_post: can,
    reason: can ? null : (tier === 'new' ? (scr ? (scr.outcome === 'pending' ? 'FMCSA screening is running — usually under a minute.' : 'FMCSA screening did not pass: ' + (scr.reason||'')) : 'Enter your broker MC number so we can screen it against FMCSA.') : tier === 'agent_pending' ? 'Waiting for Parent Freight LLC to confirm you post under their authority (one-click email sent to their FMCSA contact).' : 'Accept the LoadBoot Master Broker Agreement (one click) before posting.'),
    posting_limit: 3, active_postings: 0, agreement_ok: s.agreement, first_delivered: false, screening: scr, agent: s.agent, hold_reason: null,
    packet: [], packet_required_total: 8, packet_required_done: 0 };
}
const RPC = {
  cc_partner_overview: () => ({ kind: 'broker', org: 'o1', company: 'Test Tier Brokerage', loads_submitted: 0, loads_open: 0, loads_posted: 0, status: 'pending', onboarded: false, onboarding_pending: 8 }),
  partner_trust_status: () => trust(),
  partner_broker_screen: (a) => { window.__state.screening = { outcome: 'pending', pending: true, mc: a.p_mc }; setTimeout(() => { window.__state.screening = { outcome: 'pass', pending: false, mc: a.p_mc, legal_name: 'TEST TIER BROKERAGE LLC', broker_authority: true, carrier_authority: false, source: 'fmcsa-li', checked_at: new Date().toISOString() }; }, 1500); return { queued: true, outcome: 'pending' }; },
  partner_agent_declare: (a) => { window.__state.agent = { parent_mc: a.p_parent_mc, parent_legal_name: a.p_parent_company, contact_email: a.p_contact_email, contact_source: a.p_contact_email ? 'agent_supplied' : null, sent_at: null, confirmed_at: null, declined_at: null }; window.__state.screening = { outcome: 'pending', pending: true, mc: a.p_parent_mc }; setTimeout(() => { window.__state.screening = { outcome: 'pass', pending: false, mc: a.p_parent_mc, legal_name: 'PARENT FREIGHT LLC', broker_authority: true, source: 'fmcsa-li', checked_at: new Date().toISOString() }; window.__state.agent.sent_at = new Date().toISOString(); window.__state.agent.contact_email = 'compliance@parentfreight.test'; window.__state.agent.contact_source = 'fmcsa'; }, 1500); return { queued: true, outcome: 'pending' }; },
  cc_current_agreement: () => ({ kind: 'broker_carrier', available: true, version: 1, title: 'LoadBoot Master Broker Agreement', body_md: 'MASTER BROKER AGREEMENT — test body.', accepted: window.__state.agreement }),
  cc_accept_agreement: () => { window.__state.agreement = true; return { ok: true }; },
  cc_my_onboarding_packet: () => ({ items: [], complete: false }),
  cc_partner_register: () => ({ org: 'o1', kind: 'broker', existing: false }),
  is_my_org_agent: () => false, all_flags: () => ({}), get_public_market_rates: () => [], cc_lane_rate: () => null, cc_partner_notifications: () => [], cc_partner_my_loads: () => [], cc_partner_claims: () => [], cc_book_requests_queue: () => [], cc_broker_shipment_inbox: () => [], cc_partner_carrier_directory: () => [], cc_my_approved_partners: () => [], cc_my_rating: () => ({ count: 0 }), pay_due_items: () => ({ payables: [] }), cc_partner_rateable_trips: () => [], my_devices: () => [], cc_partner_get_profile: () => ({}), cc_get_payment_instructions: () => ({}), cc_my_avatar: () => null, my_account_deletion_status: () => null, device_seen: () => null,
};
const sb = {
  auth: {
    getSession: async () => ({ data: { session }, error: null }),
    getUser: async () => ({ data: { user }, error: null }),
    onAuthStateChange: (cb) => ({ data: { subscription: { unsubscribe() {} } } }),
    mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' }, error: null }), listFactors: async () => ({ data: { totp: [] }, error: null }) },
    signOut: async () => ({ error: null }),
  },
  rpc: async (name, args) => { window.__rpcCalls.push({ name, args }); const f = RPC[name]; if (!f) return { data: Array.isArray(args) ? [] : (name.startsWith('cc_partner_') || name.startsWith('pay') ? [] : {}), error: null }; try { return { data: f(args || {}), error: null }; } catch (e) { return { data: null, error: { message: String(e) } }; } },
  from: () => ({ select: async () => ({ data: [], error: null }) }),
  channel: () => { const c = { on() { return c; }, subscribe() { return c; }, send: async () => {}, track: async () => {}, unsubscribe() {} }; return c; },
  removeChannel() {},
  storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), createSignedUrl: async () => ({ data: { signedUrl: '#' }, error: null }) }) },
  functions: { invoke: async () => ({ data: {}, error: null }) },
};
export function getClient() { return Promise.resolve(sb); }
export default getClient;
RPC.cc_broker_trust_queue = () => [
 { org_id:'a', name:'Ali Agent Desk', org_status:'pending', mc_number:null, created_at:new Date(Date.now()-3600e3).toISOString(), owner_email:'ali@x.com', tier:'agent_pending', can_post:false, reason:'Waiting for Parent Freight LLC to confirm you post under their authority (one-click email sent to their FMCSA contact).', posting_limit:3, active_postings:0, agreement_ok:false, first_delivered:false, screening:'pass', fmcsa_legal_name:'PARENT FREIGHT LLC', authority_source:'fmcsa-li', screened_at:new Date().toISOString(), domain_match:false, is_agent:true, parent_mc:'777888', parent_legal_name:'Parent Freight LLC', parent_contact_email:'compliance@parentfreight.test', parent_contact_source:'fmcsa', parent_confirm_sent_at:new Date().toISOString(), loads_total:0, loads_awaiting_review:0, packet_done:0, packet_total:8 },
 { org_id:'b', name:'Liberty Solution Logistics', org_status:'pending', mc_number:'998877', created_at:new Date(Date.now()-86400e3*40).toISOString(), owner_email:'ops@liberty.com', tier:'screened', can_post:true, reason:null, posting_limit:3, active_postings:2, agreement_ok:true, first_delivered:false, screening:'pass', fmcsa_legal_name:'LIBERTY SOLUTION LOGISTICS LLC', authority_source:'fmcsa-safer', screened_at:new Date().toISOString(), domain_match:true, is_agent:false, loads_total:2, loads_awaiting_review:1, packet_done:1, packet_total:8 },
 { org_id:'c', name:'DKR Trucking (typo)', org_status:'pending', mc_number:'322451', created_at:new Date().toISOString(), owner_email:'dkr@gmail.com', tier:'new', can_post:false, reason:'FMCSA screening did not pass: SAFER shows carrier authority', posting_limit:3, active_postings:0, agreement_ok:false, first_delivered:false, screening:'fail', screening_reason:'FMCSA SAFER shows this entity is authorized as a carrier, not a broker.', fmcsa_legal_name:'DKR TRUCKING LLC', authority_source:'fmcsa-safer', screened_at:new Date().toISOString(), is_agent:false, loads_total:0, packet_done:0, packet_total:8 },
];
RPC.cc_broker_trust_set = () => ({ ok: true });
