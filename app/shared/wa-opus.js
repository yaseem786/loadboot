// bl_wa_0378 — a voice note that WhatsApp will actually accept.
//
// WhatsApp takes audio/ogg (Opus only), audio/aac, audio/mp4, audio/mpeg and audio/amr. It does NOT take
// audio/webm. Chrome's MediaRecorder records webm/opus and nothing else — `MediaRecorder.isTypeSupported
// ('audio/ogg;codecs=opus')` is false there — so every voice note recorded in Chrome would have been refused
// by Meta with no way for the dispatcher to know why. Firefox records ogg/opus and was never affected.
//
// The audio inside both containers is the SAME Opus stream, so this is a container rewrite, not a re-encode:
// the Opus packets are lifted out of the WebM blocks and written into Ogg pages. Nothing is decoded, nothing
// is resampled, and it takes a few milliseconds for a voice note.
//
// Everything here fails by returning null. The caller then sends the original blob, which is exactly what it
// did before this file existed — a bug in this remuxer can only cost the improvement, never the feature.

const OGG_SERIAL_MASK = 0x7fffffff;

// ---------------------------------------------------------------- Ogg CRC (poly 0x04c11db7, no reflection)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) r = (r & 0x80000000) ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    t[i] = r >>> 0;
  }
  return t;
})();
function oggCrc(buf) {
  let c = 0;
  for (let i = 0; i < buf.length; i++) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) ^ buf[i]) & 0xff]) >>> 0;
  return c >>> 0;
}

// ---------------------------------------------------------------- EBML / WebM reader
function vintLen(b) { for (let i = 0; i < 8; i++) if (b & (0x80 >> i)) return i + 1; return 0; }

function readId(u8, pos) {                       // element ids keep their length marker
  const len = vintLen(u8[pos]);
  if (!len || pos + len > u8.length) return null;
  let id = 0;
  for (let i = 0; i < len; i++) id = (id * 256) + u8[pos + i];
  return { id, next: pos + len };
}
function readSize(u8, pos) {                     // sizes drop it; all-ones means "unknown length"
  const len = vintLen(u8[pos]);
  if (!len || pos + len > u8.length) return null;
  let v = u8[pos] & (0xff >> len), unknown = v === (0xff >> len);
  for (let i = 1; i < len; i++) { v = (v * 256) + u8[pos + i]; if (u8[pos + i] !== 0xff) unknown = false; }
  return { size: unknown ? -1 : v, next: pos + len };
}

// how many 48 kHz samples one Opus packet carries (RFC 6716 §3.1)
function opusSamples(pkt) {
  if (!pkt.length) return 0;
  const toc = pkt[0], cfg = toc >> 3, c = toc & 3;
  const ms = cfg < 12 ? [10, 20, 40, 60][cfg & 3]
            : cfg < 16 ? [10, 20][cfg & 1]
            : [2.5, 5, 10, 20][cfg & 3];
  const frames = c === 0 ? 1 : c < 3 ? 2 : (pkt.length > 1 ? (pkt[1] & 0x3f) : 1);
  return Math.round(ms * 48 * frames);
}

// Walk the WebM and collect (a) the Opus track's CodecPrivate, (b) its packets, in order.
function readWebmOpus(u8) {
  let track = null, codecPrivate = null, channels = 2;
  const packets = [];

  function walk(start, end, depth) {
    let pos = start;
    while (pos < end) {
      const idr = readId(u8, pos); if (!idr) return;
      const szr = readSize(u8, idr.next); if (!szr) return;
      let body = szr.next, size = szr.size;
      if (size < 0) size = end - body;                       // unknown-length (live MediaRecorder streams)
      const stop = Math.min(body + size, end);
      switch (idr.id) {
        case 0x18538067:                                      // Segment
        case 0x1654ae6b:                                      // Tracks
        case 0xae:                                            // TrackEntry
        case 0x1f43b675:                                      // Cluster
        case 0xa0:                                            // BlockGroup
        case 0xe1:                                            // Audio
          walk(body, stop, depth + 1); break;
        case 0xd7:                                            // TrackNumber
          if (track === null) { let v = 0; for (let i = body; i < stop; i++) v = v * 256 + u8[i]; track = v; } break;
        case 0x86: {                                          // CodecID
          let s = ''; for (let i = body; i < stop; i++) s += String.fromCharCode(u8[i]);
          if (s.indexOf('OPUS') < 0) return;                  // not an Opus file — leave it alone
          break;
        }
        case 0x9f: { let v = 0; for (let i = body; i < stop; i++) v = v * 256 + u8[i]; if (v) channels = v; break; }  // Channels
        case 0x63a2:                                          // CodecPrivate (OpusHead)
          if (!codecPrivate) codecPrivate = u8.slice(body, stop); break;
        case 0xa3:                                            // SimpleBlock
        case 0xa1: {                                          // Block
          const tv = readSize(u8, body); if (!tv) break;
          let p = tv.next + 2;                                // skip the 16-bit timecode
          const flags = u8[p]; p += 1;
          if ((flags & 0x06) !== 0) throw new Error('lacing');  // MediaRecorder does not lace audio; bail if it ever does
          if (track === null || tv.size === track) packets.push(u8.slice(p, stop));
          break;
        }
        default: break;
      }
      pos = stop;
      if (pos <= body && size === 0) pos = body;              // zero-size element
      if (pos <= idr.next) return;                            // never go backwards
    }
  }
  walk(0, u8.length, 0);
  return packets.length ? { packets, codecPrivate, channels } : null;
}

// ---------------------------------------------------------------- Ogg writer
function oggPages(packets, head, tags) {
  const out = [];
  const serial = (Math.floor(Math.random() * 0x7fffffff) & OGG_SERIAL_MASK) || 1;
  let seq = 0;

  function page(payloads, granule, type) {
    let segs = [];
    for (const p of payloads) {
      let n = p.length;
      while (n >= 255) { segs.push(255); n -= 255; }
      segs.push(n);
    }
    const dataLen = payloads.reduce((a, p) => a + p.length, 0);
    const buf = new Uint8Array(27 + segs.length + dataLen);
    const dv = new DataView(buf.buffer);
    buf[0] = 0x4f; buf[1] = 0x67; buf[2] = 0x67; buf[3] = 0x53;        // "OggS"
    buf[4] = 0; buf[5] = type;
    // granule is a 64-bit little-endian value; a voice note never reaches 2^32 samples (24 hours), so the
    // high word is written as zero rather than pretending to handle more.
    dv.setUint32(6, granule >>> 0, true); dv.setUint32(10, Math.floor(granule / 4294967296), true);
    dv.setUint32(14, serial, true);
    dv.setUint32(18, seq++, true);
    dv.setUint32(22, 0, true);                                          // checksum, filled in below
    buf[26] = segs.length;
    buf.set(segs, 27);
    let o = 27 + segs.length;
    for (const p of payloads) { buf.set(p, o); o += p.length; }
    dv.setUint32(22, oggCrc(buf), true);
    out.push(buf);
  }

  page([head], 0, 0x02);                                                // BOS
  page([tags], 0, 0x00);

  let batch = [], segCount = 0, granule = 0;
  for (let i = 0; i < packets.length; i++) {
    const p = packets[i];
    const need = Math.floor(p.length / 255) + 1;
    if (segCount + need > 255) { page(batch, granule, 0x00); batch = []; segCount = 0; }
    batch.push(p); segCount += need; granule += opusSamples(p);
    if (i === packets.length - 1) page(batch, granule, 0x04);           // EOS
  }
  const total = out.reduce((a, b) => a + b.length, 0);
  const all = new Uint8Array(total);
  let o = 0; for (const b of out) { all.set(b, o); o += b.length; }
  return all;
}

function opusHead(codecPrivate, channels) {
  if (codecPrivate && codecPrivate.length >= 19 &&
      codecPrivate[0] === 0x4f && codecPrivate[1] === 0x70 && codecPrivate[2] === 0x75 && codecPrivate[3] === 0x73) {
    return codecPrivate;                                                // Chrome hands us a real OpusHead
  }
  const h = new Uint8Array(19);
  h.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0);           // "OpusHead"
  h[8] = 1; h[9] = channels || 1;
  new DataView(h.buffer).setUint16(10, 3840, true);                     // pre-skip
  new DataView(h.buffer).setUint32(12, 48000, true);                    // input sample rate
  new DataView(h.buffer).setUint16(16, 0, true);                        // output gain
  h[18] = 0;                                                            // mapping family
  return h;
}
function opusTags() {
  const vendor = 'LoadBoot';
  const t = new Uint8Array(8 + 4 + vendor.length + 4);
  t.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0);           // "OpusTags"
  const dv = new DataView(t.buffer);
  dv.setUint32(8, vendor.length, true);
  for (let i = 0; i < vendor.length; i++) t[12 + i] = vendor.charCodeAt(i);
  dv.setUint32(12 + vendor.length, 0, true);                            // no comments
  return t;
}

// ---------------------------------------------------------------- the only export
// Takes the bytes of a WebM/Opus recording, returns Ogg/Opus bytes, or null if it is not that (or anything
// at all goes wrong) — in which case the caller sends what it already had.
export function webmOpusToOgg(bytes) {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 64 || u8[0] !== 0x1a || u8[1] !== 0x45 || u8[2] !== 0xdf || u8[3] !== 0xa3) return null;  // not EBML
    const r = readWebmOpus(u8);
    if (!r) return null;
    return oggPages(r.packets, opusHead(r.codecPrivate, r.channels), opusTags());
  } catch (_) { return null; }
}

// Chrome cannot record ogg/opus, so a voice note has to be converted after the fact. Returns a File that
// WhatsApp accepts, or the original one when there is nothing to do (Firefox, Safari) or the remux failed.
export async function waVoiceFile(blob, name) {
  const type = (blob.type || '').toLowerCase();
  if (type.indexOf('webm') < 0) return new File([blob], name || 'voice-note', { type: (type || 'audio/ogg').split(';')[0] });
  const ogg = webmOpusToOgg(new Uint8Array(await blob.arrayBuffer()));
  if (!ogg) return new File([blob], name || 'voice-note.webm', { type: 'audio/webm' });
  return new File([ogg], (name || 'voice-note').replace(/\.[a-z0-9]+$/i, '') + '.ogg', { type: 'audio/ogg' });
}
