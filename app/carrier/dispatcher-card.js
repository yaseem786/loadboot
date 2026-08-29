// dispatcher-card.js — carrier-portal card: "Your LoadBoot dispatcher" + the shared 3-way thread.
// Mounted from the carrier dashboard via dynamic import (same pattern as economics.js). Renders
// nothing when the carrier has no dispatcher assignment. Backend: bl_disp_0288 + bl_disp_0300
// (carrier_my_dispatcher, carrier_my_dispatcher_bookings, carrier_dispatcher_ack / _pause,
// carrier_booking_ack, dispatcher_thread_list / send / mark_read — all accept carrier org members).
//
// 2026-08-29 audit rework: the carrier is told exactly what the dispatcher can see and CONFIRMS the
// assignment; can PAUSE it themselves; sees the loads booked under their MC with the RC and a one-tap
// "Got it / Problem"; the SOP (floor rate, home time) the dispatcher works to; dispatcher phone + hours;
// who last updated availability (you / dispatcher / ELD). Times shown in the carrier's own timezone.
import { carrierMyDispatcher, carrierMyDispatcherBookings, carrierDispatcherAck, carrierDispatcherPause, carrierBookingAck,
  dispatcherThreadList, dispatcherThreadSend, dispatcherThreadMarkRead, dispatcherSetAvailability } from '../shared/api.js';
import { signedDocumentUrl } from '../shared/storage.js';
import { el, mount } from '../shared/ui/dom.js';
import { icon } from '../shared/ui/icons.js';

const h = el;
const dtLocal = (v) => { if (!v) return ''; const d = new Date(v); if (isNaN(d)) return ''; const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); };
const fromLocal = (s) => (s ? new Date(s).toISOString() : null);
const ago = (v) => { if (!v) return ''; const m = Math.round((Date.now() - new Date(v).getTime()) / 60000); if (m < 1) return 'just now'; if (m < 60) return m + ' min ago'; const hh = Math.round(m / 60); if (hh < 48) return hh + ' h ago'; return Math.round(hh / 24) + ' d ago'; };
const when = (v) => { if (!v) return ''; const d = new Date(v); return isNaN(d) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
const money = (v) => '$' + Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
const STATUS = { pending_rc: 'Booked — RC pending', rc_received: 'RC with LoadBoot', approved: 'APPROVED — driver may go', dispatched: 'Dispatched', picked_up: 'In transit', delivered: 'Delivered', invoiced: 'Invoiced', paid: 'Paid', cancelled: 'Cancelled' };

export async function mountDispatcherCard(host) {
  let rows = [];
  try { rows = await carrierMyDispatcher(); } catch (_) { rows = []; }
  if (!Array.isArray(rows) || !rows.length) { host.remove(); return; }
  const a = rows[0]; const d = a.dispatcher || {}; const sop = a.sop || {};
  const paused = a.status === 'paused';
  // e-mail deep link: /app/carrier/?ack=<assignment> → one-tap acknowledgement (idempotent server-side)
  let ackParam = null; try { ackParam = new URLSearchParams(location.search).get('ack') || sessionStorage.getItem('lb_disp_ack'); } catch (_) {}
  if (ackParam) { try { sessionStorage.removeItem('lb_disp_ack'); history.replaceState(null, '', location.pathname + location.hash); } catch (_) {}
    if (ackParam === a.assignment_id && !a.carrier_ack_at) { try { const r = await carrierDispatcherAck(a.assignment_id); if (r && !r.error) { a.carrier_ack_at = new Date().toISOString(); a.ack_state = 'confirmed'; } } catch (_) {} }
    setTimeout(() => { try { host.scrollIntoView({ behavior: 'smooth', block: 'start' }); host.style.outline = '2px solid #4EA6F9'; host.style.borderRadius = '18px'; setTimeout(() => { host.style.outline = ''; }, 4000); } catch (_) {} }, 400); }
  const ackState = a.ack_state || (a.carrier_ack_at ? 'confirmed' : 'pending');
  const thread = h('div', { style: 'max-height:260px;overflow:auto;padding:4px 2px;margin:8px 0', role: 'log' });
  const inp = h('textarea', { class: 'cp-in', rows: 2, placeholder: 'Message your dispatcher (LoadBoot sees this too)…' });
  const err = h('div', { class: 'cp-err', style: 'display:none' });
  const fail = (box, e) => { box.textContent = e.message || String(e); box.style.display = 'block'; };
  async function paint() {
    try {
      const r = await dispatcherThreadList(a.assignment_id, 100); if (r && r.error) throw new Error(r.error);
      const ms = (r && r.messages) || [];
      mount(thread, ms.length ? ms.map((m) => h('div', { style: 'max-width:82%;padding:8px 11px;border-radius:13px;margin:5px 0;' + (m.mine ? 'margin-left:auto;background:rgba(8,131,247,.18);border:1px solid rgba(8,131,247,.35)' : m.role === 'system' ? 'max-width:100%;text-align:center;background:transparent;border:1px dashed rgba(255,255,255,.18);font-size:.84rem;opacity:.85' : 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)') }, [
        m.role !== 'system' ? h('div', { style: 'font-size:.66rem;font-weight:800;letter-spacing:.06em;text-transform:uppercase;opacity:.65' }, (m.mine ? 'you' : m.role === 'staff' ? 'LoadBoot' : (m.by || m.role)) + ' · ' + when(m.at)) : null,
        h('div', { style: 'white-space:pre-wrap' }, m.body),
      ])) : h('div', { class: 'cp-muted' }, 'No messages yet — your dispatcher will reach out here with pickup details and updates.'));
      thread.scrollTop = thread.scrollHeight;
      dispatcherThreadMarkRead(a.assignment_id).catch(() => {});
    } catch (e) { mount(thread, h('div', { class: 'cp-muted' }, e.message || 'Could not load messages.')); }
  }
  function availRow(t) {
    const av = t.availability || {}; const box = h('div', { style: 'padding:8px 0;border-top:1px solid rgba(255,255,255,.08)' });
    const by = av.updated_by_role === 'you' ? 'you' : av.updated_by_role === 'dispatcher' ? (d.name || 'your dispatcher') : av.updated_by_role === 'eld' ? 'your ELD' : av.updated_by_role === 'loadboot' ? 'LoadBoot' : null;
    const view = () => mount(box, h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
      h('div', { style: 'flex:1;min-width:200px' }, [h('b', { style: 'color:#fff' }, 'Unit ' + (t.unit_no || '?') + (t.equipment ? ' · ' + t.equipment : '')),
        h('div', { class: 'cp-row-s' }, [(av.status || 'empty').toUpperCase(), av.empty_location ? ' · empty at ' + av.empty_location + (av.empty_at ? ' from ' + when(av.empty_at) : '') : ' · location not set', av.must_be_home_by ? ' · home by ' + when(av.must_be_home_by) : '', av.hos_drive_left_h != null ? ' · ' + av.hos_drive_left_h + ' h drive left' + (av.hos_note ? ' (' + av.hos_note + ')' : '') : '', av.driver_name ? ' · driver ' + av.driver_name : ' · ⚠ no driver set', av.updated_at ? ' · updated ' + ago(av.updated_at) + (by ? ' by ' + by : '') : ''])]),
      h('button', { class: 'cp-btn cp-btn-sm', onClick: edit }, av.updated_at ? 'Update' : 'Set'),
    ]));
    const edit = () => {
      const I = (k, type, extra) => h('input', Object.assign({ class: 'cp-in', type: type || 'text', value: av[k] == null ? '' : (type === 'datetime-local' ? dtLocal(av[k]) : String(av[k])) }, extra || {}));
      const st = h('select', { class: 'cp-in' }, ['empty', 'loaded', 'off', 'maintenance'].map((v) => h('option', { value: v, selected: (av.status || 'empty') === v }, v.toUpperCase())));
      const loc = I('empty_location'), eat = I('empty_at', 'datetime-local'), home = I('must_be_home_by', 'datetime-local'), hloc = I('home_location'), hos = I('hos_drive_left_h', 'number', { min: '0', max: '14', step: '0.5' }), dn = I('driver_name'), dp = I('driver_phone'), note = h('input', { class: 'cp-in', value: av.note || '', placeholder: 'anything your dispatcher should know' });
      const owe = h('input', { type: 'checkbox', checked: av.overnight_weekends === true }), owd = h('input', { type: 'checkbox', checked: av.overnight_weekdays !== false });
      const e2 = h('div', { class: 'cp-err', style: 'display:none' });
      const L = (l, x) => h('label', { style: 'display:flex;flex-direction:column;gap:3px;font-size:.74rem;font-weight:800;opacity:.85' }, [l, x]);
      mount(box, h('div', null, [h('b', { style: 'color:#fff' }, 'Unit ' + (t.unit_no || '?')), h('div', { class: 'cp-row-s' }, 'Times are in your local time.'), h('div', { style: 'display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:6px 0' }, [
        L('Status', st), L('Empty at (City, ST)', loc), L('Empty from', eat), L('Must be home by', home), L('Home location', hloc), L('Drive hours left (0–14)', hos), L('Driver', dn), L('Driver phone', dp),
        h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:.8rem' }, [owd, 'Overnight OK weekdays']), h('label', { style: 'display:flex;gap:6px;align-items:center;font-size:.8rem' }, [owe, 'Overnight OK weekends']),
      ]), note, e2, h('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [
        h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.target.disabled = true; try {
          const next = { status: st.value, empty_location: loc.value, empty_at: fromLocal(eat.value), must_be_home_by: fromLocal(home.value), home_location: hloc.value, hos_drive_left_h: hos.value === '' ? null : Number(hos.value), driver_name: dn.value, driver_phone: dp.value, overnight_weekdays: owd.checked, overnight_weekends: owe.checked, note: note.value };
          const r = await dispatcherSetAvailability(t.id, next); if (r && r.error) throw new Error(r.error);
          Object.assign(av, next, { updated_at: new Date().toISOString(), updated_by_role: 'you' }); view();
        } catch (x) { fail(e2, x); ev.target.disabled = false; } } }, 'Save'),
        h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: view }, 'Cancel'),
      ])]));
    };
    view(); return box;
  }
  // ---- loads booked under my MC by the dispatcher
  const loadsBox = h('div', { style: 'margin-top:12px' });
  async function paintLoads() {
    let bs = []; try { bs = await carrierMyDispatcherBookings(30); } catch (_) { bs = []; }
    if (!Array.isArray(bs) || !bs.length) { mount(loadsBox, ''); return; }
    const open = bs.filter((b) => !['delivered', 'invoiced', 'paid', 'cancelled'].includes(b.status));
    const done = bs.length - open.length;
    mount(loadsBox, [h('div', { style: 'font-weight:900;color:#fff;margin-bottom:4px' }, 'Loads your dispatcher booked (' + open.length + ' open' + (done ? ', ' + done + ' completed' : '') + ')'),
      ...(open.length ? open : bs.slice(0, 3)).map((b) => {
        const e3 = h('div', { class: 'cp-err', style: 'display:none' });
        const ack = (ok) => {
          const box = h('div', { style: 'margin-top:6px' }); const ta = h('input', { class: 'cp-in', placeholder: ok ? 'note for the dispatcher (optional)' : 'what is the problem? *' });
          const go = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { try { const r = await carrierBookingAck(b.id, ok, ta.value); if (r && r.error) throw new Error(r.error); await paintLoads(); } catch (x) { fail(e3, x); } } }, ok ? 'Confirm' : 'Send problem');
          mount(box, [ta, h('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [go, h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => box.remove() }, 'Cancel')])]); row.appendChild(box); ta.focus(); };
        const row = h('div', { style: 'padding:8px 0;border-top:1px solid rgba(255,255,255,.08)' }, [
          h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [h('b', { style: 'color:#fff;flex:1;min-width:180px' }, b.origin + ' → ' + b.destination), h('span', { class: 'cp-pill', style: 'font-weight:800;' + (b.status === 'approved' ? 'color:#4ade80' : b.status === 'rc_received' ? 'color:#7cc0ff' : '') }, STATUS[b.status] || b.status)]),
          h('div', { class: 'cp-row-s' }, [b.broker || '', b.truck ? ' · unit ' + b.truck : '', ' · ', money(b.gross), b.miles ? ' · ' + Number(b.miles).toLocaleString('en-US') + ' mi · $' + (Number(b.gross) / Number(b.miles)).toFixed(2) + '/mi' : '', b.pickup_at ? ' · pickup ' + when(b.pickup_at) : '', b.delivery_at ? ' · delivery ' + when(b.delivery_at) : '', b.commodity ? ' · ' + b.commodity : '', b.weight_lbs ? ' · ' + Number(b.weight_lbs).toLocaleString('en-US') + ' lb' : ''].join('')),
          Array.isArray(b.stops) && b.stops.length ? h('div', { class: 'cp-row-s' }, 'Stops: ' + b.stops.map((s, i) => (i + 1) + '. ' + (s.kind || '') + ' ' + (s.location || '') + (s.at ? ' ' + when(s.at) : '')).join(' → ')) : null,
          b.below_min ? h('div', { class: 'cp-row-s', style: 'color:#fbbf24' }, '⚠ Under your floor rate' + (b.decision_note ? ' — LoadBoot: ' + b.decision_note : '')) : (b.decision_note ? h('div', { class: 'cp-row-s' }, 'LoadBoot: ' + b.decision_note) : null),
          b.carrier_ack ? h('div', { class: 'cp-row-s', style: 'color:' + (/PROBLEM/.test(b.carrier_ack) ? '#f87171' : '#4ade80') }, b.carrier_ack) : null,
          h('div', { style: 'display:flex;gap:6px;flex-wrap:wrap;margin-top:6px' }, [
            b.rc_doc_path ? h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: async () => { try { const u = await signedDocumentUrl(b.rc_doc_path, 600); window.open(u, '_blank', 'noopener'); } catch (x) { fail(e3, x); } } }, 'Open rate confirmation') : (b.status === 'rc_received' ? h('span', { class: 'cp-row-s' }, 'RC is with LoadBoot for approval — you get it the moment it is approved.') : null),
            ['approved', 'dispatched'].includes(b.status) && !b.carrier_ack ? h('button', { class: 'cp-btn cp-btn-sm', onClick: () => ack(true) }, '👍 Got it') : null,
            ['approved', 'dispatched'].includes(b.status) ? h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => ack(false) }, 'Problem') : null,
            b.trip_id ? h('a', { class: 'cp-btn-ghost cp-btn-sm', href: '#trips' }, 'Track trip') : null,
          ]), e3]);
        return row;
      })]);
  }
  // ---- confirm / pause
  const ackBox = h('div', { style: 'margin-top:10px' });
  function paintAck() {
    const e4 = h('div', { class: 'cp-err', style: 'display:none' });
    if (paused) { mount(ackBox, [h('div', { style: 'background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.45);border-radius:12px;padding:10px 12px;font-weight:700' }, 'This dispatcher assignment is PAUSED — no new loads are being booked for you. LoadBoot dispatch covers your truck meanwhile.'),
      h('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { try { const r = await carrierDispatcherPause(a.assignment_id, false, null); if (r && r.error) throw new Error(r.error); location.reload(); } catch (x) { fail(e4, x); } } }, 'Resume dispatcher')]), e4]); return; }
    if ((a.ack_state || ackState) === 'notified') {
      mount(ackBox, h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [h('span', { class: 'cp-row-s' }, 'Intro e-mailed ' + when(a.carrier_notified_at || a.assigned_at) + ' — under your Dispatch Service Agreement this assignment is in effect. '), h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => { a.ack_state = 'pending'; paintAck(); } }, 'Read what they can see'), h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: pauseFlow }, 'Pause dispatcher'), e4]));
      return;
    }
    if (!a.carrier_ack_at) {
      a.ack_state = 'pending';
      mount(ackBox, [h('div', { style: 'background:rgba(8,131,247,.12);border:1px solid rgba(8,131,247,.4);border-radius:12px;padding:10px 12px' }, [
        h('div', { style: 'font-weight:900;color:#fff' }, 'Your dispatcher — what they can and cannot see'),
        h('div', { class: 'cp-row-s' }, 'Nothing new to sign: this runs under the Dispatch Service Agreement you already have with LoadBoot. One tap below just tells us you read it.'),
        h('div', { class: 'cp-row-s', style: 'line-height:1.7;margin-top:4px' }, [
          '✅ Truck specs, driver name and phone, where the truck is empty and your home-time rules', h('br'),
          '✅ Your approved authority (MC), COI, W-9 and factoring NOA — to set you up with brokers', h('br'),
          '✅ This thread and the loads they book under your MC', h('br'),
          '❌ Your bank details, voided check, settlements or LoadBoot fees — never', h('br'),
          '❌ They cannot move your driver: every load is approved by LoadBoot from the rate confirmation first', h('br'),
          'They use their own load-board login, never yours. You can pause them any time from this card.']),
        h('div', { style: 'display:flex;gap:8px;margin-top:8px;flex-wrap:wrap' }, [
          h('button', { class: 'cp-btn cp-btn-sm', onClick: async (ev) => { ev.target.disabled = true; try { const r = await carrierDispatcherAck(a.assignment_id); if (r && r.error) throw new Error(r.error); a.carrier_ack_at = new Date().toISOString(); a.ack_state = 'confirmed'; paintAck(); paint(); } catch (x) { fail(e4, x); ev.target.disabled = false; } } }, 'Got it — confirm'),
          h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: pauseFlow }, 'Not now — pause'),
        ]), e4])]);
      return;
    }
    mount(ackBox, h('div', { style: 'display:flex;gap:8px;align-items:center;flex-wrap:wrap' }, [ackParam ? h('span', { style: 'color:#4ade80;font-weight:800' }, '✓ Thanks — dispatcher confirmed.') : null, h('span', { class: 'cp-row-s' }, 'Confirmed ' + when(a.carrier_ack_at) + ' · '), h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: pauseFlow }, 'Pause dispatcher'), e4]));
  }
  function pauseFlow() {
    const e5 = h('div', { class: 'cp-err', style: 'display:none' });
    const ta = h('input', { class: 'cp-in', placeholder: 'why? (one line — LoadBoot and the dispatcher see it) *' });
    const box = h('div', { style: 'margin-top:8px' }, [ta, h('div', { style: 'display:flex;gap:6px;margin-top:6px' }, [
      h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => { try { const r = await carrierDispatcherPause(a.assignment_id, true, ta.value); if (r && r.error) throw new Error(r.error); location.reload(); } catch (x) { fail(e5, x); } } }, 'Pause now'),
      h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: () => box.remove() }, 'Cancel')]), e5]);
    ackBox.appendChild(box); ta.focus();
  }
  const send = h('button', { class: 'cp-btn cp-btn-sm', onClick: async () => {
    if (!inp.value.trim()) return; send.disabled = true; err.style.display = 'none';
    try { const r = await dispatcherThreadSend(a.assignment_id, inp.value); if (r && r.error) throw new Error(r.error); inp.value = ''; await paint(); }
    catch (e) { fail(err, e); }
    send.disabled = false;
  } }, 'Send');
  const rules = [sop.min_rate ? 'Floor rate $' + Number(sop.min_rate).toFixed(2) + '/mi' + (sop.min_rate_note ? ' (' + sop.min_rate_note + ')' : '') : null, sop.home_time ? 'Home time: ' + sop.home_time : null, sop.scope_value ? 'Scope: ' + sop.scope_value : null, sop.rules ? sop.rules : null].filter(Boolean);
  mount(host, h('div', { class: 'cp-card' }, [
    h('div', { class: 'cp-cardhead' }, [h('h3', { style: 'display:flex;align-items:center;gap:8px' }, [icon('users', 18), 'Your LoadBoot dispatcher', Number(a.unread || 0) ? h('span', { class: 'cp-pill', style: 'background:#FC5305;color:#fff;font-weight:800' }, a.unread + ' new') : null])]),
    h('div', { style: 'display:flex;gap:10px;align-items:center;flex-wrap:wrap' }, [
      h('div', { style: 'width:42px;height:42px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:900;background:linear-gradient(135deg,#0883F7,#0a6fd6);color:#fff' }, String(d.name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()),
      h('div', null, [h('div', { style: 'font-weight:900;color:#fff' }, d.name || 'Dispatcher'), h('div', { class: 'cp-row-s' }, [d.label || 'LoadBoot dispatcher', d.hours ? ' · hours ' + d.hours : '', d.us_hours ? ' · covers US business hours' : '', ' · since ' + when(a.assigned_at)]), h('div', { class: 'cp-row-s' }, ['Reach them in your WhatsApp group or the thread below · LoadBoot: ', h('a', { href: 'mailto:' + (d.contact_email || 'dispatch@loadboot.com'), style: 'color:#7cc0ff' }, d.contact_email || 'dispatch@loadboot.com'), d.contact_whatsapp ? [' · WhatsApp ', h('a', { href: 'https://wa.me/' + String(d.contact_whatsapp).replace(/\D/g, ''), target: '_blank', rel: 'noopener', style: 'color:#7cc0ff' }, d.contact_whatsapp)] : null])]),
    ]),
    h('div', { class: 'cp-row-s', style: 'margin-top:8px;line-height:1.6' }, 'They find and book loads under your MC, send the rate confirmation to LoadBoot, and keep the broker updated. Every load is approved by LoadBoot before your driver moves. Keep your truck’s location and home-time current so they can plan. All communication stays in this thread and your WhatsApp group.'),
    rules.length ? h('div', { style: 'margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1)' }, [h('div', { style: 'font-weight:800;color:#fff;font-size:.84rem' }, 'The rules your dispatcher works to'), h('div', { class: 'cp-row-s', style: 'line-height:1.6' }, rules.map((r) => h('div', null, '· ' + r))), h('div', { class: 'cp-row-s', style: 'opacity:.75' }, 'Want to change these? Tell LoadBoot in the thread.')]) : null,
    ackBox,
    (a.trucks || []).length ? h('div', { style: 'margin-top:12px' }, [h('div', { style: 'font-weight:900;color:#fff;margin-bottom:4px' }, 'Where is your truck? (your dispatcher plans from this)'), ...(a.trucks || []).map((t) => availRow(t))]) : null,
    loadsBox,
    h('div', { style: 'font-weight:900;color:#fff;margin-top:12px' }, 'Thread — you · ' + (d.name || 'dispatcher') + ' · LoadBoot'),
    thread, inp, err,
    h('div', { style: 'display:flex;gap:8px;margin-top:8px' }, [send, h('button', { class: 'cp-btn-ghost cp-btn-sm', onClick: paint }, 'Refresh')]),
  ]));
  paintAck(); paint(); paintLoads();
}

export default mountDispatcherCard;
