import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// v34 — TIMEOUT BUDGET. The chain was sequential and its worst case (~31s) overran the browser
// client's own 15s cap in app/shared/api.js, so whenever a source HUNG rather than erroring fast
// the carrier saw "FMCSA is taking too long" even though SAFER would have answered a few seconds
// later. Three changes: socrata and qcmobile now run in PARALLEL (they are independent), fromLI no
// longer retries when the first attempt was a timeout (retrying a hung endpoint just burns the
// budget twice), and the per-source budgets are trimmed. New worst case ~15.3s; the client cap was
// raised to 25s in the same change. Happy path is unaffected (measured 0.44-0.75s on prod).
// v33 — SAFER IS NOW ALSO A *LOOKUP* FALLBACK, NOT JUST AN AUTHORITY FALLBACK.
// v32 only reached SAFER once a census record already existed (it keyed off result.dotNumber).
// So a lookup BY MC where the census dataset has no row bailed out early with
// "No carrier found for that number. Double-check your MC/DOT." — SAFER was never asked.
// That is the exact false negative that burned us on 22 Aug: MC-99849375 is a real, authorized
// docket, and prod still answered "double-check your MC". The census feed lags new authorities;
// SAFER does not. Now, when census finds nothing and an MC was supplied, we query SAFER by
// MC_MX and build the record from the snapshot. Also reworded the not-found error so it never
// asserts a number is wrong unless SAFER independently returned "Record Not Found".
// v32 — SAFER AUTHORITY FALLBACK. When QCMobile's L&I read fails, authority used to stay
// "unknown" forever and the caller was merely handed a saferUrl to open by hand. Nobody did.
// Also surfaces mcDiscrepancy: the census docket1 and the SAFER docket can differ for the same
// DOT (Warren: census 58740462 vs SAFER 99849375). SAFER wins, because that is what brokers see.
// v30 — fromLI retries once (QCMobile flakiness downgraded broker blocks to flags).
// v29 — v28 plus an MC↔DOT same-entity check.
// v28 — reads FMCSA Licensing & Insurance AUTHORITY TYPES via QCMobile /authority.
// v27 — full census record persisted as carrier_safety.fmcsa_snapshot (unchanged).
// v26 — no authority claims from census/allowedToOperate (unchanged).

const QC = "https://mobile.fmcsa.dot.gov/qc/services/carriers";
const SOCRATA = "https://data.transportation.gov/resource/az4n-8mr2.json";
const SAFER_BASE = "https://safer.fmcsa.dot.gov/query.asp?searched=true&query_type=queryCarrierSnapshot&query_param=";
const SAFER = `${SAFER_BASE}USDOT&query_string=`;

function corsFor(req: Request) {
  const reqHdr = req.headers.get("access-control-request-headers");
  return { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": reqHdr || "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, GET, OPTIONS", "Access-Control-Max-Age": "86400" };
}
function ratingMap(r: unknown): string { switch (String(r || "").toUpperCase()) { case "S": return "satisfactory"; case "C": return "conditional"; case "U": return "unsatisfactory"; default: return "none"; } }
function num(v: unknown): number | null { const n = Number(v); return isFinite(n) && v != null && v !== "" ? n : null; }
function fmtDate(v: unknown): string | null { const s = String(v || "").trim(); if (s.length < 8) return null; const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8); if (!/^[0-9]{8}/.test(s.slice(0, 8))) return null; return `${y}-${m}-${d}`; }

async function fetchJson(url: string, ms: number): Promise<{ ok: boolean; status: number; data?: any; err?: string; took: number }> {
  const t0 = Date.now(); const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "Accept": "application/json", "User-Agent": "Mozilla/5.0 (compatible; LoadBootDispatch/1.0; +https://loadboot.com)" }, signal: ctrl.signal });
    const took = Date.now() - t0;
    if (!r.ok) { const body = (await r.text().catch(() => "")).slice(0, 200); return { ok: false, status: r.status, err: `HTTP ${r.status}: ${body}`, took }; }
    const data = await r.json().catch((e) => ({ __parse: String(e) }));
    return { ok: true, status: r.status, data, took };
  } catch (e) { const took = Date.now() - t0; const m = String((e as Error)?.name === "AbortError" ? `timeout after ${ms}ms` : ((e as Error)?.message ?? e)); return { ok: false, status: 0, err: m, took }; }
  finally { clearTimeout(timer); }
}

const CARGO: Record<string, string> = { crgo_genfreight: "General freight", crgo_household: "Household goods", crgo_metalsheet: "Metal sheets/coils/rolls", crgo_motorveh: "Motor vehicles", crgo_drivetow: "Drive/tow away", crgo_logpole: "Logs/poles/beams/lumber", crgo_bldgmat: "Building materials", crgo_mobilehome: "Mobile homes", crgo_machlrg: "Machinery/large objects", crgo_produce: "Fresh produce", crgo_liqgas: "Liquids/gases", crgo_intermodal: "Intermodal containers", crgo_passengers: "Passengers", crgo_oilfield: "Oilfield equipment", crgo_livestock: "Livestock", crgo_grainfeed: "Grain/feed/hay", crgo_coalcoke: "Coal/coke", crgo_meat: "Meat", crgo_garbage: "Garbage/refuse/trash", crgo_usmail: "US mail", crgo_chem: "Chemicals", crgo_drybulk: "Commodities dry bulk", crgo_coldfood: "Refrigerated food", crgo_beverages: "Beverages", crgo_paperprod: "Paper products", crgo_utility: "Utility", crgo_farmsupp: "Farm supplies", crgo_construct: "Construction", crgo_waterwell: "Water well" };

function addr(st?: string, ci?: string, stt?: string, z?: string) { const p = [st, [ci, stt].filter(Boolean).join(", "), z].filter(Boolean); return p.length ? p.join(", ") : null; }

async function fromSocrata(dot: string, mc: string) {
  const url = dot ? `${SOCRATA}?dot_number=${dot}&$limit=1` : `${SOCRATA}?docket1=${mc}&$limit=1`;
  const res = await fetchJson(url, 5000);
  if (!res.ok) return { ok: false, err: res.err, took: res.took, source: "socrata", status: res.status };
  const c = Array.isArray(res.data) ? res.data[0] : null;
  if (!c) return { ok: false, err: "not_found", took: res.took, source: "socrata", status: res.status };
  const registered = String(c.status_code || "").toUpperCase() === "A";
  const cargo: string[] = []; for (const k in CARGO) if (String(c[k] || "").toUpperCase() === "X") cargo.push(CARGO[k]);
  const mcNumber = c.docket1 ? `${c.docket1prefix || "MC"}${c.docket1}` : (mc ? `MC${mc}` : null);
  return { ok: true, took: res.took, source: "socrata", carrier: {
    docketFromCensus: c.docket1 ? String(c.docket1).replace(/\D/g, "") : null,
    legalName: c.legal_name ?? null, dbaName: c.dba_name ?? null,
    dotNumber: num(c.dot_number) ?? (dot ? Number(dot) : null),
    mcNumber,
    mcActive: null,
    allowedToOperate: null,
    authority: "unknown", authorityVerified: false,
    registrationStatus: registered ? "active" : "inactive",
    authorityType: null, operationClassification: c.carrier_operation || null,
    carrierClassification: c.classdef || null,
    entityType: "CARRIER", safetyRating: "none", recordableCrashRate: c.recordable_crash_rate ?? null,
    powerUnits: num(c.power_units), truckUnits: num(c.truck_units), busUnits: num(c.bus_units),
    drivers: num(c.total_drivers), cdlDrivers: num(c.total_cdl), interstateDrivers: num(c.driver_inter_total),
    ownedTractors: num(c.owntract), ownedTrailers: num(c.owntrail), fleetSizeCode: c.fleetsize || null,
    phone: c.phone ?? null, email: c.email_address ?? null,
    physicalAddress: addr(c.phy_street, c.phy_city, c.phy_state, c.phy_zip),
    mailingAddress: addr(c.carrier_mailing_street, c.carrier_mailing_city, c.carrier_mailing_state, c.carrier_mailing_zip),
    hazmat: String(c.hm_ind || "").toUpperCase() === "Y",
    mcs150Date: fmtDate(c.mcs150_date), mcs150Mileage: num(c.mcs150_mileage), mcs150MileageYear: c.mcs150_mileage_year ?? null,
    registeredSince: fmtDate(c.add_date), dunsNumber: c.dun_bradstreet_no ?? null,
    cargoCarried: cargo, outOfService: false, oosDate: null,
  } };
}

async function fromQC(webKey: string, dot: string, mc: string) {
  const url = dot ? `${QC}/${dot}?webKey=${webKey}` : `${QC}/docket-number/${mc}?webKey=${webKey}`;
  const res = await fetchJson(url, 5000);
  if (!res.ok) return { ok: false, err: res.err, took: res.took, source: "qcmobile", status: res.status };
  const content = (res.data && res.data.content) ?? null;
  const c: any = Array.isArray(content) ? (content[0]?.carrier ?? content[0] ?? null) : (content?.carrier ?? content ?? null);
  if (!c) return { ok: false, err: "not_found", took: res.took, source: "qcmobile", status: res.status };
  return { ok: true, took: res.took, source: "qcmobile", carrier: {
    legalName: c.legalName ?? c.dbaName ?? null, dbaName: c.dbaName ?? null, dotNumber: c.dotNumber ?? (dot ? Number(dot) : null),
    mcNumber: null,
    allowedToOperate: c.allowedToOperate ?? null,
    authority: "unknown", authorityVerified: false,
    entityType: c.carrierOperation?.carrierOperationDesc ?? "CARRIER", safetyRating: ratingMap(c.safetyRating),
    powerUnits: c.totalPowerUnits ?? null, drivers: c.totalDrivers ?? null, phone: c.phyPhone ?? null,
    physicalAddress: addr(c.phyStreet, c.phyCity, c.phyState, c.phyZipcode),
    outOfService: !!c.oosDate, oosDate: c.oosDate ?? null, cargoCarried: [],
  } };
}

async function fromLI(webKey: string, dot: string) {
  let res = await fetchJson(`${QC}/${dot}/authority?webKey=${webKey}`, 4000);
  // v34: retry only a FAST failure. Retrying a timeout doubles the wait on an endpoint that is
  // already hung, and the whole chain has to finish inside the client's deadline.
  let retried = false;
  if (!res.ok && !String(res.err || "").includes("timeout")) {
    retried = true;
    await new Promise((r) => setTimeout(r, 300));
    res = await fetchJson(`${QC}/${dot}/authority?webKey=${webKey}`, 4000);
  }
  if (!res.ok) return { ok: false, err: res.err, took: res.took, retried };
  const content = (res.data && res.data.content) ?? null;
  const items: any[] = Array.isArray(content) ? content : content ? [content] : [];
  const recs = items.map((it) => (it && (it.carrierAuthority ?? it.authority ?? it)) || null).filter((r) => r && typeof r === "object");
  const st = (v: unknown) => String(v ?? "").trim().toUpperCase();
  const seen = recs.filter((r) => st(r.commonAuthorityStatus) || st(r.contractAuthorityStatus) || st(r.brokerAuthorityStatus));
  if (!seen.length) return { ok: false, err: "no_authority_records", took: res.took };
  const anyA = (k: string) => seen.some((r) => st((r as any)[k]) === "A");
  const common = anyA("commonAuthorityStatus"), contract = anyA("contractAuthorityStatus"), broker = anyA("brokerAuthorityStatus");
  return { ok: true, took: res.took, li: {
    authorityTypes: { common, contract, broker },
    carrierAuthority: common || contract,
    brokerAuthority: broker,
    brokerOnly: broker && !(common || contract),
    dockets: seen.map((r: any) => ({ docket: [r.prefix, r.docketNumber].filter(Boolean).join("") || null,
      common: st(r.commonAuthorityStatus) || null, contract: st(r.contractAuthorityStatus) || null, broker: st(r.brokerAuthorityStatus) || null,
      property: st(r.authorizedForProperty) || null, passenger: st(r.authorizedForPassenger) || null, householdGoods: st(r.authorizedForHouseholdGoods) || null })),
  } };
}

async function fetchText(url: string, ms: number): Promise<{ ok: boolean; status: number; text?: string; err?: string; took: number }> {
  const t0 = Date.now(); const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { "Accept": "text/html,application/xhtml+xml", "User-Agent": "Mozilla/5.0 (compatible; LoadBootDispatch/1.0; +https://loadboot.com)" }, signal: ctrl.signal });
    const took = Date.now() - t0;
    if (!r.ok) return { ok: false, status: r.status, err: `HTTP ${r.status}`, took };
    return { ok: true, status: r.status, text: await r.text(), took };
  } catch (e) { const took = Date.now() - t0; const m = String((e as Error)?.name === "AbortError" ? `timeout after ${ms}ms` : ((e as Error)?.message ?? e)); return { ok: false, status: 0, err: m, took }; }
  finally { clearTimeout(timer); }
}

function htmlToText(h: string): string {
  h = h.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  h = h.replace(/<br\s*\/?>/gi, "\n");
  h = h.replace(/<\/(td|tr|th|p|div|table)>/gi, "\n");
  h = h.replace(/<[^>]+>/g, " ");
  h = h.replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&#0?39;/g, "'").replace(/&quot;/gi, '"');
  h = h.replace(/ /g, " ").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n");
  return h.trim();
}

function field(t: string, label: string): string | null {
  const m = t.match(new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:?\\s*([^\\n]{0,120})", "i"));
  const v = m ? m[1].trim() : "";
  return v || null;
}

// SAFER answers two questions the JSON feeds sometimes cannot: does this entity EXIST
// (the census dataset lags newly granted authorities by weeks), and is it AUTHORIZED.
// param is "USDOT" or "MC_MX".
//
// PARSING TRAP — the top of every SAFER page carries a help legend containing BOTH
// "AUTHORIZED FOR { Passenger, Property, HHG }: This will list..." AND
// "NOT AUTHORIZED: The entity does not have any operating authority...".
// Searching the whole page matches the legend, not the carrier. We anchor on the
// OPERATING AUTHORITY INFORMATION table and read only inside it.
async function fromSAFER(value: string, param: "USDOT" | "MC_MX" = "USDOT") {
  const res = await fetchText(`${SAFER_BASE}${param}&query_string=${value}`, 6000);
  if (!res.ok) return { ok: false, err: (res as any).err, took: res.took };
  const t = htmlToText((res as any).text || "");
  if (/Record\s+Not\s+Found/i.test(t)) return { ok: false, err: "record_not_found", took: res.took };
  // An MC query can land on a multi-result list instead of a snapshot. That is not a snapshot
  // and must not be guessed at.
  if (!/COMPANY\s+SNAPSHOT/i.test(t) && !/OPERATING AUTHORITY INFORMATION/i.test(t)) {
    return { ok: false, err: "not_a_snapshot", took: res.took };
  }

  let i = t.indexOf("OPERATING AUTHORITY INFORMATION");
  if (i < 0) i = t.lastIndexOf("Operating Authority Status:");
  if (i < 0) return { ok: false, err: "authority_section_not_found", took: res.took };
  const region = t.slice(i, i + 1500);

  const sm = region.match(/Operating Authority Status:\s*([\s\S]{0,300}?)(?:MC\/MX\/FF|For Licensing|COMPANY INFORMATION|$)/i);
  const statusText = sm ? sm[1].replace(/For Licensing[\s\S]*$/i, "").trim() : "";
  if (!statusText) return { ok: false, err: "authority_status_unreadable", took: res.took, region: region.slice(0, 300) };

  const up = statusText.toUpperCase();
  let status: string;
  if (up.includes("OUT-OF-SERVICE") || up.includes("OUT OF SERVICE")) status = "out_of_service";
  else if (up.includes("NOT AUTHORIZED")) status = "not_authorized";
  else if (up.includes("AUTHORIZED FOR")) status = "authorized";
  else status = "unknown";

  const mm = region.match(/MC\/MX\/FF\s*Number\(s\):\s*((?:[A-Z]{2}-?[0-9]+[ ,]*)+)/i);
  const dockets = mm ? (mm[1].match(/[A-Z]{2}-?[0-9]+/gi) || []) : [];

  // Identity fields, read from the whole page (not the authority region).
  const usdotRaw = field(t, "USDOT Number");
  const usdot = usdotRaw ? Number(String(usdotRaw).replace(/\D/g, "")) : null;

  return { ok: true, took: res.took, safer: {
    status, statusText: statusText.slice(0, 200), dockets,
    usdot: isFinite(usdot as number) && usdot ? usdot : null,
    legalName: field(t, "Legal Name"),
    dbaName: field(t, "DBA Name"),
    entityType: field(t, "Entity Type"),
    usdotStatus: field(t, "USDOT Status"),
    powerUnits: num((field(t, "Power Units") || "").replace(/\D/g, "")),
    drivers: num((field(t, "Drivers") || "").replace(/\D/g, "")),
    physicalAddress: field(t, "Physical Address"),
    phone: field(t, "Phone"),
  } };
}

function mergeCarrier(base: any, extra: any) {
  const out = { ...base };
  if (extra) {
    if (extra.safetyRating && extra.safetyRating !== "none") out.safetyRating = extra.safetyRating;
    if (extra.allowedToOperate) out.allowedToOperate = extra.allowedToOperate;
    if (extra.oosDate) { out.outOfService = extra.outOfService; out.oosDate = extra.oosDate; }
  }
  out.authority = "unknown"; out.authorityVerified = false;
  return out;
}

Deno.serve(async (req: Request) => {
  const cors = corsFor(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const out = (obj: unknown) => new Response(JSON.stringify(obj), { status: 200, headers: { "Content-Type": "application/json", ...cors } });
  try {
    const webKey = Deno.env.get("FMCSA_WEBKEY") ?? "";
    const auth = req.headers.get("Authorization");
    let body: any = {};
    if (req.method === "GET") { const u = new URL(req.url); body = { dot: u.searchParams.get("dot"), mc: u.searchParams.get("mc") }; }
    else body = await req.json().catch(() => ({}));
    const carrierOrg = body.carrier_org ?? null;
    const dot = String(body.dot ?? "").replace(/\D/g, "");
    const mc = String(body.mc ?? "").replace(/\D/g, "");
    if (!dot && !mc) return out({ ok: false, error: "Provide a DOT or MC number to verify." });

    const attempts: any[] = [];
    let result: any = null; let source = "";
    let saferCache: any = null;

    // v34: socrata and qcmobile are independent lookups of the same entity - run them together.
    // Sequentially they cost up to 12s of the client's 15s budget before the fallbacks even start.
    const [s, q] = await Promise.all([
      fromSocrata(dot, mc),
      webKey ? fromQC(webKey, dot, mc) : Promise.resolve({ ok: false, err: "no_webkey", took: 0 } as any),
    ]);
    attempts.push({ source: "socrata", ok: s.ok, took: (s as any).took, status: (s as any).status, err: (s as any).err });
    if (webKey) attempts.push({ source: "qcmobile", ok: q.ok, took: (q as any).took, status: (q as any).status, err: (q as any).err, role: s.ok ? "rating+oos" : "lookup" });

    if (s.ok) {
      result = (s as any).carrier; source = "socrata";
      if (q.ok) { result = mergeCarrier(result, (q as any).carrier); source = "socrata+qcmobile"; }
    } else if (q.ok) {
      result = (q as any).carrier; source = "qcmobile";
    }

    // v33: the JSON feeds found nothing. Before declaring the number bad, ask SAFER — by DOT if we
    // have one, otherwise by MC docket. The census dataset lags newly granted authorities by weeks,
    // and answering "double-check your MC" on a valid docket is the failure that cost us a carrier
    // relationship on 22 Aug.
    if (!result) {
      const byDot = !!dot;
      const sf = await fromSAFER(byDot ? dot : mc, byDot ? "USDOT" : "MC_MX");
      attempts.push({ source: byDot ? "safer-dot" : "safer-mc", ok: sf.ok, took: (sf as any).took, err: (sf as any).err, role: "lookup-fallback" });
      if (sf.ok) {
        const S = (sf as any).safer;
        if (S.usdot || S.legalName) {
          saferCache = S;
          source = "fmcsa-safer";
          result = {
            docketFromCensus: null,
            legalName: S.legalName, dbaName: S.dbaName,
            dotNumber: S.usdot ?? (dot ? Number(dot) : null),
            mcNumber: S.dockets[0] || (mc ? `MC${mc}` : null),
            mcActive: null, allowedToOperate: null,
            authority: "unknown", authorityVerified: false,
            registrationStatus: String(S.usdotStatus || "").toUpperCase().includes("ACTIVE") ? "active" : "inactive",
            authorityType: null, operationClassification: null, carrierClassification: null,
            entityType: S.entityType || "CARRIER", safetyRating: "none", recordableCrashRate: null,
            powerUnits: S.powerUnits, truckUnits: null, busUnits: null,
            drivers: S.drivers, cdlDrivers: null, interstateDrivers: null,
            ownedTractors: null, ownedTrailers: null, fleetSizeCode: null,
            phone: S.phone, email: null,
            physicalAddress: S.physicalAddress, mailingAddress: null,
            hazmat: false, mcs150Date: null, mcs150Mileage: null, mcs150MileageYear: null,
            registeredSince: null, dunsNumber: null, cargoCarried: [],
            outOfService: S.status === "out_of_service", oosDate: null,
            recordSource: "fmcsa-safer",
            recordSourceNote: "Not present in FMCSA's census dataset at the time of this check - this record was read from the SAFER company snapshot. The census feed lags newly granted authorities; SAFER is what brokers look at.",
          };
        }
      }
    }

    if (!result) {
      const anyTimeout = attempts.some((x) => String(x.err || "").includes("timeout"));
      const saferNoRecord = attempts.some((x) => String(x.source || "").startsWith("safer") && String(x.err || "") === "record_not_found");
      const notFound = attempts.filter((x) => !String(x.source || "").startsWith("safer")).every((x) => String(x.err || "").includes("not_found"));
      // THE MOST DANGEROUS STRING IN THIS FUNCTION. On 22 Aug its ancestor - "No carrier found
      // for that number. Double-check your MC/DOT." - was read as proof that a carrier's MC was
      // wrong, and a message went out telling him so. MC-99849375 was correct the whole time.
      // Verified 23 Aug: that docket is absent from BOTH the census dataset AND SAFER's MC_MX
      // index, yet it is printed on the carrier's own SAFER snapshot when queried by DOT. Both
      // indexes lag a newly granted docket by weeks. So a miss here means NOTHING about validity.
      const error = saferNoRecord
        ? "That MC is in neither FMCSA's census dataset nor SAFER's docket index. THIS IS NOT PROOF THE NUMBER IS WRONG - both indexes lag newly granted authorities, and a docket printed on a carrier's own SAFER snapshot can stay unfindable by MC for weeks. If you have their USDOT number, look it up by DOT instead; otherwise ask for the FMCSA authority letter. Do not tell a carrier their MC is invalid on the strength of this."
        : notFound
        ? "That number is not in FMCSA's census dataset, and SAFER could not be read either. THIS IS NOT PROOF THE NUMBER IS WRONG - the census feed lags newly granted authorities. Look it up by USDOT number, or open the SAFER snapshot by hand, before telling anyone their number is invalid."
        : anyTimeout ? "FMCSA is not responding right now. Try again in a minute, or upload your authority letter (PDF)."
        : "Could not reach FMCSA. Try again shortly, or upload your authority letter (PDF).";
      return out({ ok: false, error, attempts });
    }

    result.authorityTypes = null; result.carrierAuthority = null; result.brokerAuthority = null; result.brokerOnly = null; result.authoritySource = null;
    if (webKey && result.dotNumber) {
      const li = await fromLI(webKey, String(result.dotNumber));
      attempts.push({ source: "qcmobile-li", ok: li.ok, took: (li as any).took, err: (li as any).err, role: "authority-types" });
      if (li.ok) {
        const L = (li as any).li;
        result.authorityTypes = L.authorityTypes; result.liDockets = L.dockets;
        result.carrierAuthority = L.carrierAuthority; result.brokerAuthority = L.brokerAuthority; result.brokerOnly = L.brokerOnly;
        result.authoritySource = "fmcsa-li";
        result.authority = L.carrierAuthority ? "active" : "inactive";
        result.authorityVerified = true;
      }
    }

    // L&I could not answer. SAFER can, and it is the page a broker actually reads.
    // If the lookup fallback above already fetched the snapshot, reuse it — no second round trip.
    if (!result.authorityVerified && (saferCache || result.dotNumber)) {
      const sf = saferCache ? { ok: true, took: 0, safer: saferCache, cached: true } : await fromSAFER(String(result.dotNumber));
      attempts.push({ source: "safer", ok: sf.ok, took: (sf as any).took, err: (sf as any).err, cached: !!saferCache, role: "authority-fallback" });
      if (sf.ok) {
        const S = (sf as any).safer;
        result.saferAuthorityStatus = S.status;
        result.saferAuthorityText = S.statusText;
        result.saferDockets = S.dockets;
        // Only a positively parsed AUTHORIZED / NOT AUTHORIZED counts. "unknown" stays unknown —
        // a parse guess must never mint an authority, the same rule the L&I reader follows.
        if (S.status === "authorized" || S.status === "not_authorized") {
          result.authority = S.status === "authorized" ? "active" : "inactive";
          result.authorityVerified = true;
          result.authoritySource = "fmcsa-safer";
        } else if (S.status === "out_of_service") {
          result.authority = "inactive"; result.authorityVerified = true; result.authoritySource = "fmcsa-safer";
          result.outOfService = true;
        }
        // The census docket1 and the SAFER docket can disagree for the same DOT
        // (Warren's Courier, Aug 2026: census 58740462 vs SAFER 99849375). Surface both
        // instead of silently preferring the census one — brokers see SAFER.
        const saferMcRaw = S.dockets[0] || "";
        const saferMc = saferMcRaw.replace(/\D/g, "");
        if (saferMc) {
          result.mcFromSafer = saferMcRaw;
          if (result.docketFromCensus && result.docketFromCensus !== saferMc) {
            result.mcDiscrepancy = { census: "MC" + result.docketFromCensus, safer: saferMcRaw,
              note: "FMCSA's census dataset and the SAFER snapshot carry different dockets for this DOT. SAFER is the one brokers see - prefer it, and confirm with the carrier before changing anything on file." };
          }
        }
      }
    }

    if (result.brokerOnly == null && (result.powerUnits === 0 || result.powerUnits == null) && (result.truckUnits === 0 || result.truckUnits == null)) {
      result.brokerHint = "no_power_units";
    }
    if (mc && dot && result.docketFromCensus && result.docketFromCensus !== mc) {
      result.mcMismatch = { entered: "MC" + mc, onFile: "MC" + result.docketFromCensus,
        note: "The MC and DOT entered do not belong to the same FMCSA record." };
    }

    const saferUrl = result.dotNumber ? `${SAFER}${result.dotNumber}` : (mc ? `${SAFER_BASE}MC_MX&query_string=${mc}` : null);
    const authorityNotice = result.authoritySource === "fmcsa-li"
      ? "Authority types read live from FMCSA Licensing & Insurance (QCMobile /authority). Registration status and allowedToOperate remain non-authority fields."
      : result.authoritySource === "fmcsa-safer"
      ? "L&I did not answer, so operating authority was read from the FMCSA SAFER snapshot's 'Operating Authority Status' field - the same field a broker checks. See saferAuthorityText for the exact wording."
      : "Operating authority is UNKNOWN - both L&I and the SAFER snapshot failed to give a readable answer. UNKNOWN IS NOT A NEGATIVE FINDING: do not tell anyone they lack authority on the strength of this. Open the SAFER snapshot by hand, or require the FMCSA authority letter, before dispatching.";

    let saved = false; let saveError: string | null = null;
    if (carrierOrg && auth) {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL"); const ANON = Deno.env.get("SUPABASE_ANON_KEY");
      const mcDigits = result.mcNumber ? String(result.mcNumber).replace(/\D/g, "") : (mc || null);
      try {
        const sr = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cc_upsert_carrier_safety`, { method: "POST", headers: { "Content-Type": "application/json", "Authorization": auth, "apikey": ANON ?? "" }, body: JSON.stringify({ p_carrier: carrierOrg, p_dot: result.dotNumber ? String(result.dotNumber) : null, p_mc: mcDigits, p_authority: result.authority, p_rating: result.safetyRating, p_power_units: result.powerUnits, p_oos: result.outOfService, p_snapshot: result }) });
        saved = sr.ok; if (!sr.ok) saveError = (await sr.text()).slice(0, 300);
      } catch (e) { saveError = String((e as Error)?.message ?? e); }
    }
    return out({ ok: true, carrier: result, source, saved, saveError, attempts, saferUrl, authorityNotice });
  } catch (e) { return out({ ok: false, error: String((e as Error)?.message ?? e) }); }
});
