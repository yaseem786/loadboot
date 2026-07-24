// liveChat.js — CC Live chat inbox. Staff see every website/portal conversation with
// full identity (anonymous visitor vs logged-in user, role, company, verification
// status), watch the AI assistant's answers, and can jump in as a human at any time.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard, segmented, fmtDateTime } from '../../shared/ui/components.js';
import { ccLcList, ccLcGet, ccLcReply, ccLcSetStatus, ccLcStats } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';

const ORIGIN_ICON = { website: '🌐', carrier: '🚚', partner: '🏢', agent: '🤝' };

function identity(c) {
  if (!c.user_id) return { label: (c.name || 'Anonymous visitor'), pill: '🌐 Visitor', tone: 'gray' };
  const role = (c.role || 'user');
  const ver = (c.profile_status || '').toLowerCase();
  const verified = ['verified', 'approved', 'active'].indexOf(ver) >= 0;
  return {
    label: c.company || c.name || c.email || 'Portal user',
    pill: (verified ? '✅ ' : '⏳ ') + role.charAt(0).toUpperCase() + role.slice(1) + (verified ? ' · verified' : (ver ? ' · ' + ver : '')),
    tone: verified ? 'green' : 'amber',
  };
}

export function renderLiveChat(host) {
  let filter = 'open';
  let activeId = null;
  let lastCount = 0;
  let timer = null;

  const kpis = el('div', { class: 'cc-kpi-grid' });
  const listHost = el('div', { style: 'overflow-y:auto;max-height:calc(100vh - 320px)' });
  const threadHost = el('div', { class: 'lb-card', style: 'display:flex;flex-direction:column;min-height:420px' });

  const wrap = el('div', { class: 'fa-grid', style: 'margin-top:16px' }, [
    el('div', { class: 'lb-card' }, [
      segmented([{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }, { value: 'all', label: 'All' }], filter, (v) => { filter = v; loadList(); }),
      listHost,
    ]),
    threadHost,
  ]);
  mount(host, el('div', null, [
    sectionHead('Live chat', 'Every website & portal conversation. The AI assistant answers instantly; reply here to take over as a human — the visitor sees it in the same window.'),
    kpis, wrap,
  ]));
  mount(threadHost, el('div', { class: 'lb-state' }, 'Pick a conversation on the left.'));
  loadStats(); loadList();
  timer = setInterval(() => { loadStats(); loadList(true); if (activeId) openThread(activeId, true); }, 6000);
  // Stop polling when the view is unmounted.
  const obs = new MutationObserver(() => { if (!document.body.contains(kpis)) { clearInterval(timer); obs.disconnect(); } });
  obs.observe(document.body, { childList: true, subtree: true });

  async function loadStats() {
    let s; try { s = await ccLcStats(); } catch (e) { return; }
    if (!s || s.error) return;
    mount(kpis, [
      statCard({ icon: 'bell', label: 'Open chats', value: String(s.open || 0), sub: 'conversations', accent: 'blue' }),
      statCard({ icon: 'alert', label: 'Unread', value: String(s.unread || 0), sub: 'messages waiting', accent: (s.unread || 0) > 0 ? 'amber' : 'green' }),
      statCard({ icon: 'users', label: 'Today', value: String(s.today || 0), sub: 'new conversations', accent: 'violet' }),
    ]);
  }

  async function loadList(silent) {
    if (!silent) showLoading(listHost, 'Loading chats…');
    let rows; try { rows = await ccLcList(filter); } catch (e) { if (!silent) showError(listHost, humanizeError(e), loadList); return; }
    if (!rows || rows.error) { if (!silent) showError(listHost, (rows && rows.error) || 'Failed', loadList); return; }
    if (!rows.length) { mount(listHost, el('div', { class: 'lb-state' }, 'No conversations here yet. When someone chats on the website or a portal, it appears instantly.')); return; }
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
        el('div', { style: 'display:flex;align-items:center;gap:6px;margin-top:3px' }, [
          el('span', { class: 'cc-pill cc-pill-' + idn.tone, style: 'font-size:10.5px' }, idn.pill),
          el('span', { class: 'cc-pill cc-pill-' + (c.mode === 'bot' ? 'blue' : 'violet'), style: 'font-size:10.5px' }, c.mode === 'bot' ? '⚡ AI answering' : '🧑 Human mode'),
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
    const msgs = el('div', { style: 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;padding:8px 2px;max-height:calc(100vh - 460px)' },
      (c.messages || []).map(m => {
        const mine = m.sender !== 'visitor';
        return el('div', { style: 'display:flex;flex-direction:column;align-items:' + (mine ? 'flex-end' : 'flex-start') }, [
          el('span', { class: 'cc-sub', style: 'font-size:10px;margin:0 4px 1px' },
            (m.sender === 'bot' ? '⚡ AI assistant' : m.sender === 'staff' ? '🧑 Staff' : idn.label) + ' · ' + fmtDateTime(m.at)),
          el('div', { style: 'max-width:80%;padding:9px 12px;border-radius:14px;font-size:13px;line-height:1.5;white-space:pre-wrap;word-break:break-word;' +
            (m.sender === 'visitor' ? 'background:rgba(148,163,184,.15)' : m.sender === 'bot' ? 'background:rgba(8,131,247,.15)' : 'background:rgba(252,83,5,.18)') }, m.body),
        ]);
      }));
    const inp = el('textarea', { class: 'cc-input', rows: '2', placeholder: 'Reply as LoadBoot team… (Enter to send)' });
    inp.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); await reply(); }
    });
    const reply = async () => {
      const t = inp.value.trim(); if (!t) return;
      inp.value = '';
      try { const r = await ccLcReply(id, t); if (r && r.error) throw new Error(r.error); openThread(id); loadList(true); }
      catch (e2) { toast(humanizeError(e2), 'error'); }
    };
    mount(threadHost, el('div', { style: 'display:flex;flex-direction:column;height:100%' }, [
      el('div', { class: 'fa-cardhead' }, [
        el('h3', null, idn.label),
        el('div', { style: 'display:flex;gap:6px;align-items:center' }, [
          el('span', { class: 'cc-pill cc-pill-' + idn.tone }, idn.pill),
          el('span', { class: 'cc-pill cc-pill-gray' }, (ORIGIN_ICON[c.origin] || '') + ' ' + c.origin + (c.page ? ' · ' + c.page : '')),
          c.mc ? el('span', { class: 'cc-pill cc-pill-blue' }, 'MC ' + c.mc) : null,
          c.dot ? el('span', { class: 'cc-pill cc-pill-blue' }, 'DOT ' + c.dot) : null,
          c.email ? el('span', { class: 'cc-sub' }, c.email) : null,
          el('button', { class: 'lb-btn lb-btn-ghost', onclick: async () => {
            await ccLcSetStatus(id, c.status === 'open' ? 'closed' : 'open'); openThread(id); loadList(true);
          } }, c.status === 'open' ? 'Close' : 'Reopen'),
        ]),
      ]),
      msgs,
      el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [
        inp,
        el('button', { class: 'lb-btn lb-btn-primary', onclick: reply }, 'Send'),
      ]),
    ]));
    msgs.scrollTop = msgs.scrollHeight;
  }
}
