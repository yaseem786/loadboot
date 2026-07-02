# -*- coding: utf-8 -*-
# SECTION-MOTIF LIBRARY (B3) — visually DISTINCT section motifs so no two sections on a
# page look alike (owner directive: kill the repeated 3-card grid). Each motif has its own
# layout, its own icon-chip shape and its own accent treatment. All original inline-SVG icons.
CHK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'

_MI = {
 'compass':'<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13 13 8.5 15.5 11 11 15.5 8.5"/>',
 'radar':'<path d="M12 12 20 5.5"/><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2"/>',
 'gauge':'<path d="M4 18a9 9 0 1 1 16 0"/><path d="M12 13 16 9"/><circle cx="12" cy="14" r="1.6"/>',
 'layers':'<polygon points="12 3 21 8 12 13 3 8"/><polyline points="3 12.5 12 17.5 21 12.5"/>',
 'route':'<circle cx="6" cy="19" r="2.4"/><circle cx="18" cy="5" r="2.4"/><path d="M8 17.5c5-2 3-9 8-11"/>',
 'calcheck':'<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><polyline points="8.5 15 11 17.5 15.5 13"/>',
 'doccheck':'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/><polyline points="8.5 14 11 16.5 15.5 11.5"/>',
 'siren':'<path d="M7 18v-5a5 5 0 0 1 10 0v5"/><rect x="5" y="18" width="14" height="3" rx="1"/><line x1="12" y1="3" x2="12" y2="5.5"/><line x1="4.5" y1="6" x2="6.5" y2="8"/><line x1="19.5" y1="6" x2="17.5" y2="8"/>',
 'wallet':'<path d="M3 7a2 2 0 0 1 2-2h13v4"/><path d="M3 7v10a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2z"/><circle cx="16.5" cy="14" r="1.3"/>',
 'network':'<circle cx="12" cy="5" r="2.4"/><circle cx="5" cy="18" r="2.4"/><circle cx="19" cy="18" r="2.4"/><path d="M10.8 7 6.3 16M13.2 7l4.5 9M7.4 18h9.2"/>',
 'target':'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4"/>',
 'key':'<circle cx="8" cy="15" r="4"/><path d="M11 12 20 3M16 7l3 3M13 10l2.5 2.5"/>',
 'receipt':'<path d="M6 2h12v19l-2.5-1.8L13 21l-2.5-1.8L8 21l-2-1.8z"/><line x1="9" y1="7" x2="15" y2="7"/><line x1="9" y1="11" x2="15" y2="11"/>',
 'headset':'<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.6"/><rect x="17" y="14" width="4" height="6" rx="1.6"/><path d="M19 20a4 4 0 0 1-4 2h-2"/>',
 'pin':'<path d="M12 21s-7-6.1-7-11a7 7 0 0 1 14 0c0 4.9-7 11-7 11z"/><circle cx="12" cy="10" r="2.6"/>',
 'link':'<path d="M10 14a5 5 0 0 0 7 0l2-2a5 5 0 0 0-7-7l-1 1"/><path d="M14 10a5 5 0 0 0-7 0l-2 2a5 5 0 0 0 7 7l1-1"/>',
 'scale':'<path d="M12 3v18M6 21h12M5 7h14M5 7 2 13h6zM19 7l-3 6h6z"/>',
 'badge':'<circle cx="12" cy="9" r="5.5"/><polyline points="8.5 13.5 7 21 12 18.5 17 21 15.5 13.5"/>',
 'timer':'<circle cx="12" cy="13" r="8"/><line x1="12" y1="13" x2="15" y2="10"/><line x1="9" y1="2.5" x2="15" y2="2.5"/>',
 'gift':'<rect x="3" y="9" width="18" height="4" rx="1"/><rect x="5" y="13" width="14" height="8"/><line x1="12" y1="9" x2="12" y2="21"/><path d="M12 9C10 5 5 4 5.5 7S12 9 12 9zM12 9c2-4 7-5 6.5-2S12 9 12 9z"/>',
 'megaphone':'<path d="M3 10v3l3 .5V20h3v-6l12 4V3L6 7z"/>',
 'trophy':'<path d="M8 4h8v6a4 4 0 0 1-8 0z"/><path d="M8 5H4.5a3.5 3.5 0 0 0 3.6 4M16 5h3.5a3.5 3.5 0 0 1-3.6 4"/><line x1="12" y1="14" x2="12" y2="17"/><path d="M8 21h8l-1-4h-6z"/>',
 'shieldcheck':'<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/><polyline points="8.5 12 11 14.5 15.5 9.5"/>',
 'sparkline':'<polyline points="3 17 8 11 12 14 17 7 21 9"/><circle cx="17" cy="7" r="1.4"/>',
 'handshake':'<path d="M4 11 8 7l4 1 4-3 4 4-3 3"/><path d="M4 11l4 4 2-1 2 2 2-1 2 2 3-3"/>',
 'bolt':'<polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/>',
 'book':'<path d="M4 5a2 2 0 0 1 2-2h14v18H6a2 2 0 0 0-2 2z"/><line x1="8" y1="7" x2="16" y2="7"/><line x1="8" y1="11" x2="13" y2="11"/>',
 'calc':'<rect x="5" y="2" width="14" height="20" rx="2"/><rect x="8" y="5" width="8" height="4"/><line x1="8.5" y1="13" x2="8.5" y2="13.01"/><line x1="12" y1="13" x2="12" y2="13.01"/><line x1="15.5" y1="13" x2="15.5" y2="13.01"/><line x1="8.5" y1="17" x2="8.5" y2="17.01"/><line x1="12" y1="17" x2="12" y2="17.01"/><line x1="15.5" y1="17" x2="15.5" y2="17.01"/>',
 'question':'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3 1-1.3 1.9v.5"/><line x1="12" y1="17" x2="12" y2="17.01"/>',
 'tag':'<path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z"/><circle cx="7.5" cy="7.5" r="1.4"/>',
 'truck':'<path d="M2 6h12v9H2z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
 'users':'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6.5 6.5 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M22 20a6.5 6.5 0 0 0-4.5-6.2"/>',
 'clipboard':'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><polyline points="9 12 11 14 15 10"/>',
 'phone':'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
}
def mi(name, size=22):
    return ('<svg width="%d" height="%d" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" '
            'stroke-linecap="round" stroke-linejoin="round">%s</svg>') % (size, size, _MI.get(name, _MI['compass']))

def _mhead(eyebrow, h2, lead='', color=None, accent=None):
    ey = '<div class="eyebrow"%s>%s</div>' % ((' style="color:%s"' % accent) if accent else '', eyebrow)
    ld = ('<p class="lead center" style="max-width:660px;margin:12px auto 0%s">%s</p>' % ((';color:#94a3b8' if color=='light' else ''), lead)) if lead else ''
    return '<div class="sec-head center reveal"%s>%s<h2%s>%s</h2>%s</div>' % (
        (' style="color:#fff"' if color=='light' else ''), ey, (' style="color:#fff"' if color=='light' else ''), h2, ld)

def m_rail(eyebrow, h2, lead, steps, accent='#0d9488'):
    """Numbered process rail: floating number badge + stroke icon per card. steps=(icon,title,desc)"""
    cards = ''.join(
      ('<div style="flex:1 1 200px;max-width:250px;position:relative;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:28px 20px 22px;box-shadow:0 10px 30px -18px %s80">'
       '<div style="position:absolute;top:-18px;left:22px;width:38px;height:38px;border-radius:50%%;background:linear-gradient(135deg,%s,%s);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.05rem;box-shadow:0 8px 18px -6px %sb0">%d</div>'
       '<div style="color:%s;margin:4px 0 8px">%s</div><h3 style="margin:0 0 6px;font-size:1.05rem">%s</h3><p style="margin:0;color:#64748b;font-size:.94rem">%s</p></div>')
      % (accent, accent, accent, accent, i + 1, accent, mi(ic, 26), t, d)
      for i, (ic, t, d) in enumerate(steps))
    return ('<section><div class="wrap">' + _mhead(eyebrow, h2, lead, accent=accent) +
            '<div class="reveal" style="display:flex;flex-wrap:wrap;gap:18px;justify-content:center;margin-top:34px">%s</div></div></section>' % cards)

def m_timeline(eyebrow, h2, items, accent='#7c3aed', soft=False, lead=''):
    """Vertical timeline: connector line + circular icon nodes. items=(icon,title,desc)"""
    rows = ''.join(
      ('<div style="display:flex;gap:20px;position:relative;padding-bottom:%s">' % ('30px' if i < len(items) - 1 else '0')) +
      (('<div style="position:absolute;left:23px;top:48px;bottom:0;width:2px;background:linear-gradient(%s,transparent 92%%)"></div>' % accent) if i < len(items) - 1 else '') +
      ('<div style="flex:none;width:48px;height:48px;border-radius:50%%;background:#fff;border:2px solid %s;color:%s;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 20px -10px %s90;position:relative;z-index:1">%s</div>'
       % (accent, accent, accent, mi(ic, 22))) +
      ('<div style="padding-top:6px"><h3 style="margin:0 0 4px;font-size:1.08rem">%s</h3><p style="margin:0;color:#64748b;font-size:.96rem;max-width:560px">%s</p></div></div>' % (t, d))
      for i, (ic, t, d) in enumerate(items))
    return ('<section%s><div class="wrap">' % (' class="bg-soft"' if soft else '') + _mhead(eyebrow, h2, lead, accent=accent) +
            '<div class="reveal" style="max-width:680px;margin:30px auto 0">%s</div></div></section>' % rows)

def m_split(eyebrow, h2, paras, visual, flip=False, soft=False, accent='#0883F7', bullets=None):
    """Two-column split: prose one side, a visual panel the other. paras=list[str], visual=HTML."""
    txt = ''.join('<p style="margin:0 0 14px;color:#475569;font-size:1.02rem">%s</p>' % p for p in paras)
    bl = ''
    if bullets:
        bl = '<div style="display:flex;flex-direction:column;gap:10px;margin-top:6px">' + ''.join(
          '<div style="display:flex;gap:10px;align-items:flex-start"><span style="flex:none;color:%s;margin-top:2px">%s</span><span style="color:#334155;font-size:.97rem">%s</span></div>' % (accent, CHK, b)
          for b in bullets) + '</div>'
    left = '<div class="reveal"><div class="eyebrow" style="color:%s">%s</div><h2 style="margin-bottom:16px">%s</h2>%s%s</div>' % (accent, eyebrow, h2, txt, bl)
    right = '<div class="reveal d1">%s</div>' % visual
    cols = (right + left) if flip else (left + right)
    return ('<section%s><div class="wrap"><div class="route-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:52px;align-items:center">%s</div></div></section>'
            % (' class="bg-soft"' if soft else '', cols))

def m_dark(eyebrow, h2, lead, rows, accent='#60a5fa', numbered=True, cta=''):
    """Dark premium panel with numbered / icon rows (distinct from every light motif)."""
    items = ''.join(
      ('<div style="display:flex;align-items:flex-start;gap:16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:18px 20px">'
       '<div style="flex:none;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,%s,#1e40af);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">%s</div>'
       '<div><h3 style="margin:0 0 4px;color:#fff;font-size:1.05rem">%s</h3><p style="margin:0;color:#94a3b8;font-size:.95rem">%s</p></div></div>')
      % (accent, (str(i + 1) if numbered else mi(ic, 18)), t, d)
      for i, (ic, t, d) in enumerate(rows))
    return ('<section style="background:#0b1220"><div class="wrap">' + _mhead(eyebrow, h2, lead, color='light', accent=accent) +
            ('<div class="reveal" style="max-width:760px;margin:30px auto 0;display:flex;flex-direction:column;gap:12px">%s</div>%s</div></section>'
             % (items, ('<div class="reveal" style="margin-top:26px;text-align:center">%s</div>' % cta) if cta else '')))

def m_zigzag(eyebrow, h2, items, accent='#ea580c', soft=True, lead=''):
    """Alternating feature rows: big soft icon tile left/right alternating — nothing like a card grid."""
    rows = ''
    for i, (ic, t, d) in enumerate(items):
        tile = ('<div style="flex:none;width:92px;height:92px;border-radius:26px;background:linear-gradient(135deg,%s18,%s30);border:1px solid %s40;color:%s;display:flex;align-items:center;justify-content:center">%s</div>'
                % (accent, accent, accent, accent, mi(ic, 40)))
        body = '<div style="flex:1 1 320px"><h3 style="margin:0 0 6px">%s</h3><p style="margin:0;color:#64748b;max-width:560px">%s</p></div>' % (t, d)
        inner = (body + tile) if i % 2 else (tile + body)
        rows += ('<div class="reveal" style="display:flex;align-items:center;gap:26px;background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:24px 28px;flex-wrap:wrap">%s</div>' % inner)
    return ('<section%s><div class="wrap">' % (' class="bg-soft"' if soft else '') + _mhead(eyebrow, h2, lead, accent=accent) +
            '<div style="max-width:860px;margin:30px auto 0;display:flex;flex-direction:column;gap:16px">%s</div></div></section>' % rows)

def m_statband(stats, note=''):
    """Navy stat band (reuses .stats styling): stats=(value,label)"""
    cells = ''.join('<div class="stat reveal"><div class="n">%s</div><div class="l">%s</div></div>' % (v, l) for v, l in stats)
    nt = ('<p class="reveal" style="text-align:center;color:#94a3b8;font-size:.85rem;margin-top:22px">%s</p>' % note) if note else ''
    return '<section class="stats"><div class="wrap"><div class="stats-grid" style="grid-template-columns:repeat(%d,1fr)">%s</div>%s</div></section>' % (max(len(stats),1), cells, nt)

def m_gradcta(h2, p, label, href, grad='linear-gradient(135deg,#0b1220 0%,#12304f 55%,#0e3b33 100%)', btncolor='#34d399', btntext='#052e2b', small=''):
    """Full-bleed gradient CTA panel (per-page gradient so no two pages share one)."""
    return ('<section style="background:%s;color:#fff"><div class="wrap" style="text-align:center;padding:14px 0">'
            '<h2 class="reveal" style="color:#fff;max-width:720px;margin:0 auto 14px">%s</h2>'
            '<p class="reveal" style="color:#cbd5e1;max-width:620px;margin:0 auto 26px;font-size:1.06rem">%s</p>'
            '<div class="reveal"><a href="%s" class="btn btn-primary" style="background:%s;color:%s;border:none;font-weight:800">%s</a></div>%s'
            '</div></section>') % (grad, h2, p, href, btncolor, btntext, label,
            ('<p class="reveal" style="color:#94a3b8;font-size:.82rem;margin-top:16px">%s</p>' % small) if small else '')
