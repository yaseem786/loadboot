"""og_cards_module.py — a per-article social thumbnail (1200x627 PNG) for LinkedIn / Facebook / X.

Before this every article shared the one homepage og-image, so every LinkedIn RSS post looked the same.
For each built page that is a JSON-LD Article with a datePublished, this renders site/og/<slug>.png
(navy brand card: LoadBoot logo, kind label, the article title, key rates for rate reports, date) and
points that page's og:image / twitter:image / og:image:alt at it. Text comes only from the page itself.
Needs Pillow (requirements.txt). If Pillow or a font is missing it does nothing and pages keep the
generic image — it can never break a deploy.
"""
import os, re, html, hashlib
from datetime import datetime

W, H = 1200, 627
NAVY, NAVY2, BLUE, ORANGE, WHITE, MUTED = (16, 34, 59), (9, 20, 36), (8, 131, 247), (252, 83, 5), (255, 255, 255), (163, 184, 209)
GENERIC = 'https://loadboot.com/og-image.png?v=3'
_TITLE = re.compile(r'<title>(.*?)</title>', re.S | re.I)
_DESC = re.compile(r'<meta\s+name="description"\s+content="([^"]*)"', re.I)
_PUB = re.compile(r'"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})')
_ART = re.compile(r'"@type"\s*:\s*"(Article|BlogPosting|NewsArticle)"')
_RATE = re.compile(r'(dry van|reefer|flatbed|hotshot|power only|step deck|box truck|conestoga)\s*\$(\d+\.\d\d)', re.I)
EXCLUDE = {'404.html', 'dashboard.html', 'sitemap.html'}


def _kind(fname, title):
    t = (fname + ' ' + title).lower()
    if 'market-report' in t: return 'WEEKLY FREIGHT MARKET REPORT'
    if '-rates-week-' in fname: return 'WEEKLY RATE REPORT'
    if 'truck-dispatcher-in-' in fname: return 'STATE DISPATCH GUIDE'
    if 'broker' in t: return 'GUIDE FOR FREIGHT BROKERS'
    if 'ship' in t: return 'GUIDE FOR SHIPPERS'
    return 'GUIDE FOR CARRIERS'


def _wrap(draw, text, font, width, max_lines):
    words, lines, cur = text.split(), [], ''
    for w in words:
        trial = (cur + ' ' + w).strip()
        if draw.textlength(trial, font=font) <= width:
            cur = trial
        else:
            if cur: lines.append(cur)
            cur = w
    if cur: lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        while lines[-1] and draw.textlength(lines[-1] + '…', font=font) > width:
            lines[-1] = lines[-1].rsplit(' ', 1)[0] if ' ' in lines[-1] else lines[-1][:-1]
        lines[-1] = lines[-1].rstrip(' ,—–-:') + '…'
    return lines


def _render(path, title, kind, rates, date_s, root, Image, ImageDraw, ImageFont, desc=''):
    fb = os.path.join(root, 'assets', 'fonts', 'DejaVuSans-Bold.ttf')
    fr = os.path.join(root, 'assets', 'fonts', 'DejaVuSans.ttf')
    im = Image.new('RGB', (W, H), NAVY)
    d = ImageDraw.Draw(im)
    for y in range(H):   # vertical navy gradient
        k = y / H
        d.line([(0, y), (W, y)], fill=tuple(int(NAVY[i] * (1 - k) + NAVY2[i] * k) for i in range(3)))
    d.rectangle([0, 0, 14, H], fill=ORANGE)                       # left brand bar
    d.ellipse([W - 330, -190, W + 190, 330], outline=(26, 55, 92), width=40)   # quiet motif
    logo = os.path.join(root, 'logo-full-dark.png')
    if os.path.exists(logo):
        lg = Image.open(logo).convert('RGBA'); lh = 56
        lg = lg.resize((int(lg.width * lh / lg.height), lh))
        im.paste(lg, (70, 52), lg)
    f_kind = ImageFont.truetype(fb, 24)
    d.text((72, 150), kind, font=f_kind, fill=ORANGE)
    size, lines = 58, []
    for size in (58, 52, 46, 42):
        f_t = ImageFont.truetype(fb, size)
        lines = _wrap(d, title, f_t, W - 150, 3 if not rates else 2)
        if len(lines) <= (3 if not rates else 2) and not lines[-1].endswith('…'): break
    y = 196
    for ln in lines:
        d.text((72, y), ln, font=f_t, fill=WHITE); y += int(size * 1.22)
    if not rates and desc:   # guides: two muted lines of the page's own description
        y += 18; f_d = ImageFont.truetype(fr, 28)
        for ln in _wrap(d, desc, f_d, W - 150, 2):
            d.text((72, y), ln, font=f_d, fill=MUTED); y += 40
    if rates:
        y += 22; x = 72
        f_l, f_v = ImageFont.truetype(fr, 22), ImageFont.truetype(fb, 40)
        for name, val in rates[:4]:
            d.rounded_rectangle([x, y, x + 245, y + 104], radius=16, fill=(24, 52, 88))
            d.text((x + 20, y + 14), name.upper(), font=f_l, fill=MUTED)
            d.text((x + 20, y + 44), '$' + val + '/mi', font=f_v, fill=WHITE)
            x += 265
    d.rectangle([72, H - 92, 72 + 90, H - 87], fill=BLUE)
    f_f = ImageFont.truetype(fr, 24)
    d.text((72, H - 72), 'loadboot.com', font=ImageFont.truetype(fb, 26), fill=WHITE)
    if date_s:
        tw = d.textlength(date_s, font=f_f)
        d.text((W - 72 - tw, H - 70), date_s, font=f_f, fill=MUTED)
    im.save(path, 'PNG', optimize=True)


def build_og_cards(out_dir, domain, root=None):
    try:
        from PIL import Image, ImageDraw, ImageFont
    except Exception:
        return 'skipped (Pillow not installed)'
    root = root or os.path.dirname(os.path.abspath(__file__))
    if not os.path.exists(os.path.join(root, 'assets', 'fonts', 'DejaVuSans-Bold.ttf')):
        return 'skipped (font missing)'
    og_dir = os.path.join(out_dir, 'og'); os.makedirs(og_dir, exist_ok=True)
    n = 0
    for f in sorted(os.listdir(out_dir)):
        if not f.endswith('.html') or f in EXCLUDE: continue
        p = os.path.join(out_dir, f)
        try:
            s = open(p, encoding='utf-8').read()
            pub = _PUB.findall(s)
            if not pub or not _ART.search(s) or GENERIC not in s: continue
            t = _TITLE.search(s)
            if not t: continue
            title = re.sub(r'\s*\|\s*LoadBoot\s*$', '', html.unescape(t.group(1)).strip())
            desc = html.unescape((_DESC.search(s) or [None, ''])[1] if _DESC.search(s) else '')
            rates = [(m.group(1).title(), m.group(2)) for m in _RATE.finditer(desc)] if ('report' in f or 'rates-week' in f) else []
            date_s = datetime.strptime(min(pub), '%Y-%m-%d').strftime('%b %d, %Y').replace(' 0', ' ')
            slug = f[:-5]
            _render(os.path.join(og_dir, slug + '.png'), title, _kind(f, title), rates, date_s, root, Image, ImageDraw, ImageFont, desc)
            v = hashlib.md5((title + '|' + desc + '|' + str(rates)).encode()).hexdigest()[:8]
            url = '%s/og/%s.png?v=%s' % (domain, slug, v)
            # only the 1200x630 card + twitter image + alt; the square og:image stays as a fallback
            s = s.replace('<meta property="og:image" content="%s">' % GENERIC, '<meta property="og:image" content="%s">' % url, 1)
            s = s.replace('<meta name="twitter:image" content="%s">' % GENERIC, '<meta name="twitter:image" content="%s">' % url, 1)
            s = re.sub(r'<meta property="og:image:alt" content="[^"]*">', '<meta property="og:image:alt" content="%s">' % html.escape(title, quote=True), s, count=1)
            open(p, 'w', encoding='utf-8').write(s)
            n += 1
        except Exception as e:
            print('OG card: %s skipped (%s)' % (f, e))
    return '%d article cards -> og/' % n
