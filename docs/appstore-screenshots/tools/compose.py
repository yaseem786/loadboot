"""Compose App Store marketing screenshots from raw 1320x2868 captures.
Apple-style: headline on brand gradient, iPhone frame bleeding off the bottom."""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os, sys

RAW = '/tmp/shots/raw'
OUT = '/tmp/shots/out'
SIZES = {'6.9': (1320, 2868), '6.7': (1290, 2796), '6.5': (1242, 2688)}
NAVY, BLUE, ORANGE = (16, 34, 59), (8, 131, 247), (252, 83, 5)

SHOTS = [
    ('01', 'f1-dashboard', 'Your trucking business,\nin one screen', 'Live trip, money owed and this week’s revenue — every morning at a glance.', 'blue'),
    ('02', 'f2-loads', 'Loads matched\nto your truck', 'Real rates and $/mile on every load. Request to book or propose your rate in one tap.', 'orange'),
    ('03', 'f4-tripmap', 'Every mile tracked,\nautomatically', 'Route, ETA and GPS check-ins at pickup and delivery — your proof for detention pay.', 'blue'),
    ('04', 'f3-trips', 'From booked\nto paid', 'Countdown to delivery, dispatch pack, POD upload and pay claims — all on one card.', 'orange'),
    ('05', 'f5-finance', 'Know your\nreal profit', 'Revenue, cost and net per mile on every trip. Tap any trip for its full P&L.', 'blue'),
    ('06', 'f6-rates', 'Never haul below\nyour cost', 'Live lane rates and national benchmarks for every equipment type.', 'orange'),
    ('07', 'f7-fleet', 'Your whole fleet,\noptimized', 'One plan: the best-fit load for every truck, with deadhead from its last drop.', 'blue'),
    ('08', 'f8-profile', 'Verified.\nTrusted by brokers.', 'FMCSA-backed profile with COI, W-9, authority and banking on file — phone and email stay private.', 'orange'),
]

def font(w, size): return ImageFont.truetype(f'/tmp/shots/Manrope-{w}.ttf', size)

def gradient_bg(W, H, accent):
    # vertical navy gradient + soft radial glow behind the phone
    bg = Image.new('RGB', (W, H), NAVY)
    top, bot = (13, 27, 48), (6, 12, 24)
    px = bg.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(int(top[i] * (1 - t) + bot[i] * t) for i in range(3))
        for x in range(W): px[x, y] = c
    glow = Image.new('RGB', (W, H), (0, 0, 0))
    gd = ImageDraw.Draw(glow)
    col = BLUE if accent == 'blue' else ORANGE
    r = int(W * 0.62)
    cx, cy = W // 2, int(H * 0.62)
    gd.ellipse((cx - r, cy - int(r * 0.9), cx + r, cy + int(r * 0.9)), fill=tuple(int(c * 0.55) for c in col))
    glow = glow.filter(ImageFilter.GaussianBlur(int(W * 0.22)))
    bg = Image.blend(bg, Image.eval(glow, lambda v: v), 0.0)
    bg = Image.fromarray(__import__('numpy').clip(__import__('numpy').asarray(bg).astype('int32') + __import__('numpy').asarray(glow).astype('int32'), 0, 255).astype('uint8'))
    return bg

def rounded_mask(size, radius):
    m = Image.new('L', size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, size[0] - 1, size[1] - 1), radius=radius, fill=255)
    return m

def with_status_bar(screen):
    """Prepend a 162px iOS status bar (54pt @3x) in the app header colour -> 1320x2868."""
    W = screen.width; bar_h = 2868 - screen.height
    col = screen.getpixel((6, 6))
    out = Image.new('RGB', (W, 2868), col); out.paste(screen, (0, bar_h))
    d = ImageDraw.Draw(out)
    ink = (20, 22, 26) if (0.299*col[0]+0.587*col[1]+0.114*col[2]) > 140 else (255, 255, 255)
    f = ImageFont.truetype('/tmp/shots/Manrope-700.ttf', 50)
    d.text((100, 54), '9:41', font=f, fill=ink)
    # signal bars
    x0, base = W - 300, 110
    for i, h in enumerate((16, 24, 32, 40)):
        d.rounded_rectangle((x0 + i * 20, base - h, x0 + i * 20 + 12, base), radius=3, fill=ink)
    # wifi (arcs)
    cx, cy = W - 190, 112
    for r, wdt in ((40, 8), (26, 8), (12, 8)):
        d.arc((cx - r, cy - r, cx + r, cy + r), start=225, end=315, fill=ink, width=wdt)
    # battery
    bx, by = W - 132, 82
    d.rounded_rectangle((bx, by, bx + 76, by + 36), radius=10, outline=ink, width=4)
    d.rounded_rectangle((bx + 6, by + 6, bx + 70, by + 30), radius=6, fill=ink)
    d.rounded_rectangle((bx + 80, by + 11, bx + 86, by + 25), radius=3, fill=ink)
    return out

def phone(screen, sw):
    """Return an RGBA iPhone image whose screen is sw px wide (screen keeps 1320x2868 ratio)."""
    if screen.height != 2868: screen = with_status_bar(screen)
    sh = round(sw * 2868 / 1320)
    scr = screen.resize((sw, sh), Image.LANCZOS)
    bez = round(sw * 0.028)           # bezel thickness
    W, H = sw + 2 * bez, sh + 2 * bez
    rad_out = round(sw * 0.165); rad_in = rad_out - bez
    ph = Image.new('RGBA', (W + 40, H + 40), (0, 0, 0, 0))
    d = ImageDraw.Draw(ph)
    ox, oy = 20, 20
    # body: near-black titanium
    d.rounded_rectangle((ox, oy, ox + W - 1, oy + H - 1), radius=rad_out, fill=(22, 24, 28, 255), outline=(70, 74, 82, 255), width=max(2, bez // 6))
    # side buttons
    bw = max(3, bez // 3)
    for (y0, y1) in ((0.16, 0.20), (0.24, 0.31), (0.33, 0.40)):
        d.rounded_rectangle((ox - bw, oy + int(H * y0), ox, oy + int(H * y1)), radius=bw, fill=(60, 63, 70, 255))
    d.rounded_rectangle((ox + W, oy + int(H * 0.27), ox + W + bw, oy + int(H * 0.38)), radius=bw, fill=(60, 63, 70, 255))
    # screen
    scr_rgba = scr.convert('RGBA'); scr_rgba.putalpha(rounded_mask((sw, sh), rad_in))
    ph.alpha_composite(scr_rgba, (ox + bez, oy + bez))
    # dynamic island
    iw, ih = round(sw * 0.27), round(sw * 0.08)
    d.rounded_rectangle((ox + bez + (sw - iw) // 2, oy + bez + round(sw * 0.026), ox + bez + (sw + iw) // 2, oy + bez + round(sw * 0.026) + ih), radius=ih // 2, fill=(8, 8, 10, 255))
    return ph

def compose(shot, size_key):
    num, raw, title, sub, accent = shot
    W, H = SIZES[size_key]
    s = W / 1320.0
    bg = gradient_bg(W, H, accent)
    d = ImageDraw.Draw(bg)
    # text block
    ft = font(800, round(96 * s)); fs = font(500, round(40 * s))
    y = round(150 * s)
    for line in title.split('\n'):
        tw = d.textlength(line, font=ft); d.text(((W - tw) / 2, y), line, font=ft, fill=(255, 255, 255)); y += round(112 * s)
    y += round(18 * s)
    # wrap subtitle to ~ 1000px
    words = sub.split(); lines = []; cur = ''
    for w in words:
        t = (cur + ' ' + w).strip()
        if d.textlength(t, font=fs) > W * 0.80 and cur: lines.append(cur); cur = w
        else: cur = t
    if cur: lines.append(cur)
    for line in lines:
        tw = d.textlength(line, font=fs); d.text(((W - tw) / 2, y), line, font=fs, fill=(182, 196, 220)); y += round(54 * s)
    # phone
    screen = Image.open(f'{RAW}/{raw}.png').convert('RGB')
    ph = phone(screen, round(1060 * s))
    top = max(y + round(70 * s), round(690 * s))
    # shadow
    sh = Image.new('RGBA', ph.size, (0, 0, 0, 0)); sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle((20, 20, ph.width - 20, ph.height - 20), radius=round(180 * s), fill=(0, 0, 0, 170))
    sh = sh.filter(ImageFilter.GaussianBlur(round(48 * s)))
    x = (W - ph.width) // 2
    bg.paste(sh, (x, top + round(40 * s)), sh)
    bg.paste(ph, (x, top), ph)
    out = bg.crop((0, 0, W, H))
    os.makedirs(f'{OUT}/{size_key}', exist_ok=True)
    p = f'{OUT}/{size_key}/{num}-{raw.split("-",1)[1]}-{W}x{H}.png'
    out.save(p, 'PNG', optimize=True)
    return p

if __name__ == '__main__':
    keys = sys.argv[1:] or list(SIZES)
    for k in keys:
        for sh in SHOTS: print(compose(sh, k))
