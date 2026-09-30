// agreementCopy.js — bl_ship_0508. The executed copy of a signed shipper agreement, shared by the partner portal
// (the shipper's own copy) and Command Center (Shipper 360 → Signatures).
// LoadBoot LLC is shown pre-signed and dated the day the shipper signed; the shipper's e-signature and the ESIGN record
// (consent text, SHA-256 of the exact text signed, IP, UTC time) follow. The page offers Print / Save as PDF and a
// self-contained .html download. The agreement text goes through mdToNodes (text nodes only), and every other value
// is escaped, so nothing in the record can inject markup.
import { mdToNodes } from './mdLite.js';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const day = (ts) => { try { return new Date(ts).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }); } catch (_) { return String(ts || '').slice(0, 10); } };
const utc = (ts) => { try { return new Date(ts).toISOString().replace('T', ' ').slice(0, 19) + ' UTC'; } catch (_) { return String(ts || ''); } };

const LOGO = '<svg width="30" height="32" viewBox="16 14 68 72"><path d="M16 14 H34 V68 H84 V86 H16 Z" fill="#10223B"/><path d="M34 14 H58 Q76 14 76 24 Q76 34 58 34 H34 Z" fill="#FC5305"/><path d="M34 40 H64 Q84 40 84 51 Q84 62 64 62 H34 Z" fill="#10223B"/></svg>';

function pageHtml(d) {
  const box = document.createElement('div'); box.appendChild(mdToNodes(d.body_md || ''));
  const lb = d.loadboot || {};
  const party = esc(d.legal_name || d.company || 'the Shipper');
  return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + esc(d.title) + ' — Executed copy</title><style>'
    + '*{box-sizing:border-box}body{font-family:Inter,system-ui,Arial,sans-serif;color:#0f1e36;margin:0 auto;max-width:860px;padding:30px 34px;background:#fff}'
    + '.bar{position:sticky;top:0;display:flex;gap:8px;justify-content:flex-end;padding:8px 0 12px;background:#fff}'
    + '.bar button{font:inherit;font-weight:700;font-size:.82rem;border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid #cbd5e1;background:#fff;color:#0f1e36}'
    + '.bar button.p{background:#FC5305;border-color:#FC5305;color:#fff}'
    + '.lh{display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #FC5305;padding-bottom:14px;gap:12px}'
    + '.lh .wd{font-weight:800;font-size:1.15rem}.lh .wd span{color:#FC5305}.meta{text-align:right;font-size:.7rem;color:#51617a;line-height:1.7}'
    + 'h1{text-align:center;font-size:1.28rem;margin:22px 0 2px}.ref{text-align:center;font-size:.72rem;color:#51617a;letter-spacing:.14em;text-transform:uppercase;margin-bottom:14px}'
    + '.parties{font-size:.84rem;line-height:1.6;background:#f6f8fb;border:1px solid #e6ecf4;border-radius:10px;padding:12px 16px;margin-bottom:16px}'
    + '.body{font-size:.84rem;line-height:1.62;color:#2b3b52}.body h1,.body h2,.body h3{color:#0f1e36;font-size:.95rem;margin:16px 0 6px;text-align:left}.body p{margin:0 0 8px}.body li{margin:0 0 4px}'
    + '.sigrow{display:flex;justify-content:space-between;gap:36px;margin-top:30px;page-break-inside:avoid;flex-wrap:wrap}.sig{flex:1;min-width:240px}'
    + '.sig .lab{font-size:.6rem;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em}'
    + '.sig .line{border-bottom:1.5px solid #0f1e36;min-height:34px;font-family:"Brush Script MT","Segoe Script",cursive;font-size:1.45rem;color:#0b1b33;padding:2px 0;display:flex;align-items:flex-end}'
    + '.sig .sub{font-size:.72rem;color:#51617a;margin-top:4px;line-height:1.55}'
    + '.rec{margin-top:22px;border:1px solid #e6ecf4;border-radius:10px;padding:12px 14px;font-size:.72rem;color:#2b3b52;line-height:1.6;page-break-inside:avoid}'
    + '.rec b{color:#0f1e36}.rec code{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:.68rem;word-break:break-all}'
    + '.stamp{margin-top:18px;display:flex;justify-content:space-between;align-items:center;gap:10px;background:#e7f9ee;border:1.5px solid #16a34a;border-radius:10px;padding:10px 14px}'
    + '.stamp.bad{background:#fef2f2;border-color:#dc2626}.stamp b{color:#12a150;font-size:.8rem}.stamp.bad b{color:#b91c1c}.stamp span{font-size:.68rem;color:#51617a}'
    + '@media print{.bar{display:none}body{padding:14px 18px}}'
    + '</style></head><body>'
    + '<div class="bar" id="lb-bar"><button id="lb-dl">Download copy</button><button class="p" id="lb-pr">Print / Save as PDF</button></div>'
    + '<div class="lh"><div style="display:flex;align-items:center;gap:10px">' + LOGO + '<div class="wd">Load<span>Boot</span></div></div>'
    + '<div class="meta">LoadBoot LLC<br>hello@loadboot.com · loadboot.com<br>Ref ' + esc(d.ref) + '</div></div>'
    + '<h1>' + esc(d.title) + '</h1><div class="ref">Version ' + esc(d.version) + ' · Executed electronically</div>'
    + '<div class="parties">Between <b>' + esc(lb.entity || 'LoadBoot LLC') + '</b>' + (lb.state ? ', ' + esc(lb.state) : '') + ', and <b>' + party + '</b>'
    + (d.legal_name && d.company && d.legal_name !== d.company ? ' (account name: ' + esc(d.company) + ')' : '') + '.</div>'
    + '<div class="body">' + box.innerHTML + '</div>'
    + '<div class="sigrow">'
    + '<div class="sig"><div class="lab">Shipper — signed electronically</div><div class="line">' + esc(d.signer_name) + '</div>'
    + '<div class="sub">' + esc(d.signer_name) + ', ' + esc(d.signer_title) + '<br>for ' + party + '<br>Signed ' + esc(day(d.signed_at)) + '</div></div>'
    + '<div class="sig"><div class="lab">LoadBoot — pre-signed</div><div class="line" style="color:#0e7490">LoadBoot LLC</div>'
    + '<div class="sub">By: ' + esc(lb.by || 'Authorized Signatory') + ', LoadBoot LLC<br>Dated ' + esc(day(lb.dated || d.signed_at)) + '</div></div>'
    + '</div>'
    + '<div class="rec"><b>Electronic signature record (ESIGN Act, 15 U.S.C. 7001)</b><br>'
    + 'Signed at: ' + esc(utc(d.signed_at)) + (d.ip ? ' · IP ' + esc(d.ip) : '') + '<br>'
    + 'Consent: ' + esc(d.consent_text) + '<br>'
    + 'SHA-256 of the text signed: <code>' + esc(d.body_sha256) + '</code></div>'
    + (d.text_matches
      ? '<div class="stamp"><b>✓ EXECUTED — TEXT VERIFIED</b><span>The text above is byte-for-byte the text that was signed (SHA-256 matches). Recorded by the LoadBoot platform with an audit entry.</span></div>'
      : '<div class="stamp bad"><b>⚠ TEXT DOES NOT MATCH THE SIGNED HASH</b><span>The stored agreement text for this version no longer matches the SHA-256 recorded at signing. Contact hello@loadboot.com.</span></div>')
    + '</body></html>';
}

// Open the executed copy. `fetcher` returns the cc_shipper_agreement_copy payload. The window is opened before the
// fetch so the click still counts as a user gesture (popup blockers). Returns false when the browser blocked it.
export async function openAgreementCopy(fetcher, fileBase) {
  const w = window.open('', '_blank');
  if (!w) return false;
  w.document.write('<!doctype html><title>Loading…</title><body style="font-family:system-ui;padding:30px;color:#51617a">Loading the signed copy…</body>');
  let d;
  try { d = await fetcher(); } catch (e) { w.document.body.textContent = (e && e.message) || 'Could not load the signed copy.'; return true; }
  if (!d || !d.signed) { w.document.body.textContent = 'This agreement has not been signed yet.'; return true; }
  const html = pageHtml(d);
  w.document.open(); w.document.write(html); w.document.close();
  const name = (fileBase || ('LoadBoot-' + d.kind + '-v' + d.version + '-signed')).replace(/[^A-Za-z0-9._-]+/g, '-') + '.html';
  const pr = w.document.getElementById('lb-pr'); if (pr) pr.onclick = () => w.print();
  const dl = w.document.getElementById('lb-dl');
  if (dl) dl.onclick = () => {
    const blob = new Blob([html.replace(/<div class="bar" id="lb-bar">[\s\S]*?<\/div>/, '')], { type: 'text/html' });
    const a = w.document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    w.document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };
  return true;
}
