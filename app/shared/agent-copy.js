// bl_comp_0503 — COI "approved, agent copy pending" (owner decision 30 Sep 2026).
// Its own module so it does not collide with parallel edits to api.js.
import { getClient } from './supabaseClient.js';

async function call(name, args) {
  const sb = await getClient();
  const { data, error } = await sb.rpc(name, args || {});
  if (error) { const e = new Error(error.message || ('rpc ' + name + ' failed')); e.code = error.code; e.rpc = name; throw e; }
  return data;
}

export const approveAgentCopy = (o = {}) => call('cc_compliance_approve_agent_copy', {
  p_carrier: o.carrier, p_requirement_key: o.requirement, p_expiry: o.expiry,
  p_agent: o.agent ?? null, p_note: o.note ?? null, p_days: o.days ?? 14 });
export const agentCopyReceived = (carrier, requirement, note) => call('cc_compliance_agent_copy_received', {
  p_carrier: carrier, p_requirement_key: requirement, p_note: note ?? null });
export const agentCopyList = (carrier) => call('cc_agent_copy_list', { p_carrier: carrier ?? null });
