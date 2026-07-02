// printDoc.js — renders a document payload (from cc_invoice_document / cc_ratecon_document)
// into a clean printable window the user can save as PDF via the browser. No server PDF lib.
const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const row = (k, v) => `<tr><td class="k">${k}</td><td class="v">${v == null || v === '' ? '—' : v}</td></tr>`;

function shell(title, sub, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#10223B;margin:0;padding:40px;max-width:760px}
    .brand{font-size:22px;font-weight:800}.brand b{color:#FC5305}
    .head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b1220;padding-bottom:16px;margin-bottom:8px}
    h1{font-size:18px;margin:18px 0 2px}.sub{color:#64748b;font-size:13px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin:8px 0 18px}
    td{padding:9px 4px;border-bottom:1px solid #eef2f7;font-size:14px}.k{color:#64748b;width:38%}.v{font-weight:600}
    .total{font-size:20px;font-weight:800}.terms{color:#475569;font-size:12px;border-top:1px solid #eef2f7;padding-top:12px;margin-top:8px}
    .pill{display:inline-block;background:#eef2f7;border-radius:20px;padding:3px 10px;font-size:12px;font-weight:700}
    @media print{body{padding:0}.noprint{display:none}}
    .bar{margin:20px 0}.btn{background:#0883F7;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}
  </style></head><body>
    <div class="bar noprint"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
    <div class="head"><div class="brand">Load<b>boot</b></div><div style="text-align:right"><div class="pill">${sub}</div></div></div>
    ${bodyHtml}
  </body></html>`;
}

export function printDocument(doc) {
  if (!doc) return;
  let html = '';
  if (doc.doc === 'invoice') {
    html = shell('Invoice ' + doc.invoice_no, 'INVOICE', `
      <h1>Invoice ${doc.invoice_no}</h1>
      <div class="sub">Status: ${doc.status} · Due ${doc.due_at || '—'}</div>
      <table>
        ${row('Carrier', doc.carrier)}
        ${row('Lane', doc.lane)}
        ${row('Equipment', doc.equipment)}
        ${row('Load gross', money(doc.gross))}
        ${row('Dispatch fee (' + (doc.fee_pct || 5) + '%)', '<span class="total">' + money(doc.fee) + '</span>')}
        ${row('Carrier net', money(doc.net))}
      </table>
      <div class="terms">${doc.terms || ''}</div>`);
  } else if (doc.doc === 'rate_confirmation') {
    html = shell('Rate Confirmation', 'RATE CONFIRMATION', `
      <h1>Rate Confirmation</h1>
      <div class="sub">${doc.origin} → ${doc.destination}</div>
      <table>
        ${row('Carrier', doc.carrier)}
        ${row('Driver', doc.driver)}
        ${row('Truck', doc.truck)}
        ${row('Origin', doc.origin)}
        ${row('Destination', doc.destination)}
        ${row('Equipment', doc.equipment)}
        ${row('Commodity', doc.commodity)}
        ${row('Pickup', doc.pickup)}
        ${row('Delivery', doc.delivery)}
        ${row('Agreed rate', '<span class="total">' + money(doc.rate) + '</span>')}
      </table>
      <div class="terms">${doc.terms || ''}</div>`);
  } else { html = shell('Document', 'DOCUMENT', '<pre>' + JSON.stringify(doc, null, 2) + '</pre>'); }

  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// Open a branded printable window (Save as PDF via browser) from titled sections.
// sections: [{ h?:'Heading', rows?:[[k,v],...], note?:'text' }]
function openPrintable(title, sub, sections) {
  const body = (sections || []).map(s => {
    if (s.note != null) return `<div class="terms">${s.note}</div>`;
    const rows = (s.rows || []).map(([k, v]) => row(k, v)).join('');
    return `${s.h ? '<h1>' + s.h + '</h1>' : ''}<table>${rows}</table>`;
  }).join('');
  const w = window.open('', '_blank');
  if (w) { w.document.write(shell(title, sub, body)); w.document.close(); }
}
export { openPrintable };

// Beautiful, downloadable Dispatch Sheet (from cc_dispatch_sheet payload).
export function printDispatchSheet(d) {
  d = d || {};
  const pk = d.pickup || {}, dl = d.delivery || {}, dr = d.driver || {}, det = d.detention || {};
  openPrintable('Dispatch Sheet', 'DISPATCH SHEET', [
    { rows: [
      ['Load', d.load_number], ['Issued by', d.issued_by || 'LoadBoot Dispatch'],
      ['Agreed rate', '<span class="total">' + money(d.agreed_rate) + '</span>'],
      ['Loaded miles', d.loaded_miles], ['RPM', d.loaded_rpm ? '$' + d.loaded_rpm : '—'], ['Deadhead', d.deadhead_note],
    ] },
    { h: 'Pickup', rows: [['Address', pk.address], ['Date', pk.date], ['Window', pk.window],
      ['Appointment', pk.appointment_required ? 'Required' : 'FCFS / window'], ['Reference', pk.reference]] },
    { h: 'Delivery', rows: [['Address', dl.address], ['Date', dl.date], ['Window', dl.window]] },
    { h: 'Freight', rows: [['Commodity', d.commodity], ['Weight', d.weight], ['Equipment', d.equipment]] },
    { h: 'Truck & driver', rows: [['Driver', dr.name], ['Phone', dr.phone], ['Truck #', d.truck_no], ['Trailer #', d.trailer_no]] },
    { h: 'Accessorial rates', rows: [
      ['Detention', (det.rate_per_hr ? '$' + det.rate_per_hr + '/hr' : '—') + (det.free_hours ? ' after ' + det.free_hours + 'h free' : '')],
      ['Layover', d.layover ? '$' + d.layover + '/day' : '—'], ['TONU', d.tonu ? '$' + d.tonu : '—'], ['Lumper', d.lumper_process]] },
    { note: (d.tracking_instructions || '') + '<br>' + (d.pod_instructions || '') + (d.special_instructions ? '<br><br><b>Special:</b> ' + d.special_instructions : '') },
  ]);
}

export default printDocument;
