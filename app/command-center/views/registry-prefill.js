// registry-prefill.js — bl_ship_0502. Pre-fills the staff "State registry check" card from a state's FREE open-data
// business registry (Socrata, no key, CORS open). The staff member's own browser pulls the record, so it is still a record
// staff pulled themselves; they check it against the Secretary of State page, attach a screenshot and save.
// Datasets (checked 29 Sep 2026, columns read from /api/views/<id>.json):
//   NY data.ny.gov n9v6-gdp6  "Active Corporations: Beginning 1800"   by dos_id          — active only
//   CO data.colorado.gov 4ykn-tg5h "Business Entities in Colorado"     by entityid        — all statuses
//   CT data.ct.gov n7gp-d28j Business Master + ka36-64k6 Principals    by accountnumber   — all statuses
//   OR data.oregon.gov tckn-sxa6 "Active Businesses - ALL"            by registry_number — active only, one row per name
//   PA data.pa.gov xvd7-5r2c "Registered Businesses in PA Current"    by filing_number   — current only, one row per officer
// Returns { legal_name, entity_number, status, formation_date, principal_address, people[], registry_url } or null (not found).

const day = (v) => (v && !String(v).startsWith('0001') ? String(v).slice(0, 10) : '');
const join = (...parts) => parts.map((p) => (p == null ? '' : String(p).trim())).filter(Boolean).join(', ');
const person = (first, middle, last, role) => {
  const n = [first, middle, last].map((p) => (p || '').trim()).filter(Boolean).join(' ');
  return n ? n + (role ? ' (' + String(role).toLowerCase() + ')' : '') : '';
};

export function mapStatus(raw) {
  const s = String(raw || '').toLowerCase();
  if (!s) return '';
  if (/revok/.test(s)) return 'revoked';
  if (/delinquent|suspend|forfeit|noncompli/.test(s)) return 'suspended';
  if (/dissol|cancel|withdr|merged|terminat|expired|converted/.test(s)) return 'dissolved';
  if (/inactive|rejected/.test(s)) return 'inactive';
  if (/^(active|good standing|exists|current|effective|in existence)/.test(s)) return 'active';
  return '';
}

export const ADAPTERS = {
  NY: {
    query: (n) => [{ dataset: 'n9v6-gdp6', where: { dos_id: n } }],
    build: ([rows], src) => {
      const r = rows[0]; if (!r) return null;
      const loc = r.location_address_1 ? join(r.location_address_1, r.location_address_2, r.location_city, r.location_state, r.location_zip)
        : join(r.dos_process_address_1, r.dos_process_address_2, r.dos_process_city, r.dos_process_state, r.dos_process_zip);
      return { legal_name: r.current_entity_name, entity_number: r.dos_id, status: 'active', formation_date: day(r.initial_dos_filing_date),
        principal_address: loc, people: [person(r.chairman_name, '', '', 'chairman'), person(r.registered_agent_name, '', '', 'registered agent')].filter(Boolean),
        registry_url: src.search_url };
    },
  },
  CO: {
    query: (n) => [{ dataset: '4ykn-tg5h', where: { entityid: n } }],
    build: ([rows], src) => {
      const r = rows[0]; if (!r) return null;
      return { legal_name: String(r.entityname || '').replace(/,\s*(delinquent|dissolved|expired|withdrawn)\b.*$/i, ''), entity_number: r.entityid,
        status: mapStatus(r.entitystatus), status_raw: r.entitystatus, formation_date: day(r.entityformdate),
        principal_address: join(r.principaladdress1, r.principaladdress2, r.principalcity, r.principalstate, r.principalzipcode),
        people: [person(r.agentfirstname, r.agentmiddlename, r.agentlastname, 'registered agent') || (r.agentorganizationname ? r.agentorganizationname + ' (registered agent)' : '')].filter(Boolean),
        registry_url: src.deep_link ? src.deep_link.replace('{number}', encodeURIComponent(r.entityid)) : src.search_url };
    },
  },
  CT: {
    query: (n) => [{ dataset: 'n7gp-d28j', where: { accountnumber: n } }],
    then: (rows) => (rows[0] && rows[0].id ? [{ dataset: 'ka36-64k6', where: { business_id: rows[0].id } }] : []),
    build: ([rows, principals], src) => {
      const r = rows[0]; if (!r) return null;
      return { legal_name: r.name, entity_number: r.accountnumber, status: mapStatus(r.status), status_raw: r.status,
        formation_date: day(r.date_registration),
        principal_address: join(r.billingstreet, r.billing_unit, r.billingcity, r.billingstate, r.billingpostalcode),
        people: (principals || []).map((p) => person(p.firstname, p.middlename, p.lastname, p.designation) || (p.name__c ? p.name__c + (p.designation ? ' (' + String(p.designation).toLowerCase() + ')' : '') : '')).filter(Boolean),
        registry_url: src.search_url };
    },
  },
  OR: {
    query: (n) => [{ dataset: 'tckn-sxa6', where: { registry_number: n } }],
    build: ([rows], src) => {
      if (!rows.length) return null;
      const r = rows[0];
      const ppb = rows.find((x) => /principal place/i.test(x.associated_name_type || '')) || r;
      return { legal_name: r.business_name, entity_number: r.registry_number, status: 'active', formation_date: day(r.registry_date),
        principal_address: join(ppb.address, ppb.address_continued, ppb.city, ppb.state, ppb.zip),
        people: rows.filter((x) => x.first_name || x.last_name).map((x) => person(x.first_name, x.middle_name, x.last_name, x.associated_name_type)),
        registry_url: (r.business_details && r.business_details.url) || src.search_url };
    },
  },
  PA: {
    query: (n) => [{ dataset: 'xvd7-5r2c', where: { filing_number: /^\d+$/.test(n) ? n.padStart(10, '0') : n } }],
    build: ([rows], src) => {
      if (!rows.length) return null;
      const r = rows[0];
      return { legal_name: r.business_name, entity_number: r.filing_number, status: 'active', formation_date: day(r.creationdate),
        principal_address: join(r.address_line1, r.address_line2, r.city, r.state, r.zip),
        people: [...new Set(rows.map((x) => person(x.first_name, x.middle_name, x.last_name, x.party_type)).filter(Boolean))],
        registry_url: src.search_url };
    },
  },
};

export const canPrefill = (src) => !!(src && src.od_domain && src.od_dataset && ADAPTERS[src.state]);

async function soql(domain, q, fetchImpl) {
  const params = new URLSearchParams(Object.assign({ $limit: '50' }, q.where));
  const res = await fetchImpl('https://' + domain + '/resource/' + q.dataset + '.json?' + params.toString(), { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(domain + ' answered ' + res.status);
  const rows = await res.json();
  return Array.isArray(rows) ? rows : [];
}

export async function fetchRegistry(src, entityNumber, fetchImpl = (u, o) => fetch(u, o)) {
  const a = src && ADAPTERS[src.state];
  const n = String(entityNumber || '').trim();
  if (!a || !src.od_domain) throw new Error('No open data for this state — use the registry search link.');
  if (!n) throw new Error('The shipper gave no entity number.');
  const sets = [];
  for (const q of a.query(n)) sets.push(await soql(src.od_domain, q, fetchImpl));
  if (a.then) for (const q of a.then(sets[0])) sets.push(await soql(src.od_domain, q, fetchImpl));
  const rec = a.build(sets, src);
  return rec ? Object.assign(rec, { state: src.state, source: 'open_data' }) : null;
}

export default { ADAPTERS, canPrefill, fetchRegistry, mapStatus };
