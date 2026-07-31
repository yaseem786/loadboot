// unsubscribe — the endpoint every outgoing email's footer link and List-Unsubscribe headers point at.
// It existed in the email shell since v6 of delivery-worker but was never deployed (404) — recipients'
// only working exit was "report spam". Deployed 2026-07-31 with verify_jwt = false.
//
// GET  ?token=<correlation_id>  → human clicked the footer link: unsubscribe + show a plain confirmation page.
// POST ?token=<correlation_id>  → RFC 8058 one-click (Gmail/Yahoo press this on the user's behalf).
//
// verify_jwt is OFF on purpose: recipients cannot carry a Supabase JWT. The token is an unguessable
// per-delivery UUID; an invalid token does nothing. Uses only the service-role RPC
// cc_delivery_worker_unsubscribe (suppresses the address, flips the outreach contact, marks the delivery).

const page = (title: string, body: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · LoadBoot</title></head>
<body style="margin:0;background:#eef2f8;font-family:'Segoe UI',Arial,sans-serif">
<div style="max-width:560px;margin:60px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:36px 32px;text-align:center">
<div style="font-size:22px;font-weight:800;color:#10223B;margin-bottom:10px">${title}</div>
<div style="font-size:15px;color:#334155;line-height:1.7">${body}</div>
<div style="margin-top:22px;font-size:13px"><a href="https://loadboot.com" style="color:#0883F7;font-weight:700;text-decoration:none">loadboot.com</a></div>
</div></body></html>`;

const html = (status: number, title: string, body: string) =>
  new Response(page(title, body), { status, headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (req.method !== "GET" && req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const token = new URL(req.url).searchParams.get("token") ?? "";
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  if (!isUuid) return html(400, "This link isn't valid", "The unsubscribe link looks incomplete. Please use the link exactly as it appears in the email, or just reply to the email with the word <b>unsubscribe</b>.");

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/cc_delivery_worker_unsubscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ p_token: token }),
    });
    const out = await res.json().catch(() => ({}));
    if (req.method === "POST") {
      // One-click: mail clients only care about the 2xx.
      return Response.json({ ok: true }, { status: 200 });
    }
    if (out && out.ok) {
      return html(200, "You're unsubscribed", "You won't receive any more of these emails from LoadBoot. That took effect immediately — no confirmation needed.");
    }
    return html(200, "Nothing to do", "This link has already been used, or the email it came from is no longer in our system. Either way, you will not be emailed.");
  } catch (_e) {
    return html(500, "Something went wrong", "Please try the link again in a minute, or reply to the email with the word <b>unsubscribe</b> and we'll take care of it by hand.");
  }
});
