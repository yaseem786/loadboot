// entityLink.js — ONE place that knows which Command Center screen owns an entity.
//
// Before bl_bp_0455 every view built its own '#/carrier?id=' / '#/broker?id=' string (automation.js RELGO,
// actionCenter.js linkFor, accountHealth.js orgLink, deletionRequests.js orgHref, contactsDirectory.js …) and
// they disagreed: contactsDirectory dropped the partner id, brokerSla sent every row to the directory tab,
// shippers landed on a broker screen. Build the href here; render it anywhere.
//
// Partner roles (bl_bp_0455): 'broker' (own MC) → #/broker, 'agent' (broker agent under a brokerage) →
// #/broker-agent, 'shipper' → #/shipper, 'facility' → #/broker (no 360 of its own yet). All three partner
// routes render the same dispatcher, which reads the role from the server and shows the right 360 — so a
// stale link (e.g. #/broker?id= for an agent) still lands on the right screen; the hash is then normalised.

export function partnerRoute(role, isAgent) {
  const r = role || (isAgent ? 'agent' : 'broker');
  if (r === 'agent') return '/broker-agent';
  if (r === 'shipper') return '/shipper';
  return '/broker';
}

// row: anything with { id | org_id, kind, role?, is_agent? }
export function partnerHref(row) {
  const id = row && (row.org_id || row.id);
  if (!id) return '#/partners';
  const role = row.role || (row.is_agent ? 'agent' : row.kind === 'shipper' ? 'shipper' : row.kind === 'facility' ? 'facility' : 'broker');
  return '#' + partnerRoute(role) + '?id=' + id;
}

export function carrierHref(id) { return id ? '#/carrier?id=' + id : '#/carriers'; }

// Any organization row: { id, kind, role?, is_agent? }
export function orgHref(row) {
  if (!row) return '#/';
  if (row.kind === 'carrier') return carrierHref(row.id || row.org_id);
  if (row.kind === 'internal') return '#/settings';
  return partnerHref(row);
}

// kind + id only (legacy call sites)
export function orgHrefFor(kind, id, isAgent) { return orgHref({ kind, id, is_agent: !!isAgent }); }

export const ROLE_LABEL = { broker: 'Freight broker', agent: 'Broker agent', shipper: 'Shipper', facility: 'Facility', carrier: 'Carrier' };

export default { partnerRoute, partnerHref, carrierHref, orgHref, orgHrefFor, ROLE_LABEL };
