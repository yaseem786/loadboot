// unsubscribe — the email preference centre. Every unsubscribe link and every List-Unsubscribe header
// LoadBoot sends points here (bl_comm_0446, 25 Sep 2026).
//
// v1 (2026-07-31): one token, one action — suppress the address from marketing, show a plain page.
// v2 (2026-09-25, bl_comm_0446): Amazon/Uber-grade preference centre.
//   GET  ?token=<correlation_id>      link in a LoadBoot email (marketing AND optional operational mail)
//   GET  ?e=<email>&t=<md5>           the older outreach footer link (loadboot.com/unsub.html redirects here)
//        → the unsubscribe is honoured IMMEDIATELY for the category the email belonged to (or marketing,
//          per the CC setting), then the page shows what changed and lets the person: stop every optional
//          email, switch other categories off/on, tell us why (never required), or undo.
//   POST form  List-Unsubscribe=One-Click   RFC 8058: Gmail/Yahoo/Apple press this — same immediate rule.
//   POST json  {action, scope, groups, reason_code, reason_text}   the page's own calls.
//   POST json  {action:'reason', reason_code, reason_text}          attaches a reason to what just happened.
//
// verify_jwt is OFF on purpose: recipients carry no Supabase session. The token is an unguessable
// per-delivery UUID (or the outreach md5 pair); an invalid token does nothing. Only service-role RPCs
// are used (unsub_link_get / unsub_link_apply / unsub_link_reason) — nothing here is anon-executable.
// Essential mail (account & security, billing notices, staff alerts) never carries a link and can never
// be switched off here; the RPC filters those groups out whatever the page sends.

const SITE = Deno.env.get("SITE_URL") || "https://loadboot.com";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));

const shell = (title: string, inner: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${esc(title)} · LoadBoot</title>
<style>
:root{--navy:#10223B;--blue:#0883F7;--ink:#1e293b;--mut:#64748b;--line:#e2e8f0;--bg:#eef2f8;--ok:#15803d;--okbg:#ecfdf3;--warn:#b45309;--warnbg:#fffbeb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font-family:'Segoe UI',system-ui,-apple-system,Arial,sans-serif;color:var(--ink)}
.wrap{max-width:600px;margin:36px auto;padding:0 16px}.card{background:#fff;border:1px solid var(--line);border-radius:16px;padding:28px 24px;margin-bottom:14px}
.brand{font-weight:800;color:var(--navy);font-size:15px;letter-spacing:.2px;margin-bottom:18px}.brand span{color:var(--blue)}
h1{font-size:22px;margin:0 0 6px;color:var(--navy)}.sub{color:var(--mut);font-size:14px;margin:0 0 18px;line-height:1.6}.sub b{color:var(--ink)}
.done{background:var(--okbg);border:1px solid #bbf7d0;color:var(--ok);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.6;margin-bottom:16px}
.warn{background:var(--warnbg);border:1px solid #fde68a;color:var(--warn);border-radius:12px;padding:12px 14px;font-size:14px;line-height:1.6;margin-bottom:16px}
.row{display:flex;align-items:flex-start;gap:12px;padding:12px 0;border-top:1px solid var(--line)}.row:first-of-type{border-top:0}
.row .t{font-weight:700;font-size:14.5px}.row .d{color:var(--mut);font-size:13px;line-height:1.5;margin-top:2px}.row .lock{color:var(--mut);font-size:12px;font-weight:600;white-space:nowrap;padding-top:2px}
.tg{position:relative;width:44px;height:26px;border-radius:13px;background:#cbd5e1;flex:0 0 auto;cursor:pointer;transition:background .15s;margin-top:1px}.tg:after{content:'';position:absolute;top:3px;left:3px;width:20px;height:20px;border-radius:50%;background:#fff;transition:left .15s}
.tg.on{background:var(--blue)}.tg.on:after{left:21px}.tg.off{opacity:.45;cursor:not-allowed}
.btn{display:inline-block;border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:14.5px;cursor:pointer;font-family:inherit}.btn-p{background:var(--navy);color:#fff}.btn-s{background:#f1f5f9;color:var(--navy)}.btn-l{background:none;color:var(--blue);padding:8px 0;text-decoration:underline}
.btn[disabled]{opacity:.5;cursor:default}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:16px}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}.chip{border:1px solid var(--line);border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;background:#fff}.chip.on{background:var(--navy);color:#fff;border-color:var(--navy)}
textarea{width:100%;border:1px solid var(--line);border-radius:10px;padding:10px;font:inherit;font-size:14px;min-height:70px;resize:vertical}
.foot{color:var(--mut);font-size:12.5px;line-height:1.7;text-align:center;padding:6px 0 24px}.foot a{color:var(--blue);font-weight:600;text-decoration:none}
.hide{display:none}.small{font-size:13px;color:var(--mut);line-height:1.6}
</style></head><body><div class="wrap">${inner}
<div class="foot">LoadBoot · Truck dispatch &amp; logistics technology · United States<br><a href="${SITE}">loadboot.com</a> · <a href="${SITE}/privacy.html">Privacy</a> · <a href="${SITE}/contact.html">Support</a></div>
</div></body></html>`;

const html = (status: number, title: string, body: string) =>
  new Response(shell(title, body), { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

const simple = (status: number, title: string, text: string) =>
  html(status, title, `<div class="card"><div class="brand">Load<span>Boot</span></div><h1>${esc(title)}</h1><p class="sub">${text}</p></div>`);

const INVALID = "The unsubscribe link looks incomplete. Please use the link exactly as it appears in the email, or just reply to the email with the word <b>unsubscribe</b> and we will take care of it.";

type Link = { token: string | null; email: string | null; sig: string | null };

Deno.serve(async (req) => {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (req.method !== "GET" && req.method !== "POST") return new Response("method not allowed", { status: 405 });

  const url = new URL(req.url);
  const q = url.searchParams;
  const isUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
  const link: Link = {
    token: isUuid(q.get("token") ?? "") ? (q.get("token") as string).toLowerCase() : null,
    email: (q.get("e") ?? "").trim().toLowerCase() || null,
    sig: (q.get("t") ?? "").trim() || null,
  };
  if (!link.token && !(link.email && link.sig)) {
    if (req.method === "POST") return Response.json({ ok: false, error: "invalid link" }, { status: 400 });
    return simple(400, "This link isn't valid", INVALID);
  }

  const meta = {
    ip: (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || null,
    user_agent: req.headers.get("user-agent") ?? null,
  };

  const rpc = async (name: string, body: Record<string, unknown>) => {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify(body),
    });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`rpc ${name} HTTP ${res.status}: ${JSON.stringify(out).slice(0, 200)}`);
    return out;
  };
  const linkArgs = { p_token: link.token, p_email: link.email, p_sig: link.sig };
  const apply = (action: string, scope: string, groups: string[] | null, source: string, reason_code: string | null = null, reason_text: string | null = null) =>
    rpc("unsub_link_apply", { ...linkArgs, p_action: action, p_scope: scope, p_groups: groups, p_reason_code: reason_code, p_reason_text: reason_text, p_source: source, p_meta: meta });

  try {
    // ---------------------------------------------------------------- POST
    if (req.method === "POST") {
      const ct = (req.headers.get("content-type") ?? "").toLowerCase();
      if (ct.includes("application/json")) {
        const b = await req.json().catch(() => ({})) as Record<string, unknown>;
        const action = String(b.action ?? "");
        const rc = b.reason_code ? String(b.reason_code).slice(0, 60) : null;
        const rt = b.reason_text ? String(b.reason_text).slice(0, 500) : null;
        if (action === "reason") {
          const out = await rpc("unsub_link_reason", { ...linkArgs, p_reason_code: rc, p_reason_text: rt });
          return Response.json(out, { status: 200 });
        }
        if (action === "unsubscribe" || action === "resubscribe") {
          const scope = ["group", "marketing", "all"].includes(String(b.scope)) ? String(b.scope) : "group";
          const groups = Array.isArray(b.groups) ? (b.groups as unknown[]).map(String).slice(0, 12) : null;
          const out = await apply(action, scope, groups, "preference_page", rc, rt);
          return Response.json(out, { status: 200 });
        }
        return Response.json({ ok: false, error: "invalid action" }, { status: 400 });
      }
      // RFC 8058 one-click (form body "List-Unsubscribe=One-Click"), or any non-JSON POST: honour it now.
      await apply("unsubscribe", "group", null, "one_click").catch(() => null);
      return Response.json({ ok: true }, { status: 200 });
    }

    // ---------------------------------------------------------------- GET: honour first, then show the page
    const done = await apply("unsubscribe", "group", null, "preference_page");
    if (!done || done.ok !== true) {
      return simple(400, "This link isn't valid", done && done.error === "unknown token" ? INVALID : (done && done.error ? esc(done.error) : INVALID));
    }
    const info = await rpc("unsub_link_get", linkArgs);
    if (!info || info.ok !== true) return simple(400, "This link isn't valid", INVALID);

    const state = info.state ?? {};
    const groups: Array<Record<string, unknown>> = Array.isArray(state.groups) ? state.groups : [];
    const doneGroups: string[] = Array.isArray(done.groups) ? done.groups : [];
    const labelOf = (code: string) => code === "*" ? "every optional email" : String((groups.find((g) => g.code === code) || {}).label ?? code);
    const doneLabel = doneGroups.map(labelOf).join(", ");
    const who = info.name ? `<b>${esc(info.name)}</b> (${esc(info.email)})` : `<b>${esc(info.email)}</b>`;
    const settings = info.settings ?? {};
    const reasons: Array<{ code: string; label: string }> = Array.isArray(info.reasons) ? info.reasons : [];

    const rows = groups.map((g) => {
      const code = String(g.code), label = esc(g.label), desc = esc(g.description);
      if (g.opt_out_allowed !== true) {
        return `<div class="row"><div style="flex:1"><div class="t">${label}</div><div class="d">${desc}</div></div><div class="lock">Always on</div></div>`;
      }
      const on = g.opted_out === true ? "" : " on";
      return `<div class="row"><div style="flex:1"><div class="t">${label}</div><div class="d">${desc}</div></div><div class="tg${on}" data-g="${esc(code)}" role="switch" aria-checked="${on ? "true" : "false"}" tabindex="0" aria-label="${label}"></div></div>`;
    }).join("");

    const chips = reasons.map((r) => `<button type="button" class="chip" data-rc="${esc(r.code)}">${esc(r.label)}</button>`).join("");

    const body = `
<div class="card">
  <div class="brand">Load<span>Boot</span></div>
  <h1>You're unsubscribed</h1>
  <p class="sub">${who} will no longer receive <b>${esc(doneLabel)}</b> from LoadBoot. This took effect immediately.</p>
  <div class="done" id="doneBox">Done. Emails about your account, security and billing are essential and still reach you.</div>
  ${settings.ask_reason === false ? "" : `
  <div id="why">
    <div class="small"><b>Mind telling us why?</b> Optional — it helps us send less, and better.</div>
    <div class="chips">${chips}</div>
    <textarea id="rt" placeholder="Anything else? (optional)"></textarea>
    <div class="actions"><button class="btn btn-s" id="sendReason" type="button">Send feedback</button></div>
  </div>
  <div id="whyDone" class="small hide">Thank you — noted.</div>`}
</div>

<div class="card">
  <h1 style="font-size:18px">Manage what you receive</h1>
  <p class="sub">Switch a category off or back on. Changes save instantly for ${esc(info.email)}.</p>
  <div id="rows">${rows}</div>
  ${settings.offer_all === false ? "" : `<div class="actions"><button class="btn btn-p" id="stopAll" type="button"${state.all_off === true ? " disabled" : ""}>${state.all_off === true ? "Every optional email is off" : "Stop every optional email"}</button>${settings.resubscribe === false ? "" : `<button class="btn btn-l" id="undo" type="button">Undo — turn ${esc(doneLabel)} back on</button>`}</div>`}
  <p class="small" style="margin-top:14px">Changed your mind later? Any LoadBoot email brings you back to this page, and signed-in users can also do this under Account → Notifications.</p>
</div>
<script>
(function(){
  var post=function(p){return fetch(location.pathname+location.search,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(p)}).then(function(r){return r.json()});};
  var rc=null;
  var chips=document.querySelectorAll('.chip');chips.forEach(function(c){c.addEventListener('click',function(){var on=c.classList.contains('on');chips.forEach(function(x){x.classList.remove('on')});if(!on){c.classList.add('on');rc=c.getAttribute('data-rc');}else{rc=null;}});});
  var sr=document.getElementById('sendReason');if(sr){sr.addEventListener('click',function(){var rt=(document.getElementById('rt').value||'').trim();if(!rc&&!rt){return;}sr.disabled=true;post({action:'reason',reason_code:rc,reason_text:rt}).then(function(){document.getElementById('why').classList.add('hide');document.getElementById('whyDone').classList.remove('hide');}).catch(function(){sr.disabled=false;});});}
  function setAllOff(off){var b=document.getElementById('stopAll');if(!b)return;b.disabled=off;b.textContent=off?'Every optional email is off':'Stop every optional email';}
  function flash(msg,ok){var d=document.getElementById('doneBox');d.textContent=msg;d.className=ok?'done':'warn';}
  document.querySelectorAll('.tg').forEach(function(t){
    function flip(){if(t.classList.contains('busy'))return;t.classList.add('busy');var g=t.getAttribute('data-g');var turningOn=!t.classList.contains('on');
      post({action:turningOn?'resubscribe':'unsubscribe',scope:'group',groups:[g]}).then(function(d){t.classList.remove('busy');if(d&&d.ok){t.classList.toggle('on',turningOn);t.setAttribute('aria-checked',turningOn?'true':'false');var st=d.state||{};if(st.groups){st.groups.forEach(function(x){var e=document.querySelector('.tg[data-g="'+x.code+'"]');if(e){e.classList.toggle('on',x.opted_out!==true);}});}setAllOff(st.all_off===true);flash((turningOn?'Turned on: ':'Turned off: ')+t.getAttribute('aria-label')+'.',true);}else{flash((d&&d.error)||'Could not save that. Please try again.',false);}}).catch(function(){t.classList.remove('busy');flash('Could not save that. Please try again.',false);});}
    t.addEventListener('click',flip);t.addEventListener('keydown',function(e){if(e.key===' '||e.key==='Enter'){e.preventDefault();flip();}});
  });
  var sa=document.getElementById('stopAll');if(sa){sa.addEventListener('click',function(){sa.disabled=true;post({action:'unsubscribe',scope:'all'}).then(function(d){if(d&&d.ok){document.querySelectorAll('.tg').forEach(function(e){e.classList.remove('on');e.setAttribute('aria-checked','false');});setAllOff(true);flash('Every optional email is now off. Account, security and billing notices still reach you.',true);}else{sa.disabled=false;flash((d&&d.error)||'Could not save that.',false);}}).catch(function(){sa.disabled=false;flash('Could not save that. Please try again.',false);});});}
  var un=document.getElementById('undo');if(un){un.addEventListener('click',function(){un.disabled=true;post({action:'resubscribe',scope:${JSON.stringify(doneGroups.includes("*") ? "all" : "group")},groups:${JSON.stringify(doneGroups.filter((g) => g !== "*"))}}).then(function(d){if(d&&d.ok){var st=d.state||{};if(st.groups){st.groups.forEach(function(x){var e=document.querySelector('.tg[data-g="'+x.code+'"]');if(e){e.classList.toggle('on',x.opted_out!==true);}});}setAllOff(st.all_off===true);flash('Undone — ${esc(doneLabel).replace(/'/g, "\\'")} is back on.',true);un.classList.add('hide');}else{un.disabled=false;flash((d&&d.error)||'Could not undo that.',false);}}).catch(function(){un.disabled=false;flash('Could not undo that. Please try again.',false);});});}
})();
</script>`;
    return html(200, "You're unsubscribed", body);
  } catch (e) {
    console.error("unsubscribe:", (e as Error)?.message ?? e);
    if (req.method === "POST") return Response.json({ ok: false, error: "temporary error" }, { status: 200 });
    return simple(500, "Something went wrong", "Please try the link again in a minute, or reply to the email with the word <b>unsubscribe</b> and we'll take care of it by hand.");
  }
});
