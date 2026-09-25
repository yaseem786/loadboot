// lc-doc-check v12 (v11 + orphan cleanup on a definite metadata refusal) — caller-scoped preflight and confirmed storage/metadata saves.
// v10: the certificate holder is quoted as a finished four-line block. "Name LoadBoot"
// was never enough — the agent needs the legal entity AND the registered office, or the
// certificate comes back wrong a second time and the carrier blames us for the delay.
// AI verdict stays ADVISORY; staff verification is final.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite", "gemini-flash-latest"];
let WORKING_MODEL: string | null = null;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// The one place the certificate holder is defined. Everything quotes this.
const HOLDER_NAME = "LoadBoot LLC";
const HOLDER_ADDRESS = "30 N Gould St, Ste N, Sheridan, WY 82801, United States";
const HOLDER_LINES = "LoadBoot LLC\n30 N Gould St, Ste N\nSheridan, WY 82801\nUnited States";
const HOLDER_FIX = `Ask your insurance agent to issue a fresh certificate whose CERTIFICATE HOLDER box reads exactly:\n${HOLDER_LINES}\n\nCertificate holder only; we do not need to be added as an additional insured, so there should be no endorsement and no extra cost. Nothing else on the policy changes. It is free and usually takes the agent a few minutes.`;

const CHECKS: Record<string, string> = {
  coi: `This should be a Certificate of Insurance (ACORD 25) for a US FOR-HIRE TRUCKING company being onboarded by LoadBoot (a dispatch platform). Verify EVERY item and extract the exact values you read as evidence:\n1) It IS an ACORD 25 COI (not a quote, binder, dec page, policy schedule, invoice or other doc).\n2) COMMERCIAL AUTO LIABILITY of at least $1,000,000 in the AUTOMOBILE LIABILITY section (combined single limit). GENERAL LIABILITY or umbrella NEVER counts as auto liability — GL-only certificates (common for cleaning/moving-labor/home-service companies) are a REJECT.\n3) MOTOR TRUCK CARGO coverage explicitly listed (cargo/inland-marine line), typically $100,000. No cargo line anywhere = REJECT.\n4) CERTIFICATE HOLDER box: it must read "${HOLDER_NAME}" at ${HOLDER_ADDRESS}. Judge the REJECT on the company NAME only — if the holder box names any other company, or is empty, that is a REJECT. If the name is right but the address is missing, abbreviated or different, that is a WARNING, not a reject. Whenever you raise either, the fix must quote the holder block in full, line for line:\n${HOLDER_LINES}\nExtract exactly who is listed.\n5) SCHEDULED VEHICLES: the certificate (or its attached schedule) should list the trucks that will be dispatched, ideally with VINs. FMCSA shows this carrier operates {UNITS} power unit(s). If fewer vehicles are listed than {UNITS}, or no vehicles/VINs are shown at all, flag it (warning if coverage says "any auto"/"all owned autos", REJECT if specific-vehicle coverage lists the wrong or too few trucks) — fix: "have your agent list every truck you want dispatched, with its VIN". Extract the vehicles/VINs you can read, and say plainly whether the policy is ANY AUTO or SCHEDULED AUTOS.\n6) Policy dates: expired = REJECT; expiring within 14 days of {TODAY} = warning. Extract EFF and EXP dates.\n7) Insured legal name vs expected "{NAME}": different entity = REJECT (ignore case/punctuation/LLC vs INC — but a misspelled company name IS a reject).\n8) Producer/agent contact present; document legible.`,
  w9: `This should be an IRS Form W-9 for "{NAME}" (or its owner). Check deeply: 1) it IS a W-9 (current revision); 2) Line 1 name filled AND consistent with the expected carrier/owner — a completely unrelated name = reject; 3) exactly ONE federal tax classification box checked (none or multiple = reject); 4) full address present (street + city/state/ZIP); 5) a TIN (SSN or EIN) is entered with the right digit pattern — do NOT transcribe it, note present/absent and whether it is SSN-format or EIN-format; 6) SIGNED and DATED — unsigned or undated = REJECT; 7) legible, no fields cut off.\nCommon trap: if Line 1 shows the LLC name but the classification ticked is "Individual/sole proprietor", that is a MISMATCH and a reject — a single-member LLC filing on the owner's SSN puts the OWNER'S legal name on Line 1 and the LLC on Line 2. Say which of the two corrections applies.`,
  authority: `This should be an FMCSA operating authority document (MC certificate / authority letter) for "{NAME}". Check deeply: 1) it IS an FMCSA authority document (not a UCR receipt, BOC-3, or insurance filing); 2) legal name matches expected "{NAME}" — different entity = REJECT; 3) MC/DOT numbers visible and matching expected MC {MC} / DOT {DOT} — mismatched numbers = REJECT; 4) authority TYPE and STATUS language present (common/contract, active/granted) — revoked or inactive language = REJECT; 5) legible and complete. Extract the names, numbers and status you read.`,
  other: `Identify what this document is, who issued it, whether it is legible, complete, unexpired, and whether it plausibly belongs to "{NAME}". It was uploaded during trucking-carrier onboarding — flag anything inconsistent.`,
};

async function callGemini(key: string, payload: unknown): Promise<{ ok: boolean; status: number; data?: any; text?: string }> {
  const tryModels = WORKING_MODEL ? [WORKING_MODEL, ...MODELS.filter((m) => m !== WORKING_MODEL)] : MODELS;
  let last = { ok: false, status: 0, text: "" } as any;
  for (const m of tryModels) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${key}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      if (r.ok) { WORKING_MODEL = m; return { ok: true, status: 200, data: await r.json() }; }
      last = { ok: false, status: r.status, text: (await r.text()).slice(0, 300) };
      if (r.status !== 404 && r.status !== 429) return last;
      if (WORKING_MODEL === m) WORKING_MODEL = null;
    } catch (e) { last = { ok: false, status: 0, text: String(e).slice(0, 200) }; }
  }
  return last;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
    const caller = req.headers.get("authorization");
    if (!URL_ || !SVC || !ANON) return json({ error: "service_unavailable" }, 503);
    if (!caller || !/^Bearer \S+$/i.test(caller)) return json({ error: "not_authorized" }, 401);

    const b = await req.json().catch(() => ({}));
    if (!b || typeof b !== "object" || Array.isArray(b)) return json({ error: "bad_request" }, 400);
    const vkey = String(b.visitor_key || "");
    const convId = b.conv_id ? String(b.conv_id) : null;
    const docType = ["coi", "w9", "authority", "other"].includes(b.doc_type) ? b.doc_type : "other";
    const mime = String(b.mime || "");
    const dataB64 = String(b.data_b64 || "");
    const fname = String(b.filename || "document").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80);
    const ctx = b.context || {};
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(vkey) || vkey.startsWith("novkey") || !dataB64) return json({ error: "bad_request" }, 400);
    if (convId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(convId)) return json({ error: "bad_request" }, 400);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime)) return json({ error: "unsupported_type", detail: "PDF, JPG or PNG only" }, 400);
    if (dataB64.length > 11_000_000) return json({ error: "too_large", detail: "Max 8 MB" }, 400);

    const q = await fetch(`${URL_}/rest/v1/rpc/lc_ob_upload_check`, { method: "POST", headers: { apikey: ANON, Authorization: caller, "Content-Type": "application/json" }, body: JSON.stringify({ p_visitor_key: vkey, p_conversation_id: convId }) });
    const st = await q.json().catch(() => null);
    if (!q.ok) return json({ error: q.status >= 500 ? "service_unavailable" : "not_authorized" }, q.status >= 500 ? 503 : 403);
    // audit 2026-09-24: an open account-deletion request freezes uploads (bl_audit_0356); say so instead of a bare 403
    if (st && st.error === "frozen") return json({ error: "frozen", detail: "Uploads are paused while an account-deletion request is open for this account. Cancel the request from your account settings to upload again, or contact support." }, 403);
    if (!st || st.ok !== true || st.error) return json({ error: "not_authorized" }, 403);

    const path = `lc-onboarding/${vkey}/${crypto.randomUUID()}-${fname}`;
    let bytes: Uint8Array;
    try { bytes = Uint8Array.from(atob(dataB64), (c) => c.charCodeAt(0)); }
    catch { return json({ error: "bad_request" }, 400); }
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return json({ error: "too_large" }, 400);
    const up = await fetch(`${URL_}/storage/v1/object/documents/${path}`, { method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": mime, "x-upsert": "false" }, body: bytes });
    const stored = up.ok;
    if (!stored) return json({ error: "storage_failed" }, 502);

    let verdict: any = null;
    let aiDown = false;
    if (GEMINI_KEY) {
      const today = new Date().toISOString().slice(0, 10);
      const checklist = CHECKS[docType].replace(/\{TODAY\}/g, today).replace(/\{NAME\}/g, String(ctx.legal_name || "(not provided)")).replace(/\{MC\}/g, String(ctx.mc || "?")).replace(/\{DOT\}/g, String(ctx.dot || "?")).replace(/\{UNITS\}/g, String(ctx.power_units || "an unknown number of"));
      const prompt = `You are a STRICT broker-compliance document analyst for a US trucking platform. Real money is lost on bad paperwork, so you NEVER give the benefit of the doubt: if a required item is missing, ambiguous, partially cut off, or not clearly readable, that item FAILS — the verdict cannot be "pass". Only what is printed on the document counts; never assume coverage "probably exists".\n${checklist}\nRespond with ONLY minified JSON, no markdown: {"is_expected_type":bool,"verdict":"pass"|"warning"|"reject","doc_label":string,"issues":[{"severity":"reject"|"warning","problem":string,"fix":string}],"fields":{"insured_name":string|null,"expiry_date":string|null,"auto_liability":string|null,"cargo_limit":string|null,"certificate_holder":string|null,"vehicles_listed":string|null,"coverage_basis":string|null,"insurer":string|null},"summary":string}.\nRules: verdict=reject if ANY reject-severity issue exists. verdict=warning for near-expiry, incomplete vehicle schedules with any-auto coverage, or anything you could not fully verify. verdict=pass ONLY when EVERY required item is explicitly verified with values extracted into "fields". Set "coverage_basis" to "any auto" or "scheduled autos" for a COI. Every "fix" must tell the user exactly how to get a corrected original (which line their insurance agent must change, what to ask for) — and where a certificate holder is involved it must quote the block in full, line for line:\n${HOLDER_LINES}\n"summary" = 2 friendly but honest sentences for a chat window — no sugarcoating.`;
      const g = await callGemini(GEMINI_KEY, { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: dataB64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 1400 } });
      if (g.ok) {
        let raw = g.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
        raw = raw.replace(/```json|```/g, "").trim();
        try { verdict = JSON.parse(raw); } catch { /* fallthrough */ }
        if (verdict && verdict.verdict === "pass" && docType === "coi") {
          const f = verdict.fields || {};
          const holder = String(f.certificate_holder || "").toLowerCase();
          if (!holder.includes("loadboot")) {
            verdict.verdict = "reject";
            (verdict.issues = verdict.issues || []).push({ severity: "reject", problem: "Certificate holder is not LoadBoot (reads: " + (f.certificate_holder || "empty") + ")", fix: HOLDER_FIX });
            verdict.summary = "Coverage looks present, but the certificate holder must be " + HOLDER_NAME + " at " + HOLDER_ADDRESS + " — one quick call to your agent fixes this.";
          } else if (!/gould|sheridan|82801/i.test(String(f.certificate_holder || ""))) {
            verdict.verdict = "warning";
            (verdict.issues = verdict.issues || []).push({ severity: "warning", problem: "Certificate holder names LoadBoot but without our registered address", fix: "Next time your certificate is reissued, ask for the holder box to read in full:\n" + HOLDER_LINES });
          } else if (!f.auto_liability || !f.expiry_date || !f.cargo_limit) {
            verdict.verdict = "warning";
            (verdict.issues = verdict.issues || []).push({ severity: "warning", problem: "Automated check could not extract all required values (auto liability / cargo / expiry)", fix: "Our compliance team will verify manually — or upload a clearer original PDF" });
            verdict.summary = "Mostly looks right, but I couldn't verify every required value with certainty — our compliance team will double-check it manually.";
          }
        }
      } else { aiDown = true; }
    } else { aiDown = true; }
    if (!verdict) {
      verdict = aiDown
        ? { verdict: "queued", doc_label: docType.toUpperCase(), issues: [], fields: {}, summary: "Got it — your document is safely received. Our compliance team will review it personally and get back to you shortly." }
        : { verdict: "warning", doc_label: docType.toUpperCase(), issues: [{ severity: "warning", problem: "AI could not fully read this file", fix: "Try a clearer photo or the original PDF" }], fields: {}, summary: "I couldn't fully read that — a clearer copy would help. Our team will double-check it either way." };
    }

    const emoji = verdict.verdict === "pass" ? "✅" : verdict.verdict === "queued" ? "📥" : verdict.verdict === "warning" ? "⚠️" : "❌";
    const note = `${emoji} Onboarding doc — ${docType.toUpperCase()} "${fname}": ${String(verdict.verdict).toUpperCase()}${(verdict.issues || []).length ? " — " + (verdict.issues || []).map((i: any) => i.problem).join("; ").slice(0, 300) : ""}${verdict.verdict === "queued" ? " (AI offline — needs MANUAL review)" : ""} (stored: ${stored ? path : "UPLOAD FAILED"})`;
    const logged = await fetch(`${URL_}/rest/v1/rpc/lc_ob_doc_log`, { method: "POST", headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, "Content-Type": "application/json" }, body: JSON.stringify({ p_visitor_key: vkey, p_conversation_id: convId, p_doc: { t: docType, f: fname, path, verdict: verdict.verdict, ts: new Date().toISOString() }, p_note: note }) });
    const saved = await logged.json().catch(() => null);
    if (!logged.ok || !saved || saved.ok !== true || saved.error) {
      // v12: a DEFINITE refusal (HTTP 4xx = the RPC raised and rolled back, or a parsed body that is not ok) means no docs[] entry
      // points at the object we just wrote -> remove it so no orphan is left. An unreadable 2xx body is AMBIGUOUS (the entry
      // may exist) and so is any 5xx (a gateway timeout can hide a commit) -> leave the object for cc_lc_doc_reconcile. Best-effort: a failed cleanup never changes the reply.
      const definite = (logged.status >= 400 && logged.status < 500) || (logged.ok && saved && typeof saved === "object" && !Array.isArray(saved) && (saved.ok !== true || saved.error));
      if (stored && definite) {
        try { await fetch(`${URL_}/storage/v1/object/documents/${path}`, { method: "DELETE", headers: { apikey: SVC, Authorization: `Bearer ${SVC}` } }); } catch (_) { /* reconcile will list it */ }
      }
      return json({ error: "document_save_failed" }, 502);
    }

    return json({ ok: true, stored, doc_type: docType, verdict, holder: { name: HOLDER_NAME, address: HOLDER_ADDRESS, block: HOLDER_LINES } });
  } catch (e) {
    return json({ error: "server_error" }, 500);
  }
});
