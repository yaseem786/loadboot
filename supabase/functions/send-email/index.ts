import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// send-email — staff-only transactional email via Resend (RESEND_API_KEY secret).
// Sender defaults to Resend's shared onboarding domain if RESEND_FROM is unset.
// Verifies the caller is active staff. Deployed to staging + production via Supabase MCP.
// verify_jwt = true.

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-lb-app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(o: unknown, s = 200): Response { return new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json", ...cors } }); }
function esc(x: string): string { return String(x).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string)); }

async function isStaff(auth: string, url: string, anon: string): Promise<boolean> {
  try {
    const r = await fetch(`${url}/rest/v1/rpc/get_my_staff_context`, { method: "POST", headers: { Authorization: auth, apikey: anon, "Content-Type": "application/json" }, body: "{}" });
    if (!r.ok) return false; const d = await r.json(); return !!(d && d.is_staff);
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const key = Deno.env.get("RESEND_API_KEY");
    if (!key) return json({ error: "RESEND_API_KEY is not configured in this project's secrets." }, 500);
    const from = Deno.env.get("RESEND_FROM") || "LoadBoot <onboarding@resend.dev>";
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "missing authorization" }, 401);
    const URL_ = Deno.env.get("SUPABASE_URL") ?? ""; const ANON = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    if (!(await isStaff(auth, URL_, ANON))) return json({ error: "staff access required" }, 403);

    const body = await req.json().catch(() => ({}));
    const to = String(body.to || "").trim();
    const subject = String(body.subject || "").trim();
    const text = String(body.text || "").trim();
    if (!to || !/^[^@]+@[^@]+\.[^@]+$/.test(to)) return json({ error: "a valid 'to' email is required" }, 400);
    if (!subject) return json({ error: "subject is required" }, 400);
    if (!text) return json({ error: "message body is required" }, 400);
    const html = body.html ? String(body.html) : `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">${esc(text).replace(/\n/g, "<br>")}<hr style="border:0;border-top:1px solid #eee;margin:18px 0"><div style="color:#64748b;font-size:12px">Sent via LoadBoot</div></div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, html }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok) return json({ error: `Resend error (HTTP ${r.status})`, detail: JSON.stringify(out).slice(0, 300) }, 502);
    return json({ ok: true, id: out.id ?? null, to });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
