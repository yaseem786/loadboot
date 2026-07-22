// agents.js — CC AGENTS module: every agent, full 360 — application + docs, chain,
// downline (levels 2–5), earnings, payouts, message thread, notify/email. Built for
// hundreds of agents: search + status filter + sortable summary table.
import { el, mount } from '../../shared/ui/dom.js';
import { icon } from '../../shared/ui/icons.js';

import { money, fmtDate, fmtDateTime, card, sectionHead, askReason, askConfirm } from '../../shared/ui/components.js';
import { ccAgentsList, ccAgent360, ccAgentDecide, ccAgentMsgs, ccAgentMsgSend, ccAgentNotifySend, ccAgentDocReview, referralPayoutDecide, referralPayoutQueue, agentSuspend, ccAgentPayoutVerify } from '../../shared/api.js';
import { signedDocumentUrl } from '../../shared/storage.js';
import { humanizeError, toast } from '../../shared/errors.js';

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
      x.open_payout ? el('span', { class: 'cc-pill cc-pill-amber' }, [icon('dollar',15),' payout pending']) : '',
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
          try { const u = await signedDocumentUrl(path, 600); window.open(u, '_blank', 'noopener'); } catch (e) { alert(humanizeError(e)); } b.textContent = w; } }, [icon('eye',15),' View']) : '',
        path && st !== 'accepted' ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { await ccAgentDocReview(x.user_id, docKey, 'accept', null); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✓ Accept') : '',
        path && st !== 'rejected' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async () => { const r = await askReason('Reject ' + label + ' — reason (agent sees this + gets an email):'); if (!r) return; try { await ccAgentDocReview(x.user_id, docKey, 'reject', r); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✕ Reject') : '',
        reason && st === 'rejected' ? el('div', { class: 'cc-sub', style: 'width:100%' }, 'reason: ' + reason) : '',
      ]);
    };
    const act = (lbl, action, cls) => el('button', { class: 'lb-btn lb-btn-sm ' + (cls || ''), onClick: async () => {
      const note = action === 'approve' ? null : prompt(lbl + ' — note (agent sees this):'); if (action !== 'approve' && !note) return;
      if (action === 'approve' && !await askConfirm('Please confirm', { body: 'Approve this agent? Chain starts earning immediately.', danger: true })) return;
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
        card([el('h4', { class: 'cc-card-title' }, [icon('users',15),' Application — everything submitted']),
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
          // FULL PAYOUT PANEL — parity with Carrier 360's payout card. Staff must be able to read
          // exactly where the money is going before approving a payout, without opening the DB.
          (() => {
            const M9 = { payoneer: '⭐ Payoneer', local_bank: '🏦 Local bank · paid via Payoneer', ach: '🏦 US bank (ACH)', crypto: '₿ USDT · TRC-20', intl: '🏦 International bank', other: '❓ Other (requested)' };
            const mask9 = (v9, keep) => { const t9 = String(v9 || ''); return t9 ? '•••' + t9.slice(-(keep || 4)) : null; };
            const row9 = (k9, v9, warn) => v9 ? el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:5px 0;border-bottom:1px dashed #eef2f7;font-size:.85rem' }, [
              el('span', { style: 'color:#64748b' }, k9),
              el('b', { style: 'text-align:right;word-break:break-word;color:' + (warn ? '#b45309' : '#0f172a') }, v9)]) : null;
            const m9 = String(p.payout_method || '');
            const rows9 = [
              row9('Method', M9[m9] || m9 || '— not set —', !m9),
              row9('Account title', pd.account_title),
              row9('Name match', (pd.account_title && p.full_name) ? (String(pd.account_title).trim().toLowerCase() === String(p.full_name).trim().toLowerCase() ? '✓ matches legal name' : '⚠ differs from application name — verify before paying') : null,
                   !!(pd.account_title && p.full_name && String(pd.account_title).trim().toLowerCase() !== String(p.full_name).trim().toLowerCase())),
              m9 === 'payoneer' ? row9('Payoneer email', pd.email) : null,
              m9 === 'payoneer' ? row9('Payoneer customer ID', pd.account) : null,
              m9 === 'ach' ? row9('Bank', pd.bank_name) : null,
              m9 === 'ach' ? row9('Routing', mask9(pd.routing, 4)) : null,
              m9 === 'ach' ? row9('Account #', mask9(pd.account, 4)) : null,
              m9 === 'crypto' ? row9('Network', pd.wallet_network || 'TRC-20') : null,
              m9 === 'crypto' ? row9('Wallet', pd.wallet ? String(pd.wallet).slice(0, 6) + '…' + String(pd.wallet).slice(-6) : null) : null,
              (m9 === 'intl' || m9 === 'local_bank') ? row9('Bank', pd.bank_name) : null,
              (m9 === 'intl' || m9 === 'local_bank') ? row9('IBAN / account', mask9(pd.iban, 4)) : null,
              (m9 === 'intl' || m9 === 'local_bank') ? row9('SWIFT / BIC', pd.swift) : null,
              row9('Bank address', pd.bank_address),
              m9 === 'other' ? row9('Requested method', pd.other, true) : null,
              row9('Country', p.country),
              row9('Tax form', (p.tax_form || '—') + (p.tax_id_last4 ? ' · TIN •••' + p.tax_id_last4 : '')),
            ].filter(Boolean);
            const note9 = m9 === 'intl'
              ? '⚠ Legacy direct-IBAN payout. New agents are onboarded on Payoneer — a US-sourced USD wire to a foreign IBAN is slow and expensive. Ask this agent to switch to Payoneer before the next run.'
              : m9 === 'other' ? '⚠ Unapproved method — do NOT pay until a reviewer confirms it can receive an international USD payment in the agent’s own name.'
              : m9 === 'crypto' ? 'Send a small test transfer before the first full payout. The network fee is deducted from the payout and printed on the receipt.'
              : m9 === 'local_bank' ? 'Pay via Payoneer’s local bank transfer to this account — lands in local currency, usually 1–3 business days. Verify the account title matches the ID.'
              : m9 === 'payoneer' ? 'Pay the Payoneer account; the agent withdraws to their own local bank inside Payoneer. LoadBoot adds no fee.'
              : null;
            return el('div', { style: 'padding:8px 0' }, [
              el('div', { style: 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px' }, [el('div', { style: 'font-size:.72rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em' }, [icon('card',15),' Payout & bank details']), el('span', { class: 'cc-pill cc-pill-' + (pd.payout_status==='verified'?'green':pd.payout_status==='rejected'?'red':'amber') }, pd.payout_status==='verified'?'✓ Verified':pd.payout_status==='rejected'?'✕ Rejected':'Pending review')]),
              ...rows9,
              note9 ? el('div', { style: 'margin-top:8px;background:#f8fafc;border:1px solid #e6ebf3;border-radius:10px;padding:9px 12px;font-size:.8rem;line-height:1.55;color:#475569' }, note9) : null,
              el('div', { style: 'display:flex;gap:8px;margin-top:12px;flex-wrap:wrap' }, [pd.payout_status!=='verified' ? el('button', { class: 'lb-btn lb-btn-sm', style: 'background:#16a34a;border-color:#16a34a', onClick: async (ev) => { const b=ev.currentTarget; if(!await askConfirm('Verify payout',{ body:'Mark this payout method as verified? Payouts can be sent here.' })) return; b.disabled=true; try{ await ccAgentPayoutVerify(x.user_id,true,null); toast('Payout verified','success'); open360(x);}catch(e){ b.disabled=false; toast(humanizeError(e),'error'); } } }, [icon('check',15),' Verify bank details']) : null,pd.payout_status!=='rejected' ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', style: 'color:#b91c1c', onClick: async (ev) => { const r=await askReason('Reject payout details — reason (agent sees this + gets an email):'); if(!r) return; const b=ev.currentTarget; b.disabled=true; try{ await ccAgentPayoutVerify(x.user_id,false,r); toast('Payout rejected — agent notified','success'); open360(x);}catch(e){ b.disabled=false; toast(humanizeError(e),'error'); } } }, [icon('x',15),' Reject with reason']) : null,].filter(Boolean)),
            ].filter(Boolean));
          })(),
          el('div', { style: 'margin-top:10px' }, [docRow('🪪 Government photo ID', pd.id_doc, 'id'), docRow('🏦 Bank proof', pd.bank_doc, 'bank')]),
          el('div', { style: 'display:flex;gap:8px;margin-top:10px;flex-wrap:wrap' }, [...((['approved','active'].includes(String(p.status || ''))) ? [el('span', { class: 'cc-pill cc-pill-green', style: 'align-self:center;font-weight:800;padding:8px 12px' }, '✓ Approved — chain earning live')] : [act('✓ Approve', 'approve'), act('？ More info', 'info', 'lb-btn-secondary'), act('✕ Reject', 'reject', 'lb-btn-secondary')]),
            el('button', { class: 'lb-btn lb-btn-sm', title: 'Email + in-app reminder listing what this agent still needs to finish onboarding', onClick: async (ev) => {
              const b = ev.currentTarget; const w = b.textContent; b.disabled = true;
              const miss = [];
              if (!p.agreement_signed_at) miss.push('sign the agent agreement');
              if (!p.payout_method) miss.push('add your payout method');
              if (!pd.id_doc) miss.push('upload a government photo ID');
              if (!pd.bank_doc) miss.push('upload bank proof');
              if (!miss.length) { b.disabled = false; alert('Nothing outstanding — this agent has completed every onboarding step.'); return; }
              const bodyTxt = 'Welcome to LoadBoot! To finish activating your agent account and start earning, please complete: ' + miss.map((m, i) => (i + 1) + ') ' + m).join('   ') + '. Open your Agent portal and go to onboarding to wrap it up. Reply here if you need any help.';
              try { await ccAgentNotifySend(x.user_id, 'Finish your LoadBoot agent onboarding', bodyTxt, true); b.textContent = '✓ Reminder sent'; alert('Onboarding reminder sent to ' + (d.email || 'the agent') + ' — premium email + in-app, listing: ' + miss.join(', ') + '.'); }
              catch (e) { b.disabled = false; b.textContent = w; alert(humanizeError(e)); }
            } }, [icon('bell',15),' Send reminder']),
            // SUSPEND / REINSTATE (audit gap): staff could approve + pay an agent but never stop one.
            (String(x.status || '') === 'suspended')
              ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async (ev) => { const b = ev.currentTarget; b.disabled = true;
                  try { await agentSuspend(x.user_id, false, null); toast('Agent reinstated — accruals resume', 'success'); open360(x); }
                  catch (e) { b.disabled = false; toast(humanizeError(e), 'error'); } } }, '↻ Reinstate agent')
              : el('button', { class: 'lb-btn lb-btn-sm', style: 'border:1px solid #fca5a5;color:#b91c1c;background:#fff', onClick: async () => {
                  const why = await askReason('Suspend this agent — reason', { note: 'The agent is notified. Cleared commissions are untouched; new accruals pause until reinstated. Audit-logged.', submitLabel: 'Suspend agent' });
                  if (!why) return;
                  try { await agentSuspend(x.user_id, true, why); toast('Agent suspended — notified', 'success'); open360(x); }
                  catch (e) { toast(humanizeError(e), 'error'); } } }, '⏸ Suspend agent'),
          ]),
        ]),
        card([el('h4', { class: 'cc-card-title' }, [icon('dollar',15),' Earnings & payouts']),
          kv('Clearing', money(e9.accrued || 0)), kv('Available to settle', money(e9.payable || 0)), kv('Paid out', money(e9.paid || 0)),
          el('div', { class: 'cc-sub', style: 'margin:8px 0 4px;font-weight:700' }, 'Recent commissions'),
          ...(e9.recent || []).slice(0, 8).map((c) => el('div', { class: 'cc-sub' }, money(c.amount) + ' · L' + c.level + ' · ' + c.status + ' · ' + fmtDate(c.at))),
          el('div', { class: 'cc-sub', style: 'margin:8px 0 4px;font-weight:700' }, 'Payout requests'),
          ...(d.payouts || []).map((q) => el('div', { style: 'display:flex;gap:8px;align-items:center;padding:3px 0' }, [
            el('span', { class: 'cc-sub', style: 'flex:1' }, money(q.amount) + ' · ' + q.status + ' · ' + fmtDate(q.requested_at)),
            ['requested'].includes(q.status) ? el('button', { class: 'lb-btn lb-btn-sm', onClick: async () => { try { await referralPayoutDecide(q.id, 'approve', null); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✓ Approve') : '',
            ['requested'].includes(q.status) ? el('button', { class: 'lb-btn lb-btn-sm lb-btn-secondary', onClick: async () => { const n = await askReason('Reject — why?'); if (!n) return; try { await referralPayoutDecide(q.id, 'reject', n); open360(x); } catch (e) { alert(humanizeError(e)); } } }, '✕') : '',
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
