// referral-home.js — Referral Partner HOME (bl_agent_0402, 22 Sep 2026).
// One screen that answers the only question a referral partner has: "where is my money?"
//   · the link, with one-tap share (WhatsApp / SMS / copy) and an honest status strip
//   · live numbers: referred, verified, loads delivered, earned, available, next release
//   · a per-referral timeline — Joined → Verified → First load → Delivered → 1% credited
//   · the money pipeline with real amounts: credited → clearing (15 d) → payable → paid
// Everything is read from agent_feed / agent_chain_status / agent_payout_center — the same
// rows the engine writes in real time (fin_invoices trigger → referral_accrue_all → commissions).
// Mounted as the Dashboard for referral-only partners, and on top of the Referral tab for
// dispatchers who also opted in. Pure view: no writes except the two opt-in calls it offers.

const CSS = `
.rh{display:grid;gap:14px}
.rh-hero{border-radius:20px;padding:22px;background:linear-gradient(135deg,#10223B 0%,#0b1220 60%,#0f172a 100%);border:1px solid rgba(8,131,247,.35);box-shadow:0 18px 50px rgba(2,8,23,.45);position:relative;overflow:hidden}
.rh-hero:before{content:'';position:absolute;inset:-40% -20% auto auto;width:360px;height:360px;border-radius:50%;background:radial-gradient(circle,rgba(8,131,247,.22),transparent 65%);pointer-events:none}
.rh-kick{font-size:.7rem;font-weight:900;letter-spacing:.14em;text-transform:uppercase;color:#7cc0ff}
.rh-link{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:12px}
.rh-link code{flex:1;min-width:220px;font:700 1rem/1.3 ui-monospace,Menlo,monospace;color:#fff;background:rgba(255,255,255,.06);border:1px dashed rgba(255,255,255,.22);border-radius:12px;padding:12px 14px;word-break:break-all}
.rh-share{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.rh-btn{display:inline-flex;align-items:center;gap:7px;border:0;border-radius:12px;padding:10px 14px;font:800 .86rem Manrope,system-ui,sans-serif;cursor:pointer;color:#fff;background:#0883F7;transition:transform .12s,filter .15s}
.rh-btn:hover{filter:brightness(1.08)}.rh-btn:active{transform:scale(.98)}
.rh-btn.wa{background:#22c55e;color:#04210f}.rh-btn.ghost{background:rgba(255,255,255,.08);color:#e2e8f0;border:1px solid rgba(255,255,255,.14)}.rh-btn.orange{background:#FC5305}
.rh-strip{margin-top:14px;border-radius:14px;padding:12px 14px;font-size:.86rem;line-height:1.6;color:#e2e8f0;display:flex;gap:10px;align-items:flex-start}
.rh-strip.amber{background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)}.rh-strip.green{background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.35)}
.rh-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}
.rh-kpi{border-radius:16px;padding:14px 16px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.09)}
.rh-kpi b{display:block;font-size:1.45rem;font-weight:900;color:#fff;letter-spacing:-.02em}.rh-kpi b.green{color:#4ade80}.rh-kpi b.amber{color:#fbbf24}
.rh-kpi span{font-size:.74rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#94a3b8}
.rh-card{border-radius:18px;padding:18px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09)}
.rh-card h3{margin:0 0 4px;font-size:1.02rem;color:#fff}.rh-sub{font-size:.84rem;color:#94a3b8;line-height:1.6}
.rh-pipe{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;margin-top:12px}
.rh-step{border-radius:14px;padding:12px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);position:relative}
.rh-step i{display:block;font-style:normal;font-size:.68rem;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:#7cc0ff}
.rh-step b{display:block;font-size:1.05rem;color:#fff;margin:4px 0 2px}.rh-step small{color:#94a3b8;font-size:.76rem;line-height:1.45;display:block}
.rh-step.on{border-color:rgba(74,222,128,.5);background:rgba(34,197,94,.08)}.rh-step.on i{color:#4ade80}
.rh-ref{display:grid;gap:10px;margin-top:12px}
.rh-org{border-radius:16px;padding:14px 16px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.09)}
.rh-org-h{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.rh-org-h b{color:#fff;font-size:.98rem}
.rh-pill{font-size:.68rem;font-weight:900;letter-spacing:.06em;text-transform:uppercase;padding:4px 9px;border-radius:999px;background:rgba(148,163,184,.15);color:#cbd5e1}
.rh-pill.g{background:rgba(34,197,94,.15);color:#4ade80}.rh-pill.a{background:rgba(245,158,11,.15);color:#fbbf24}
.rh-track{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-top:12px}
.rh-t{text-align:center;font-size:.68rem;font-weight:700;color:#64748b;line-height:1.3}
.rh-t em{display:block;height:6px;border-radius:99px;background:rgba(255,255,255,.1);margin-bottom:6px;font-style:normal}
.rh-t.on{color:#e2e8f0}.rh-t.on em{background:linear-gradient(90deg,#0883F7,#4ade80)}
.rh-meta{display:flex;gap:14px;flex-wrap:wrap;margin-top:8px;font-size:.8rem;color:#94a3b8}.rh-meta b{color:#fff}
.rh-empty{text-align:center;padding:22px 10px}.rh-empty .big{font-size:2.2rem}
.rh-script{margin-top:10px;border-radius:12px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);padding:12px;font-size:.84rem;color:#cbd5e1;line-height:1.6;white-space:pre-wrap}
.rh-act{display:grid;gap:8px;margin-top:10px}.rh-act div{display:flex;gap:10px;font-size:.84rem;color:#cbd5e1;line-height:1.5}.rh-act time{color:#64748b;white-space:nowrap;font-size:.76rem}
.rh-x{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between}
@media (max-width:640px){.rh-hero{padding:18px}.rh-track{grid-template-columns:repeat(5,1fr)}.rh-t{font-size:.6rem}}
`;

const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const day = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—';
const ago = (d) => { if (!d) return ''; const m = Math.round((Date.now() - new Date(d)) / 60000); if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };
const SIDE = { carrier: '🚛', broker: '🏢', shipper: '🏭' };

export async function mountReferralHome(host, ctx) {
  const { h, mount, feed, api, go } = ctx;
  if (!document.getElementById('rh-css')) { const st = document.createElement('style'); st.id = 'rh-css'; st.textContent = CSS; document.head.appendChild(st); }
  mount(host, h('div', { class: 'cp-muted' }, 'Loading your referral home…'));

  let cs = null, pc = null;
  try { cs = await api.agentChainStatus(); } catch (_) {}
  try { pc = await api.agentPayoutCenter(); } catch (_) {}
  const code = feed.code || (cs && cs.code) || '';
  const link = feed.link || ('https://loadboot.com/?ref=' + code);
  const chain = Array.isArray(feed.chain) ? feed.chain : (cs && Array.isArray(cs.referred) ? cs.referred : []);
  const tt = feed.totals || (cs && cs.totals) || {};
  const accrued = Number((pc && pc.accrued) != null ? pc.accrued : tt.accrued || 0);
  const payable = Number((pc && pc.payable) != null ? pc.payable : tt.payable || 0);
  const paid = Number((pc && pc.paid) != null ? pc.paid : tt.paid || 0);
  const earned = accrued + payable + paid;
  const approved = ctx.isVerified === true;
  const pending = !approved;                        // referrer row pending → commissions credit on approval
  const verifiedOrgs = chain.filter((o) => ['active', 'verified', 'approved'].includes(String(o.status || '')));
  const delivered = chain.reduce((a, o) => a + Number(o.trips_delivered || 0), 0);
  const notices = (Array.isArray(feed.notices) ? feed.notices : []).slice(0, 6);

  const copy = async (txt, btn) => { try { await navigator.clipboard.writeText(txt); const t = btn.textContent; btn.textContent = '✓ Copied'; setTimeout(() => { btn.textContent = t; }, 1600); } catch (_) { window.prompt('Copy your link', txt); } };
  const msg = 'I use LoadBoot for dispatch — verified carriers, brokers who post real loads, and payments handled. Sign up with my link and we both win: ' + link;
  const share = async () => { try { if (navigator.share) { await navigator.share({ title: 'LoadBoot', text: msg, url: link }); return; } } catch (_) { return; } window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener'); };

  const kpi = (label, val, cls) => h('div', { class: 'rh-kpi' }, [h('b', { class: cls || '' }, val), h('span', null, label)]);

  const strip = pending
    ? h('div', { class: 'rh-strip amber' }, [h('span', null, '⏳'), h('div', null, [
        h('b', { style: 'color:#fcd34d' }, 'Your link is live — every signup through it is recorded to you right now. '),
        'Commission credits start the moment your verification is approved, back-dated to the loads your referrals already delivered. Nothing is lost while you wait. ',
        h('a', { style: 'color:#7cc0ff;font-weight:800;cursor:pointer', onClick: () => go('verify') }, 'Finish verification →'),
      ])])
    : h('div', { class: 'rh-strip green' }, [h('span', null, '✅'), h('div', null, [h('b', { style: 'color:#4ade80' }, 'Verified partner. '), 'Every delivered load from your referrals credits 1% of gross to you the same moment the invoice is created — then 15 days of clearing, then it is yours to withdraw.'])]);

  const hero = h('div', { class: 'rh-hero' }, [
    h('div', { class: 'rh-kick' }, 'Your referral link · code ' + code),
    h('div', { style: 'font-size:1.35rem;font-weight:900;color:#fff;margin-top:6px;letter-spacing:-.01em' }, 'Bring the people. The software does the rest.'),
    h('div', { class: 'rh-sub', style: 'margin-top:4px' }, '1% of gross on every delivered load — carriers, brokers and shippers — for as long as they move freight. Levels 2–5 on partners you recruit.'),
    h('div', { class: 'rh-link' }, [h('code', null, link), h('button', { class: 'rh-btn', onClick: (e) => copy(link, e.currentTarget) }, '🔗 Copy link')]),
    h('div', { class: 'rh-share' }, [
      h('button', { class: 'rh-btn wa', onClick: () => window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener') }, '💬 WhatsApp'),
      h('button', { class: 'rh-btn ghost', onClick: () => { location.href = 'sms:?&body=' + encodeURIComponent(msg); } }, '📱 SMS'),
      h('button', { class: 'rh-btn ghost', onClick: () => { location.href = 'mailto:?subject=' + encodeURIComponent('Join me on LoadBoot') + '&body=' + encodeURIComponent(msg); } }, '✉️ Email'),
      h('button', { class: 'rh-btn ghost', onClick: share }, '📤 Share…'),
      h('button', { class: 'rh-btn ghost', onClick: (e) => copy(msg, e.currentTarget) }, 'Copy message'),
    ]),
    strip,
  ]);

  const kpis = h('div', { class: 'rh-kpis' }, [
    kpi('Referred', String(chain.length)),
    kpi('Verified & moving', String(verifiedOrgs.length)),
    kpi('Loads delivered', String(delivered)),
    kpi('Earned — lifetime', money(earned), 'green'),
    kpi('Available now', money(payable), payable > 0 ? 'green' : ''),
    kpi(pc && pc.next_clearing ? 'Next release · ' + day(pc.next_clearing) : 'In clearing (15 d)', money(accrued), accrued > 0 ? 'amber' : ''),
  ]);

  const pipe = h('div', { class: 'rh-card' }, [
    h('h3', null, '💰 Where your money is, right now'),
    h('div', { class: 'rh-sub' }, 'Automatic end to end. Delivery creates the invoice; the invoice credits your 1% the same second; 15 days of clearing protects you from reversals; then it is payable and you withdraw from $100.'),
    h('div', { class: 'rh-pipe' }, [
      h('div', { class: 'rh-step' + (delivered > 0 ? ' on' : '') }, [h('i', null, '1 · Delivered'), h('b', null, delivered + ' loads'), h('small', null, 'GPS-verified deliveries by your referrals')]),
      h('div', { class: 'rh-step' + (earned > 0 ? ' on' : '') }, [h('i', null, '2 · 1% credited'), h('b', null, money(earned)), h('small', null, pending ? 'Credits on approval, back-dated' : 'Same moment the invoice is created')]),
      h('div', { class: 'rh-step' + (accrued > 0 ? ' on' : '') }, [h('i', null, '3 · Clearing'), h('b', null, money(accrued)), h('small', null, pc && pc.next_clearing ? 'Next release ' + day(pc.next_clearing) : '15 days per load')]),
      h('div', { class: 'rh-step' + (payable > 0 ? ' on' : '') }, [h('i', null, '4 · Payable'), h('b', null, money(payable)), h('small', null, payable >= 100 ? 'Ready — request a payout' : 'Withdraw from $100')]),
      h('div', { class: 'rh-step' + (paid > 0 ? ' on' : '') }, [h('i', null, '5 · Paid to you'), h('b', null, money(paid)), h('small', null, 'Lifetime payouts')]),
    ]),
    (pc && Array.isArray(pc.reasons) && pc.reasons.length) ? h('div', { class: 'rh-strip amber', style: 'margin-top:12px' }, [h('span', null, '🔗'), h('div', null, pc.reasons.map((r) => h('div', null, typeof r === 'string' ? r : (r.text || r.reason || ''))))]) : null,
    h('div', { style: 'margin-top:12px;display:flex;gap:8px;flex-wrap:wrap' }, [
      h('button', { class: 'rh-btn', onClick: () => go('payouts') }, 'Payouts →'),
      h('button', { class: 'rh-btn ghost', onClick: () => go('earnings') }, 'Every commission line'),
    ]),
  ].filter(Boolean));

  const orgCard = (o) => {
    const st = String(o.status || '');
    const ver = ['active', 'verified', 'approved'].includes(st);
    const hasLoad = Number(o.loads_posted || 0) > 0 || Number(o.trips_delivered || 0) > 0;
    const del = Number(o.trips_delivered || 0) > 0;
    const earn = Number(o.your_earnings || 0);
    const steps = [['Joined', true], ['Verified', ver], ['First load', hasLoad], ['Delivered', del], ['1% credited', earn > 0]];
    return h('div', { class: 'rh-org' }, [
      h('div', { class: 'rh-org-h' }, [
        h('span', { style: 'font-size:1.2rem' }, SIDE[o.side] || '🤝'), h('b', null, o.org || o.name || 'New account'),
        h('span', { class: 'rh-pill' }, o.side || 'partner'),
        h('span', { class: 'rh-pill ' + (ver ? 'g' : 'a') }, ver ? 'verified' : (st || 'onboarding')),
        h('span', { style: 'margin-left:auto;font-weight:900;color:' + (earn > 0 ? '#4ade80' : '#94a3b8') }, money(earn)),
      ]),
      h('div', { class: 'rh-track' }, steps.map(([l, on]) => h('div', { class: 'rh-t' + (on ? ' on' : '') }, [h('em'), l]))),
      h('div', { class: 'rh-meta' }, [
        h('span', null, ['Joined ', h('b', null, day(o.joined_at))]),
        h('span', null, [h('b', null, String(o.loads_posted || 0)), ' loads posted']),
        h('span', null, [h('b', null, String(o.trips_delivered || 0)), ' delivered']),
        !ver ? h('span', { style: 'color:#fbbf24' }, 'Waiting on their verification — you earn from their first delivered load.') : null,
      ].filter(Boolean)),
    ]);
  };

  const refs = h('div', { class: 'rh-card' }, [
    h('div', { class: 'rh-x' }, [h('div', null, [h('h3', null, '👥 Your referrals — live'), h('div', { class: 'rh-sub' }, 'Each one is tied to you the moment they sign up through your link. Their progress updates here as it happens.')]),
      chain.length ? h('button', { class: 'rh-btn ghost', onClick: () => go('chain') }, 'Full list →') : null].filter(Boolean)),
    chain.length ? h('div', { class: 'rh-ref' }, chain.slice(0, 6).map(orgCard))
      : h('div', { class: 'rh-empty' }, [
        h('div', { class: 'big' }, '🚀'),
        h('div', { style: 'font-weight:900;color:#fff;font-size:1.05rem;margin-top:4px' }, 'No referrals yet — your first one is one message away'),
        h('div', { class: 'rh-sub' }, 'Send your link to a carrier, broker or shipper you already know. The instant they create an account through it, they appear here with a live status.'),
        h('div', { class: 'rh-script' }, msg),
        h('div', { class: 'rh-share', style: 'justify-content:center' }, [
          h('button', { class: 'rh-btn wa', onClick: () => window.open('https://wa.me/?text=' + encodeURIComponent(msg), '_blank', 'noopener') }, '💬 Send on WhatsApp'),
          h('button', { class: 'rh-btn ghost', onClick: (e) => copy(link, e.currentTarget) }, 'Copy link'),
        ]),
      ]),
  ]);

  const act = notices.length ? h('div', { class: 'rh-card' }, [
    h('h3', null, '🔔 Recent activity'),
    h('div', { class: 'rh-act' }, notices.map((n) => h('div', null, [h('time', null, ago(n.at || n.created_at || n.sent_at)), h('span', null, (n.title ? n.title + ' — ' : '') + (n.body || n.text || ''))]))),
  ]) : null;

  const cross = (!feed.has_dispatcher && feed.intent !== 'both' && feed.intent !== 'dispatcher') ? h('div', { class: 'rh-card rh-x' }, [
    h('div', null, [h('h3', null, '🧑‍✈️ Also want to work as a LoadBoot dispatcher?'), h('div', { class: 'rh-sub' }, 'Same account. Apply once — commission trial first, then a written package. Your referral link keeps earning either way.')]),
    h('button', { class: 'rh-btn orange', onClick: async (e) => { e.currentTarget.disabled = true; try { await api.agentSetIntent('dispatcher'); } catch (_) {} location.hash = '#dashboard'; location.reload(); } }, 'Apply as a dispatcher →'),
  ]) : null;

  mount(host, h('div', { class: 'rh' }, [hero, kpis, pipe, refs, act, cross].filter(Boolean)));
}
