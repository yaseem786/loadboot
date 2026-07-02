// exporters.js — client-side CSV / Excel / PDF exports for Command Center tables.
// No server libraries: CSV and Excel are built as Blobs and downloaded; PDF reuses a
// clean print window (browser "Save as PDF"). Columns are [{key,label,fmt?}]; rows are
// plain objects. Everything is escaped, so untrusted cell values can never break out.

function esc(v) { return v == null ? '' : String(v); }
function cell(col, row) {
  const raw = row[col.key];
  return col.fmt ? col.fmt(raw, row) : esc(raw);
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

// ---- CSV (opens in Excel, Google Sheets, Numbers) ----
export function downloadCSV(filename, columns, rows) {
  const q = (s) => '"' + esc(s).replace(/"/g, '""') + '"';
  const head = columns.map(c => q(c.label)).join(',');
  const body = (rows || []).map(r => columns.map(c => q(cell(c, r))).join(',')).join('\r\n');
  const csv = '﻿' + head + '\r\n' + body; // BOM so Excel reads UTF-8
  triggerDownload(new Blob([csv], { type: 'text/csv;charset=utf-8;' }), ensureExt(filename, 'csv'));
}

// ---- Excel (.xls) — Excel-native HTML-table workbook, opens directly in Excel ----
export function downloadExcel(filename, columns, rows, sheetName) {
  const th = columns.map(c => '<th style="background:#0b1220;color:#fff;text-align:left;padding:6px 8px">' + escHtml(c.label) + '</th>').join('');
  const trs = (rows || []).map(r =>
    '<tr>' + columns.map(c => '<td style="border:1px solid #dfe5ee;padding:5px 8px">' + escHtml(cell(c, r)) + '</td>').join('') + '</tr>'
  ).join('');
  const html = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
    '<head><meta charset="utf-8"><!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>' +
    '<x:Name>' + escHtml(sheetName || 'Sheet1') + '</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>' +
    '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>' +
    '<body><table border="1"><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></body></html>';
  triggerDownload(new Blob([html], { type: 'application/vnd.ms-excel' }), ensureExt(filename, 'xls'));
}

// ---- PDF — clean print window, user saves as PDF ----
export function printTable(title, subtitle, columns, rows) {
  const th = columns.map(c => '<th>' + escHtml(c.label) + '</th>').join('');
  const trs = (rows || []).map(r =>
    '<tr>' + columns.map(c => '<td>' + escHtml(cell(c, r)) + '</td>').join('') + '</tr>'
  ).join('');
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>' + escHtml(title) + '</title><style>' +
    '*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#10223B;margin:0;padding:34px}' +
    '.brand{font-size:20px;font-weight:800}.brand b{color:#FC5305}' +
    '.head{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #0b1220;padding-bottom:12px}' +
    'h1{font-size:17px;margin:16px 0 2px}.sub{color:#64748b;font-size:12px;margin-bottom:14px}' +
    'table{width:100%;border-collapse:collapse;margin-top:8px}th{background:#0b1220;color:#fff;text-align:left;padding:7px 8px;font-size:12px}' +
    'td{padding:6px 8px;border-bottom:1px solid #eef2f7;font-size:12px}tr:nth-child(even) td{background:#f8fafc}' +
    '.bar{margin-bottom:16px}.btn{background:#0883F7;color:#fff;border:none;border-radius:8px;padding:9px 15px;font-weight:700;cursor:pointer}' +
    '@media print{body{padding:0}.noprint{display:none}}</style></head><body>' +
    '<div class="bar noprint"><button class="btn" onclick="window.print()">Print / Save as PDF</button></div>' +
    '<div class="head"><div class="brand">Load<b>boot</b></div><div class="sub" style="text-align:right">' + escHtml(subtitle || '') + '</div></div>' +
    '<h1>' + escHtml(title) + '</h1><div class="sub">' + (rows || []).length + ' rows · generated ' + new Date().toLocaleString() + '</div>' +
    '<table><thead><tr>' + th + '</tr></thead><tbody>' + trs + '</tbody></table></body></html>';
  const w = window.open('', '_blank');
  if (!w) { alert('Please allow pop-ups to export as PDF.'); return; }
  w.document.open(); w.document.write(html); w.document.close();
}

function escHtml(s) { return esc(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m])); }
function ensureExt(name, ext) { return name.toLowerCase().endsWith('.' + ext) ? name : name + '.' + ext; }

// ---- export button group: CSV · Excel · PDF ----
export function exportBar(getRows, columns, baseName, title) {
  // imported lazily by views; returns a DOM node with three buttons.
  const { el } = window.__lbDom || {};
  const mk = (label, fn) => {
    const b = document.createElement('button');
    b.className = 'cc-seg-btn'; b.textContent = label;
    b.addEventListener('click', () => { const rows = getRows() || []; fn(rows); });
    return b;
  };
  const wrap = document.createElement('div');
  wrap.className = 'cc-seg';
  wrap.appendChild(mk('CSV', rows => downloadCSV(baseName, columns, rows)));
  wrap.appendChild(mk('Excel', rows => downloadExcel(baseName, columns, rows, title)));
  wrap.appendChild(mk('PDF', rows => printTable(title || baseName, 'LoadBoot export', columns, rows)));
  return wrap;
}

export default { downloadCSV, downloadExcel, printTable, exportBar };
