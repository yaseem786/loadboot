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

// Open a branded printable wi