#!/usr/bin/env python3
"""make-appstore-shots.py — compose App Store screenshots from raw portal captures.

Input : raw phone captures (any size, portrait; the Play 1080x1920 shots work) listed in SHOTS.
Output: docs/appstore-screenshots/iphone-69/NN-slug.png  (1320x2868, 6.9" — REQUIRED)
        docs/appstore-screenshots/ipad-13/NN-slug.png    (2064x2752, 13"  — required if iPad enabled)
Style : flat brand navy (#0F172A) → deep navy gradient, Poppins headline + sub-line, rounded
        screenshot with a hairline border and soft shadow. No alpha (Apple rejects transparency).

Usage: python3 tools/ios/scripts/make-appstore-shots.py [--src docs/playstore-screenshots] [--font /path/Poppins-Bold.ttf]
Re-run any time the captures change. Replace the 1080x1920 sources with true iPhone-size captures
(Chrome DevTools → iPhone 15 Pro Max, DPR 3) whenever convenient; the layout adapts.
"""
import argparse, os, sys
from PIL import Image, ImageDraw, ImageFilter, ImageFont

NAVY = (15, 23, 42); NAVY2 = (7, 12, 26); BLUE = (8, 131, 247); ORANGE = (252, 83, 5); MUTED = (148, 163, 184)

# (source file, headline, sub-line, accent)
SHOTS = [
    ("01-dashboard.png",        "Your loads, trips\nand money — one app", "Carrier dashboard: active trip, approvals, next step.", BLUE),
    ("02-load-board.png",       "A verified load board",                  "Broker-posted freight. Real rates. No junk.",       BLUE),
    ("04-live-trip.png",        "GPS proof on\nevery mile",               "Arrive / depart stamps and live tracking the broker can see.", ORANGE),
    ("03-post-truck.png",       "Post your truck,\nlet loads find you",   "Equipment, dates, radius, rate floor — matches come to you.", BLUE),
    ("05-earnings.png",         "Settlements you\ncan actually read",     "Invoices, detention, accessorials — every dollar traced.", ORANGE),
    ("08-verified-profile.png", "Verified carrier\nprofile",              "FMCSA authority, insurance and W-9 checked once, reused everywhere.", BLUE),
    ("broker-01-dashboard.png", "Brokers & shippers:\npost freight free",  "One dashboard for open loads, offers and covered lanes.", ORANGE),
    ("broker-04-tracking.png",  "Watch the truck,\nnot your phone",        "Live location + ETA on every covered load.",       BLUE),
]

SIZES = {"iphone-69": (1320, 2868), "ipad-13": (2064, 2752)}


def gradient(w, h):
    im = Image.new("RGB", (w, h), NAVY); px = im.load()
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(NAVY[i] * (1 - t) + NAVY2[i] * t) for i in range(3))
        for x in range(w): px[x, y] = c
    return im


def rounded(im, r):
    m = Image.new("L", im.size, 0); ImageDraw.Draw(m).rounded_rectangle([0, 0, im.width - 1, im.height - 1], r, fill=255)
    out = im.convert("RGBA"); out.putalpha(m); return out


def load_font(path, size):
    for p in [path, "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf", "C:/Windows/Fonts/arialbd.ttf"]:
        if p and os.path.exists(p):
            return ImageFont.truetype(p, size)
    return ImageFont.load_default()


def compose(src, headline, sub, accent, W, H, font_path, ipad=False):
    canvas = gradient(W, H); d = ImageDraw.Draw(canvas)
    if os.path.basename(src).startswith("broker-"):
        # broker sources are already marketing composites (own headline) → scale + center, no second frame
        shot = Image.open(src).convert("RGB")
        tw = W if not ipad else int(W * 0.62); th = int(shot.height * tw / shot.width)
        if th > H: th = H; tw = int(shot.width * th / shot.height)
        shot = shot.resize((tw, th), Image.LANCZOS)
        canvas.paste(shot, ((W - tw) // 2, (H - th) // 2)); return canvas
    scale = W / 1320
    hf = load_font(font_path, int(84 * scale)); sf = load_font(font_path, int(40 * scale))
    x0 = int(96 * scale); y = int(150 * scale)
    # accent bar + headline
    d.rounded_rectangle([x0, y + int(10 * scale), x0 + int(14 * scale), y + int(96 * scale)], int(7 * scale), fill=accent)
    d.multiline_text((x0 + int(44 * scale), y), headline, font=hf, fill=(255, 255, 255), spacing=int(6 * scale))
    lines = headline.count("\n") + 1
    y += int((100 * lines + 24) * scale)
    d.text((x0 + int(44 * scale), y), sub, font=sf, fill=MUTED)
    y += int(110 * scale)
    # screenshot: fit width, keep aspect, bleed off the bottom
    shot = Image.open(src).convert("RGB")
    tw = W - 2 * int(96 * scale) if not ipad else int(W * 0.56)
    th = int(shot.height * tw / shot.width)
    shot = shot.resize((tw, th), Image.LANCZOS)
    r = int(54 * scale)
    sx = (W - tw) // 2
    # shadow
    sh = Image.new("RGBA", (tw + int(80 * scale), th + int(80 * scale)), (0, 0, 0, 0))
    ImageDraw.Draw(sh).rounded_rectangle([int(40 * scale), int(40 * scale), tw + int(40 * scale), th + int(40 * scale)], r, fill=(0, 0, 0, 150))
    sh = sh.filter(ImageFilter.GaussianBlur(int(30 * scale)))
    canvas.paste(sh, (sx - int(40 * scale), y - int(20 * scale)), sh)
    rs = rounded(shot, r)
    border = Image.new("RGBA", (tw + 4, th + 4), (0, 0, 0, 0)); ImageDraw.Draw(border).rounded_rectangle([0, 0, tw + 3, th + 3], r + 2, outline=(255, 255, 255, 40), width=2)
    canvas.paste(border, (sx - 2, y - 2), border)
    canvas.paste(rs, (sx, y), rs)
    return canvas


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--src", default="docs/playstore-screenshots"); ap.add_argument("--out", default="docs/appstore-screenshots"); ap.add_argument("--font", default=None)
    a = ap.parse_args()
    for key, (W, H) in SIZES.items():
        od = os.path.join(a.out, key); os.makedirs(od, exist_ok=True)
        for i, (f, hl, sub, acc) in enumerate(SHOTS, 1):
            src = os.path.join(a.src, f)
            if not os.path.exists(src): print("skip (missing)", src); continue
            out = compose(src, hl, sub, acc, W, H, a.font, ipad=(key == "ipad-13"))
            name = f"{i:02d}-{os.path.splitext(f)[0]}.png"
            out.save(os.path.join(od, name), optimize=True)
            print("wrote", os.path.join(od, name), out.size, out.mode)


if __name__ == "__main__":
    main()
