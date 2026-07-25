// liveChat.js — CC Live chat: a scale-ready agent inbox (built for ~1000 concurrent chats).
// Human queue first (SLA timers), staff assignment, search across messages, canned replies,
// sound + tab-title alerts on new handoffs, AI-resolution stats, bot training panel.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, segmented, searchBox, fmtDateTime, openDrawer } from '../../shared/ui/components.js';
import { ccLcList, ccLcGet, ccLcReply, ccLcSetStatus, ccLcStats, ccLcMisses, ccLcTeach, ccLcMissDismiss, ccLcAssign, ccLcCannedList, ccLcCannedSave, ccRetellCallback, ccLcCalls, ccLcPresenceGet, ccLcPresenceSet } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ORIGIN_ICON = { website: '🌐', carrier: '🚚', partner: '🏢', agent: '🤝' };
const FILTERS = [
  { value: 'open', label: 'Open' }, { value: 'human', label: '🙋 Needs human' },
  { value: 'unread', label: 'Unread' }, { value: 'mine', label: 'Mine' },
  { value: 'leads', label: '🎯 Leads' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' },
];

function identity(c) {
  if (!c.user_id) {
    const vr = c.visitor_role ? (' · ' + c.visitor_role + ' lead') : '';
    return { label: (c.name || 'Anonymous visitor'), pill: '🌐 Visitor' + vr, tone: c.visitor_role ? 'blue' : 'gray' };
  }
  const role = (c.role || 'user');
  const ver = (c.profile_status || '').toLowerCase();
  const verified = ['verified', 'approved', 'active'].indexOf(ver) >= 0;
  return {
    label: c.company || c.name || c.email || 'Portal user',
    pill: (verified ? '✅ ' : '⏳ ') + role.charAt(0).toUpperCase() + role.slice(1) + (verified ? ' · verified' : (ver ? ' · ' + ver : '')),
    tone: verified ? 'green' : 'amber',
  };
}

function waitBadge(secs) {
  if (secs == null) return null;
  const m = Math.floor(secs / 60);
  const label = m < 1 ? 'now' : m < 60 ? m + 'm waiting' : Math.floor(m / 60) + 'h ' + (m % 60) + 'm waiting';
  const tone = m >= 10 ? 'red' : m >= 3 ? 'amber' : 'green';
  return el('span', { class: 'cc-pill cc-pill-' + tone, style: 'font-size:10.5px' }, '⏱ ' + label);
}

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator(); const g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = 880; g.gain.value = 0.06;
    o.start(); o.frequency.setValueAtTime(660, ctx.currentTime + 0.12);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.stop(ctx.currentTime + 0.4);
  } catch (e) { /* sound optional */ }
}

export function renderLiveChat(host) {
  let filter = 'open';
  let search = '';
  let activeId = null;
  let lastCount = 0;
  let lastNeedsHuman = null;
  let canned = [];
  let timer = null;

  const presenceHost = el('div', { style: 'margin-bottom:12px' });
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const listHost = el('div', { style: 'overflow-y:auto;max-height:calc(100vh - 360px)' });
  const threadHost = el('div', { class: 'lb-card', style: 'display:flex;flex-direction:column;min-height:460px' });
  const trainHost = el('div', { style: 'margin-top:16px' });
  const callsHost = el('div', { style: 'margin-top:16px' });

  if (!document.getElementById('lc-grid-css')) {
    const st = document.createElement('style');
    st.id = 'lc-grid-css';
    st.textContent = '.lc-grid{display:grid;grid-template-columns:minmax(300px,380px) 1fr;gap:16px;align-items:start}.lc-grid>*{min-width:0}@media(max-width:1100px){.lc-grid{grid-template-columns:1fr}}';
    document.head.appendChild(st);
  }
  const wrap = el('div', { class: 'lc-grid', style: 'margin-top:16px' }, [
    el('div', { class: 'lb-card' }, [
      searchBox('Search name, email, message text…', (v) => { search = v; loadList(); }),
      el('div', { style: 'margin:8px 0' }, segmented(FILTERS, filter, (v) => { filter = v; loadList(); })),
      listHost,
    ]),
    threadHost,
  ]);
  mount(host, el('div', null, [
    sectionHead('Live chat', 'Scale-ready inbox: the human queue floats to the top with waiting timers, AI handles the rest. Reply to take over — the visitor sees it instantly.'),
    presenceHost, kpis, wrap, callsHost, trainHost,
  ]));
  loadPresence();
  mount(threadHost, el('div', { class: 'lb-state' }, 'Pick a conversation on the left. 🙋 Needs-human chats always sort first, longest wait on top.'));
  loadStats(); loadList(); loadTraining(); loadCanned(); loadCalls();
  let callsTick = 0;
  timer = setInterval(() => { loadStats(); loadList(true); if (activeId) openThread(activeId, true); if (++callsTick % 5 === 0) loadCalls(); }, 6000);
  const obs = new MutationObserver(() => { if (!document.body.contains(kpis)) { clearInterval(timer); obs.disconnect(); document.title = document.title.replace(/^\(\d+\) /, ''); } });
  obs.observe(document.body, { childList: true, subtree: true });

  async function loadCanned() {
    try { const r = await ccLcCannedList(); if (Array.isArray(r)) canned = r; } catch (e) { /* optional */ }
  }

  async function loadStats() {
    let s; try { s = await ccLcStats(); } catch (e) { return; }
    if (!s || s.error) return;
    // sound + tab title alert when the human queue grows
    const nh = Number(s.needs_human || 0);
    if (lastNeedsHuman != null && nh > lastNeedsHuman) { beep(); toast('🙋 New chat needs a human (' + nh + ' waiting)'); }
    lastNeedsHuman = nh;
    document.title = (nh > 0 ? '(' + nh + ') ' : '') + document.title.replace(/^\(\d+\) /, '');
    const om = Math.floor((s.oldest_wait_secs || 0) / 60);
    mount(kpis, [
      statCard({ icon: 'alert', label: 'Needs human NOW', value: String(nh), sub: nh > 0 ? ('oldest waiting ' + (om < 60 ? om + 'm' : Math.floor(om / 60) + 'h')) : 'queue clear 🎉', accent: nh > 0 ? 'red' : 'green' }),
      statCard({ icon: 'bell', label: 'Open chats', value: String(s.open || 0), sub: (s.unread || 0) + ' unread messages', accent: 'blue' }),
      statCard({ icon: 'check', label: 'AI resolved today', value: String(s.ai_resolved_today || 0), sub: 'of ' + (s.today || 0) + ' new chats', accent: 'violet' }),
      statCard({ icon: 'users', label: 'Leads captured today', value: String(s.leads_today || 0), sub: 'name + email → CRM', accent: 'amber' }),
    ]);
  }

  async function loadList(silent) {
    if (!silent) showLoading(listHost, 'Loading chats…');
    let rows; try { rows = await ccLcList(filter, search || null); } catch (e) { if (!silent) showError(listHost, humanizeError(e), loadList); return; }
    if (!rows || rows.error) { if (!silent) showError(listHost, (rows && rows.error) || 'Failed', loadList); return; }
    if (!rows.length) { mount(listHost, el('div', { class: 'lb-state' }, search ? 'No chats match that search.' : 'Nothing here — when someone chats on the website or a portal, it appears instantly.')); return; }
    mount(listHost, el('div', null, rows.map(c => {
      const idn = identity(c);
      return el('div', {
        class: 'cc-row', style: 'padding:10px 12px;border-bottom:1px solid var(--lb-line,#1e293b);cursor:pointer;border-radius:10px' + (c.id === activeId ? ';background:rgba(8,131,247,.08)' : ''),
        onclick: () => { activeId = c.id; openThread(c.id); loadList(true); },
      }, [
        el('div', { style: 'display:flex;align-items:center;gap:8px' }, [
          el('span', null, ORIGIN_ICON[c.origin] || '💬'),
          el('b', { style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, idn.label),
          (c.staff_unread > 0) ? el('span', { class: 'cc-pill cc-pill-red' }, String(c.staff_unread)) : null,
          el('span', { class: 'cc-sub', style: 'font-size:11px' }, fmtDateTime(c.last_msg_at)),
        ]),
        el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:3px;flex-wrap:wrap' }, [
          el('span', { class: 'cc-pill cc-pill-' + idn.tone, style: 'font-size:10.5px' }, idn.pill),
          el('span', { class: 'cc-pill cc-pill-' + (c.mode === 'bot' ? 'blue' : 'violet'), style: 'font-size:10.5px' }, c.mode === 'bot' ? '⚡ AI' : '🧑 Human'),
          waitBadge(c.waiting_secs),
          c.assigned_email ? el('span', { class: 'cc-pill cc-pill-' + (c.assigned_me ? 'green' : 'gray'), style: 'font-size:10.5px' }, '👤 ' + (c.assigned_me ? 'you' : c.assigned_email.split('@')[0])) : null,
          c.email ? el('span', { class: 'cc-pill cc-pill-amber', style: 'font-size:10.5px' }, '🎯 lead') : null,
        ]),
        el('div', { class: 'cc-sub', style: 'margin-top:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, c.last_msg || ''),
      ]);
    })));
  }

  async function openThread(id, silent) {
    if (!silent) mount(threadHost, el('div', { class: 'lb-state lb-loading' }, 'Loading conversation…'));
    let c; try { c = await ccLcGet(id); } catch (e) { if (!silent) mount(threadHost, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    if (!c || c.error) { if (!silent) mount(threadHost, el('div', { class: 'lb-state lb-error' }, (c && c.error) || 'Not found')); return; }
    if (silent && c.messages && c.messages.length === lastCount && c.id === activeId) return;
    lastCount = (c.messages || []).length;
    const idn = identity(c);
    const msgs = el('div', { style: 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:8px 2px;max-height:calc(100vh - 500px)' },
      (c.messages || []).map(m => {
        const mine = m.sender !== 'visitor';
        const clean = String(m.body).replace(/\[\[(chips|form)[^\]]*\]\]/g, '').trim();
        return el('div', { style: 'display:flex;flex-direction:column;align-items:' + (mine ? 'flex-end' : 'flex-start') }, [
          el('span', { class: 'cc-sub', style: 'font-size:10px;margin:0 4px 1px' },
            (m.sender === 'bot' ? '⚡ AI assistant' : m.sender === 'staff' ? '🧑 Staff' : idn.label) + ' · ' + fmtDateTime(m.at)),
          el('div', { style: 'max-width:80%;padding:9px 12px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;' +
            (m.sender === 'visitor' ? 'background:rgba(148,163,184,.15)' : m.sender === 'bot' ? 'background:rgba(8,131,247,.15)' : 'background:rgba(252,83,5,.18)') }, clean),
        ]);
      }));
    const inp = el('textarea', { class: 'cc-input', rows: '2', placeholder: 'Reply as LoadBoot team… (Enter to send · ⚡ for saved replies)' });
    const reply = async () => {
      const t = inp.value.trim(); if (!t) return;
      inp.value = '';
      try { const r = await ccLcReply(id, t); if (r && r.error) throw new Error(r.error); openThread(id); loadList(true); }
      catch (e2) { toast(humanizeError(e2), 'error'); }
    };
    inp.addEventListener('keydown', async (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); await reply(); } });

    // canned replies palette
    const cannedHost = el('div', { style: 'display:none;flex-wrap:wrap;gap:6px;margin-top:6px' });
    const renderCanned = () => mount(cannedHost, (canned || []).map(cr =>
      el('button', { class: 'lb-btn lb-btn-ghost', style: 'font-size:12px', title: cr.body, onclick: () => { inp.value = cr.body; inp.focus(); cannedHost.style.display = 'none'; } }, cr.title))
      .concat([el('button', { class: 'lb-btn lb-btn-ghost', style: 'font-size:12px;opacity:.7', onclick: async () => {
        const t = prompt('Saved reply title:'); if (!t) return;
        const b = prompt('Saved reply text:'); if (!b) return;
        const r = await ccLcCannedSave(t, b); if (r && r.error) { toast(r.error, 'error'); return; }
        await loadCanned(); renderCanned(); toast('Saved reply added ✓');
      } }, '+ New saved reply')]));
    renderCanned();

    mount(threadHost, el('div', { style: 'display:flex;flex-direction:column;height:100%' }, [
      el('div', { class: 'fa-cardhead', style: 'flex-wrap:wrap;gap:8px' }, [
        el('h3', { style: 'margin-right:auto' }, idn.label),
        el('div', { style: 'display:flex;gap:6px;align-items:center;flex-wrap:wrap' }, [
          el('span', { class: 'cc-pill cc-pill-' + idn.tone }, idn.pill),
          el('span', { class: 'cc-pill cc-pill-gray' }, (ORIGIN_ICON[c.origin] || '') + ' ' + c.origin + (c.page ? ' · ' + c.page : '')),
          c.mc ? el('span', { class: 'cc-pill cc-pill-blue' }, 'MC ' + c.mc) : null,
          c.dot ? el('span', { class: 'cc-pill cc-pill-blue' }, 'DOT ' + c.dot) : null,
          c.email ? el('span', { class: 'cc-sub' }, c.email) : null,
          el('button', { class: 'lb-btn lb-btn-ghost', onclick: async () => { await ccLcAssign(id, true); toast('Assigned to you ✓'); openThread(id); loadList(true); } }, '👤 Take it'),
          el('button', { class: 'lb-btn lb-btn-ghost', onclick: async () => {
            await ccLcSetStatus(id, c.status === 'open' ? 'closed' : 'open'); openThread(id); loadList(true);
          } }, c.status === 'open' ? 'Close' : 'Reopen'),
        ]),
      ]),
      msgs,
      el('div', { style: 'margin-top:8px' }, [
        el('div', { style: 'display:flex;gap:8px;align-items:flex-end' }, [
          el('button', { class: 'lb-btn lb-btn-ghost', title: 'Saved replies', onclick: () => { cannedHost.style.display = cannedHost.style.display === 'none' ? 'flex' : 'none'; } }, '⚡'),
          el('div', { style: 'flex:1;min-width:0' }, inp),
          el('button', { class: 'lb-btn lb-btn-primary', onclick: reply }, 'Send'),
        ]),
        cannedHost,
      ]),
    ]));
    msgs.scrollTop = msgs.scrollHeight;
  }

  async function loadPresence() {
    let pr; try { pr = await ccLcPresenceGet(); } catch (e) { mount(presenceHost, ''); return; }
    if (!pr || pr.error) { mount(presenceHost, ''); return; }
    const nameIn = el('input', { class: 'cc-input', placeholder: 'Your name (visitor will see it)', value: pr.staff_name || '', style: 'width:210px' });
    const desigIn = el('input', { class: 'cc-input', placeholder: 'Designation (e.g. Carrier Success Manager)', value: pr.designation || 'Carrier Success Manager', style: 'width:260px' });
    mount(presenceHost, el('div', { class: 'lb-card', style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;border:1.5px solid ' + (pr.available ? 'rgba(34,197,94,.5)' : 'var(--lb-line,#1e293b)') }, [
      el('span', { style: 'font-size:1.3rem' }, pr.available ? '🟢' : '⚪'),
      el('div', { style: 'min-width:180px' }, [
        el('b', null, pr.available ? ('LIVE — ' + (pr.staff_name || '')) : 'Team offline'),
        el('div', { class: 'cc-sub', style: 'font-size:11.5px' }, pr.available
          ? 'AI is telling visitors: "Connecting you with ' + (pr.staff_name || '') + ', our ' + (pr.designation || '') + '" — reply fast!'
          : 'AI collects the full question + preferred contact, promises an email follow-up'),
      ]),
      nameIn, desigIn,
      el('button', { class: 'lb-btn ' + (pr.available ? 'lb-btn-ghost' : 'lb-btn-primary'), onclick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true;
        try {
          const r = await ccLcPresenceSet(!pr.available, nameIn.value, desigIn.value);
          if (r && r.error) throw new Error(r.error);
          toast(pr.available ? 'Ab offline — AI emails ka wada karegi' : '🟢 Tum LIVE ho — naye handoffs tumhare naam ke saath aayenge');
          loadPresence();
        } catch (e2) { toast(humanizeError(e2), 'error'); b.disabled = false; }
      } }, pr.available ? '⏸ Go offline' : '🟢 I\'m available'),
    ]));
  }

  async function loadCalls() {
    let rows; try { rows = await ccLcCalls(); } catch (e) { mount(callsHost, ''); return; }
    if (!rows || rows.error) { mount(callsHost, ''); return; }
    const phone = el('input', { class: 'cc-input', placeholder: 'US phone e.g. +15551234567', style: 'min-width:170px' });
    const nm = el('input', { class: 'cc-input', placeholder: 'Their name (Riley uses it)', style: 'min-width:150px' });
    const tp = el('input', { class: 'cc-input', placeholder: 'Topic they asked about (e.g. detention pay)', style: 'flex:1;min-width:200px' });
    const rl = el('select', { class: 'cc-input', style: 'width:130px' }, ['carrier', 'broker', 'shipper', 'dispatcher', 'other'].map(r => el('option', { value: r }, r)));
    const ctx = el('textarea', { class: 'cc-input', rows: '2', placeholder: 'Context for Riley (e.g. email summary: "asked about factoring, has 3 trucks, factor charges 4%") — she uses it naturally on the call', style: 'flex-basis:100%' });
    const when = el('input', { class: 'cc-input', type: 'datetime-local', style: 'width:200px' });
    mount(callsHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, '📞 Riley phone calls'),
        el('span', null, 'Callback ONLY for people who asked for a call (email/chat) — never cold lists')]),
      el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px' }, [
        phone, nm, tp, rl,
        el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
          const b = ev.currentTarget; b.disabled = true; b.textContent = 'Dialing…';
          try {
            const r = await ccRetellCallback({ to: phone.value, name: nm.value, topic: tp.value, role: rl.value, context: ctx.value, when: when.value ? new Date(when.value).toISOString() : null });
            if (r && r.error) throw new Error(r.error);
            toast(r.scheduled ? '📅 Call scheduled ✓' : '📞 Riley is calling them now ✓'); phone.value = ''; nm.value = ''; tp.value = ''; ctx.value = ''; when.value = '';
            setTimeout(loadCalls, 1500);
          } catch (e2) { toast(humanizeError(e2), 'error'); }
          b.disabled = false; b.textContent = '📞 Riley calls them';
        } }, '📞 Riley calls them'),
        ctx,
        el('span', { class: 'cc-sub', style: 'font-size:11px' }, 'Schedule (optional — empty = call right now):'), when,
      ]),
      rows.length ? el('table', { class: 'cc-table' }, [
        el('thead', null, el('tr', null, ['When', 'Number', 'Name', 'Dir', 'Status', 'Length', 'Summary', ''].map(h => el('th', null, h)))),
        el('tbody', null, rows.map(c => el('tr', { class: 'cc-row' }, [
          el('td', null, fmtDateTime(c.at)),
          el('td', null, c.direction === 'outbound' ? (c.to_number || '—') : (c.from_number || '—')),
          el('td', null, c.name || '—'),
          el('td', null, c.direction === 'outbound' ? '↗ out' : '↘ in'),
          el('td', null, el('span', { class: 'cc-pill cc-pill-' + (c.status === 'ended' || c.status === 'analyzed' ? 'green' : c.status === 'in-progress' ? 'blue' : 'amber') }, c.status)),
          el('td', null, c.duration_sec != null ? (Math.floor(c.duration_sec / 60) + 'm ' + (c.duration_sec % 60) + 's') : '—'),
          el('td', { style: 'max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' },
            (c.source === 'website' ? '🌐 ' : '') + (c.status === 'scheduled' && c.scheduled_at ? '📅 ' + fmtDateTime(c.scheduled_at) + ' · ' : '') + (c.summary || c.topic || '—')),
          el('td', null, c.transcript ? el('button', { class: 'lb-btn lb-btn-ghost', onclick: () => {
            const dr = openDrawer('Call transcript', el('div', null, [
              el('p', { class: 'cc-sub' }, (c.name || c.to_number || '') + (c.summary ? ' — ' + c.summary : '')),
              el('pre', { style: 'white-space:pre-wrap;font-size:12.5px;line-height:1.6' }, c.transcript),
            ]), { subtitle: 'Recording is in the Retell dashboard → Calls' });
          } }, '📄 Transcript') : null),
        ]))),
      ]) : el('div', { class: 'lb-state' }, 'No calls yet. Inbound calls and Riley callbacks will appear here automatically with transcripts.'),
    ]));
  }

  async function loadTraining() {
    let rows; try { rows = await ccLcMisses(); } catch (e) { mount(trainHost, ''); return; }
    if (!rows || rows.error) { mount(trainHost, ''); return; }
    mount(trainHost, el('div', { class: 'lb-card' }, [
      el('div', { class: 'fa-cardhead' }, [el('h3', null, '🧠 Bot training — questions the AI could not answer'),
        el('span', null, rows.length + ' waiting · teach an answer and the bot learns it instantly')]),
      rows.length ? el('div', null, rows.map(m => {
        const kw = el('input', { class: 'cc-input', placeholder: 'Keywords, comma separated (e.g. insurance cost, monthly insurance)', style: 'flex:2;min-width:200px' });
        const ans = el('input', { class: 'cc-input', placeholder: 'The answer the bot should give (links allowed)', style: 'flex:3;min-width:260px' });
        return el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:10px 0;border-bottom:1px solid var(--lb-line,#1e293b)' }, [
          el('div', { style: 'flex-basis:100%;display:flex;gap:8px;align-items:center' }, [
            el('b', null, '“' + m.question + '”'),
            el('span', { class: 'cc-pill cc-pill-' + (m.n > 2 ? 'red' : 'amber') }, m.n + '×'),
            el('span', { class: 'cc-sub', style: 'font-size:11px' }, fmtDateTime(m.last_seen)),
          ]),
          kw, ans,
          el('button', { class: 'lb-btn lb-btn-primary', onclick: async (ev) => {
            const b = ev.currentTarget; b.disabled = true;
            try { const r = await ccLcTeach(m.id, kw.value, ans.value); if (r && r.error) throw new Error(r.error);
              toast('Bot learned it ✓'); loadTraining();
            } catch (e2) { toast(humanizeError(e2), 'error'); b.disabled = false; }
          } }, 'Teach'),
          el('button', { class: 'lb-btn lb-btn-ghost', onclick: async () => { await ccLcMissDismiss(m.id); loadTraining(); } }, 'Dismiss'),
        ]);
      })) : el('div', { class: 'lb-state' }, 'Nothing waiting — the AI answered everything it was asked. 🎉'),
      el('p', { class: 'cc-sub', style: 'margin-top:10px' }, 'Every unanswered question lands here with a counter. Add keywords + an answer → saved into the bot\'s knowledge base immediately. Check daily; the bot gets smarter from real user queries.'),
    ]));
  }
}
