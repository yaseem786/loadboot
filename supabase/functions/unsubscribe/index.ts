// unsubscribe — public one-click unsubscribe endpoint (CAN-SPAM / RFC 8058). The link in every marketing email
// carries ?token=<delivery correlation_id> (an unguessable uuid). This endpoint resolves it through the
// service-role RPC cc_delivery_worker_unsubscribe — NOT a public/anon DB grant — so the anon SECURITY DEFINER
// surface stays at 5. Supports RFC 8058 one-click POST (List-Unsubscribe-Post) and a GET confirmation page.
//
// Deploy with verify_jwt = false (recipients have no Supabase JWT). No secret required beyond the service key.

import { createClient } from "jsr:@supabase/supabase-js@2";

const PAGE = (msg: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribe · LoadBoot</title></head>
  <body style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;max-width:520px;margin:60px auto;padding:0 20px;text-align:center">
  <h2 style="margin-bottom:8px">LoadBoot</h2><p style="font-size:16px;line-height:1.5">${msg}</p>
  <p style="color:#64748b;font-size:13px;margin-top:28px">You can re-subscribe anytime from your account settings.</p>
  </body></html>`;

function html(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return html(PAGE("This unsubscribe link is temporarily unavailable. Please try again later."), 200);

  const url = new URL(req.url);
  let token = url.searchParams.get("token") ?? "";
  if (req.method === "POST") {
    // RFC 8058 one-click: some clients POST the form; accept token from body too.
    try { const form = await req.formData(); token = (form.get("token") as string) || token; } catch { /* ignore */ }
  }
  if (!/^[0-9a-fA-F-]{36}$/.test(token)) return html(PAGE("This unsubscribe link is invalid or has expired."), 400);

  const sb = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data, error } = await sb.rpc("cc_delivery_worker_unsubscribe", { p_token: token });
  if (error) return html(PAGE("We couldn't process your request right now. Please try again later."), 200);
  if (data && data.ok) return html(PAGE("You've been unsubscribed. You will no longer receive marketing messages from LoadBoot."));
  return html(PAGE("This unsubscribe link is invalid or has expired."), 200);
});
