import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// telnyx-wa-templates v3 (bl_wa_0377) - asks Meta, through Telnyx, what it really thinks of LoadBoot's WhatsApp
// templates, and lets Command Center submit a new one. verify_jwt = true; staff only (enforced in Postgres).
//
// WHY: until now the portal's idea of "approved" was whatever a staff member had typed in after looking at a
// Meta screen. Telnyx owns the WABA, so Telnyx can be asked - and its answer is the only one that matters,
// because Telnyx is what refuses the send.
//
// v3 - THE ID PROBLEM, found on the first live run (21 Sep 2026). `filter[waba_id]=1620552536337068` (Meta's own
// WABA id, the one saved in The line) came back 200 with an EMPTY data array. Telnyx keeps TWO ids for a WhatsApp
// Business Account: its own record id and Meta's `waba_id`, and their docs do not say which one the filter wants.
// So this function no longer guesses: it lists the account first, learns both ids, and tries them in turn,
// finally falling back to an unfiltered read that it matches up itself. Every attempt and its row count comes
// back in `probe`, so a wrong id can never again look like "Meta has no templates".
//
// Endpoints (Telnyx docs, 21 Sep 2026):
//   GET  /v2/whatsapp/business_accounts        -> { data: [ { id, waba_id, name, status } ] }   (also tried:
//        /v2/whatsapp_business_accounts, because their docs and their api-reference disagree about the path)
//   GET  /v2/whatsapp/message_templates?filter[waba_id]=...&page[number]=n&page[size]=100
//        -> { data: [ { id, template_id, name, category, language, status, rejection_reason, components,
//                       whatsapp_business_account: { id } } ], meta: { total_pages, ... } }
//   POST /v2/whatsapp/message_templates
//        { waba_id, name, category, language, components: [ { type: "BODY", text, example: { body_text: [[...]] } } ] }
//
// Body: { action: "sync" }                 -> read every template for the saved WABA and write the real statuses in
//       { action: "submit", name: "..." }  -> send ONE drafted template to Meta for approval
// Both go through public.cc_wa_templates_prep / cc_wa_templates_sync AS THE CALLER, so a non-staff token gets
// "staff only" from Postgres and this function never has to decide who is allowed. The Telnyx key stays here.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const TELNYX_KEY = Deno.env.get("TELNYX_API_KEY") || "";
const TX = "https://api.telnyx.com/v2";
const MAX_PAGES = 10;                       // 10 x 100 templates is far more than LoadBoot will ever have

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, "Content-Type": "application/json" } });
// A refusal LoadBoot wrote in plain English goes back as 200 { error }. supabase-js turns any non-2xx into its
// own generic FunctionsHttpError, and the real sentence - which is the whole point - never reaches the screen.
const refuse = (msg: string, extra: Record<string, unknown> = {}) => json({ error: msg, ...extra });

// call an RPC as the person who pressed the button
async function rpc(auth: string, fn: string, args: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  const t = await r.text();
  let j: any = null; try { j = t ? JSON.parse(t) : null; } catch { /* not json */ }
  if (!r.ok) return { error: (j && (j.message || j.error)) || t || `rpc ${fn} failed` };
  return j ?? {};
}

// one GET against Telnyx, with the body kept whatever happens
async function tx(path: string): Promise<{ ok: boolean; status: number; j: any; raw: string }> {
  const r = await fetch(`${TX}${path}`, { headers: { Authorization: `Bearer ${TELNYX_KEY}` } });
  const raw = await r.text();
  let j: any = {}; try { j = raw ? JSON.parse(raw) : {}; } catch { /* not json */ }
  return { ok: r.ok, status: r.status, j, raw };
}

function txError(j: any, status: number, where: string, raw?: string): string {
  const e = j?.errors?.[0];
  const detail = (e?.detail || e?.title || j?.message || "") as string;
  console.error("telnyx-wa-templates", where, "HTTP", status, (raw || JSON.stringify(j)).slice(0, 600));
  return detail
    ? `Telnyx refused (${status}) on ${where}: ${detail}`
    : `Telnyx answered ${status} on ${where} and said nothing useful. The function log has the full reply.`;
}

// Telnyx's own record id for the WABA whose Meta id is `metaId` (null when it cannot be worked out)
async function resolveWaba(metaId: string, probe: unknown[]): Promise<string | null> {
  for (const path of ["/whatsapp/business_accounts?page[size]=100", "/whatsapp_business_accounts?page[size]=100"]) {
    const a = await tx(path);
    probe.push({ step: "accounts", path, status: a.status, rows: Array.isArray(a.j?.data) ? a.j.data.length : null });
    if (!a.ok || !Array.isArray(a.j?.data)) continue;
    const list = a.j.data as any[];
    const hit = list.find((x) => String(x?.waba_id || "") === metaId || String(x?.id || "") === metaId);
    if (hit) return String(hit.id || "");
    if (list.length === 1) return String(list[0]?.id || "");   // one account on the key: it is that one
    return null;
  }
  return null;
}

// every template page behind one filter value ("" = no filter at all)
async function readTemplates(filterValue: string, probe: unknown[]): Promise<{ rows: any[]; fatal?: string }> {
  const rows: any[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const q = (filterValue ? `filter[waba_id]=${encodeURIComponent(filterValue)}&` : "")
      + `page[number]=${page}&page[size]=100`;
    const a = await tx(`/whatsapp/message_templates?${q}`);
    if (!a.ok) {
      probe.push({ step: "templates", filter: filterValue || "(none)", status: a.status, rows: null });
      return { rows, fatal: txError(a.j, a.status, "GET /whatsapp/message_templates", a.raw) };
    }
    const data = Array.isArray(a.j?.data) ? a.j.data : [];
    if (page === 1) probe.push({ step: "templates", filter: filterValue || "(none)", status: a.status, rows: data.length });
    rows.push(...data);
    const total = Number(a.j?.meta?.total_pages || 1);
    if (data.length === 0 || page >= total) break;
  }
  return { rows };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    const asked = req.headers.get("access-control-request-headers");
    return new Response("ok", { headers: asked ? { ...cors, "Access-Control-Allow-Headers": asked } : cors });
  }
  if (req.method !== "POST") return json({ error: "method" }, 405);
  if (!TELNYX_KEY) return refuse("The WhatsApp service is not configured yet (TELNYX_API_KEY).");
  const auth = req.headers.get("Authorization") || "";
  if (!auth) return refuse("Sign in first.");

  try {
    const b = await req.json().catch(() => ({}));
    const action = String((b as any)?.action || "sync");
    const name = (b as any)?.name ? String((b as any).name) : null;

    // ---------------------------------------------------------------- who is asking, and for which WABA
    const prep: any = await rpc(auth, "cc_wa_templates_prep", { p_name: action === "submit" ? name : null });
    if (prep?.error) return refuse(String(prep.error));
    const metaWaba = String(prep?.waba_id || "");
    if (!metaWaba) return refuse("No WhatsApp Business Account id is saved yet.");

    const probe: unknown[] = [];
    const txWaba = await resolveWaba(metaWaba, probe);   // Telnyx's own id, when it can be found

    // ---------------------------------------------------------------- submit one drafted template
    if (action === "submit") {
      const t = prep?.template;
      if (!t) return refuse("That template is not a draft.");
      const ex: string[] = Array.isArray(t.example_vars) ? t.example_vars.map((x: unknown) => String(x)) : [];
      const comp: Record<string, unknown> = { type: "BODY", text: String(t.body || "") };
      if (Number(t.variables || 0) > 0) {
        if (ex.length < Number(t.variables)) {
          return refuse("Meta needs one example value for every {{n}} in the template.");
        }
        comp.example = { body_text: [ex.slice(0, Number(t.variables))] };
      }
      const r = await fetch(`${TX}/whatsapp/message_templates`, {
        method: "POST",
        headers: { Authorization: `Bearer ${TELNYX_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          waba_id: txWaba || metaWaba, name: String(t.name), category: String(t.category || "UTILITY"),
          language: String(t.language || "en_US"), components: [comp],
        }),
      });
      const raw = await r.text();
      let j: any = {}; try { j = raw ? JSON.parse(raw) : {}; } catch { /* not json */ }
      if (!r.ok) return refuse(txError(j, r.status, "POST /whatsapp/message_templates", raw), { probe });
      const row = (j as any)?.data;
      if (row) await rpc(auth, "cc_wa_templates_sync", { p_rows: [row], p_partial: true });
      return json({ ok: true, submitted: String(t.name), status: (row?.status || "PENDING"), probe });
    }

    // ---------------------------------------------------------------- read everything Meta has
    // Telnyx's id first (most likely what the filter means), then Meta's, then no filter at all.
    let rows: any[] = [];
    for (const f of [txWaba || "", metaWaba, ""]) {
      if (f === "" && rows.length) break;
      const got = await readTemplates(f, probe);
      if (got.fatal) return refuse(got.fatal, { probe });
      if (f === "") {
        // unfiltered: keep only this WABA's, unless the key carries exactly one account's worth
        const mine = got.rows.filter((x) => {
          const id = String(x?.whatsapp_business_account?.id || x?.waba_id || "");
          return id === txWaba || id === metaWaba;
        });
        const distinct = new Set(got.rows.map((x) => String(x?.whatsapp_business_account?.id || x?.waba_id || "")));
        rows = mine.length ? mine : (distinct.size <= 1 ? got.rows : []);
      } else {
        rows = got.rows;
      }
      if (rows.length) break;
    }

    if (rows.length === 0) {
      return refuse(
        "Telnyx's template list is empty for this account (Meta WABA " + metaWaba
        + (txWaba ? ", Telnyx id " + txWaba : ", and Telnyx did not list that WABA under this API key")
        + "). Templates created directly in Meta's WhatsApp Manager may not appear here - the ones created through"
        + " Telnyx do. Nothing has been changed.", { probe });
    }

    const out: any = await rpc(auth, "cc_wa_templates_sync", { p_rows: rows, p_partial: false });
    if (out?.error) return refuse(String(out.error), { probe });
    return json({ ...out, probe });
  } catch (e) {
    console.error("telnyx-wa-templates threw", e);
    return refuse(String((e as Error)?.message || e));
  }
});
