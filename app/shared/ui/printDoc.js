// printDoc.js — renders a document payload (from cc_invoice_document / cc_ratecon_document)
// into a clean printable window the user can save as PDF via the browser. No server PDF lib.
const money = (v) => '$' + (Number(v) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const row = (k, v) => `<tr><td class="k">${k}</td><td class="v">${v == null || v === '' ? '—' : v}</td></tr>`;

function shell(title, sub, bodyHtml) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
  <style>
    *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#10223B;margin:0;padding:40px;max-width:760px}
    .brand{font-size:24px;font-weight:800;letter-spacing:-.5px}.brand b{color:#4ea6f9}
    .head{display:flex;justify-content:space-between;align-items:center;background:linear-gradient(135deg,#0b1220,#10223B 55%,#12304f);color:#fff;padding:20px 24px;border-radius:14px;margin-bottom:20px}
    h1{font-size:18px;margin:18px 0 2px}.sub{color:#64748b;font-size:13px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse;margin:8px 0 18px}
    td{padding:9px 4px;border-bottom:1px solid #eef2f7;font-size:14px}.k{color:#64748b;width:38%}.v{font-weight:600}
    .total{font-size:22px;font-weight:800;color:#0b1220}.terms{color:#475569;font-size:12px;border-top:1px solid #eef2f7;padding-top:12px;margin-top:8px}
    .pill{display:inline-block;background:rgba(255,255,255,.16);color:#fff;border-radius:20px;padding:5px 13px;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}
    @media print{body{padding:0}.noprint{display:none}}
    .bar{margin:20px 0}.btn{background:#0883F7;color:#fff;border:none;border-radius:8px;padding:10px 16px;font-weight:700;cursor:pointer}
  </style></head><body>
    <div class="bar noprint"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>
    <div class="head"><img src="/logo-full-dark.png" alt="LoadBoot" style="height:28px;width:auto;display:block"><div style="text-align:right"><div class="pill">${sub}</div></div></div>
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

// Generic branded printable: sections = [{ h?, rows?: [[k,v]...], note? }]
export function openPrintable(title, sub, sections) {
  const secHtml = (sections || []).map(s => {
    let h = '';
    if (s && s.h) h += '<h1>' + s.h + '</h1>';
    if (s && Array.isArray(s.rows) && s.rows.length) {
      h += '<table>' + s.rows.map(r => row(Array.isArray(r) ? r[0] : (r && r.k), Array.isArray(r) ? r[1] : (r && r.v))).join('') + '</table>';
    }
    if (s && s.note) h += '<div class="terms">' + s.note + '</div>';
    return h;
  }).join('');
  const html = shell(title || 'Document', sub || 'DOCUMENT', secHtml);
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}


// PREMIUM INVOICE — bespoke branded layout: navy header, meta strip, line-items table,
// big total block, how-to-pay card with memo pill, diagonal PAID watermark when settled.
export function openInvoicePdf(inv) {
  const i = inv || {};
  const m = (v) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (v) => v ? new Date(v).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014';
  const paid = String(i.status || '') === 'paid';
  const due = String(i.status || '') === 'sent';
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Invoice ' + (i.invoice_no || '') + '</title><style>'
    + '@page{size:letter;margin:0}'
    + '*{box-sizing:border-box;margin:0;padding:0}'
    + 'body{font-family:Inter,Segoe UI,Arial,sans-serif;color:#10223B;-webkit-print-color-adjust:exact;print-color-adjust:exact;position:relative}'
    + '.page{max-width:820px;margin:0 auto;padding:0 0 40px}'
    + '.hd{background:linear-gradient(120deg,#10223B,#0d2f56);color:#fff;padding:34px 44px;display:flex;justify-content:space-between;align-items:flex-start}'
    + '.logo{font-size:26px;font-weight:900;letter-spacing:-.5px}.logo b{color:#FC5305}'
    + '.tag{font-size:11px;color:#9fb0cc;margin-top:4px;letter-spacing:.06em}'
    + '.inv-t{text-align:right}.inv-t .t{font-size:30px;font-weight:900;letter-spacing:.14em}'
    + '.inv-t .no{font-size:13px;color:#9fb0cc;margin-top:3px}'
    + '.ribbon{display:inline-block;margin-top:10px;padding:6px 16px;border-radius:999px;font-size:12px;font-weight:800;letter-spacing:.08em;'
    + 'background:' + (paid ? '#16a34a' : due ? '#f59e0b' : '#64748b') + ';color:#fff}'
    + '.meta{display:flex;gap:0;border-bottom:2px solid #eef2f7}'
    + '.meta div{flex:1;padding:16px 24px;border-right:1px solid #eef2f7}.meta div:last-child{border-right:0}'
    + '.meta .k{font-size:10px;letter-spacing:.1em;color:#64748b;font-weight:800;text-transform:uppercase}'
    + '.meta .v{font-size:14px;font-weight:800;margin-top:3px}'
    + '.cols{display:flex;gap:24px;padding:22px 44px 6px}'
    + '.col{flex:1}.col .k{font-size:10px;letter-spacing:.1em;color:#64748b;font-weight:800;text-transform:uppercase;margin-bottom:6px}'
    + '.col .n{font-weight:900;font-size:15px}.col .s{font-size:12px;color:#475569;line-height:1.7}'
    + 'table.items{width:calc(100% - 88px);margin:18px 44px;border-collapse:collapse}'
    + '.items th{background:#10223B;color:#fff;font-size:11px;letter-spacing:.08em;text-transform:uppercase;padding:10px 14px;text-align:left}'
    + '.items th:last-child,.items td:last-child{text-align:right}'
    + '.items td{padding:12px 14px;border-bottom:1px solid #eef2f7;font-size:13.5px}'
    + '.items .sub td{color:#64748b;font-size:12px}'
    + '.totals{display:flex;justify-content:flex-end;padding:0 44px}'
    + '.tot{min-width:300px;background:linear-gradient(120deg,#10223B,#0d2f56);color:#fff;border-radius:14px;padding:16px 22px}'
    + '.tot .k{font-size:10px;letter-spacing:.12em;color:#9fb0cc;font-weight:800}'
    + '.tot .v{font-size:28px;font-weight:900;margin-top:2px}'
    + '.tot .s{font-size:11px;color:#9fb0cc;margin-top:4px}'
    + '.pay{margin:22px 44px;background:#f8fafc;border:1.5px solid #e6ebf3;border-radius:14px;padding:16px 20px}'
    + '.pay .h{font-weight:900;font-size:13px;letter-spacing:.04em;margin-bottom:8px}'
    + '.pay .row{display:flex;gap:10px;font-size:12.5px;line-height:1.9}.pay .row .k{width:150px;color:#64748b;font-weight:700;flex:none}'
    + '.memo{display:inline-block;background:#FC5305;color:#fff;font-weight:900;border-radius:8px;padding:4px 14px;letter-spacing:.05em}'
    + '.steps{display:flex;gap:10px;margin-top:12px}'
    + '.step{flex:1;background:#fff;border:1px solid #e6ebf3;border-radius:10px;padding:10px 12px;font-size:11px;line-height:1.6}'
    + '.step b{display:block;font-size:12px;color:#0883F7}'
    + '.ft{margin:26px 44px 0;padding-top:14px;border-top:2px solid #eef2f7;font-size:10.5px;color:#64748b;line-height:1.8}'
    + '.wm{position:fixed;top:40%;left:50%;transform:translate(-50%,-50%) rotate(-24deg);font-size:120px;font-weight:900;color:rgba(22,163,74,.13);letter-spacing:.1em;pointer-events:none}'
    + '@media print{.noprint{display:none}}'
    + '.noprint{position:fixed;top:14px;right:14px;background:#0883F7;color:#fff;border:0;border-radius:10px;padding:10px 18px;font-weight:800;cursor:pointer}'
    + '</style></head><body>'
    + (paid ? '<div class="wm">PAID \u2713</div>' : '')
    + '<button class="noprint" onclick="print()">\ud83d\udda8 Print / Save PDF</button>'
    + '<div class="page">'
    + '<div class="hd"><div><div class="logo">Load<b>Boot</b></div><div class="tag">THE OPERATING SYSTEM FOR TRUCKING \u00b7 loadboot.com</div></div>'
    + '<div class="inv-t"><div class="t">INVOICE</div><div class="no">' + (i.invoice_no || '') + '</div>'
    + '<span class="ribbon">' + (paid ? 'PAID \u2713' : due ? 'DUE \u2014 NET 15' : String(i.status || '').toUpperCase()) + '</span></div></div>'
    + '<div class="meta">'
    + '<div><div class="k">Issued</div><div class="v">' + d(i.issued_at || i.created_at) + '</div></div>'
    + '<div><div class="k">Due</div><div class="v">' + d(i.due_at) + '</div></div>'
    + '<div><div class="k">Load</div><div class="v">' + (i.load_ref || (i.load_id ? String(i.load_id).slice(0, 8) : '\u2014')) + '</div></div>'
    + '<div><div class="k">Amount due</div><div class="v" style="color:' + (paid ? '#16a34a' : '#FC5305') + '">' + (paid ? 'PAID' : m(i.fee)) + '</div></div>'
    + '</div>'
    + '<div class="cols">'
    + '<div class="col"><div class="k">From</div><div class="n">LoadBoot LLC</div><div class="s">The Operating System for Trucking<br>billing@loadboot.com \u00b7 loadboot.com</div></div>'
    + '<div class="col"><div class="k">Bill to</div><div class="n">' + (i.__carrier || 'Carrier') + '</div><div class="s">' + (i.__email || '') + '</div></div>'
    + '</div>'
    + '<table class="items"><tr><th>Description</th><th>Amount</th></tr>'
    + '<tr class="sub"><td>Load gross \u2014 what the broker pays you' + (i.lane ? ' \u00b7 ' + i.lane : '') + '</td><td>' + m(i.gross) + '</td></tr>'
    + '<tr><td><b>Dispatch service \u2014 flat 5% of gross</b><br><span style="font-size:11px;color:#64748b">Load sourcing \u00b7 GPS trip verification \u00b7 rate confirmation & paperwork \u00b7 payment protection</span></td><td><b>' + m(i.fee) + '</b></td></tr>'
    + '<tr class="sub"><td>Your net after fee</td><td>' + m(Number(i.gross || 0) - Number(i.fee || 0)) + '</td></tr>'
    + '</table>'
    + '<div class="totals"><div class="tot"><div class="k">TOTAL DUE TO LOADBOOT</div><div class="v">' + m(i.fee) + '</div><div class="s">' + (paid ? 'Settled ' + d(i.paid_at) + ' \u2014 thank you' : 'Net 15 \u00b7 due ' + d(i.due_at)) + '</div></div></div>'
    + '<div class="pay"><div class="h">\ud83d\udcb3 HOW TO PAY</div>'
    + '<div class="row"><span class="k">Bank (ACH / wire)</span><span>LoadBoot LLC \u00b7 JPMorgan Chase \u00b7 Acct 7700123456 \u00b7 Routing 021000021</span></div>'
    + '<div class="row"><span class="k">International</span><span>Payoneer \u2014 request a link from billing@loadboot.com</span></div>'
    + '<div class="row"><span class="k">Transfer memo</span><span class="memo">' + (i.invoice_no || '') + '</span></div>'
    + '<div class="steps"><div class="step"><b>1 \u00b7 Transfer</b>ACH lands in 1\u20133 business days; wires same day</div>'
    + '<div class="step"><b>2 \u00b7 Receipt</b>Upload the receipt in Finance \u2192 \ud83d\udcb3 Pay now</div>'
    + '<div class="step"><b>3 \u00b7 PAID</b>LoadBoot verifies \u2014 usually same business day</div></div></div>'
    + '<div class="ft">LoadBoot\u2019s flat 5% dispatch fee is the only thing you ever pay \u2014 no contracts, no monthly charges. Factored carriers: this fee is payable from your own account; your factor only handles broker freight. Questions: billing@loadboot.com</div>'
    + '</div></body></html>';
  const w = window.open('', '_blank');
  if (w) { w.document.write(html); w.document.close(); }
}

// Branded dispatch-sheet printable built from a dispatch-sheet object.
export function printDispatchSheet(d) {
  d = d || {};
  const pk = d.pickup || {}, dl = d.delivery || {}, dr = d.driver || {}, det = d.detention || {};
  openPrintable('Dispatch Sheet', 'DISPATCH SHEET', [
    { h: 'Load ' + (d.load_ref || d.load_id || d.reference || ''), rows: [
      ['Rate', money(d.agreed_rate != null ? d.agreed_rate : (d.rate || 0))],
      ['Loaded miles', d.miles != null ? d.miles : '—'],
      ['RPM', d.loaded_rpm != null ? ('$' + d.loaded_rpm + '/mi') : '—'],
      ['Equipment', d.equipment || '—'],
      ['Commodity', d.commodity || '—'],
    ] },
    { h: 'Pickup', rows: [
      ['Location', pk.address || pk.city || '—'],
      ['Window', pk.window || pk.date || '—'],
      ['Number / ref', pk.number || pk.ref || '—'],
    ] },
    { h: 'Delivery', rows: [
      ['Location', dl.address || dl.city || '—'],
      ['Window', dl.window || dl.date || '—'],
      ['Number / ref', dl.number || dl.ref || '—'],
    ] },
    { h: 'Driver & equipment', rows: [
      ['Driver', dr.name || '—'],
      ['Phone', dr.phone || '—'],
      ['Truck #', d.truck_no || '—'],
      ['Trailer #', d.trailer_no || '—'],
    ] },
    { h: 'Terms', rows: [
      ['Detention', det.rate_per_hr != null ? ('$' + det.rate_per_hr + '/hr after ' + (det.free_hours || 0) + 'h') : '—'],
      ['Lumper', d.lumper_process || '—'],
      ['POD', d.pod_instructions || '—'],
    ] },
    { note: d.notes || d.instructions || 'Drive safe. Contact dispatch with any issues or delays.' },
  ]);
}

export default { printDocument, openPrintable, printDispatchSheet };
