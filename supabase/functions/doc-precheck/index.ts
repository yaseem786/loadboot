// doc-precheck v5 — instant ADVISORY AI pre-check for the carrier portal's document upload.
// Same strict checklists as lc-doc-check, but authenticated with the carrier's own session JWT
// (no visitor key, no storage write — the portal's normal upload flow handles storage).
// Verdict is ADVISORY ONLY: the UI may warn/redirect the carrier, staff verification stays final.
//
// v5 (audit F31, 2026-09-05): source is now in the repo (supabase/functions/doc-precheck/index.ts — prod v3 and
//     staging v4 were byte-identical and lived only in the dashboard). Adds server-side PDF FORENSICS, the EZHAUL
//     recipe: count %%EOF markers and /Prev xref chains (incremental updates = saved again after it was produced),
//     compare /ModDate with /CreationDate, and name the /Producer. Results go to verdict.fields.pdf_forensics and,
//     for insurance/authority/NOA PDFs, add a WARNING issue when the file shows post-issue edits. Never flips a
//     verdict to reject on forensics alone — a re-saved PDF is suspicious, not proof. The carrier portal now stores
//     the whole verdict on the documents row (bl_cmp_0325), so the reviewer sees this too.
// v3: the holder is quoted as the finished four-line block an agent can retype verbatim.
// v2: every certificate-holder instruction now carries LoadBoot's FULL legal name and address.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash-lite", "gemini-flash-latest"];
let WORKING_MODEL: string | null = null;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// The one place the certificate holder is defined. Everything quotes this.
const HOLDER_NAME = "LoadBoot LLC";
const HOLDER_ADDRESS = "30 N Gould St, Ste N, Sheridan, WY 82801, United States";
// Exactly how the holder box must read, line for line. Agents type what they are
// given, so we give them the finished block and never a summary of it.
const HOLDER_LINES = "LoadBoot LLC\n30 N Gould St, Ste N\nSheridan, WY 82801\nUnited States";
const HOLDER_BLOCK = HOLDER_LINES;
const HOLDER_FIX = `Ask your insurance agent to issue a fresh certificate whose CERTIFICATE HOLDER box reads exactly:\n${HOLDER_LINES}\n\nCertificate holder only; we do not need to be added as an additional insured, so there should be no endorsement and no extra cost. Nothing else on the policy changes. It is free and usually takes the agent a few minutes.`;

const CHECKS: Record<string, string> = {
  insurance: `This should be a Certificate of Insurance (ACORD 25) for a US FOR-HIRE TRUCKING company being onboarded by LoadBoot (a dispatch platform). Verify EVERY item and extract the exact values you read as evidence:\n1) It IS an ACORD 25 COI (not a quote, binder, dec page, policy schedule, invoice or other doc).\n2) COMMERCIAL AUTO LIABILITY of at least $1,000,000 in the AUTOMOBILE LIABILITY section (combined single limit). GENERAL LIABILITY or umbrella NEVER counts as auto liability — GL-only certificates are a REJECT.\n3) MOTOR TRUCK CARGO coverage explicitly listed (cargo/inland-marine line), typically $100,000. No cargo line anywhere = REJECT.\n4) CERTIFICATE HOLDER box: it must name "${HOLDER_NAME}" at ${HOLDER_ADDRESS}. Judge the REJECT on the company NAME only — if the holder box names any other company, or is empty, that is a REJECT. If the name is right but the address is missing, abbreviated or slightly different, that is a WARNING, not a reject. Whenever you raise either, the fix must quote the full holder block, line for line:\n${HOLDER_BLOCK}\nExtract exactly who is listed.\n5) SCHEDULED VEHICLES: the certificate (or attached schedule) should list the trucks that will be dispatched, ideally with VINs. FMCSA shows this carrier operates {UNITS} power unit(s). If fewer vehicles are listed than {UNITS}, or none at all, flag it (warning if coverage says "any auto"/"all owned autos", REJECT if specific-vehicle coverage lists the wrong or too few trucks). Extract the vehicles/VINs you can read, and say plainly whether the policy is ANY AUTO or SCHEDULED AUTOS — the carrier can only be dispatched on vehicles the policy actually covers.\n6) Policy dates: expired = REJECT; expiring within 14 days of {TODAY} = warning. Extract EFF and EXP dates.\n7) Insured legal name vs expected "{NAME}": different entity = REJECT (ignore case/punctuation/LLC vs INC — but a misspelled company name IS a reject, e.g. an extra or missing letter).\n8) Producer/agent contact present; document legible.`,
  w9: `This should be an IRS Form W-9 for "{NAME}" (or its owner). Check deeply: 1) it IS a W-9 (current revision); 2) Line 1 name filled AND consistent with the expected carrier/owner — a completely unrelated name = reject; 3) exactly ONE federal tax classification box checked (none or multiple = reject); 4) full address present (street + city/state/ZIP); 5) a TIN (SSN or EIN) is entered with the right digit pattern — do NOT transcribe it, note present/absent and whether it is SSN-format or EIN-format; 6) SIGNED and DATED — unsigned or undated = REJECT; 7) legible, no fields cut off.\nNote on a common trap: if Line 1 shows the LLC name but the classification ticked is "Individual/sole proprietor", that is a MISMATCH and a reject — a single-member LLC filing on the owner's SSN puts the OWNER'S legal name on Line 1 and the LLC on Line 2. Say which of the two corrections applies.`,
  authority: `This should be an FMCSA operating authority document (MC certificate / authority letter) for "{NAME}". Check deeply: 1) it IS an FMCSA authority document (not a UCR receipt, BOC-3, or insurance filing); 2) legal name matches expected "{NAME}" — different entity = REJECT; 3) MC/DOT numbers visible and matching expected MC {MC} / DOT {DOT} — mismatched numbers = REJECT; 4) authority TYPE and STATUS language present (common/contract, active/granted) — revoked or inactive language = REJECT; 5) legible and complete. Extract the names, numbers and status you read.`,
  noa: `This should be a factoring Notice of Assignment (NOA) letter for "{NAME}". Check: 1) it IS an NOA from a factoring company (names the factor, assigns accounts receivable, gives remit-to details); 2) the carrier name matches expected "{NAME}"; 3) the factor's remit-to details are present and legible — a bank name with only the last four digits of an account is NOT complete remit-to detail, flag that the full account and routing numbers are still needed; 4) it is signed/issued by the factor. Extract the factoring company name and remit-to you read.`,
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

// ---- v5: PDF forensics (the EZHAUL recipe, server-side) ---------------------------------------------------------
// Works on the raw bytes as latin1 text. Cheap, deterministic, no AI. Signals, not verdicts.
const EDITOR_PRODUCERS = /acrobat pro|acrobat dc|pdfescape|sejda|ilovepdf|smallpdf|foxit|nitro|pdf-xchange|pdfelement|wondershare|soda pdf|pdfsam|libreoffice|openoffice|canva|photoshop|illustrator|gimp|preview|quartz pdfcontext|word|pages/i;
function pdfDate(s: string | null): { iso: string | null; t: number | null } {
  if (!s) return { iso: null, t: null };
  const m = s.match(/D:?(\d{4})(\d{2})(\d{2})(\d{2})?(\d{2})?(\d{2})?/);
  if (!m) return { iso: null, t: null };
  const iso = `${m[1]}-${m[2]}-${m[3]}` + (m[4] ? `T${m[4]}:${m[5] || "00"}:${m[6] || "00"}Z` : "");
  const t = Date.parse(iso.length === 10 ? iso + "T00:00:00Z" : iso);
  return { iso, t: isFinite(t) ? t : null };
}
function pdfForensics(b64: string): Record<string, unknown> | null {
  try {
    const bin = atob(b64);
    if (!bin.startsWith("%PDF")) return null;
    const count = (needle: string) => { let n = 0, i = -1; while ((i = bin.indexOf(needle, i + 1)) !== -1) n++; return n; };
    const eof = count("%%EOF");
    const prev = count("/Prev ");
    const tail = bin.slice(-4096);
    const head = bin.slice(0, 200_000) + bin.slice(-200_000);   // info dict is usually near one end
    const pick = (re: RegExp) => { const m = head.match(re); return m ? m[1] : null; };
    const creation = pdfDate(pick(/\/CreationDate\s*\(([^)]{4,40})\)/));
    const mod = pdfDate(pick(/\/ModDate\s*\(([^)]{4,40})\)/));
    const producer = (pick(/\/Producer\s*\(([^)]{1,120})\)/) || "").replace(/\\\(|\\\)/g, "").trim() || null;
    const creator = (pick(/\/Creator\s*\(([^)]{1,120})\)/) || "").replace(/\\\(|\\\)/g, "").trim() || null;
    const signed = /\/Type\s*\/Sig\b/.test(bin) || /\/ByteRange/.test(bin);
    const daysBetween = creation.t != null && mod.t != null ? Math.round((mod.t - creation.t) / 86_400_000) : null;
    const editorHint = EDITOR_PRODUCERS.test(producer || "") ? producer : EDITOR_PRODUCERS.test(creator || "") ? creator : null;
    return {
      eof_count: eof,
      prev_xref_count: prev,
      incremental_updates: Math.max(0, eof - 1),
      creation_date: creation.iso, mod_date: mod.iso, mod_after_creation_days: daysBetween,
      producer, creator, editor_hint: editorHint,
      has_signature_object: signed,
      linearized: /\/Linearized\s/.test(bin.slice(0, 2048)),
      trailer_ok: /%%EOF\s*$/.test(tail),
      bytes: bin.length,
    };
  } catch (_) { return null; }
}
// Turns forensics into advisory issues. Only for documents an insurer / FMCSA / a factor ISSUES; a W-9 is filled
// in by the carrier, so edits there are normal.
function forensicIssues(f: Record<string, unknown> | null, docType: string): Array<{ severity: string; problem: string; fix: string }> {
  if (!f || !["insurance", "authority", "noa"].includes(docType)) return [];
  const out: Array<{ severity: string; problem: string; fix: string }> = [];
  const inc = Number(f.incremental_updates || 0);
  const days = f.mod_after_creation_days as number | null;
  if (inc >= 1) out.push({ severity: "warning",
    problem: `The PDF was saved again ${inc} time${inc > 1 ? "s" : ""} after it was first produced (incremental update${inc > 1 ? "s" : ""} inside the file).`,
    fix: "Not proof of tampering, but the original is what the issuer emailed. If in doubt, ask the agent/issuer to send the certificate directly, or compare the printed values with the insurer's records." });
  if (days != null && days >= 2) out.push({ severity: "warning",
    problem: `The file's modification date is ${days} day${days > 1 ? "s" : ""} after its creation date (${f.creation_date} → ${f.mod_date}).`,
    fix: "An issued certificate is normally created and last modified on the same day. Confirm the effective/expiry dates and limits with the issuer." });
  if (f.editor_hint) out.push({ severity: "warning",
    problem: `The file reports it was produced or edited with "${f.editor_hint}", not an insurer/FMCSA system.`,
    fix: "Ask for the issuer's original PDF. Certificates come from agency management systems (e.g. Applied, Vertafore, Zywave, Hawksoft), not general PDF editors." });
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const GEMINI_KEY = Deno.env.get("GEMINI_API_KEY") || "";
    const URL_ = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    // ---- auth: must be a real signed-in user (their own JWT) ----
    const authz = req.headers.get("authorization") || "";
    const u = await fetch(`${URL_}/auth/v1/user`, { headers: { apikey: ANON, Authorization: authz } });
    if (!u.ok) return json({ error: "not_authorized" }, 401);

    const b = await req.json().catch(() => ({}));
    const docType = ["insurance", "w9", "authority", "noa", "other"].includes(b.doc_type) ? b.doc_type : "other";
    const mime = String(b.mime || "");
    const dataB64 = String(b.data_b64 || "");
    const ctx = b.context || {};
    if (!dataB64) return json({ error: "bad_request" }, 400);
    if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime)) return json({ error: "unsupported_type", detail: "PDF, JPG or PNG only" }, 400);
    if (dataB64.length > 11_000_000) return json({ error: "too_large", detail: "Max 8 MB" }, 400);

    // v5: forensics first — cheap, and independent of whether the AI is up
    const forensics = mime === "application/pdf" ? pdfForensics(dataB64) : null;

    let verdict: any = null;
    let aiDown = false;
    if (GEMINI_KEY) {
      const today = new Date().toISOString().slice(0, 10);
      const checklist = CHECKS[docType].replace(/\{TODAY\}/g, today).replace(/\{NAME\}/g, String(ctx.legal_name || "(not provided)")).replace(/\{MC\}/g, String(ctx.mc || "?")).replace(/\{DOT\}/g, String(ctx.dot || "?")).replace(/\{UNITS\}/g, String(ctx.power_units || "an unknown number of"));
      const prompt = `You are a STRICT broker-compliance document analyst for a US trucking platform. Real money is lost on bad paperwork, so you NEVER give the benefit of the doubt: if a required item is missing, ambiguous, partially cut off, or not clearly readable, that item FAILS — the verdict cannot be "pass". Only what is printed on the document counts; never assume coverage "probably exists".\n${checklist}\nRespond with ONLY minified JSON, no markdown: {"is_expected_type":bool,"verdict":"pass"|"warning"|"reject","doc_label":string,"issues":[{"severity":"reject"|"warning","problem":string,"fix":string}],"fields":{"insured_name":string|null,"expiry_date":string|null,"auto_liability":string|null,"cargo_limit":string|null,"certificate_holder":string|null,"vehicles_listed":string|null,"coverage_basis":string|null,"insurer":string|null},"summary":string}.\nRules: verdict=reject if ANY reject-severity issue exists. verdict=warning for near-expiry, incomplete vehicle schedules with any-auto coverage, or anything you could not fully verify. verdict=pass ONLY when EVERY required item is explicitly verified with values extracted into "fields". Set "coverage_basis" to "any auto" or "scheduled autos" for insurance documents. Every "fix" must tell the user exactly how to get a corrected original (which line their insurance agent must change, what to ask for) — and where a certificate holder is involved it must quote it in full, line for line:\n${HOLDER_BLOCK}\n"summary" = 2 friendly but honest sentences for the carrier — no sugarcoating.`;
      const g = await callGemini(GEMINI_KEY, { contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: mime, data: dataB64 } }] }], generationConfig: { temperature: 0, maxOutputTokens: 1400 } });
      if (g.ok) {
        let raw = g.data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text).join("") ?? "";
        raw = raw.replace(/```json|```/g, "").trim();
        try { verdict = JSON.parse(raw); } catch { /* fallthrough */ }
        if (verdict && verdict.verdict === "pass" && docType === "insurance") {
          const f = verdict.fields || {};
          const holder = String(f.certificate_holder || "").toLowerCase();
          if (!holder.includes("loadboot")) {
            verdict.verdict = "reject";
            (verdict.issues = verdict.issues || []).push({ severity: "reject", problem: "Certificate holder is not LoadBoot (reads: " + (f.certificate_holder || "empty") + ")", fix: HOLDER_FIX });
            verdict.summary = "Coverage looks present, but the certificate holder must be " + HOLDER_NAME + " at " + HOLDER_ADDRESS + " — one quick call to your agent fixes this.";
          } else if (!/gould|sheridan|82801/i.test(String(f.certificate_holder || ""))) {
            // Right company, no address. Not worth refusing a good certificate over,
            // but the carrier should know before a broker queries it.
            verdict.verdict = "warning";
            (verdict.issues = verdict.issues || []).push({ severity: "warning", problem: "Certificate holder names LoadBoot but without our registered address", fix: "Next time your certificate is reissued, ask for the holder box to read in full:\n" + HOLDER_BLOCK });
          }
        }
      } else { aiDown = true; }
    } else { aiDown = true; }
    if (!verdict) {
      verdict = { verdict: "queued", doc_label: docType.toUpperCase(), issues: [], fields: {}, summary: "Document received — our compliance team will review it personally." };
    }

    // v5: attach forensics. Advisory: a pass with edit signals becomes a warning; a reject stays a reject; a
    // "queued" (AI down) verdict keeps its label but carries the signals for the reviewer.
    if (forensics) {
      verdict.fields = verdict.fields || {};
      verdict.fields.pdf_forensics = forensics;
      const fi = forensicIssues(forensics, docType);
      if (fi.length) {
        verdict.issues = [...(verdict.issues || []), ...fi];
        if (verdict.verdict === "pass") {
          verdict.verdict = "warning";
          verdict.summary = (verdict.summary ? verdict.summary + " " : "") + "One more thing: the PDF shows signs of being re-saved after it was issued — our team may ask for the issuer's original.";
        }
      }
    }
    return json({ ok: true, ai: !aiDown, doc_type: docType, verdict, holder: { name: HOLDER_NAME, address: HOLDER_ADDRESS, block: HOLDER_LINES } });
  } catch (e) {
    return json({ error: "server_error", detail: String(e instanceof Error ? e.message : e).slice(0, 200) }, 500);
  }
});
