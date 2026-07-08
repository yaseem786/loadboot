// fmcsa-flags.js — automatic FMCSA risk flags for staff review (CC Carrier 360 / onboarding).
// Pulls the same public FMCSA datasets the carrier "My Profile" uses and turns them into
// red/amber flags so the reviewer never has to compute rates by hand.
// National reference averages: vehicle OOS ~21%, driver OOS ~6% (FMCSA published).

const FBASE = 'https://data.transportation.gov/resource';
async function get(path) { try { const r = await fetch(FBASE + '/' + path, { headers: { Accept: 'application/json' } }); if (!r.ok) return null; return await r.json(); } catch (_) { return null; } }

export async function fmcsaRiskFlags(dot) {
  dot = String(dot || '').replace(/\D/g, '');
  if (!dot) return [];
  const flags = [];
  const [census, insp, crash] = await Promise.all([
    get('az4n-8mr2.json?dot_number=' + dot + '&$limit=1'),
    get('fx4q-ay7w.json?dot_number=' + dot + '&$order=insp_date DESC&$limit=120'),
    get('aayw-vxb3.json?dot_number=' + dot + '&$order=report_date DESC&$limit=40'),
  ]);
  const c = (census && census[0]) || null;
  if (!c) { flags.push({ tone: 'warning', text: 'FMCSA: no census record found for DOT ' + dot + ' — verify the number.' }); return flags; }

  // authority / status
  if (String(c.status_code || '').toUpperCase() !== 'A') flags.push({ tone: 'urgent', text: 'FMCSA: operating status is NOT ACTIVE — do not approve until FMCSA shows it active.' });
  if (String(c.docket1_status_code || '').toUpperCase() === 'I') flags.push({ tone: 'urgent', text: 'FMCSA: MC docket is INACTIVE.' });

  // out-of-service rates from recent inspections
  const rows = insp || []; let veh = 0, vehO = 0, drv = 0, drvO = 0;
  rows.forEach((x) => {
    const L = String(x.insp_level_id);
    if (L === '1' || L === '2' || L === '5') { veh++; if (Number(x.vehicle_oos_total) > 0) vehO++; }
    if (L === '1' || L === '2' || L === '3') { drv++; if (Number(x.driver_oos_total) > 0) drvO++; }
  });
  const vehRate = veh ? (vehO / veh) * 100 : null;
  const drvRate = drv ? (drvO / drv) * 100 : null;
  if (vehRate != null && vehRate >= 40) flags.push({ tone: 'urgent', text: 'FMCSA: vehicle out-of-service rate ' + vehRate.toFixed(1) + '% (' + vehO + '/' + veh + ' inspections) — ~2× the national average (21%).' });
  else if (vehRate != null && vehRate >= 30) flags.push({ tone: 'warning', text: 'FMCSA: vehicle OOS rate ' + vehRate.toFixed(1) + '% — above the national average (21%).' });
  if (drvRate != null && drvRate >= 15) flags.push({ tone: 'urgent', text: 'FMCSA: driver out-of-service rate ' + drvRate.toFixed(1) + '% (' + drvO + '/' + drv + ') — well above the national average (6%).' });
  else if (drvRate != null && drvRate >= 10) flags.push({ tone: 'warning', text: 'FMCSA: driver OOS rate ' + drvRate.toFixed(1) + '% — above the national average (6%).' });

  // recent crashes (24 months)
  const cutoff = Date.now() - 730 * 86400000;
  const recent = (crash || []).filter((x) => { const t = Date.parse(String(x.report_date || '').slice(0, 10)); return isFinite(t) && t >= cutoff; });
  const fatal = recent.reduce((a, x) => a + (Number(x.fatalities) || 0), 0);
  if (fatal > 0) flags.push({ tone: 'urgent', text: 'FMCSA: ' + fatal + ' fatality(ies) in crashes within the last 24 months.' });
  else if (recent.length >= 3) flags.push({ tone: 'warning', text: 'FMCSA: ' + recent.length + ' recorded crashes in the last 24 months.' });

  // hazmat authorization mismatch is checked by the compliance packet; note if census says not authorized
  return flags;
}

export default fmcsaRiskFlags;
