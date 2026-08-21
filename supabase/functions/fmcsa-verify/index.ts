import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// v28 — reads FMCSA Licensing & Insurance AUTHORITY TYPES (the thing v26 said nothing
// here reads — now something does). QCMobile's /carriers/{dot}/authority endpoint is a
// direct L&I read: per docket it reports Common / Contract / Broker authority status.
// From it we derive:
//   * carrierAuthority — holds ACTIVE common or contract (for-hire motor carrier) authority
//   * brokerAuthority  — holds ACTIVE broker authority
//   * brokerOnly       — broker authority and NO carrier authority: this entity arranges
//     freight, it does not haul it. Proven live with CH ROBINSON (USDOT 2211804), which
//     sailed through the census path as "CARRIER / AUTHORIZED FOR HIRE / registration
//     active" — the census cannot tell a broker from a carrier, L&I can.
// `authority` is now set ONLY from this L&I read: active / inactive when the read
// succeeded, otherwise still "unknown" (v26 discipline). The census registration status
// and allowedToOperate remain what they always were — NOT authority.
//
// v27 — full census record persisted as carrier_safety.fmcsa_snapshot (unchanged).
// v26 — no authority claims from census/allowedToOperate (unchanged; see above).

const QC = "https://mobile.fmcsa.dot.gov/qc/services/carriers";
const SOCRATA = "https://data.transportation.gov/resource/az4n-8mr2.json";
const SAFER = "https://safer.fmcsa.dot.gov/query.asp?searched=true&query_type=queryCarrierSnapshot&query_param=USDOT&query_string=";

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
  const res = await fetchJson(url, 6500);
  if (!res.ok) return { ok: false, err: res.err, took: res.took, source: "socrata", status: res.status };
  const c = Array.isArray(res.data) ? res.data[0] : null;
  if (!c) return { ok: false, err: "not_found", took: res.took, source: "socrata", status: res.status };
  const registered = String(c.status_code || "").toUpperCase() === "A";
  const cargo: string[] = []; for (const k in CARGO) if (String(c[k] || "").toUpperCase() === "X") cargo.push(CARGO[k]);
  const mcNumber = c.docket1 ? `${c.docket1prefix || "MC"}${c.docket1}` : (mc ? `MC${mc}` : null);
  return { ok: true, took: res.took, source: "socrata", carrier: {
    // The docket the CENSUS itself holds for this entity. mcNumber above echoes the
    // caller's mc when the census row has no docket, so mismatch checks must use THIS.
    docketFromCensus: c.docket1 ? String(c.docket1).replace(/\D/g, "") : null,
    legalName: c.legal_name ?? null, dbaName: c.dba_name ?? null,
    dotNumber: num(c.dot_number) ?? (dot ? Number(dot) : null),
    mcNumber,
    mcActive: null,                       // a docket on the census was APPLIED FOR, not granted
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

// QCMobile gives a real safety rating and a real out-of-service flag. Its
// allowedToOperate field is reported as-is but is NEVER read as authority.
async function fromQC(webKey: string, dot: string, mc: string) {
  const url = dot ? `${QC}/${dot}?webKey=${webKey}` : `${QC}/docket-number/${mc}?webKey=${webKey}`;
  const res = await fetchJson(url, 5500);
  if (!res.ok) return { ok: false, err: res.err, took: res.took, source: "qcmobile", status: res.status };
  const content = (res.data && res.data.content) ?? null;
  const c: any = Array.isArray(content) ? (content[0]?.carrier ?? content[0] ?? null) : (content?.carrier ?? content ?? null);
  if (!c) return { ok: false, err: "not_found", took: res.took, source: "qcmobile", status: res.status };
  return { ok: true, took: res.took, source: "qcmobile", carrier: {
    legalName: c.legalName ?? c.dbaName ?? null, dbaName: c.dbaName ?? null, dotNumber: c.dotNumber ?? (dot ? Number(dot) : null),
    mcNumber: null,
    allowedToOperate: c.allowedToOperate ?? null,   // not out of service — NOT authority
    authority: "unknown", authorityVerified: false,
    entityType: c.carrierOperation?.carrierOperationDesc ?? "CARRIER", safetyRating: ratingMap(c.safetyRating),
    powerUnits: c.totalPowerUnits ?? null, drivers: c.totalDrivers ?? null, phone: c.phyPhone ?? null,
    physicalAddress: addr(c.phyStreet, c.phyCity, c.phyState, c.phyZipcode),
    outOfService: !!c.oosDate, oosDate: c.oosDate ?? null, cargoCarried: [],
  } };
}

// L&I authority types via QCMobile /carriers/{dot}/authority. One entity can hold several
// dockets; a type counts as held if ANY docket reports it "A" (active). Parsing is strict
// on purpose: unless we can positively read at least one authority record, we return null
// and the caller keeps authority = "unknown" — a parse guess must never mint an "active".
async function fromLI(webKey: string, dot: string) {
  // QCMobile drops requests often enough that real users hit it (two live sessions did
  // today) while spaced-out tests sail through. One paced retry absorbs the blink — and a
  // missed L&I read here downgrades a broker BLOCK to a mere review flag, so it matters.
  let res = await fetchJson(`${QC}/${dot}/authority?webKey=${webKey}`, 5500);
  if (!res.ok) { await new Promise((r) => setTimeout(r, 400)); res = await fetchJson(`${QC}/${dot}/authority?webKey=${webKey}`, 5500); }
  if (!res.ok) return { ok: false, err: res.err, took: res.took, retried: true };
  const content = (res.data && res.data.content) ?? null;
  const items: any[] = Array.isArray(content) ? content : content ? [content] : [];
  const recs = items.map((it) => (it && (it.carrierAuthority ?? it.authority ?? it)) || null).filter((r) => r && typeof r === "object");
  const st = (v: unknown) => String(v ?? "").trim().toUpperCase();     // "A" | "I" | "N" | ""
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

function mergeCarrier(base: any, extra: any) {
  const out = { ...base };
  if (extra) {
    if (extra.safetyRating && extra.safetyRating !== "none") out.safetyRating = extra.safetyRating;
    if (extra.allowedToOperate) out.allowedToOperate = extra.allowedToOperate;
    if (extra.oosDate) { out.outOfService = extra.outOfService; out.oosDate = extra.oosDate; }
  }
  out.authority = "unknown"; out.authorityVerified = false;   // never inferred from census/QC snapshot
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

    const s = await fromSocrata(dot, mc);
    attempts.push({ source: "socrata", ok: s.ok, took: (s as any).took, status: (s as any).status, err: (s as any).err });
    if (s.ok) { result = (s as any).carrier; source = "socrata"; }

    if (!result && webKey) {
      const q = await fromQC(webKey, dot, mc);
      attempts.push({ source: "qcmobile", ok: q.ok, took: (q as any).took, status: (q as any).status, err: (q as any).err });
      if (q.ok) { result = (q as any).carrier; source = "qcmobile"; }
    } else if (result && webKey) {
      const q = await fromQC(webKey, dot, mc);
      attempts.push({ source: "qcmobile", ok: q.ok, took: (q as any).took, status: (q as any).status, err: (q as any).err, role: "rating+oos" });
      if (q.ok) { result = mergeCarrier(result, (q as any).carrier); source = "socrata+qcmobile"; }
    }

    if (!result) {
      const anyTimeout = attempts.some((x) => String(x.err || "").includes("timeout"));
      const notFound = attempts.every((x) => String(x.err || "").includes("not_found"));
      const error = notFound ? "No carrier found for that number. Double-check your MC/DOT." : anyTimeout ? "FMCSA is not responding right now. Try again in a minute, or upload your authority letter (PDF)." : "Could not reach FMCSA. Try again shortly, or upload your authority letter (PDF).";
      return out({ ok: false, error, attempts });
    }

    // L&I authority types — runs AFTER mergeCarrier so its verdict cannot be stomped.
    result.authorityTypes = null; result.carrierAuthority = null; result.brokerAuthority = null; result.brokerOnly = null; result.authoritySource = null;
    if (webKey && result.dotNumber) {
      const li = await fromLI(webKey, String(result.dotNumber));
      attempts.push({ source: "qcmobile-li", ok: li.ok, took: (li as any).took, err: (li as any).err, role: "authority-types" });
      if (li.ok) {
        const L = (li as any).li;
        result.authorityTypes = L.authorityTypes; result.liDockets = L.dockets;
        result.carrierAuthority = L.carrierAuthority; result.brokerAuthority = L.brokerAuthority; result.brokerOnly = L.brokerOnly;
        result.authoritySource = "fmcsa-li";
        // The one source v26 demanded before claiming authority — L&I itself — answered.
        result.authority = L.carrierAuthority ? "active" : "inactive";
        result.authorityVerified = true;
      }
    }
    // Cheap census tell when L&I could not answer: an entity with zero power units filed
    // as running no trucks — CH Robinson's census row looks exactly like this. Hint only.
    if (result.brokerOnly == null && (result.powerUnits === 0 || result.powerUnits == null) && (result.truckUnits === 0 || result.truckUnits == null)) {
      result.brokerHint = "no_power_units";
    }
    // Caller sent BOTH numbers: check they describe the SAME entity. The DOT wins the
    // lookup, so a mismatched MC was being ignored without a word — and "real MC + my own
    // DOT" is a known fraud pairing, while the innocent version is a stale value left in
    // the other form field. Only the census's own docket counts (mcNumber can echo input).
    if (mc && dot && result.docketFromCensus && result.docketFromCensus !== mc) {
      result.mcMismatch = { entered: "MC" + mc, onFile: "MC" + result.docketFromCensus,
        note: "The MC and DOT entered do not belong to the same FMCSA record." };
    }

    const saferUrl = result.dotNumber ? `${SAFER}${result.dotNumber}` : null;
    const authorityNotice = result.authorityVerified
      ? "Authority types read live from FMCSA Licensing & Insurance (QCMobile /authority). Registration status and allowedToOperate remain non-authority fields."
      : "Operating authority is NOT verified here. Neither the census registration status nor the allowedToOperate flag proves a carrier holds for-hire authority. Open the SAFER snapshot, read 'Operating Authority Status', or require the FMCSA authority letter before dispatching.";

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
