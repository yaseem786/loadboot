// dispatcherMail.js — CC "Dispatcher email" (bl_dmail_0356): give a dispatcher a real company mailbox with no login.
//   1. Add the mailbox you bought (Namecheap Private Email): address + password. The password goes straight into
//      Supabase Vault through cc_dmail_account_save and is NEVER sent back to any browser — not even this one.
//   2. "Test connection" logs in over IMAP + SMTP from the server and pulls the first mail.
//   3. Assign it to a dispatcher → an Email tab appears in their portal. Unassign / pause = access gone instantly;
//      the mail itself stays with LoadBoot.
//   4. "Open inbox" is the same inbox the dispatcher sees (staff oversight) — and only staff can delete mail (bl_dmail_0357).
//   5. ALL EMAIL ACTIVITY — one feed of every email received / sent / replied across every mailbox: which mailbox, who it is
//      assigned to, who pressed Send, read / replied state. Click a row → that conversation opens in the mailbox.
// Staff-gated by the RPCs themselves (cc_dmail_* check disp_is_staff). No alert/confirm/prompt.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';
import { sectionHead, askConfirm } from '../../shared/ui/components.js';
import { ccDmailOverview, ccDmailActivity, ccDmailAccountSave, ccDmailAssign, ccDmailIdentityApply, ccDmailSetStatus, dmailAct } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { mountDispatcherMail, sigFrame } from '../../shared/dmail.js';

const CSS = `
.dmc{--tx:#e8eefc;--mu:#93a4c3;--ln:rgba(255,255,255,.09)}
.dmc-board{border-radius:18px;padding:18px;color:var(--tx);background:linear-gradient(160deg,#12284a,#0b1830 55%,#08111f);box-shadow:0 18px 50px rgba(8,20,45,.25);margin-bottom:16px}
.dmc-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px}
.dmc-card{background:rgba(255,255,255,.05);border:1px solid var(--ln);border-radius:16px;padding:16px;display:flex;flex-direction:column;gap:10px}
.dmc-card h4{margin:0;font-size:16px;color:#fff;overflow:hidden;text-overflow:ellipsis}.dmc-card .sub{color:var(--mu);font-size:12.5px}
.dmc-pill{display:inline-flex;align-items:center;gap:6px;border-radius:99px;padding:3px 10px;font-size:11.5px;font-weight:700}
.dmc-pill.g{background:rgba(34,197,94,.15);color:#86efac}.dmc-pill.a{background:rgba(245,158,11,.15);color:#fcd34d}.dmc-pill.r{background:rgba(239,68,68,.15);color:#fca5a5}.dmc-pill.m{background:rgba(255,255,255,.08);color:var(--mu)}
.dmc-err{font-size:12.5px;color:#fca5a5;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.25);border-radius:10px;padding:8px 10px}
.dmc-kp{display:flex;gap:16px;font-size:12px;color:var(--mu)}.dmc-kp b{color:#fff;font-size:15px;display:block}
.dmc-row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.dmc select,.dmc input,.dmc textarea{background:#08111f;border:1px solid var(--ln);border-radius:10px;color:#fff;padding:9px 11px;font:inherit;min-width:0}.dmc select{flex:1}
.dmc textarea{width:100%;min-height:110px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px}
.dmc-btn{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--ln);background:rgba(255,255,255,.06);color:#fff;border-radius:10px;padding:8px 13px;font:inherit;font-weight:700;font-size:13px;cursor:pointer}
.dmc-btn:hover{background:rgba(255,255,255,.12)}.dmc-btn.pri{background:linear-gradient(135deg,#0883F7,#0a6fd6);border-color:transparent}.dmc-btn:disabled{opacity:.5;cursor:default}
.dmc-form{display:grid;grid-template-columns:1fr 1fr;gap:12px}.dmc-form label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--mu);text-transform:uppercase;letter-spacing:.6px}.dmc-form .w{grid-column:1/-1}
.dmc-prev{background:#fff;color:#1f2937;border-radius:10px;padding:12px;font:14px/1.5 Arial,sans-serif;text-transform:none;letter-spacing:0}.dmc-note{font-size:12.5px;color:var(--mu);text-transform:none;letter-spacing:0}
.dmc-inbox{border-radius:18px;padding:16px;background:#081220}
.dmc-h{margin:0 0 12px;font-size:13px;letter-spacing:1.4px;text-transform:uppercase;color:var(--mu);display:flex;align-items:center;gap:8px}
.dmc-pulse{width:9px;height:9px;border-radius:50%;background:#22c55e;animation:dmcp 1.6s infinite}@keyframes dmcp{0%{box-shadow:0 0 0 0 rgba(34,197,94,.6)}70%{box-shadow:0 0 0 10px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}
.dmc-ks{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.dmc-k{background:rgba(255,255,255,.05);border:1px solid var(--ln);border-radius:14px;padding:12px 14px;font-size:11px;color:var(--mu);text-transform:uppercase;letter-spacing:.8px}.dmc-k b{display:block;font-size:24px;color:#fff;font-variant-numeric:tabular-nums}
.dmc-seg{display:inline-flex;border:1px solid var(--ln);border-radius:10px;overflow:hidden}.dmc-seg button{border:0;background:transparent;color:var(--mu);padding:9px 13px;font:inherit;font-weight:700;font-size:13px;cursor:pointer}.dmc-seg button.on{background:#0883F7;color:#fff}
.dmc-feed{display:flex;flex-direction:column;border:1px solid var(--ln);border-radius:14px;overflow:hidden}
.dmc-ev{display:grid;grid-template-columns:118px minmax(150px,210px) minmax(0,1fr) auto auto;gap:12px;align-items:center;text-align:left;border:0;border-bottom:1px solid var(--ln);background:transparent;color:var(--tx);padding:11px 14px;font:inherit;font-size:13px;cursor:pointer}
.dmc-ev:last-child{border-bottom:0}.dmc-ev:hover{background:rgba(255,255,255,.05)}.dmc-ev.un{background:rgba(8,131,247,.08)}.dmc-ev.un .bd b{color:#fff}
.dmc-ev small{display:block;color:var(--mu);font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dmc-ev .mb,.dmc-ev .bd{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dmc-ev .mb b{font-weight:700;display:block;overflow:hidden;text-overflow:ellipsis}
.dmc-dir{font-weight:800;font-size:11.5px;border-radius:99px;padding:4px 10px;text-align:center}.dmc-dir.i{background:rgba(8,131,247,.16);color:#9ccbff}.dmc-dir.o{background:rgba(252,83,5,.16);color:#ffb38f}
.dmc-ev .tg{display:flex;gap:6px}.dmc-ev .tg i{font-style:normal;font-size:11px;border-radius:99px;padding:2px 8px;background:rgba(255,255,255,.08);color:var(--mu);white-space:nowrap}.dmc-ev .tg i.g{background:rgba(34,197,94,.15);color:#86efac}.dmc-ev .tg i.a{background:rgba(245,158,11,.15);color:#fcd34d}.dmc-ev .tg i.r{background:rgba(239,68,68,.15);color:#fca5a5}
.dmc-ev .tm{color:var(--mu);font-size:12px;white-space:nowrap}
@media(max-width:900px){.dmc-ev{grid-template-columns:1fr auto;grid-template-areas:"dir tm" "mb mb" "bd bd" "tg tg";gap:6px}.dmc-dir{grid-area:dir;justify-self:start}.dmc-ev .tm{grid-area:tm}.dmc-ev .mb{grid-area:mb}.dmc-ev .bd{grid-area:bd;white-space:normal}.dmc-ev .tg{grid-area:tg;flex-wrap:wrap}.dmc-grid{grid-template-columns:1fr}}
@media(max-width:720px){.dmc-form{grid-template-columns:1fr}}
`;
function css() { if (document.getElementById('dmc-css')) return; const s = document.createElement('style'); s.id = 'dmc-css'; s.textContent = CSS; document.head.appendChild(s); }
const ago = (v) => { if (!v) return 'never'; const s = (Date.now() - new Date(v).getTime()) / 1000; return s < 90 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const PILL = { active: ['Live', 'g'], unverified: ['Needs a connection test', 'a'], error: ['Connection problem', 'r'], paused: ['Paused', 'm'] };

export function renderDispatcherMail(host) {
  css(); let data = null, editing = null, inbox = null, inboxOpen = null, inboxInst = null; const F = { account: '', dir: '', q: '' }; let feed = { rows: [], today: {} }, feedT = null;
  const root = el('div', { class: 'dmc' }); mount(host, root);
  const btn = (label, icn, fn, cls) => el('button', { class: 'dmc-btn ' + (cls || ''), type: 'button', onClick: fn }, [icn ? icon(icn, 15) : null, label]);
  async function load() { try { data = await ccDmailOverview(); if (data && data.error) throw new Error(data.error); } catch (e) { data = { accounts: [], dispatchers: [], failed: humanizeError(e) }; } await loadFeed(true); paint(); }
  async function loadFeed(silent) { try { const r = await ccDmailActivity({ account: F.account, dir: F.dir, q: F.q, limit: 80 }); if (r && r.error) throw new Error(r.error); feed = r || feed; } catch (e) { if (!silent) toast(humanizeError(e), 'error'); } if (!silent) paintFeed(); }
  async function run(b, fn, okMsg) { b.disabled = true; try { const r = await fn(); if (r && r.error) throw new Error(r.error); if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg, 'success'); await load(); return r; } catch (e) { toast(humanizeError(e), 'error'); b.disabled = false; } }
  async function verify(a, b) { b.disabled = true; b.lastChild.textContent = 'Testing…';
    try { const r = await dmailAct({ action: 'verify', account: a.id }); toast(r && r.ok ? 'Connected — IMAP and SMTP both logged in' + (r.added ? ', ' + r.added + ' email(s) pulled' : '') : 'Failed: ' + ((r && r.error) || 'unknown'), r && r.ok ? 'success' : 'error'); }
    catch (e) { toast(humanizeError(e), 'error'); } await load(); }

  function paint() {
    if (inboxInst) { try { inboxInst.destroy(); } catch (_) {} inboxInst = null; }
    if (inbox) { const h2 = el('div'); mount(root, [sectionHead('Inbox — ' + inbox.address, 'Staff view of the dispatcher\'s real mailbox', [btn('Back to mailboxes', 'back', () => { inbox = null; inboxOpen = null; load(); })]), el('div', { class: 'dmc-inbox' }, h2)]); inboxInst = mountDispatcherMail(h2, { accountId: inbox.id, open: inboxOpen }); return; }
    const parts = [sectionHead('Dispatcher email', 'A real company mailbox inside the dispatcher portal — assigned here, no login for the dispatcher', [btn('Add mailbox', 'mail', () => { editing = {}; paint(); }, 'pri')])];
    if (data.failed) parts.push(el('div', { class: 'dmc-board' }, el('div', { class: 'dmc-err' }, data.failed)));
    if (editing) parts.push(form(editing));
    const board = el('div', { class: 'dmc-board' });
    if (!data.accounts.length && !editing) mount(board, el('div', { class: 'sub', style: 'color:#93a4c3;padding:18px;text-align:center' }, 'No mailboxes yet. Buy the mailbox in Namecheap Private Email, then press “Add mailbox”.'));
    else mount(board, el('div', { class: 'dmc-grid' }, data.accounts.map(card)));
    parts.push(board); feedHost = el('div', { class: 'dmc-board' }); parts.push(feedHost); mount(root, parts); paintFeed();
  }
  let feedHost = null;
  function paintFeed() {
    if (!feedHost) return; const t = feed.today || {};
    const kp = (n, l) => el('div', { class: 'dmc-k' }, [el('b', null, String(n || 0)), l]);
    const sel = el('select', { 'aria-label': 'Mailbox', onChange: () => { F.account = sel.value; loadFeed(); } }, [el('option', { value: '' }, 'All mailboxes'), ...(data.accounts || []).map((a) => el('option', { value: a.id, selected: F.account === a.id || null }, a.address + (a.assigned_name ? ' — ' + a.assigned_name : '')))]);
    const seg = el('div', { class: 'dmc-seg' }, [['', 'All'], ['in', 'Received'], ['out', 'Sent']].map(([v, l]) => el('button', { type: 'button', class: F.dir === v ? 'on' : '', onClick: () => { F.dir = v; loadFeed(); } }, l)));
    const q = el('input', { type: 'search', placeholder: 'Search sender, subject, text…', value: F.q, onInput: () => { clearTimeout(feedT); feedT = setTimeout(() => { F.q = q.value.trim(); loadFeed().then(() => { const n = feedHost.querySelector('input[type=search]'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }); }, 400); } });
    const who = (r) => r.dir === 'out' ? 'To: ' + ((r.to || []).map((x) => x.name || x.email).join(', ') || '—') : ((r.from_name || '').trim() || r.from_email || 'Unknown');
    const when = (v) => { const d = new Date(v); return d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
    mount(feedHost, [
      el('h3', { class: 'dmc-h' }, [el('span', { class: 'dmc-pulse' }), 'All email activity']),
      el('div', { class: 'dmc-ks' }, [kp(t.received, 'received today'), kp(t.sent, 'sent today'), kp(t.unread, 'unread now'), kp(t.waiting, 'not replied · 7d')]),
      el('div', { class: 'dmc-row', style: 'margin:12px 0' }, [sel, seg, q, btn('Refresh', 'refresh', () => loadFeed())]),
      !feed.rows.length ? el('div', { class: 'sub', style: 'color:#93a4c3;padding:22px;text-align:center' }, 'No email yet. Everything a dispatcher receives or sends shows up here.') :
      el('div', { class: 'dmc-feed' }, feed.rows.map((r) => el('button', { type: 'button', class: 'dmc-ev' + (r.dir === 'in' && !r.seen ? ' un' : ''), onClick: () => { inbox = (data.accounts || []).find((a) => a.id === r.account) || { id: r.account, address: r.address }; inboxOpen = { thread: r.thread, folder: r.folder, subject: r.subject }; paint(); window.scrollTo({ top: 0 }); } }, [
        el('span', { class: 'dmc-dir ' + (r.dir === 'out' ? 'o' : 'i') }, r.dir === 'out' ? (r.is_reply ? '↩ Reply sent' : '↑ Sent') : '↓ Received'),
        el('span', { class: 'mb' }, [el('b', null, r.address), el('small', null, r.assigned_name ? 'Assigned: ' + r.assigned_name : 'Not assigned')]),
        el('span', { class: 'bd' }, [el('b', null, who(r)), el('span', null, ' · ' + (r.subject || '(no subject)')), el('small', null, r.snippet || '')]),
        el('span', { class: 'tg' }, [r.has_attach ? el('i', null, 'Attachment') : null, r.dir === 'in' ? el('i', { class: r.answered ? 'g' : (r.seen ? '' : 'a') }, r.answered ? 'Replied' : (r.seen ? 'Read' : 'Unread')) : el('i', null, 'by ' + (r.sent_by || '—')), r.folder === 'trash' || r.folder === 'spam' ? el('i', { class: 'r' }, r.folder) : null]),
        el('span', { class: 'tm' }, when(r.date))])))]);
  }
  function card(a) {
    const P = PILL[a.status] || PILL.unverified;
    const sel = el('select', { 'aria-label': 'Assign to dispatcher' }, [el('option', { value: '' }, '— not assigned —'), ...data.dispatchers.map((d) => el('option', { value: d.user_id, selected: d.user_id === a.assigned_to || null }, d.name + ' (' + d.status + ')'))]);
    const short = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).join(' ');
    const nm = el('input', { type: 'text', 'aria-label': 'Name on emails', placeholder: 'Name on emails', title: 'Emails go out as “LoadBoot Dispatch — <this name>” and the brand signature is built for this name', style: 'flex:1;min-width:120px' });
    const fillNm = () => { const d = data.dispatchers.find((x) => x.user_id === sel.value); nm.value = d ? (sel.value === a.assigned_to ? String(a.display_name || '').replace(/^LoadBoot Dispatch\s*[—-]\s*/, '') || short(d.name) : short(d.name)) : ''; nm.style.display = sel.value ? '' : 'none'; };
    sel.addEventListener('change', fillNm); fillNm();
    const testB = btn('Test connection', 'refresh', () => verify(a, testB));
    return el('div', { class: 'dmc-card' }, [
      el('div', { class: 'dmc-row', style: 'justify-content:space-between' }, [el('h4', null, a.address), el('span', { class: 'dmc-pill ' + P[1] }, P[0])]),
      el('div', { class: 'sub' }, a.display_name + ' · synced ' + ago(a.last_sync_at)),
      el('div', null, el('span', { class: 'dmc-pill ' + (a.assigned_name ? 'g' : 'm') }, a.assigned_name ? 'Assigned to ' + a.assigned_name : 'Not assigned to anyone')),
      a.last_error && a.status !== 'active' ? el('div', { class: 'dmc-err' }, a.last_error) : null,
      el('div', { class: 'dmc-kp' }, [el('span', null, [el('b', null, String(a.unread)), 'unread']), el('span', null, [el('b', null, String(a.received_7d)), 'received 7d']), el('span', null, [el('b', null, String(a.sent_7d)), 'sent 7d'])]),
      el('div', { class: 'dmc-row' }, [sel, nm, (() => { const b = btn('Assign', 'check', () => run(b, () => ccDmailAssign(a.id, sel.value || null, nm.value.trim() || null), (r) => !sel.value ? 'Unassigned — access removed' : ((r && r.display_name ? 'Sends as “' + r.display_name + '”. ' : '') + (r && r.welcome_email ? 'Email tab is live and the welcome email (features + rules) is on its way.' : 'Saved.'))), 'pri'); return b; })()]),
      el('div', { class: 'dmc-row' }, [btn('Open inbox', 'inbox', () => { inbox = a; paint(); }), btn('Edit', 'pen', () => { editing = a; paint(); window.scrollTo({ top: 0, behavior: 'smooth' }); }), testB,
        (() => { const pausing = a.status !== 'paused'; const b = btn(pausing ? 'Pause' : 'Resume', pausing ? 'pause' : 'play', async () => { if (pausing && !(await askConfirm('Pause ' + a.address + '?', { message: 'The dispatcher loses access immediately. Mail keeps arriving at Namecheap and syncs again when you resume.', confirmLabel: 'Pause mailbox' }))) return; run(b, () => ccDmailSetStatus(a.id, pausing ? 'paused' : 'active'), pausing ? 'Paused' : 'Resumed'); }); return b; })()]),
    ]);
  }
  function form(a) {
    const isNew = !a.id; const f = (label, input, wide) => el('label', { class: wide ? 'w' : '' }, [label, input]);
    const addr = el('input', { type: 'email', value: a.address || '', placeholder: 'aziz@loadboot.com', disabled: !isNew || null, autocomplete: 'off' });
    const name = el('input', { type: 'text', value: a.display_name || '', placeholder: 'LoadBoot Dispatch — Abdul Aziz' });
    const pw = el('input', { type: 'password', placeholder: isNew ? 'Mailbox password from Namecheap' : 'Leave empty to keep the saved password', autocomplete: 'new-password' });
    const sig = el('textarea', { placeholder: '<b>Name</b><br>Dispatcher · LoadBoot' }); sig.value = a.signature_html || '';
    const prev = el('div', { class: 'dmc-prev', style: 'padding:0;overflow:hidden' }); const drawPrev = () => { mount(prev, sig.value.trim() ? sigFrame(sig.value) : el('div', { style: 'padding:12px;color:#9ca3af' }, 'No signature yet — it is built automatically when you assign the mailbox.')); };
    sig.addEventListener('input', drawPrev); drawPrev();
    const tpl = btn('Rebuild brand signature', 'sparkle', async () => { if (isNew) { toast('Save and assign the mailbox first — the brand signature is built for the assigned dispatcher.', 'info'); return; } const n = (name.value || '').replace(/^LoadBoot Dispatch\s*[—-]\s*/, '').trim(); const r = await run(tpl, () => ccDmailIdentityApply(a.id, n || null), 'Brand signature and From name rebuilt'); if (r && r.ok) { editing = null; paint(); } });
    const save = btn(isNew ? 'Save mailbox' : 'Save changes', 'check', async () => {
      const r = await run(save, () => ccDmailAccountSave({ id: a.id || null, address: addr.value, display_name: name.value, password: pw.value, signature_html: sig.value }), 'Saved');
      if (r && r.ok) { editing = null; if (r.needs_verify) { toast('Password stored in the vault — testing the connection…', 'info'); try { const v = await dmailAct({ action: 'verify', account: r.id }); toast(v && v.ok ? 'Connected — the mailbox is live' : 'Connection failed: ' + ((v && v.error) || 'unknown'), v && v.ok ? 'success' : 'error'); } catch (e) { toast(humanizeError(e), 'error'); } } await load(); }
    }, 'pri');
    return el('div', { class: 'dmc-board' }, [el('h4', { style: 'margin:0 0 12px;color:#fff' }, isNew ? 'Add a mailbox' : 'Edit ' + a.address),
      el('div', { class: 'dmc-form' }, [f('Email address', addr), f('Name shown to recipients', name), f('Mailbox password', pw, true),
        el('div', { class: 'w dmc-note' }, 'NAME: the From name every broker and carrier sees. Assigning the mailbox sets it automatically to “LoadBoot Dispatch — <dispatcher name>” and builds the LoadBoot brand signature for that dispatcher (with their dialer number if they have one). You can still edit both here. PHOTO: a profile picture cannot be sent with an email — Gmail shows the photo of the Google account registered on this address (create a Google account with “use my current email” and set the LoadBoot logo there); other mail apps show initials.'),
        el('div', { class: 'w dmc-note' }, 'The password is encrypted in Supabase Vault and can never be read back in any screen. The dispatcher never sees or needs it.'),
        f('Signature (simple HTML — locked for the dispatcher)', sig, true), el('div', { class: 'w dmc-row' }, [tpl]), f('Preview', prev, true)]),
      el('div', { class: 'dmc-row', style: 'margin-top:14px' }, [save, btn('Cancel', 'x', () => { editing = null; paint(); })])]);
  }
  mount(root, el('div', { class: 'dmc-board' }, 'Loading…')); load();
}
export default { renderDispatcherMail };
