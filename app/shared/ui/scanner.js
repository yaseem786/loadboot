// scanner.js — dependency-free "Scan to PDF": camera/gallery photos → one PDF.
// Builds a minimal, valid PDF where each page embeds a JPEG (DCTDecode) at full page size.
// No external libraries, works offline. Output: Blob (application/pdf).

const A4 = { w: 595.28, h: 841.89 }; // points

async function fileToJpeg(file, maxDim = 1800, quality = 0.85) {
  // Normalize any image input (HEIC won't decode in most browsers — we only accept what <img> can load)
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * scale), hgt = Math.round(img.naturalHeight * scale);
    const c = document.createElement('canvas'); c.width = w; c.height = hgt;
    c.getContext('2d').drawImage(img, 0, 0, w, hgt);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', quality));
    const buf = new Uint8Array(await blob.arrayBuffer());
    return { buf, w, h: hgt };
  } finally { URL.revokeObjectURL(url); }
}

function str(s) { return new TextEncoder().encode(s); }

export async function imagesToPdf(files) {
  const pages = [];
  for (const f of files) pages.push(await fileToJpeg(f));
  const chunks = []; const offsets = []; let pos = 0;
  const push = (bytes) => { chunks.push(bytes); pos += bytes.length; };
  const obj = (body) => { offsets.push(pos); push(str(body)); };

  push(str('%PDF-1.4\n%âãÏÓ\n'));
  const n = pages.length;
  // 1: catalog, 2: pages tree, then per page i: [3+i*3: page, 4+i*3: content, 5+i*3: image]
  obj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n');
  const kids = Array.from({ length: n }, (_, i) => (3 + i * 3) + ' 0 R').join(' ');
  obj('2 0 obj\n<< /Type /Pages /Kids [' + kids + '] /Count ' + n + ' >>\nendobj\n');
  pages.forEach((p, i) => {
    const pageN = 3 + i * 3, contN = 4 + i * 3, imgN = 5 + i * 3;
    // Fit image inside A4 with margins, keep aspect
    const m = 24, availW = A4.w - 2 * m, availH = A4.h - 2 * m;
    const s = Math.min(availW / p.w, availH / p.h);
    const dw = p.w * s, dh = p.h * s, dx = (A4.w - dw) / 2, dy = (A4.h - dh) / 2;
    const content = 'q\n' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + dx.toFixed(2) + ' ' + dy.toFixed(2) + ' cm\n/Im' + i + ' Do\nQ\n';
    obj(pageN + ' 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + A4.w + ' ' + A4.h + '] /Resources << /XObject << /Im' + i + ' ' + imgN + ' 0 R >> >> /Contents ' + contN + ' 0 R >>\nendobj\n');
    obj(contN + ' 0 obj\n<< /Length ' + content.length + ' >>\nstream\n' + content + 'endstream\nendobj\n');
    offsets.push(pos);
    push(str(imgN + ' 0 obj\n<< /Type /XObject /Subtype /Image /Width ' + p.w + ' /Height ' + p.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + p.buf.length + ' >>\nstream\n'));
    push(p.buf);
    push(str('\nendstream\nendobj\n'));
  });
  const xrefPos = pos;
  const total = 2 + n * 3;
  let xref = 'xref\n0 ' + (total + 1) + '\n0000000000 65535 f \n';
  offsets.forEach(o => { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
  push(str(xref));
  push(str('trailer\n<< /Size ' + (total + 1) + ' /Root 1 0 R >>\nstartxref\n' + xrefPos + '\n%%EOF\n'));

  const out = new Uint8Array(pos); let off = 0;
  chunks.forEach(c => { out.set(c, off); off += c.length; });
  return new Blob([out], { type: 'application/pdf' });
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}
