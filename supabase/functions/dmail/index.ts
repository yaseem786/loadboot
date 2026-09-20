// dmail v1 (bl_dmail_0356) — Dispatcher Mailbox engine. One function, two callers:
//   • pg_cron every minute  → header x-dmail-secret (checked by dmail_cron_check) → sync every due mailbox
//   • the portal (user JWT) → {action, account, ...}; access is decided by the dmail_access RPC run WITH the
//     caller's JWT (assigned dispatcher or staff). The mailbox password lives in Vault, is read here with the
//     service role, and never leaves this function.
// verify_jwt is OFF because cron has no JWT; both paths authenticate above before touching anything.
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { ImapFlow } from "npm:imapflow@1.0.164";
import nodemailer from "npm:nodemailer@6.9.14";
import PostalMime from "npm:postal-mime@2.2.7";

// supabase-js sends x-supabase-api-version (and x-region); a header missing from this list fails the preflight and the
// browser then never sends the POST at all — the portal shows "Failed to send a request to the Edge Function".
// Same shape as telnyx-token: a superset list, and the preflight echoes back exactly what the browser asked for.
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-supabase-api-version, x-region, x-dmail-secret", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Max-Age": "86400" };
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json" } });
const ROLES = ["inbox", "sent", "spam", "trash"] as const;
type Role = typeof ROLES[number];
const BATCH = 25, INITIAL = 200, WINDOW = 300, MAX_SRC = 20 * 1024 * 1024, MAX_ATTACH = 15 * 1024 * 1024;
// deno-lint-ignore no-explicit-any
type Any = any;

// LOGOUT can hang forever in the edge runtime (socket close never fires) — cap it, then hard-close.
const bye = async (c: Any) => { await Promise.race([c.logout().catch(() => {}), new Promise((r) => setTimeout(r, 3000))]); try { c.close(); } catch (_) { /* ignore */ } };
// A mail server that drops the TLS socket without close_notify raises a late socket error. With no listener that is an
// uncaught "event loop error" which kills the worker and turns the NEXT request into a 503 — so always listen, and never let a stray rejection be fatal.
const imapFor = (a: Any) => { const c: Any = new ImapFlow({ host: a.imap_host, port: a.imap_port, secure: true, auth: { user: a.username, pass: a.password }, logger: false, socketTimeout: 90000 }); c.on("error", (e: Any) => console.warn("dmail imap socket:", String(e?.message || e).slice(0, 160))); return c; };
globalThis.addEventListener("unhandledrejection", (e: Any) => { e.preventDefault(); console.warn("dmail unhandled:", String(e?.reason?.message || e?.reason).slice(0, 160)); });
globalThis.addEventListener("error", (e: Any) => { e.preventDefault(); console.warn("dmail late error:", String(e?.message || e?.error).slice(0, 160)); });
const addrs = (v: Any): { email: string; name: string }[] => (Array.isArray(v) ? v : v ? [v] : []).flatMap((x: Any) => x?.group ? addrs(x.group) : x?.address ? [{ email: String(x.address).toLowerCase(), name: x.name || "" }] : []);
const strip = (h: string) => h.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const bytesOf = (c: Any): Uint8Array => typeof c === "string" ? new TextEncoder().encode(c) : c instanceof Uint8Array ? c : new Uint8Array(c);

async function rolePaths(client: Any, known: Any): Promise<Record<Role, string | null>> {
  const out: Record<Role, string | null> = { inbox: "INBOX", sent: known?.sent?.path ?? null, spam: known?.spam?.path ?? null, trash: known?.trash?.path ?? null };
  if (out.sent && out.spam && out.trash) return out;
  const list = await client.list();
  const by = (su: string, re: RegExp) => (list.find((b: Any) => b.specialUse === su) || list.find((b: Any) => re.test(b.name)))?.path ?? null;
  out.sent = out.sent || by("\\Sent", /^sent/i); out.trash = out.trash || by("\\Trash", /^(trash|deleted)/i); out.spam = out.spam || by("\\Junk", /^(spam|junk)/i);
  return out;
}

async function parseMsg(m: Any) {
  const base = { uid: m.uid, size: m.size, seen: m.flags?.has("\\Seen") ?? false, starred: m.flags?.has("\\Flagged") ?? false, answered: m.flags?.has("\\Answered") ?? false, date: (m.internalDate ? new Date(m.internalDate) : new Date()).toISOString() };
  if (!m.source) {
    const e = m.envelope || {};
    return { ...base, message_id: e.messageId || null, in_reply_to: e.inReplyTo || null, refs: [], from_name: e.from?.[0]?.name || "", from_email: e.from?.[0]?.address || "", to: addrs(e.to), cc: addrs(e.cc), bcc: [], subject: e.subject || "", snippet: "Large message", text: "This message is too large to display here (over 20 MB). Ask LoadBoot staff if you need it.", html: null, attachments: [], date: (e.date ? new Date(e.date) : new Date(base.date)).toISOString() };
  }
  const p: Any = await PostalMime.parse(m.source);
  let html: string | null = p.html || null;
  const atts: Any[] = [];
  (p.attachments || []).forEach((a: Any, idx: number) => {
    const u8 = bytesOf(a.content); const cid = (a.contentId || "").replace(/^<|>$/g, "");
    const inline = !!cid && !!html && html.includes("cid:" + cid);
    if (inline && u8.length <= 400 * 1024 && /^image\//i.test(a.mimeType || "")) { html = html!.split("cid:" + cid).join(`data:${a.mimeType};base64,${b64(u8)}`); return; }
    atts.push({ idx, name: a.filename || "attachment", type: a.mimeType || "application/octet-stream", size: u8.length, inline });
  });
  const text = (p.text || (html ? strip(html) : "")).slice(0, 200000);
  if (html && html.length > 900000) html = null;
  const refs = String(p.references || "").split(/\s+/).filter(Boolean);
  const d = p.date ? new Date(p.date) : null;
  return { ...base, message_id: p.messageId || null, in_reply_to: p.inReplyTo || null, refs, from_name: p.from?.name || "", from_email: p.from?.address || "",
    to: addrs(p.to), cc: addrs(p.cc), bcc: addrs(p.bcc), subject: p.subject || "", snippet: text.replace(/\s+/g, " ").slice(0, 180), text, html, attachments: atts,
    date: d && !isNaN(+d) ? d.toISOString() : base.date };
}

async function syncAccount(svc: SupabaseClient, acc: Any) {
  const client = imapFor(acc); const folders: Any = { ...(acc.folders || {}) }; let added = 0;
  try {
    await client.connect();
    const paths = await rolePaths(client, folders);
    for (const role of ROLES) {
      const path = paths[role]; if (!path) continue;
      const lock = await client.getMailboxLock(path);
      try {
        const mb: Any = client.mailbox; const uv = Number(mb.uidValidity); const uidNext = Number(mb.uidNext || 1);
        let st = folders[role] || {};
        if (st.uidvalidity && st.uidvalidity !== uv) { await svc.rpc("dmail_folder_reset", { p_account: acc.id, p_folder: role, p_uidvalidity: uv }); st = {}; }
        let last: number = st.last_uid ?? Math.max(0, uidNext - 1 - INITIAL);
        if (mb.exists > 0 && uidNext - 1 > last) {
          const found: number[] = ((await client.search({ uid: `${last + 1}:*` }, { uid: true })) || []).filter((u: number) => u > last).sort((a: number, b: number) => a - b).slice(0, BATCH);
          if (found.length) {
            const sizes = new Map<number, number>();
            for await (const m of client.fetch(found.join(","), { uid: true, size: true }, { uid: true })) sizes.set(m.uid, m.size || 0);
            const small = found.filter((u) => (sizes.get(u) || 0) <= MAX_SRC), big = found.filter((u) => (sizes.get(u) || 0) > MAX_SRC);
            const raw: Any[] = [];
            if (small.length) for await (const m of client.fetch(small.join(","), { uid: true, flags: true, size: true, internalDate: true, source: true }, { uid: true })) raw.push(m);
            if (big.length) for await (const m of client.fetch(big.join(","), { uid: true, flags: true, size: true, internalDate: true, envelope: true }, { uid: true })) raw.push(m);
            const msgs = []; for (const m of raw) { try { msgs.push(await parseMsg(m)); } catch (e) { msgs.push({ uid: m.uid, subject: "(unreadable message)", text: String(e).slice(0, 200), to: [], cc: [], bcc: [], refs: [], attachments: [] }); } }
            // one RPC per message keeps each payload small; ingest is idempotent on (folder, uidvalidity, uid)
            for (const one of msgs) { const { data, error } = await svc.rpc("dmail_ingest", { p_account: acc.id, p_folder: role, p_uidvalidity: uv, p_msgs: [one] }); if (error) throw new Error("ingest: " + error.message); added += Number(data || 0); }
            last = found[found.length - 1];
          } else last = uidNext - 1;
        }
        const hi = uidNext - 1, lo = Math.max(1, hi - WINDOW + 1); const flags: Any[] = [];
        if (mb.exists > 0 && hi >= lo) for await (const m of client.fetch(`${lo}:${hi}`, { uid: true, flags: true }, { uid: true })) flags.push({ uid: m.uid, seen: m.flags.has("\\Seen"), starred: m.flags.has("\\Flagged"), answered: m.flags.has("\\Answered") });
        if (hi >= lo) await svc.rpc("dmail_flags_apply", { p_account: acc.id, p_folder: role, p_uidvalidity: uv, p_lo: lo, p_hi: Math.min(hi, last), p_flags: flags });
        folders[role] = { path, uidvalidity: uv, last_uid: last };
      } finally { lock.release(); }
    }
    await bye(client);
    await svc.rpc("dmail_sync_done", { p_account: acc.id, p_folders: folders, p_error: null });
    return { ok: true, added };
  } catch (e) {
    try { client.close(); } catch (_) { /* ignore */ }
    const er = e as Any; const msg = er?.authenticationFailed ? "Login failed — check the mailbox password" : String(er?.responseText || er?.message || e).slice(0, 300);
    await svc.rpc("dmail_sync_done", { p_account: acc.id, p_folders: null, p_error: msg });
    return { ok: false, error: msg };
  }
}

async function withFolder<T>(acc: Any, role: string, fn: (c: Any, paths: Record<Role, string | null>) => Promise<T>): Promise<T> {
  const client = imapFor(acc); await client.connect();
  try { const paths = await rolePaths(client, acc.folders); const path = paths[role as Role]; if (!path) throw new Error("folder not found: " + role);
    const lock = await client.getMailboxLock(path); try { return await fn(client, paths); } finally { lock.release(); }
  } finally { await bye(client); }
}
const groupByFolder = (refs: Any[]) => refs.reduce((g: Record<string, Any[]>, r) => ((g[r.folder] ||= []).push(r), g), {});

async function fetchParsed(acc: Any, ref: Any) {
  if (!ref?.uid) throw new Error("This message is still syncing — try again in a minute");
  return await withFolder(acc, ref.folder, async (c) => { const m = await c.fetchOne(String(ref.uid), { source: true }, { uid: true }); if (!m?.source) throw new Error("message not found on the mail server"); return await PostalMime.parse(m.source) as Any; });
}

async function actSend(svc: SupabaseClient, acc: Any, uid: string, b: Any) {
  const norm = (v: Any) => (Array.isArray(v) ? v : []).map((x: Any) => ({ email: String(x?.email || x || "").trim().toLowerCase(), name: String(x?.name || "") })).filter((x: Any) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x.email));
  const to = norm(b.to), cc = norm(b.cc), bcc = norm(b.bcc);
  if (!to.length && !cc.length && !bcc.length) return { error: "Add at least one recipient" };
  if (to.length + cc.length + bcc.length > 25) return { error: "Too many recipients (max 25 per email)" };
  let answered: Any = null, fwd: Any = null;
  if (b.reply_to || b.forward_of) { const { data } = await svc.rpc("dmail_msg_refs", { p_account: acc.id, p_ids: [b.reply_to || b.forward_of] }); const r = (data || [])[0]; if (b.reply_to) answered = r; else fwd = r; }
  const attachments: Any[] = []; let total = 0;
  for (const a of (b.attachments || [])) { const u8 = unb64(String(a.b64 || "")); total += u8.length; attachments.push({ filename: String(a.name || "file").slice(0, 200), content: u8, contentType: a.type || undefined }); }
  if (fwd && b.forward_attachments !== false) { try { const p = await fetchParsed(acc, fwd); for (const a of (p.attachments || [])) { if (a.related && a.contentId) continue; const u8 = bytesOf(a.content); total += u8.length; attachments.push({ filename: a.filename || "attachment", content: u8, contentType: a.mimeType }); } } catch (_) { /* forward without originals */ } }
  if (total > MAX_ATTACH) return { error: "Attachments are over 15 MB in total" };
  const sig = acc.signature_html ? `<br><div class="lb-sig" style="margin-top:14px">${acc.signature_html}</div>` : "";
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#1f2937;line-height:1.5">${String(b.html || "")}${sig}${b.quote_html ? "<br>" + String(b.quote_html) : ""}</div>`;
  const text = strip(html.replace(/<br\s*\/?>(?!\n)/gi, "\n").replace(/<\/(p|div|li|blockquote)>/gi, "\n"));
  const fmt = (l: Any[]) => l.map((x) => x.name ? { name: x.name, address: x.email } : x.email);
  const refs: string[] = answered?.message_id ? [...(answered.refs || []).filter((x: string) => x !== answered.message_id), answered.message_id].slice(-20) : [];
  const mail: Any = { from: { name: acc.display_name, address: acc.address }, to: fmt(to), cc: fmt(cc), bcc: fmt(bcc), subject: String(b.subject || "").slice(0, 900), html, text, attachments,
    ...(answered?.message_id ? { inReplyTo: answered.message_id, references: refs } : {}) };
  const built: Any = await new Promise((res, rej) => nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" }).sendMail(mail, (er: Any, info: Any) => er ? rej(er) : res(info)));
  const rawMsg: Uint8Array = built.message; const messageId: string = built.messageId;
  const smtp = nodemailer.createTransport({ host: acc.smtp_host, port: acc.smtp_port, secure: acc.smtp_port === 465, auth: { user: acc.username, pass: acc.password }, connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000 });
  try { await smtp.sendMail({ envelope: { from: acc.address, to: [...to, ...cc, ...bcc].map((x) => x.email) }, raw: rawMsg }); }
  catch (e) { return { error: "Could not send: " + String((e as Any)?.response || (e as Any)?.message || e).slice(0, 240) }; }
  finally { try { smtp.close(); } catch (_) { /* ignore */ } }
  // The mail is on the wire. Everything below is bookkeeping and must never turn a sent mail into an "error".
  let ap: Any = null;
  try { ap = await withFolder(acc, "sent", async (c, paths) => {
      const r = await c.append(paths.sent!, rawMsg, ["\\Seen"]);
      if (answered?.uid && answered.folder) { try { const l2 = await c.getMailboxLock(paths[answered.folder as Role]!); try { await c.messageFlagsAdd(String(answered.uid), ["\\Answered"], { uid: true }); } finally { l2.release(); } } catch (_) { /* best effort */ } }
      return r; }); } catch (_) { /* the next sync will pick the Sent copy up if the server saved one */ }
  const meta = attachments.map((a, idx) => ({ idx, name: a.filename, type: a.contentType || "application/octet-stream", size: a.content.length, inline: false }));
  const { data: sid } = await svc.rpc("dmail_sent_store", { p_account: acc.id, p_user: uid, p_draft: b.draft_id || null, p_msg: {
    uid: ap?.uid ? Number(ap.uid) : null, uidvalidity: ap?.uidValidity ? Number(ap.uidValidity) : null, message_id: messageId, in_reply_to: answered?.message_id || null, refs,
    from_name: acc.display_name, from_email: acc.address, to, cc, bcc, subject: mail.subject, snippet: strip(String(b.html || "")).slice(0, 180), text, html, attachments: meta, answered_id: answered?.id || null } });
  return { ok: true, id: sid, saved_to_sent: !!ap };
}

async function actFlags(svc: SupabaseClient, acc: Any, b: Any) {
  const { data } = await svc.rpc("dmail_msg_refs", { p_account: acc.id, p_ids: b.ids || [] }); const refs: Any[] = data || [];
  const patch: Any = {}; if (typeof b.seen === "boolean") patch.seen = b.seen; if (typeof b.starred === "boolean") patch.starred = b.starred;
  for (const [folder, rows] of Object.entries(groupByFolder(refs.filter((r) => r.uid && r.folder !== "drafts")))) {
    const uids = (rows as Any[]).map((r) => r.uid).join(",");
    await withFolder(acc, folder, async (c) => {
      if ("seen" in patch) await (patch.seen ? c.messageFlagsAdd(uids, ["\\Seen"], { uid: true }) : c.messageFlagsRemove(uids, ["\\Seen"], { uid: true }));
      if ("starred" in patch) await (patch.starred ? c.messageFlagsAdd(uids, ["\\Flagged"], { uid: true }) : c.messageFlagsRemove(uids, ["\\Flagged"], { uid: true }));
    });
  }
  await svc.rpc("dmail_msg_patch", { p_account: acc.id, p_ids: refs.map((r) => r.id), p: patch });
  return { ok: true };
}

async function actMove(svc: SupabaseClient, acc: Any, b: Any) {
  const dest = String(b.to || ""); if (!["inbox", "trash", "spam"].includes(dest)) return { error: "bad destination" };
  const { data } = await svc.rpc("dmail_msg_refs", { p_account: acc.id, p_ids: b.ids || [] });
  const refs: Any[] = (data || []).filter((r: Any) => r.folder !== dest && r.folder !== "drafts");
  for (const [folder, rows] of Object.entries(groupByFolder(refs))) {
    const withUid = (rows as Any[]).filter((r) => r.uid); let uidmap: Any = {}, uv: number | null = null;
    if (withUid.length) await withFolder(acc, folder, async (c, paths) => {
      const r: Any = await c.messageMove(withUid.map((x) => x.uid).join(","), paths[dest as Role]!, { uid: true });
      if (r?.uidMap) for (const [k, v] of r.uidMap) uidmap[String(k)] = Number(v);
      if (r?.uidValidity) uv = Number(r.uidValidity);
    });
    await svc.rpc("dmail_msg_patch", { p_account: acc.id, p_ids: (rows as Any[]).map((r) => r.id), p: { folder: dest, uidmap, uidvalidity: uv } });
  }
  return { ok: true };
}

async function actDelete(svc: SupabaseClient, acc: Any, b: Any) {
  const { data } = await svc.rpc("dmail_msg_refs", { p_account: acc.id, p_ids: b.ids || [] });
  const refs: Any[] = (data || []).filter((r: Any) => r.folder === "trash" || r.folder === "spam");
  for (const [folder, rows] of Object.entries(groupByFolder(refs))) {
    const uids = (rows as Any[]).filter((r) => r.uid).map((r) => r.uid);
    if (uids.length) await withFolder(acc, folder, (c) => c.messageDelete(uids.join(","), { uid: true }));
    await svc.rpc("dmail_msg_patch", { p_account: acc.id, p_ids: (rows as Any[]).map((r) => r.id), p: { delete: true } });
  }
  return { ok: true };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") { const asked = req.headers.get("access-control-request-headers"); return new Response("ok", { headers: asked ? { ...CORS, "Access-Control-Allow-Headers": asked } : CORS }); }
  const URL_ = Deno.env.get("SUPABASE_URL")!, SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
  const b: Any = await req.json().catch(() => ({}));
  try {
    const secret = req.headers.get("x-dmail-secret");
    if (secret) {
      const { data: ok } = await svc.rpc("dmail_cron_check", { p_secret: secret }); if (!ok) return json({ error: "forbidden" }, 403);
      const { data: accs } = await svc.rpc("dmail_sync_targets", { p_account: null });
      const out = []; for (const a of (accs || [])) out.push({ id: a.id, ...(await syncAccount(svc, a)) });
      return json({ ok: true, synced: out });
    }
    const authz = req.headers.get("Authorization") || ""; if (!authz || !b.account) return json({ error: "not signed in" }, 401);
    const uc = createClient(URL_, ANON, { global: { headers: { Authorization: authz } }, auth: { persistSession: false } });
    const { data: ax } = await uc.rpc("dmail_access", { p_account: b.account });
    if (!ax?.ok || !ax?.uid) return json({ error: "not authorized" }, 403);
    const { data: accs } = await svc.rpc("dmail_sync_targets", { p_account: b.account }); const acc = (accs || [])[0];
    if (!acc) return json({ error: "This mailbox has no password saved yet" }, 400);
    switch (b.action) {
      case "sync": return json(await syncAccount(svc, acc));
      case "verify": {
        if (!ax.staff) return json({ error: "not authorized" }, 403);
        // Explicit timeouts: nodemailer defaults are 2 min connect / 10 min socket, so a throttled or silent mail server
        // made "Test connection" hang until the gateway gave up with a 504 instead of showing a real error.
        const tx = nodemailer.createTransport({ host: acc.smtp_host, port: acc.smtp_port, secure: acc.smtp_port === 465, auth: { user: acc.username, pass: acc.password }, connectionTimeout: 12000, greetingTimeout: 12000, socketTimeout: 15000 });
        try { await tx.verify(); }
        catch (e) { const msg = (e as Any)?.code === "EAUTH" ? "Login failed — check the mailbox password" : "SMTP: " + String((e as Any)?.message || e).slice(0, 200); await svc.rpc("dmail_sync_done", { p_account: acc.id, p_folders: null, p_error: msg }); return json({ ok: false, error: msg }); }
        finally { try { tx.close(); } catch (_) { /* ignore */ } }
        return json(await syncAccount(svc, acc));
      }
      case "send": return json(await actSend(svc, acc, ax.uid, b));
      case "mark": return json(await actFlags(svc, acc, b));
      // bl_dmail_0357 (owner, 20 Sep 2026): a dispatcher can NEVER delete mail — Trash and delete-forever are staff-only.
      case "move": if (b.to === "trash" && !ax.staff) return json({ error: "Only LoadBoot staff can delete email" }, 403); return json(await actMove(svc, acc, b));
      case "delete": if (!ax.staff) return json({ error: "Only LoadBoot staff can delete email" }, 403); return json(await actDelete(svc, acc, b));
      case "attachment": {
        const { data } = await svc.rpc("dmail_msg_refs", { p_account: acc.id, p_ids: [b.id] }); const p = await fetchParsed(acc, (data || [])[0]);
        const a = (p.attachments || [])[Number(b.idx)]; if (!a) return json({ error: "attachment not found" }, 404);
        return new Response(bytesOf(a.content), { headers: { ...CORS, "Content-Type": a.mimeType || "application/octet-stream", "Content-Disposition": `attachment; filename="${String(a.filename || "attachment").replace(/[^\w.\- ]+/g, "_")}"` } });
      }
      default: return json({ error: "unknown action" }, 400);
    }
  } catch (e) { return json({ error: String((e as Any)?.message || e).slice(0, 300) }, 500); }
});
