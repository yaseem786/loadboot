// broker-agents.js — "Agents & team" for a brokerage that holds its own MC (bl_bp_0313).
// The parent decides who may post under its authority: approve / decline agents who declared
// it, revoke access later (open postings are pulled), and invite agents by email — an invited
// address is confirmed automatically the moment it signs up and names this brokerage.
// Self-contained: own h/mount, reuses the .bt-* styles injected by broker-trust.js.
import { partnerAgentsList, partnerAgentDecide, partnerAgentInvite, partnerAgentInviteRevoke, partnerTrustStatus } from '../shared/api.js';
import { ensureCss as ensureTrustCss } from './broker-trust.js';

const h = (tag, attrs, kids) => {
  const e = document.createElement(tag);
  if (attrs) for (const k in attrs) {
    if (k === 'class') e.className = attrs[k];
    else if (k === 'html') e.innerHTML = attrs[k];
    else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') e[k.toLowerCase()] = attrs[k];
    else if (attrs[k] != null && attrs[k] !== false) e.setAttribute(k, attrs[k]);
  }
  (Array.isArray(kids) ? kids : kids != null ? [kids] : []).forEach(c => c != null && e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c));
  return e;
};
const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };
const when = (ts) => ts ? new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '—';

const CSS = `
.ba-list{display:flex;flex-direction:column;gap:10px;margin-top:12px}
.ba-row{display:flex;gap:12px;align-items:center;flex-wrap:wrap;border:1px solid #e6ebf3;border-radius:14px;padding:12px 14px;background:#fff}
.ba-row.pending{border-color:#fcd34d;background:#fffbeb}
.ba-row .n{font-weight:800;color:#10223B}.ba-row .s{font-size:.82rem;color:#64748b;margin-top:2px}
.ba-row .grow{flex:1;min-width:220px}
.ba-acts{display:flex;gap:6px;flex-wrap:wrap}
.ba-btn{border:1.5px solid #e2e8f0;background:#fff;border-radius:10px;padding:8px 12px;font-weight:800;font-size:.82rem;color:#334155;cursor:pointer}
.ba-btn.ok{background:#0883F7;border-color:#0883F7;color:#fff}.ba-btn.bad{color:#c62828;border-color:#fecaca}
.ba-btn:disabled{opacity:.5;cursor:default}
.ba-empty{color:#64748b;font-size:.9rem;padding:14px;border:1px dashed #cbd5e1;border-radius:12px;margin-top:12px;background:#fbfcfe}
`;
let cssDone = false;
function ensureCss() { if (cssDone) return; cssDone = true; const s = document.createElement('style'); s.id = 'ba-css'; s.textContent = CSS; document.head.appendChild(s); }

const TIER_TXT = { agent_confirmed: 'posting · limited', agent_pending: 'waiting for you', hold: 'on hold', new: 'screening', verified: 'verified' };

export function mountBrokerAgents(host) {
  ensureTrustCss(); ensureCss();
  let data = null; let st = null;
  const body = h('div');
  const banner = h('div');
  mount(host, h('div', { class: 'bt-wrap' }, [
    h('div', { class: 'bt-card' }, [
      h('h3', null, 'Agents & team'),
      h('div', { class: 'bt-sub' }, 'Agents post loads under your MC. Every posting shows your legal name and MC, the rate confirmation has to be on your paper, and you can pull an agent’s access at any time — their open postings come down with it. Nothing an unconfirmed agent posts can be booked.'),
      banner,
    ]),
    body,
  ]));
  load();

  async function load() {
    mount(body, h('div', { class: 'bt-card' }, h('div', { class: 'bt-sub' }, 'Loading…')));
    try { [data, st] = await Promise.all([partnerAgentsList(), partnerTrustStatus().catch(() => null)]); }
    catch (e) { mount(body, h('div', { class: 'bt-card' }, h('div', { class: 'bt-err' }, (e && e.message) || 'Could not load.'))); return; }
    paint();
  }

  async function decide(a, decision) {
    const note = decision === 'confirm' ? null : prompt(decision === 'revoke' ? 'Why are you revoking access? (the agent sees this)' : 'Why? (the agent sees this)');
    if (decision !== 'confirm' && note === null) return;
    if (decision === 'revoke' && !confirm('Revoke ' + (a.name || 'this agent') + '? Their ' + (a.open || 0) + ' open posting(s) will be cancelled.')) return;
    try { await partnerAgentDecide(a.org_id, decision, note || null); await load(); }
    catch (e) { alert((e && e.message) || 'Could not save.'); }
  }

  function agentRow(a) {
    const pending = a.status === 'pending';
    const acts = [];
    if (pending) { acts.push(h('button', { class: 'ba-btn ok', onClick: () => decide(a, 'confirm') }, '✓ Approve')); acts.push(h('button', { class: 'ba-btn bad', onClick: () => decide(a, 'decline') }, 'Decline')); }
    else if (a.status === 'confirmed') acts.push(h('button', { class: 'ba-btn bad', onClick: () => decide(a, 'revoke') }, 'Revoke access'));
    else acts.push(h('button', { class: 'ba-btn', onClick: () => decide(a, 'confirm') }, 'Approve after all'));
    return h('div', { class: 'ba-row' + (pending ? ' pending' : '') }, [
      h('div', { class: 'grow' }, [
        h('div', { class: 'n' }, [a.name || '—', ' ', h('span', { class: 'bt-pill ' + (pending ? 'warn' : a.status === 'confirmed' ? 'ok' : 'bad') }, pending ? '⏳ wants to post under your MC' : a.status === 'confirmed' ? '✓ confirmed ' + when(a.confirmed_at) : '✕ declined ' + when(a.declined_at))]),
        h('div', { class: 's' }, (a.email || '') + ' · joined ' + when(a.since) + ' · ' + (a.loads || 0) + ' load' + (a.loads === 1 ? '' : 's') + ' posted' + (a.open ? ' · ' + a.open + ' open' : '') + (TIER_TXT[a.tier] ? ' · ' + TIER_TXT[a.tier] : '')),
      ]),
      h('div', { class: 'ba-acts' }, acts),
    ]);
  }

  function inviteRow(i) {
    return h('div', { class: 'ba-row' }, [
      h('div', { class: 'grow' }, [
        h('div', { class: 'n' }, [i.email, ' ', h('span', { class: 'bt-pill ' + (i.status === 'accepted' ? 'ok' : i.status === 'pending' ? 'info' : 'muted') }, i.status === 'accepted' ? '✓ joined ' + when(i.accepted_at) : i.status === 'pending' ? 'invited ' + when(i.created_at) : 'revoked')]),
        i.name ? h('div', { class: 's' }, i.name) : null,
      ]),
      i.status === 'pending' ? h('div', { class: 'ba-acts' }, h('button', { class: 'ba-btn', onClick: async () => { try { await partnerAgentInviteRevoke(i.id); await load(); } catch (e) { alert((e && e.message) || 'Could not revoke.'); } } }, 'Cancel invite')) : null,
    ]);
  }

  function inviteCard() {
    const canInvite = !st || ['screened', 'verified'].includes(st.tier);
    const err = h('div', { class: 'bt-err' });
    const em = h('input', { class: 'bt-in', type: 'email', placeholder: 'agent@yourbrokerage.com', autocomplete: 'off' });
    const nm = h('input', { class: 'bt-in', placeholder: 'Name (optional)', style: 'flex:0 1 220px' });
    const btn = h('button', { class: 'bt-btn', disabled: !canInvite }, 'Send invite →');
    btn.onclick = async () => {
      err.textContent = ''; const v = em.value.trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) { err.textContent = 'Enter a valid email.'; return; }
      btn.disabled = true; btn.textContent = 'Sending…';
      try { await partnerAgentInvite(v, nm.value.trim() || null); em.value = ''; nm.value = ''; await load(); }
      catch (e) { err.textContent = (e && e.message) || 'Could not send.'; }
      btn.disabled = false; btn.textContent = 'Send invite →';
    };
    return h('div', { class: 'bt-card' }, [
      h('h3', null, 'Invite an agent'),
      h('div', { class: 'bt-sub' }, 'They get one email: create a LoadBoot account with that address, choose “Broker Agent”, enter your MC. Because you invited them, they are confirmed the moment they sign up — no waiting, no second email.'),
      canInvite ? null : h('div', { class: 'bt-note', style: 'color:#b45309' }, 'Confirm your own brokerage first (Dashboard → step 1b), then you can invite agents.'),
      h('div', { class: 'bt-row' }, [em, nm, btn]),
      err,
    ]);
  }

  function paint() {
    const agents = (data && data.agents) || []; const invites = (data && data.invites) || [];
    const pending = agents.filter((a) => a.status === 'pending').length;
    mount(banner, pending ? h('div', { class: 'bt-idbox', style: 'border-color:#fcd34d;background:#fffbeb' }, [h('span', null, '⏳'), h('div', { class: 'm' }, pending + ' agent' + (pending === 1 ? '' : 's') + ' waiting for your approval — nothing they post can be booked until you decide.')]) : null);
    mount(body, [
      h('div', { class: 'bt-card' }, [
        h('h3', null, 'Agents under your authority'),
        h('div', { class: 'bt-sub' }, agents.length ? agents.length + ' agent' + (agents.length === 1 ? '' : 's') + ' linked to your MC.' : 'No one has declared themselves your agent yet.'),
        agents.length ? h('div', { class: 'ba-list' }, agents.map(agentRow)) : h('div', { class: 'ba-empty' }, 'When someone signs up as your agent, they appear here for approval. If an agent you never heard of appears, decline — that puts their account on hold and alerts our team.'),
      ]),
      inviteCard(),
      invites.length ? h('div', { class: 'bt-card' }, [h('h3', null, 'Invites'), h('div', { class: 'ba-list' }, invites.map(inviteRow))]) : null,
    ]);
  }
  return { refresh: load };
}
