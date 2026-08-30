// mail-open — the open pixel for outreach email.
//
// Why this exists: 13,000 outreach emails had gone out by 29 Aug 2026 with ZERO opens
// recorded, because Resend's own open tracking was never switched on in its dashboard.
// Every report that mentioned opens therefore read 0, and nobody could tell a dead
// template from a dead list. This endpoint makes open data first-party, so it no longer
// depends on a third-party toggle.
//
// GET /o.gif?oc=<contact uuid>&d=<drip day>&t=<token>  -> 1x1 transparent GIF, always.
// (loadboot.com/o.gif is a Netlify 200-proxy onto this function; see build_site.py.)
//
// The response is a GIF no matter what happens. A tracker that returns an error page or a
// slow 500 shows up as a broken image in the recipient's client, so failure is silent by
// design here; the RPC's own result is what tells us whether the hit counted.
//
// verify_jwt is OFF on purpose (same as the sibling `unsubscribe` function): recipients
// cannot carry a Supabase JWT. `t` is an md5 of an open-only salt + contact + day + the
// server-side secret, so only the database can produce it and the endpoint cannot be used
// to enumerate contacts. It is a DIFFERENT token from the unsubscribe one — a scraper that
// walks pixel URLs must not be able to unsubscribe anybody. The RPC it calls,
// outreach_mark_open, is granted to service_role only.

const PIXEL = Uint8Array.from(atob("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"), (ch) => ch.charCodeAt(0));

const gif = () =>
  new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.byteLength),
      // Image caches must not serve a second open from cache, and must not hold the first back.
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      Expires: "0",
    },
  });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  // HEAD is what several security scanners send before the image client does.
  if (req.method !== "GET" && req.method !== "HEAD") return gif();

  try {
    const q = new URL(req.url).searchParams;
    const oc = q.get("oc") ?? "";
    const day = parseInt(q.get("d") ?? "", 10);
    const token = q.get("t") ?? "";
    if (!UUID.test(oc) || !Number.isFinite(day) || day < 1 || day > 7 || !/^[0-9a-f]{32}$/i.test(token)) return gif();

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    await fetch(`${SUPABASE_URL}/rest/v1/rpc/outreach_mark_open`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({ p_oc: oc, p_day: day, p_token: token }),
    });
  } catch (_e) {
    // Never let a tracking failure become a broken image in somebody's inbox.
  }
  return gif();
});
