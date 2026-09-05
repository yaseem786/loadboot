// brokerTrust.js — Command Center · Broker trust queue (bl_bp_0312).
// One screen for the whole broker supply funnel: who screened, who is waiting on a parent
// brokerage, who is on hold, and who can post right now. Every number is read live from
// app_private.broker_can_post() — nothing here is stored state that can go stale.
import { el, mount } from '../../shared/ui/dom.js';
import { showLoading, showError } from '../../shared/loading.js';
import { sectionHead, statCard } from '../../shared/ui/components.js';
import { ccBrokerTrustQueue, ccBrokerTrustSet, ccShipperTrustQueue, ccShipperTrustSet } from '../../shared/api.js';
import { humanizeError } from '../../shared/errors.js';

const TIER = {
  verified:        ['green', 'Verified'],
  unclaimed:       ['amber', 'Screened · identity unconfirmed'],
  screened:        ['blue',  'Screened · limited'],
  agent_confirmed: ['blue',  'Agent · confirmed'],
  agent_pending:   ['amber', 'Agent · awaiting parent'],
  new:             ['gray',  'Not screened'],
  hold:            ['red',   'On hold'],
};
const pill = (tone, txt) => el('span', { class: 'cc-pill cc-pill-' + tone }, [el('i', { class: 'cc-pill-dot' }), txt]);
const ago = (ts) => { if (!ts) return '—'; const m = Math.round((Date.now() - new Date(ts).getTime()) / 60000); return m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : Math.round(m / 1440) + ' d ago'; };

export function renderBrokerTrust(host) {
  const kpis = el('div', { class: 'cc-kpi-grid' });
  const body = el('div');
  let filter = 'all';
  const filters = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin:0 0 12px' });
  mount(host, el('div', null, [
    sectionHead('Broker trust', 'FMCSA-screened brokers post in minutes; the packet only lifts limits. Authority is read live from FMCSA; identity is claimed from the FMCSA-listed email/phone (or a domain match). This queue is every broker on the platform with the live posting rule applied — act on the amber and red rows.'),
    kpis, filters, body,
    shipperSection(),  // bl_bp_0319
  ]));
  load();

  async function act(org, action, note) {
    try { await ccBrokerTrustSet(org, action, note); await load(); }
    catch (e) { alert(humanizeError(e)); }
  }

  // bl_bp_0319 — shippers: business confirmed from the company email domain (MX + website); quotes open on that,
  // the packet gates the first booking. Staff step in only for free-mail / dead-domain signups.
  function shipperSection() {
    const wrap = el('div', { style: 'margin-top:28px' });
    const list = el('div');
    const STIER = { verified: ['green', 'Verified shipper'], business_verified: ['blue', 'Business confirmed · quotes open'], new: ['gray', 'Not confirmed'], hold: ['red', 'On hold'] };
    async function sact(org, action, note) { try { await ccShipperTrustSet(org, action, note); await sload(); } catch (e) { alert(humanizeError(e)); } }
    function srow(r) {
      const [tone, label] = STIER[r.tier] || STIER.new;
      const acts = [];
      if (r.tier === 'hold') acts.push(el('button', { class: 'cc-btn-sm', style: 'background:#0883F7;color:#fff;border-color:#0883F7', onClick: () => sact(r.org_id, 'release', prompt('Note to the shipper (optional):') || null) }, 'Release hold'));
      else acts.push(el('button', { class: 'cc-btn-sm', onClick: () => { const n = prompt('Reason (the shipper sees this):'); if (n) sact(r.org_id, 'hold', n); } }, 'Hold'));
      if (r.tier === 'new') {
        acts.push(el('button', { class: 'cc-btn-sm', onClick: () => sact(r.org_id, 'recheck') }, 'Re-check domain'));
        acts.push(el('button', { class: 'cc-btn-sm', style: 'background:#0883F7;color:#fff;border-color:#0883F7', onClick: () => { const n = prompt('How did you verify the business? (called them, EIN letter, invoice… — recorded)'); if (n) sact(r.org_id, 'verify', n); } }, 'Verify by hand'));
      }
      return el('div', { class: 'cc-card', style: 'padding:14px 16px;margin-bottom:10px' }, [
        el('div', { style: 'display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;align-items:flex-start' }, [
          el('div', { style: 'flex:1;min-width:260px' }, [
            el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [el('b', { style: 'font-size:.98rem' }, r.name || '?'), pill(tone, label)]),
            el('div', { style: 'color:#64748b;font-size:.82rem;margin-top:2px' }, (r.owner_email || '') + ' · joined ' + ago(r.created_at) + ' · ' + (r.shipments || 0) + ' shipment' + (r.shipments === 1 ? '' : 's') + ' · packet ' + (r.packet_done || 0) + '/' + (r.packet_total || 0)),
            el('div', { style: 'color:#334155;font-size:.84rem;margin-top:6px' }, [
              el('b', null, 'Business: '),
              r.verified_at ? '✓ ' + (r.verified_by || 'confirmed') + ' · ' + ago(r.verified_at)
                : 'check ' + (r.check_outcome || 'not run') + (r.check_reason ? ' — ' + r.check_reason : '') + (r.domain ? ' · domain ' + r.domain : '') + (r.free_mail ? ' (personal email)' : '') + (r.company_email ? ' · company address ' + r.company_email + (r.email_verified_at ? ' ✓' : ' (code not entered)') : ''),
              r.site_title ? el('div', { style: 'color:#64748b' }, 'Site: ' + r.site_title + (r.site_url ? ' · ' + r.site_url : '') + (r.name_match === true ? ' · company name on site' : r.name_match === false ? ' · ⚠ company name NOT found on site' : '')) : '',
              r.reason ? el('div', { style: 'color:#b45309;margin-top:2px' }, r.reason) : '',
              r.hold_reason ? el('div', { style: 'color:#b91c1c;margin-top:2px' }, 'HOLD: ' + r.hold_reason) : '',
            ]),
          ]),
          el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:360px' }, acts),
        ]),
      ]);
    }
    async function sload() {
      showLoading(list, 'Loading shipper trust…');
      let rows; try { rows = await ccShipperTrustQueue(); } catch (e) { showError(list, humanizeError(e), sload); return; }
      rows = rows || [];
      mount(list, rows.length ? rows.map(srow) : el('div', { class: 'cc-card', style: 'padding:24px;color:#64748b' }, 'No shippers yet.'));
    }
    mount(wrap, [sectionHead('Shipper trust', 'Business confirmed automatically from the company email domain (receives mail + website). Confirmed shippers request quotes right away; the short packet gates the first booking. Staff only for personal-email or dead-domain signups.'), list]);
    sload();
    return wrap;
  }

  function row(r) {
    const [tone, label] = TIER[r.tier] || TIER.new;
    const scr = r.screening;
    const scrTxt = !scr ? 'not started' : scr === 'pass' ? '✓ pass · ' + (r.authority_source === 'fmcsa-li' ? 'L&I' : r.authority_source === 'fmcsa-safer' ? 'SAFER' : r.authority_source === 'staff' ? 'staff' : '?') : scr === 'pending' ? '⏳ running' : '✕ ' + scr;
    const actions = [];
    if (r.tier === 'hold') actions.push(el('button', { class: 'cc-btn-sm', style: 'background:#0883F7;color:#fff;border-color:#0883F7', onClick: () => act(r.org_id, 'release', prompt('Note to the broker (optional):') || null) }, 'Release hold'));
    else actions.push(el('button', { class: 'cc-btn-sm', onClick: () => { const n = prompt('Reason (the broker sees this):'); if (n) act(r.org_id, 'hold', n); } }, 'Hold'));
    if (scr && scr !== 'pass') actions.push(el('button', { class: 'cc-btn-sm', style: 'background:#0883F7;color:#fff;border-color:#0883F7', onClick: () => { const n = prompt('You checked FMCSA by hand — what did you see? (recorded)'); if (n) act(r.org_id, 'pass', n); } }, 'Pass by hand'));
    if (scr && scr !== 'pending') actions.push(el('button', { class: 'cc-btn-sm', onClick: () => act(r.org_id, 'rescreen') }, 'Re-screen'));
    // bl_bp_0318: one agent, several brokerages — staff act on the newest undecided one
    if (r.is_agent && (r.parents || []).some((p) => p.status === 'pending' || p.status === 'screening' || p.status === 'declined')) {
      actions.push(el('button', { class: 'cc-btn-sm', onClick: () => act(r.org_id, 'resend_parent') }, 'Resend code email'));
      actions.push(el('button', { class: 'cc-btn-sm', style: 'background:#0883F7;color:#fff;border-color:#0883F7', onClick: () => { const n = prompt('What did you check? (agent agreement, spoke with the brokerage… — recorded; confirms the newest undecided brokerage)'); if (n) act(r.org_id, 'confirm_parent', n); } }, 'Confirm brokerage'));
    }
    // bl_bp_0313 identity claim (own-MC brokers): staff can confirm by calling the FMCSA-listed phone, or reject
    if (!r.is_agent && scr === 'pass' && r.identity_status !== 'verified') {
      if (r.identity_fmcsa_email) actions.push(el('button', { class: 'cc-btn-sm', onClick: () => act(r.org_id, 'resend_identity') }, 'Resend claim email'));
      actions.push(el('button', { class: 'cc-btn-sm', style: 'background:#0883F7;color:#fff;border-color:#0883F7', onClick: () => { const n = prompt('How did you verify identity? e.g. "called FMCSA number ' + (r.identity_fmcsa_phone || r.fmcsa_phone || '') + ', spoke to owner" (recorded):'); if (n) act(r.org_id, 'verify_identity', n); } }, 'Verify identity'));
      actions.push(el('button', { class: 'cc-btn-sm', style: 'color:#b91c1c', onClick: () => { const n = prompt('Why can identity NOT be confirmed? (the broker sees this; account goes on hold)'); if (n) act(r.org_id, 'reject_identity', n); } }, 'Reject identity'));
    }
    if (r.tier !== 'verified') actions.push(el('button', { class: 'cc-btn-sm', onClick: () => { const n = prompt('Open-posting limit for this broker (blank = default 3 / 10):', r.posting_limit || ''); if (n !== null) act(r.org_id, 'set_limit', n); } }, 'Limit ' + (r.posting_limit == null ? '∞' : r.posting_limit)));
    actions.push(el('a', { class: 'cc-btn-sm', href: '#/broker?id=' + r.org_id }, '360 →'));

    return el('div', { class: 'cc-card', style: 'padding:14px 16px;margin-bottom:10px;border-left:4px solid ' + ({ green: '#16a34a', blue: '#0883F7', amber: '#d97706', red: '#dc2626', gray: '#94a3b8' }[tone]) }, [
      el('div', { style: 'display:flex;gap:12px;align-items:flex-start;flex-wrap:wrap' }, [
        el('div', { style: 'flex:1;min-width:260px' }, [
          el('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [
            el('b', { style: 'font-size:1rem' }, r.name || '—'), pill(tone, label),
            r.can_post ? pill('green', 'can post') : pill('gray', 'cannot post'),
            r.domain_match === false ? pill('amber', 'email ≠ FMCSA domain') : '',
          ]),
          el('div', { style: 'color:#64748b;font-size:.84rem;margin-top:4px' }, [
            (r.is_agent ? 'Agent of ' + (r.parent_legal_name || '?') + ' · parent MC-' + (r.parent_mc || '?') : 'MC-' + (r.mc_number || '—')) + ' · ' + (r.owner_email || '') + ' · joined ' + ago(r.created_at),
          ]),
          el('div', { style: 'color:#334155;font-size:.84rem;margin-top:6px' }, [
            el('b', null, 'FMCSA: '), scrTxt + (r.fmcsa_legal_name ? ' · ' + r.fmcsa_legal_name : '') + (r.screened_at ? ' · ' + ago(r.screened_at) : ''),
            r.screening_reason ? el('div', { style: 'color:#7c8aa0;margin-top:2px' }, r.screening_reason) : '',
          ]),
          (!r.is_agent && scr === 'pass') ? el('div', { style: 'color:#334155;font-size:.84rem;margin-top:6px' }, [
            el('b', null, 'Identity: '),
            r.identity_status === 'verified' ? '✓ ' + ({ domain: 'signup email domain = FMCSA domain', email: 'confirmed from the FMCSA-listed email', phone: 'code by automated call to the FMCSA-listed phone', staff: 'confirmed by staff', parent: 'confirmed by parent' }[r.identity_method] || r.identity_method || 'verified') + (r.identity_verified_at ? ' · ' + ago(r.identity_verified_at) : '')
              : r.identity_status === 'declined' ? '🚨 DECLINED by the FMCSA contact — possible impersonation'
              : r.identity_status === 'pending' ? (r.identity_fmcsa_email ? '⏳ claim email ' + (r.identity_email_sent_at ? 'sent ' + ago(r.identity_email_sent_at) + ' to ' + r.identity_fmcsa_email + (r.identity_resends ? ' (' + r.identity_resends + ' resend' + (r.identity_resends === 1 ? '' : 's') + ')' : '') : 'not sent yet') : '📞 FMCSA lists NO email — call ' + (r.identity_fmcsa_phone || r.fmcsa_phone || '(no phone either)'))
              : 'not started',
            r.identity_signup_email ? el('div', { style: 'color:#7c8aa0;margin-top:2px' }, 'signup ' + r.identity_signup_email + ' · FMCSA ' + (r.identity_fmcsa_email || 'no email') + ' · ' + (r.identity_fmcsa_phone || r.fmcsa_phone || 'no phone')) : '',
            r.identity_note ? el('div', { style: 'color:#7c8aa0;margin-top:2px' }, r.identity_note) : '',
          ]) : '',
          r.is_agent && (r.parents || []).length ? el('div', { style: 'color:#334155;font-size:.84rem;margin-top:6px' }, [
            el('b', null, 'Brokerages (' + r.parents.length + '): '),
            ...r.parents.map((p) => el('div', { style: 'margin:2px 0 0 10px' }, [
              (p.status === 'confirmed' ? '✓ ' : p.status === 'pending' ? '⏳ ' : p.status === 'declined' ? '🚨 ' : p.status === 'revoked' ? '⛔ ' : '· ') + (p.name || '?') + ' · MC-' + (p.mc || '?') + ' · ' + p.status
              + (p.on_loadboot ? ' · on LoadBoot' : '') + (p.screen && p.screen !== 'pass' ? ' · screen ' + p.screen + (p.screen_reason ? ' (' + p.screen_reason + ')' : '') : '')
              + (p.sent_at ? ' · code emailed ' + ago(p.sent_at) + ' to ' + (p.sent_to || '?') + ' (' + (p.contact_source || '?') + ')' : (p.status === 'pending' ? ' · NO EMAIL ON FMCSA RECORD' + (p.contact_email ? ' · agent gave ' + p.contact_email + ' (other domain, ignored)' : '') : ''))
              + (p.confirmed_at ? ' · confirmed ' + ago(p.confirmed_at) + ' by ' + (p.confirmed_by || '?') : '') + (p.declined_at ? ' · declined ' + ago(p.declined_at) : '') + (p.revoked_at ? ' · revoked ' + ago(p.revoked_at) : '') + (p.note ? ' — "' + p.note + '"' : ''),
            ])),
          ]) : r.is_agent ? el('div', { style: 'color:#334155;font-size:.84rem;margin-top:6px' }, [
            el('b', null, 'Parent: '),
            r.parent_org_id ? el('span', null, ['on LoadBoot as ', el('a', { href: '#/broker?id=' + r.parent_org_id }, r.parent_org_name || 'parent org'), ' · ']) : '',
            r.parent_confirmed_at ? '✓ confirmed ' + ago(r.parent_confirmed_at) + ' by ' + (r.parent_confirmed_by || '?')
              : r.parent_declined_at ? '✕ DECLINED ' + ago(r.parent_declined_at) + (r.parent_note ? ' — "' + r.parent_note + '"' : '')
              : r.parent_confirm_sent_at ? '⏳ email sent ' + ago(r.parent_confirm_sent_at) + ' to ' + (r.parent_contact_email || '?') + ' (' + (r.parent_contact_source || '?') + ')'
              : 'no email sent yet' + (r.parent_contact_email ? ' · ' + r.parent_contact_email : ' · NO CONTACT ADDRESS'),
          ]) : '',
          el('div', { style: 'color:#334155;font-size:.84rem;margin-top:6px' }, [
            el('b', null, 'Posting: '), (r.active_postings || 0) + ' open' + (r.posting_limit == null ? ' · unlimited' : ' of ' + r.posting_limit) + ' · ' + (r.loads_total || 0) + ' submitted' + (r.loads_awaiting_review ? ' · ' + r.loads_awaiting_review + ' awaiting review' : '') + ' · agreement ' + (r.agreement_ok ? '✓' : '✕') + ' · packet ' + (r.packet_done || 0) + '/' + (r.packet_total || 0) + (r.first_delivered ? ' · first delivery ✓' : ''),
            r.reason ? el('div', { style: 'color:#b45309;margin-top:2px' }, r.reason) : '',
            r.hold_reason ? el('div', { style: 'color:#b91c1c;margin-top:2px' }, 'HOLD: ' + r.hold_reason) : '',
          ]),
        ]),
        el('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;max-width:360px' }, actions),
      ]),
    ]);
  }

  const needsHuman = (r) => ['unknown', 'not_found', 'error'].includes(r.screening)
    || (r.is_agent && !r.parent_confirmed_at && !r.parent_declined_at && r.screening === 'pass')
    || (!r.is_agent && r.screening === 'pass' && r.identity_status !== 'verified' && ((!r.identity_fmcsa_email && !(r.identity_fmcsa_phone || r.fmcsa_phone)) || r.identity_status === 'declined' || (r.identity_note || '').includes('call requested')));
  async function load() {
    showLoading(body, 'Loading broker trust queue…');
    let rows; try { rows = await ccBrokerTrustQueue(); } catch (e) { showError(body, humanizeError(e), load); return; }
    rows = rows || [];
    const n = (t) => rows.filter((r) => r.tier === t).length;
    mount(kpis, [
      statCard({ icon: 'users', label: 'Brokers', value: String(rows.length), sub: 'non-demo, not archived', accent: 'blue' }),
      statCard({ icon: 'check', label: 'Can post now', value: String(rows.filter((r) => r.can_post).length), sub: n('verified') + ' verified · ' + (n('screened') + n('agent_confirmed')) + ' limited', accent: 'green', onClick: () => { filter = 'can'; paint(); } }),
      statCard({ icon: 'clock', label: 'Needs a human', value: String(rows.filter(needsHuman).length), sub: 'screen by hand / declined identity / no FMCSA contact at all', accent: 'amber', onClick: () => { filter = 'human'; paint(); } }),
      statCard({ icon: 'alert', label: 'Failed / on hold', value: String(rows.filter((r) => r.screening === 'fail' || r.tier === 'hold').length), sub: 'carrier MCs, revoked, declined', accent: 'red', onClick: () => { filter = 'bad'; paint(); } }),
    ]);
    const mkF = (k, l) => el('button', { class: 'cc-btn-sm', style: filter === k ? 'background:#10223B;color:#fff;border-color:#10223B' : '', onClick: () => { filter = k; paint(); } }, l);
    function paint() {
      mount(filters, [mkF('all', 'All'), mkF('can', 'Can post'), mkF('human', 'Needs a human'), mkF('bad', 'Failed / hold'), mkF('new', 'Never screened')]);
      const f = rows.filter((r) => filter === 'all' ? true
        : filter === 'can' ? r.can_post
        : filter === 'human' ? needsHuman(r)
        : filter === 'bad' ? (r.screening === 'fail' || r.tier === 'hold')
        : filter === 'new' ? !r.screening : true);
      mount(body, f.length ? f.map(row) : el('div', { class: 'cc-card', style: 'padding:24px;color:#64748b' }, 'Nothing in this bucket.'));
    }
    paint();
  }
}
