// agents.js — CC AGENTS module: every agent, full 360 — application + docs, chain,
// downline (levels 2–5), earnings, payouts, message thread, notify/email. Built for
// hundreds of agents: search + status filter + sortable summary table.
import { el, mount } from '../../shared/ui/dom.js';
import { money, fmtDate, fmtDateTime, card, sectionHead } from '../../shared/ui/components.js';
import { ccAgentsList, ccAgent360, ccAgentDecide, ccAgentMsgs, ccAgentMsgSend, ccAgentNotifySend, ccAgentDocReview, referralPayoutDecide, referralPayoutQueue } from '../../shared/api.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { humanizeError } from '../../shared/errors.js';

export function renderAgents(host) {
  const state = { q: '', st: 'all', rows: [] };
  const body = el('div');
  mount(host, el('div', { class: 'cc-view' }, [
    sectionHead('Agents', 'The referral sales force — applications, chains, downlines, earnings, payouts and direct comms.'),
    body,
  ]));
  load();

  async function load() {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading agents…'));
    let rows; try { rows = await ccAgentsList(); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    state.rows = Array.isArray(rows) ? rows : [];
    paint();
  }

  function paint() {
    const q = state.q.toLowerCase();
    let list = state.rows.filter((x) => (state.st === 'all' || x.status === state.st)
      && (!q || ((x.name || '') + ' ' + (x.email || '') + ' ' + (x.code || '')).toLowerCase().includes(q)));
    const stPill = (st) => {
      const m = { approved: ['approved', 'green'], under_review: ['UNDER REVIEW', 'amber'], info_needed: ['info needed', 'amber'], rejected: ['rejected', 'red'], draft: ['draft', 'violet'], 'no-profile': ['no profile', 'violet'] }[st] || [st, 'violet'];
      return el('span', { class: 'cc-pill cc-pill-' + m[1] }, m[0]);
    };
    const qIn = el('input', { class: 'lb-input', placeholder: '🔍 name / email / code', value: state.q, style: 'max-width:240px',
      onInput: (e) => { state.q = e.target.value; paint(); } });
    const stSel = el('select', { class: 'lb-input', style: 'max-width:170px', onChange: (e) => { state.st = e.target.value; paint(); } },
      [['all', 'All statuses'], ['under_review', 'Under review'], ['approved', 'Approved'], ['info_needed', 'Info needed'], ['rejected', 'Rejected'], ['draft', 'Draft']].map(([v, l]) => el('option', { value: v, selected: state.st === v ? '' : undefined }, l)));
    mount(body, el('div', null, [
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px;align-items:center' }, [qIn, stSel,
        el('span', { class: 'cc-sub' }, list.length + ' of ' + state.rows.length + ' agents')]),
      card([el('div', { class: 'cc-doclist' }, list.length ? list.map(row) : [el('div', { class: 'cc-sub' }, 'No agents match.')])]),
    ]));
  }

  function row(x) {
    return el('div', { class: 'cc-row', style: 'display:flex;gap:12px;flex-wrap:wrap;align-items:center;padding:10px 0;border-bottom:1px solid #eef2f7;cursor:pointer', onClick: () => open360(x) }, [
      el('div', { style: 'flex:1;min-width:220px' }, [
        el('div', { style: 'font-weight:700' }, (x.name || '(no name)') + ' · ' + (x.email || '')),
        el('div', { class: 'cc-sub' }, 'code ' + (x.code || '—') + ' · ' + (x.country || '—') + ' · joined ' + fmtDate(x.joined_at) + ' · ' + (x.referred || 0) + ' referred · ' + (x.downline || 0) + ' downline agents'),
      ]),
      el('b', { style: 'color:#12a150' }, money(x.earned || 0)),
      Number(x.payable) ? el('span', { class: 'cc-pill cc-pill-green' }, money(x.payable) + ' payable') : '',
      x.open_payout ? el('span', { class: 'cc-pill cc-pill-amber' }, '💸 payout pending') : '',
      (() => { const m = { approved: ['approved', 'green'], under_review: ['UNDER REVIEW', 'amber'], info_needed: ['info needed', 'amber'], rejected: ['rejected', 'red'] }[x.status] || [x.status, 'violet']; return el('span', { class: 'cc-pill cc-pill-' + m[1] }, m[0]); })(),
    ]);
  }

  async function open360(x) {
    mount(body, el('div', { class: 'lb-state lb-loading' }, 'Loading ' + (x.name || 'agent') + '…'));
    let d; try { d = await ccAgent360(x.user_id); } catch (e) { mount(body, el('div', { class: 'lb-state lb-error' }, humanizeError(e))); return; }
    const p = d.profile || {}; const pd = p.payout_details || {};
    const kv = (k, v) => el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:4px 0;border-bottom:1px dashed #eef2f7;font-size:.86rem' }, [el('span', { style: 'color:#64748b' }, k), el('b', null, String(v ?? '—'))]);
    const docRow = (label, path, docKey) => {
      const st = pd[docKey + '_doc_status'] || (path ? 'pending' : 'missing');
      const reason = pd[docKey + '_doc_reason'];
      const chip = st === 'accepted' ? el('span', { class: 'cc-pill cc-pill-green' }, '✓ accepted')
        : st === 'rejected' ? el('span', { class: 'cc-pill cc-pill-red', title: reason || '' }, '✕ rejected')
        : path ? el('span', { class: 'cc-pill cc-pill-amber' }, 'pending review')
        : el('span', { class: 'cc-pill cc-pill-red' }, 'missing');
      return el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:5px 0;border-bottom:1px dashed #eef2f7' }, [
        el('span', { style: 'font-size:.85rem;font-weight:700;flex:1;min-width:150px' }, label), chip,
        path ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async (ev) => { const b = ev.currentTarget; const w = b.textContent; b.textContent = '…';
          try { const u = await signedDocumentUrl(path, 600); window.open(u, '_blank', 'noopener'); } catch (e) { alert(humanizeError(e)); } b.textContent = w; } }, '👁 View') : '',
        path && st !== 'accepted' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { await ccAgentDocReview(x.user_id, docKey, 'accept', null); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✓ Accept') : '',
        path && st !== 'rejected' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async () => { const r = prompt('Reject ' + label + ' — reason (agent sees this + gets an email):'); if (!r) return; try { await ccAgentDocReview(x.user_id, docKey, 'reject', r); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✕ Reject') : '',
        reason && st === 'rejected' ? el('div', { class: 'cc-sub', style: 'width:100%' }, 'reason: ' + reason) : '',
      ]);
    };
    const act = (lbl, action, cls) => el('button', { class: 'lb-btn lb-btn-sm ' + (cls || ''), onClick: async () => {
      const note = action === 'approve' ? null : prompt(lbl + ' — note (agent sees this):'); if (action !== 'approve' && !note) return;
      if (action === 'approve' && !confirm('Approve this agent? Chain starts earning immediately.')) return;
      try { await ccAgentDecide(x.user_id, action, note); open360(x); } catch (e) { alert(humanizeError(e)); }
    } }, lbl);
    // message thread
    const thread = el('div', { style: 'max-height:220px;overflow:auto;display:flex;flex-direction:column;gap:6px' },
      (d.messages || []).map((m) => el('div', { style: 'max-width:80%;padding:7px 11px;border-radius:11px;font-size:.84rem;' + (m.sender === 'staff' ? 'align-self:flex-end;background:#e0edff' : 'align-self:flex-start;background:#f1f5f9') },
        [el('div', null, m.body), el('div', { style: 'font-size:.62rem;color:#94a3b8;margin-top:2px' }, (m.sender === 'staff' ? 'CC' : 'Agent') + ' · ' + fmtDateTime(m.at))])));
    const msgIn = el('input', { class: 'lb-input', placeholder: 'Reply to agent…', style: 'flex:1' });
    const msgBtn = el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { if (!msgIn.value.trim()) return;
      try { await ccAgentMsgSend(x.user_id, msgIn.value.trim()); open360(x); } catch (e) { alert(humanizeError(e)); } } }, 'Send');
    // notify form
    const ntT = el('input', { class: 'lb-input', placeholder: 'Notification title', style: 'flex:1;min-width:160px' });
    const ntB = el('input', { class: 'lb-input', placeholder: 'Body', style: 'flex:2;min-width:200px' });
    const ntE = el('input', { type: 'checkbox' });
    const ntSend = el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { if (!ntT.value.trim()) return;
      try { await ccAgentNotifySend(x.user_id, ntT.value.trim(), ntB.value.trim(), ntE.checked); alert('Sent ✓'); ntT.value = ''; ntB.value = ''; } catch (e) { alert(humanizeError(e)); } } }, 'Send');
    const e9 = d.earnings || {};
    mount(body, el('div', null, [
      el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'margin-bottom:12px', onClick: load }, '← All agents'),
      el('div', { class: 'cc-grid-2' }, [
        card([el('h4', { class: 'cc-card-title' }, '👤 Application — everything submitted'),
          kv('Name', p.full_name), kv('Email', d.email), kv('Phone', p.phone),
          kv('Address', [p.street, p.city, p.state, p.zip, p.country].filter(Boolean).join(', ')),
          kv('Agency', p.agency), kv('Experience', (p.years_exp ?? '—') + ' yrs'),
          (() => { // Network — organized chips instead of raw JSON
            const n9 = p.network || {};
            const chip9 = (t9, on9) => el('span', { style: 'display:inline-block;padding:3px 10px;border-radius:999px;font-size:.72rem;font-weight:700;margin:2px 4px 2px 0;background:' + (on9 ? '#dcfce7' : '#f1f5f9') + ';color:' + (on9 ? '#166534' : '#94a3b8') }, (on9 ? '\u2713 ' : '\u2014 ') + t9);
            const list9 = (v9) => String(v9 || '').split(',').map((x9) => x9.trim()).filter(Boolean);
            return el('div', { style: 'padding:6px 0;border-bottom:1px solid #eef2f7' }, [
              el('div', { style: 'font-size:.72rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px' }, 'Network'),
              el('div', null, [chip9('Brokers', !!n9.has_brokers), chip9('Carriers', !!n9.has_carriers), chip9('Shippers', !!n9.has_shippers)]),
              list9(n9.lanes).length ? el('div', { style: 'margin-top:5px' }, [el('b', { style: 'font-size:.74rem;color:#64748b;margin-right:6px' }, 'Lanes:'), ...list9(n9.lanes).map((l9) => el('span', { style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:600;margin:2px 4px 2px 0;background:#e0edff;color:#1d4ed8' }, l9))]) : null,
              list9(n9.equipment).length ? el('div', { style: 'margin-top:4px' }, [el('b', { style: 'font-size:.74rem;color:#64748b;margin-right:6px' }, 'Equipment:'), ...list9(n9.equipment).map((e9) => el('span', { style: 'display:inline-block;padding:2px 9px;border-radius:999px;font-size:.72rem;font-weight:600;margin:2px 4px 2px 0;background:#fff7ed;color:#c2410c' }, e9))]) : null,
            ].filter(Boolean));
          })(),
          kv('Status', p.status), kv('Agreement', p.agreement_signed_at ? '✓ ' + (p.agreement_name || '') + ' · ' + fmtDateTime(p.agreement_signed_at) : '✕ unsigned'),
          kv('Tax form', (p.tax_form || '—') + (p.tax_id_last4 ? ' · TIN •••' + p.tax_id_last4 : '')),
          kv('Payout', (p.payout_method || '—') + (pd.bank_name ? ' · ' + pd.bank_name : '') + (pd.account ? ' ···' + String(pd.account).slice(-4) : pd.iban ? ' ···' + String(pd.iban).slice(-4) : pd.email ? ' · ' + pd.email : '')),
          el('div', { style: 'margin-top:10px' }, [docRow('🪪 Government photo ID', pd.id_doc, 'id'), docRow('🏦 Bank proof', pd.bank_doc, 'bank')]),
          el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [act('✓ Approve', 'approve'), act('？ More info', 'info', 'lb-btn-secondary'), act('✕ Reject', 'reject', 'lb-btn-secondary')]),
        ]),
        card([el('h4', { class: 'cc-card-title' }, '💰 Earnings & payouts'),
          kv('Clearing', money(e9.accrued || 0)), kv('Available to settle', money(e9.payable || 0)), kv('Paid out', money(e9.paid || 0)),
          el('div', { class: 'cc-sub', style: 'margin:8px 0 4px;font-weight:700' }, 'Recent commissions'),
          ...(e9.recent || []).slice(0, 8).map((c) => el('div', { class: 'cc-sub' }, money(c.amount) + ' · L' + c.level + ' · ' + c.status + ' · ' + fmtDate(c.at))),
          el('div', { class: 'cc-sub', style: 'margin:8px 0 4px;font-weight:700' }, 'Payout requests'),
          ...(d.payouts || []).map((q) => el('div', { style: 'display:flex;gap:8px;align-items:center;padding:3px 0' }, [
            el('span', { class: 'cc-sub', style: 'flex:1' }, money(q.amount) + ' · ' + q.status + ' · ' + fmtDate(q.requested_at)),
            ['requested'].includes(q.status) ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { await referralPayoutDecide(q.id, 'approve', null); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✓ Approve') : '',
            ['requested'].includes(q.status) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async () => { const n = prompt('Reject — why?'); if (!n) return; try { await referralPayoutDecide(q.id, 'reject', n); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✕') : '',
          ])),
        ]),
      ]),
      el('div', { class: 'cc-grid-2', style: 'margin-top:16px' }, [
        card([el('h4', { class: 'cc-card-title' }, '🔗 Chain (direct referrals)'),
          ...(d.chain && d.chain.length ? d.chain.map((c) => el('div', { class: 'cc-sub', style: 'padding:3px 0' },
            (c.side === 'carrier' ? '🚛 ' : c.side === 'shipper' ? '🏭 ' : '🏢 ') + c.org + ' · ' + c.side + ' · joined ' + fmtDate(c.joined_at) + ' · ' + (c.loads_posted || 0) + ' posted · ' + (c.trips_delivered || 0) + ' delivered')) : [el('div', { class: 'cc-sub' }, 'No referrals yet.')]),
          el('div', { class: 'cc-sub', style: 'margin-top:10px;font-weight:700' }, '🌳 Downline agents (levels 2–5)'),
          ...(d.downline && d.downline.length ? d.downline.map((a) => el('div', { class: 'cc-sub', style: 'padding:2px 0' },
            'L' + a.level + ' · ' + (a.name || a.code) + ' (' + a.code + ') · ' + a.status + ' · earned for this agent: ' + money(a.earned_for_you || 0))) : [el('div', { class: 'cc-sub' }, 'No recruited agents yet.')]),
          d.referrer && d.referrer.parent ? el('div', { class: 'cc-sub', style: 'margin-top:8px' }, '⬆ Upline: ' + d.referrer.parent) : '',
        ]),
        card([el('h4', { class: 'cc-card-title' }, '💬 Thread & direct comms'),
          thread,
          el('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [msgIn, msgBtn]),
          el('div', { class: 'cc-sub', style: 'margin:12px 0 4px;font-weight:700' }, '📣 Send notification' ),
          el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;align-items:center' }, [ntT, ntB, el('label', { style: 'display:flex;gap:5px;align-items:center;font-size:.8rem' }, [ntE, 'also email']), ntSend]),
        ]),
      ]),
    ]));
  }
}
