// bl_disp_0551 — one reading of a dispatcher load post, shared by the Command Center (Carrier 360 / Dispatcher 360)
// and the dispatcher workspace: what is missing from the post, how far it got with the carrier (board → opened →
// decision → booking), and a one-line "seen" sentence. Pure functions over the cc_dispatcher_posts /
// dispatcher_my_posts row; no DOM, no network.

const CITY_ST = /^[^,]{2,},\s*[A-Za-z]{2}\b/;

// Fields the dispatcher left out. `high` = the carrier cannot judge the load without it (or a guard did not run).
export function postMissing(p) {
  const d = (p && p.details) || {}; const out = [];
  const add = (label, level, why) => out.push({ label, level, why });
  if (!CITY_ST.test(String(p.origin || '').trim())) add('Origin as "City, ST"', 'high', 'Origin reads "' + (p.origin || '—') + '" — the carrier cannot place it on a map.');
  if (!CITY_ST.test(String(p.destination || '').trim())) add('Destination as "City, ST"', 'high', 'Destination reads "' + (p.destination || '—') + '".');
  if (!(Number(p.miles) > 0)) add('Loaded miles', 'high', 'No miles → no $/mile, and the carrier’s floor rate was not checked.');
  if (!String(d.broker_mc || '').trim()) add('Broker MC', 'high', 'No MC → the broker was not screened on FMCSA.');
  if (!String(d.broker_phone || '').trim() && !String(d.broker_email || '').trim()) add('Broker phone / e-mail', 'low', 'Nobody to call for the RC.');
  if (!String(p.source_reference || d.board_ref || '').trim()) add('Board load ID', 'low', 'The load cannot be found again on the board.');
  if (!String(p.pickup_window || d.pickup_window || '').trim()) add('Pickup window', 'low');
  if (!p.delivery_date && !d.delivery_date) add('Delivery date', 'low');
  if (!String(p.commodity || d.commodity || '').trim()) add('Commodity', 'low');
  if (!p.weight && !d.weight_lbs) add('Weight', 'low');
  if (!String(d.origin_zip || d.origin_full || '').trim() || !String(d.destination_zip || d.destination_full || '').trim()) add('ZIP / address', 'low');
  if (!String(p.notes || d.notes || '').trim()) add('Note to the carrier', 'low');
  return out;
}

export function postStatus(p) {
  if (p && p.staff && p.staff.deleted_at) return 'deleted';
  return (p.status === 'available' && (p.expired || (p.expires_at && new Date(p.expires_at) <= new Date()))) ? 'expired' : p.status;
}

// Journey steps: done / now / todo / bad — rendered as a stepper by each surface.
export function postJourney(p) {
  const s = (p && p.seen) || {}; const dec = p.decision || {}; const st = postStatus(p); const bk = p.booking || null;
  const steps = [{ key: 'posted', label: 'Posted', at: p.created_at, state: 'done' }];
  steps.push({ key: 'board', label: 'On their board', at: s.board_at || null, state: s.board_at ? 'done' : (st === 'available' ? 'now' : 'todo') });
  steps.push({ key: 'opened', label: s.opens > 1 ? 'Opened ×' + s.opens : 'Opened', at: s.opened_at || null, state: s.opened_at ? 'done' : (s.board_at && st === 'available' ? 'now' : 'todo') });
  if (dec.action === 'accepted' || st === 'carrier_accepted' || st === 'booked') steps.push({ key: 'decision', label: 'Accepted', at: dec.at || null, state: 'done' });
  else if (dec.action === 'declined' || st === 'declined') steps.push({ key: 'decision', label: 'Declined', at: dec.at || null, state: 'bad', note: dec.reason || '' });
  else if (st === 'expired') steps.push({ key: 'decision', label: 'Expired', at: p.expires_at || null, state: 'bad' });
  else if (st === 'withdrawn' || st === 'deleted') steps.push({ key: 'decision', label: st === 'deleted' ? 'Removed' : 'Withdrawn', at: (p.withdrawn && p.withdrawn.at) || null, state: 'bad', note: (p.withdrawn && p.withdrawn.reason) || '' });
  else steps.push({ key: 'decision', label: 'Decision', at: null, state: s.opened_at ? 'now' : 'todo' });
  if (bk && bk.id) steps.push({ key: 'booking', label: bk.status === 'approved' ? 'Booking approved' : bk.status === 'rejected' ? 'Booking rejected' : 'Booking · RC', at: bk.created_at || null, state: bk.status === 'rejected' ? 'bad' : bk.status === 'approved' ? 'done' : 'now' });
  return steps;
}

// "Seen" in one sentence — the thing the dispatcher and LoadBoot both want to know first.
export function postSeenLine(p, fmt) {
  const s = (p && p.seen) || {}; const f = fmt || ((x) => new Date(x).toLocaleString());
  if (s.opened_at) return 'Opened' + (s.opened_by ? ' by ' + s.opened_by : '') + ' · ' + f(s.opened_at) + (s.opens > 1 ? ' · ' + s.opens + ' opens, last ' + f(s.last_opened_at) : '');
  if (s.board_at) return 'On their board since ' + f(s.board_at) + ' — not opened yet';
  if (s.notif_read_at) return 'Notification read ' + f(s.notif_read_at) + ' — not opened yet';
  return 'Not seen by the carrier yet';
}
