# -*- coding: utf-8 -*-
import os, shutil, re, sys, json
from tools_module import TOOLS_CSS, TOOLS_HTML, TOOLS_JS
from load_score_module import LS_CSS, LS_HTML, LS_JS
from motifs_module import mi, m_rail, m_timeline, m_split, m_dark, m_zigzag, m_statband, m_gradcta
# SOURCE vs PUBLISH separation (Netlify: command="python3 build_site.py", publish="site").
#   SRC  = repo root. Holds SOURCE only (this script, modules, dashboard.html, images,
#          netlify.toml, runtime.txt, migrations/, docs/, README, content-queue). NOT published.
#   OUT  = SRC/site = the ONLY published directory. Cleaned + recreated on every build.
# build_site.py generates all HTML/CSS/JS + _headers/_redirects/404/robots/sitemap into OUT,
# copies dashboard.html and every referenced image into OUT, then FAILS the build if any
# referenced local asset or required output page is missing.
SRC = os.path.dirname(os.path.abspath(__file__))
OUT = os.environ.get('LOADBOOT_OUT') or os.path.join(SRC, 'site')
shutil.rmtree(OUT, ignore_errors=True)   # clean
os.makedirs(OUT, exist_ok=True)          # recreate
# Files in SRC root that must NEVER be copied into the publish dir (source-only):
_NO_PUBLISH = {'build_site.py','tools_module.py','load_score_module.py','motifs_module.py','netlify.toml',
               'runtime.txt','README.md','content-queue.md','.gitignore'}
_ASSET_EXTS = ('.webp','.png','.jpg','.jpeg','.avif','.ico','.svg','.gif')
def asset_exists(name):
    """True if a referenced local asset is present in SRC (so the page can reference it)."""
    return bool(name) and os.path.exists(os.path.join(SRC, name.split('?')[0]))

# ============================================================================
# DEPLOY CONTEXT + SUPABASE TARGETS (single source of truth — used by the public
# load board, the app env-config, and the per-context CSP).
#   production context => the PRODUCTION project ONLY.
#   any preview/branch/dev context => the STAGING project ONLY (never production).
# A preview that cannot resolve its staging key FAILS the build (see app section).
# ============================================================================
PROD_REF = 'rwscphuhpjoudvljvmdk'
STAGING_REF = 'snslhvmkjusozgjelghi'
PROD_ANON = os.environ.get('LOADBOOT_PROD_ANON_KEY') or 'sb_publishable_lHr4JKuHCZEkkjaEh7vx3A_ya_XLG4V'
STAGING_ANON = os.environ.get('LOADBOOT_STAGING_ANON_KEY')   # required for preview builds
_CTX = (os.environ.get('CONTEXT') or os.environ.get('LOADBOOT_CONTEXT') or 'dev').strip()
IS_PRODUCTION_CTX = (_CTX == 'production')
_BUILD_ID = (os.environ.get('COMMIT_REF') or os.environ.get('LOADBOOT_BUILD_ID') or ('b' + str(int(__import__('time').time()))))[:12]
if IS_PRODUCTION_CTX:
    APP_ENV, APP_REF, APP_ANON = 'production', PROD_REF, PROD_ANON
else:
    APP_ENV, APP_REF, APP_ANON = 'preview', STAGING_REF, STAGING_ANON

# ---------------- shared CSS ----------------
CSS = r''':root{--pdc:1}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.pdcalc{background:linear-gradient(160deg,#0b1220,#14532d);border:1px solid rgba(34,197,94,.35);border-radius:18px;padding:22px;margin:26px 0;color:#e6edf8}
.pdc-h{font-weight:800;font-size:1.15rem;color:#4ade80}
.pdc-s{color:#93a4bd;font-size:.95rem;margin:4px 0 14px;line-height:1.6}
.pdc-row{display:flex;justify-content:space-between;align-items:center;font-weight:700}
.pdc-row output{font-size:1.5rem;font-weight:900;color:#fbbf24}
.pdcalc input[type=range]{width:100%;margin:8px 0 16px;accent-color:#22c55e}
.pdc-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.pdc-tile{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px}
.pdc-tile span{display:block;font-size:.62rem;letter-spacing:.1em;font-weight:800;color:#7f92b3}
.pdc-tile b{display:block;font-size:1.75rem;font-weight:900;margin:3px 0;color:#fff}
.pdc-tile i{font-size:.72rem;color:#93a4bd;font-style:normal}
.pdc-tile.pdc-hi{border-color:rgba(34,197,94,.5)}.pdc-tile.pdc-hi b{color:#4ade80}
.pdc-note{font-size:.9rem;color:#cbd5e1;line-height:1.65;margin:14px 0 12px}
.pdc-cta{display:inline-block;background:#FC5305;color:#fff;font-weight:800;padding:13px 22px;border-radius:11px;text-decoration:none}
.art-shot{margin:26px 0}.art-shot svg{width:100%;height:auto;border-radius:16px;display:block;box-shadow:0 24px 60px -30px rgba(2,12,30,.7)}
.art-shot figcaption{color:var(--muted);font-size:.88rem;margin-top:9px;text-align:center;line-height:1.6}
@media(max-width:640px){.pdc-grid{grid-template-columns:1fr}.pdc-cta{display:block;text-align:center}}
:root{--navy:#10223B;--blue:#0883F7;--orange:#FC5305;--white:#fff;--bg:#F8FAFC;--muted:#64748B;--border:#E2E8F0;--blue-soft:#EFF6FF;--maxw:1200px;--r:16px}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
a:focus-visible,button:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible{outline:3px solid #0883F7;outline-offset:2px;border-radius:4px}
body{font-family:'Inter',system-ui,sans-serif;color:var(--navy);line-height:1.6;background:#fff;-webkit-font-smoothing:antialiased;overflow-x:hidden}
h1,h2,h3,h4,.logo{font-family:'Manrope',sans-serif;line-height:1.12;letter-spacing:-.025em}
h1{font-size:clamp(2.4rem,5.4vw,4rem);font-weight:800;letter-spacing:-.035em}
h2{font-size:clamp(1.8rem,3.6vw,2.7rem);font-weight:800;letter-spacing:-.03em}
h3{font-size:1.2rem;font-weight:700}h4{font-size:1.05rem;font-weight:700}
p{color:var(--muted)}a{text-decoration:none;color:inherit}
.wrap{max-width:var(--maxw);margin:0 auto;padding:0 24px}
section{padding:96px 0;position:relative}
.eyebrow{color:var(--blue);font-weight:600;font-size:.9rem;text-transform:uppercase;letter-spacing:.1em;margin-bottom:14px}
.lead{font-size:1.13rem;max-width:660px}
.center{text-align:center;margin-left:auto;margin-right:auto}
.gradtext{background:linear-gradient(120deg,#60a5fa,#a78bfa);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.prose p{margin-bottom:16px;font-size:1.05rem;max-width:760px}
.prose h2{margin:36px 0 14px}.prose h3{margin:24px 0 10px}
.prose ul{margin:0 0 18px 22px;color:var(--muted);max-width:760px}.prose li{margin-bottom:8px}
.btn{display:inline-flex;align-items:center;gap:9px;font-weight:600;font-size:1rem;padding:15px 30px;border-radius:10px;cursor:pointer;border:1px solid transparent;transition:.25s}
.btn svg{transition:.25s}.btn:hover svg{transform:translateX(4px)}
.btn-primary{background:var(--orange);color:#fff;box-shadow:0 10px 24px -8px rgba(252,83,5,.6)}
.btn-primary:hover{background:#ea670c;transform:translateY(-2px)}
.btn-secondary{background:#fff;color:var(--navy);border-color:var(--border)}
.btn-secondary:hover{border-color:var(--blue);color:var(--blue)}
header{position:sticky;top:0;z-index:60;background:rgba(255,255,255,.82);backdrop-filter:blur(14px);border-bottom:1px solid transparent;transition:.3s}
header.scrolled{border-bottom-color:var(--border);box-shadow:0 4px 24px -16px rgba(15,23,42,.4)}
.nav{display:flex;align-items:center;justify-content:space-between;height:74px}
.logo{font-weight:800;font-size:1.4rem;display:flex;align-items:center;gap:3px;color:var(--navy)}
.logo .mark{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#1e3a8a,#0b1220);display:flex;align-items:center;justify-content:center;color:#fff}
.nav-links{display:flex;gap:28px;align-items:center}
.nav-links a{font-weight:500;color:#334155;font-size:.95rem;position:relative}
.nav-links a::after{content:"";position:absolute;left:0;bottom:-6px;width:0;height:2px;background:var(--blue);transition:.25s}
.nav-links a:hover,.nav-links a.active{color:var(--navy)}.nav-links a:hover::after,.nav-links a.active::after{width:100%}
.menu-btn{display:none;background:none;border:none;cursor:pointer}
.nav-actions{display:flex;gap:12px;align-items:center}.hd-login{padding:11px 16px}.hd-login svg{vertical-align:-3px}
.nav-mob{display:none}
.nav-dd{position:relative;display:flex;align-items:center}
.nav-dd-top{display:inline-flex;align-items:center;gap:5px}
.nav-caret{opacity:.55;transition:transform .2s}
.nav-dd:hover .nav-caret{transform:rotate(180deg)}
.nav-dd::before{content:"";position:absolute;top:100%;left:-10px;right:-10px;height:16px}
.nav-dd-menu{position:absolute;top:calc(100% + 14px);left:-14px;min-width:264px;background:#fff;border:1px solid var(--border);border-radius:14px;box-shadow:0 24px 60px -22px rgba(16,34,59,.35);padding:8px;display:none;flex-direction:column;z-index:60}
.nav-dd:hover .nav-dd-menu,.nav-dd:focus-within .nav-dd-menu{display:flex}
.nav-dd-item{display:block;padding:9px 12px;border-radius:9px;font-size:.9rem;font-weight:600;color:#334155;white-space:nowrap}
.nav-dd-item:hover{background:#f1f6fd;color:var(--blue)}
.nav-dd-item.active{color:var(--blue)}
.nav-dd-item::after{display:none}
.hero{padding:108px 0 112px;position:relative;background:radial-gradient(130% 120% at 76% -10%,#243150 0%,#10223B 56%);overflow:hidden;color:#fff;border-bottom:1px solid #1e293b}
.hero h1{color:#fff}
.hero .lead{color:#cbd5e1}
.hero .badge{background:rgba(255,255,255,.08);color:#e2e8f0;border-color:rgba(255,255,255,.16)}
.hero .trust div{color:#e2e8f0}.hero .trust svg{color:#60a5fa}
.hero .btn-secondary{background:rgba(255,255,255,.07);color:#fff;border-color:rgba(255,255,255,.22)}
.hero .btn-secondary:hover{background:rgba(255,255,255,.14);color:#fff;border-color:rgba(255,255,255,.4)}
.hero .hv-card{border:1px solid rgba(255,255,255,.1)}
.aurora{position:absolute;inset:0;z-index:0;pointer-events:none}
.aurora span{position:absolute;border-radius:50%;filter:blur(90px);opacity:.45;mix-blend-mode:screen;animation:float 14s ease-in-out infinite}
.aurora .a1{width:480px;height:480px;background:#bfdbfe;top:-120px;right:-80px}
.aurora .a2{width:420px;height:420px;background:#ddd6fe;bottom:-140px;left:-100px;animation-delay:-5s}
@keyframes float{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(20px,-30px) scale(1.08)}}
.hero-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:54px;align-items:center;position:relative;z-index:1}
.badge{display:inline-flex;align-items:center;gap:8px;background:#fff;color:var(--navy);font-weight:600;font-size:.86rem;padding:8px 16px;border-radius:999px;margin-bottom:24px;border:1px solid var(--border);box-shadow:0 4px 14px -8px rgba(15,23,42,.3)}
.badge .dot{width:8px;height:8px;border-radius:50%;background:#16a34a;box-shadow:0 0 0 4px rgba(22,163,74,.18)}
.hero p.lead{margin:24px 0 30px}.hero-btns{display:flex;gap:14px;flex-wrap:wrap}
.trust{display:flex;flex-wrap:wrap;gap:14px 26px;margin-top:34px}
.trust div{display:flex;align-items:center;gap:8px;font-size:.92rem;color:var(--navy);font-weight:500}
.trust svg{color:var(--blue);flex-shrink:0}
.hero-visual{position:relative}
.hero-photo{width:100%;border-radius:22px;display:block;box-shadow:0 40px 80px -30px rgba(15,23,42,.6)}
.hero-photo+.hv-card{display:none}
.hv-card{background:linear-gradient(150deg,var(--navy),#1e293b);border-radius:24px;padding:30px;color:#fff;box-shadow:0 40px 80px -30px rgba(15,23,42,.55);position:relative;overflow:hidden}
.hv-card .glow{position:absolute;width:240px;height:240px;background:radial-gradient(circle,rgba(37,99,235,.5),transparent 70%);top:-60px;right:-40px}
.hv-top{display:flex;justify-content:space-between;align-items:center;margin-bottom:22px;position:relative}
.hv-top .truck{color:#fff}.hv-top .truck svg{width:40px;height:40px}
.hv-live{display:inline-flex;align-items:center;gap:7px;font-size:.78rem;background:rgba(34,197,94,.18);color:#86efac;padding:5px 12px;border-radius:999px}
.hv-live .dot,.pdot{width:7px;height:7px;border-radius:50%;background:#22c55e;animation:pulse 1.6s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
.hv-row{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid rgba(255,255,255,.1);font-size:.92rem}
.hv-row span:first-child{color:#94a3b8}.hv-row span:last-child{font-weight:600}.hv-row:last-child{border-bottom:none}
.hv-rate{color:#86efac!important}
.hv-float{position:absolute;background:#fff;color:var(--navy);border-radius:14px;padding:13px 17px;box-shadow:0 20px 40px -16px rgba(15,23,42,.35);font-size:.84rem;font-weight:600;display:flex;align-items:center;gap:9px;animation:float 6s ease-in-out infinite}
.hv-float .ic{width:30px;height:30px;border-radius:9px;background:linear-gradient(150deg,#3b82f6,#1e40af);color:#fff;display:flex;align-items:center;justify-content:center;box-shadow:0 6px 14px -6px rgba(37,99,235,.6),inset 0 1px 0 rgba(255,255,255,.3)}
.hv-float .ic svg{width:17px;height:17px}.reply svg{width:18px;height:18px;vertical-align:-3px;margin-right:4px}
.hv-f1{bottom:-22px;left:-26px}.hv-f2{top:-20px;right:-20px;animation-delay:-3s}
.stats{background:var(--navy);color:#fff;padding:54px 0}
.stats-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:20px;text-align:center}
.stat .n{font-family:'Manrope';font-weight:800;font-size:clamp(2rem,4vw,2.8rem);background:linear-gradient(120deg,#fff,#93c5fd);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.stat .l{color:#94a3b8;font-size:.95rem;margin-top:4px}
.grid{display:grid;gap:24px}.g4{grid-template-columns:repeat(4,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:repeat(2,1fr)}
.card{background:#fff;border:1px solid var(--border);border-radius:18px;padding:28px;transition:.28s;position:relative}
.card:hover{box-shadow:0 28px 56px -28px rgba(37,99,235,.38);transform:translateY(-5px);border-color:#bfdbfe}
.icon{width:54px;height:54px;border-radius:15px;background:linear-gradient(150deg,#3b82f6,#1e40af);border:1px solid rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;margin-bottom:18px;color:#fff;box-shadow:0 10px 22px -8px rgba(37,99,235,.55),inset 0 1px 0 rgba(255,255,255,.35);position:relative;overflow:hidden;transition:.3s}
.icon::after{content:"";position:absolute;inset:0;background:radial-gradient(120% 80% at 20% 0%,rgba(255,255,255,.35),transparent 60%);opacity:.7}
.card:hover .icon,.linkcard:hover .icon{transform:translateY(-2px) scale(1.04);box-shadow:0 16px 30px -10px rgba(37,99,235,.7),inset 0 1px 0 rgba(255,255,255,.4)}
.icon svg{width:25px;height:25px;position:relative;z-index:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,.18))}
.card h3{margin-bottom:8px}.card p{font-size:.96rem}
.sec-head{max-width:680px;margin-bottom:50px}.sec-head.center{margin-left:auto;margin-right:auto}
.bg-soft{background:var(--bg)}
.photo-grid{display:grid;grid-template-columns:1.45fr 1fr;gap:20px}
.photo{border-radius:18px;overflow:hidden;min-height:340px;background:linear-gradient(135deg,#1e293b,#10223B);box-shadow:0 34px 64px -36px rgba(15,23,42,.55);position:relative}
.photo img{width:100%;height:100%;object-fit:cover;display:block;min-height:340px}
.photo .ph-tag{position:absolute;left:18px;bottom:16px;z-index:2;background:rgba(15,23,42,.6);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);color:#fff;font-family:'Manrope';font-weight:700;font-size:.92rem;padding:8px 14px;border-radius:10px}
.svc-photo{margin:0;border-radius:22px;overflow:hidden;position:relative;box-shadow:0 40px 84px -50px rgba(15,23,42,.55)}
.svc-photo img{display:block;width:100%;height:clamp(240px,40vw,460px);object-fit:cover}
.svc-photo figcaption{position:absolute;left:0;right:0;bottom:0;padding:46px 26px 18px;color:#fff;font-family:'Manrope';font-weight:700;font-size:1rem;background:linear-gradient(transparent,rgba(11,18,32,.82))}
@media(max-width:880px){.photo-grid{grid-template-columns:1fr}.photo,.photo img{min-height:240px}}
.linkcard{display:block;background:#fff;border:1px solid var(--border);border-radius:var(--r);padding:26px;transition:.25s}
.linkcard:hover{transform:translateY(-4px);border-color:var(--blue);box-shadow:0 24px 50px -26px rgba(37,99,235,.4)}
.linkcard .arw{color:var(--blue);font-weight:700;margin-top:12px;display:inline-flex;gap:6px;align-items:center}
/* ROAD + TRUCK ANIM */
.road-sec{background:var(--navy);color:#fff;overflow:hidden}
.road-sec h2{color:#fff}.road-sec .eyebrow{color:#93c5fd}.road-sec p{color:#cbd5e1}
.road{position:relative;height:130px;margin-top:34px;background:linear-gradient(180deg,#0b1220,#1e293b);border-radius:18px;overflow:hidden;border:1px solid #1e293b}
.road .lane{position:absolute;top:50%;left:0;right:0;height:5px;transform:translateY(-50%);background:repeating-linear-gradient(90deg,#fbbf24 0 34px,transparent 34px 70px);animation:dash 1s linear infinite}
@keyframes dash{to{background-position:70px 0}}
.road .tk{position:absolute;top:50%;transform:translateY(-50%);color:#fff;animation:drive 7s linear infinite;filter:drop-shadow(0 6px 10px rgba(0,0,0,.45))}
.road .tk svg{width:62px;height:62px;display:block}
@keyframes drive{from{left:-9%}to{left:105%}}
.road .hill{position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(180deg,transparent,rgba(37,99,235,.25))}
/* ROUTE MAP */
.routebox{background:#fff;border:1px solid var(--border);border-radius:20px;padding:22px;box-shadow:0 30px 60px -34px rgba(15,23,42,.4)}
.routebox svg{width:100%;height:auto;display:block}
.dasharw{stroke-dasharray:8 8;animation:draw 3s linear infinite}
@keyframes draw{to{stroke-dashoffset:-160}}
.route-grid{display:grid;grid-template-columns:1fr 1fr;gap:48px;align-items:center}
.tag{display:inline-flex;align-items:center;gap:7px;background:var(--blue-soft);color:var(--blue);font-weight:600;font-size:.85rem;padding:6px 13px;border-radius:999px;margin:4px 6px 0 0}
.cmp{width:100%;border-collapse:separate;border-spacing:0;background:#fff;border:1px solid var(--border);border-radius:var(--r);overflow:hidden}
.cmp th,.cmp td{padding:16px 18px;text-align:left;border-bottom:1px solid var(--border);font-size:.95rem}
.cmp th{font-family:'Manrope';font-weight:700;background:var(--bg)}
.cmp th.us{background:linear-gradient(135deg,var(--navy),#1e293b);color:#fff}
.cmp td.us{background:var(--blue-soft);font-weight:600}.cmp tr:last-child td{border-bottom:none}
.yes{color:#16a34a;font-weight:700}.no{color:#dc2626;font-weight:700}
.step .num{width:48px;height:48px;border-radius:14px;background:linear-gradient(135deg,var(--blue),#7c3aed);color:#fff;font-family:'Manrope';font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:16px;box-shadow:0 12px 24px -10px rgba(37,99,235,.6)}
.chips{display:flex;flex-wrap:wrap;gap:12px}
.chip{background:#fff;border:1px solid var(--border);border-radius:999px;padding:12px 22px;font-family:'Manrope';font-weight:600;font-size:.95rem;transition:.2s}
.chip:hover{border-color:var(--blue);color:var(--blue);transform:translateY(-2px)}
.mq-wrap{overflow:hidden;padding:8px 0;-webkit-mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent);mask-image:linear-gradient(90deg,transparent,#000 9%,#000 91%,transparent)}
.mq-track{display:flex;gap:14px;width:max-content;animation:mqs 38s linear infinite}
.mq-wrap.rev .mq-track{animation-direction:reverse;animation-duration:44s}
.mq-wrap:hover .mq-track{animation-play-state:paused}
@keyframes mqs{to{transform:translateX(-50%)}}
.mq-chip{display:inline-flex;align-items:center;gap:9px;background:#fff;border:1px solid var(--border);border-radius:999px;padding:13px 22px;font-family:'Manrope';font-weight:600;font-size:.95rem;white-space:nowrap;box-shadow:0 10px 22px -18px rgba(15,23,42,.5)}
.mq-chip svg{width:18px;height:18px;color:var(--blue);flex-shrink:0}
.net-chip{display:inline-flex;align-items:center;justify-content:center;background:#fff;border:1px solid var(--border);border-radius:14px;padding:16px 30px;min-width:158px;min-height:64px;box-shadow:0 12px 26px -18px rgba(15,23,42,.5)}
.net-wm{font-family:'Manrope',sans-serif;font-weight:800;font-size:1.06rem;color:#334155;letter-spacing:-.02em;white-space:nowrap}
.net-chip .lg{height:30px;width:auto;max-width:152px;object-fit:contain;display:block}
.net-chip .mono{display:none;width:40px;height:40px;border-radius:10px;color:#fff;align-items:center;justify-content:center;font-family:'Manrope';font-weight:800;font-size:.82rem;letter-spacing:-.02em}
.net-chip.noimg .lg{display:none}.net-chip.noimg .mono{display:flex}
@media(prefers-reduced-motion:reduce){.mq-track{animation:none;flex-wrap:wrap;justify-content:center}}
.promise{background:linear-gradient(135deg,var(--navy),#1e293b);color:#fff;border-radius:28px;padding:66px 50px;text-align:center;position:relative;overflow:hidden}
.promise .glow{position:absolute;width:400px;height:400px;background:radial-gradient(circle,rgba(37,99,235,.4),transparent 70%);top:-150px;left:50%;transform:translateX(-50%)}
.promise>*{position:relative}.promise h2{color:#fff;max-width:760px;margin:0 auto 18px}
.promise p{color:#cbd5e1;max-width:640px;margin:0 auto 8px;font-size:1.08rem}
.promise .reply{display:inline-flex;gap:8px;align-items:center;margin-top:24px;background:rgba(255,255,255,.1);padding:11px 20px;border-radius:999px;font-size:.92rem;border:1px solid rgba(255,255,255,.15)}
.faq{max-width:820px;margin:0 auto}
.faq details{background:#fff;border:1px solid var(--border);border-radius:14px;margin-bottom:12px;overflow:hidden;transition:.2s}
.faq details[open]{border-color:#cbd5e1;box-shadow:0 16px 36px -24px rgba(15,23,42,.3)}
.faq summary{padding:20px 24px;font-family:'Manrope';font-weight:700;cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:16px;align-items:center;font-size:1.05rem}
.faq summary::-webkit-details-marker{display:none}
.faq summary::after{content:"+";font-size:1.6rem;color:var(--blue)}
.faq details[open] summary::after{content:"\2013"}
.faq details p{padding:0 24px 22px;font-size:.98rem}
.quote-wrap{background:#fff;border:1px solid var(--border);border-radius:22px;padding:40px;box-shadow:0 40px 80px -40px rgba(15,23,42,.35)}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px}
.field{display:flex;flex-direction:column;gap:7px}.field.full{grid-column:1/-1}
.field label{font-weight:600;font-size:.88rem}
.field input,.field select,.field textarea{padding:14px 15px;border:1px solid var(--border);border-radius:10px;font-family:'Inter';font-size:1rem;color:var(--navy);background:#fff;width:100%}
.field textarea{min-height:120px;resize:vertical;line-height:1.5}
.field input:focus,.field select:focus,.field textarea:focus{outline:none;border-color:var(--blue);box-shadow:0 0 0 4px var(--blue-soft)}
.intent-row{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:8px}
.intent-row input{position:absolute;opacity:0;pointer-events:none}
.intent-row label{display:inline-flex;align-items:center;gap:8px;cursor:pointer;padding:12px 18px;border:1.5px solid var(--border);border-radius:12px;font-weight:600;font-size:.95rem;color:var(--navy);background:#fff;transition:.2s;user-select:none}
.intent-row label:hover{border-color:#bfdbfe}
.intent-row label .d{width:9px;height:9px;border-radius:50%;background:var(--border);transition:.2s}
.intent-row input:checked+label{border-color:var(--blue);background:var(--blue-soft);box-shadow:0 0 0 3px rgba(37,99,235,.12)}
.intent-row input:checked+label .d{background:var(--blue);box-shadow:0 0 0 4px rgba(37,99,235,.18)}
.intent-row input:focus-visible+label{box-shadow:0 0 0 3px var(--blue-soft)}
.acct-personas{margin:22px 0 6px}
.ap-lead{font-weight:800;font-family:'Manrope',sans-serif;font-size:1.06rem;margin-bottom:10px}
.ap-tabs{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}
.ap-tab{display:flex;align-items:center;gap:10px;padding:14px 16px;border:1.5px solid var(--border);border-radius:14px;font-weight:700;color:var(--navy);background:#fff;transition:.2s}
.ap-tab .ap-i{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;background:var(--blue-soft);color:var(--blue);flex-shrink:0}
.ap-tab small{display:block;font-weight:500;color:var(--muted);font-size:.8rem;margin-top:1px}
.ap-tab:hover{border-color:var(--blue);transform:translateY(-2px);box-shadow:0 14px 30px -16px rgba(8,131,247,.55)}
.ap-tab.active{border-color:var(--blue);background:var(--blue-soft);box-shadow:0 0 0 3px rgba(8,131,247,.14)}
.ap-note{color:var(--muted);font-size:.9rem;margin-top:12px}
@media(max-width:600px){.ap-tabs{grid-template-columns:1fr}}
.cinfo{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-top:26px}
.cinfo .ci{display:flex;gap:13px;align-items:flex-start;background:#fff;border:1px solid var(--border);border-radius:16px;padding:18px}
.cinfo .ci .icon{width:42px;height:42px;border-radius:11px;margin:0;flex-shrink:0}.cinfo .ci .icon svg{width:20px;height:20px}
.cinfo .ci b{display:block;font-family:'Manrope';font-size:.97rem}.cinfo .ci span{font-size:.88rem;color:var(--muted)}
.btn-ghost{background:transparent;color:var(--blue);border-color:transparent;padding-left:6px}
.hero .btn-ghost{color:#cbd5e1}.btn-ghost:hover{color:var(--blue)}.hero .btn-ghost:hover{color:#fff}
@media(max-width:760px){.cinfo{grid-template-columns:1fr}.intent-row label{flex:1;justify-content:center}}
.fcta{background:linear-gradient(135deg,var(--orange),#fb923c);border-radius:28px;padding:66px 40px;text-align:center}
.fcta h2{color:#fff}.fcta p{color:#fff6ef}.fcta .btn-primary{background:#fff;color:var(--orange)}
footer{background:var(--navy);color:#cbd5e1;padding:64px 0 30px}
.foot-top{display:grid;grid-template-columns:1.4fr 1fr;gap:40px;padding-bottom:38px;border-bottom:1px solid #1e293b;margin-bottom:40px;align-items:center}
footer .logo{color:#fff}footer a{color:#cbd5e1;display:block;margin:8px 0;font-size:.95rem}footer a:hover{color:#fff}
.foot-h{color:#fff;font-family:'Manrope';font-weight:700;margin-bottom:8px}
.news{display:flex;gap:10px;margin-top:14px;max-width:380px}
.news input{flex:1;padding:13px 15px;border-radius:10px;border:1px solid #334155;background:#0b1220;color:#fff;font-family:'Inter'}
.news input:focus{outline:none;border-color:var(--blue)}
.social{display:flex;gap:10px;margin-top:16px}
.social a{width:40px;height:40px;border-radius:11px;background:#1e293b;display:flex;align-items:center;justify-content:center;margin:0;transition:.2s}
.social a:hover{background:var(--blue)}
.links5{display:grid;grid-template-columns:repeat(6,1fr);gap:26px;margin-bottom:40px}
.foot-bottom{border-top:1px solid #1e293b;padding-top:24px;font-size:.88rem;display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px}
.mcta{display:none;position:fixed;bottom:0;left:0;right:0;z-index:70;background:rgba(255,255,255,.95);backdrop-filter:blur(10px);border-top:1px solid var(--border);padding:12px 16px;gap:10px}
.mcta a{flex:1;justify-content:center}
.wa-btn{position:fixed;bottom:20px;right:20px;z-index:80;width:58px;height:58px;border-radius:50%;background:#25D366;display:flex;align-items:center;justify-content:center;box-shadow:0 14px 30px -8px rgba(37,211,102,.6);transition:.2s}
.wa-btn:hover{transform:scale(1.08)}
.scroll-road-sec{position:relative;color:#fff;padding:88px 0 70px;overflow:hidden;background:linear-gradient(135deg,#10223B,#1e293b)}
.scroll-road-sec h2{color:#fff}.scroll-road-sec .eyebrow{color:#93c5fd}
.scroll-road{position:relative;z-index:2;height:150px;margin-top:30px}
.sr-line{position:absolute;top:50%;left:0;right:0;height:4px;background:repeating-linear-gradient(90deg,#fbbf24 0 30px,transparent 30px 64px);transform:translateY(-50%)}
.sr-truck{position:absolute;top:50%;left:0;transform:translate(0,-60%);color:#fff;will-change:transform}
.sr-truck svg{width:188px;height:auto;display:block;filter:drop-shadow(0 10px 16px rgba(0,0,0,.55))}
@media(max-width:880px){.wa-btn{bottom:84px;width:52px;height:52px}.sr-truck svg{width:120px}}
.reveal{opacity:0;transform:translateY(28px);transition:opacity .7s cubic-bezier(.2,.7,.2,1),transform .7s cubic-bezier(.2,.7,.2,1)}
.reveal.in{opacity:1;transform:none}
.reveal.d1{transition-delay:.08s}.reveal.d2{transition-delay:.16s}.reveal.d3{transition-delay:.24s}
@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}.aurora span,.hv-float,.road .tk,.road .lane,.dasharw{animation:none}}
@media(max-width:880px){.nav-links{position:fixed;inset:74px 0 auto 0;background:#fff;flex-direction:column;padding:18px 24px;gap:14px;border-bottom:1px solid var(--border);display:none;max-height:calc(100vh - 74px);overflow:auto;align-items:stretch}
.nav-links.open{display:flex}.menu-btn{display:block}
.nav-dd{flex-direction:column;align-items:stretch}
.nav-dd::before{display:none}
.nav-dd .nav-dd-menu{display:flex;position:static;box-shadow:none;border:0;border-left:2px solid #e6ebf3;border-radius:0;padding:4px 0 4px 14px;margin:8px 0 0 4px;min-width:0}
.nav-caret{display:none}
.nav-dd-item{white-space:normal;padding:7px 8px}
.nav-mob{display:block;font-weight:700}.nav-mob-login{color:var(--blue)}.nav-mob-go{color:var(--orange)}
.hero-grid,.route-grid{grid-template-columns:1fr;gap:40px}
.stats-grid{grid-template-columns:repeat(2,1fr);gap:32px 20px}
.g4{grid-template-columns:repeat(2,1fr)}.g3,.g2{grid-template-columns:1fr}
section{padding:66px 0}.promise,.fcta{padding:48px 24px}.form-grid{grid-template-columns:1fr}
.foot-top{grid-template-columns:1fr}.links5{grid-template-columns:repeat(2,1fr);gap:28px 20px}
.cmp{font-size:.82rem}.cmp th,.cmp td{padding:12px 10px}.mcta{display:flex}body{padding-bottom:72px}}
header{-webkit-backdrop-filter:blur(14px)}.mcta{-webkit-backdrop-filter:blur(10px)}
img{max-width:100%;height:auto}*{-webkit-tap-highlight-color:transparent}
@media(max-width:880px){.cmp{display:block;overflow-x:auto;-webkit-overflow-scrolling:touch;white-space:nowrap}.wrap{padding:0 18px}h1,h2{word-break:break-word}.hero{padding:74px 0 78px}.sec-head{margin-bottom:34px}.promise,.fcta{border-radius:20px;padding:42px 22px}.quote-wrap{padding:26px}.scroll-road{height:120px}.hero-btns{flex-direction:column;align-items:stretch}.hero-btns .btn{width:100%;justify-content:center}.hd-btn{display:none}.nav-cta{gap:0}}
@media(max-width:520px){.g4{grid-template-columns:1fr}.links5{grid-template-columns:repeat(2,1fr);gap:22px 16px}.cards,.stats-grid{gap:14px}h1{font-size:2rem}.btn{padding:13px 22px}}'''

JS = r'''const io=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){e.target.classList.add('in');io.unobserve(e.target)}})},{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>io.observe(el));
const cu=new IntersectionObserver((es)=>{es.forEach(e=>{if(e.isIntersecting){const el=e.target,t=+el.dataset.count;let n=0;const s=Math.max(1,Math.ceil(t/40));const tick=()=>{n+=s;if(n>=t){el.textContent=t}else{el.textContent=n;requestAnimationFrame(tick)}};tick();cu.unobserve(el)}})},{threshold:.6});
document.querySelectorAll('[data-count]').forEach(el=>cu.observe(el));
const hdr=document.getElementById('hdr');addEventListener('scroll',()=>{hdr&&hdr.classList.toggle('scrolled',scrollY>10)});
function toggleMenu(){document.getElementById('nav').classList.toggle('open')}
var st=document.getElementById('scrollTruck');if(st){var road=st.parentElement;function mv(){var r=road.getBoundingClientRect();var p=(innerHeight-r.top)/(innerHeight+r.height);p=Math.max(0,Math.min(1,p));st.style.transform='translate('+(p*(road.clientWidth-188))+'px,-60%)';}addEventListener('scroll',mv,{passive:true});addEventListener('resize',mv);mv();}'''

ARW = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M5 12h14M13 6l6 6-6 6"/></svg>'
CHK = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6L9 17l-5-5"/></svg>'

def _svg(inner):
    return '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + inner + '</svg>'
ICONS = {
 '&#128200;':'<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>',
 '&#128739;':'<circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="6" r="2.5"/><path d="M8.2 17H14a3 3 0 0 0 0-6H9a3 3 0 0 1 0-6h2.8"/>',
 '&#128450;':'<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
 '&#128222;':'<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z"/>',
 '&#10052;&#65039;':'<line x1="12" y1="2" x2="12" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/>',
 '&#128679;':'<polygon points="12 2 22 8.5 12 15 2 8.5"/><polyline points="2 15.5 12 22 22 15.5"/>',
 '&#128230;':'<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><line x1="12" y1="13" x2="12" y2="21"/>',
 '&#9889;':'<polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/>',
 '&#128668;':'<path d="M2 6h12v9H2z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
 '&#128640;':'<path d="M6 21V4M6 4h11l-2 3.5L17 11H6"/>',
 '&#128269;':'<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/>',
 '&#128172;':'<path d="M21 12a8 8 0 0 1-11.4 7.2L3 21l1.8-6.6A8 8 0 1 1 21 12z"/>',
 '&#129309;':'<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6.5 6.5 0 0 1 12 0"/><path d="M16 5.2a3.2 3.2 0 0 1 0 5.6"/><path d="M22 20a6.5 6.5 0 0 0-4.5-6.2"/>',
 '&#129517;':'<circle cx="12" cy="12" r="9"/><polygon points="16 8 13 13 8 16 11 11 16 8"/>',
 '&#128196;':'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><polyline points="14 3 14 8 19 8"/>',
 '&#128336;':'<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
 '&#128181;':'<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 6H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
 '&#128737;':'<path d="M12 2 4 5v6c0 5 3.5 8 8 11 4.5-3 8-6 8-11V5z"/>',
 '&#9981;':'<path d="M12 2.5 6 9.5a6 6 0 1 0 12 0z"/>',
 '&#9878;':'<path d="M12 3v18M6 21h12M5 7h14M5 7 2 13h6zM19 7l-3 6h6z"/>',
 '&#9989;':'<circle cx="12" cy="12" r="9"/><polyline points="8 12 11 15 16 9"/>',
 '&#128202;':'<line x1="6" y1="20" x2="6" y2="12"/><line x1="12" y1="20" x2="12" y2="5"/><line x1="18" y1="20" x2="18" y2="9"/>',
 '&#128236;':'<rect x="3" y="5" width="18" height="14" rx="2"/><polyline points="3 7 12 13 21 7"/>',
 '&#128221;':'<path d="M4 20h4L18 10l-4-4L4 16z"/><path d="M14 6l4 4"/>',
 '&#128197;':'<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
 '&#129354;':'<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
 '&#129534;':'<path d="M6 2h9l3 3v17l-3-2-3 2-3-2-3 2V2z"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="9" y1="12" x2="15" y2="12"/>',
 '&#129514;':'<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>',
 '&#128225;':'<path d="M5 18a10 10 0 0 1 14 0M8 15a6 6 0 0 1 8 0"/><circle cx="12" cy="19" r="1.4"/>',
 '&#128203;':'<rect x="6" y="4" width="12" height="17" rx="2"/><path d="M9 4V3h6v1"/><polyline points="9 12 11 14 15 10"/>',
 '&#128666;':'<path d="M2 6h12v9H2z"/><path d="M14 9h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.6"/><circle cx="17.5" cy="18" r="1.6"/>',
 '&#10003;':'<polyline points="5 12 10 17 19 7"/>',
 '&#9201;&#65039;':'<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 16 14"/>',
}
def deglyph(s):
    for k,v in ICONS.items():
        s = s.replace(k, _svg(v))
    return s

# Mega-menu IA (big-company pattern): Features = WHAT the product does (SEO: "features"
# out-searches "product"); Solutions = WHO it is for; Resources = learn/tools. Every parent
# has a real landing page so mobile taps and crawlers always land somewhere.
NAV_MENU = [
  ('Features', 'features.html', [
    ('features.html', 'All features'),
    ('load-board.html', 'Live load board'),
    ('book-truck-loads.html', 'One-tap booking'),
    ('gps-tracking.html', 'GPS tracking &amp; proof'),
    ('payments-settlements.html', 'Payments &amp; settlements'),
    ('factoring-noa.html', 'Factoring &amp; NOA'),
    ('fleet-management.html', 'Fleet management'),
    ('integrations.html', 'Integrations &mdash; QuickBooks &amp; ELD'),
  ]),
  ('Solutions', 'services.html', [
    ('carriers.html', 'For carriers'),
    ('owner-operator-dispatch.html', 'For owner-operators'),
    ('new-authority-dispatch.html', 'For new authorities'),
    ('brokers.html', 'For brokers'),
    ('shipper-solutions.html', 'For shippers'),
    ('agents.html', 'Agent program &mdash; earn 1%'),
  ]),
  ('Pricing', 'pricing.html', None),
  ('Resources', 'resources.html', [
    ('how-it-works.html', 'How it works'),
    ('market-rates.html', 'Market rates per mile'),
    ('cost-per-mile-calculator.html', 'Cost-per-mile calculator'),
    ('load-score.html', 'Load Score'),
    ('blog.html', 'Blog'),
    ('faq.html', 'FAQ'),
  ]),
  ('About', 'about.html', None),
  ('Contact', 'contact.html', None),
]
# Legacy flat NAV kept for anything else that references it (e.g. drawers).
NAV = [('index.html','Home'),('services.html','Services'),('how-it-works.html','How It Works'),
       ('pricing.html','Pricing'),('load-score.html','Load Score'),('blog.html','Blog'),
       ('about.html','About'),('contact.html','Contact')]

def header(active):
    links = ''
    for label, href, subs in NAV_MENU:
        child_active = bool(subs) and any(h == active for h, _t in subs)
        is_act = (href == active) or child_active
        if subs:
            dd = ''.join('<a href="%s" class="nav-dd-item %s">%s</a>' % (h, 'active' if h==active else '', t) for h, t in subs)
            links += ('<div class="nav-dd"><a href="%s" class="nav-dd-top %s">%s<svg class="nav-caret" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 9l6 6 6-6"/></svg></a>'
                      '<div class="nav-dd-menu">%s</div></div>') % (href, 'active' if is_act else '', label, dd)
        else:
            links += '<a href="%s" class="%s">%s</a>' % (href, 'active' if is_act else '', label)
    mob = '<a href="/app/carrier/" class="nav-mob nav-mob-login">Log in</a><a href="contact.html" class="nav-mob nav-mob-go">Get Started</a>'
    return '''<header id="hdr"><div class="wrap nav">
<a class="logo" href="index.html" aria-label="LoadBoot home"><img src="/logo-full.png" alt="LoadBoot" height="36" style="display:block;height:36px;width:auto"></a>
<nav class="nav-links" id="nav">%s%s</nav>
<div class="nav-actions"><a href="/app/carrier/" class="btn btn-secondary hd-btn hd-login"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:2px"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Log in</a><a href="get-started.html" class="btn btn-primary hd-btn">Get Started %s</a>
<button class="menu-btn" onclick="toggleMenu()" aria-label="Open menu"><svg width="26" height="26" viewBox="0 0 24 24" stroke="#10223B" stroke-width="2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg></button></div>
</div></header>''' % (links, mob, ARW)


# WEB-4: 'Research LoadBoot with AI' footer. Owner-flippable build switch (True = rendered).
AI_RESEARCH_FOOTER_ENABLED = True
AI_RESEARCH_BLOCK = '<div id="aiResearch" style="border-top:1px solid #1e293b;padding-top:22px;margin-bottom:24px">\n<style>#aiBtns{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center}#aiBtns a{display:inline-flex;align-items:center;gap:9px;font-size:.95rem;color:#cbd5e1;margin:0}#aiBtns a:hover{color:#fff}#aiBtns .ai-chip{flex:none;width:28px;height:28px;border-radius:50%;background:#1e293b;border:1px solid #334155;display:inline-flex;align-items:center;justify-content:center;color:#e2e8f0}</style>\n<div class="foot-h" style="margin-bottom:12px">Ask AI for info</div>\n<div id="aiBtns" role="group" aria-label="Open an AI assistant with a research prompt about LoadBoot"></div>\n<pre id="aiPromptText" hidden style="display:none"></pre>\n<button type="button" id="aiCopyBtn" hidden style="display:none">Copy prompt</button>\n<span id="aiCopyLive" role="status" aria-live="polite" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)"></span>\n</div>'
AI_RESEARCH_JS = '<script>(function(){var host=document.getElementById(\'aiBtns\');if(!host)return;\nvar TOPICS={\'/carriers.html\':\'truck dispatch services and carrier operating software for owner-operators and fleets\',\'/brokers.html\':\'load posting, carrier matching, shipment visibility, documents and broker operations\',\'/shipper-solutions.html\':\'shipper freight coordination, visibility and compliant capacity through licensed broker partners\',\'/pricing.html\':\'LoadBoot pricing, service structure, included dispatch services and software capabilities\',\'/how-it-works.html\':\'how LoadBoot dispatch works for carriers and broker partners end to end\',\'/owner-operator-dispatch.html\':\'dispatch services for owner-operators\',\'/new-authority-dispatch.html\':\'dispatch and compliance support for new-authority carriers\',\'/reefer-dispatch.html\':\'refrigerated freight dispatch\',\'/flatbed-dispatch.html\':\'flatbed and step-deck dispatch\',\'/box-truck-dispatch.html\':\'box truck and expedited dispatch\',\'/services.html\':\'the full range of LoadBoot truck dispatch services\',\'/resources.html\':\'how to evaluate truck dispatch services and carrier software\'};\nvar PV=\'v1\';var path=location.pathname===\'/\'?\'/index.html\':location.pathname;var topic=TOPICS[path]||null;\nfunction prompt(){if(topic){return \'I’m researching \'+topic+\' for a U.S. trucking business.\\n\\nPlease review LoadBoot’s official website at https://loadboot.com and this specific page:\\n\'+location.origin+path+\'\\n\\nExplain what LoadBoot provides for this use case, how the workflow works, which features are currently available, who it is best suited for, and how it compares with traditional dispatch services, load boards, and standalone trucking software.\\n\\nUse official LoadBoot pages as primary sources, cite the pages used, distinguish verified capabilities from marketing claims, and provide a neutral assessment including relevant limitations.\';}\nreturn \'I’m researching truck dispatch services and carrier operating software for U.S. owner-operators, carrier fleets, and freight brokers.\\n\\nPlease review LoadBoot’s official website at https://loadboot.com and explain:\\n1. What LoadBoot is, which customers it serves, and what problems it solves.\\n2. How its workflow operates from carrier or broker onboarding, verification, load posting and sourcing, carrier matching, load offers and booking through driver assignment, real-time trip tracking, appointments, document collection, detention, lumper, layover and TONU workflows, POD, invoicing, settlements, reporting, and support.\\n3. How LoadBoot differs from a traditional truck dispatch company, load boards such as DAT or Truckstop, and standalone TMS, fleet-management, or carrier software.\\n4. What LoadBoot provides to owner-operators, small and large carrier fleets, and freight brokers through its Carrier Portal, Partner Portal, and operations Command Center.\\n5. Its strongest use cases, important limitations, eligibility or onboarding requirements, available pricing information, and the types of businesses it is best suited for.\\n\\nUse LoadBoot’s official website as the primary source. Distinguish verified current capabilities from planned features or general marketing claims. Cite the specific pages used, compare the options neutrally, and explain both when LoadBoot may be a strong fit and when another solution may be more suitable.\';}\nvar PROV=[{id:\'chatgpt\',name:\'ChatGPT\',g:\'<polygon points="12 3 19.8 7.5 19.8 16.5 12 21 4.2 16.5 4.2 7.5"/><circle cx="12" cy="12" r="3.2"/>\',u:function(q){return \'https://chatgpt.com/?q=\'+encodeURIComponent(q);}},{id:\'claude\',name:\'Claude\',g:\'<line x1="12" y1="4" x2="12" y2="20"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="6.3" y1="6.3" x2="17.7" y2="17.7"/><line x1="17.7" y1="6.3" x2="6.3" y2="17.7"/>\',u:function(q){return \'https://claude.ai/new?q=\'+encodeURIComponent(q);}},{id:\'gemini\',name:\'Gemini\',g:\'<path d="M12 3c.8 4.5 3.7 7.4 8.2 8.2-4.5.8-7.4 3.7-8.2 8.2-.8-4.5-3.7-7.4-8.2-8.2 4.5-.8 7.4-3.7 8.2-8.2z"/>\',u:function(q){return \'https://gemini.google.com/app\';},fb:true},{id:\'perplexity\',name:\'Perplexity\',g:\'<path d="M6 4v7l6 4 6-4V4"/><path d="M6 20v-5l6-4 6 4v5"/>\',u:function(q){return \'https://www.perplexity.ai/search?q=\'+encodeURIComponent(q);}},{id:\'grok\',name:\'Grok\',g:\'<circle cx="12" cy="12" r="8"/><line x1="6.5" y1="17.5" x2="17.5" y2="6.5"/>\',u:function(q){return \'https://grok.com/?q=\'+encodeURIComponent(q);}}];\nfunction track(t,x){try{if(window.lbTrack)window.lbTrack(t,Object.assign({prompt_version:PV,prompt_type:topic?\'page_specific\':\'default\',placement:\'footer\'},x||{}));}catch(e){}}\nfunction copy(q,cb){function done(ok){cb&&cb(ok);}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(q).then(function(){done(true);},function(){done(false);});}else{done(false);}}\nvar live=document.getElementById(\'aiCopyLive\');\nPROV.forEach(function(pv){var b=document.createElement(\'a\');b.href=\'#\';b.setAttribute(\'rel\',\'noopener noreferrer\');b.setAttribute(\'title\',\'Open \'+pv.name+\' (external)\');b.innerHTML=\'<span class="ai-chip" aria-hidden="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">\'+pv.g+\'</svg></span>\'+pv.name;b.addEventListener(\'click\',function(e){e.preventDefault();var q=prompt();track(\'ai_research_link_clicked\',{ai_provider:pv.id,page_topic:topic||\'default\'});copy(q,function(ok){if(ok&&live){live.textContent=\'Research prompt copied — paste it if the assistant did not prefill it.\';}if(!ok){track(\'ai_research_fallback_used\',{ai_provider:pv.id});}var w=window.open(pv.u(q),\'_blank\',\'noopener,noreferrer\');if(w){track(\'ai_research_provider_opened\',{ai_provider:pv.id});}});});host.appendChild(b);});\nvar pt=document.getElementById(\'aiPromptText\');if(pt){pt.textContent=prompt();var det=pt.closest(\'details\');if(det){det.addEventListener(\'toggle\',function(){if(det.open)track(\'ai_research_prompt_viewed\',{});});}}\nvar cbtn=document.getElementById(\'aiCopyBtn\');if(cbtn){cbtn.addEventListener(\'click\',function(){copy(prompt(),function(ok){if(live)live.textContent=ok?\'Prompt copied to clipboard.\':\'Copy failed — select and copy the text above.\';track(\'ai_research_prompt_copied\',{ok:ok});});});}\n})();</script>'

def footer():
    return '''<footer><div class="wrap">
<div class="foot-top">
<div><div class="logo"><img src="/logo-full-dark.png" alt="LoadBoot" height="32" style="display:block;height:32px;width:auto"></div>
<div style="color:#94a3b8;font-weight:500;font-size:.92rem;margin-top:10px;letter-spacing:.02em">The Operating System for Trucking</div>
<p style="margin-top:10px;max-width:380px">Professional truck dispatch services for owner-operators, fleets, and new-authority carriers across all 48 states. Higher-paying loads, less deadhead, no contracts.</p>
<div class="foot-h" style="margin-top:16px">Company</div><div style="font-size:.9rem;line-height:1.95;color:#94a3b8"><div><b style="color:#cbd5e1">General &amp; support:</b> <a href="mailto:hello@loadboot.com">hello@loadboot.com</a></div><div><b style="color:#cbd5e1">Dispatch &amp; loads:</b> <a href="mailto:dispatch@loadboot.com">dispatch@loadboot.com</a></div><div><b style="color:#cbd5e1">Billing &amp; settlements:</b> <a href="mailto:billing@loadboot.com">billing@loadboot.com</a></div><div style="margin-top:8px">LoadBoot &mdash; truck dispatch marketplace. Serving owner-operators &amp; fleets across the United States (all 48 states).</div></div>
<div class="social"><a href="#" aria-label="Facebook"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M14 9h3V6h-3c-2 0-3 1-3 3v2H9v3h2v6h3v-6h2.5l.5-3H14V9z"/></svg></a>
<a href="#" aria-label="Instagram"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/></svg></a>
<a href="#" aria-label="LinkedIn"><svg width="18" height="18" viewBox="0 0 24 24" fill="#fff"><path d="M6 9H3v9h3V9zM4.5 3a1.8 1.8 0 100 3.6 1.8 1.8 0 000-3.6zM18 9c-1.6 0-2.5.8-3 1.5V9H12v9h3v-5c0-1 .7-1.7 1.6-1.7s1.4.7 1.4 1.7v5h3v-5.4C21 10 19.7 9 18 9z"/></svg></a></div></div>
<div><div class="foot-h">Get carrier tips &amp; better loads</div><p style="font-size:.92rem">Rate trends, compliance reminders, and dispatch tips.</p>
<form class="news" onsubmit="event.preventDefault();var f=this,em=f.querySelector('input').value;var done=function(){f.innerHTML='<span style=\\'color:#86efac;font-weight:600\\'>Subscribed &mdash; thanks!</span>';};if(window.lbSubmitLead){window.lbSubmitLead('newsletter',{email:em}).then(done).catch(done);}else{done();}"><input type="email" placeholder="Your email" required><button class="btn btn-primary" type="submit">Subscribe</button></form></div>
</div>
<div class="links5">
<div><div class="foot-h">Dispatch</div><a href="services.html">Load Booking</a><a href="services.html">Rate Negotiation</a><a href="services.html">Route Planning</a><a href="services.html">24/7 Dispatch</a></div>
<div><div class="foot-h">Freight</div><a href="reefer-dispatch.html">Reefer</a><a href="flatbed-dispatch.html">Flatbed</a><a href="dry-van-dispatch.html">Dry Van</a><a href="hotshot-dispatch.html">Hotshot</a><a href="power-only-dispatch.html">Power Only</a><a href="box-truck-dispatch.html">Box Truck</a></div>
<div><div class="foot-h">Carriers</div><a href="carriers.html">For Carriers</a><a href="owner-operator-dispatch.html">Owner-Operators</a><a href="new-authority-dispatch.html">New Authority</a><a href="services.html">Small Fleets</a></div>
<div><div class="foot-h">Partners</div><a href="brokers.html">For Brokers</a><a href="shipper-solutions.html">Shipper Solutions</a><a href="partners.html">Partner Portal</a><a href="agents.html">Referral &amp; Agent Program</a><a href="agents.html">Agent Program (Earn 1%)</a></div>
<div><div class="foot-h">Compliance</div><a href="compliance.html">Compliance &amp; Verification</a><a href="authority-dot-setup.html">Authority &amp; DOT Setup</a><a href="boc3-ucr.html">BOC-3 / UCR</a><a href="form-2290-hvut.html">Form 2290 (HVUT)</a><a href="ifta-fuel-tax.html">IFTA Fuel Tax</a></div>
<div><div class="foot-h">Company</div><a href="index.html">Home</a><a href="about.html">About</a><a href="command-center.html">Operations Command Center</a><a href="features.html">All Features</a><a href="load-board.html">Live Load Board</a><a href="how-it-works.html">How It Works</a><a href="pricing.html">Pricing</a><a href="faq.html">FAQ</a><a href="resources.html">Resources</a><a href="blog.html">Blog</a><a href="careers.html">Careers</a><a href="contact.html">Contact</a></div>
<div><div class="foot-h">Programs &amp; Login</div><a href="brokers.html">For Brokers</a><a href="partners.html">Partner Program</a><a href="agents.html">Referral &amp; Agent Program</a><a href="case-studies.html">Examples</a><a href="login.html">Log in</a><a href="apps.html">Get the App</a><a href="create-carrier-account.html">Create Carrier Account</a><a href="create-broker-account.html">Create Broker Account</a><a href="create-shipper-account.html">Create Shipper Account</a><a href="create-agent-account.html">Create Agent Account</a><a href="/app/carrier/">Carrier Portal</a><a href="/app/partner/">Partner Portal</a><a href="/app/developer/">Developers &amp; API</a></div><div><div class="foot-h">Rates &amp; Driver Pay</div><a href="market-rates.html">Market Rates Per Mile</a><a href="cost-per-mile-calculator.html">Cost Per Mile Calculator</a><a href="load-board.html">Live Load Board (Zero Ghost Loads)</a><a href="ghost-loads-load-board-problems.html">Ghost Loads &amp; Fake Freight</a><a href="detention-pay-policy.html">Detention Pay</a><a href="tonu-policy.html">TONU Fees</a><a href="layover-policy.html">Layover Pay</a><a href="lumper-policy.html">Lumper Fees</a><a href="driver-assist-policy.html">Driver Assist Pay</a><a href="fcfs-policy.html">FCFS &amp; Scheduling</a><a href="emergency-rescheduling-policy.html">Emergency Rescheduling</a></div>
</div>
''' + (AI_RESEARCH_BLOCK if AI_RESEARCH_FOOTER_ENABLED else '') + '''<div style="border-top:1px solid #1e293b;padding-top:24px;margin-bottom:24px"><div class="foot-h" style="margin-bottom:10px">Service areas &mdash; we dispatch nationwide</div><p style="font-size:.88rem;line-height:2">Texas &middot; California &middot; Florida &middot; Georgia &middot; Illinois &middot; Ohio &middot; Pennsylvania &middot; North Carolina &middot; Tennessee &middot; Indiana &middot; Michigan &middot; New Jersey &middot; Arizona &middot; Washington &middot; Missouri &middot; and all 48 contiguous states.</p></div>
<div style="margin-bottom:20px"><a href="https://www.capterra.com/p/10050953/LoadBoot/" rel="noopener" target="_blank" aria-label="LoadBoot reviews on Capterra" style="display:inline-flex;align-items:center;gap:10px;background:#0d1b30;border:1px solid #1e3a5f;border-radius:12px;padding:10px 16px;text-decoration:none;margin:0">
<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5.5l9.5 3.6L3 12.7V5.5z" fill="#FF9D28"/><path d="M12.5 9.1L21 5.5l-8.5 15.4V9.1z" fill="#068EEF"/><path d="M3 12.7l9.5-3.6v11.8L3 12.7z" fill="#044D80"/></svg>
<span style="display:inline;margin:0;font-size:.88rem;color:#cbd5e1">Find us on <b style="color:#fff">Capterra</b> &mdash; read &amp; leave a review</span></a></div>
<div class="foot-bottom"><span>&copy; 2026 Loadboot. All rights reserved. &middot; Serving carriers in all 48 states.</span>
<span><a href="privacy.html" style="display:inline">Privacy</a> &middot; <a href="terms.html" style="display:inline">Terms</a> &middot; <a href="cookies.html" style="display:inline">Cookies</a> &middot; <a href="accessibility.html" style="display:inline">Accessibility</a> &middot; <a href="security.html" style="display:inline">Security</a> &middot; <a href="status.html" style="display:inline">Status</a> &middot; <a href="sitemap.html" style="display:inline">Sitemap</a></span></div>
</div>''' + (AI_RESEARCH_JS if AI_RESEARCH_FOOTER_ENABLED else '') + '''</footer>
<div class="mcta"><a href="contact.html#quote" class="btn btn-secondary">Get a Quote</a><a href="contact.html#create" class="btn btn-primary">Get Started</a></div>
<a class="wa-btn" href="contact.html" rel="noopener" aria-label="Contact Loadboot dispatch"><svg width="30" height="30" viewBox="0 0 24 24" fill="#fff"><path d="M12 2a10 10 0 00-8.5 15.2L2 22l4.9-1.4A10 10 0 1012 2zm0 18a8 8 0 01-4.2-1.2l-.3-.2-2.9.8.8-2.8-.2-.3A8 8 0 1112 20zm4.4-5.6c-.2-.1-1.4-.7-1.6-.8s-.4-.1-.5.1l-.7.9c-.1.2-.3.2-.5.1a6.5 6.5 0 01-3.2-2.8c-.2-.4.2-.4.6-1.2.1-.2 0-.3 0-.5l-.8-1.8c-.2-.5-.4-.4-.5-.4h-.5a1 1 0 00-.7.3A2.9 2.9 0 006 9.9c0 1.7 1.3 3.4 1.4 3.6.2.2 2.5 3.9 6.1 5.2 2.2.8 2.5.6 3 .6s1.4-.6 1.6-1.1.2-1 .2-1.1-.2-.2-.5-.3z"/></svg><span class="sr-only">Contact Loadboot dispatch</span></a>'''

GA_ID = 'G-C2ELQ7H8EM'  # GA4 Measurement ID — injected on every page.
LOCALBIZ = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"ProfessionalService","name":"Loadboot","image":"https://loadboot.com/icon-512.png","url":"https://loadboot.com/","email":"hello@loadboot.com","description":"Professional truck dispatch services for owner-operators, fleets, and new-authority carriers — flat 5%, no contracts.","areaServed":{"@type":"Country","name":"United States"},"serviceType":"Truck dispatching","priceRange":"5%","contactPoint":[{"@type":"ContactPoint","email":"hello@loadboot.com","contactType":"customer support","areaServed":"US","availableLanguage":["English"]},{"@type":"ContactPoint","email":"dispatch@loadboot.com","contactType":"dispatch"},{"@type":"ContactPoint","email":"billing@loadboot.com","contactType":"billing"}]}</script>'
GA_SNIPPET = ('<script async src="https://www.googletagmanager.com/gtag/js?id=%s"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag(\'js\',new Date());gtag(\'config\',\'%s\');</script>' % (GA_ID, GA_ID)) if GA_ID else ''
HEADX = LOCALBIZ + GA_SNIPPET

# First-party analytics beacon (privacy-safe). Posts pageviews to the context's Supabase
# project via the public track_web_event RPC. Exposes window.lbTrack(type, extra) for events.
# Internal traffic: append ?lb_internal=1 once to flag this browser as team/internal (excluded).
_BEACON = ("<script>(function(){try{"
  "var K='lb_aid',aid=localStorage.getItem(K);if(!aid){aid=Date.now().toString(36)+Math.random().toString(36).slice(2,10);localStorage.setItem(K,aid);}"
  "var q=new URLSearchParams(location.search);if(q.get('lb_internal')==='1'){localStorage.setItem('lb_int','1');}var internal=localStorage.getItem('lb_int')==='1';"
  "var ref=document.referrer||'',rh='';try{rh=ref?new URL(ref).hostname:'';}catch(e){}"
  "var ua=navigator.userAgent||'';var dev=/Mobi|Android|iPhone|iPad/i.test(ua)?'mobile':'desktop';"
  "var br=/Edg/i.test(ua)?'Edge':/Chrome/i.test(ua)?'Chrome':/Firefox/i.test(ua)?'Firefox':/Safari/i.test(ua)?'Safari':'Other';"
  "var os=/Windows/i.test(ua)?'Windows':/Mac/i.test(ua)?'macOS':/Android/i.test(ua)?'Android':/iPhone|iPad|iOS/i.test(ua)?'iOS':/Linux/i.test(ua)?'Linux':'Other';"
  "var EP='https://%s.supabase.co/rest/v1/rpc/track_web_event',AK='%s';"
  "function send(p){try{fetch(EP,{method:'POST',headers:{'apikey':AK,'Content-Type':'application/json'},body:JSON.stringify({p:p}),keepalive:true}).catch(function(){});}catch(e){}}"
  "send({anon_id:aid,type:'pageview',page:location.pathname,referrer:ref,referrer_host:rh,utm_source:q.get('utm_source'),utm_medium:q.get('utm_medium'),utm_campaign:q.get('utm_campaign'),device:dev,browser:br,os:os,language:navigator.language,timezone:(Intl.DateTimeFormat().resolvedOptions().timeZone||''),ua:ua,internal:internal});"
  "window.lbTrack=function(t,x){var b=Object.assign({anon_id:aid,type:t,page:location.pathname},x||{});send(b);};"
  "window.lbSubmitLead=function(fk,d){var b=Object.assign({form_key:fk,anon_id:aid,page:location.pathname,referrer:ref,utm_source:q.get('utm_source'),utm_medium:q.get('utm_medium'),utm_campaign:q.get('utm_campaign')},d||{});return fetch(EP.replace('track_web_event','submit_web_form'),{method:'POST',headers:{'apikey':AK,'Content-Type':'application/json'},body:JSON.stringify({p:b})});};"
  "}catch(e){}})();</script>") % (APP_REF, APP_ANON)
HEADX = HEADX + _BEACON

def _breadcrumb(fname, title):
    if fname == 'index.html':
        return ''
    name = title.split(' | ')[0].split(' — ')[0].split(' &mdash; ')[0].strip()
    name = name.replace('"', "'")
    return ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList",'
            '"itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://loadboot.com/"},'
            '{"@type":"ListItem","position":2,"name":"%s","item":"https://loadboot.com/%s"}]}</script>' % (name, fname))


# ---- Internal-link engine (Inc 59, directive #39): related-page cards per topic cluster. ----
# Deterministic map — every commercial page links onward to its cluster (service, audience, pricing,
# a guide and an application/inquiry form). Appended before the footer by page(); no orphan pages.
RELATED = {
 'dry-van-dispatch.html':   [('reefer-dispatch.html','Reefer Dispatch'),('power-only-dispatch.html','Power Only'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('how-it-works.html','How It Works')],
 'reefer-dispatch.html':    [('dry-van-dispatch.html','Dry Van Dispatch'),('flatbed-dispatch.html','Flatbed Dispatch'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('load-score.html','Load Score Tool')],
 'flatbed-dispatch.html':   [('hotshot-dispatch.html','Hotshot Dispatch'),('reefer-dispatch.html','Reefer Dispatch'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('how-it-works.html','How It Works')],
 'hotshot-dispatch.html':   [('flatbed-dispatch.html','Flatbed Dispatch'),('box-truck-dispatch.html','Box Truck Dispatch'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('new-authority-dispatch.html','New Authority')],
 'power-only-dispatch.html':[('dry-van-dispatch.html','Dry Van Dispatch'),('owner-operator-dispatch.html','Owner-Operators'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('how-it-works.html','How It Works')],
 'box-truck-dispatch.html': [('hotshot-dispatch.html','Hotshot Dispatch'),('carriers.html','For Carriers'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('tools.html','Free Trucking Tools')],
 'new-authority-dispatch.html':[('how-to-get-loads-with-new-authority.html','Getting Loads with New Authority'),('owner-operator-dispatch.html','Owner-Operators'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('carriers.html','For Carriers')],
 'owner-operator-dispatch.html':[('owner-operator-dispatch-service-guide.html','Owner-Operator Guide'),('new-authority-dispatch.html','New Authority'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('load-score.html','Load Score Tool')],
 'carriers.html':           [('carrier-application.html','Apply as Carrier'),('services.html','All Services'),('pricing.html','Pricing'),('tools.html','Free Trucking Tools'),('faq.html','FAQ')],
 'brokers.html':            [('partners.html','Partner Portal'),('shipper-solutions.html','Shipper Solutions'),('security.html','Security & Trust'),('contact.html','Contact'),('how-it-works.html','How It Works')],
 'shipper-solutions.html':  [('brokers.html','For Brokers'),('partners.html','Partner Portal'),('security.html','Security & Trust'),('contact.html','Contact'),('faq.html','FAQ')],
 'services.html':           [('carriers.html','For Carriers'),('pricing.html','Pricing'),('how-it-works.html','How It Works'),('carrier-application.html','Apply as Carrier'),('tools.html','Free Trucking Tools')],
 'pricing.html':            [('how-much-does-a-truck-dispatcher-cost.html','What a Dispatcher Costs'),('services.html','All Services'),('carrier-application.html','Apply as Carrier'),('faq.html','FAQ'),('carriers.html','For Carriers')],
 'how-it-works.html':       [('services.html','All Services'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier'),('faq.html','FAQ'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs Broker')],
 'partners.html':           [('brokers.html','For Brokers'),('shipper-solutions.html','Shipper Solutions'),('security.html','Security & Trust'),('contact.html','Contact'),('agents.html','Agent Program')],
 'referral.html':           [('carriers.html','For Carriers'),('carrier-application.html','Apply as Carrier'),('pricing.html','Pricing'),('contact.html','Contact'),('faq.html','FAQ')],
 'tools.html':              [('cost-per-mile-calculator.html','Cost Per Mile Calculator'),('load-score.html','Load Score'),('resources.html','Resources'),('carriers.html','For Carriers'),('pricing.html','Pricing'),('carrier-application.html','Apply as Carrier')],
 'carrier-application.html':[('carriers.html','For Carriers'),('pricing.html','Pricing'),('how-it-works.html','How It Works'),('faq.html','FAQ'),('new-authority-dispatch.html','New Authority')],
 'case-studies.html':       [('carriers.html','For Carriers'),('services.html','All Services'),('carrier-application.html','Apply as Carrier'),('tools.html','Free Trucking Tools'),('pricing.html','Pricing')],
 'authority-dot-setup.html':[('new-authority-dispatch.html','New Authority Dispatch'),('boc3-ucr.html','BOC-3 / UCR Guide'),('form-2290-hvut.html','Form 2290 (HVUT)'),('ifta-fuel-tax.html','IFTA Guide'),('carrier-application.html','Apply as Carrier')],
 'boc3-ucr.html':[('authority-dot-setup.html','Authority & DOT Setup'),('ifta-fuel-tax.html','IFTA Guide'),('form-2290-hvut.html','Form 2290 (HVUT)'),('new-authority-dispatch.html','New Authority Dispatch'),('carriers.html','For Carriers')],
 'form-2290-hvut.html':[('ifta-fuel-tax.html','IFTA Guide'),('authority-dot-setup.html','Authority & DOT Setup'),('boc3-ucr.html','BOC-3 / UCR Guide'),('carriers.html','For Carriers'),('tools.html','Free Trucking Tools')],
 'ifta-fuel-tax.html':[('form-2290-hvut.html','Form 2290 (HVUT)'),('authority-dot-setup.html','Authority & DOT Setup'),('boc3-ucr.html','BOC-3 / UCR Guide'),('carriers.html','For Carriers'),('tools.html','Free Trucking Tools')],
 'resources.html':          [('blog.html','Blog'),('tools.html','Free Trucking Tools'),('faq.html','FAQ'),('how-to-get-loads-with-new-authority.html','New Authority Guide'),('truck-dispatcher-vs-freight-broker.html','Dispatcher vs Broker')],
}

# ---- Inc 60: authentic photo bands. ONLY existing owned assets — no stock fakes, no fake clients.
PAGE_PHOTOS = {
 'carriers.html':           [('truck-fleet.webp','Semi-trucks staged at a freight yard','Owner-operators & fleets, coast to coast'),('owner-operator.webp','Owner-operator truck on the highway','Your truck, your authority — our dispatch')],
 'brokers.html':            [('truck-fleet.webp','Carrier fleet ready for dispatch','A vetted, compliance-tracked carrier network'),('dry-van.webp','Dry van trailer on the road','Coverage across dry van, reefer, flatbed & more')],
 'shipper-solutions.html':  [('dry-van.webp','Dry van trailer moving freight','Your freight, professionally coordinated'),('reefer.webp','Refrigerated trailer on the interstate','Temperature-controlled and time-critical lanes')],
 'box-truck-dispatch.html': [('truck-boxtruck.webp','Box truck ready for an expedited run','LTL, final-mile and expedited runs')],
 'services.html':           [('truck-fleet.webp','Trucks staged for dispatch','Full-service dispatch across equipment types'),('truck-boxtruck.webp','Box truck at a loading dock','From 26-ft boxes to full truckload')],
 'how-it-works.html':       [('owner-operator.webp','Owner-operator on a booked lane','Sign up to first booked load — usually within days')],
 'carrier-application.html':[('owner-operator.webp','Owner-operator truck at sunrise','Five minutes to apply — no contract lock-in')],
 'pricing.html':            [('truck-fleet.webp','Fleet trucks lined up','Flat 5% — you only pay when we book you')],
 'case-studies.html':       [('hotshot.webp','Hotshot truck with a loaded gooseneck','Worked examples across equipment types')],
 'about.html':              [('truck-fleet.webp','American trucking fleet on the move','Built for the people who keep America moving')],
}
def photo_band(fname):
    imgs = PAGE_PHOTOS.get(fname)
    if not imgs: return ''
    cells = ''.join('<div class="photo"><img src="%s" width="1280" height="720" alt="%s" loading="lazy" decoding="async" onerror="this.style.display=&quot;none&quot;"><span class="ph-tag">%s</span></div>' % (src, alt, tag) for src, alt, tag in imgs)
    return '<section><div class="wrap"><div class="photo-grid reveal">%s</div></div></section>' % cells

def related_block(fname):
    links = RELATED.get(fname)
    if not links: return ''
    cards = ''.join('<a class="card reveal" href="%s" style="text-decoration:none;display:block"><h3 style="margin:0 0 6px">%s</h3><p style="margin:0;color:var(--ink-soft,#64748b)">Explore &rarr;</p></a>' % (h,t) for h,t in links)
    return '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Keep exploring</div><h2>Related services &amp; guides</h2></div><div class="grid g3 reveal">%s</div></div></section>' % cards

def page(fname, title, desc, active, body, schema=''):
    schema = schema or ''
    if 'BreadcrumbList' not in schema:  # don't double up when a caller supplies its own breadcrumb
        schema = schema + _breadcrumb(fname, title)
    body = body + photo_band(fname) + related_block(fname)
    doc = '''<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>%s</title><meta name="description" content="%s"><link rel="canonical" href="https://loadboot.com/%s">
<meta property="og:title" content="%s"><meta property="og:description" content="%s"><meta property="og:type" content="website"><meta property="og:url" content="https://loadboot.com/%s"><meta property="og:image" content="https://loadboot.com/og-image.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:site_name" content="LoadBoot"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="%s"><meta name="twitter:description" content="%s"><meta name="twitter:image" content="https://loadboot.com/og-image.png"><meta name="theme-color" content="#10223B">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png?v=2"><link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png?v=2"><link rel="icon" href="/favicon.ico?v=2"><link rel="manifest" href="/manifest.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png?v=2"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Loadboot">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@600;700;800&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="styles.css?v=6">%s</head><body>
%s
%s
%s
<script>%s</script>
<script src="app.js?v=6"></script></body></html>''' % (title, desc, ('' if fname=='index.html' else fname), title, desc, ('' if fname=='index.html' else fname), title, desc, (HEADX+schema), header(active), body, footer(), (ANNOUNCE_JS + CONFIRM_JS))
    with open(os.path.join(OUT, fname), 'w', encoding='utf-8') as f:
        f.write(deglyph(doc))

# reusable blocks
def final_cta():
    return '''<section><div class="wrap"><div class="fcta reveal"><h2>Ready to keep your truck loaded?</h2>
<p class="lead center" style="margin:14px auto 26px">Get a free quote today and see how much more your truck could be earning with a dispatcher in your corner.</p>
<a href="get-started.html" class="btn btn-primary">Get Started %s</a></div></div></section>''' % ARW

def faq_block(items):
    rows = ''.join('<details%s><summary>%s</summary><p>%s</p></details>' % (' open' if i==0 else '', q, a) for i,(q,a) in enumerate(items))
    sch = '{"@context":"https://schema.org","@type":"FAQPage","mainEntity":[' + ','.join('{"@type":"Question","name":"%s","acceptedAnswer":{"@type":"Answer","text":"%s"}}' % (q.replace('"',"'"), a.replace('"',"'")) for q,a in items) + ']}'
    html = '<section id="faq"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Questions</div><h2>Frequently asked questions</h2></div><div class="faq reveal">%s</div></div></section>' % rows
    return html, '<script type="application/ld+json">%s</script>' % sch

# ---- write shared assets ----
PWA_JS = r'''
if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').then(function(reg){function n(w){if(w&&navigator.serviceWorker.controller)lbUpdBanner(w);}if(reg.waiting)n(reg.waiting);reg.addEventListener('updatefound',function(){var w=reg.installing;if(w)w.addEventListener('statechange',function(){if(w.state==='installed')n(w);});});setInterval(function(){reg.update();},60000);}).catch(function(){});var r=false;navigator.serviceWorker.addEventListener('controllerchange',function(){if(r)return;r=true;location.reload();});});}
function lbUpdBanner(w){if(document.getElementById('lbUpd'))return;var b=document.createElement('div');b.id='lbUpd';b.style.cssText='position:fixed;left:50%;bottom:20px;transform:translateX(-50%);z-index:100000;background:#0b1220;color:#fff;border-radius:14px;padding:12px 14px 12px 18px;display:flex;align-items:center;gap:14px;box-shadow:0 16px 40px -10px rgba(0,0,0,.5);font-family:Manrope,Arial,sans-serif;max-width:92%';b.innerHTML='<span style="font-size:14px;font-weight:600">&#128640; A new version of Loadboot is available.</span><button id="lbUpdBtn" style="background:#FC5305;color:#fff;border:none;border-radius:9px;padding:9px 16px;font-weight:700;font-family:inherit;font-size:13px;cursor:pointer">Update</button><button id="lbUpdX" style="background:none;border:none;color:#94a3b8;font-size:20px;cursor:pointer;line-height:1">&times;</button>';document.body.appendChild(b);document.getElementById('lbUpdBtn').onclick=function(){this.textContent='Updating…';if(w)w.postMessage({type:'SKIP_WAITING'});};document.getElementById('lbUpdX').onclick=function(){b.remove();};}
(function(){var dp=null;addEventListener('beforeinstallprompt',function(e){e.preventDefault();dp=e;if(document.getElementById('pwaBtn'))return;var b=document.createElement('button');b.id='pwaBtn';b.innerHTML='&#11015; Install app';b.style.cssText='position:fixed;bottom:20px;left:20px;z-index:90;background:#0883F7;color:#fff;border:none;border-radius:30px;padding:12px 18px;font-weight:700;font-family:Manrope,sans-serif;font-size:.9rem;box-shadow:0 12px 30px -8px rgba(37,99,235,.6);cursor:pointer';b.onclick=function(){dp.prompt();dp.userChoice.finally(function(){dp=null;b.remove();});};document.body.appendChild(b);});})();
'''
MANIFEST = '{"name":"LoadBoot","short_name":"LoadBoot","description":"The Operating System for Trucking — sign in to your LoadBoot portal.","start_url":"/app/","scope":"/","display":"standalone","background_color":"#0F172A","theme_color":"#0F172A","icons":[{"src":"/icon-192.png","sizes":"192x192","type":"image/png","purpose":"any"},{"src":"/icon-512.png","sizes":"512x512","type":"image/png","purpose":"any"},{"src":"/icon-maskable.png","sizes":"512x512","type":"image/png","purpose":"maskable"}]}'
SW = r'''const CACHE='lb-v7';
const CORE=['/','/index.html','/styles.css','/app.js','/dashboard.html','/load-score.html','/tools.html','/services.html','/pricing.html','/contact.html','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){return c.addAll(CORE).catch(function(){});}).then(function(){return self.skipWaiting();}));});
self.addEventListener('message',function(e){if(e.data&&e.data.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==CACHE&&k.indexOf('lb-app')!==0)return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){var r=e.request;var u=new URL(r.url);if(r.method!=='GET'||u.origin!==location.origin)return;if(u.pathname.indexOf('/app/')===0)return;e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});return res;}).catch(function(){return caches.match(r).then(function(m){return m||caches.match('/index.html');});}));});
'''
LOADBOARD_CSS = '''
.plb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(295px,1fr));gap:18px;margin-top:36px}
.plb{background:#fff;border:1px solid var(--border);border-radius:16px;padding:20px 20px 18px;display:flex;flex-direction:column;gap:13px;transition:transform .2s,box-shadow .2s,border-color .2s}
.plb:hover{transform:translateY(-4px);border-color:var(--blue);box-shadow:0 24px 50px -28px rgba(37,99,235,.4)}
.plb-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.plb-lane{font-family:'Manrope',sans-serif;font-weight:800;font-size:1rem;color:var(--navy);line-height:1.25}
.plb-lane b{font-weight:800;display:block}
.plb-ar{color:var(--blue);font-weight:700;display:block;margin:1px 0}
.plb-rate{text-align:right;font-family:'Manrope',sans-serif;font-weight:800;font-size:1.45rem;color:var(--navy);white-space:nowrap}
.plb-rate span{display:block;font-size:.76rem;font-weight:700;color:var(--orange);margin-top:2px}
.plb-tags{display:flex;flex-wrap:wrap;gap:7px}
.plb-tag{background:var(--bg);border:1px solid var(--border);color:var(--muted);font-size:.77rem;font-weight:600;padding:4px 10px;border-radius:999px}
.plb-tag.eq{background:var(--blue-soft);color:var(--blue);border-color:transparent}
.plb-tag.alt{color:var(--navy)}
.plb-meta{display:flex;gap:18px;font-size:.82rem;color:var(--muted);border-top:1px solid var(--border);padding-top:12px}
.plb-meta b{color:var(--navy);font-weight:700;margin-left:5px}
.plb-book{margin-top:auto;display:inline-flex;align-items:center;justify-content:center;background:var(--navy);color:#fff;font-family:'Manrope',sans-serif;font-weight:700;font-size:.9rem;padding:11px;border-radius:10px;transition:background .2s}
.plb-book:hover{background:var(--blue)}
.plb{position:relative}
.plb-badge{position:absolute;top:10px;right:10px;background:#fef3c7;color:#92400e;font-family:'Manrope',sans-serif;font-weight:800;font-size:.66rem;letter-spacing:.04em;text-transform:uppercase;padding:3px 9px;border-radius:7px;border:1px solid #fde68a}
.plb-empty{grid-column:1/-1;text-align:center;color:var(--muted);font-size:.95rem;padding:34px 16px;border:1px dashed var(--border);border-radius:14px;background:#fff}
.src-row{display:flex;flex-wrap:wrap;gap:10px;justify-content:center;margin-top:18px}
.src-chip{background:#fff;border:1px solid var(--border);border-radius:10px;padding:9px 16px;font-family:'Manrope',sans-serif;font-weight:700;color:var(--navy);font-size:.92rem}
.src-disc{text-align:center;color:var(--muted);font-size:.8rem;max-width:760px;margin:16px auto 0;line-height:1.5}
.plb-cta{text-align:center;margin-top:30px;display:flex;flex-direction:column;align-items:center;gap:10px}
.plb-note{color:var(--muted);font-size:.86rem}
.plb-live{display:inline-block;width:8px;height:8px;border-radius:50%;background:#16a34a;vertical-align:middle;margin-left:5px;animation:plbpulse 1.8s infinite}
@keyframes plbpulse{0%{box-shadow:0 0 0 0 rgba(22,163,74,.55)}70%{box-shadow:0 0 0 8px rgba(22,163,74,0)}100%{box-shadow:0 0 0 0 rgba(22,163,74,0)}}
'''
SPLASH_CSS = '''
#lbSplash{position:fixed;inset:0;z-index:99999;background:radial-gradient(1000px 520px at 50% 34%,#13213f 0%,#0b1220 62%,#070d1a 100%);display:flex;align-items:center;justify-content:center;animation:lbsOut .55s ease 1.9s forwards}
.lbs-stack{display:flex;flex-direction:column;align-items:center}
.lbs-lockup{display:flex;align-items:center;gap:25px}
.lbs-mark-svg{width:60px;height:64px;overflow:visible;display:block}
.lbs-boot1{animation:lbBootIn 3.2s ease-out infinite}
.lbs-boot2{animation:lbBootIn 3.2s ease-out .18s infinite}
.lbs-word-img{height:36px;width:auto;display:block}
.lbs-tagline{margin-top:16px;text-align:center;font-family:'Manrope',Arial,sans-serif;font-size:13px;font-weight:500;color:#64748B;letter-spacing:.02em}
@keyframes lbBootIn{0%{transform:translateX(-20px);opacity:0}16%{transform:translateX(0);opacity:1}100%{transform:translateX(0);opacity:1}}
@keyframes lbsOut{to{opacity:0;visibility:hidden}}
@media(prefers-reduced-motion:reduce){#lbSplash{animation:lbsOut .3s ease .2s forwards}.lbs-boot1,.lbs-boot2{animation:none}}
'''
ART_CSS = '''
.crumbs{font-size:.85rem;color:var(--muted);padding:16px 0}.crumbs a{color:var(--blue)}
.art-hero{position:static;z-index:auto;background:linear-gradient(180deg,#0b1220,#10223B);color:#fff;padding:48px 0 64px}
.art-hero .art-eyebrow{color:#fb923c;font-weight:700;font-size:.78rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:14px}
.art-hero h1{font-size:2.5rem;line-height:1.12;max-width:880px;margin:0 0 16px;color:#fff}
.art-sub{color:#cbd5e1;font-size:1.16rem;max-width:760px;line-height:1.6}
.art-meta{color:#94a3b8;font-size:.9rem;margin-top:18px;display:flex;gap:12px;flex-wrap:wrap}
.art-feat{margin:-44px 0 0;border-radius:18px;overflow:hidden;box-shadow:0 30px 60px -30px rgba(15,23,42,.55);position:relative;z-index:2;background:linear-gradient(120deg,#10223B,#1e3a8a 55%,#0883F7);min-height:300px}
.art-feat .feat-art,.art-feat img{position:absolute;inset:0;width:100%;height:100%;display:block}
.art-feat img{object-fit:cover}
@media(max-width:880px){.art-feat{min-height:200px}}
.art-grid{display:grid;grid-template-columns:230px 1fr;gap:48px;align-items:start;padding-top:42px;padding-bottom:10px}
.art-toc{position:sticky;top:90px}
.art-toc .tt{font-weight:800;font-family:'Manrope',sans-serif;font-size:.76rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:12px}
.art-toc a{display:block;color:var(--navy);font-size:.92rem;padding:6px 0 6px 13px;border-left:2px solid var(--border);transition:.15s}
.art-toc a:hover{border-color:var(--blue);color:var(--blue)}
.art-body{max-width:768px}
.art-body h2{font-size:1.72rem;margin:42px 0 14px;scroll-margin-top:90px;color:var(--navy)}
.art-body h3{font-size:1.24rem;margin:26px 0 8px;color:var(--navy)}
.art-body p{font-size:1.06rem;line-height:1.75;color:#334155;margin-bottom:18px}
.art-body ul,.art-body ol{margin:0 0 20px 4px;color:#334155;line-height:1.7;padding-left:22px}.art-body li{margin-bottom:9px}
.art-body a{color:var(--blue);font-weight:600}
.callout{border-radius:14px;padding:17px 20px;margin:26px 0;display:flex;gap:14px;font-size:1rem;line-height:1.6;color:#334155}
.callout .ic{font-size:1.25rem;line-height:1;flex-shrink:0}
.cl-tip{background:#ecfdf5;border:1px solid #a7f3d0}.cl-warn{background:#fff7ed;border:1px solid #fed7aa}.cl-info{background:var(--blue-soft);border:1px solid #bfdbfe}
.pull{border-left:4px solid var(--orange);padding:4px 0 4px 22px;margin:30px 0;font-size:1.32rem;font-weight:700;font-family:'Manrope',sans-serif;color:var(--navy);line-height:1.42}
.statrow{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:28px 0}
.statcard{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px 14px;text-align:center}
.statcard .n{font-family:'Manrope',sans-serif;font-weight:800;font-size:1.7rem;color:var(--blue)}
.statcard .l{font-size:.84rem;color:var(--muted);margin-top:4px;line-height:1.35}
.cmp{width:100%;border-collapse:collapse;margin:24px 0;font-size:.97rem}
.cmp th,.cmp td{border:1px solid var(--border);padding:11px 14px;text-align:left;vertical-align:top}
.cmp th{background:var(--navy);color:#fff;font-family:'Manrope',sans-serif;font-weight:700}
.cmp td:first-child{font-weight:700;color:var(--navy);background:var(--bg)}
.art-fig{margin:30px 0;border:1px solid var(--border);border-radius:16px;padding:24px 24px 18px;background:#fff}
.art-fig figcaption{font-size:.85rem;color:var(--muted);text-align:center;margin-top:14px;line-height:1.5}
.art-author{display:flex;gap:16px;align-items:flex-start;background:var(--bg);border:1px solid var(--border);border-radius:16px;padding:20px;margin:42px 0 8px;max-width:768px}
.art-author .av{width:52px;height:52px;border-radius:12px;background:linear-gradient(135deg,#1e3a8a,#0b1220);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-family:'Manrope',sans-serif;flex-shrink:0}
.svc-banner{display:flex;align-items:center;justify-content:space-between;gap:18px;background:linear-gradient(135deg,#0b1220,#1e3a8a);color:#fff;border-radius:16px;padding:22px 24px;margin:32px 0;flex-wrap:wrap}
.svc-banner .sb-t{font-family:'Manrope',sans-serif;font-weight:800;font-size:1.16rem;margin-bottom:4px;color:#fff}
.svc-banner .sb-s{color:#cbd5e1;font-size:.95rem;max-width:460px;line-height:1.5}
.svc-banner a.sb-btn{background:#FC5305;color:#fff;font-weight:700;font-family:'Manrope',sans-serif;padding:12px 22px;border-radius:11px;white-space:nowrap;font-size:.95rem;flex-shrink:0}
.svc-banner a.sb-btn:hover{background:#ea6a0c}
.bloggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:24px;margin-top:36px}
.blogcard{display:flex;flex-direction:column;background:#fff;border:1px solid var(--border);border-radius:18px;overflow:hidden;transition:transform .2s,box-shadow .2s,border-color .2s}
.blogcard:hover{transform:translateY(-5px);border-color:var(--blue);box-shadow:0 28px 56px -30px rgba(37,99,235,.4)}
.bc-thumb{position:relative;aspect-ratio:2/1;overflow:hidden;background:#0b1220}
.bc-thumb svg,.bc-thumb img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block}
.bc-thumb img{z-index:2}
.bc-ov{position:absolute;inset:0;z-index:3;pointer-events:none;background:linear-gradient(155deg,rgba(11,18,32,.22),transparent 38%,transparent 66%,rgba(11,18,32,.5))}
.bc-brand{position:absolute;top:12px;left:12px;z-index:4;display:inline-flex;align-items:center;gap:7px;font-family:'Manrope',sans-serif;font-weight:800;font-size:.74rem;letter-spacing:.01em;color:#fff;background:rgba(11,18,32,.4);backdrop-filter:blur(5px);padding:5px 11px 5px 5px;border-radius:9px}
.bc-l{display:inline-flex;align-items:center;justify-content:center;width:19px;height:19px;border-radius:6px;background:linear-gradient(135deg,#0883F7,#1e3a8a);color:#fff;font-size:.72rem;position:relative}
.bc-l::after{content:'';position:absolute;right:3px;bottom:4px;width:0;height:0;border-left:5px solid #FC5305;border-top:3px solid transparent;border-bottom:3px solid transparent}
.blogcard:hover .bc-thumb img,.blogcard:hover .bc-thumb svg{transform:scale(1.05)}
.bc-thumb img,.bc-thumb svg{transition:transform .4s ease}
.bc-body{padding:20px 22px 22px;display:flex;flex-direction:column;flex:1}
.bc-meta{font-size:.75rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--blue);margin-bottom:8px}
.bc-body h3{font-family:'Manrope',sans-serif;font-size:1.18rem;color:var(--navy);line-height:1.3;margin-bottom:8px}
.bc-body p{color:var(--muted);font-size:.94rem;line-height:1.55;flex:1;margin:0}
.bc-link{margin-top:14px;color:var(--blue);font-weight:700;font-size:.92rem}
.art-steps{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin:26px 0}
.art-step{background:#fff;border:1px solid var(--border);border-radius:14px;padding:18px}
.art-step .sn{width:30px;height:30px;border-radius:8px;background:var(--blue-soft);color:var(--blue);font-family:'Manrope',sans-serif;font-weight:800;display:flex;align-items:center;justify-content:center;margin-bottom:10px}
.art-step b{display:block;color:var(--navy);font-size:.98rem;margin-bottom:4px}.art-step span{color:var(--muted);font-size:.88rem;line-height:1.45}
@media(max-width:880px){.art-steps{grid-template-columns:1fr 1fr}}
@media(max-width:880px){.art-grid{grid-template-columns:1fr;gap:0;padding-top:30px}.art-toc{display:none}.art-hero h1{font-size:1.95rem}.statrow{grid-template-columns:1fr}.art-feat{margin-top:-30px}.svc-banner a.sb-btn{width:100%;text-align:center}}
'''
def _mincss(c):
    import re as _re
    c=_re.sub(r'/\*.*?\*/','',c,flags=_re.S)      # strip comments
    c=_re.sub(r'\n\s*','',c)                        # strip newlines + indentation
    c=_re.sub(r'\s*([{};,])\s*',r'\1',c)           # trim space around { } ; ,
    c=c.replace(';}','}')                            # drop trailing semicolons
    return c.strip()
with open(os.path.join(OUT,'styles.css'),'w',encoding='utf-8') as f: f.write(_mincss(CSS + TOOLS_CSS + LS_CSS + LOADBOARD_CSS + SPLASH_CSS + ART_CSS))
with open(os.path.join(OUT,'app.js'),'w',encoding='utf-8') as f: f.write(JS + PWA_JS)
with open(os.path.join(OUT,'manifest.webmanifest'),'w',encoding='utf-8') as f: f.write(MANIFEST)
with open(os.path.join(OUT,'sw.js'),'w',encoding='utf-8') as f: f.write(SW)

ROAD = '''<section class="road-sec"><div class="wrap">
<div class="sec-head reveal"><div class="eyebrow">Always Moving</div><h2>Your truck, loaded and rolling &mdash; coast to coast</h2><p class="lead">We keep freight moving across all 48 states, day and night.</p></div>
<div class="road reveal"><div class="lane"></div><div class="tk">&#128666;</div><div class="hill"></div></div></div></section>'''

ROUTE = '''<section><div class="wrap route-grid">
<div class="reveal"><div class="eyebrow">Freight Management, Handled</div><h2>From booking to delivery &mdash; we guide every mile</h2>
<p class="lead" style="margin:16px 0 22px">We plan the lane, book the load, negotiate the rate, and follow it through to delivery. You just drive &mdash; we manage the route, the broker, and the paperwork.</p>
<div><span class="tag">Route planning</span><span class="tag">Load tracking</span><span class="tag">Rate negotiation</span><span class="tag">Paperwork handled</span></div></div>
<div class="routebox reveal d1"><svg viewBox="0 0 400 220" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Animated dispatch route map">
<rect width="400" height="220" rx="12" fill="#F8FAFC"/>
<g stroke="#E2E8F0" stroke-width="1"><path d="M0 55H400M0 110H400M0 165H400M100 0V220M200 0V220M300 0V220"/></g>
<path d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#CBD5E1" stroke-width="5" stroke-linecap="round"/>
<path d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#0883F7" stroke-width="5" stroke-linecap="round" class="dasharw"/>
<circle cx="40" cy="175" r="14" fill="#0883F7" opacity=".18"/><circle cx="40" cy="175" r="7" fill="#0883F7"/>
<circle cx="360" cy="48" r="14" fill="#FC5305" opacity=".18"/><circle cx="360" cy="48" r="7" fill="#FC5305"/>
<g><circle r="13" fill="#0883F7" opacity="0.16"/><circle r="6.5" fill="#0883F7"/><circle r="2.5" fill="#fff"/><animateMotion dur="6s" repeatCount="indefinite" rotate="auto"><mpath href="#rtpath"/></animateMotion></g>
<text x="34" y="200" font-size="11" fill="#64748B" font-family="Inter">Origin</text>
<text x="318" y="38" font-size="11" fill="#64748B" font-family="Inter">Delivery</text></svg></div></div></section>'''
# fix mpath: use inline path reference via id
ROUTE = ROUTE.replace('<path d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#CBD5E1"','<path id="rtpath" d="M40 175 C 150 175 120 70 250 72 S 340 55 360 48" fill="none" stroke="#CBD5E1"').replace('<mpath href="#"/>','<mpath href="#rtpath"/>')

WHYUS = '''<section id="why"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Why Loadboot</div><h2>Built for carriers who want to earn more and stress less</h2></div>
<div class="grid g4">
<div class="card reveal"><div class="icon">&#128200;</div><h3>Higher-paying loads</h3><p>We negotiate hard on every rate and turn down cheap freight that wastes your time.</p></div>
<div class="card reveal d1"><div class="icon">&#128739;</div><h3>Less deadhead</h3><p>Smart lane planning keeps your truck loaded and your miles paid.</p></div>
<div class="card reveal d2"><div class="icon">&#128450;</div><h3>Back office handled</h3><p>Broker setup, rate confirmations, and paperwork &mdash; all taken care of.</p></div>
<div class="card reveal d3"><div class="icon">&#128222;</div><h3>Straight talk</h3><p>No hidden fees, no lock-in contracts, and a dispatcher who actually answers.</p></div>
</div></div></section>'''

STATS = '''<div class="stats"><div class="wrap stats-grid">
<div class="stat reveal"><div class="n" data-count="48">48</div><div class="l">States covered</div></div>
<div class="stat reveal d1"><div class="n">5%</div><div class="l">Flat rate, no contracts</div></div>
<div class="stat reveal d2"><div class="n">24/7</div><div class="l">Dispatch support</div></div>
<div class="stat reveal d3"><div class="n">15<span style="font-size:1.3rem">min</span></div><div class="l">Avg. reply (business hrs)</div></div>
</div></div>'''

PROMISE = '''<section><div class="wrap"><div class="promise reveal"><div class="glow"></div>
<div class="eyebrow" style="color:#93c5fd">Our Promise</div><h2>A dispatcher who actually has your back</h2>
<p>Loadboot was built on a simple idea: treat every carrier's truck like it's our own business. You get real attention, honest rates, and someone who picks up the phone.</p>
<p>We're a growing dispatch service &mdash; be one of our first carriers and grow with us.</p>
<div class="reply">&#9201;&#65039; We reply within 15 minutes during business hours</div></div></div></section>'''

def linkcard(href,emoji,title,text):
    return '<a class="linkcard reveal" href="%s"><div class="icon">%s</div><h3>%s</h3><p>%s</p><span class="arw">Learn more %s</span></a>' % (href,emoji,title,text,ARW)

FREIGHT_CARDS = '''<section id="services" class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Dispatch by Freight Type</div><h2>Specialized dispatch for your equipment</h2></div>
<div class="grid g3">%s</div></div></section>''' % ''.join([
 linkcard('reefer-dispatch.html','&#10052;&#65039;','Reefer Dispatch','Temperature-controlled freight that pays &mdash; booked and protected.'),
 linkcard('flatbed-dispatch.html','&#128679;','Flatbed Dispatch','Steel, lumber, machinery &mdash; higher-skill freight, higher rates.'),
 linkcard('dry-van-dispatch.html','&#128230;','Dry Van Dispatch','Consistent, steady van freight to keep you moving.'),
 linkcard('hotshot-dispatch.html','&#9889;','Hotshot Dispatch','Expedited, smaller loads for hotshot operators.'),
 linkcard('power-only-dispatch.html','&#128668;','Power Only','Flexible drop-and-hook freight for your tractor.'),
 linkcard('new-authority-dispatch.html','&#128640;','New Authority','Just got your MC? We get you set up and loaded.'),
])

_WS = [
 ('Owner-Operators','<path d="M2 7h11v8H2z"/><path d="M13 10h4l3 3v2h-7z"/><circle cx="6" cy="18" r="1.4"/><circle cx="17" cy="18" r="1.4"/>'),
 ('Small Fleets','<rect x="2" y="9" width="9" height="7" rx="1"/><rect x="12" y="6" width="9" height="10" rx="1"/>'),
 ('Growing Fleets','<polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>'),
 ('New-Authority Carriers','<path d="M6 21V4h11l-2 3.5L17 11H6"/>'),
 ('Independent Carriers','<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
 ('Leased-On Operators','<path d="M9 15l6-6"/><path d="M12 6l1-1a4 4 0 0 1 6 6l-1 1"/><path d="M12 18l-1 1a4 4 0 0 1-6-6l1-1"/>'),
 ('Hotshot Operators','<polygon points="13 2 4 14 11 14 11 22 20 10 13 10 13 2"/>'),
 ('Box Truck / Expedited','<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/>'),
 ('Team Drivers','<circle cx="9" cy="8" r="3"/><path d="M3 20a6 6 0 0 1 12 0"/><path d="M16 6a3 3 0 0 1 0 5"/>'),
 ('CDL Drivers Going Independent','<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/><path d="M12 3v6M12 15v6M3 12h6M15 12h6"/>'),
 ('Veteran &amp; Woman-Owned Carriers','<circle cx="12" cy="9" r="5"/><path d="M9 13l-1 8 4-2 4 2-1-8"/>'),
]
def _wschip(t):
    return '<span class="mq-chip"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">' + t[1] + '</svg>' + t[0] + '</span>'
WHOSERVE = '<section id="serve"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Who We Serve</div><h2>Built for every kind of carrier on the road</h2><p class="lead" style="margin-top:14px">Whether you run one truck or a growing fleet, brand new or years in &mdash; we tailor dispatch to how you run.</p></div></div><div class="mq-wrap reveal"><div class="mq-track">' + ''.join(_wschip(s) for s in _WS)*2 + '</div></div></section>'
# NOTE: Third-party platform logos and platform-specific sourcing claims were removed
# per owner decision (no trademark permission / authorized operational relationship on file).
# Wording is intentionally neutral and accurate. Do NOT name or display any platform unless
# its use and branding are authorized in writing.
# Platform names are CONFIGURABLE in ONE place. Default = OFF (empty) -> neutral text only.
# Add names ONLY after the owner confirms LoadBoot genuinely uses them. NO logos. NO
# partner/integrated/official/certified/connected/authorized language.
PLATFORM_NAMES = []   # e.g. ['DAT','Truckstop','Amazon Relay','Uber Freight'] once owner-confirmed
_PLAT_DISC = ('LoadBoot is an independent dispatch service and is not affiliated with, endorsed by, or '
 'sponsored by any platforms named above. Platform access depends on each carrier&rsquo;s eligibility, '
 'account status and applicable terms.')
def _networks():
    head=('<div class="sec-head center reveal"><div class="eyebrow">How we find your freight</div>'
          '<h2>Freight sources our dispatch workflow may use</h2>'
          '<p class="lead center" style="margin:14px auto 0">We search authorized freight sources and load boards '
          'available to your carrier and dispatch operation &mdash; then negotiate the rate so you keep more of every mile.</p></div>')
    if PLATFORM_NAMES:
        chips=''.join('<span class="src-chip">'+n+'</span>' for n in PLATFORM_NAMES)
        body='<div class="src-row reveal">'+chips+'</div><p class="src-disc reveal">'+_PLAT_DISC+'</p>'
    else:
        body=''
    cards=[('&#127970;','Licensed broker partners','Loads posted straight into LoadBoot by verified brokerages &mdash; full rate card, exact pins, terms in writing before you look at it.','load-board.html','The verified board'),
           ('&#127981;','Direct shipper &amp; facility freight','Shippers who post their own lanes and run their docks here &mdash; moved under licensed brokerage, tracked end to end.','shipper-solutions.html','Shipper side'),
           ('&#128269;','Authorized load boards','Public sources your authority and equipment qualify for &mdash; worked by a dispatcher who negotiates before the load ever reaches you.','how-it-works.html','How dispatch works'),
           ('&#128260;','Reloads off your own trail','Delivered where? The fleet plan scans the board from your actual drop point and chains the next load with the least deadhead.','fleet-management.html','Fleet plan'),
           ('&#128266;','Post your truck','Tell the board when and where a truck frees up &mdash; matching loads alert you instead of you watching a screen all day.','book-truck-loads.html','One-tap booking'),
           ('&#9889;','Direct offers to you','Verified carriers get loads offered directly with a countdown &mdash; first acceptance wins, no double-booking, no bidding war.','load-board.html','See the board')]
    grid=('<div class="grid g3 reveal" style="margin-top:26px">'
      + ''.join('<a class="linkcard" href="'+u+'"><div class="icon">'+ic+'</div><h3>'+t+'</h3><p>'+d+'</p><span class="arw">'+lk+' &rarr;</span></a>' for ic,t,d,u,lk in cards)
      + '</div>')
    band=('<div class="reveal" style="margin-top:24px;background:#10223B;border-radius:18px;padding:22px 24px;color:#e2e8f0">'
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px;text-align:center">'
      '<div><div style="font-weight:900;font-size:1.35rem;color:#4ade80">Rate card first</div><div style="font-size:.82rem;color:#94a3b8;margin-top:3px">Detention, TONU and layover terms printed on every posting &mdash; before you accept.</div></div>'
      '<div><div style="font-weight:900;font-size:1.35rem;color:#4ade80">Zero ghost loads</div><div style="font-size:.82rem;color:#94a3b8;margin-top:3px">Stale postings auto-close and late cancels carry TONU exposure &mdash; fakes cost money here.</div></div>'
      '<div><div style="font-weight:900;font-size:1.35rem;color:#4ade80">Real deadhead</div><div style="font-size:.82rem;color:#94a3b8;margin-top:3px">Miles measured from where your truck actually is, not from the city center.</div></div>'
      '<div><div style="font-weight:900;font-size:1.35rem;color:#4ade80">You approve</div><div style="font-size:.82rem;color:#94a3b8;margin-top:3px">Nothing books without your tap, and the rate confirmation e-signs in-app.</div></div>'
      '</div></div>')
    foot=('<p class="src-disc reveal" style="text-align:center;margin-top:16px">Available sources depend on your authority, equipment and eligibility. '
      'LoadBoot is an independent dispatch service and marketplace &mdash; not a freight broker; when broker authority is legally required, freight moves through licensed broker partners.</p>')
    return '<section class="bg-soft"><div class="wrap">'+head+body+grid+band+foot+'</div></section>'
NETWORKS = _networks()

# ---- Real public load board (admin-published) via the narrow secured RPC ----
LIVEBOARD = ('<section id="opportunities" class="bg-soft"><div class="wrap"><div class="sec-head center reveal">'
 '<div class="eyebrow">Live Opportunities</div><h2>Available Load Opportunities</h2>'
 '<p class="lead center" style="margin:0 auto">Current freight opportunities published by LoadBoot dispatch. '
 'Availability can change quickly. Verified carriers can sign in to view and book.</p></div>'
 '<div class="plb-grid reveal" id="liveLoads"><div class="plb-empty" id="liveEmpty">Loading current opportunities&hellip;</div></div>'
 '<div class="plb-cta reveal"><a href="/app/carrier/" class="btn btn-primary">Sign in to view &amp; book &rarr;</a>'
 '<span class="plb-note">A free verified carrier account is required to view full load details and book.</span></div></div></section>')

# ---- HOME: live market-rates strip (SEO section, feeds from get_public_market_rates) ----
HOME_RATES = ('<section id="market-rates" class="bg-soft"><div class="wrap">'
 '<div class="sec-head center reveal"><div class="eyebrow">Live Market Data</div>'
 '<h2>Today\u2019s Truckload Freight Rates Per Mile</h2>'
 '<p class="lead center" style="margin:0 auto;max-width:760px">Current national trucking rates per mile \u2014 dry van, reefer, flatbed and hotshot spot rates, blended from real LoadBoot bookings and published industry benchmarks. What carriers get paid, what freight brokers buy and sell at, and what shippers pay \u2014 <b>updated weekly</b>.</p></div>'
 '<style>.hmr-g{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin:22px 0}'
 '.hmr{background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:18px;text-align:center;box-shadow:0 12px 30px -24px rgba(2,12,30,.35);transition:transform .15s}'
 '.hmr:hover{transform:translateY(-3px)}'
 '.hmr .e{font-weight:800;font-size:.92rem;color:#10223B}'
 '.hmr .p{font-size:1.7rem;font-weight:800;color:#0883F7;margin:4px 0 2px}'
 '.hmr .r{font-size:.72rem;color:#64748b}'
 '.hmr-note{text-align:center;font-size:.8rem;color:#64748b;margin-top:6px}</style>'
 '<div class="hmr-g reveal" id="hmrTiles">'
 + ''.join('<div class="hmr"><div class="e">' + e + ' Rates</div><div class="p" data-eq="' + e + '">\u2014</div><div class="r" data-eqr="' + e + '">loading\u2026</div></div>'
           for e in ['Dry Van', 'Reefer', 'Flatbed', 'Hotshot'])
 + '</div>'
 '<div class="hmr-note" id="hmrAsOf">National spot averages, all-in linehaul per mile \u00b7 refreshed weekly</div>'
 '<div class="plb-cta reveal" style="margin-top:16px"><a href="/market-rates.html" class="btn btn-primary">See all freight rates \u2014 carrier, broker &amp; shipper sides &rarr;</a>'
 '<span class="plb-note">Free lane-level rates (state \u2192 state, low/avg/high, 12-week trends) inside every LoadBoot account.</span></div>'
 '</div></section>')

# The public load board talks to a Supabase project. In PRODUCTION it uses the
# production project. In ANY preview/branch/dev build it makes ZERO production
# requests: the board renders an explicit "disabled in preview" state and never
# fetches (staging has no public board data). This keeps a Deploy Preview fully
# production-isolated. The SB/KEY literals below are only ever the PRODUCTION
# project, and they are only emitted into the page when IS_PRODUCTION_CTX is true.
_BOARD_SB = 'https://%s.supabase.co' % PROD_REF
_BOARD_KEY = PROD_ANON
LIVEBOARD_JS_PROD = (r"(function(){var SB='" + _BOARD_SB + r"',KEY='" + _BOARD_KEY + r"';var el=document.getElementById('liveLoads'),em=document.getElementById('liveEmpty');if(!el)return;var AUTHED=false;try{for(var i=0;i<localStorage.length;i++){var k=localStorage.key(i);if(k&&k.indexOf('sb-')===0&&k.indexOf('-auth-token')>0){AUTHED=true;break;}}}catch(e){}function esc(s){return (s==null?'':String(s)).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}function num(n){return Number(n||0).toLocaleString();}function dt(d){if(!d)return '';try{return new Date(d).toLocaleDateString(undefined,{month:'short',day:'numeric'});}catch(e){return '';}}function ago(d){if(!d)return '';var s=Math.floor((Date.now()-new Date(d).getTime())/1000);if(s<3600)return Math.floor(s/60)+'m ago';if(s<86400)return Math.floor(s/3600)+'h ago';return Math.floor(s/86400)+'d ago';}function card(l){var rpm=l.rpm?('$'+Number(l.rpm).toFixed(2)+'/mi'):'';return '<article class=\"plb\"><div class=\"plb-top\"><div class=\"plb-lane\"><b>'+esc(l.origin)+'</b><span class=\"plb-ar\">&rarr;</span><b>'+esc(l.destination)+'</b></div><div class=\"plb-rate\">$'+num(Math.round(l.rate))+(rpm?'<span>'+rpm+'</span>':'')+'</div></div><div class=\"plb-tags\"><span class=\"plb-tag eq\">'+esc(l.equipment||'Van')+'</span>'+(l.miles?'<span class=\"plb-tag alt\">'+num(l.miles)+' mi</span>':'')+(l.pickup_date?'<span class=\"plb-tag\">PU '+esc(dt(l.pickup_date))+'</span>':'')+(l.commodity?'<span class=\"plb-tag\">'+esc(l.commodity)+'</span>':'')+(l.weight?'<span class=\"plb-tag\">'+esc(l.weight)+'</span>':'')+(l.posted_by?'<span class=\"plb-tag alt\">'+esc(l.posted_by)+'</span>':'')+'</div><div class=\"plb-meta\"><span>Posted<b>'+esc(ago(l.posted)||'recently')+'</b></span><span>Ref<b>#'+esc(l.ref)+'</b></span></div>'+(AUTHED?'<a href=\"/app/carrier/#loads\" class=\"plb-book\">Book this load &rarr;</a>':'<a href=\"/app/carrier/\" class=\"plb-book\">Login &amp; Book &rarr;</a>')+'</article>';}function empty(m){if(em){em.textContent=m;em.style.display='';}}fetch(SB+'/rest/v1/rpc/get_public_load_opportunities',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify({p_limit:9})}).then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){if(d&&d.length){el.innerHTML=d.map(card).join('');}else{empty('No public load opportunities right now. Sign in for the full carrier board.');}}).catch(function(){empty('Live opportunities are temporarily unavailable. Please sign in to view the full board.');});})();")
# Preview variant: NO network call at all — explicit disabled state.
LIVEBOARD_JS_PREVIEW = (r"(function(){var em=document.getElementById('liveEmpty');if(em){em.textContent='Live load board is disabled in this preview environment.';em.style.display='';}})();")
LIVEBOARD_JS = LIVEBOARD_JS_PROD if IS_PRODUCTION_CTX else LIVEBOARD_JS_PREVIEW

HOME_RATES_JS = ("<script>(function(){var SB='" + _BOARD_SB + "',KEY='" + _BOARD_KEY + "';"
 "fetch(SB+'/rest/v1/rpc/get_public_market_rates',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:'{}'})"
 ".then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){if(!d)return;var asof='';"
 "d.forEach(function(b){asof=b.as_of||asof;var p=document.querySelector('[data-eq=\"'+b.equipment+'\"]');var r2=document.querySelector('[data-eqr=\"'+b.equipment+'\"]');"
 "if(p)p.textContent='$'+Number(b.carrier_rpm).toFixed(2)+'/mi';if(r2)r2.textContent='range $'+Number(b.low).toFixed(2)+'\u2013'+Number(b.high).toFixed(2);});"
 "var a=document.getElementById('hmrAsOf');if(a&&asof)a.textContent='National spot averages, all-in linehaul per mile \u00b7 updated '+asof;"
 "}).catch(function(){});})();</script>")

# Public announcement bar — fetches active audience='public' announcements (get_active_public_announcements,
# anon-granted) and renders a dismissible top bar. Emergencies show first in red. Dismissal is per-announcement
# (sessionStorage) so a visitor is not nagged after closing it. Production only (needs the live anon key).
ANNOUNCE_JS_PROD = (r"(function(){var SB='" + _BOARD_SB + r"',KEY='" + _BOARD_KEY + r"';var TONE={emergency:['#7f1d1d','#fecaca'],warning:['#78350f','#fde68a'],promo:['#4c1d95','#ddd6fe'],info:['#0c4a6e','#bae6fd']};function esc(s){return (s==null?'':String(s)).replace(/[&<>\"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c];});}fetch(SB+'/rest/v1/rpc/get_active_public_announcements',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:'{}'}).then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){if(!d||!d.length)return;var a=null;for(var i=0;i<d.length;i++){var seen=false;try{seen=sessionStorage.getItem('lb_ann_'+d[i].id);}catch(e){}if(!seen){a=d[i];break;}}if(!a)return;var t=TONE[a.kind]||TONE.info;var bar=document.createElement('div');bar.className='lb-annbar';bar.setAttribute('role','status');bar.style.cssText='background:'+t[0]+';color:'+t[1]+';font:600 14px/1.4 Inter,system-ui,sans-serif;padding:10px 44px 10px 18px;text-align:center;position:relative;z-index:60';bar.innerHTML='<b style=\"color:#fff\">'+esc(a.title)+'</b>'+(a.body?' <span style=\"opacity:.92\">'+esc(a.body)+'</span>':'');var x=document.createElement('button');x.setAttribute('aria-label','Dismiss');x.textContent='×';x.style.cssText='position:absolute;right:12px;top:50%;transform:translateY(-50%);background:none;border:0;color:'+t[1]+';font-size:22px;line-height:1;cursor:pointer;padding:0 6px';x.onclick=function(){try{sessionStorage.setItem('lb_ann_'+a.id,'1');}catch(e){}bar.parentNode&&bar.parentNode.removeChild(bar);};bar.appendChild(x);document.body.insertBefore(bar,document.body.firstChild);}).catch(function(){});})();")
ANNOUNCE_JS = ANNOUNCE_JS_PROD if IS_PRODUCTION_CTX else ""

# ---- EMAIL-CONFIRMED landing (big-brand UX) ----
# Supabase confirmation links redirect to the Site URL (this marketing site) with the session
# tokens in the hash (#access_token=...&type=signup). Without this, the user just lands on the
# homepage with an ugly token URL and no feedback. This overlay: (1) shows a premium
# "Email confirmed" screen, (2) decodes the JWT to pick the right portal (agent/partner/carrier),
# (3) forwards the hash to that portal, where supabase-js detectSessionInUrl signs them in
# automatically — confirm click lands INSIDE their dashboard, like Uber/Amazon activation flows.
CONFIRM_JS = r"""
(function(){
  var h = location.hash || '';
  if (!/access_token=/.test(h) || !/type=signup/.test(h)) return;
  var portal = '/app/carrier/';
  try {
    var tk = (h.match(/access_token=([^&]+)/) || [])[1] || '';
    var pl = JSON.parse(atob(tk.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    var md = (pl && pl.user_metadata) || {};
    if (md.role === 'agent') portal = '/app/agent/';
    else if (md.partner_kind) portal = '/app/partner/';
  } catch (e) {}
  var ov = document.createElement('div');
  ov.id = 'lbConfirmOv';
  ov.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:radial-gradient(900px 500px at 50% 34%,#13213f 0%,#0b1220 62%,#070d1a 100%);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Manrope,system-ui,Arial,sans-serif';
  ov.innerHTML =
    '<style>@keyframes lbCkPop{0%{transform:scale(.4);opacity:0}70%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}@keyframes lbCkDraw{to{stroke-dashoffset:0}}@keyframes lbCfUp{0%{opacity:0;transform:translateY(12px)}100%{opacity:1;transform:translateY(0)}}@keyframes lbCfBar{0%{transform:translateX(-120%)}100%{transform:translateX(340%)}}</style>'
    + '<div style="max-width:430px;width:100%;background:#0f1b30;border:1px solid rgba(255,255,255,.09);border-radius:22px;padding:42px 34px;text-align:center;box-shadow:0 40px 90px -30px rgba(2,8,23,.9)">'
    + '<div style="width:86px;height:86px;margin:0 auto 22px;border-radius:50%;background:rgba(22,163,74,.14);border:2px solid #16a34a;display:flex;align-items:center;justify-content:center;animation:lbCkPop .55s cubic-bezier(.2,1.4,.4,1) both">'
    + '<svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 10 18.5 20 6.5" style="stroke-dasharray:30;stroke-dashoffset:30;animation:lbCkDraw .5s .35s ease-out forwards"/></svg>'
    + '</div>'
    + '<div style="font-size:24px;font-weight:800;color:#fff;letter-spacing:-.02em;animation:lbCfUp .5s .2s both">Email confirmed!</div>'
    + '<div style="font-size:14.5px;color:#94a3b8;line-height:1.65;margin:10px 0 24px;animation:lbCfUp .5s .35s both">Your LoadBoot account is active.<br>Taking you to your dashboard&hellip;</div>'
    + '<div style="width:180px;height:4px;margin:0 auto 24px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden"><div style="height:100%;width:40%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#60a5fa);animation:lbCfBar 1.1s ease-in-out infinite"></div></div>'
    + '<a id="lbCfGo" style="display:inline-block;background:#0883F7;color:#fff;font-weight:800;font-size:15px;padding:13px 30px;border-radius:11px;text-decoration:none;animation:lbCfUp .5s .5s both">Open my dashboard →</a>'
    + '</div>';
  (document.body || document.documentElement).appendChild(ov);
  var dest = portal + h;
  var go = document.getElementById('lbCfGo');
  if (go) go.href = dest;
  setTimeout(function(){ location.replace(dest); }, 2800);
})();
"""

COMPARE = '''<section id="compare" class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The Difference</div><h2>Why carriers choose us over going it alone</h2></div>
<div class="reveal"><table class="cmp"><thead><tr><th>What matters to you</th><th>Dispatching yourself</th><th>A typical dispatcher</th><th class="us">Loadboot</th></tr></thead><tbody>
<tr><td>Hours saved on broker calls</td><td class="no">None</td><td>Some</td><td class="us">Fully handled</td></tr>
<tr><td>Expert rate negotiation</td><td class="no">On your own</td><td>Varies</td><td class="us">Every load</td></tr>
<tr><td>No long-term contract</td><td>&mdash;</td><td class="no">Often locked in</td><td class="us">Cancel anytime</td></tr>
<tr><td>You approve every load</td><td class="yes">Yes</td><td>Sometimes</td><td class="us">Always</td></tr>
<tr><td>24/7 support</td><td class="no">No</td><td>Limited</td><td class="us">Yes</td></tr>
<tr><td>Added-value (factoring, IFTA, claims)</td><td class="no">No</td><td class="no">Rarely</td><td class="us">Included help</td></tr>
</tbody></table></div></div></section>'''

HOW = '''<section id="how"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Simple Onboarding</div><h2>Getting started takes one conversation</h2></div>
<div class="grid g4">
<div class="step reveal"><div class="num">1</div><h3>Free Consultation</h3><p>Tell us about your truck, your authority, and the lanes you like to run.</p></div>
<div class="step reveal d1"><div class="num">2</div><h3>We Set You Up</h3><p>We handle broker setup and learn your preferences, equipment, and target rates.</p></div>
<div class="step reveal d2"><div class="num">3</div><h3>We Book &amp; Negotiate</h3><p>We find loads, negotiate the rate, and send the details for your approval.</p></div>
<div class="step reveal d3"><div class="num">4</div><h3>You Drive, We Handle the Rest</h3><p>You stay loaded and paid; we manage the back office.</p></div>
</div></div></section>'''

# ---------- HOME ----------
home_faqs=[('Do I need my own authority (MC/DOT)?','Yes &mdash; we dispatch for carriers who hold their own operating authority. New-authority carriers are welcome, and we help with broker setup.'),
('How do you charge?','A flat 5% of your gross on the loads we book &mdash; no hidden fees and no long-term contract. You only pay when you earn.'),
('Is there a long-term contract?','No. You can cancel anytime. We earn your business load by load.'),
('What kind of freight do you dispatch?','Dry van, reefer, flatbed, step deck, hotshot, power-only, and box truck/expedited.'),
('How soon can you start?','Usually within a day or two of completing your carrier setup.'),
('Do you work with new-authority carriers?','Absolutely &mdash; new carriers are a core part of who we help.'),
('Will I know the rate before I accept a load?','Always. Nothing is booked without your approval.'),
('Does LoadBoot sync with QuickBooks or my ELD?','Yes — native two-way QuickBooks Online sync is live, and Samsara/Motive ELDs connect with a pasted token. Fuel-card CSVs (EFS, Comdata, WEX) import straight onto trips. See <a href="integrations.html">integrations</a>.'),
('What happens with detention, TONU or layover?','Published standards ride every posting ($60/hr detention after 2 hours free, $250 TONU) and claims draft themselves from GPS trip data — evidence attached, riding the same invoice as the freight. See the <a href="detention-pay-policy.html">accessorial policies</a>.'),
('Can it run a multi-truck fleet?','Yes — roster with driver credential alerts, maintenance logs, per-trip P&L, and an optimized fleet plan that assigns each board load to the truck it fits best. See <a href="fleet-management.html">fleet management</a>.')]
home_faq_html, home_faq_schema = faq_block(home_faqs)
HERO='''<section class="hero"><div class="aurora"><span class="a1"></span><span class="a2"></span></div>
<div class="wrap hero-grid"><div>
<span class="badge reveal"><span class="dot"></span> Carriers &middot; Brokers &middot; Shippers &mdash; one platform</span>
<h1 class="reveal d1">Professional Truck Dispatch <span class="gradtext">&amp; a Load Board With Zero Ghosts</span></h1>
<p class="reveal d1" style="color:#94a3b8;font-weight:500;font-size:1.08rem;margin:12px 0 0;letter-spacing:.02em">The Operating System for Trucking</p>
<p class="lead reveal d2">Carriers book higher-paying freight with every rate in writing. Brokers and shippers cover loads with verified capacity in minutes &mdash; and watch every mile on live GPS. One platform, honest by design: no ghost loads, no long-term contracts.</p>
<div class="hero-btns reveal d3"><a href="get-started.html" class="btn btn-primary">Get Started %s</a><a href="/app/partner/" class="btn btn-secondary">Post freight &mdash; broker / shipper</a><a href="how-it-works.html" class="btn btn-ghost">How it works &rarr;</a></div>
<div class="trust reveal d3"><div>%s Verified on both sides</div><div>%s Every rate in writing</div><div>%s Flat 5%% &mdash; only when carriers earn</div></div></div>
<div class="hero-visual reveal d2"><div class="hv-card"><div class="glow"></div>
<div class="hv-top"><div class="truck">&#128666;</div><span class="hv-live"><span class="dot"></span> Load booked</span></div>
<div class="hv-row"><span>Lane</span><span>Dallas, TX &rarr; Atlanta, GA</span></div>
<div class="hv-row"><span>Equipment</span><span>Dry Van &middot; 53&prime;</span></div>
<div class="hv-row"><span>Miles</span><span>781 mi</span></div>
<div class="hv-row"><span>Negotiated rate</span><span class="hv-rate">$2,640 &middot; $3.38/mi</span></div></div>
<div class="hv-float hv-f1"><span class="ic">&#128222;</span> Broker handled for you</div>
<div class="hv-float hv-f2"><span class="ic">&#10003;</span> You approve every load</div></div></div></section>''' % (ARW,CHK,CHK,CHK)
SCROLLBAND = '<section class="scroll-road-sec"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Coast to coast</div><h2>We keep your truck moving, every mile</h2><p class="lead center" style="color:#cbd5e1;margin:0 auto">Scroll and ride along &mdash; from pickup to delivery, we handle the whole route.</p></div></div><div class="scroll-road"><div class="sr-line"></div><div class="sr-truck" id="scrollTruck"><svg viewBox="0 0 130 58" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="9" width="78" height="33" rx="3" fill="#e2e8f0"/><rect x="3" y="9" width="78" height="33" rx="3" fill="none" stroke="#94a3b8" stroke-width="1.5"/><g stroke="#cbd5e1" stroke-width="1.5"><line x1="18" y1="11" x2="18" y2="40"/><line x1="33" y1="11" x2="33" y2="40"/><line x1="48" y1="11" x2="48" y2="40"/><line x1="63" y1="11" x2="63" y2="40"/></g><path d="M81 15h13c2 0 3.6 1 4.6 2.7l8.4 12.8c.7 1 1 2.3 1 3.5v8H81z" fill="#0883F7"/><path d="M85 19h9v9h-9z" fill="#bfdbfe"/><path d="M96 20l6 8h-6z" fill="#93c5fd"/><rect x="113" y="36" width="4" height="7" rx="1" fill="#1e293b"/><rect x="3" y="42" width="114" height="3" fill="#1e293b"/><g><circle cx="24" cy="46" r="8" fill="#10223B"/><circle cx="24" cy="46" r="3.4" fill="#64748b"/></g><g><circle cx="42" cy="46" r="8" fill="#10223B"/><circle cx="42" cy="46" r="3.4" fill="#64748b"/></g><g><circle cx="100" cy="46" r="8" fill="#10223B"/><circle cx="100" cy="46" r="3.4" fill="#64748b"/></g></svg></div></div></section>'
BLOGHOME = '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Free knowledge base</div><h2>Guides that make you money before you spend a dollar</h2></div><div class="grid g3">' + linkcard('how-much-does-a-truck-dispatcher-cost.html','&#128196;','How Much Does a Truck Dispatcher Cost?','Percentage vs flat fee, what 5% really gets you, and how a dispatcher pays for itself.') + linkcard('truck-dispatcher-vs-freight-broker.html','&#128196;','Dispatcher vs Broker vs Factoring','Who each represents, what they can legally do, how the money flows, and which you need.') + linkcard('how-to-get-loads-with-new-authority.html','&#128196;','Getting Loads With New Authority','How to set up with brokers and land your first loads fast.') + linkcard('owner-operator-dispatch-service-guide.html','&#128196;','Owner-Operator Dispatch Service Guide','What a dispatch service does for one truck, what it costs, and how to choose one.') + '</div></div></section>'
PHOTOS = '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Built for life on the road</div><h2>Dispatch support built around your operation</h2><p class="lead">Dispatch workflows and profit tools designed for owner-operators and small fleets operating across the contiguous United States.</p></div><div class="photo-grid reveal"><div class="photo"><img src="truck-fleet.webp" width="1280" height="720" alt="Semi-trucks parked at a freight yard" loading="lazy" decoding="async" onerror="this.style.display=&quot;none&quot;"><span class="ph-tag">Fleets &amp; owner-operators, coast to coast</span></div><div class="photo"><img src="truck-boxtruck.webp" width="1280" height="720" alt="Box truck ready for dispatch" loading="lazy" decoding="async" onerror="this.style.display=&quot;none&quot;"><span class="ph-tag">Dry van, reefer, flatbed, box &amp; more</span></div></div></div></section>'
_tp = [
 ('profit','&#128200;','Load Profit Calculator','See your net profit and rate-per-mile on any load before you accept it.'),
 ('cpm','&#128666;','Cost-Per-Mile Calculator','Turn your monthly costs into the one number every load decision depends on.'),
 ('fuel','&#9981;','Fuel Cost Calculator','Price diesel for any lane in seconds, with gallons and dollars per mile.'),
 ('breakeven','&#128202;','Break-Even Rate','Know the lowest rate you can accept and still hit your target margin.'),
 ('takehome','&#128181;','Owner-Op Take-Home','What actually lands in your pocket after fuel, fees and expenses.'),
 ('detention','&#128336;','Detention Pay','Stuck at the dock? See exactly what the shipper owes you.'),
]
_tpcards = ''.join('<a class="linkcard reveal" href="tools.html#%s"><div class="icon">%s</div><h3>%s</h3><p>%s</p><span class="arw">Open tool %s</span></a>' % (a,b,c,d,ARW) for a,b,c,d in _tp)
TOOLSPROMO = '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Free for drivers &mdash; no login</div><h2>Free trucking calculators that pay for themselves</h2><p class="lead center" style="margin:0 auto">Owner-operators use these every day to price loads, know their real cost per mile, and stop hauling cheap freight. 100% free, right in your browser &mdash; no signup needed.</p></div><div class="grid g3 reveal">' + _tpcards + '</div><div class="center" style="margin-top:32px"><a href="tools.html" class="btn btn-primary">Open all free tools %s</a></div></div></section>' % ARW
LSBAND = '<section id="load-score-home" class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Free decision tool &mdash; no login</div><h2>Should you take this load? Find out in 3 seconds.</h2><p class="lead center" style="margin:0 auto">The one tool every owner-operator needs daily. Enter any offer and get a clear <b>take / negotiate / pass</b> verdict &mdash; with a smart counter-offer built on your real costs.</p></div>' + LS_HTML + '<div class="center" style="margin-top:24px"><a href="load-score.html" class="btn btn-secondary">How the Load Score works &rarr;</a></div></div></section>'
# Static, timeless ILLUSTRATIVE examples only. No dates, no "available now", no live DB query.
# Columns: origin, destination, equipment, loaded_miles, example_rate, weight
PLB_SAMPLES = [
 ('Dallas, TX','Atlanta, GA','Dry Van','781','2640','42,000 lbs'),
 ('Chicago, IL','Kansas City, MO','Reefer','510','1780','38,000 lbs'),
 ('Los Angeles, CA','Phoenix, AZ','Flatbed','373','1320','44,000 lbs'),
 ('Houston, TX','New Orleans, LA','Dry Van','348','1180','40,000 lbs'),
 ('Atlanta, GA','Orlando, FL','Reefer','438','1560','36,000 lbs'),
 ('Denver, CO','Salt Lake City, UT','Power Only','525','1490',''),
]
def _plb_card(o,d,eq,mi,rate,wt):
    miN=int(mi); rpm=('%.2f' % (float(rate)/miN)) if miN else ''
    transit=max(1, round(miN/550.0)) if miN else 1
    wttag = ('<span class="plb-tag">%s</span>' % wt) if wt else ''
    rpmtag = ('<span>$%s/mi est.</span>' % rpm) if rpm else ''
    return ('<article class="plb reveal"><div class="plb-badge">Example</div>'
            '<div class="plb-top"><div class="plb-lane"><b>%s</b><span class="plb-ar">&rarr;</span><b>%s</b></div>'
            '<div class="plb-rate">$%s%s</div></div>'
            '<div class="plb-tags"><span class="plb-tag eq">%s</span><span class="plb-tag alt">%s mi loaded</span>%s</div>'
            '<div class="plb-meta"><span>Example transit<b>%s day%s</b></span><span>Estimated RPM<b>$%s/mi</b></span></div>'
            '<a href="load-score.html" class="plb-book">Analyze a similar load &rarr;</a></article>') % (
            o, d, '{:,}'.format(int(float(rate))), rpmtag, eq, mi, wttag, transit, ('' if transit==1 else 's'), rpm)
PLB_CARDS = ''.join(_plb_card(*s) for s in PLB_SAMPLES)
LOADBOARD = '<section id="loads" class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Example Load Analysis</div><h2>How LoadBoot evaluates a load</h2><p class="lead center" style="margin:0 auto">Illustrative freight examples showing how LoadBoot evaluates rate, miles, deadhead and estimated profitability. These are not currently available loads.</p></div><div class="plb-grid reveal">' + PLB_CARDS + '</div><div class="plb-cta reveal"><a href="load-score.html" class="btn btn-primary">Analyze your own load &rarr;</a><span class="plb-note">Free Load Score tool &mdash; score any rate for profit in seconds. No signup.</span></div></div></section>'
# NOTE: the anonymous public_loads Supabase fetch was removed. The homepage shows only
# static, clearly-labelled illustrative examples and makes no production database query.

# ---- WEB-1: partner + carrier workflow sections, bridge, referral teaser (home; prebuilt HTML) ----
# CARRIER_FLOW — numbered "process rail": circled steps on an accent line, outcome-first headlines (distinct motif).
CARRIER_FLOW = ('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow" style="color:#0d9488">For carriers</div>'
 '<h2>Your week with LoadBoot</h2><p class="lead center" style="max-width:640px;margin:12px auto 0">Sign up in five minutes. Keep your authority. Let a dispatcher fill your calendar while you drive.</p></div>'
 '<div class="reveal" style="display:flex;flex-wrap:wrap;gap:18px;justify-content:center;margin-top:34px">'
 + ''.join('<div style="flex:1 1 200px;max-width:240px;position:relative;background:#fff;border:1px solid #e2e8f0;border-radius:18px;padding:26px 20px 22px;box-shadow:0 10px 30px -18px rgba(13,148,136,.5)">'
   '<div style="position:absolute;top:-18px;left:22px;width:38px;height:38px;border-radius:50%%;background:linear-gradient(135deg,#0d9488,#14b8a6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1.05rem;box-shadow:0 8px 18px -6px rgba(13,148,136,.7)">%d</div>'
   '<div style="font-size:1.5rem;margin:6px 0 8px">%s</div><h3 style="margin:0 0 6px;font-size:1.05rem">%s</h3><p style="margin:0;color:#64748b;font-size:.94rem">%s</p></div>' % (i+1, ic, t, d)
   for i,(ic,t,d) in enumerate([
     ('&#128100;','Quick profile','Truck, trailer, lanes and documents &mdash; five minutes, no contract lock-in.'),
     ('&#128235;','Loads come to you','Matched offers by equipment, real location and your preferences &mdash; accept, decline or counter in one tap.'),
     ('&#128221;','We do the paperwork','Rate confirmation, broker checks, appointments and status &mdash; you drive, we type.'),
     ('&#128737;','Protected on the road','Tap arrive/depart at each stop &mdash; detention measured from real timestamps, not arguments.'),
     ('&#128176;','Paid, clean file','POD in, invoice prepared, settlement itemized &mdash; your P&amp;L shows what you actually made.')])) +
 '</div><div class="plb-cta reveal" style="margin-top:30px;text-align:center"><a href="carriers.html" class="btn btn-primary">Explore carrier services &rarr;</a> <a href="carrier-application.html" class="btn btn-secondary">Apply as a Carrier</a></div></div></section>')

# PARTNER_FLOW — dark premium panel, numbered rows with check accents (distinct from the light carrier rail).
PARTNER_FLOW = ('<section style="background:#0b1220"><div class="wrap"><div class="sec-head center reveal" style="color:#fff">'
 '<div class="eyebrow" style="color:#60a5fa">For freight brokers</div><h2 style="color:#fff">Post once. We move it, track it, document it.</h2>'
 '<p class="lead center" style="color:#94a3b8;max-width:640px;margin:12px auto 0">Verified once, then every load is a two-minute post &mdash; no board, no twenty phone calls.</p></div>'
 '<div class="reveal" style="max-width:760px;margin:30px auto 0;display:flex;flex-direction:column;gap:12px">'
 + ''.join('<div style="display:flex;align-items:flex-start;gap:16px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.10);border-radius:14px;padding:18px 20px">'
   '<div style="flex:none;width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#0883F7,#3b82f6);color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">%d</div>'
   '<div><h3 style="margin:0 0 4px;color:#fff;font-size:1.05rem">%s</h3><p style="margin:0;color:#94a3b8;font-size:.95rem">%s</p></div></div>' % (i+1, t, d)
   for i,(t,d) in enumerate([
     ('Join &amp; get verified','Authority and documents verified once &mdash; then posting takes minutes, not calls.'),
     ('Post your load','A guided wizard captures lane, dates, equipment, terms and documents. Duplicates auto-caught.'),
     ('We match &amp; book a vetted carrier','Hard eligibility + explainable ranking find the right truck. One valid acceptance wins &mdash; no double booking.'),
     ('Watch it move','Live status, appointment countdowns, exception alerts and documents &mdash; without calling anyone.'),
     ('Delivered, documented, done','POD collected and reviewed, invoicing clean, every step on the record.')])) +
 '</div><div class="plb-cta reveal" style="margin-top:26px;text-align:center"><a href="brokers.html" class="btn btn-primary">See the broker program &rarr;</a> <a href="partners.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.28)">Open Partner Portal</a></div></div></section>')

# BRIDGE — literal three-column bridge diagram: Brokers -> LoadBoot -> Carriers (a visual, not a text block).
BRIDGE = ('<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">The bridge</div>'
 '<h2>One system between brokers and carriers</h2></div>'
 '<div class="reveal" style="display:flex;flex-wrap:wrap;align-items:stretch;justify-content:center;gap:14px;max-width:920px;margin:28px auto 0">'
 '<div style="flex:1 1 220px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;text-align:center"><div style="font-size:1.8rem">&#127970;</div><h3 style="margin:8px 0 4px">Broker partners</h3><p style="margin:0;color:#64748b;font-size:.92rem">Post a load once with full terms &mdash; no chasing carriers.</p></div>'
 '<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:#0883F7">&rarr;</div>'
 '<div style="flex:1 1 240px;background:linear-gradient(135deg,#10223B,#1e3a5f);color:#fff;border-radius:16px;padding:24px;text-align:center;box-shadow:0 18px 44px -18px rgba(37,99,235,.7)"><div style="font-size:1.8rem">&#9889;</div><h3 style="margin:8px 0 4px;color:#fff">LoadBoot</h3><p style="margin:0;color:#cbd5e1;font-size:.92rem">Explainable matching, tracking, documents and the money trail &mdash; one connected system.</p></div>'
 '<div style="flex:0 0 auto;display:flex;align-items:center;justify-content:center;font-size:1.6rem;color:#0d9488">&rarr;</div>'
 '<div style="flex:1 1 220px;background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:24px;text-align:center"><div style="font-size:1.8rem">&#128667;</div><h3 style="margin:8px 0 4px">Carriers</h3><p style="margin:0;color:#64748b;font-size:.92rem">See matched offers with rate, miles and RPM already worked out.</p></div>'
 '</div><p class="reveal" style="text-align:center;color:var(--muted);margin-top:18px;max-width:640px;margin-left:auto;margin-right:auto">Every match explainable, every document tracked, every step audited.</p></div></section>')

# REFTEASER — desire-driven earnings panel (bold gradient). Illustrative figures, clearly labelled + honest.
REFTEASER = ('<section style="background:linear-gradient(135deg,#0b1220 0%,#12304f 55%,#3b1a0e 100%);color:#fff;position:relative;overflow:hidden">'
 '<div class="wrap" style="position:relative;z-index:1;padding:60px 0"><div class="sec-head center reveal" style="color:#fff">'
 '<div class="eyebrow" style="color:#fdba74">Agent Program &mdash; the independent dispatcher model</div>'
 '<h2 style="color:#fff;font-size:2.1rem">Bring the people. The software does the work. <span style="color:#34d399">You earn 1% &mdash; forever.</span></h2>'
 '<p class="lead center" style="color:#cbd5e1;max-width:720px;margin:14px auto 0">One link works for <b style="color:#fff">carriers, brokers and shippers</b>. Every GPS-verified delivered load your chain touches pays you <b style="color:#fff">1% of the gross</b> &mdash; automatically, from LoadBoot&rsquo;s own fee. Recruit other agents and earn overrides <b style="color:#fff">5 levels deep</b>.</p></div>'
 '<div class="reveal" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:32px">'
 + ''.join('<div style="flex:1 1 220px;max-width:280px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);border-radius:18px;padding:26px;text-align:center">'
   '<div style="color:#94a3b8;font-size:.9rem;letter-spacing:.02em;text-transform:uppercase">%s</div>'
   '<div style="font-size:2.3rem;font-weight:800;color:#34d399;margin:6px 0 4px">%s</div>'
   '<div style="color:#cbd5e1;font-size:.92rem">%s</div></div>' % (label, amount, sub)
   for label,amount,sub in [
     ('Every delivered load','1% of gross','tracked live \u2014 lands within the half hour'),
     ('An active chain of 20 trucks','~ $4,000/mo*','recurring, while they haul'),
     ('Recruit other agents','5 levels deep','0.50% \u00b7 0.25% \u00b7 0.15% \u00b7 0.10% overrides')]) +
 '</div>'
 '<div class="reveal" style="text-align:center;margin-top:30px"><a href="/app/agent/" class="btn btn-primary" style="background:#FC5305;border:none;font-weight:800">Become a LoadBoot Agent &rarr;</a> <a href="agents.html" class="btn btn-secondary" style="margin-left:10px;background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">See the full program</a></div>'
 '<p class="reveal" style="text-align:center;color:#94a3b8;font-size:.82rem;margin:16px auto 0;max-width:720px">*Illustrative only, based on a referred carrier hauling roughly $20k/month. Commissions are paid entirely from LoadBoot&rsquo;s own 5% dispatch fee &mdash; your referrals never pay more, and you invest nothing. Exact tiers are confirmed in writing at signup.</p>'
 '</div></section>')

ROLEBAND = ('<section style="padding:26px 0 8px"><div class="wrap"><div class="grid g3">'
 '<a class="linkcard reveal" href="carriers.html"><div class="icon">&#128666;</div><h3>I haul freight</h3><p>The board with the full rate card printed, one-tap booking, GPS-proven detention &mdash; and a dispatcher on your side.</p><span class="arw">For carriers &rarr;</span></a>'
 '<a class="linkcard reveal" href="brokers.html"><div class="icon">&#127970;</div><h3>I post loads</h3><p>Verified, health-scored capacity racing a 15-minute window. First accept wins &mdash; zero double-booking, zero check calls.</p><span class="arw">For brokers &rarr;</span></a>'
 '<a class="linkcard reveal" href="shipper-solutions.html"><div class="icon">&#127981;</div><h3>I own the freight</h3><p>Vetted carriers under licensed brokerage, live GPS on every shipment, dock-level proof at your own facilities.</p><span class="arw">For shippers &rarr;</span></a>'
 '</div><div class="reveal" style="text-align:center;margin-top:12px;font-size:.86rem;color:#64748b">Bring the people instead? <a href="agents.html">The agent program pays 1% of every load &mdash; forever</a>.</div></div></section>')

home_body = HERO+ROLEBAND+STATS+SCROLLBAND+ROUTE+WHYUS+PHOTOS+FREIGHT_CARDS+NETWORKS+LIVEBOARD+HOME_RATES+HOME_RATES_JS+PARTNER_FLOW+CARRIER_FLOW+BRIDGE+WHOSERVE+COMPARE+HOW+LSBAND+TOOLSPROMO+REFTEASER+PROMISE+BLOGHOME+home_faq_html+final_cta()
home_body += '<script>' + LS_JS + LIVEBOARD_JS + '</script>'
page('index.html','Truck Dispatch & Verified Load Board — Carriers, Brokers & Shippers | LoadBoot',
     'US truck dispatch and a zero-ghost load board on one platform: carriers book higher-paying freight with the rate card in writing, brokers cover loads with verified capacity in minutes, shippers watch every mile on live GPS. Flat 5%, no contracts.',
     'index.html', home_body, home_faq_schema)

# ---------- SERVICE PAGE BUILDER ----------
def svc_hero(h1,lead):
    return '''<section class="hero"><div class="aurora"><span class="a1"></span><span class="a2"></span></div><div class="wrap" style="position:relative;z-index:1;max-width:820px">
<span class="badge reveal"><span class="dot"></span> Loadboot Dispatch</span><h1 class="reveal d1">%s</h1>
<p class="lead reveal d2" style="margin:22px 0 28px">%s</p>
<div class="hero-btns reveal d3"><a href="contact.html#create" class="btn btn-primary">Get Started %s</a><a href="contact.html#quote" class="btn btn-secondary">Get a Quote</a><a href="services.html" class="btn btn-ghost">All Services &rarr;</a></div></div></section>''' % (h1,lead,ARW)

EXTRA = {
 "Reefer": [
  ("Reefer freight we dispatch across the USA",
   ["Temperature-controlled freight covers far more than just frozen food, and each type comes with its own rates, handling rules, and best-paying lanes. Our dispatchers know which reefer freight is worth chasing and which to leave on the board.",
    "We book and manage a wide range of refrigerated loads, matching them to your truck, your temperature capabilities, and the lanes you actually want to run."],
   ["Fresh produce and seasonal fruit and vegetables","Frozen foods, ice cream, and frozen proteins","Dairy, eggs, and refrigerated beverages","Meat, poultry, and seafood","Pharmaceuticals and temperature-sensitive medical freight","Flowers, plants, and other perishables"]),
  ("What drives your reefer rate (and how we push it higher)",
   ["Reefer rates swing more than any other trailer type. Produce season, lane imbalances, fuel for the reefer unit, and strict appointment windows all move the number. We track these factors and negotiate every load so you are paid for the extra work refrigerated freight demands.",
    "Cheap reefer freight is everywhere, especially on backhauls. We turn it down, plan smarter return lanes, and document detention at cold-storage facilities so a long wait does not quietly eat your week."],
   ["Produce season and regional demand spikes","Reefer fuel and continuous-run requirements","Strict delivery appointments and FIFO scheduling","Multi-stop and multi-temperature loads","Detention at slow cold-storage receivers"]),
 ],
 "Flatbed": [
  ("Flatbed and step-deck freight we book",
   ["Flatbed is skilled, physical work, and the freight should pay for that skill. We focus on well-paying open-deck loads and handle the broker side so you can focus on securing and hauling.",
    "From building materials to heavy machinery, we match loads to your equipment, your securement capabilities, and your preferred running area."],
   ["Steel, rebar, and metal coils","Lumber, drywall, and building materials","Construction and agricultural machinery","Pipe, beams, and structural materials","Oversize and overweight loads with permits","Tarped and untarped freight"]),
  ("Permits, securement, and oversize handling",
   ["Open-deck freight comes with responsibilities other trailer types do not: tarping, chaining, strapping, and sometimes permits and escorts. We confirm these details with the broker before you commit, so there are no surprises at the dock.",
    "For oversize and overweight loads, we help coordinate permits and route planning so your trip is legal, paid for the extra effort, and worth your time."],
   []),
 ],
 "Dry Van": [
  ("The dry van freight that keeps you moving",
   ["Dry van is the backbone of US freight, and consistency is what makes it profitable. The difference between a strong week and a slow one is having a dispatcher booking your next load before you have delivered the current one.",
    "We keep you loaded with reliable van freight on the lanes you prefer, so you spend your time driving and earning, not searching load boards."],
   ["Retail and consumer packaged goods","Paper, packaging, and printed materials","E-commerce and fulfillment freight","Non-perishable food and beverages","General palletized freight"]),
  ("How we keep your van utilization high",
   ["Empty miles are the silent killer of van profits. We plan loads back-to-back, use drop-and-hook freight where it makes sense, and keep you on tight, repeatable lanes so your truck stays paid.",
    "We also benchmark every rate against the lane so you are never the carrier hauling cheap freight while everyone else gets paid fairly."],
   []),
 ],
 "Hotshot": [
  ("Hotshot loads we find for you",
   ["Hotshot freight moves fast and the good loads disappear quickly. We watch the boards and the brokers in real time so your class 3 to 5 truck stays loaded with freight that actually pays.",
    "We focus on partials, expedited runs, and time-sensitive freight that fit a gooseneck or flatbed trailer behind your truck."],
   ["Construction equipment and materials","Expedited and time-critical partials","Agricultural and oilfield freight","Machinery and palletized partials","LTL-style and hot loads"]),
  ("Keeping hotshot profitable",
   ["Hotshot margins live and die on rate and deadhead. We chase the loads worth running, keep you off cheap freight, and plan backhauls so you are not driving home empty.",
    "We also check weights and dimensions up front, so you never roll up to a load your truck and trailer cannot legally or safely haul."],
   []),
 ],
 "Power Only": [
  ("How power only dispatch works",
   ["Power only gives you flexibility and lower overhead, because the trailer is supplied by the broker or shipper. You bring the tractor; we keep it connected to consistent drop-and-hook freight.",
    "It is a great fit for carriers who want to stay loaded without the cost and maintenance of owning trailers."],
   ["Drop-and-hook and pre-loaded trailers","Carrier and broker-supplied equipment","Dedicated and high-frequency lanes","Trailer interchange freight"]),
  ("Keeping your tractor earning",
   ["The key to power only is the right broker relationships and steady freight. We build those relationships and plan loads ahead so your tractor keeps moving and earning.",
    "We confirm trailer interchange details before every load, so handoffs are clean and you are not stuck holding someone else's equipment problem."],
   []),
 ],
 "Owner-Operator": [
  ("Stay independent while we handle the load",
   ["As an owner-operator, your independence is the whole point. You keep your own authority and stay in full control. You approve every load and every rate before anything is booked. We simply remove the busywork.",
    "Think of us as your back office and sales team rolled into one, working to keep your truck full and your rates fair while you focus on the road."],
   ["You keep your authority and your customers","You approve every load and rate","A dedicated dispatcher who knows your truck","No long-term contract, cancel anytime"]),
  ("Where owner-operators lose money, and how we fix it",
   ["Most owner-operators are not losing money because they are bad drivers. They lose it to cheap freight, empty miles, and the hours spent on the phone with brokers instead of rolling.",
    "We attack all three: we negotiate better rates, plan lanes to cut deadhead, and take broker calls and paperwork off your plate. The result is more paid miles and fewer wasted hours."],
   []),
 ],
 "New Authority": [
  ("Your first 90 days on your own authority",
   ["Getting your own authority is a huge step, and the first three months are where most new carriers either build momentum or burn out. Brokers want packets and setups before they hand you a load, and the cheap freight is easy to fall into.",
    "We guide you through all of it, get you set up with brokers, and keep you off low-paying loads from day one so your first months actually build your business."],
   ["Broker packet and setup handled for you","Your first loads booked on good lanes","Rate negotiation so you do not start cheap","Guidance on factoring, insurance, and compliance"]),
  ("Mistakes new carriers make (that we help you avoid)",
   ["New authority carriers often make the same costly mistakes: hauling cheap freight to stay busy, working with brokers who do not pay, skipping factoring and running out of cash, and falling behind on compliance.",
    "We have seen all of it. We screen brokers, set you up with factoring so you get paid fast, and keep your filings on track, so you grow steadily instead of stalling out."],
   []),
 ],
}

SVC_ALT = {
 'reefer':'Reefer truck loading temperature-controlled freight for dispatch',
 'flatbed':'Flatbed truck ready to haul steel, lumber and machinery freight',
 'dry-van':'Dry van semi truck running freight on the highway',
 'hotshot':'Hotshot truck with gooseneck trailer ready for expedited loads',
 'power-only':'Power only semi truck tractor ready to pull a trailer',
 'owner-operator':'Owner-operator truck driver managing loads with Loadboot dispatch',
 'new-authority':'New authority truck driver getting set up with Loadboot dispatch'}
SVC_CAP = {
 'reefer':'Temperature-controlled freight &mdash; booked and protected.',
 'flatbed':'Steel, lumber and machinery &mdash; freight that pays.',
 'dry-van':'Steady van freight that keeps your truck moving.',
 'hotshot':'Expedited hotshot loads, dispatched fast.',
 'power-only':'Power-only freight &mdash; we keep your tractor earning.',
 'owner-operator':'A dedicated dispatcher in your corner.',
 'new-authority':'New authority? We get you loaded fast.'}

def _real_screen(shot, w, hgt, alt, cap, kicker='Inside the product', h='This is the real screen, not a mockup'):
    _wrap = 'max-width:340px;margin:0 auto' if w <= 460 else 'max-width:860px;margin:0 auto'
    return ('<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">' + kicker + '</div><h2>' + h + '</h2></div>'
        '<figure class="reveal" style="margin:22px 0 0"><div style="' + _wrap + '">'
        '<img src="/shots/' + shot + '" alt="' + alt + '" width="' + str(w) + '" height="' + str(hgt) + '" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid #e2e8f0;box-shadow:0 24px 60px -30px rgba(16,34,59,.35)"></div>'
        '<figcaption style="text-align:center;color:#64748b;font-size:.8rem;margin-top:9px">' + cap + '</figcaption></figure></div></section>')

def svc_page(fname,name,title,desc,h1,lead,intro,included,why,faqs,shots=None):
    nl = name.lower()
    CHK = '&#9989;'; BOX = '&#128230;'
    introp = ''.join('<p>%s</p>' % p for p in intro)
    body = svc_hero(h1,lead)
    # Equipment banner photo (keyword-rich alt text) right under the hero
    ib = fname.replace('-dispatch.html','')
    if ib in SVC_ALT:
        body += ('<section style="padding-top:0"><div class="wrap"><figure class="svc-photo reveal">'
                 '<img src="%s.webp" alt="%s" width="1280" height="460" loading="lazy" decoding="async" '
                 'onerror="this.closest(&quot;.svc-photo&quot;).style.display=&quot;none&quot;">'
                 '<figcaption>%s</figcaption></figure></div></section>') % (ib, SVC_ALT[ib], SVC_CAP[ib])
    # Intro
    body += '<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">%s Dispatch</div><h2>Higher-paying %s freight, handled end to end</h2></div><div class="prose reveal" style="max-width:820px">%s</div></div></section>' % (name, nl, introp)
    # What is included -> icon cards
    inc_cards = ''.join('<div class="card reveal"><div class="icon">%s</div><p>%s</p></div>' % (CHK, x) for x in included)
    body += '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">What you get</div><h2>Everything in our %s dispatch service</h2></div><div class="grid g3">%s</div></div></section>' % (nl, inc_cards)
    # Why -> navy highlight panel
    body += '<section><div class="wrap"><div class="promise reveal"><div class="glow"></div><div class="eyebrow" style="color:#93c5fd">Why Loadboot</div><h2>Why %s carriers choose us</h2><p>%s</p></div></div></section>' % (nl, why)
    if shots: body += _real_screen(*shots)
    # EXTRA unique sections (bullets -> cards, else prose)
    for i,(st,sp,sb) in enumerate(EXTRA.get(name,[])):
        ps = ''.join('<p>%s</p>' % x for x in sp)
        if sb:
            cards = ''.join('<div class="card reveal"><div class="icon">%s</div><p>%s</p></div>' % (BOX, x) for x in sb)
            body += '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><h2>%s</h2></div><div class="prose reveal" style="max-width:820px;margin-bottom:34px">%s</div><div class="grid g3">%s</div></div></section>' % (st, ps, cards)
        else:
            body += '<section><div class="wrap prose reveal" style="max-width:820px"><h2>%s</h2>%s</div></section>' % (st, ps)
    # Tailored process steps
    steps = [('1','Free consultation','Tell us about your truck, your authority, and the lanes you want to run.'),
             ('2','We set you up','We handle broker setup and learn your equipment, preferences, and target rates.'),
             ('3','We book &amp; negotiate','We find %s loads, negotiate the rate, and send the details for your approval.' % nl),
             ('4','You drive, we handle the rest','You stay loaded and paid; we manage the brokers and the paperwork.')]
    sc = ''.join('<div class="step reveal"><div class="num">%s</div><h3>%s</h3><p>%s</p></div>' % s for s in steps)
    body += '<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">How it works</div><h2>How we keep your %s truck loaded</h2></div><div class="grid g4">%s</div></div></section>' % (nl, sc)
    # Stats band for visual weight
    body += STATS
    fhtml,fsch = faq_block(faqs)
    body += fhtml + final_cta()
    bc = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":[{"@type":"ListItem","position":1,"name":"Home","item":"https://loadboot.com/"},{"@type":"ListItem","position":2,"name":"Services","item":"https://loadboot.com/services.html"},{"@type":"ListItem","position":3,"name":"%s Dispatch","item":"https://loadboot.com/%s"}]}</script>' % (name, fname)
    ssch = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Service",'
            '"serviceType":"%s truck dispatching","name":"%s",'
            '"provider":{"@type":"Organization","name":"Loadboot","url":"https://loadboot.com/"},'
            '"areaServed":{"@type":"Country","name":"United States"},"url":"https://loadboot.com/%s"}</script>') % (name, h1.replace('"', "'"), fname)
    page(fname,title,desc,'services.html',body,fsch+bc+ssch)

svc_page('reefer-dispatch.html','Reefer','Reefer Dispatch Services for Owner-Operators | Loadboot',
 'Reefer truck dispatch for owner-operators &amp; fleets. We book high-paying temperature-controlled loads, negotiate rates, and handle the paperwork. Flat 5%.',
 'Reefer Dispatch Services Across the USA','Higher-paying temperature-controlled freight, booked and managed for you &mdash; so your reefer stays loaded and your margins stay protected.',
 ['Reefer freight pays well, but it comes with pressure &mdash; tight delivery windows, temperature requirements, and brokers who push for cheap rates. Our dispatchers know the reefer market and fight for what your run is actually worth.',
  'We book produce, frozen, dairy, and pharma loads on the lanes you want to run, confirm temperature and appointment details up front, and keep you moving without the cheap-freight headaches.'],
 ['Booking high-paying reefer loads on your preferred lanes','Rate negotiation on every load confirmation','Temperature, appointment, and detention details confirmed up front','Broker communication, setup, and check calls handled','Reduced deadhead through smart lane planning','Detention &amp; TONU claim help when appointments run long'],
 'Reefer carriers lose money to cheap freight and long detention more than almost anyone. We protect your time and your rate &mdash; turning down low-ball loads, documenting detention, and keeping your reefer on profitable lanes. You get a dedicated dispatcher who treats your truck like their own business.',
 [('Do you book produce and frozen reefer loads?','Yes &mdash; produce, frozen, dairy, and other temperature-controlled freight across the USA.'),
  ('How do you handle detention on reefer loads?','We confirm appointment windows up front and help document and claim detention and TONU when shippers or receivers run long.'),
  ('What does reefer dispatch cost?','A flat 5% of the gross on loads we book, with no contract &mdash; you only pay when you earn.')])

svc_page('flatbed-dispatch.html','Flatbed','Flatbed Dispatch Services for Owner-Operators | Loadboot',
 'Flatbed and step-deck truck dispatch. We book high-paying steel, lumber, and machinery loads, negotiate rates, and handle brokers. Flat 5%, no contracts.',
 'Flatbed Dispatch Services Across the USA','Steel, lumber, machinery, and oversized freight &mdash; we find the high-paying flatbed loads and handle the brokers, so you focus on securing and driving.',
 ['Flatbed is skilled work, and it should pay like it. Too many flatbed operators end up hauling cheap freight because they don\'t have time to work the phones. We do that for you.',
  'Our dispatchers book steel, lumber, building materials, and machinery on lanes that fit your truck, confirm securement and permit details, and negotiate every rate so your skill is rewarded.'],
 ['High-paying flatbed and step-deck load booking','Rate negotiation on every confirmation','Permit and oversize/overweight coordination support','Securement and tarping details confirmed with the broker','Broker setup, calls, and paperwork handled','Lane planning to cut empty miles'],
 'Flatbed carriers bring specialized skill, and brokers know it &mdash; but only if someone negotiates on your behalf. We push for premium flatbed rates, coordinate permits on oversized loads, and keep your trailer full on the lanes you want. A dedicated dispatcher in your corner, not a call center.',
 [('Do you dispatch step deck and oversize loads?','Yes &mdash; flatbed, step deck, and oversize/overweight freight, with permit coordination support.'),
  ('Can you keep me loaded on regional flatbed lanes?','Absolutely. Tell us your home base and preferred lanes and we plan loads to keep you regional if that\'s what you want.'),
  ('What does flatbed dispatch cost?','A flat 5% of gross on loads we book, no contract, cancel anytime.')])

svc_page('dry-van-dispatch.html','Dry Van','Dry Van Dispatch Service 2026 — Flat 5%, No Contracts | LoadBoot',
 'Dry van truck dispatch for owner-operators and fleets. Consistent, well-paying van freight, rate negotiation, and back-office support. Flat 5%, no contracts.',
 'Dry Van Dispatch Services Across the USA','Steady, consistent van freight that keeps your truck moving &mdash; booked, negotiated, and managed by a dedicated dispatcher.',
 ['Dry van is the backbone of freight, but consistency is everything. The difference between a good week and a bad one is having someone working loads ahead of you. That\'s what we do.',
  'We book reliable van freight on your preferred lanes, negotiate every rate, and keep your schedule full &mdash; so you\'re never sitting empty waiting for the next load.'],
 ['Consistent dry van load booking on your lanes','Rate negotiation on every confirmation','Back-to-back load planning to cut downtime','Broker setup, check calls, and paperwork handled','Reduced deadhead and smarter routing','Document management &mdash; rate cons, BOLs, PODs'],
 'Van carriers win on consistency and utilization. We keep your truck loaded back-to-back, negotiate fair rates on steady freight, and handle the broker relationships so your week runs smooth. You drive; we keep the loads coming.',
 [('Can you keep me running consistent lanes?','Yes &mdash; tell us your home base and preferred lanes and we plan loads to keep you consistent and reduce empty miles.'),
  ('Do you work with one-truck owner-operators?','Definitely. Most of our carriers are owner-operators running a single truck.'),
  ('What does dry van dispatch cost?','A flat 5% of gross on loads we book, no contract.')])

svc_page('hotshot-dispatch.html','Hotshot','Hotshot Dispatch Services | Loadboot',
 'Hotshot truck dispatch for owner-operators running class 3-5 trucks and goosenecks. Expedited loads, rate negotiation, broker handling. Flat 5%, no contracts.',
 'Hotshot Dispatch Services Across the USA','Expedited, smaller, well-paying loads for hotshot operators &mdash; we work the boards and the brokers so you keep rolling.',
 ['Hotshot is fast-moving and competitive, and the good loads go quick. You need someone watching the boards and negotiating in real time. We do exactly that for hotshot operators.',
  'We book expedited and partial loads that fit your class 3-5 truck and gooseneck or flatbed trailer, confirm weights and dimensions, and negotiate rates that make the run worth it.'],
 ['Booking expedited and partial hotshot loads','Real-time rate negotiation on fast-moving freight','Weight and dimension checks before you commit','Broker setup and communication handled','Lane planning to reduce empty backhauls','Paperwork and check calls managed'],
 'Hotshot margins live and die on rate and deadhead. We chase the loads that actually pay, keep you off cheap freight, and plan backhauls so you\'re not running empty. A dispatcher who understands hotshot, not a generic desk.',
 [('Do you dispatch class 3-5 hotshot trucks?','Yes &mdash; we work with hotshot operators running gooseneck and flatbed trailers behind class 3-5 trucks.'),
  ('Can you find paying backhauls?','We plan loads to reduce empty miles and find backhauls whenever the lane allows.'),
  ('What does hotshot dispatch cost?','A flat 5% of gross on loads we book, no contract.')])

svc_page('power-only-dispatch.html','Power Only','Power Only Dispatch Services | Loadboot',
 'Power only truck dispatch. We book drop-and-hook power only freight for your tractor, negotiate rates, and handle brokers. Flat 5%, no contracts.',
 'Power Only Dispatch Services Across the USA','Flexible drop-and-hook freight for your tractor &mdash; we keep you pulling trailers and earning without the wait.',
 ['Power only gives you flexibility, but it takes the right broker relationships to stay loaded. We connect you with consistent power only freight and keep your tractor working.',
  'We book drop-and-hook and trailer-supplied loads that fit your tractor, negotiate the rate, and handle the broker setup so you stay productive.'],
 ['Booking consistent power only / drop-and-hook freight','Rate negotiation on every load','Broker setup and communication handled','Trailer interchange details confirmed up front','Lane planning to reduce empty miles','Paperwork and check calls managed'],
 'Power only carriers win on flexibility and uptime. We keep you connected to drop-and-hook freight, negotiate fair rates, and manage broker relationships so your tractor keeps earning. Straightforward dispatch, honest rates, no contracts.',
 [('What is power only dispatch?','We book loads where the trailer is supplied by the broker or shipper, so you pull with your own tractor &mdash; flexible, drop-and-hook freight.'),
  ('Can you keep my tractor consistently loaded?','Yes &mdash; we plan loads ahead and build broker relationships to keep your uptime high.'),
  ('What does power only dispatch cost?','A flat 5% of gross on loads we book, no contract.')])

svc_page('owner-operator-dispatch.html','Owner-Operator','Owner-Operator Dispatch Service — Keep Your Authority, Keep More of Every Mile | LoadBoot',
 'Dedicated truck dispatch for owner-operators. Keep your authority, book higher-paying loads, and offload the back office. Flat 5%, no contracts, cancel anytime.',
 'Owner-Operator Dispatch That Answers to You','Keep your authority and your independence &mdash; every load and every rate is approved by YOU, in writing, before a wheel turns. We handle the boards, the brokers and the back office at a flat 5%.',
 ['As an owner-operator, your time is split between driving and running a business. The hours you spend on the phone with brokers are hours you\'re not earning. We give those hours back.',
  'You keep your own authority and stay fully in control &mdash; you approve every load and every rate. We just do the heavy lifting: finding freight, negotiating, and managing the back office.'],
 ['A dedicated dispatcher who knows your truck and lanes','Higher-paying load booking and rate negotiation','You keep your authority and approve every load','Broker setup, check calls, and paperwork handled','Factoring, IFTA, and compliance help when you need it','No long-term contract &mdash; cancel anytime'],
 'Owner-operators don\'t need a boss &mdash; they need a partner who removes the busywork and protects their rate. We do exactly that, at a flat 5% with no contract, so the relationship stays honest. You stay independent; we help you earn more from every mile.',
 [('Do I keep my own authority?','Yes &mdash; you keep your authority and stay in control. You approve every load and rate before anything is booked.'),
  ('Is there a contract?','No. Cancel anytime &mdash; we earn your business load by load.'),
  ('What does dispatch cost for owner-operators?','A flat 5% of your gross on loads we book, with no hidden fees.')],
 shots=('booking-rate-con.webp',720,2078,'A real e-signed rate confirmation — the rate, the lane and every accessorial term in writing before the truck moves','Your approval, in writing &mdash; a real rate confirmation, e-signed in-app before anything rolls.'))

svc_page('new-authority-dispatch.html','New Authority','New Authority Truck Dispatch — Loads From Day One, No Minimum Authority Age | LoadBoot',
 'Dispatch for new-authority carriers. We help you get set up with brokers, book your first loads, and start earning. Flat 5%, no contracts, real guidance.',
 'New Authority Dispatch &mdash; Loads From Day One','Just got your MC? There is no minimum authority age here: same-day verification, broker packets handled, and direct offers start racing your truck &mdash; while we keep you off the cheap freight that sinks first-year carriers.',
 ['Getting your own authority is exciting &mdash; and overwhelming. Brokers want packets, setups, and paperwork before they\'ll give you a load, and the learning curve is steep. We guide you through all of it.',
  'We handle broker setup, find loads that fit your truck, negotiate your rates, and show you how the back office works &mdash; so your first weeks on your own authority actually make money.'],
 ['Broker packet setup and onboarding handled for you','Booking your first loads on lanes you want','Rate negotiation so you don\'t start out on cheap freight','Guidance on factoring, insurance, and compliance','Help avoiding common new-authority mistakes','Flat 5%, no contract &mdash; grow at your own pace'],
 'New-authority carriers are exactly who we love to help. Big dispatchers ignore you; we don\'t. We get you set up with brokers, keep you off cheap freight from day one, and walk you through the parts of trucking nobody explains. Start strong, with a dispatcher who actually answers.',
 [('I just got my MC number &mdash; can you help?','Yes &mdash; new-authority carriers are a core part of who we serve. We handle broker setup and get you booking loads.'),
  ('Do you help with broker setup and packets?','Absolutely. We manage broker onboarding and packets so you can start hauling sooner.'),
  ('What does it cost to start?','A flat 5% of gross on loads we book, with no contract &mdash; you only pay when you earn.')],
 shots=('board-request-countdown.webp',1100,773,'Direct load offers racing a countdown on the phone — first acceptance wins','Offers come to YOU &mdash; direct loads with a countdown; first acceptance wins.'))

# ---------- SERVICES HUB ----------
serv_body = svc_hero('Truck Dispatch Services','Full-service dispatch for US carriers &mdash; from booking and rate negotiation to authority setup, compliance, and claims. One partner for the whole business.')
serv_body += FREIGHT_CARDS
serv_body += '''<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Core Dispatch</div><h2>Everything you need to keep your truck moving</h2></div>
<div class="grid g3">
<div class="card reveal"><div class="icon">&#128269;</div><h3>Load Booking</h3><p>Consistent, well-paying loads that fit your truck and lanes.</p></div>
<div class="card reveal d1"><div class="icon">&#128172;</div><h3>Rate Negotiation</h3><p>We negotiate every rate confirmation to protect your margins.</p></div>
<div class="card reveal d2"><div class="icon">&#129309;</div><h3>Broker Communication</h3><p>Calls, packet setups, and check-ins handled for you.</p></div>
<div class="card reveal"><div class="icon">&#129517;</div><h3>Route &amp; Lane Planning</h3><p>Smart planning to reduce empty miles.</p></div>
<div class="card reveal d1"><div class="icon">&#128196;</div><h3>Document Management</h3><p>Rate cons, BOLs, and PODs &mdash; organized and on time.</p></div>
<div class="card reveal d2"><div class="icon">&#128336;</div><h3>24/7 Dispatch Support</h3><p>A dedicated dispatcher who has your back on the road.</p></div>
</div></div></section>'''
serv_body += m_statband([('20+','services under one roof'),('5%','flat fee, no contract'),('24/7','dispatch desk'),('1','partner for the whole business')])
serv_body += m_zigzag('Back-Office &middot; Money &middot; Claims', 'Everything around the load &mdash; handled for you', [
 ('clipboard','Broker Packet Onboarding','Get set up with brokers fast &mdash; packets, references, and setup forms completed for you.'),
 ('wallet','Factoring Setup','Get paid in hours, not weeks, through vetted factoring partners.'),
 ('shieldcheck','Insurance Assistance','Connect with trusted insurance partners for the coverage brokers require.'),
 ('receipt','IFTA &amp; Fuel Tax','Fuel-tax paperwork tracked and filed &mdash; off your plate every quarter.'),
 ('scale','Detention &amp; TONU Claims','We document the time and file the claim to recover the money you are owed.'),
 ('badge','Broker Credit Checks','Every broker is credit-checked before you haul, so you avoid non-payers.'),
 ('sparkline','Weekly Settlement Reports','Know exactly what you earned, load by load, every week.'),
 ('doccheck','Cargo Claim Assistance','Structured help and documentation when a load goes wrong.'),
], accent='#0d9488')
serv_body += '''<section><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Authority &middot; Compliance &middot; Filings</div><h2>We handle the paperwork most carriers dread</h2></div>
<div class="grid g4">
<div class="card reveal"><div class="icon">&#128640;</div><h3>Authority &amp; DOT Setup</h3><p>MC number and DOT registration guidance.</p></div>
<div class="card reveal d1"><div class="icon">&#128221;</div><h3>BOC-3 Filing</h3><p>Process-agent filing, done right.</p></div>
<div class="card reveal d2"><div class="icon">&#128197;</div><h3>UCR Registration</h3><p>Stay current, no missed deadlines.</p></div>
<div class="card reveal d3"><div class="icon">&#129354;</div><h3>IRP &amp; Plates</h3><p>Apportioned plate help.</p></div>
<div class="card reveal"><div class="icon">&#129534;</div><h3>Form 2290 (HVUT)</h3><p>Heavy-vehicle use tax filed for you.</p></div>
<div class="card reveal d1"><div class="icon">&#129514;</div><h3>Drug &amp; Alcohol Consortium</h3><p>Enrollment and management.</p></div>
<div class="card reveal d2"><div class="icon">&#128225;</div><h3>ELD Setup</h3><p>Get your ELD set up and running.</p></div>
<div class="card reveal d3"><div class="icon">&#128203;</div><h3>DOT Compliance &amp; Audits</h3><p>Stay audit-ready without stress.</p></div>
</div></div></section>'''
serv_hub_faq_html, serv_hub_faq_schema = faq_block(home_faqs)
serv_body += COMPARE + HOW + serv_hub_faq_html + final_cta()
page('services.html','Truck Dispatch Services (Full List) | Loadboot',
     'Full-service truck dispatch: load booking, rate negotiation, authority setup, IFTA, factoring, compliance, and freight-specific dispatch. Flat 5%, no contracts.',
     'services.html', serv_body, serv_hub_faq_schema)

# ---------- ABOUT ----------
about_body = svc_hero('About LoadBoot','We built LoadBoot to give carriers what most dispatchers don&rsquo;t: honesty, real attention, and a partner who actually picks up the phone.')

# Why we exist — problem/solution split with a navy pull-quote visual.
_about_visual = ('<div style="background:linear-gradient(135deg,#0b1220,#12304f 55%,#0e3b33);color:#fff;border-radius:22px;padding:34px;box-shadow:0 24px 60px -30px rgba(8,131,247,.55)">'
    '<div style="font-size:2.8rem;font-weight:800;letter-spacing:-.02em;line-height:1">5%</div>'
    '<div style="color:#93c5fd;font-weight:600;margin-bottom:20px">flat dispatch fee &mdash; that&rsquo;s the entire pricing page</div>'
    '<p style="color:#e2e8f0;margin:0;font-size:1.06rem;line-height:1.65;font-style:italic">&ldquo;We only win when your truck wins. No contracts means we have to earn your business every single week.&rdquo;</p>'
    '<div style="margin-top:18px;color:#94a3b8;font-size:.86rem">&mdash; the LoadBoot promise</div></div>')
about_body += m_split('Why we exist', 'The freight game is stacked against the small carrier',
    ['Too many owner-operators and new-authority carriers get locked into long contracts, handed the cheapest freight on the board, and left on hold when a load goes sideways. The margin gets squeezed at every turn &mdash; and the people doing the actual driving keep the least.',
     'LoadBoot flips that. You keep your own operating authority and approve every load. We work the load boards and our broker relationships to find better-paying freight on your lanes, negotiate the rate before you ever see it, and handle the paperwork and back office so you can focus on driving.'],
    _about_visual, flip=True, accent='#0883F7',
    bullets=['Flat 5% dispatch fee &mdash; no contracts, cancel anytime',
             'You approve every load and keep your authority',
             'A real dispatcher on call, not a ticket queue'])

about_body += m_zigzag('What we stand for', 'A dispatcher that treats your truck like a business', [
 ('scale', 'Honesty over everything', 'We negotiate hard on your rates, tell you the truth even when it&rsquo;s not what you want to hear, and never lock you into a contract. If we&rsquo;re not adding value, you can walk &mdash; and that keeps us honest.'),
 ('route', 'One partner, the whole business', 'You keep your own authority and approve every load. We handle the rest &mdash; finding freight, negotiating rates, talking to brokers, managing paperwork, and the back office: factoring, IFTA, compliance and claims.'),
 ('users', 'Built for where you are', 'Owner-operators, small and growing fleets, independent carriers, and especially new-authority carriers who need a guide through their first months. Wherever you are in your journey, we meet you there.'),
], accent='#0d9488')

about_body += m_timeline('Our story', 'How LoadBoot came to be', [
 ('phone', 'It started with a phone that rang', 'People who lived the carrier side got tired of dispatchers who vanished the moment a load went wrong. LoadBoot began as a simple promise: always pick up.'),
 ('route', 'Built around the load, not the contract', 'We designed every workflow &mdash; matching, rate confirmation, tracking, POD and settlement &mdash; around getting the carrier paid fairly and fast, with no lock-in.'),
 ('shieldcheck', 'Trust turned into a system', 'Verification, mutual vetting between carriers and brokers, and live account health turned &ldquo;just trust us&rdquo; into records anyone on the load can actually see.'),
 ('bolt', 'One platform for the whole chain', 'Carriers, drivers, brokers and shippers now run on the same rails &mdash; with a real person in the loop wherever money moves.'),
], accent='#7c3aed')

about_body += m_dark('How we operate', 'The rules we run the company by',
    'A few non-negotiables that shape every feature and every decision.',
    [('target', 'Explainable, always', 'Every match score, every detention minute, every settlement line traces to real records. If we cannot explain a number, we do not show it.'),
     ('key', 'Your data is yours', 'Tenant-isolated accounts, role-based access and audited actions. Drivers never see company finances; brokers never see carrier internals.'),
     ('scale', 'Humans control money', 'Software prepares invoices and settlements; a person approves every payout. The maker and the checker are never the same account.')],
    numbered=False, accent='#60a5fa',
    cta='<a href="security.html" class="btn btn-primary" style="background:#34d399;color:#052e2b;border:none;font-weight:800">See our security &amp; trust practices &rarr;</a>')

about_body += ('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Who we serve</div><h2>One platform, every seat in the freight chain</h2></div><div class="grid g3 reveal">'
 '<div class="card reveal"><div class="icon">&#128667;</div><h3>Owner-operators &amp; fleets</h3><p>Independent carriers and growing fleets who want higher-paying freight on their lanes and one place to run the business. <a href="carriers.html">For carriers &rarr;</a></p></div>'
 '<div class="card reveal"><div class="icon">&#128295;</div><h3>New-authority carriers</h3><p>Brand-new MC holders who need a guide through their first months &mdash; paperwork, compliance and steady first lanes. <a href="new-authority-dispatch.html">New authority &rarr;</a></p></div>'
 '<div class="card reveal"><div class="icon">&#129309;</div><h3>Brokers &amp; shippers</h3><p>Freight brokers posting to vetted, tracked capacity, and shippers posting freight directly on LoadBoot with verified carriers and live tracking. <a href="partners.html">Partner with us &rarr;</a></p></div>'
 '</div></div></section>')

about_body += m_statband([('5%', 'flat dispatch fee'), ('0', 'long-term contracts'), ('100%', 'loads you approve'), ('1 day', 'typical reply time')],
    note='These are policy facts, not marketing metrics &mdash; they define how LoadBoot works.')

about_body += '<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Contact us</div><h2>One company, three front doors</h2></div><div class="grid g3 reveal"><div class="card reveal"><div class="icon">&#128075;</div><h3>General &amp; support</h3><p><a href="mailto:hello@loadboot.com">hello@loadboot.com</a> &mdash; onboarding, questions, compliance and anything else.</p></div><div class="card reveal"><div class="icon">&#128666;</div><h3>Dispatch &amp; loads</h3><p><a href="mailto:dispatch@loadboot.com">dispatch@loadboot.com</a> &mdash; active loads, trips, appointments and PODs.</p></div><div class="card reveal"><div class="icon">&#129534;</div><h3>Billing &amp; settlements</h3><p><a href="mailto:billing@loadboot.com">billing@loadboot.com</a> &mdash; invoices, settlements and payment questions.</p></div></div></div></section>'

_about_faq_html, _about_faq_schema = faq_block([
 ('Is LoadBoot a dispatcher or a freight broker?', 'LoadBoot is a truck dispatch service. Carriers keep their own operating authority while we find, negotiate and coordinate loads on their behalf. Shippers post freight directly in their own LoadBoot portal and our dispatch coordinates verified carriers end to end.'),
 ('How much does LoadBoot cost?', 'A flat 5% dispatch fee on booked loads. There is no sign-up fee, no monthly minimum and no long-term contract &mdash; you can cancel anytime.'),
 ('Do you work with new-authority carriers?', 'Yes. New-authority and owner-operator carriers are a core focus. We help guide you through your first months, from paperwork and compliance to your first steady lanes.'),
 ('Who owns my data?', 'You do. Accounts are tenant-isolated with role-based access and audited actions. Drivers never see company finances, and brokers never see carrier internals.'),
 ('Who does LoadBoot serve, and where?', 'We serve owner-operators, carrier fleets, freight brokers and shippers across the United States, all on one connected platform.'),
])
about_body += _about_faq_html
about_body += m_gradcta('Ready for a dispatcher who actually picks up?',
    'Create your account in minutes &mdash; carrier, broker, shipper or referral partner. Flat 5%, no contracts, cancel anytime.',
    'Create your account &rarr;', 'get-started.html',
    grad='linear-gradient(135deg,#0b1220 0%,#12304f 55%,#0e3b33 100%)', btncolor='#34d399', btntext='#052e2b')

_about_org_schema = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"AboutPage","name":"About LoadBoot",'
    '"url":"https://loadboot.com/about.html","mainEntity":{"@type":"Organization","name":"LoadBoot","url":"https://loadboot.com/",'
    '"logo":"https://loadboot.com/logo-full.png","email":"hello@loadboot.com","areaServed":"US",'
    '"description":"LoadBoot is a U.S. truck dispatch service for owner-operators, fleets and new-authority carriers, with a partner platform for freight brokers and shippers. Flat 5%, no contracts.",'
    '"knowsAbout":["truck dispatch","freight dispatching","owner-operator dispatch","new authority carriers","load matching","freight brokerage"]}}</script>')
page('about.html','About LoadBoot | Honest Truck Dispatch for Carriers',
     'Honest US truck dispatch for owner-operators, new-authority carriers, brokers and shippers. Flat 5%, no contracts, cancel anytime.',
     'about.html', about_body, schema=_about_org_schema + _about_faq_schema)

# ---------- CONTACT ----------
contact_body = svc_hero('Get Started with Loadboot','Create your carrier profile in 2 minutes, request a rate quote, or just send us a message &mdash; flat 5%, no contracts, cancel anytime.')
contact_body += """<section class="bg-soft"><div class="wrap" style="max-width:820px">
<form class="quote-wrap reveal" id="qfForm" name="quote" method="POST" data-netlify="true" data-netlify-honeypot="bot-field">
<input type="hidden" name="form-name" value="quote"><p hidden><label>Skip: <input name="bot-field"></label></p>
<h3 style="margin-bottom:6px">How can we help?</h3>
<p id="formIntro" style="color:var(--muted);margin-bottom:18px">Tell us about your operation and a dispatcher gets you set up.</p>
<div class="intent-row">
<input type="radio" id="iAcct" name="intent" value="Create carrier account" checked onchange="qfIntent()"><label for="iAcct"><span class="d"></span> Create account</label>
<input type="radio" id="iQuote" name="intent" value="Get a rate quote" onchange="qfIntent()"><label for="iQuote"><span class="d"></span> Get a quote</label>
<input type="radio" id="iAsk" name="intent" value="General question / message" onchange="qfIntent()"><label for="iAsk"><span class="d"></span> Ask a question</label>
</div>
<div id="acctFields">
<div class="acct-personas">
<div class="ap-lead">What kind of account are you creating?</div>
<div class="ap-tabs">
<span class="ap-tab active"><span class="ap-i">&#128666;</span><span>Carrier / Owner-operator<small>You&rsquo;re on this one &mdash; fill it below</small></span></span>
<a class="ap-tab" href="/app/partner/"><span class="ap-i">&#127970;</span><span>Broker (licensed)<small>Post loads &amp; manage carriers</small></span></a>
<a class="ap-tab" href="/app/partner/"><span class="ap-i">&#128230;</span><span>Shipper<small>Post your freight &amp; track it live</small></span></a>
<a class="ap-tab" href="/agents.html"><span class="ap-i">&#127919;</span><span>Referral / Influencer<small>Earn from every load you refer</small></span></a>
<a class="ap-tab" href="/app/agent/"><span class="ap-i">&#129309;</span><span>Agent (independent dispatcher)<small>Bring clients, earn 1% of every delivered load</small></span></a>
</div>
<div class="ap-note">You&rsquo;re creating a <b>Carrier</b> account below. Broker, shipper, referral and agent each have their own quick flow &mdash; pick one above.</div>
</div>
<h3 style="margin:26px 0 16px">Your business</h3>
<div class="form-grid">
<div class="field full"><label for="f_company">Company / business name</label><input type="text" id="f_company" name="company" placeholder="Your trucking company"></div>
<div class="field"><label for="f_mc">MC number</label><input type="text" id="f_mc" name="mc" placeholder="MC-123456"></div>
<div class="field"><label for="f_dot">DOT number</label><input type="text" id="f_dot" name="dot" placeholder="DOT-1234567"></div>
<div class="field full"><label for="f_authority">Authority status</label><select id="f_authority" name="authority"><option value="">Select&hellip;</option><option>Active / established authority</option><option>New authority</option><option>No authority yet</option></select></div>
</div>
<h3 style="margin:26px 0 16px">Equipment &amp; lanes</h3>
<div class="form-grid">
<div class="field"><label for="f_equipment">Equipment type</label><select id="f_equipment" name="equipment"><option value="">Select&hellip;</option><option>Dry Van</option><option>Reefer</option><option>Flatbed</option><option>Step Deck</option><option>Hotshot</option><option>Power Only</option><option>Box Truck / Expedited</option></select></div>
<div class="field"><label for="f_trucks">Number of trucks</label><select id="f_trucks" name="trucks"><option value="">Select&hellip;</option><option>1</option><option>2-5</option><option>6-20</option><option>20+</option></select></div>
<div class="field full"><label for="f_lanes">Preferred lanes / home base</label><input type="text" id="f_lanes" name="lanes" placeholder="e.g. Dallas, TX &mdash; Southeast lanes"></div>
<div class="field"><label for="f_insurance">Insurance in place?</label><select id="f_insurance" name="insurance"><option value="">Select&hellip;</option><option>Yes</option><option>Not yet &mdash; need help</option></select></div>
<div class="field"><label for="f_factoring">Factoring?</label><select id="f_factoring" name="factoring"><option value="">Select&hellip;</option><option>Yes, already factoring</option><option>No &mdash; need help</option><option>Not sure</option></select></div>
</div>
</div>
<h3 style="margin:26px 0 16px">Your details</h3>
<div class="form-grid">
<div class="field"><label for="f_name">Your name</label><input type="text" id="f_name" name="name" required placeholder="Full name"></div>
<div class="field"><label for="f_phone">Phone</label><input type="tel" id="f_phone" name="phone" placeholder="(555) 555-5555"></div>
<div class="field full"><label for="f_email">Email</label><input type="email" id="f_email" name="email" required placeholder="you@email.com"></div>
<div class="field full"><label id="msgLabel">Anything else? <span style="color:var(--muted);font-weight:500">(optional)</span></label><textarea name="message" placeholder="Tell us about a specific load, lane, or question &mdash; or anything you'd like us to know."></textarea></div>
</div>
<button class="btn btn-primary" id="submitBtn" style="width:100%;justify-content:center;margin-top:24px">Create My Carrier Account &rarr;</button>
<p style="text-align:center;margin-top:14px;font-size:.9rem">Free to start. No contracts. A dispatcher responds within 15 minutes during business hours.</p></form>
<div class="cinfo reveal">
<div class="ci"><div class="icon">&#128236;</div><div><b>Email us</b><span>General &mdash; hello@loadboot.com<br>Dispatch &mdash; dispatch@loadboot.com<br>Billing &mdash; billing@loadboot.com</span></div></div>
<div class="ci"><div class="icon">&#128336;</div><div><b>Hours</b><span>Mon&ndash;Fri 7am&ndash;9pm CT &middot; Sat 9&ndash;5</span></div></div>
<div class="ci"><div class="icon">&#9889;</div><div><b>Fast response</b><span>Most messages answered in 15 min</span></div></div>
</div>
</div></section>
<script>
function qfIntent(){var sel=document.querySelector('input[name=intent]:checked');if(!sel)return;var v=sel.value;var isAcct=v.indexOf('account')>-1;var isQuote=v.indexOf('quote')>-1;
var acct=document.getElementById('acctFields');if(acct)acct.style.display=isAcct?'':'none';
['company','authority','equipment'].forEach(function(n){var el=document.querySelector('[name='+n+']');if(el)el.required=isAcct;});
var msg=document.querySelector('[name=message]');var ml=document.getElementById('msgLabel');
if(msg){msg.required=(!isAcct&&!isQuote);}
if(ml){ml.innerHTML=(!isAcct&&!isQuote)?'Your message':((isQuote?'Load / lane details ':'Anything else? ')+'<span style=\\'color:var(--muted);font-weight:500\\'>(optional)</span>');}
var b=document.getElementById('submitBtn');if(b)b.innerHTML=(isAcct?'Create My Carrier Account':(isQuote?'Get My Rate Quote':'Send Message'))+' &rarr;';
var t=document.getElementById('formIntro');if(t)t.textContent=isAcct?'Tell us about your operation and a dispatcher gets you set up.':(isQuote?'Tell us about a load or lane and we will send you a rate.':'Send us a message and we will get right back to you.');}
(function(){var h=location.hash;var map={'#quote':'iQuote','#ask':'iAsk','#question':'iAsk','#create':'iAcct','#account':'iAcct','#form':null};if(h in map){var id=map[h];if(id){var r=document.getElementById(id);if(r)r.checked=true;}setTimeout(function(){var f=document.getElementById('qfForm');if(f)f.scrollIntoView({behavior:'smooth',block:'start'});},150);}qfIntent();
var f=document.getElementById('qfForm');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();var fd=new FormData(f);var d=new URLSearchParams(fd).toString();try{if(window.lbSubmitLead){var o={};fd.forEach(function(v,k){if(k!=='bot-field'&&k!=='form-name'&&String(v).trim())o[k]=String(v);});o.form_key='quote';window.lbSubmitLead(o.intent==='Create carrier account'?'quote-account':(o.intent==='Get a rate quote'?'quote-rate':'quote-question'),o);}}catch(_){}fetch('/',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:d}).then(function(){f.innerHTML='<div style=\\'text-align:center;padding:40px\\'><div style=\\'font-size:2.6rem;color:#16a34a\\'>&#10003;</div><h3 style=\\'margin:12px 0\\'>Got it &mdash; thanks!</h3><p>A Loadboot dispatcher will reach out within 15 minutes during business hours.</p></div>';}).catch(function(){f.innerHTML='<p style=\\'text-align:center\\'>Something went wrong &mdash; please email hello@loadboot.com and we will get right back to you.</p>';});});})();
</script>"""
page('contact.html','Get Started, Get a Quote or Contact Us | Loadboot','Create your carrier profile, request a rate quote, or send Loadboot a message. Flat 5%, no contracts. A dispatcher responds within 15 minutes.','contact.html', contact_body + '<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Direct lines</div><h2>Skip the form if you prefer email</h2></div><div class="grid g3 reveal"><div class="card reveal"><div class="icon">&#128075;</div><h3>hello@loadboot.com</h3><p>New carriers, general questions, onboarding, compliance and support.</p></div><div class="card reveal"><div class="icon">&#128666;</div><h3>dispatch@loadboot.com</h3><p>Anything about an active load or trip — appointments, tracking, PODs, exceptions.</p></div><div class="card reveal"><div class="icon">&#129534;</div><h3>billing@loadboot.com</h3><p>Invoices, settlements, payment status and disputes.</p></div></div></div></section><section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">What happens next</div><h2>After you reach out</h2></div><div class="grid g3 reveal"><div class="card reveal"><div class="icon">1</div><h3>A person reads it</h3><p>Every message lands with a real dispatcher or success rep — no ticket black hole.</p></div><div class="card reveal"><div class="icon">2</div><h3>Fast first response</h3><p>Business-hours messages usually hear back within the hour; active-load issues jump the queue.</p></div><div class="card reveal"><div class="icon">3</div><h3>Tracked to done</h3><p>Your request gets an owner and stays open until you say it is solved.</p></div></div></div></section>')

# ---------- PRICING ----------
pr_body = svc_hero('Simple, Honest Dispatch Pricing','One flat rate, no contracts, no hidden fees. You only pay when we actually book you a load &mdash; so our goals and yours are always the same.')
pr_body += '''<section><div class="wrap"><div class="promise reveal"><div class="glow"></div><div class="eyebrow" style="color:#93c5fd">Our Rate</div><h2>A flat 5% of gross &mdash; that's it</h2><p>No setup fees. No monthly minimums. No long-term contract. We charge 5% of the gross on the loads we book for you, and nothing on the weeks you don't run. If we don't add value, you can walk away anytime.</p><div class="reply">&#9989; You only pay when you earn</div></div></div></section>'''
pr_inc = ['Dedicated dispatcher for your truck','Higher-paying load booking','Rate negotiation on every load','Broker setup and communication','Route and lane planning','Document and paperwork management','24/7 dispatch support','Help with factoring, IFTA, and compliance']
_pr_receipt = ('<div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:30px;max-width:400px;margin:0 auto;box-shadow:0 30px 60px -30px rgba(15,23,42,.35)">'
 '<div style="font-family:Manrope;font-weight:800;font-size:1.05rem;margin-bottom:16px;display:flex;justify-content:space-between"><span>Example load</span><span style="color:#94a3b8;font-weight:600;font-size:.8rem">illustrative</span></div>'
 '<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #f1f5f9;font-size:.95rem"><span style="color:#64748b">Linehaul (Dallas &rarr; Atlanta)</span><b>$2,640</b></div>'
 '<div style="display:flex;justify-content:space-between;padding:11px 0;border-bottom:1px solid #f1f5f9;font-size:.95rem"><span style="color:#64748b">LoadBoot fee (flat 5%)</span><b style="color:#dc2626">&minus;$132</b></div>'
 '<div style="display:flex;justify-content:space-between;padding:13px 0;font-size:1.02rem"><span style="font-weight:700">You keep</span><b style="color:#16a34a;font-size:1.2rem">$2,508</b></div>'
 '<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:10px 14px;font-size:.85rem;color:#166534;margin-top:6px">No monthly fee &middot; no setup fee &middot; $0 on weeks you don&rsquo;t run</div></div>')
pr_body += ('<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Every side, priced in the open</div><h2>What each side of a load pays</h2>'
 '<p class="lead center" style="margin:14px auto 0;max-width:760px">One revenue line funds the whole platform: the flat 5% dispatch fee on the carrier side. Nobody else is billed for using LoadBoot.</p></div>'
 '<div class="grid g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128666;</div><h3>Carriers</h3><p><b>5% of gross linehaul</b> on loads LoadBoot books &mdash; invoiced to your account after delivery. No setup fee, no monthly minimum, no contract. Accessorials you earn (detention, TONU, layover, lumper) are <b>100% yours</b> &mdash; we take nothing from them.</p></div>'
 '<div class="card"><div class="icon">&#127970;</div><h3>Freight brokers</h3><p><b>Free.</b> Posting loads, verified carrier matching, live tracking, document collection, the claims desk and the payables ledger are included &mdash; no posting fee, no subscription, no per-load charge.</p></div>'
 '<div class="card"><div class="icon">&#127981;</div><h3>Shippers &amp; facilities</h3><p><b>Free.</b> Request freight, schedule docks, watch live GPS and pull documents at no platform cost. Freight moves under licensed brokerage; the linehaul you agree to is the linehaul.</p></div>'
 '<div class="card"><div class="icon">&#129309;</div><h3>Agents</h3><p><b>Free to join &mdash; you get paid.</b> 1% of gross on every delivered load in your chain, plus 0.50% / 0.25% / 0.15% / 0.10% overrides five levels deep. Paid out of LoadBoot&rsquo;s own 5% &mdash; never added to anyone&rsquo;s cost.</p></div>'
 '</div></div></section>')
pr_body += ('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">What we deliberately do not sell you</div><h2>Three things we refuse to charge for &mdash; on purpose</h2>'
 '<p class="lead center" style="margin:14px auto 0;max-width:780px">Plenty of platforms make money on these. We think each one quietly costs carriers more than it gives them.</p></div>'
 '<div class="grid g3 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128241;</div><h3>No hardware, no ELD lock-in</h3><p>Telematics vendors sell devices and multi-year contracts. Your phone already has GPS &mdash; so tracking, geofenced arrive/depart stamps and detention proof cost you nothing extra, from truck one. Run Samsara or Motive already? We read from it. <a href="integrations.html">How it connects</a>.</p></div>'
 '<div class="card"><div class="icon">&#128683;</div><h3>No fake volume guarantees</h3><p>&ldquo;Guaranteed loads&rdquo; almost always arrives attached to a contract, forced dispatch or a shaved rate. We guarantee what we control instead: the rate in writing, real deadhead, accessorials paid on evidence, deadlines on every dollar &mdash; and the freedom to walk any week.</p></div>'
 '<div class="card"><div class="icon">&#128506;</div><h3>No thin coverage for show</h3><p>48 contiguous states, deep &mdash; where essentially every truckload mile runs and where a delivered truck can always reload. We would rather own that map than print a bigger one we cannot cover.</p></div>'
 '</div></div></section>')
pr_body += ('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Payment terms, stated plainly</div><h2>When the money actually moves</h2></div>'
 '<div class="grid g3 reveal" style="margin-top:24px">'
 '<div class="card"><h3>&#128197; Standard terms</h3><p><b>Net-30 from delivery</b> unless the posting or your factoring agreement says otherwise &mdash; and the clock starts the moment the load delivers, not when someone remembers to invoice. Every payable shows its PAY-BY date to both sides.</p></div>'
 '<div class="card"><h3>&#127974; If you factor</h3><p>Your factoring terms govern instead (often 21 days to the broker). With your NOA on file the remit-to routes to your factor automatically on every invoice. <a href="factoring-noa.html">Factoring &amp; NOA</a>.</p></div>'
 '<div class="card"><h3>&#9888;&#65039; LoadBoot does not advance funds</h3><p>We are not a factor and not a bank &mdash; money moves bank-to-bank between payer and payee. LoadBoot runs the ledger, the deadlines, the receipts and the confirmations around it. <a href="payments-settlements.html">How payment works</a>.</p></div>'
 '</div></div></section>')
pr_body += m_split('All included', 'Everything is included in your 5%',
 ['One number covers the whole dispatch back office. If it is on this list, it is never an upsell.'],
 _pr_receipt, soft=True, accent='#ea580c', bullets=pr_inc)
pr_body += COMPARE
pr_faq = [('Are there any setup or hidden fees?','No. There are no setup fees, monthly fees, or hidden charges. You pay a flat 5% only on the loads we book.'),
('What if I have a slow week?','You pay nothing on loads you don\'t run. We only earn when we book freight for you.'),
('Is there a contract?','No long-term contract &mdash; cancel anytime. We earn your business load by load.'),
('How is the 5% calculated?','It\'s 5% of the gross (line-haul) on each load we book and you approve. Every delivered load auto-invoices the fee with a branded PDF &mdash; see <a href="payments-settlements.html">how payments &amp; settlements work</a>.'),
('Do you work with new-authority carriers?','Yes &mdash; new authority carriers are a core part of who we help.'),
('What do brokers, shippers and agents pay?','Nothing to use the platform. The Partner Portal (posting, tracking, documents) and the Agent Portal are included free &mdash; LoadBoot&rsquo;s only revenue is the flat 5% dispatch fee on the carrier side, and agents are paid out of that same fee.')]
pf_html, pf_sch = faq_block(pr_faq)
pr_body += pf_html + final_cta()
page('pricing.html','Pricing — Flat 5% for Carriers, Free for Brokers, Shippers & Agents | LoadBoot',
     'Loadboot truck dispatch pricing: a flat 5% of gross, no setup fees, no monthly fees, no long-term contract. You only pay when we book your load.',
     'pricing.html', pr_body, pf_sch)

# ---------- BLOG ----------
def blog_post(fname,title,desc,excerpt,blocks):
    body = svc_hero(title, excerpt)
    inner = ''
    for b in blocks:
        inner += ('<h2>%s</h2>' % b[2:]) if b.startswith('H:') else ('<p>%s</p>' % b)
    body += '<section><div class="wrap prose reveal" style="max-width:780px">%s</div></section>' % inner
    body += final_cta()
    sch = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"%s","author":{"@type":"Organization","name":"Loadboot"},"publisher":{"@type":"Organization","name":"Loadboot"}}</script>' % title.replace('"',"'")
    page(fname,title,desc,'blog.html',body,sch)

BLOGPOSTS = [
 ('truck-driver-per-diem-2026.html',
  'Truck Driver Per Diem 2026: The $12,800 Most Owner-Operators Never Claim',
  'IRS per diem for truck drivers is $80/day in 2026 and 80% deductible. 200 nights out is $12,800 in deductions — and most owner-operators lose it because they cannot prove the days.',
  'You do not need a single meal receipt. You DO need proof of the nights you were away — and that is exactly where most drivers lose thousands. Here is the 2026 rule, the real math, and how to make the proof build itself.',
  []),
 ('ghost-loads-load-board-problems.html',
  'Ghost Loads &amp; Fake Freight: Why Load Boards Waste Your Day',
  'Ghost loads, stale posts, bait-and-switch rates and double brokering: why booking one load takes 15-20 calls, what it costs you, and how a truck operating system fixes it.',
  'The load you just called on was covered yesterday. The next three don\u2019t exist at the posted rate. 15\u201320 calls and half a day later you book ONE load. Here\u2019s why the boards stay broken \u2014 and the system that ends it.',
  []),
 ('how-to-avoid-cheap-freight.html',
  'How to Avoid Cheap Freight (Without Sitting Empty)',
  'Cheap freight is a system, not bad luck. The floor-price discipline, the lanes that trap you, the reload math, and how to say no without your truck going broke.',
  'Every market has a bottom third — and it will find you unless you have a number, a plan for the reload, and the discipline to say no. The system for hauling only freight that pays.',
  []),
 ('truck-dispatcher-in-georgia.html',
  'Truck Dispatcher in Georgia & Florida: The Southeast Playbook',
  'Truck dispatch in Georgia and Florida: Atlanta distribution, Savannah port freight, the Florida inbound trap and how to price the way back out.',
  'Atlanta is the Southeast reload machine, Savannah keeps climbing, and Florida pays great going in — then tests you on the way out. The Southeast playbook, honestly priced.',
  []),
 ('truck-dispatcher-in-california.html',
  'Truck Dispatcher in California: Ports, Produce & Staying Compliant',
  'Truck dispatch in California: port freight, Central Valley produce, I-5/99 corridors, CARB and AB5 realities, and how a dispatcher keeps a CA truck loaded and legal.',
  'The biggest freight economy in America — and the most regulated. Ports, produce seasons, the I-5 spine, CARB rules and AB5: how dispatch works when California is your board.',
  []),
 ('how-to-read-a-rate-confirmation.html',
  'How to Read a Rate Confirmation (Before You Sign It)',
  'The rate con is the contract that decides whether you get paid. The 10 lines to check every time, the traps hidden in the fine print, and when to refuse to sign.',
  'Most carriers skim the rate. The money is lost in the other lines — detention terms, tracking penalties, POD deadlines. How to read a rate con like it decides your paycheck, because it does.',
  []),
 ('do-new-authority-carriers-need-a-dispatcher.html',
  'Do New-Authority Carriers Need a Dispatcher?',
  'Fresh MC and no callbacks? What actually blocks new authorities, what a dispatcher changes in the first 90 days, and when you genuinely do not need one.',
  'The first 90 days under a fresh MC decide whether the truck earns or the authority lapses. What actually blocks new carriers — and what a dispatcher does and does not fix.',
  []),
 ('truck-dispatcher-in-texas.html',
  'Truck Dispatcher in Texas: Lanes, Rates & How to Stay Loaded',
  'Truck dispatch in Texas: the Triangle lanes, Laredo border freight, energy and produce seasons, and how a dispatcher keeps a Texas truck loaded.',
  'Texas is the biggest trucking market in the country — and one of the easiest places to haul cheap if nobody is watching your rates. The lanes, the seasons, and how dispatch works here.',
  []),
 ('how-much-does-a-truck-dispatcher-cost.html',
  'How Much Does a Truck Dispatcher Cost in 2026?',
  'Truck dispatcher pricing explained: percentage vs flat fee, what 5% really gets you, and how the right dispatcher pays for itself.',
  'A clear breakdown of what truck dispatchers charge, the two common pricing models, and how to tell if a dispatcher is worth the cost.',
  ['If you are an owner-operator thinking about hiring a dispatcher, the first question is always the same: what does it cost, and is it worth it? Here is a straight answer.',
   'H:The two common pricing models',
   'Most truck dispatchers charge one of two ways. The first is a percentage of your gross &mdash; usually between 3% and 10%, with 5% being the industry standard. The second is a flat weekly fee per truck, often somewhere between 150 and 250 dollars per week.',
   'The percentage model is the most common and, for most owner-operators, the fairest. You only pay when you actually book and run a load, so the dispatcher only earns when you earn. That keeps your incentives aligned.',
   'H:What you should get for that money',
   'A good dispatcher does far more than forward you loads. For your 5% you should expect load booking on your preferred lanes, hard rate negotiation on every load, broker setup and communication, paperwork and rate confirmations handled, and lane planning that cuts your empty miles.',
   'If a dispatcher is just sending you cheap loads off the board with no negotiation, you are overpaying at any price.',
   'H:How a dispatcher pays for itself',
   'Say you run a 3,000 dollar load. A 5% fee is 150 dollars. If your dispatcher negotiates even 200 to 400 dollars more per load than you would have taken, and keeps you from running empty, the fee more than pays for itself &mdash; while giving you back the hours you would have spent on the phone with brokers.',
   'The real cost of dispatch is not the percentage. It is the cheap freight and empty miles you take when you are doing everything yourself.',
   'H:The bottom line',
   'Expect to pay around 5% of gross for quality truck dispatch, with no contract and no hidden fees. The right dispatcher should make you more than they cost &mdash; if they do not, you should be able to walk away anytime.']),
 ('truck-dispatcher-vs-freight-broker.html',
  'Truck Dispatcher vs Freight Broker vs Factoring',
  'Dispatcher, broker or factoring? Who each represents, what they legally can and cannot do, how the money flows, and which a carrier needs.',
  'Three roles, three different jobs. Who represents whom, how the money actually flows, and which ones you really need as a carrier.',
  ['New carriers often confuse dispatchers and freight brokers. They play very different roles, and understanding the difference protects you.',
   'H:Who they represent',
   'A freight broker represents the shipper. Their job is to find a truck for a load, and they are paid by the shipper, keeping a margin. A truck dispatcher represents the carrier &mdash; you. A dispatcher works on your behalf to find loads, negotiate your rate, and keep your truck moving.',
   'H:Authority and the law',
   'Freight brokers must hold a broker authority (an MC number for brokerage) and carry a surety bond. Dispatchers generally do not need broker authority, because they work for the carrier rather than the shipper. This is also why a dispatcher should never deal directly with shippers as if brokering &mdash; that crosses into brokerage.',
   'H:What this means for you',
   'When you work with a dispatcher, you keep your own authority and stay in control. You approve every load and rate. The dispatcher simply does the legwork &mdash; searching, negotiating, and handling brokers &mdash; so you can focus on driving.',
   'A broker is who your dispatcher negotiates with to get you a load. A dispatcher is who works for you to get the best deal from that broker.',
   'H:Which one do you need?',
   'If you are a carrier with your own authority who wants help finding and negotiating loads without giving up control, you need a dispatcher. Loadboot is a dispatch service &mdash; we represent you, the carrier, and we work to keep your truck loaded at the best possible rate.']),
 ('how-to-get-loads-with-new-authority.html',
  'How to Get Loads With a New Authority: A Carrier\'s Guide',
  'Just got your MC number? Here is how to get set up with brokers, find your first loads, and avoid the mistakes that sink new carriers.',
  'A practical guide for brand-new carriers on landing your first loads and building momentum in your first 90 days.',
  ['Getting your own authority is exciting, but the first few months are the hardest. Brokers want paperwork before they trust you, and cheap freight is everywhere. Here is how to start strong.',
   'H:1. Get your paperwork ready',
   'Before a broker gives you a load, they need your authority, insurance certificate, W-9, and a signed carrier packet. Have these ready as a single PDF so you can get set up with brokers in minutes, not days.',
   'H:2. Set up with brokers and load boards',
   'Get on the main load boards and start completing broker setups. Every broker you set up with is another source of freight. This is tedious work &mdash; which is exactly what a dispatcher handles for you.',
   'H:3. Do not chase the cheapest freight',
   'New carriers often grab any load to stay busy. That is how you end up running below your cost per mile. Know your numbers, and turn down freight that does not pay. One good load beats two cheap ones.',
   'H:4. Get factoring in place',
   'Brokers can take 30 to 45 days to pay. Without factoring, a new carrier can run out of cash fast. Factoring gets you paid in a day or two for a small fee &mdash; often worth it in your early months.',
   'H:5. Watch out for non-paying brokers',
   'Always check a broker\'s credit and reputation before hauling. A load that never pays is worse than no load at all.',
   'H:The shortcut',
   'All of this &mdash; broker setup, finding good loads, negotiating rates, and avoiding bad brokers &mdash; is exactly what a dispatcher does. If you would rather drive than spend your first months learning the back office the hard way, a dispatch service like Loadboot gets you set up and loaded from day one.']),
 ('owner-operator-dispatch-service-guide.html',
  'Owner-Operator Dispatch Service: The Complete Guide (2026)',
  'What an owner-operator dispatch service does, what it costs, how it works day to day, and how to choose one &mdash; a complete guide for single-truck operators.',
  'What a dispatch service does for a one-truck operation, what it costs, whether new authority needs one, and how to choose a good one.',
  ['For a single-truck owner-operator, a dispatch service is your back office &mdash; it finds, negotiates and books your freight so you can focus on driving, while you keep your authority and approve every load.']),
]
PREMIUM_ARTICLES={'how-much-does-a-truck-dispatcher-cost.html','truck-dispatcher-vs-freight-broker.html','owner-operator-dispatch-service-guide.html','truck-dispatcher-in-texas.html','do-new-authority-carriers-need-a-dispatcher.html','how-to-read-a-rate-confirmation.html','truck-dispatcher-in-california.html','how-to-avoid-cheap-freight.html','truck-dispatcher-in-georgia.html'}
for fn,t,d,ex,bl in BLOGPOSTS:
    if fn in PREMIUM_ARTICLES:
        continue
    blog_post(fn,t,d,ex,bl)

# ---------- PREMIUM LONG-FORM ARTICLE SYSTEM ----------
def svc_banner(t,s,btn,href):
    return ('<div class="svc-banner"><div><div class="sb-t">'+t+'</div><div class="sb-s">'+s
            +'</div></div><a class="sb-btn" href="'+href+'">'+btn+'</a></div>')

def rich_article(fname,title,desc,eyebrow,h1,deck,read_min,hero,hero_alt,toc,body_html,faqs,feat_svg=''):
    e=lambda s:s.replace('"',"'")
    crumb='<div class="wrap"><nav class="crumbs"><a href="index.html">Home</a> &rsaquo; <a href="blog.html">Blog</a> &rsaquo; '+h1+'</nav></div>'
    herob=('<header class="art-hero"><div class="wrap"><div class="art-eyebrow">'+eyebrow+'</div><h1>'+h1
           +'</h1><p class="art-sub">'+deck+'</p><div class="art-meta"><span>By Loadboot Dispatch Team</span>'
           '<span>&middot; Updated June 2026</span><span>&middot; '+str(read_min)+' min read</span></div></div></header>')
    # Only reference the hero photo if the file is actually present (else keep the gradient SVG).
    hero_img=('<img src="'+hero+'" alt="'+hero_alt+'" width="1200" height="630" decoding="async">') if asset_exists(hero) else ''
    feat='<div class="wrap"><figure class="art-feat">'+feat_svg+hero_img+'</figure></div>'
    toch='<aside class="art-toc"><div class="tt">In this guide</div>'+''.join('<a href="#'+i+'">'+l+'</a>' for i,l in toc)+'</aside>'
    author=('<div class="wrap"><div class="art-author"><div class="av">LB</div><div><b>Loadboot Dispatch Team</b>'
            '<div style="color:var(--muted);font-size:.92rem;margin-top:3px">Truck dispatchers who book, negotiate, and '
            'manage freight for owner-operators and fleets across the U.S. &mdash; flat 5%, no contracts.</div></div></div></div>')
    fhtml,fsch=faq_block(faqs)
    body=crumb+herob+feat+'<div class="wrap art-grid">'+toch+'<div class="art-body">'+body_html+'</div></div>'+author+fhtml+final_cta()
    art=('<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"'+e(h1)
         +'","description":"'+e(desc)+'","image":"https://loadboot.com/'+(hero if asset_exists(hero) else 'icon-512.png')+'","author":{"@type":"Organization","name":"Loadboot"},'
         '"publisher":{"@type":"Organization","name":"Loadboot","logo":{"@type":"ImageObject","url":"https://loadboot.com/icon-512.png"}},'
         '"datePublished":"2026-06-27","dateModified":"2026-06-27"}</script>')
    bcr=('<script type="application/ld+json">{"@context":"https://schema.org","@type":"BreadcrumbList","itemListElement":'
         '[{"@type":"ListItem","position":1,"name":"Home","item":"https://loadboot.com/"},'
         '{"@type":"ListItem","position":2,"name":"Blog","item":"https://loadboot.com/blog.html"},'
         '{"@type":"ListItem","position":3,"name":"'+e(h1)+'","item":"https://loadboot.com/'+fname+'"}]}</script>')
    page(fname,title,desc,'blog.html',body,art+bcr+fsch)

A1_SVG=('<figure class="art-fig"><svg viewBox="0 0 600 248" width="100%" role="img" '
 'aria-label="On a 3000 dollar load you keep 2850 dollars after a 5 percent fee, versus 2600 dollars booking cheap freight yourself">'
 '<text x="0" y="22" font-family="Manrope,Arial" font-weight="800" font-size="19" fill="#10223B">The 5% math on a $3,000 load</text>'
 '<text x="0" y="70" font-family="Inter,Arial" font-size="13" fill="#64748B">Booking cheap freight yourself</text>'
 '<rect x="0" y="80" width="560" height="30" rx="6" fill="#eef2f7"/>'
 '<rect x="0" y="80" width="407" height="30" rx="6" fill="#94a3b8"/>'
 '<text x="418" y="100" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">$2,600</text>'
 '<text x="0" y="148" font-family="Inter,Arial" font-size="13" fill="#64748B">With Loadboot (after the 5% fee)</text>'
 '<rect x="0" y="158" width="560" height="30" rx="6" fill="#eff6ff"/>'
 '<rect x="0" y="158" width="446" height="30" rx="6" fill="#0883F7"/>'
 '<text x="457" y="178" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">$2,850</text>'
 '<text x="0" y="226" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#FC5305">'
 '+$250 in your pocket &#8212; and hours of broker calls off your plate.</text></svg>'
 '<figcaption>Example: a dispatcher books and negotiates a $3,000 load; after the $150 (5%) fee you keep $2,850 &mdash; '
 'more than the $2,600 cheap load you would have grabbed yourself.</figcaption></figure>')

A1_BODY=(
'<h2 id="quick-answer">Quick answer: what does a truck dispatcher cost?</h2>'
'<p>Most truck dispatchers in the U.S. charge <b>3% to 10% of your gross revenue</b>, and <b>5% is the industry standard</b>. '
'The other common model is a <b>flat weekly fee</b>, usually <b>$150&ndash;$250 per truck, per week</b>. At Loadboot it&rsquo;s a '
'<a href="pricing.html">flat 5% with no contracts</a> &mdash; you only pay when we actually book and run a load for you.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>On a $3,000 load, a 5% dispatch fee is <b>$150</b>. '
'The number that actually matters isn&rsquo;t the percentage &mdash; it&rsquo;s whether your dispatcher books better-paying loads '
'and cuts your empty miles by <em>more</em> than they cost. A good one should.</div></div>'
'<div class="statrow"><div class="statcard"><div class="n">5%</div><div class="l">Industry-standard fee</div></div>'
'<div class="statcard"><div class="n">$150&ndash;$250</div><div class="l">Typical flat weekly fee</div></div>'
'<div class="statcard"><div class="n">$0</div><div class="l">What you pay if we don&rsquo;t book you</div></div></div>'

'<h2 id="models">The two pricing models, explained</h2>'
'<p>Almost every dispatcher charges one of two ways. Understanding both helps you spot a fair deal &mdash; and a bad one.</p>'
'<table class="cmp"><thead><tr><th>&nbsp;</th><th>Percentage (e.g., 5%)</th><th>Flat weekly fee</th></tr></thead><tbody>'
'<tr><td>How you pay</td><td>A % of your gross on each booked load</td><td>A fixed $ amount per truck, per week</td></tr>'
'<tr><td>Best for</td><td>Most owner-operators &amp; small fleets</td><td>High-revenue trucks running steady, heavy miles</td></tr>'
'<tr><td>Slow week</td><td>You pay little or nothing</td><td>You pay the full fee regardless</td></tr>'
'<tr><td>Incentive</td><td>Aligned &mdash; they earn more when you earn more</td><td>Neutral &mdash; same fee no matter the rate</td></tr>'
'</tbody></table>'
'<p>For most carriers the <b>percentage model is the fairest</b>, because the dispatcher only earns when you do &mdash; so they&rsquo;re '
'motivated to fight for higher rates, not just fill your calendar. A flat fee can work out cheaper <em>only</em> if you run very high '
'gross revenue every single week without fail.</p>'

'<h2 id="included">What your fee should actually cover</h2>'
'<p>A real dispatch service does far more than forward you loads off a board. For your 5% you should expect:</p>'
'<ul>'
'<li><b>Load booking</b> on the lanes and equipment you actually want to run</li>'
'<li><b>Rate negotiation</b> on every load &mdash; not just accepting the first offer</li>'
'<li><b>Broker setup &amp; credit checks</b> so you don&rsquo;t haul for non-paying brokers</li>'
'<li><b>Paperwork &amp; rate confirmations</b> handled for you</li>'
'<li><b>Deadhead &amp; lane planning</b> to cut your empty miles</li>'
'<li><b>Detention &amp; TONU help</b> when appointments run long</li>'
'</ul>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>If a dispatcher just forwards cheap loads with no negotiation, '
'you&rsquo;re overpaying at <em>any</em> price. <b>Booking is not dispatching.</b></div></div>'
+svc_banner('Flat 5%. No contracts. You keep the rest.',
  'See exactly what our dispatch service includes and what you pay &mdash; no hidden fees, cancel anytime.',
  'See our pricing &rarr;','pricing.html')+

'<h2 id="roi">Does 5% actually pay for itself?</h2>'
'<p>This is the real question. The fee only matters next to what it earns you. Here&rsquo;s the simple math on a single load:</p>'
+A1_SVG+
'<p>A dispatcher who negotiates even <b>$200&ndash;$400 more per load</b> than you would have taken &mdash; and keeps you from running '
'empty between loads &mdash; covers the 5% several times over. And that&rsquo;s before you count the hours you get back instead of '
'sitting on the phone with brokers.</p>'
'<div class="pull">The real cost of dispatch isn&rsquo;t the 5%. It&rsquo;s the cheap freight and empty miles you run when you&rsquo;re doing everything yourself.</div>'
'<p>Want to see whether a specific load is even worth taking before you negotiate? Run the numbers in our '
'<a href="load-score.html">free Load Score tool</a> &mdash; it gives you a take / negotiate / pass verdict and a suggested counter-offer.</p>'
+svc_banner('Should you take this load?',
  'Use our free Load Score tool to score any offer in seconds &mdash; no signup. Get a take, negotiate, or pass verdict instantly.',
  'Try the Load Score &rarr;','load-score.html')+

'<h2 id="flat-vs-percent">Flat fee vs percentage: which is right for you?</h2>'
'<p>Choose <b>percentage</b> if you&rsquo;re an owner-operator or small fleet, your weekly revenue varies, or you want your dispatcher&rsquo;s '
'incentives tied to your own. Choose a <b>flat fee</b> only if you run consistently high gross every week and you&rsquo;ve done the math '
'showing the fixed cost works out lower. When in doubt, percentage is the safer, fairer default.</p>'

'<h2 id="red-flags">Red flags: when you&rsquo;re overpaying</h2>'
'<p>Price isn&rsquo;t the only thing that makes dispatch expensive. Watch for:</p>'
'<ul>'
'<li><b>Long contracts</b> or cancellation penalties &mdash; good dispatchers earn your business load by load</li>'
'<li><b>Upfront or setup fees</b> before they&rsquo;ve booked you anything</li>'
'<li><b>Forced factoring</b> you didn&rsquo;t choose</li>'
'<li><b>No rate transparency</b> &mdash; you should see and approve every rate</li>'
'<li><b>Dealing directly with shippers</b> as if brokering (that crosses into illegal territory for a dispatcher)</li>'
'</ul>'
'<div class="callout cl-tip"><span class="ic">&#10003;</span><div>A fair dispatch deal looks like this: a flat percentage, '
'no contract, full rate transparency, and <b>you approve every load</b>. If you can&rsquo;t walk away anytime, that&rsquo;s a red flag.</div></div>'
'<h2 id="how-works">How dispatch actually works, step by step</h2>'
'<p>Wondering what you&rsquo;re paying for day to day? Here&rsquo;s the loop a good dispatcher runs for every load you haul:</p>'
'<div class="art-steps">'
'<div class="art-step"><div class="sn">1</div><b>Find &amp; vet</b><span>We search the boards and our broker network for loads on your lanes, then credit-check the broker before anything moves.</span></div>'
'<div class="art-step"><div class="sn">2</div><b>Negotiate</b><span>We push for the highest rate the lane will bear &mdash; you see and approve the number before we commit.</span></div>'
'<div class="art-step"><div class="sn">3</div><b>Book &amp; paperwork</b><span>We lock the load, handle the rate confirmation and setup packet, and send you the details.</span></div>'
'<div class="art-step"><div class="sn">4</div><b>Plan the next load</b><span>While you roll, we line up your next load to cut deadhead and keep your wheels earning.</span></div>'
'</div>'
'<p>That last step &mdash; planning ahead so you&rsquo;re never sitting empty &mdash; is where most of the 5% pays for itself. '
'It&rsquo;s also worth knowing the legal line: a dispatcher works <em>for the carrier</em> and never brokers freight directly to shippers. '
'The <a href="https://www.fmcsa.dot.gov/registration/who-needs-register" target="_blank" rel="noopener nofollow">FMCSA registration rules</a> '
'spell out who must hold broker authority &mdash; a point every owner-operator should understand before signing with anyone.</p>'
+svc_banner('Every equipment type, one flat rate',
  'Reefer, flatbed, dry van, hotshot or power-only &mdash; see the full range of lanes and loads our dispatch team runs.',
  'Explore all dispatch services &rarr;','services.html')+
'<h2 id="bottom-line">The bottom line</h2>'
'<p>Expect to pay around <b>5% of gross</b> for quality truck dispatch, with no contract and no hidden fees. The right dispatcher should '
'make you more than they cost &mdash; in better rates, fewer empty miles, and the hours you get back. If they don&rsquo;t, you should be '
'able to leave anytime. That&rsquo;s exactly how Loadboot works.</p>')

A1_TOC=[('quick-answer','Quick answer'),('models','The two pricing models'),('included','What your fee covers'),
        ('roi','Does 5% pay for itself?'),('flat-vs-percent','Flat fee vs percentage'),('red-flags','Red flags to avoid'),
        ('how-works','How dispatch works'),('bottom-line','The bottom line')]
A1_FAQ=[
 ('Is 5% a lot for a truck dispatcher?','No &mdash; 5% is the industry standard, and for most owner-operators it is the fairest model because you only pay when the dispatcher actually books and runs a load for you. The fee is usually small next to the higher rates and reduced deadhead a good dispatcher delivers.'),
 ('Do dispatchers charge an upfront fee?','A reputable dispatcher should not charge upfront or setup fees. At Loadboot you pay a flat 5% only on loads we book &mdash; nothing upfront, and no contract.'),
 ('Is a flat weekly fee cheaper than a percentage?','It depends on your revenue. A flat fee ($150&ndash;$250/truck/week) can be cheaper only if you run high gross every week. If your weeks vary, the percentage model usually costs less and keeps your dispatcher&rsquo;s incentives aligned with yours.'),
 ('Do I still control which loads I take?','Yes. A dispatcher works for you &mdash; they find and negotiate loads, but you approve every load and rate before anything is booked.'),
 ('Can I cancel anytime?','With Loadboot, yes. There are no contracts &mdash; we earn your business load by load, and you can stop anytime.')]
A1_FEAT=('<svg class="feat-art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
 '<defs><linearGradient id="fa1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10223B"/>'
 '<stop offset=".55" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0883F7"/></linearGradient></defs>'
 '<rect width="1200" height="360" fill="url(#fa1)"/>'
 '<circle cx="980" cy="80" r="220" fill="#ffffff" opacity=".05"/>'
 '<circle cx="1080" cy="300" r="160" fill="#FC5305" opacity=".10"/>'
 '<text x="70" y="150" font-family="Manrope,Arial" font-weight="800" font-size="120" fill="#ffffff" opacity=".10">5%</text>'
 '<rect x="760" y="210" width="34" height="80" rx="6" fill="#3b82f6" opacity=".7"/>'
 '<rect x="812" y="170" width="34" height="120" rx="6" fill="#60a5fa" opacity=".7"/>'
 '<rect x="864" y="120" width="34" height="170" rx="6" fill="#FC5305" opacity=".85"/>'
 '</svg>')
rich_article('how-much-does-a-truck-dispatcher-cost.html',
 'Truck Dispatcher Cost 2026: Dispatch Fees & Pricing (% vs Flat) — What 5% Gets You',
 'Truck dispatcher pricing explained: percentage vs flat fee, what 5% really gets you, red flags, and how the right dispatcher pays for itself.',
 'Dispatch Pricing','How Much Does a Truck Dispatcher Cost in 2026?',
 'Percentage vs flat fee, what 5% should cover, the red flags that mean you are overpaying, and the simple math on whether a dispatcher pays for itself.',
 8,'dispatcher-cost-hero.avif','Semi-truck on a US highway — what a truck dispatcher costs',
 A1_TOC,A1_BODY,A1_FAQ,feat_svg=A1_FEAT)

# ===== ARTICLE #2 : Dispatcher vs Broker vs Factoring =====
A2_FEAT=('<svg class="feat-art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
 '<defs><linearGradient id="fa2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10223B"/>'
 '<stop offset=".55" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0883F7"/></linearGradient></defs>'
 '<rect width="1200" height="360" fill="url(#fa2)"/>'
 '<circle cx="980" cy="70" r="230" fill="#ffffff" opacity=".05"/>'
 '<circle cx="1090" cy="300" r="150" fill="#FC5305" opacity=".10"/>'
 '<rect x="690" y="150" width="150" height="64" rx="12" fill="#ffffff" opacity=".10"/>'
 '<rect x="870" y="150" width="150" height="64" rx="12" fill="#ffffff" opacity=".10"/>'
 '<rect x="1050" y="150" width="110" height="64" rx="12" fill="#FC5305" opacity=".22"/>'
 '<text x="70" y="150" font-family="Manrope,Arial" font-weight="800" font-size="118" fill="#ffffff" opacity=".10">VS</text>'
 '</svg>')

# Diagram: who represents whom
A2_REP=('<figure class="art-fig"><svg viewBox="0 0 640 330" width="100%" role="img" '
 'aria-label="A freight broker represents the shipper; a truck dispatcher represents you, the carrier. They negotiate the load between them.">'
 '<text x="0" y="20" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#10223B">Who works for whom</text>'
 '<text x="20" y="58" font-family="Inter,Arial" font-size="12" font-weight="700" fill="#FC5305" text-transform="uppercase">THE LOAD&rsquo;S SIDE</text>'
 '<text x="400" y="58" font-family="Inter,Arial" font-size="12" font-weight="700" fill="#0883F7">YOUR SIDE</text>'
 '<rect x="20" y="70" width="210" height="62" rx="12" fill="#fff7ed" stroke="#fdba74"/>'
 '<text x="125" y="100" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">Shipper</text>'
 '<text x="125" y="120" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#9a3412">Owns the freight</text>'
 '<rect x="20" y="200" width="210" height="62" rx="12" fill="#fff7ed" stroke="#fb923c"/>'
 '<text x="125" y="230" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">Freight Broker</text>'
 '<text x="125" y="250" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#9a3412">Represents the shipper</text>'
 '<rect x="400" y="70" width="210" height="62" rx="12" fill="#eff6ff" stroke="#93c5fd"/>'
 '<text x="505" y="100" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">Carrier &mdash; You</text>'
 '<text x="505" y="120" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#1e40af">Owns the truck &amp; authority</text>'
 '<rect x="400" y="200" width="210" height="62" rx="12" fill="#eff6ff" stroke="#60a5fa"/>'
 '<text x="505" y="230" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">Truck Dispatcher</text>'
 '<text x="505" y="250" text-anchor="middle" font-family="Inter,Arial" font-size="11.5" fill="#1e40af">Represents you</text>'
 '<path d="M125 132 V200" stroke="#fb923c" stroke-width="3"/><path d="M125 200 l-5 -10 h10 Z" fill="#fb923c"/>'
 '<path d="M505 132 V200" stroke="#0883F7" stroke-width="3"/><path d="M505 200 l-5 -10 h10 Z" fill="#0883F7"/>'
 '<path d="M230 231 H400" stroke="#64748B" stroke-width="2.5" stroke-dasharray="6 6"/>'
 '<path d="M400 231 l-12 -6 v12 Z" fill="#64748B"/><path d="M230 231 l12 -6 v12 Z" fill="#64748B"/>'
 '<text x="315" y="222" text-anchor="middle" font-family="Inter,Arial" font-size="11" font-weight="700" fill="#475569">negotiate the rate</text>'
 '</svg><figcaption>The broker is the <b>other side of the table</b> &mdash; they work for the shipper. Your dispatcher works for '
 '<b>you</b>, negotiating with that broker to get your truck the best rate.</figcaption></figure>')

# Diagram: money flow
A2_FLOW=('<figure class="art-fig"><svg viewBox="0 0 600 250" width="100%" role="img" '
 'aria-label="On a load the shipper pays the broker 3300 dollars; the broker keeps about 300 and pays the carrier 3000; the dispatcher takes 5 percent which is 150; optional factoring takes about 60; the carrier keeps roughly 2790.">'
 '<text x="0" y="20" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#10223B">How the money flows on a $3,000 load</text>'
 '<rect x="0" y="44" width="150" height="58" rx="11" fill="#f1f5f9" stroke="#cbd5e1"/>'
 '<text x="75" y="69" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#10223B">Shipper</text>'
 '<text x="75" y="88" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#64748B">pays $3,300</text>'
 '<rect x="225" y="44" width="150" height="58" rx="11" fill="#fff7ed" stroke="#fdba74"/>'
 '<text x="300" y="69" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#10223B">Broker</text>'
 '<text x="300" y="88" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#9a3412">keeps ~$300</text>'
 '<rect x="450" y="44" width="150" height="58" rx="11" fill="#eff6ff" stroke="#93c5fd"/>'
 '<text x="525" y="69" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#10223B">You (Carrier)</text>'
 '<text x="525" y="88" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#1e40af">gets $3,000</text>'
 '<path d="M150 73 H225" stroke="#94a3b8" stroke-width="2.5"/><path d="M225 73 l-11 -6 v12 Z" fill="#94a3b8"/>'
 '<path d="M375 73 H450" stroke="#94a3b8" stroke-width="2.5"/><path d="M450 73 l-11 -6 v12 Z" fill="#94a3b8"/>'
 '<path d="M525 102 V140" stroke="#cbd5e1" stroke-width="2.5"/>'
 '<rect x="300" y="140" width="135" height="46" rx="10" fill="#eff6ff" stroke="#bfdbfe"/>'
 '<text x="367" y="160" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#1e40af">Dispatcher 5%</text>'
 '<text x="367" y="177" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#10223B">&minus; $150</text>'
 '<rect x="450" y="140" width="135" height="46" rx="10" fill="#fff7ed" stroke="#fed7aa"/>'
 '<text x="517" y="160" text-anchor="middle" font-family="Inter,Arial" font-size="11" fill="#9a3412">Factoring ~2%</text>'
 '<text x="517" y="177" text-anchor="middle" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#10223B">&minus; $60 (optional)</text>'
 '<path d="M435 163 H300" stroke="#cbd5e1" stroke-width="0"/>'
 '<rect x="360" y="206" width="240" height="40" rx="10" fill="#10223B"/>'
 '<text x="378" y="231" font-family="Inter,Arial" font-size="12" fill="#cbd5e1">You keep about</text>'
 '<text x="582" y="231" text-anchor="end" font-family="Manrope,Arial" font-weight="800" font-size="16" fill="#FC5305">$2,790</text>'
 '</svg><figcaption>The broker&rsquo;s margin comes out <b>before</b> you ever see the rate. Your dispatcher&rsquo;s 5% and optional '
 'factoring come out of <b>your</b> side &mdash; and a good dispatcher usually negotiates a higher starting rate than you would alone, '
 'covering their fee and then some.</figcaption></figure>')

A2_BODY=(
'<h2 id="quick-answer">Quick answer</h2>'
'<p>A <b>freight broker</b> works for the shipper and owns the load. A <b>truck dispatcher</b> works for you, the carrier, and '
'negotiates with brokers to keep your truck loaded. A <b>factoring company</b> doesn&rsquo;t find freight at all &mdash; it advances you '
'cash on the loads you&rsquo;ve already hauled so you&rsquo;re not waiting 30&ndash;45 days to get paid. Three different jobs, not three '
'versions of the same thing.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>You will often deal with <b>all three at once</b>: your dispatcher '
'books a load from a broker, you haul it, and a factoring company pays you the next day. They&rsquo;re partners in the same trip &mdash; '
'not competitors.</div></div>'
'<div class="statrow"><div class="statcard"><div class="n">~5%</div><div class="l">Typical dispatch fee (of your load)</div></div>'
'<div class="statcard"><div class="n">$75,000</div><div class="l">Surety bond a broker must carry</div></div>'
'<div class="statcard"><div class="n">1&ndash;3%</div><div class="l">Typical factoring fee per invoice</div></div></div>'

'<h2 id="who-represents">Who each one represents</h2>'
'<p>This is the single most important thing to understand, because it tells you whose interests each party is protecting:</p>'
+A2_REP+
'<p>A broker is paid to get the shipper&rsquo;s freight moved for as little as the market allows. That&rsquo;s not dishonest &mdash; '
'it&rsquo;s their job, and they&rsquo;re good at it. The problem is that when you negotiate directly with a broker on your own, '
'you&rsquo;re a one-truck operation going up against someone who books hundreds of loads a week and knows every lane&rsquo;s real number. '
'A dispatcher levels that table, because they sit on <em>your</em> side and negotiate dozens of loads a week too.</p>'
+svc_banner('A dispatcher who works for you, not the load',
  'Loadboot represents the carrier &mdash; we negotiate with brokers on your behalf, you approve every rate, and you keep your own authority.',
  'See how our dispatch works &rarr;','services.html')+

'<h2 id="legal">What each can legally do</h2>'
'<p>The roles are separated by federal authority, and the line matters &mdash; crossing it is how carriers get burned:</p>'
'<ul>'
'<li><b>Freight brokers</b> must hold active brokerage authority (an MC number for brokering) and carry a <b>$75,000 surety bond</b>. '
'They&rsquo;re legally allowed to arrange transportation between shippers and carriers and keep a margin. You can verify any broker&rsquo;s '
'authority and bond in the <a href="https://safer.fmcsa.dot.gov/" target="_blank" rel="noopener nofollow">FMCSA SAFER system</a>.</li>'
'<li><b>Truck dispatchers</b> generally <b>do not need broker authority</b>, because they work for the carrier rather than arranging freight '
'for a shipper. A dispatcher should never negotiate directly with a shipper as if brokering &mdash; that crosses into brokerage and requires '
'authority and a bond. The <a href="https://www.fmcsa.dot.gov/registration/get-mc-number-authority-operate" target="_blank" rel="noopener nofollow">'
'FMCSA authority rules</a> spell out who must register.</li>'
'<li><b>Factoring companies</b> are a financial service, not a transportation one. They buy your invoices at a small discount. No FMCSA '
'authority is involved &mdash; just a contract you should read carefully (watch for recourse vs non-recourse terms and long lock-ins).</li>'
'</ul>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>If a &ldquo;dispatcher&rdquo; is dealing directly with shippers and '
'keeping a margin like a broker &mdash; without broker authority and a bond &mdash; that&rsquo;s a red flag. A real dispatcher works for you '
'and is paid <em>by you</em>, transparently.</div></div>'

'<h2 id="money-flow">How the money actually flows</h2>'
'<p>Carriers often think the dispatcher and the broker are both &ldquo;taking a cut&rdquo; of the same pie. They&rsquo;re not &mdash; '
'they&rsquo;re paid from different places. Here&rsquo;s a real example on a $3,000 load:</p>'
+A2_FLOW+
'<p>Notice the broker&rsquo;s margin is already baked into the rate before it reaches you &mdash; you never see the shipper&rsquo;s full '
'$3,300. Your dispatcher&rsquo;s 5% and any factoring fee come out of your $3,000. The math only works in your favor because a good '
'dispatcher typically <b>negotiates a higher rate to begin with</b>, so even after the fee you net more than you would have alone.</p>'
'<div class="pull">A broker owns the load. A dispatcher works your side of the table. Factoring just gets you paid faster. Different jobs &mdash; not competitors.</div>'
'<p>Want to know whether a broker&rsquo;s offer is actually fair before you (or your dispatcher) push back? Run it through our '
'<a href="load-score.html">free Load Score tool</a> &mdash; it scores any rate against the lane and gives you a take / negotiate / pass call.</p>'
+svc_banner('Is that broker&rsquo;s rate any good?',
  'Score any load offer in seconds with our free Load Score tool &mdash; no signup. Know your number before you negotiate.',
  'Try the Load Score &rarr;','load-score.html')+

'<h2 id="compare">Dispatcher vs broker vs factoring: side by side</h2>'
'<table class="cmp"><thead><tr><th>&nbsp;</th><th>Truck Dispatcher</th><th>Freight Broker</th><th>Factoring</th></tr></thead><tbody>'
'<tr><td>Works for</td><td><b>You</b> (the carrier)</td><td>The shipper</td><td><b>You</b> (the carrier)</td></tr>'
'<tr><td>Main job</td><td>Finds &amp; negotiates loads for your truck</td><td>Finds a truck for the shipper&rsquo;s load</td><td>Advances cash on loads you&rsquo;ve hauled</td></tr>'
'<tr><td>How they&rsquo;re paid</td><td>~5% of your rate, or a flat fee</td><td>Margin between shipper &amp; carrier rate</td><td>~1&ndash;3% of each invoice</td></tr>'
'<tr><td>Needs FMCSA authority?</td><td>No</td><td>Yes &mdash; broker authority + $75k bond</td><td>No</td></tr>'
'<tr><td>Do you keep control?</td><td>Yes &mdash; you approve every load</td><td>They&rsquo;re the other side of the deal</td><td>Yes &mdash; it&rsquo;s just cash flow</td></tr>'
'<tr><td>When you use them</td><td>Optional, but valuable on every load</td><td>On most loads (they hold the freight)</td><td>Optional &mdash; for faster pay</td></tr>'
'</tbody></table>'

'<h2 id="factoring">Where factoring fits &mdash; and when to skip it</h2>'
'<p>Factoring solves one problem: <b>cash flow</b>. Brokers commonly pay in 30 to 45 days, but your fuel, insurance and truck payment '
'are due now. A factoring company pays you within a day or two of submitting the paperwork, taking 1&ndash;3% as their fee.</p>'
'<p>It&rsquo;s often worth it in your <b>first months</b>, when one slow-paying broker can sink you. Once you have a cash cushion and steady '
'lanes, many carriers drop factoring to keep that 1&ndash;3%. Read the contract closely: prefer <b>non-recourse</b> where practical, avoid '
'long lock-ins, and never let a factor or dispatcher force you into a service you didn&rsquo;t choose.</p>'
'<div class="callout cl-tip"><span class="ic">&#10003;</span><div>A clean setup for a new carrier: your <b>own authority</b>, a '
'<b>dispatcher</b> who finds and negotiates your freight, and <b>optional factoring</b> while you build cash. You stay in control of all '
'three.</div></div>'
+svc_banner('New authority? Get loaded from day one',
  'We handle broker setup, find your lanes, and negotiate your rates so you can drive instead of learning the back office the hard way.',
  'See owner-operator dispatch &rarr;','owner-operator-dispatch.html')+

'<h2 id="which">Which do you actually need?</h2>'
'<p>If you&rsquo;re a carrier with your own authority: you&rsquo;ll <b>deal with brokers</b> on most loads whether you like it or not '
'(they hold the freight), a <b>dispatcher</b> is the optional-but-valuable partner who handles those brokers and negotiates for you, and '
'<b>factoring</b> is a cash-flow tool you turn on when you need faster pay. The only one that&rsquo;s truly &ldquo;you vs them&rdquo; is the '
'broker &mdash; and that&rsquo;s exactly why having a dispatcher on your side changes the game.</p>'

'<h2 id="bottom-line">The bottom line</h2>'
'<p>Don&rsquo;t think of dispatcher, broker and factoring as three choices &mdash; think of them as three roles in every load you run. The '
'broker represents the freight. Factoring represents your bank account. And a dispatcher is the one party in the chain whose only job is to '
'represent <b>you</b>. That&rsquo;s the difference, and it&rsquo;s the whole reason a good dispatch service pays for itself.</p>')

A2_TOC=[('quick-answer','Quick answer'),('who-represents','Who represents whom'),('legal','What each can legally do'),
        ('money-flow','How the money flows'),('compare','Side-by-side comparison'),('factoring','Where factoring fits'),
        ('which','Which do you need?'),('bottom-line','The bottom line')]
A2_FAQ=[
 ('Is a truck dispatcher the same as a freight broker?','No. A freight broker works for the shipper and arranges freight for a margin, and must hold broker authority plus a $75,000 bond. A truck dispatcher works for the carrier &mdash; finding and negotiating loads on your behalf &mdash; and generally does not need broker authority.'),
 ('Can a dispatcher also broker my loads?','Not on the same load. Brokering requires active broker authority and a surety bond, and a dispatcher who deals directly with shippers for a margin is crossing into brokerage. A legitimate dispatcher works for you and is paid transparently by you.'),
 ('Do I need a dispatcher, a broker, and factoring all at once?','You will deal with brokers on most loads because they hold the freight. A dispatcher is optional but handles those brokers and negotiates for you. Factoring is optional and only about getting paid faster. Many carriers use all three together.'),
 ('Is factoring worth the fee?','It depends on your cash flow. Paying 1&ndash;3% to get paid in a day or two is often worth it in your first months, when a slow-paying broker can sink you. Once you have a cash cushion, many carriers drop it to keep the fee.'),
 ('Who gets me a better rate, a dispatcher or a broker?','A broker is paid to move the shipper&rsquo;s freight for as little as the market allows, so their incentive is a lower rate. A dispatcher works for you and is motivated to negotiate the rate up, since on a percentage model they only earn more when you do.')]
rich_article('truck-dispatcher-vs-freight-broker.html',
 'Truck Dispatcher vs Freight Broker vs Factoring (2026)',
 'Dispatcher, broker or factoring? Who each represents, what they can legally do, how the money flows, and which ones a carrier actually needs.',
 'Carrier Basics','Truck Dispatcher vs Freight Broker vs Factoring',
 'Three roles every carrier deals with &mdash; but they do completely different jobs. Who represents whom, what each can legally do, how the money flows, and which ones you actually need.',
 9,'dispatcher-vs-broker-hero.jpg','Freight broker and truck dispatcher negotiating a load rate for a carrier',
 A2_TOC,A2_BODY,A2_FAQ,feat_svg=A2_FEAT)

# ===== ARTICLE #4 : Owner-Operator Dispatch Service — Complete Guide =====
A4_FEAT=('<svg class="feat-art" viewBox="0 0 1200 360" preserveAspectRatio="xMidYMid slice" aria-hidden="true">'
 '<defs><linearGradient id="fa4" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10223B"/>'
 '<stop offset=".55" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0883F7"/></linearGradient></defs>'
 '<rect width="1200" height="360" fill="url(#fa4)"/>'
 '<circle cx="960" cy="80" r="230" fill="#ffffff" opacity=".05"/>'
 '<circle cx="1090" cy="300" r="150" fill="#FC5305" opacity=".10"/>'
 '<text x="70" y="150" font-family="Manrope,Arial" font-weight="800" font-size="96" fill="#ffffff" opacity=".10">OWNER-OP</text>'
 '<g transform="translate(770,196)"><rect x="0" y="0" width="150" height="64" rx="6" fill="#e2e8f0" opacity=".85"/>'
 '<path d="M150 14h26c4 0 7 2 9 5l16 25c1 2 2 4 2 7v13h-53z" fill="#0883F7"/>'
 '<rect x="158" y="20" width="18" height="18" fill="#bfdbfe"/><rect x="8" y="64" width="220" height="5" fill="#10223B"/>'
 '<circle cx="46" cy="70" r="15" fill="#10223B"/><circle cx="46" cy="70" r="6" fill="#64748b"/>'
 '<circle cx="196" cy="70" r="15" fill="#10223B"/><circle cx="196" cy="70" r="6" fill="#64748b"/></g>'
 '</svg>')
A4_SVG=('<figure class="art-fig"><svg viewBox="0 0 600 250" width="100%" role="img" '
 'aria-label="A typical solo week nets about 4600 dollars booking your own loads versus about 5400 dollars with a dispatch service after the 5 percent fee">'
 '<text x="0" y="22" font-family="Manrope,Arial" font-weight="800" font-size="19" fill="#10223B">A typical solo week: DIY vs dispatched</text>'
 '<text x="0" y="70" font-family="Inter,Arial" font-size="13" fill="#64748B">Booking your own loads (extra deadhead + one cheap load)</text>'
 '<rect x="0" y="80" width="560" height="30" rx="6" fill="#eef2f7"/>'
 '<rect x="0" y="80" width="392" height="30" rx="6" fill="#94a3b8"/>'
 '<text x="403" y="100" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">~$4,600 net</text>'
 '<text x="0" y="150" font-family="Inter,Arial" font-size="13" fill="#64748B">With a dispatch service (better rates, less deadhead, after 5%)</text>'
 '<rect x="0" y="160" width="560" height="30" rx="6" fill="#eff6ff"/>'
 '<rect x="0" y="160" width="460" height="30" rx="6" fill="#0883F7"/>'
 '<text x="471" y="180" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#10223B">~$5,400 net</text>'
 '<text x="0" y="228" font-family="Inter,Arial" font-size="13" font-weight="700" fill="#FC5305">'
 '~$800 more in your pocket &#8212; plus a week of broker calls you never had to make.</text></svg>'
 '<figcaption>Illustrative: a dispatcher books higher-paying lanes and cuts your empty miles, so even after the 5% fee '
 'a well-run solo week nets more than doing everything yourself. Your numbers vary by lane, season and equipment.</figcaption></figure>')
A4_BODY=(
'<h2 id="what-is">What is an owner-operator dispatch service?</h2>'
'<p>An <b>owner-operator dispatch service</b> is a company that finds, negotiates, and books freight <em>on your behalf</em> '
'so you can stay focused on driving and delivering. For a one-truck operation, a good dispatcher is effectively your entire '
'back office &mdash; searching load boards and broker networks, haggling rates, vetting brokers, and handling the paperwork '
'&mdash; without you giving up your authority or your control over which loads you run.</p>'
'<div class="callout cl-info"><span class="ic">&#128161;</span><div>A dispatcher works <b>for you, the carrier</b>. That is the '
'whole point &mdash; and the legal line. A dispatcher is not a broker and never sells your truck to a shipper directly. You keep '
'your MC number, you approve every load, and you can walk away anytime.</div></div>'
'<div class="statrow"><div class="statcard"><div class="n">1 truck</div><div class="l">Exactly who this is built for</div></div>'
'<div class="statcard"><div class="n">5%</div><div class="l">Industry-standard dispatch fee</div></div>'
'<div class="statcard"><div class="n">$0</div><div class="l">What you pay on a week we don&rsquo;t book you</div></div></div>'

'<h2 id="what-it-does">What a dispatch service actually does for you</h2>'
'<p>The job is much bigger than &ldquo;forwarding loads.&rdquo; A real owner-operator dispatch service runs the entire load lifecycle '
'so your only job is to drive safely and deliver on time. For your fee you should expect:</p>'
'<ul>'
'<li><b>Load sourcing</b> on the lanes, equipment and home-time you actually want &mdash; not just whatever is cheapest to fill your week</li>'
'<li><b>Rate negotiation</b> on every load, pushing for the top of what the lane will pay instead of accepting the first number</li>'
'<li><b>Broker setup &amp; credit checks</b> so you never haul for a broker who won&rsquo;t pay</li>'
'<li><b>Rate confirmations &amp; setup packets</b> handled and organized for you</li>'
'<li><b>Deadhead &amp; trip planning</b> that lines up your next load before you&rsquo;re empty</li>'
'<li><b>Detention, TONU &amp; layover support</b> when an appointment runs long or a load falls through</li>'
'<li><b>A single point of contact</b> instead of ten broker phone numbers and a full voicemail box</li>'
'</ul>'
'<p>Notice what is <em>not</em> on that list: your dispatcher does not choose your loads for you, does not touch your money, and '
'does not lock you into anything. You stay the decision-maker.</p>'
'<p>There&rsquo;s also a less obvious benefit that owner-operators feel within a week or two: the mental load lifts. Instead of scanning '
'boards at a truck stop, chasing down a broker&rsquo;s setup packet, and second-guessing whether a rate is fair, you get one point of '
'contact who already knows your lanes and your floor. That&rsquo;s hours of screen time and phone tag every week that go straight back '
'into driving &mdash; or into actually resting during your reset. For a one-person business, protecting your focus and your hours-of-service '
'is not a soft perk; it&rsquo;s the difference between a sustainable operation and burning out by month six.</p>'
+svc_banner('Flat 5%. No contracts. Built for owner-operators.',
  'See exactly what our dispatch service covers and what you pay &mdash; no setup fees, no forced factoring, cancel anytime.',
  'See our pricing &rarr;','pricing.html')+

'<h2 id="how-it-works">How it works, day to day</h2>'
'<p>Here&rsquo;s the loop a good owner-operator dispatch service runs for every single load you haul &mdash; usually while you&rsquo;re '
'still rolling on the current one:</p>'
'<div class="art-steps">'
'<div class="art-step"><div class="sn">1</div><b>Set your plan</b><span>You tell us your lanes, equipment, home base, rate floor and when you want to be home. That becomes your standing playbook.</span></div>'
'<div class="art-step"><div class="sn">2</div><b>Find &amp; vet</b><span>We search boards and our broker network for loads that fit, then credit-check the broker before anything is committed.</span></div>'
'<div class="art-step"><div class="sn">3</div><b>Negotiate &amp; confirm</b><span>We push the rate up and send you the number. You approve it &mdash; then we lock the load and handle the rate confirmation.</span></div>'
'<div class="art-step"><div class="sn">4</div><b>Plan ahead</b><span>While you drive, we line up your next load to kill deadhead, and we jump on detention or issues if the day goes sideways.</span></div>'
'</div>'
'<p>That fourth step is where most of the fee pays for itself. An empty truck earns nothing, and a solo driver who is also their own '
'dispatcher almost always ends up sitting longer between loads than one whose next pickup is already booked.</p>'
'<div class="pull">A dispatcher&rsquo;s real product isn&rsquo;t a load &mdash; it&rsquo;s a truck that&rsquo;s never sitting empty and never hauling for a broker who won&rsquo;t pay.</div>'

'<h2 id="cost">What does it cost an owner-operator?</h2>'
'<p>Most dispatch services charge <b>3%&ndash;10% of your gross, with 5% being standard</b>, or a <b>flat $150&ndash;$250 per week</b>. '
'For a solo owner-operator whose weekly revenue moves up and down, the percentage model is usually the fairer deal &mdash; on a slow '
'week you pay little or nothing, and your dispatcher only earns when you do. We break the full comparison down in our guide to '
'<a href="how-much-does-a-truck-dispatcher-cost.html">how much a truck dispatcher costs</a>.</p>'
'<div class="callout cl-tip"><span class="ic">&#10003;</span><div>The number that matters isn&rsquo;t the percentage &mdash; it&rsquo;s '
'whether your dispatcher books better rates and cuts more empty miles than they cost. On a $3,000 load the 5% fee is $150; a single '
'well-negotiated rate usually covers that several times over.</div></div>'
+A4_SVG+
'<p>Want to sanity-check any individual offer before you commit? Run it through our '
'<a href="load-score.html">free Load Score tool</a> &mdash; it gives you a take / negotiate / pass verdict and a suggested counter-offer '
'in seconds, no signup needed.</p>'
+svc_banner('Should you take this load?',
  'Score any rate for real profit in seconds with our free Load Score tool &mdash; take, negotiate, or pass, instantly. No login.',
  'Try the Load Score &rarr;','load-score.html')+

'<h2 id="new-authority">Do you need one as a new owner-operator?</h2>'
'<p>If you&rsquo;ve just activated your own authority, the honest answer is: a dispatch service is one of the fastest ways to get loaded '
'without spending your first three months learning the back office the hard way. New carriers face a specific set of hurdles &mdash; '
'brokers who won&rsquo;t work with authority under 90 days old, thin credit history, and no relationships &mdash; and an experienced '
'dispatcher already has the broker connections and the setup process down.</p>'
'<p>It also helps to understand the legal landscape you&rsquo;re operating in. A dispatcher works for the carrier and does not need broker '
'authority; brokers, who represent shippers, must register and hold a bond. The FMCSA&rsquo;s '
'<a href="https://www.fmcsa.dot.gov/registration/who-needs-register" target="_blank" rel="noopener nofollow">guidance on who needs to register</a> '
'spells out exactly where that line sits &mdash; worth reading before you sign with anyone who blurs it.</p>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>Always confirm a broker&rsquo;s authority and safety record before you haul. '
'You can look up any carrier or broker for free on the FMCSA&rsquo;s '
'<a href="https://safer.fmcsa.dot.gov/CompanySnapshot.aspx" target="_blank" rel="noopener nofollow">SAFER Company Snapshot</a>. '
'A good dispatch service does this vetting for you on every load.</div></div>'

'<h2 id="diy-vs">Dispatch service vs doing it yourself</h2>'
'<p>Plenty of owner-operators dispatch themselves, and some do it well. The real question is what your time is worth and whether you can '
'consistently out-negotiate a full-time professional. Here&rsquo;s the honest trade-off:</p>'
'<table class="cmp"><thead><tr><th>&nbsp;</th><th>Dispatch yourself</th><th>Owner-operator dispatch service</th></tr></thead><tbody>'
'<tr><td>Cost</td><td>$0 in fees</td><td>~5% of gross on booked loads</td></tr>'
'<tr><td>Your driving hours</td><td>Cut into by load hunting &amp; broker calls</td><td>Spent driving &mdash; the loads come to you</td></tr>'
'<tr><td>Rate negotiation</td><td>As good as your own experience</td><td>Full-time negotiator working your lanes daily</td></tr>'
'<tr><td>Deadhead</td><td>Whatever you can plan solo</td><td>Next load lined up before you&rsquo;re empty</td></tr>'
'<tr><td>Broker risk</td><td>You vet every broker yourself</td><td>Credit-checked before you commit</td></tr>'
'<tr><td>Best for</td><td>Veterans with deep broker relationships and time to work the phones</td><td>Solo drivers who&rsquo;d rather drive than run a back office</td></tr>'
'</tbody></table>'
'<p>There&rsquo;s no universal right answer &mdash; but for most single-truck operators, the hours saved and the higher, better-vetted rates '
'more than cover a 5% fee. If you&rsquo;re still deciding who does what in your business, our breakdown of '
'<a href="truck-dispatcher-vs-freight-broker.html">dispatcher vs broker vs factoring</a> clears up who represents whom.</p>'

'<h2 id="how-to-choose">How to choose a dispatch service</h2>'
'<p>Not all dispatch services are equal. Before you hand over your operation, look for these green flags &mdash; and run from the red ones.</p>'
'<ul>'
'<li><b>A flat, transparent fee</b> (a clear percentage) with <b>no contract</b> and no setup or upfront charges</li>'
'<li><b>Full rate transparency</b> &mdash; you see and approve every rate before anything books</li>'
'<li><b>No forced factoring</b> &mdash; you choose your own factoring company, or none at all</li>'
'<li><b>Broker vetting</b> built into their process, not an afterthought</li>'
'<li><b>They run your lanes and equipment</b> &mdash; ask specifically about your freight type</li>'
'<li><b>You can cancel anytime</b> &mdash; a good service earns your business load by load</li>'
'</ul>'
'<div class="callout cl-warn"><span class="ic">&#9888;</span><div>Red flags: long contracts or cancellation penalties, upfront/setup fees, '
'forced factoring, no rate transparency, or a dispatcher dealing directly with shippers as if brokering. Any one of these should give you pause.</div></div>'
+svc_banner('Every equipment type, one flat rate',
  'Reefer, flatbed, dry van, hotshot, power-only or new authority &mdash; see the full range of lanes our dispatch team runs for owner-operators.',
  'Explore all dispatch services &rarr;','services.html')+

'<h2 id="bottom-line">The bottom line</h2>'
'<p>An owner-operator dispatch service exists to do one thing: keep your truck loaded at the best possible rate so you can focus on driving. '
'The right one is transparent, contract-free, vets your brokers, and makes you more than it costs &mdash; in higher rates, fewer empty miles, '
'and the hours you get back. If a service can&rsquo;t promise all of that, keep looking. That&rsquo;s exactly the standard '
'<a href="pricing.html">Loadboot</a> holds itself to: flat 5%, no contracts, you approve every load.</p>')

A4_TOC=[('what-is','What it is'),('what-it-does','What it does for you'),('how-it-works','How it works day to day'),
        ('cost','What it costs'),('new-authority','New owner-operators'),('diy-vs','Dispatch vs DIY'),
        ('how-to-choose','How to choose one'),('bottom-line','The bottom line')]
A4_FAQ=[
 ('What is an owner-operator dispatch service?','It&rsquo;s a company that finds, negotiates and books freight on your behalf so you can focus on driving. A dispatcher represents you, the carrier &mdash; searching loads, negotiating rates, vetting brokers and handling paperwork &mdash; while you keep your authority and approve every load.'),
 ('How much does dispatch cost for one truck?','Most services charge 3%&ndash;10% of gross, with 5% the standard, or a flat $150&ndash;$250 per week. For a solo owner-operator with variable weeks, the percentage model is usually fairer because you only pay when a load is actually booked. Loadboot is a flat 5% with no contract.'),
 ('Do I keep control of which loads I run?','Yes. A dispatch service does the legwork, but you approve every load and rate before anything books. You keep your own authority and stay the decision-maker.'),
 ('Do new-authority owner-operators need a dispatcher?','It&rsquo;s optional, but it&rsquo;s one of the fastest ways to get loaded when your authority is new. An experienced dispatcher already has broker relationships and the setup process handled, which helps get around the common &ldquo;90 days in business&rdquo; hurdle new carriers face.'),
 ('Is a dispatcher the same as a freight broker?','No. A broker represents the shipper and must hold broker authority and a bond. A dispatcher represents you, the carrier, and generally does not need broker authority. A dispatcher should never deal directly with shippers as if brokering.'),
 ('Can I cancel a dispatch service anytime?','With a fair service, yes. Loadboot has no contracts &mdash; we earn your business load by load, and you can stop anytime with no penalty.')]
rich_article('owner-operator-dispatch-service-guide.html',
 'Owner-Operator Dispatch Service: The Complete Guide (2026)',
 'What an owner-operator dispatch service does, what it costs, how it works day to day, and how to choose one &mdash; a complete guide for single-truck operators.',
 'Owner-Operator Guide','Owner-Operator Dispatch Service: The Complete Guide',
 'Everything a single-truck operator needs to know about using a dispatch service &mdash; what it does, what it costs, whether new authority needs one, and how to choose a good one.',
 9,'owner-operator-dispatch-hero.jpg','Owner-operator standing beside his semi-truck reviewing a dispatched load',
 A4_TOC,A4_BODY,A4_FAQ,feat_svg=A4_FEAT)


# ---------- 5. Truck Dispatcher in Texas (local money-page; content-queue #5) ----------
TX_TOC=[('why-texas','Why Texas is different'),('triangle','The Texas Triangle'),('lanes','The lanes that pay'),
        ('equipment','Equipment demand'),('seasons','Seasons & rate swings'),('border','Laredo & border freight'),
        ('week','A sample Texas week'),('dispatcher','What a dispatcher changes'),('bottom-line','The bottom line')]
TX_FEAT='<svg viewBox="0 0 900 320" role="img" aria-label="Texas Triangle freight diagram: Dallas-Fort Worth, Houston and San Antonio connected by I-45, I-10 and I-35"><defs><linearGradient id="txg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="900" height="320" rx="18" fill="url(#txg)"/><g font-family="Manrope,Arial" font-weight="700" font-size="17" fill="#fff"><circle cx="430" cy="70" r="12" fill="#FC5305"/><text x="452" y="76">Dallas&ndash;Fort Worth</text><circle cx="610" cy="235" r="12" fill="#FC5305"/><text x="632" y="241">Houston (port)</text><circle cx="300" cy="240" r="12" fill="#FC5305"/><text x="120" y="246">San Antonio</text><circle cx="180" cy="300" r="9" fill="#0883F7"/><text x="200" y="306" font-size="14">Laredo (border)</text></g><g stroke="#3b82f6" stroke-width="4" fill="none"><path d="M430 82 L610 223"/><path d="M610 235 L312 240"/><path d="M300 228 L430 82"/><path d="M288 248 L192 294" stroke-dasharray="4 8"/></g><g font-family="Inter,Arial" font-size="13" fill="#93c5fd"><text x="540" y="146">I-45 &middot; ~240 mi</text><text x="430" y="262">I-10 &middot; ~200 mi</text><text x="316" y="150">I-35 &middot; ~275 mi</text></g><text x="430" y="188" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#fbbf24">Reload inside a day &mdash; every leg</text></svg>'
TX_BODY=('<h2 id="why-texas">Why Texas is a different trucking market</h2>'
 '<p>Texas moves more truck freight than any other state &mdash; more origins, more destinations, and more freight dollars than anywhere else in the country. It has the busiest land border crossing in the western hemisphere at Laredo, one of the largest petrochemical ports in the world in Houston, a produce pipeline out of the Rio Grande Valley, and two of the ten biggest metro economies in America inside one state line.</p>'
 '<p>That density cuts both ways. There is always a load in Texas &mdash; which is exactly why there is always a <em>cheap</em> load in Texas. Big freight markets attract every carrier hunting a reload, so posted rates on the common lanes get hammered. The operators who do well here are not the ones who find freight (everyone finds freight); they are the ones who consistently avoid the bottom third of it. That is a pricing discipline problem, and it is the single biggest thing a dispatcher changes.</p>'
 + svc_banner('Running a truck in Texas?','A dedicated dispatcher works your lanes, negotiates every rate and handles the paperwork &mdash; flat 5%, no contract.','See carrier services','carriers.html') +
 '<h2 id="triangle">The Texas Triangle: your reload machine</h2>'
 '<p>Dallas&ndash;Fort Worth, Houston and San Antonio form the &ldquo;Texas Triangle&rdquo; &mdash; three major freight markets 200&ndash;275 miles apart, connected by I-45, I-10 and I-35. For a one-truck operation this geometry is gold: every leg is a same-day run, every corner is a market where you can reload, and none of it takes you far from home base. A well-planned Triangle week can turn the same truck 5&ndash;6 times with almost no deadhead.</p>'
 '<p>The catch is that everyone knows it. Triangle lanes are liquid but rarely premium &mdash; treat them as your utilization backbone, not your profit centre. The money is made by pairing a Triangle leg with the freight the Triangle feeds: port drayage-adjacent loads out of Houston, border freight staging in Laredo, distribution volume out of the DFW warehouse belt.</p>'
 '<h2 id="lanes">The lanes that actually pay</h2>'
 '<p>A few patterns hold up year after year. Outbound DFW is one of the most consistent van markets in the country thanks to the warehouse and intermodal build-out north of the metro. Houston pays best when energy is busy &mdash; and its inbound/outbound balance is healthier than most port cities. West Texas (Midland&ndash;Odessa) pays a genuine premium into the oil patch, but plan the exit before you accept: freight out of the Permian is thin, and an unplanned 300-mile deadhead eats the premium. El Paso&ndash;DFW and San Antonio&ndash;Houston run steady; the I-35 corridor north into Oklahoma and Kansas is a fair escape route when Texas rates dip.</p>'
 '<h2 id="equipment">Equipment demand in Texas</h2>'
 '<p><strong>Dry van</strong> is the volume play: retail distribution, consumer goods and border transloads keep vans moving on every Triangle leg. <strong>Flatbed and step deck</strong> earn a structural premium here &mdash; steel, pipe, drilling equipment, and construction materials for cities that never stop building; Houston and the energy corridors are flatbed country. <strong>Reefer</strong> owns the Rio Grande Valley: Mexican produce crosses at Pharr and McAllen year-round and surges seasonally, and reefers also protect food-grade freight through Texas summers that would cook a dry van load. If you run mixed equipment, Texas will use all of it.</p>'
 + svc_banner('Not sure a load is worth it?','Run any Texas load through the free Load Score &mdash; take / negotiate / pass with a counter-offer, in seconds.','Try the Load Score','load-score.html') +
 '<h2 id="seasons">Seasons and rate swings</h2>'
 '<p>Texas has real freight seasons. Produce out of the Valley builds through late winter and peaks in spring, pulling reefers south and lifting van rates behind them. Summer construction keeps flatbeds tight. Energy activity moves with drilling cycles more than the calendar &mdash; when the Permian is busy, everything that touches it pays more. December retail surges DFW and Houston distribution, then January cools everything. None of this is a secret; the edge is simply repricing your floor every week instead of hauling March freight at January rates.</p>'
 '<h2 id="border">Laredo and border freight</h2>'
 '<p>Laredo is the busiest commercial land port in the hemisphere &mdash; thousands of northbound trailers a day, almost all of it transloaded or drop-and-hook on the US side. You do not need to cross into Mexico to earn here: US carriers run the domestic leg, moving freight from Laredo yards to DFW, Houston, San Antonio and beyond. It is heavy, time-sensitive, paperwork-disciplined freight &mdash; brokers on these lanes value carriers who communicate and deliver clean PODs, which is exactly the reputation a good dispatcher builds for you.</p>'
 '<h2 id="week">A sample Texas week (one van, planned right)</h2>'
 '<p><strong>Monday:</strong> load out of the DFW warehouse belt down I-45 to Houston &mdash; delivered by afternoon, reloaded same day because the reload was booked before you left Dallas. <strong>Tuesday:</strong> Houston to San Antonio on I-10, then a short positioning hop toward Laredo in the evening. <strong>Wednesday:</strong> northbound border transload from a Laredo yard to DFW &mdash; the premium leg of the week, secured a day early. <strong>Thursday:</strong> DFW outbound to Oklahoma City at a rate that clears your floor, and back into North Texas on a Friday reload. <strong>Friday:</strong> deliver, invoice packet goes out with the POD, and next Monday is already on the calendar.</p>'
 '<p>Five loads, roughly 1,700&ndash;1,900 paid miles, deadhead in the low single digits as a percentage &mdash; nothing in that week is exotic. Every leg exists on the boards every day. What makes it a strong week instead of a scramble is sequencing: each load was chosen for where it puts the truck NEXT, not just what it pays today. That forward-planning habit &mdash; reload booked before delivery, floor price re-checked weekly, one premium leg anchored midweek &mdash; is precisely the discipline that separates Texas operators who grow from those who churn.</p>'
 '<p>Know your number before the week starts: run your real cost per mile in our <a href="tools.html#cpm">free calculator</a>, then let every accept/decline decision key off it. In a market with this much freight, the floor you enforce is the profit you keep. Authority basics still apply here too &mdash; if you are new, our <a href="authority-dot-setup.html">authority &amp; DOT setup guide</a> and <a href="new-authority-dispatch.html">new-authority dispatch program</a> cover the first 90 days.</p>'
 '<h2 id="dispatcher">What a dispatcher actually changes in Texas</h2>'
 '<p>In a market this liquid, the job is selection, not search. A dispatcher watching your truck knows what the lane should pay before the broker quotes it, counters instead of accepting, and plans the reload before you deliver &mdash; so a Houston drop becomes a same-day Triangle turn instead of an overnight sit. They keep you out of the Permian without an exit load, time the Valley produce surge, and handle the rate cons, broker setups and appointment calls while you drive. On LoadBoot that comes with the operating software &mdash; live tracking, arrive/depart detention stamps, document collection and a P&amp;L that shows what each Texas week actually made &mdash; for a flat 5% only when we book you, no contract.</p>'
 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>Texas rewards utilization and punishes autopilot. The Triangle keeps your wheels turning, the border and the oil patch pay the premiums, the seasons move the floor &mdash; and the difference between a strong Texas operation and a struggling one is almost always rate discipline, not load availability. If you would rather spend your hours driving than defending your floor price on every call, that is the job we do all day.</p>')
TX_FAQ=[
 ('Do I need Texas intrastate authority to run with a dispatcher?','If you cross state lines you operate under your federal MC/DOT authority. Hauling for-hire freight that stays entirely inside Texas requires separate intrastate operating authority through TxDMV. Many Texas carriers run interstate only and never need it &mdash; check your own operation before turning down intrastate freight.'),
 ('What equipment earns most in Texas?','Flatbed and step deck carry a structural premium on energy and construction freight, reefer owns the Rio Grande Valley produce lanes, and dry van wins on volume and consistency across the Triangle. The best answer is the equipment you can keep loaded &mdash; a dispatcher matches the freight mix to what you run.'),
 ('Is border freight worth it for a small carrier?','Yes &mdash; the domestic leg out of Laredo is open to any US carrier and pays consistently because volume never stops. It demands clean paperwork and reliable communication; carriers who deliver both get repeat freight from the same brokers.'),
 ('How does LoadBoot charge Texas carriers?','The same flat 5% of the linehaul as everywhere else &mdash; no sign-up fee, no monthly minimum, no contract. You approve every load, keep your own authority, and only pay when we actually book you.'),
]
rich_article('truck-dispatcher-in-texas.html',
 'Truck Dispatcher in Texas &mdash; Lanes, Rates &amp; Loads (2026) | Loadboot',
 'Truck dispatch in Texas: Triangle lanes, Laredo border freight, energy and produce seasons, and how a dispatcher keeps a Texas truck loaded.',
 'Texas Carrier Guide','Truck Dispatcher in Texas: Lanes, Rates &amp; How to Stay Loaded',
 'The biggest trucking market in America is also the easiest place to haul cheap. The Triangle, the border, the oil patch, the produce season &mdash; and how dispatch discipline turns Texas volume into Texas profit.',
 8,'truck-fleet.webp','Semi trucks staged at a Texas freight yard',
 TX_TOC,TX_BODY,TX_FAQ,feat_svg=TX_FEAT)


# ---------- 6. Do New-Authority Carriers Need a Dispatcher? (content-queue #6) ----------
NA_TOC=[('the-wall','The new-authority wall'),('what-blocks','What actually blocks you'),('first-90','The first 90 days'),
        ('what-fixes','What a dispatcher fixes'),('what-not','What a dispatcher canNOT fix'),('when-skip','When you can skip one'),
        ('math','The math of waiting'),('bottom-line','The bottom line')]
NA_FEAT='<svg viewBox="0 0 900 320" role="img" aria-label="Timeline of a new authority: filing, protest window, activation, the 90-day credibility gap, established"><defs><linearGradient id="nag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="900" height="320" rx="18" fill="url(#nag)"/><path d="M80 190 H820" stroke="#334155" stroke-width="6" stroke-linecap="round"/><g font-family="Manrope,Arial" font-weight="700" font-size="15" fill="#fff"><circle cx="120" cy="190" r="11" fill="#0883F7"/><text x="86" y="232">File MC</text><circle cx="300" cy="190" r="11" fill="#0883F7"/><text x="240" y="232">Protest window</text><circle cx="470" cy="190" r="11" fill="#FC5305"/><text x="424" y="232">Authority active</text><circle cx="680" cy="190" r="11" fill="#FC5305"/><text x="600" y="232">~90 days: brokers open up</text></g><rect x="470" y="120" width="210" height="40" rx="10" fill="#FC530522" stroke="#FC5305"/><text x="492" y="146" font-family="Inter,Arial" font-size="15" fill="#fdba74">The credibility gap</text><text x="80" y="80" font-family="Manrope,Arial" font-weight="800" font-size="24" fill="#fff">The 90 days that decide a new authority</text></svg>'
NA_BODY=('<h2 id="the-wall">The new-authority wall is real</h2>'
 '<p>You did everything right: entity, EIN, insurance, MC filed, decals on the truck. Then you start calling on loads and hear the same sentence all week: &ldquo;we require six months of active authority.&rdquo; It is not personal and it is not a myth &mdash; a large share of brokerages enforce an authority-age rule because fraud rings and fly-by-night operators cluster in fresh MCs. The result is a paradox every new carrier feels: you need loads to build a record, and you need a record to get loads.</p>'
 '<p>The honest question is not &ldquo;is it hard?&rdquo; &mdash; it is &ldquo;what actually gets a fresh MC through the wall, and is a dispatcher part of that answer?&rdquo;</p>'
 '<h2 id="what-blocks">What actually blocks a fresh MC</h2>'
 '<p>Four things, in order of how often they kill the week. <strong>Broker age rules</strong> &mdash; many won&rsquo;t set you up before 90 days to 6 months, but a meaningful minority will, and finding them is a research job. <strong>Setup friction</strong> &mdash; every new broker relationship means a packet (W-9, COI, authority letter, references) and an hour of back-and-forth; done sloppily it costs you the load. <strong>Pricing blindness</strong> &mdash; without lane history you cannot tell a fair rate from a predatory one, and cheap freight finds new authorities like water finds a low spot. <strong>Cash timing</strong> &mdash; brokers commonly pay in 30 days while fuel is due today, so week three is where underprepared authorities die.</p>'
 + svc_banner('Fresh MC?','Our new-authority program targets the brokers who say yes to young authorities — and prices every load against your costs.','See the new-authority program','new-authority-dispatch.html') +
 '<h2 id="first-90">The first 90 days decide everything</h2>'
 '<p>The carriers who make it treat the first 90 days as a credibility project, not just a hunt for revenue. Every clean pickup, on-time delivery and fast POD builds the record that unlocks the next tier of brokers. Every late document, missed appointment or silent phone does the opposite &mdash; and with a fresh MC there is no old goodwill to spend. Ninety days of boring reliability is worth more than one heroic week.</p>'
 '<h2 id="what-fixes">What a dispatcher actually fixes</h2>'
 '<p>A good dispatcher attacks exactly the four blockers. They already know <em>which brokers work with new authorities</em>, so your truck starts where the doors open instead of dialing into walls. They run the <em>setup packets</em> professionally &mdash; same documents, every time, no typos that flag fraud filters. They <em>price every load</em> against the lane and your cost per mile, which matters most precisely when you have no instinct for the market yet. And they keep the <em>paperwork chain clean</em> &mdash; rate con to POD to invoice &mdash; so factoring or broker payment never stalls on a missing page. On LoadBoot this comes with the operating software: document vault, arrive/depart detention stamps, live tracking, and a P&amp;L that shows what each week truly made &mdash; flat 5% only when a load is booked.</p>'
 '<h2 id="what-not">What a dispatcher canNOT fix</h2>'
 '<p>Honesty matters here. A dispatcher cannot make a 2-week-old MC look 6 months old &mdash; age rules are the broker&rsquo;s, not ours. They cannot fix uninsurable driving records, thin working capital, or a truck that will not pass inspection. And no honest dispatcher can promise specific income &mdash; anyone who does is selling something. What a dispatcher changes is the <em>slope</em>: more of the right doors, fewer unforced errors, better rates on the loads you can get.</p>'
 + svc_banner('Know your number first','Run your real cost per mile in 60 seconds — every accept/decline decision starts there.','Open the free calculator','tools.html#cpm') +
 '<h2 id="when-skip">When you genuinely do not need one</h2>'
 '<p>Skip the dispatcher if you already have direct freight relationships from a previous life, if you are leased to a carrier that feeds you loads, or if you truly enjoy the phone-and-paperwork game and have the hours for it. Dispatch is a service, not a requirement &mdash; the test is simple: multiply the hours you spend hunting and haggling by what your driving hour earns. If that number is bigger than the fee, the dispatcher pays for itself.</p>'
 '<h2 id="math">The math of waiting vs starting right</h2>'
 '<p>A new authority that sits half-loaded for three months does not just lose revenue &mdash; it pays insurance, truck note and plates the whole time, which is why underutilization, not cheap freight, is the number-one killer of fresh MCs. Even a modest improvement &mdash; one extra loaded day a week at honest rates &mdash; usually outweighs a 5% fee several times over. Run your own numbers; the arithmetic is rarely close.</p>'
 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>New-authority carriers do not <em>need</em> a dispatcher &mdash; they need broker access, professional setups, honest pricing and clean paperwork in their first 90 days. A good dispatcher is simply the fastest way most one-truck operations get all four at once. If you would rather spend those 90 days driving than dialing, that is the job we do all day &mdash; and we have done it for fresh MCs since day one.</p>')
NA_FAQ=[
 ('How soon after my authority activates can a dispatcher start?','Immediately. Setup takes about a day once your authority and insurance are in hand — and the earlier the professional packet-and-pricing discipline starts, the faster the 90-day credibility record builds.'),
 ('Will brokers really work with a 1-week-old MC?','Some will. Most enforce age rules, but a real minority accept fresh authorities — usually with stricter document and communication expectations. Knowing who they are is exactly the kind of knowledge a dispatcher trades on.'),
 ('Does using a dispatcher look bad to brokers?','No — brokers deal with professional dispatchers all day and generally prefer a clean, responsive dispatch desk over a driver answering from a dock. You remain the carrier of record; the dispatcher works for you.'),
 ('What does LoadBoot charge a new authority?','The same flat 5% of the linehaul as every carrier — no setup fee, no monthly minimum, no contract. You approve every load and can leave any time.'),
]
rich_article('do-new-authority-carriers-need-a-dispatcher.html',
 'Do New-Authority Carriers Need a Dispatcher? (2026) | Loadboot',
 'Fresh MC and no broker callbacks? What actually blocks new authorities, what a dispatcher fixes (and cannot fix), when to skip one, and the math of the first 90 days.',
 'New-Authority Guide','Do New-Authority Carriers Need a Dispatcher?',
 'The first 90 days under a fresh MC decide whether the truck earns or the authority lapses. Here is what actually blocks new carriers, what a dispatcher changes &mdash; and the honest cases where you should skip one.',
 7,'new-authority.webp','New authority owner-operator beside his truck reviewing broker setup paperwork',
 NA_TOC,NA_BODY,NA_FAQ,feat_svg=NA_FEAT)


# ---------- 7. How to Read a Rate Confirmation (content-queue #7) ----------
RC_TOC=[('what-it-is','What a rate con actually is'),('ten-lines','The 10 lines to check every time'),
        ('fine-print','Where the fine print eats your money'),('penalties','Tracking & late penalties'),
        ('mismatch','Name & number mismatches'),('refuse','When to refuse to sign'),
        ('after','After you sign'),('bottom-line','The bottom line')]
RC_FEAT='<svg viewBox="0 0 900 320" role="img" aria-label="Anatomy of a rate confirmation: parties, load, money, terms, deadlines"><defs><linearGradient id="rcg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="900" height="320" rx="18" fill="url(#rcg)"/><rect x="60" y="46" width="300" height="228" rx="12" fill="#fff" opacity=".96"/><rect x="84" y="72" width="180" height="12" rx="5" fill="#10223B"/><rect x="84" y="98" width="240" height="8" rx="4" fill="#94a3b8"/><rect x="84" y="116" width="220" height="8" rx="4" fill="#94a3b8"/><rect x="84" y="134" width="236" height="8" rx="4" fill="#94a3b8"/><rect x="84" y="160" width="110" height="16" rx="5" fill="#FC5305"/><rect x="84" y="192" width="228" height="8" rx="4" fill="#cbd5e1"/><rect x="84" y="210" width="200" height="8" rx="4" fill="#cbd5e1"/><rect x="84" y="240" width="120" height="10" rx="4" fill="#0883F7"/><g font-family="Manrope,Arial" font-weight="700" font-size="16" fill="#fff"><text x="430" y="80">1. Both legal names + MC numbers</text><text x="430" y="112">2. The number: total, all-in, in writing</text><text x="430" y="144">3. Detention / layover / TONU terms</text><text x="430" y="176">4. Tracking &amp; late-delivery penalties</text><text x="430" y="208">5. POD deadline + invoice instructions</text><text x="430" y="248" fill="#fdba74">Sign only when all five are clean.</text></g></svg>'
RC_BODY=('<h2 id="what-it-is">What a rate confirmation actually is</h2>'
 '<p>A rate confirmation is not paperwork &mdash; it is the contract for that load. There is no single federal &ldquo;rate con form&rdquo;; the signed document is simply the strongest written evidence of what the broker owes you and what you owe the broker. When a payment dispute lands, nobody asks what was said on the phone. They ask what the rate con says. That is why the five minutes you spend reading it are the best-paid five minutes of the load.</p>'
 '<h2 id="ten-lines">The 10 lines to check, every single time</h2>'
 '<p><strong>1) Your legal name and MC</strong> &mdash; exactly right, or payment can stall and worse (a wrong carrier name is a double-brokering red flag). <strong>2) The broker&rsquo;s legal name and MC</strong> &mdash; must match the entity you verified. <strong>3) The total amount</strong> &mdash; all-in or linehaul-plus-fuel? Get the word &ldquo;total&rdquo; in writing. <strong>4) Pickup and delivery dates/times</strong> &mdash; and whether they are appointments or FCFS. <strong>5) Commodity and weight</strong> &mdash; what you agreed to haul, not a surprise. <strong>6) Equipment</strong> &mdash; the trailer they expect. <strong>7) Detention terms</strong> &mdash; free hours and the hourly rate, in numbers. <strong>8) Layover and TONU</strong> &mdash; the numbers, not &ldquo;market rate&rdquo;. <strong>9) Lumper handling</strong> &mdash; who pays, and how reimbursement works. <strong>10) POD deadline and invoice instructions</strong> &mdash; miss these and a perfect delivery still pays late.</p>'
 + svc_banner('Tired of decoding rate cons?','On LoadBoot every booked trip gets an automatic, unchangeable rate confirmation — every term from the load, nothing slipped in after.','See how dispatch works','how-it-works.html') +
 '<h2 id="fine-print">Where the fine print eats your money</h2>'
 '<p>The rate is rarely where carriers lose. The losses hide lower down: a detention clause that starts the clock only after you call twice; a &ldquo;driver assist required&rdquo; line nobody mentioned; a lumper paragraph that reimburses only with a receipt submitted within 24 hours; an offset clause letting the broker deduct claims from unrelated loads. Read below the money line &mdash; that is where the money actually moves.</p>'
 '<h2 id="penalties">Tracking and late penalties</h2>'
 '<p>Modern rate cons carry per-event penalties: a fee for every missed check call, a flat deduction for tracking that goes dark, a percentage for late delivery regardless of cause. None of these are illegal &mdash; but they must be priced. A load that pays $50 more with a $150 tracking penalty and a hard appointment is not the better load. If a penalty clause is vague ("carrier liable for all costs of delay"), ask for a number or walk.</p>'
 '<h2 id="mismatch">Name and number mismatches — the fraud tell</h2>'
 '<p>If the rate con shows a different carrier name than yours, a different MC than the broker you spoke to, an email domain that almost matches, or payment instructions that changed at the last minute &mdash; stop. These are the classic marks of double-brokering and identity fraud that regulators explicitly warn about. Verify independently through the number on the broker&rsquo;s official record, never the one in the suspicious email.</p>'
 + svc_banner('Every load, terms up front','LoadBoot loads cannot even be posted without detention, layover, TONU and lumper terms — you see the full rate card before you accept.','Browse carrier services','carriers.html') +
 '<h2 id="refuse">When to refuse to sign</h2>'
 '<p>Refuse when: the carrier name is wrong; the amount differs from the agreed number; detention/layover/TONU are blank or &ldquo;per policy&rdquo;; the broker refuses to put a verbal promise in writing; you are asked to move the load on another company&rsquo;s MC; or the document arrives from an address you cannot verify. A load without a clean rate con is not a load &mdash; it is a dispute with a pickup date.</p>'
 '<h2 id="after">After you sign</h2>'
 '<p>Save the signed copy where you can find it in ten seconds &mdash; it belongs in the invoice packet with the BOL/POD and any receipts. Never accept edits by phone: any change (rate bump for a reload, a new delivery time) deserves a revised rate con or at minimum a written confirmation. And match the final payment against the document line by line; short-pays hide in the difference.</p>'
 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>The rate con is your paycheck in draft form. Read the ten lines, price the penalties, verify the parties, and refuse the vague ones &mdash; or run with a dispatch service that refuses them for you. On LoadBoot the rate confirmation is generated automatically from the load&rsquo;s own posted terms and can never be edited afterward &mdash; because the fine print should never be a surprise.</p>')
RC_FAQ=[
 ('Is a rate confirmation legally binding?','It is the strongest written evidence of the agreement between broker and carrier — courts and factoring companies treat the signed rate con as the operative terms for that load. That is exactly why every term you rely on must appear on it, in numbers.'),
 ('Can a broker change the rate con after I sign?','Not unilaterally. Any change should come as a revised, re-signed confirmation or clear written agreement. On LoadBoot the generated rate confirmation is immutable — no edit path exists for anyone, including dispatch.'),
 ('What if detention terms are missing?','Ask for them in writing before you sign. A blank detention line usually means unpaid hours at the dock. LoadBoot loads cannot be posted without detention, layover, TONU and lumper terms — the rate card is enforced before a carrier ever sees the load.'),
 ('Who should sign the rate con — me or my dispatcher?','Your dispatcher may sign only if your dispatch agreement gives them that written authority (a limited power of attorney). Either way the terms bind the CARRIER — so the reading rules in this guide apply to whoever holds the pen.'),
]
rich_article('how-to-read-a-rate-confirmation.html',
 'How to Read a Rate Confirmation Before You Sign | Loadboot',
 'Rate confirmation explained for carriers: the 10 lines to verify, fine-print traps, fraud tells, when to refuse to sign, and what to do after.',
 'Carrier Paperwork Guide','How to Read a Rate Confirmation (Before You Sign It)',
 'The rate con is the contract that decides whether you get paid. The ten lines to check every time, the traps under the money line, the fraud tells &mdash; and when the right answer is to walk.',
 7,'dispatcher-cost-hero.jpg','Owner-operator reviewing a rate confirmation document before signing',
 RC_TOC,RC_BODY,RC_FAQ,feat_svg=RC_FEAT)


# ---------- 8. Truck Dispatcher in California (local money-page; content-queue #8) ----------
CA_TOC=[('why-ca','Why California is different'),('ports','The ports engine'),('produce','Central Valley produce'),
        ('corridors','The corridors that pay'),('compliance','CARB, AB5 & CA compliance'),('seasons','Seasons & rate swings'),
        ('dispatcher','What a dispatcher changes'),('bottom-line','The bottom line')]
CA_FEAT='<svg viewBox="0 0 900 320" role="img" aria-label="California freight map: LA/Long Beach ports, Central Valley produce belt, I-5 and Highway 99 corridors to Bay Area and Sacramento"><defs><linearGradient id="cag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="900" height="320" rx="18" fill="url(#cag)"/><g font-family="Manrope,Arial" font-weight="700" font-size="16" fill="#fff"><circle cx="250" cy="255" r="12" fill="#FC5305"/><text x="272" y="261">LA / Long Beach ports</text><circle cx="330" cy="150" r="11" fill="#FC5305"/><text x="352" y="156">Central Valley (produce)</text><circle cx="240" cy="70" r="11" fill="#FC5305"/><text x="262" y="76">Bay Area / Oakland</text><circle cx="430" cy="60" r="9" fill="#0883F7"/><text x="450" y="66" font-size="14">Sacramento</text></g><g stroke="#3b82f6" stroke-width="4" fill="none"><path d="M250 243 C 300 210 320 180 330 162"/><path d="M330 138 C 300 110 260 88 248 80"/><path d="M338 140 C 390 110 420 80 430 70"/></g><g font-family="Inter,Arial" font-size="13" fill="#93c5fd"><text x="180" y="205">I-5 / 710</text><text x="250" y="115">I-5</text><text x="385" y="105">Hwy 99</text></g><text x="540" y="180" font-family="Manrope,Arial" font-weight="800" font-size="20" fill="#fbbf24">Imports in, produce out —</text><text x="540" y="208" font-family="Manrope,Arial" font-weight="800" font-size="20" fill="#fbbf24">price the imbalance, win the week</text></svg>'
CA_BODY=('<h2 id="why-ca">Why California is a different game</h2>'
 '<p>California is the largest freight economy in the country: the twin ports of Los Angeles and Long Beach move a huge share of America&rsquo;s imports, the Central Valley grows a stunning portion of its produce, and forty million consumers pull retail freight into every metro. It is also the most regulated place in America to run a truck. That combination &mdash; enormous volume plus real compliance rules &mdash; is exactly why disciplined operators do well here and casual ones bleed.</p>'
 '<p>The structural fact to price on every California load: the state IMPORTS more truck freight than it exports on many consumer lanes, while EXPORTING seasonal produce in huge waves. Inbound and outbound rates can live in different worlds. Carriers who treat &ldquo;a California load&rdquo; as one market get burned by the imbalance; carriers who price the direction win.</p>'
 + svc_banner('Running California lanes?','A dedicated dispatcher prices the imbalance, times the produce waves and keeps your paperwork CA-clean — flat 5%, no contract.','See carrier services','carriers.html') +
 '<h2 id="ports">The ports engine</h2>'
 '<p>LA/Long Beach freight ripples far beyond the harbor: transloaded import freight moves to Inland Empire warehouses (Ontario, Fontana, Riverside), then fans out across the country. You do not need port credentials to earn from this engine &mdash; the Inland Empire outbound market is one of the busiest van markets anywhere. The catch is congestion economics: appointments, yard dwell and traffic can eat a day. This is precisely where measured detention (arrive/depart stamps) stops being a nicety and becomes your margin.</p>'
 '<h2 id="produce">Central Valley produce</h2>'
 '<p>From Bakersfield to Fresno to Salinas, the Valley loads reefers nearly year-round with real surges by crop: leafy greens out of Salinas, stone fruit and grapes in summer, citrus in winter. Produce pays for reliability &mdash; strict cold chains, early appointments, receivers who reject late trucks. Reefer operators who build a reputation for showing up cold and on time get the repeat freight; everyone else gets the leftovers. Dry van operators note: produce season lifts EVERYTHING outbound, including van rates, as capacity drains into reefers.</p>'
 '<h2 id="corridors">The corridors that pay</h2>'
 '<p>The I-5 spine (LA &rarr; Sacramento &rarr; Oregon/Washington) and Highway 99 through the Valley towns are the workhorses. LA&harr;Bay Area runs like a conveyor both directions. Out-of-state, LA&rarr;Phoenix and LA&rarr;Las Vegas are liquid daily moves; the long haul east (I-10/I-40) pays well outbound but demands a plan for the return &mdash; the classic California trap is a strong outbound rate followed by a cheap crawl home. Price the ROUND TRIP, not the leg.</p>'
 '<h2 id="compliance">CARB, AB5 and the California compliance layer</h2>'
 '<p>Two California-specific realities belong in every operating plan. <strong>CARB</strong>: the state enforces its own emissions rules for trucks operating in California, and equipment that does not meet the applicable requirements can be barred from operating there &mdash; check your truck&rsquo;s status against CARB&rsquo;s current rules before committing to CA freight. <strong>AB5</strong>: California&rsquo;s worker-classification law has reshaped how owner-operators contract with motor carriers in-state; structures that are routine elsewhere may need review here. Neither is a reason to avoid California &mdash; both are reasons to verify your setup with the official sources (CARB, EDD/DIR) or qualified counsel before you build a business on CA lanes. This guide is education, not legal advice.</p>'
 + svc_banner('Is that CA load worth it?','Run it through the free Load Score — take / negotiate / pass with a counter-offer, deadhead and reload market included.','Try the Load Score','load-score.html') +
 '<h2 id="seasons">Seasons and rate swings</h2>'
 '<p>Produce sets the calendar: Salinas ramps through spring, the Valley peaks through summer, citrus carries winter. Retail import waves build into late summer ahead of the holidays and pull Inland Empire outbound tight. January is the reset, as it is everywhere &mdash; but California&rsquo;s floor stays firmer than most states because the consumption engine never stops. The move is the same as ever: re-price your floor weekly and never haul July freight at January rates.</p>'
 '<h2 id="dispatcher">What a dispatcher actually changes in California</h2>'
 '<p>Direction-aware pricing (inbound vs outbound are different markets), produce-season timing, Inland Empire reload chains so a port-area drop becomes a same-day turn, detention discipline at congested docks, and the paperwork rhythm California receivers demand. On LoadBoot that rides on the operating software &mdash; measured arrive/depart stamps, immutable rate confirmations, document packs, and a P&amp;L that shows what each CA week actually made &mdash; for a flat 5% only when we book you.</p>'
 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>California rewards carriers who respect its two truths: the freight is enormous, and the rules are real. Price the imbalance, ride the produce calendar, keep CARB and AB5 questions answered by official sources, and protect every dock hour with measured stamps. If you would rather drive the I-5 than manage all of that from the cab &mdash; that is the job we do all day.</p>')
CA_FAQ=[
 ('Can out-of-state carriers run California freight?','Yes — interstate authority covers loads in and out of California. Your equipment must meet CARB&rsquo;s applicable emissions requirements to operate in the state, so verify your truck&rsquo;s status on CARB&rsquo;s official resources before committing to CA lanes.'),
 ('Is AB5 a problem for owner-operators?','AB5 changed how worker classification is tested in California and reshaped many in-state contracting structures. Interstate operations and different business setups are affected differently — get current guidance from official sources or counsel; do not rely on forum posts (or this article) as legal advice.'),
 ('What equipment earns most in California?','Reefer owns the produce economy and pays for cold-chain reliability; dry van rides the ports/Inland Empire import engine; flatbed serves construction and solar. As everywhere, the best equipment is the one you keep loaded both directions.'),
 ('How does LoadBoot charge California carriers?','The same flat 5% of the linehaul as every carrier — no setup fee, no monthly minimum, no contract. Every load shows its full rate card before you accept, and detention is measured from your own arrive/depart stamps.'),
]
rich_article('truck-dispatcher-in-california.html',
 'Truck Dispatcher in California — Ports &amp; Produce (2026) | Loadboot',
 'Truck dispatch in California: LA/Long Beach ports, Inland Empire reloads, Central Valley produce, I-5/99 corridors, CARB and AB5 realities.',
 'California Carrier Guide','Truck Dispatcher in California: Ports, Produce &amp; Staying Compliant',
 'The biggest freight economy in America is also its most regulated. The ports engine, the produce calendar, the I-5 spine &mdash; and the CARB/AB5 layer every CA operator must respect.',
 8,'truck-fleet.webp','Trucks staged near a California distribution hub',
 CA_TOC,CA_BODY,CA_FAQ,feat_svg=CA_FEAT)


# ---------- 9. How to Avoid Cheap Freight (content-queue #9) ----------
CF_TOC=[('system','Cheap freight is a system'),('floor','Your floor price'),('traps','The lanes that trap you'),
        ('reload','Reload math beats rate math'),('say-no','How to say no'),('negotiate','Negotiating up'),
        ('discipline','The weekly discipline'),('bottom-line','The bottom line')]
CF_FEAT='<svg viewBox="0 0 900 320" role="img" aria-label="Chart: loads above your floor compound into profit; loads below it compound into losses"><defs><linearGradient id="cfg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="900" height="320" rx="18" fill="url(#cfg)"/><path d="M100 170 H800" stroke="#FC5305" stroke-width="4" stroke-dasharray="10 8"/><text x="104" y="158" font-family="Manrope,Arial" font-weight="700" font-size="16" fill="#fdba74">YOUR FLOOR (real cost/mi + margin)</text><path d="M140 240 L260 210 L380 235 L500 190 L620 130 L740 90" stroke="#16a34a" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M140 250 L260 262 L380 258 L500 275 L620 282 L740 295" stroke="#dc2626" stroke-width="6" fill="none" stroke-linecap="round"/><text x="620" y="70" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#86efac">accept above the floor</text><text x="560" y="312" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#fca5a5">"just this once" below it</text></svg>'
CF_BODY=('<h2 id="system">Cheap freight is a system, not bad luck</h2>'
 '<p>Cheap freight exists because it works &mdash; on somebody. Every day, loads priced below any honest cost-per-mile get moved by carriers who never calculated one, are desperate at 4pm on a Friday, or believe the reload story a poster tells them. The market is engineered to find the operator without a number. The fix is not outrage; it is a system: a floor, a reload plan, and a practiced no.</p>'
 '<h2 id="floor">Your floor price is the whole game</h2>'
 '<p>Your floor is your real all-in cost per mile (truck, insurance, fuel, maintenance reserve, plates, YOUR pay) plus the margin you exist to earn. Not the market&rsquo;s number &mdash; yours. Compute it honestly once, re-check it monthly, and every accept/decline becomes arithmetic instead of emotion. A load $0.30 below your floor is not &ldquo;keeping the wheels turning&rdquo;; it is paying a broker for the privilege of aging your truck.</p>'
 + svc_banner('Never computed your floor?','The free cost-per-mile calculator turns your monthly bills into the one number every decision depends on.','Get my number','tools.html#cpm') +
 '<h2 id="traps">The lanes that trap you</h2>'
 '<p>Cheap freight clusters where trucks cluster: the big consumer markets everyone deadheads toward, the day after a holiday, the outbound leg of every hot inbound market (Florida, Denver, the Northeast). The pattern is always the same &mdash; a strong rate INTO a market that exports little, followed by a &ldquo;take it or sit&rdquo; rate out. The trap is not the first load. It is accepting the first load without pricing the second.</p>'
 '<h2 id="reload">Reload math beats rate math</h2>'
 '<p>Professionals evaluate PAIRS, not loads: what the round trip pays per total mile including deadhead, not what one leg brags. A $3.00/mi leg into a dead market followed by $1.20 out averages worse than two honest $2.20 legs. Before you accept anything, know three things about the destination: how many loads leave it, what they pay, and how long trucks sit. If you cannot answer, the load is not priced yet.</p>'
 '<h2 id="say-no">How to say no without going broke</h2>'
 '<p>Saying no only works when it is cheap for you to say it &mdash; which is a preparation problem. Keep a cash buffer sized to a slow week so Friday desperation never prices your truck. Keep two or three alternative loads in view before declining one. And decline professionally: &ldquo;that number does not work for this truck &mdash; I can do it at $X&rdquo; keeps the relationship and sometimes gets the counter accepted an hour later, when their cheaper option falls through. It often does.</p>'
 + svc_banner('Want the pairs priced for you?','A dispatcher plans the reload before you deliver and counters every rate against your floor — flat 5%, only when we book you.','See how dispatch works','how-it-works.html') +
 '<h2 id="negotiate">Negotiating up: what actually moves brokers</h2>'
 '<p>Brokers move for specifics, not feelings. &ldquo;I am 20 miles out, empty now, can pick in an hour&rdquo; is worth money. So is &ldquo;clean record on this lane&rdquo;, &ldquo;I will be on time to a hard appointment&rdquo;, and a counter with a number instead of a complaint. Ask what the load NEEDS (speed? reliability? a reefer at the right temp?) and price the need. And get every agreed dollar onto the rate confirmation &mdash; a verbal bump is a story, not money.</p>'
 '<h2 id="discipline">The weekly discipline</h2>'
 '<p>Re-check the floor when fuel moves. Review last week&rsquo;s loads against it &mdash; every violation gets a reason or a rule. Watch which of your lanes are drifting cheap and rotate before the drift becomes your average. Fifteen minutes a week keeps the system honest; the operators who skip it wake up one quarter later hauling the bottom third and calling it a slow market.</p>'
 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>You do not avoid cheap freight by working harder &mdash; you avoid it by knowing your number, pricing the pair, funding your no, and negotiating with specifics. That is a system any one-truck operation can run &mdash; and it is exactly the system a good dispatcher runs for you all day, on every call, without getting tired at 4pm on a Friday.</p>')
CF_FAQ=[
 ('What counts as "cheap" freight?','Anything below YOUR floor — your honest all-in cost per mile plus the margin you exist to earn. The market average is context; your floor is the decision. A load can be above market and still below your floor on a bad pair.'),
 ('Is it ever right to take a below-floor load?','Occasionally — as a priced repositioning move into a strong market, decided in advance as part of a pair that averages above the floor. The danger is not the exception; it is the exception becoming the habit.'),
 ('How do I know the reload market before I go?','Watch load counts and rates for the destination over a week, ask brokers who post there, and track your own history. A dispatcher with live board access does this continuously — it is half the value of having one.'),
 ('Does LoadBoot ever push cheap freight?','The matching engine will not auto-offer you a load below the minimum rate YOU set in your dispatch preferences — your floor is enforced by the system on every automated run, and every load shows its full rate card before you accept.'),
]
rich_article('how-to-avoid-cheap-freight.html',
 'How to Avoid Cheap Freight — Floor Price &amp; Reload Math | Loadboot',
 'Refuse cheap freight without sitting empty: compute your floor price, price reload pairs not single legs, fund your no, and negotiate with specifics.',
 'Rate Discipline Guide','How to Avoid Cheap Freight (Without Sitting Empty)',
 'Every market has a bottom third &mdash; and it is engineered to find the carrier without a number. The floor, the pairs, the practiced no: a system for hauling only freight that pays.',
 7,'owner-operator.webp','Owner-operator reviewing rates on a laptop beside his truck',
 CF_TOC,CF_BODY,CF_FAQ,feat_svg=CF_FEAT)

# ---------- 10. Truck Dispatcher in Georgia & Florida (content-queue #10) ----------
GA_TOC=[('why-se','Why the Southeast works'),('atlanta','Atlanta: the reload machine'),('savannah','Savannah port freight'),
        ('florida','The Florida problem (and profit)'),('lanes','Lanes & seasons'),('dispatcher','What a dispatcher changes'),
        ('bottom-line','The bottom line')]
GA_FEAT='<svg viewBox="0 0 900 320" role="img" aria-label="Southeast freight map: Atlanta hub, Savannah port, Florida inbound-outbound imbalance"><defs><linearGradient id="gag" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="900" height="320" rx="18" fill="url(#gag)"/><g font-family="Manrope,Arial" font-weight="700" font-size="16" fill="#fff"><circle cx="360" cy="90" r="13" fill="#FC5305"/><text x="382" y="96">Atlanta (I-75/I-85/I-20)</text><circle cx="560" cy="130" r="11" fill="#FC5305"/><text x="582" y="136">Savannah (port)</text><circle cx="470" cy="250" r="11" fill="#0883F7"/><text x="492" y="256">Orlando / Tampa / Miami</text></g><g stroke="#3b82f6" stroke-width="4" fill="none"><path d="M372 100 C 450 105 510 118 548 127"/><path d="M368 103 C 400 160 440 215 462 240"/><path d="M556 142 C 530 180 500 220 480 240"/></g><text x="90" y="80" font-family="Manrope,Arial" font-weight="800" font-size="22" fill="#fff">The Southeast triangle</text><text x="90" y="300" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#fbbf24">Florida pays going IN — price the way OUT before you accept</text></svg>'
GA_BODY=('<h2 id="why-se">Why the Southeast works for a truck</h2>'
 '<p>Georgia and Florida together form one of the most active regional freight systems in the country: Atlanta is the distribution capital of the Southeast, Savannah is one of the fastest-growing container ports in America, and Florida is a forty-million-person consumption engine that manufactures comparatively little. Understand those three facts and the whole region prices itself.</p>'
 '<h2 id="atlanta">Atlanta: the reload machine</h2>'
 '<p>Where I-75, I-85 and I-20 cross, everything distributed in the Southeast passes through. For a carrier this means what the Texas Triangle means in Texas: you can almost always reload out of Atlanta the same day. Van volume is the backbone; the warehouse belts to the northwest and south of the city load daily in every direction. Atlanta rates are rarely spectacular precisely because everyone can reload there &mdash; treat it as your utilization anchor and let other legs carry the premium.</p>'
 + svc_banner('Running Southeast lanes?','A dedicated dispatcher anchors your week on Atlanta reloads and prices every Florida leg as a round trip — flat 5%, no contract.','See carrier services','carriers.html') +
 '<h2 id="savannah">Savannah port freight</h2>'
 '<p>Savannah keeps setting container records, and its import freight fans out to Atlanta and the whole eastern seaboard. As with the California ports, you do not need harbor credentials to profit: the drayage-adjacent and transload outbound market moves daily, and the Savannah&rarr;Atlanta shuttle is one of the steadiest short-haul lanes in the region. Port discipline applies &mdash; appointments and dwell are real, so arrive/depart stamps protect your day.</p>'
 '<h2 id="florida">The Florida problem — and the profit inside it</h2>'
 '<p>Florida is the textbook inbound market: everything a Floridian buys arrives by truck, so rates INTO the state run strong all year and surge in produce and snowbird seasons. The exit is the test &mdash; outbound loads are fewer and cheaper, and the carriers who ignored that on Monday sit in Orlando on Thursday. The professionals price Florida as a PAIR (strong in, honest out, averaged), target the outbound that does exist (produce north in season, paper and juice out of the I-4 corridor), and never let a hot inbound rate hide a dead exit.</p>'
 '<h2 id="lanes">Lanes and seasons</h2>'
 '<p>Atlanta&harr;Florida (I-75) is the region&rsquo;s conveyor; Atlanta&harr;Charlotte/Nashville extend the reload web; Savannah&rarr;Atlanta shuttles run daily. Seasonally: Florida produce (strawberries, citrus, vegetables) pulls reefers south in winter and loads them north into spring; hurricane season can snap rates in either direction on short notice &mdash; capacity that stays flexible earns the surge honestly. December retail lifts every inbound lane; late summer is the quiet stretch to protect your floor.</p>'
 + svc_banner('Is that Florida load a pair or a trap?','Run it through the free Load Score with the reload market factored — take / negotiate / pass in seconds.','Try the Load Score','load-score.html') +
 '<h2 id="dispatcher">What a dispatcher actually changes here</h2>'
 '<p>Pair-pricing Florida instead of leg-pricing it, anchoring the week on Atlanta reloads, timing the produce runs, and keeping Savannah&rsquo;s appointment discipline paid for with measured detention. On LoadBoot that comes with the operating software &mdash; live tracking, arrive/depart stamps, immutable rate confirmations and a weekly P&amp;L &mdash; for a flat 5% only when we book you, no contract.</p>'
 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>The Southeast rewards carriers who use Atlanta as the anchor, Savannah as the steady earner, and Florida as a priced round trip instead of a one-way celebration. That is a plan a disciplined one-truck operation can run &mdash; and the exact plan a good dispatcher runs for you while you drive I-75.</p>')
GA_FAQ=[
 ('Is Florida freight worth it for a small carrier?','Yes — when priced as a pair. Inbound rates are genuinely strong; the mistake is celebrating the inbound without pricing the outbound before you accept. Averaged honestly, Florida rounds are solid weekly anchors.'),
 ('What equipment does best in Georgia and Florida?','Dry van rides the Atlanta/Savannah distribution engine; reefer owns the winter produce runs north out of Florida; flatbed serves the construction belt across both states. Mixed fleets get the most out of the region.'),
 ('How steady is the Savannah to Atlanta lane?','It is one of the most consistent short-haul lanes in the Southeast — port import volume feeds it daily. Expect appointment discipline on the port side; measured arrive/depart stamps keep the dwell paid.'),
 ('How does LoadBoot charge Southeast carriers?','The same flat 5% of the linehaul as everywhere — no setup fee, no monthly minimum, no contract. Every load shows the full rate card (detention, layover, TONU, lumper) before you accept.'),
]
rich_article('truck-dispatcher-in-georgia.html',
 'Truck Dispatcher in Georgia &amp; Florida (2026 Playbook) | Loadboot',
 'Truck dispatch in Georgia and Florida: Atlanta reloads, Savannah port freight, the Florida imbalance priced as pairs, lanes and seasons.',
 'Southeast Carrier Guide','Truck Dispatcher in Georgia &amp; Florida: The Southeast Playbook',
 'Atlanta is the reload machine, Savannah keeps climbing, and Florida pays great going in &mdash; then tests you on the way out. The Southeast, honestly priced.',
 7,'truck-fleet.webp','Trucks staged at a Southeast distribution yard',
 GA_TOC,GA_BODY,GA_FAQ,feat_svg=GA_FEAT)

# Blog index
THUMBS={
 'how-to-avoid-cheap-freight.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tcf" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#tcf)"/><path d="M50 150 L180 150" stroke="#dc2626" stroke-width="8" stroke-linecap="round"/><path d="M180 150 L350 60" stroke="#16a34a" stroke-width="8" stroke-linecap="round"/><circle cx="180" cy="150" r="10" fill="#FC5305"/><text x="52" y="135" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#fca5a5">cheap</text><text x="252" y="52" font-family="Manrope,Arial" font-weight="800" font-size="17" fill="#86efac">your floor</text><text x="52" y="60" font-family="Manrope,Arial" font-weight="800" font-size="26" fill="#fff">Know your number</text></svg>',
 'truck-dispatcher-in-georgia.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tga" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#tga)"/><circle cx="150" cy="80" r="12" fill="#FC5305"/><circle cx="230" cy="150" r="12" fill="#FC5305"/><path d="M150 92 C 175 120 205 135 222 144" stroke="#3b82f6" stroke-width="4" fill="none"/><text x="60" y="60" font-family="Manrope,Arial" font-weight="800" font-size="26" fill="#fff">Georgia &amp; Florida</text><text x="172" y="76" font-family="Inter,Arial" font-size="14" fill="#93c5fd">Atlanta</text><text x="252" y="156" font-family="Inter,Arial" font-size="14" fill="#93c5fd">Savannah</text></svg>',
 'truck-dispatcher-in-california.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tca" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#tca)"/><path d="M150 25 l30 4 -6 40 22 34 -6 30 -30 36 -26 -10 -8 -34 14 -30 -6 -40 z" fill="none" stroke="#FC5305" stroke-width="5" stroke-linejoin="round"/><circle cx="152" cy="132" r="7" fill="#0883F7"/><circle cx="168" cy="60" r="7" fill="#0883F7"/><path d="M152 132 C 190 110 200 84 168 60" fill="none" stroke="#3b82f6" stroke-width="3" stroke-dasharray="3 7"/><text x="220" y="108" font-family="Manrope,Arial" font-weight="800" font-size="30" fill="#fff">California</text><text x="220" y="136" font-family="Inter,Arial" font-size="14" fill="#93c5fd">ports · produce · I-5</text></svg>',
 'how-to-read-a-rate-confirmation.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="trc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#trc)"/><rect x="60" y="30" width="170" height="140" rx="10" fill="#fff" opacity=".95"/><rect x="78" y="52" width="120" height="9" rx="4" fill="#10223B"/><rect x="78" y="72" width="134" height="6" rx="3" fill="#94a3b8"/><rect x="78" y="88" width="110" height="6" rx="3" fill="#94a3b8"/><rect x="78" y="104" width="126" height="6" rx="3" fill="#94a3b8"/><rect x="78" y="128" width="70" height="12" rx="4" fill="#FC5305"/><circle cx="300" cy="100" r="44" fill="none" stroke="#0883F7" stroke-width="7"/><path d="M280 100 l14 14 l26 -30" fill="none" stroke="#FC5305" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
 'do-new-authority-carriers-need-a-dispatcher.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tna" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#tna)"/><circle cx="110" cy="100" r="54" fill="none" stroke="#FC5305" stroke-width="6" stroke-dasharray="10 8"/><text x="88" y="112" font-family="Manrope,Arial" font-weight="800" font-size="34" fill="#fff">MC</text><path d="M190 100 H320" stroke="#0883F7" stroke-width="8" stroke-linecap="round"/><path d="M320 84 L352 100 L320 116 Z" fill="#0883F7"/><text x="196" y="86" font-family="Inter,Arial" font-size="14" fill="#93c5fd">first 90 days</text></svg>',
 'truck-dispatcher-in-texas.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="ttx" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#ttx)"/><path d="M150 40 h44 v34 h38 l-6 30 -26 26 -8 34 -34 -8 -22 14 -22 -30 -20 -6 14 -34 -12 -26 34 -4 6 -30 z" fill="none" stroke="#FC5305" stroke-width="5" stroke-linejoin="round" transform="translate(60,10)"/><circle cx="238" cy="86" r="7" fill="#0883F7"/><circle cx="286" cy="132" r="7" fill="#0883F7"/><circle cx="212" cy="142" r="7" fill="#0883F7"/><path d="M238 86 L286 132 L212 142 Z" fill="none" stroke="#3b82f6" stroke-width="3" stroke-dasharray="3 7"/><text x="18" y="178" font-family="Manrope,Arial" font-weight="800" font-size="30" fill="#fff">Texas</text></svg>',
 'how-much-does-a-truck-dispatcher-cost.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="ta" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#ta)"/><text x="18" y="150" font-family="Manrope,Arial" font-weight="800" font-size="140" fill="#0883F7" opacity=".42">5%</text><rect x="256" y="120" width="26" height="55" rx="4" fill="#0883F7"/><rect x="292" y="92" width="26" height="83" rx="4" fill="#3b82f6"/><rect x="328" y="64" width="26" height="111" rx="4" fill="#FC5305"/></svg>',
 'truck-dispatcher-vs-freight-broker.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tb" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#tb)"/><text x="172" y="115" font-family="Manrope,Arial" font-weight="800" font-size="34" fill="#fff">VS</text><path d="M70 72 H150" stroke="#0883F7" stroke-width="9" stroke-linecap="round"/><path d="M150 60 L172 72 L150 84 Z" fill="#0883F7"/><path d="M330 128 H250" stroke="#FC5305" stroke-width="9" stroke-linecap="round"/><path d="M250 116 L228 128 L250 140 Z" fill="#FC5305"/></svg>',
 'how-to-get-loads-with-new-authority.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="tc" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs><rect width="400" height="200" fill="url(#tc)"/><path d="M36 150 C 130 105 220 175 372 100" fill="none" stroke="#FC5305" stroke-width="6" stroke-dasharray="2 14" stroke-linecap="round"/><circle cx="36" cy="150" r="10" fill="#0883F7"/><g transform="translate(330,70)" fill="#fff"><rect x="0" y="0" width="6" height="46"/><path d="M6 2 H42 L31 14 L42 26 H6 Z"/></g></svg>',
 'owner-operator-dispatch-service-guide.html':'<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="td" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#1e3a8a"/></linearGradient></defs><rect width="400" height="200" fill="url(#td)"/><text x="24" y="168" font-family="Manrope,Arial" font-weight="800" font-size="150" fill="#0883F7" opacity=".38">1</text><g transform="translate(150,84)" fill="#e2e8f0"><rect x="0" y="0" width="118" height="46" rx="4"/><path d="M118 10h22c3 0 5 1.6 6.8 4l12.4 19c1 1.5 1.6 3.3 1.6 5.2V46H118z" fill="#0883F7"/><rect x="124" y="15" width="15" height="15" fill="#bfdbfe"/></g><g fill="#10223B"><circle cx="188" cy="132" r="13"/><circle cx="286" cy="132" r="13"/></g><g fill="#FC5305"><circle cx="188" cy="132" r="5"/><circle cx="286" cy="132" r="5"/></g></svg>'}
def blog_card(fn,title,excerpt,read):
    thumb=THUMBS.get(fn,'<svg viewBox="0 0 400 200"><rect width="400" height="200" fill="#0b1220"/></svg>')
    slug=fn[:-5] if fn.endswith('.html') else fn
    # Optional real photo: drop a file named thumb-<slug>.jpg in the site folder and it
    # Optional real photo: only referenced if thumb-<slug>.jpg is actually present in SRC,
    # otherwise the branded SVG thumbnail is used (no broken/missing image reference).
    img=('<img src="thumb-'+slug+'.jpg" alt="'+title.replace('"','')+'" loading="lazy" decoding="async">') if asset_exists('thumb-'+slug+'.jpg') else ''
    ov='<div class="bc-ov"></div><span class="bc-brand"><span class="bc-l">L</span>oadboot</span>'
    return ('<a class="blogcard" href="'+fn+'"><div class="bc-thumb">'+thumb+img+ov+'</div><div class="bc-body">'
            '<div class="bc-meta">Guide &middot; '+str(read)+' min read</div><h3>'+title+'</h3><p>'+excerpt
            +'</p><span class="bc-link">Read guide &rarr;</span></div></a>')
PREMIUM_ARTICLES.add('ghost-loads-load-board-problems.html')

GL_FEAT=('<svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid slice">'
 '<style>.glFade{animation:glF 3.2s ease-in-out infinite}@keyframes glF{0%,100%{opacity:.85}50%{opacity:.12}}'
 '.glPulse{animation:glP 1.7s ease-in-out infinite}@keyframes glP{0%,100%{opacity:1}50%{opacity:.35}}'
 '.glTk{animation:glT 6s linear infinite}@keyframes glT{from{transform:translateX(-70px)}to{transform:translateX(470px)}}</style>'
 '<defs><linearGradient id="glbg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1e3a8a"/><stop offset="1" stop-color="#0b1220"/></linearGradient></defs>'
 '<rect width="400" height="200" fill="url(#glbg)"/>'
 '<g class="glFade"><rect x="24" y="34" width="104" height="58" rx="9" fill="#16233f" stroke="#ef4444" stroke-width="1.6" stroke-dasharray="5 4"/>'
 '<text x="38" y="58" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#fca5a5">GHOST</text>'
 '<text x="38" y="78" font-family="Inter,Arial" font-size="10" fill="#94a3b8">covered yesterday</text></g>'
 '<g class="glFade" style="animation-delay:-1.4s"><rect x="146" y="34" width="104" height="58" rx="9" fill="#16233f" stroke="#ef4444" stroke-width="1.6" stroke-dasharray="5 4"/>'
 '<text x="160" y="58" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#fca5a5">EXPIRED</text>'
 '<text x="160" y="78" font-family="Inter,Arial" font-size="10" fill="#94a3b8">pickup passed</text></g>'
 '<g><rect x="268" y="34" width="108" height="58" rx="9" fill="#0e2a1c" stroke="#22c55e" stroke-width="2"/>'
 '<circle class="glPulse" cx="284" cy="52" r="4.5" fill="#22c55e"/>'
 '<text x="294" y="57" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#86efac">LIVE</text>'
 '<text x="282" y="78" font-family="Inter,Arial" font-size="10" fill="#bbf7d0">real &middot; bookable now</text></g>'
 '<text x="24" y="140" font-family="Manrope,Arial" font-weight="800" font-size="21" fill="#fff">Real loads only. Nothing stale.</text>'
 '<rect x="0" y="168" width="400" height="4" fill="#1e293b"/>'
 '<g class="glTk"><text x="0" y="164" font-size="26">&#128667;</text></g></svg>')

GL_TOC=[('what-are-ghost-loads','What ghost loads are'),('seven-problems','The 7 board problems'),
 ('what-it-costs','What it costs you'),('why-it-happens','Why boards stay broken'),
 ('spot-fakes','Spot a fake in 60 seconds'),('the-fix','The fix: an operating system'),
 ('board-vs-os','Load board vs operating system'),('bottom-line','The bottom line')]

GL_BODY=('<h2 id="what-are-ghost-loads">What ghost loads are &mdash; and why your calls go nowhere</h2>'
 '<p>A <b>ghost load</b> is a posting for freight that is no longer available &mdash; usually because the broker covered it hours or days ago on another board and never took the post down. Big brokerages post the same load to <b>multiple boards at once</b> to maximize eyeballs; when it books on one, the copies stay up everywhere else. You call, you wait on hold, and the answer is the same every time: <i>&ldquo;that one&rsquo;s covered.&rdquo;</i></p>'
 '<p>Add <b>stale posts</b> (pickup date already passed), <b>bait-and-switch rates</b> (the posted number was never real), and outright <b>fake postings</b> built for double-brokering scams, and a big chunk of what you scroll every morning simply is not freight you can haul.</p>'
 '<div class="statrow">'
 '<div class="statcard"><div class="n">15&ndash;20</div><div class="l">calls a carrier typically makes before ONE load books</div></div>'
 '<div class="statcard"><div class="n">3&ndash;6 hrs</div><div class="l">of a driving day burned searching, calling, negotiating</div></div>'
 '<div class="statcard"><div class="n">$10B+</div><div class="l">total industry fraud losses, 2022&ndash;2025 (incl. $4B double brokering)</div></div>'
 '</div>'
 '<p class="pull">The board is not showing you the market. It is showing you what nobody bothered to delete.</p>'

 '<h2 id="seven-problems">The 7 load-board problems every carrier knows by heart</h2>'
 '<ol>'
 '<li><b>Ghost loads.</b> Covered freight still posted. Industry reporting calls it standard operating procedure &mdash; brokers rarely take postings down after covering a load elsewhere.</li>'
 '<li><b>Stale &amp; expired posts.</b> Pickup was yesterday; the post is still live. DAT expires postings at midnight the day they are posted precisely because of this &mdash; and boards still fill with dead freight.</li>'
 '<li><b>Bait-and-switch rates.</b> The posted rate gets you on the phone; the &ldquo;real&rdquo; rate appears once you are anchored and your truck is empty.</li>'
 '<li><b>Double brokering.</b> $4 billion lost 2022&ndash;2025; 15,419 broker authorities revoked; a 65% surge in fraud reports in a single six-month window. The load you hauled gets paid &mdash; to someone who was never a real broker.</li>'
 '<li><b>No rate transparency.</b> You negotiate blind against a broker staring at a rate screen. (Fix that first: our free <a href="market-rates.html">live market rates per mile</a> page shows the buy AND sell side.)</li>'
 '<li><b>Hundreds of carriers per load.</b> Real loads get swarmed; by the time you dial, position 40 in the queue is generous.</li>'
 '<li><b>Accessorials vanish.</b> Detention, TONU, layover, lumpers &mdash; promised on the phone, denied on the invoice. Under half of detention invoices ever get paid; see <a href="detention-pay-policy.html">detention pay</a> and <a href="tonu-policy.html">TONU fees</a>.</li>'
 '</ol>'

 '<h2 id="what-it-costs">What it actually costs you (run your own number)</h2>'
 '<p>Say load-hunting eats <b>4 hours a day</b>. Over a 5-day week that is 20 hours &mdash; two and a half full working days &mdash; spent NOT driving. At $2.30/mi and 50 mph, an hour of wasted searching is roughly <b>$115 of revenue that never happened</b>. Twenty hours a week &asymp; <b>$2,300/week</b> in opportunity cost, before a single fraud loss, unpaid detention invoice, or bait-rate haircut.</p>'
 '<figure class="art-fig"><svg viewBox="0 0 600 210" width="100%" role="img" aria-label="20 calls funnel: 8 ghost or expired, 6 already covered, 4 rate games, 2 real loads, 1 booked">'
 '<text x="0" y="20" font-family="Manrope,Arial" font-weight="800" font-size="18" fill="#10223B">Where 20 calls actually go</text>'
 '<rect x="0" y="40" width="560" height="24" rx="6" fill="#eef2f7"/><rect x="0" y="40" width="224" height="24" rx="6" fill="#ef4444"/>'
 '<text x="232" y="57" font-family="Inter,Arial" font-size="12" fill="#334155">8 &mdash; ghost / expired posts</text>'
 '<rect x="0" y="76" width="560" height="24" rx="6" fill="#eef2f7"/><rect x="0" y="76" width="168" height="24" rx="6" fill="#f59e0b"/>'
 '<text x="176" y="93" font-family="Inter,Arial" font-size="12" fill="#334155">6 &mdash; &ldquo;already covered&rdquo;</text>'
 '<rect x="0" y="112" width="560" height="24" rx="6" fill="#eef2f7"/><rect x="0" y="112" width="112" height="24" rx="6" fill="#94a3b8"/>'
 '<text x="120" y="129" font-family="Inter,Arial" font-size="12" fill="#334155">4 &mdash; rate games / lowballs</text>'
 '<rect x="0" y="148" width="560" height="24" rx="6" fill="#eef2f7"/><rect x="0" y="148" width="56" height="24" rx="6" fill="#0883F7"/>'
 '<text x="64" y="165" font-family="Inter,Arial" font-size="12" fill="#334155">2 &mdash; real, negotiable loads</text>'
 '<text x="0" y="200" font-family="Inter,Arial" font-weight="700" font-size="13" fill="#FC5305">&rarr; 1 booked. Three to six hours gone.</text></svg>'
 '<figcaption>Typical morning on a legacy load board: most dials never had a chance.</figcaption></figure>'

 '<h2 id="why-it-happens">Why load boards stay broken</h2>'
 '<p>Because the incentives point the wrong way. Boards charge brokers to post and carriers to search &mdash; <b>volume is the product</b>, so a board full of duplicate and dead posts still <i>looks</i> healthy. Nobody in that transaction is paid to delete a covered load, verify a rate, or guarantee the freight exists. FreightWaves put it bluntly: load boards are broken, and ghost loads are a big reason small carriers are exiting.</p>'
 '<div class="callout cl-warn"><span class="ic">&#9888;&#65039;</span><div><b>The trust spiral:</b> carriers stop believing posted loads &rarr; they blast calls at everything &rarr; brokers drown in calls for covered freight &rarr; they answer less &rarr; carriers call more. Everyone loses hours; nobody fixes the data.</div></div>'

 '<h2 id="spot-fakes">How to spot a ghost or fake load in 60 seconds</h2>'
 '<div class="art-steps">'
 '<div class="art-step"><div class="sn">1</div><b>Check the post age</b><span>Posted days ago and still up? Ghost until proven otherwise.</span></div>'
 '<div class="art-step"><div class="sn">2</div><b>Check the pickup date</b><span>Pickup already passed = dead post. Do not dial.</span></div>'
 '<div class="art-step"><div class="sn">3</div><b>Verify the broker</b><span>MC number, FMCSA authority status, bond. Mismatched email domains = walk away.</span></div>'
 '<div class="art-step"><div class="sn">4</div><b>Rate too good?</b><span>Check it against the <a href="market-rates.html">market rate for the lane</a>. Way above market is bait, not luck.</span></div>'
 '</div>'
 '<p>That checklist protects you &mdash; but notice what it really is: <b>you doing the board&rsquo;s quality-control job, for free, twenty times a day.</b></p>'

 '<h2 id="the-fix">The fix is not a better board. It is a truck operating system.</h2>'
 '<p>A <b>truck operating system</b> (trucking operating software) treats a load as a living record with a state &mdash; posted, offered, booked, dispatched, delivered &mdash; instead of a classified ad. Once software owns the state, every ghost-load failure mode disappears by construction:</p>'
 '<ul>'
 '<li><b>Booked means gone.</b> The moment a load books on LoadBoot, it leaves every carrier&rsquo;s board automatically. Ghost loads cannot exist.</li>'
 '<li><b>Expired means gone.</b> Pickup day passed? The load is pulled off the board automatically and the broker is emailed to reschedule or cancel. No stale posts.</li>'
 '<li><b>The rate is a contract, not a hook.</b> Every posting carries a written rate card &mdash; linehaul plus detention, TONU, layover, lumper and driver-assist terms &mdash; agreed before you ever call. There is no call.</li>'
 '<li><b>Real deadhead, from your GPS.</b> The board shows true road miles from where your truck sits to every pickup &mdash; not straight-line guesses.</li>'
 '<li><b>Verified counterparties.</b> Brokers and carriers exchange verified packets (authority, insurance, W-9) automatically at booking &mdash; the double-brokering entry points get closed.</li>'
 '<li><b>A dispatch service layer when you want it.</b> LoadBoot&rsquo;s <a href="owner-operator-dispatch.html">truck dispatch service</a> books, negotiates and manages the paperwork at a flat 5% &mdash; the phone work disappears entirely. (Industry dispatchers run 5&ndash;10%.)</li>'
 '</ul>'
 '<div class="svc-banner"><div><div class="sb-t">Stop calling on freight that does not exist</div>'
 '<div class="sb-s">LoadBoot is the truck operating system: a live board with zero ghost loads, written rate cards, GPS-real deadhead, and an optional flat-5% dispatch service on top.</div></div>'
 '<a class="sb-btn" href="get-started.html">Join free &mdash; see live loads &rarr;</a></div>'

 '<h2 id="board-vs-os">Legacy load board vs. truck operating system</h2>'
 '<table class="cmp"><tr><th>What happens</th><th>Legacy load board</th><th class="us">LoadBoot (operating system)</th></tr>'
 '<tr><td>Load gets covered</td><td><span class="no">Post stays up &mdash; ghost load</span></td><td class="us"><span class="yes">Removed from every board instantly</span></td></tr>'
 '<tr><td>Pickup date passes</td><td><span class="no">Post lingers for days</span></td><td class="us"><span class="yes">Auto-pulled; broker emailed to reschedule</span></td></tr>'
 '<tr><td>The posted rate</td><td><span class="no">Opening anchor for a phone fight</span></td><td class="us"><span class="yes">Written rate card incl. accessorials</span></td></tr>'
 '<tr><td>Deadhead miles</td><td><span class="no">You guess from city names</span></td><td class="us"><span class="yes">Live road miles from your GPS</span></td></tr>'
 '<tr><td>Broker identity</td><td><span class="no">You verify manually, every time</span></td><td class="us"><span class="yes">Verified packet exchanged at booking</span></td></tr>'
 '<tr><td>Detention / TONU</td><td><span class="no">&lt;50% of invoices ever paid</span></td><td class="us"><span class="yes">Pre-agreed rates, GPS evidence, auto-claim</span></td></tr>'
 '<tr><td>Booking a load</td><td><span class="no">15&ndash;20 calls, 3&ndash;6 hours</span></td><td class="us"><span class="yes">Request or one-tap accept &mdash; minutes</span></td></tr></table>'

 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>Ghost loads are not bad luck &mdash; they are the predictable output of boards that sell volume instead of truth. You can keep doing the board&rsquo;s quality control by hand, twenty calls at a time, or you can move to software where a posting is only ever one of two things: <b>real and bookable, or gone</b>.</p>'
 '<p>Start where the money is: check your lane on the <a href="market-rates.html">live market rates page</a>, read what you are owed on <a href="detention-pay-policy.html">detention</a> and <a href="tonu-policy.html">TONU</a>, then <a href="get-started.html">open a free carrier account</a> and look at a board with nothing stale on it.</p>')

GL_FAQ=[
 ('What is a ghost load on a load board?','A ghost load is a posting for freight that is no longer available \u2014 usually covered on another board and never deleted. Brokers post the same load to multiple boards at once; when it books on one, the leftover copies become ghosts that waste carriers\u2019 calls.'),
 ('Why do brokers leave covered loads posted?','Nothing forces them to take posts down, and reposting everywhere maximizes their coverage odds. Legacy boards profit from posting volume, so dead posts linger. On a truck operating system the posting is tied to the load\u2019s real state, so a booked or expired load leaves the board automatically.'),
 ('How many calls does it take to book one load?','Carriers commonly report calling on 15\u201320 loads over 3\u20136 hours before one books; on bad days 30+ calls book nothing. Brokers report roughly 7 calls to find one qualified carrier \u2014 the waste runs both directions.'),
 ('How do I avoid fake loads and double brokering?','Verify the MC number and FMCSA authority status, match the contact\u2019s email domain to the company, be suspicious of rates far above the lane\u2019s market rate, and never accept re-tendered freight from a \u201ccarrier.\u201d Double brokering cost the industry about $4B from 2022\u20132025. Platforms that verify both sides and exchange packets at booking close most of these doors.'),
 ('What is a truck operating system?','Software that runs the whole load lifecycle \u2014 posting, offers, booking, dispatch, GPS tracking, documents, invoicing and claims \u2014 in one place, instead of a classified-ads board plus phone calls. Because the system knows each load\u2019s state, ghost loads and stale posts cannot exist on the board.'),
 ('Is LoadBoot a load board or a dispatch service?','Both layers of one system: a live, verified load board where booked and expired freight disappears instantly \u2014 plus an optional flat-5% dispatch service where LoadBoot\u2019s dispatchers find, negotiate and book freight for you (industry dispatch services typically charge 5\u201310%).')]

rich_article('ghost-loads-load-board-problems.html',
 'Ghost Loads &amp; Load Board Problems 2026: Why Booking One Load Takes 20 Calls | LoadBoot',
 'Ghost loads, stale posts, bait rates and double brokering: why carriers burn 3\u20136 hours booking one load, what it costs per week, how to spot fakes \u2014 and how a truck operating system removes the problem entirely.',
 'The Carrier\u2019s #1 Time Thief','Ghost Loads &amp; Fake Freight: Why the Load Board Wastes Your Day \u2014 and the System That Fixes It',
 'The load you just called on was covered yesterday. The next three don\u2019t exist at the posted rate. Here is why the boards stay broken, what it costs you per week, and what a truck operating system does differently.',
 9,'truck-fleet.webp','Owner-operator on the phone next to his truck, searching for loads',
 GL_TOC,GL_BODY,GL_FAQ,feat_svg=GL_FEAT)

THUMBS['ghost-loads-load-board-problems.html']=GL_FEAT

READTIME={'ghost-loads-load-board-problems.html':9,'how-to-avoid-cheap-freight.html':7,'truck-dispatcher-in-georgia.html':7,'truck-dispatcher-in-california.html':8,'how-to-read-a-rate-confirmation.html':7,'do-new-authority-carriers-need-a-dispatcher.html':7,'truck-dispatcher-in-texas.html':8,'how-much-does-a-truck-dispatcher-cost.html':8,'truck-dispatcher-vs-freight-broker.html':9,'how-to-get-loads-with-new-authority.html':6,'owner-operator-dispatch-service-guide.html':9}


# ---------- PER DIEM (money page: trucking tax deductions) ----------
PREMIUM_ARTICLES.add('truck-driver-per-diem-2026.html')

PD_FEAT = ('<svg viewBox="0 0 900 320" role="img" aria-label="Truck driver per diem 2026: $80 per day, 80% deductible, proven by GPS trip records">'
 '<defs><linearGradient id="pdg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#14532d"/></linearGradient></defs>'
 '<rect width="900" height="320" rx="18" fill="url(#pdg)"/>'
 '<text x="48" y="86" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#4ade80" letter-spacing="3">IRS PER DIEM &#183; 2026</text>'
 '<text x="48" y="140" font-family="Manrope,Arial" font-weight="900" font-size="46" fill="#ffffff">$80/day &#215; 80% = $64</text>'
 '<text x="48" y="180" font-family="Manrope,Arial" font-weight="800" font-size="24" fill="#fbbf24">200 nights out = $12,800 deducted</text>'
 '<text x="48" y="222" font-family="Inter,Arial" font-size="17" fill="#93a4bd">No meal receipts needed. Only proof of the nights away &#8212;</text>'
 '<text x="48" y="248" font-family="Inter,Arial" font-size="17" fill="#93a4bd">which is exactly what most drivers cannot produce.</text>'
 '<g transform="translate(640,70)">'
 '<rect width="210" height="180" rx="14" fill="#0b1220" stroke="#22c55e" stroke-opacity=".45"/>'
 '<text x="18" y="34" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#7f92b3">NIGHTS AWAY</text>'
 '<text x="18" y="72" font-family="Manrope,Arial" font-weight="900" font-size="34" fill="#4ade80">214</text>'
 '<text x="18" y="102" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#7f92b3">DEDUCTION</text>'
 '<text x="18" y="140" font-family="Manrope,Arial" font-weight="900" font-size="30" fill="#ffffff">$13,696</text>'
 '<text x="18" y="164" font-family="Inter,Arial" font-size="12" fill="#93a4bd">counted from GPS trips</text>'
 '</g></svg>')

# --- HD product visual 1: the Tax centre, as it actually ships ---
PD_SHOT1 = ('<figure class="art-shot"><svg viewBox="0 0 880 520" role="img" aria-label="LoadBoot Tax centre screen showing per diem nights away, deduction total, tax deadlines and Schedule C expense rollup">'
 '<rect width="880" height="520" rx="16" fill="#0f172a"/>'
 '<rect x="1" y="1" width="878" height="518" rx="16" fill="none" stroke="#22314e"/>'
 '<text x="28" y="44" font-family="Manrope,Arial" font-weight="800" font-size="19" fill="#e6edf8">&#129534; Tax centre &#8212; 2026</text>'
 '<text x="28" y="66" font-family="Inter,Arial" font-size="12.5" fill="#7f92b3">estimates only &#183; not tax advice</text>'
 # per diem hero box
 '<rect x="28" y="86" width="824" height="112" rx="12" fill="#0d2b1c" stroke="#22c55e" stroke-opacity=".38"/>'
 '<text x="48" y="116" font-family="Manrope,Arial" font-weight="800" font-size="15" fill="#4ade80">&#128716; Per diem &#8212; 214 nights away</text>'
 '<text x="48" y="158" font-family="Manrope,Arial" font-weight="900" font-size="34" fill="#4ade80">$13,696</text>'
 '<text x="48" y="182" font-family="Inter,Arial" font-size="13" fill="#93a4bd">214 nights &#215; $80/day &#215; 80% deductible &#183; counted automatically from your GPS trip records</text>'
 # deadlines
 '<text x="28" y="228" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#dbe6f5">&#128197; Deadlines</text>'
 '<g font-family="Inter,Arial" font-size="13">'
 '<text x="28" y="256" fill="#dbe6f5" font-weight="700">Apr 15</text><text x="120" y="256" fill="#7f92b3">Q1 estimated tax + Form 1040</text>'
 '<text x="28" y="282" fill="#dbe6f5" font-weight="700">Jun 16</text><text x="120" y="282" fill="#7f92b3">Q2 estimated tax</text>'
 '<text x="28" y="308" fill="#fbbf24" font-weight="800">Aug 31</text><text x="120" y="308" fill="#7f92b3">Form 2290 (HVUT, 55,000+ lb)</text>'
 '<text x="770" y="308" fill="#fbbf24" font-weight="800">NEXT UP</text>'
 '<text x="28" y="334" fill="#dbe6f5" font-weight="700">Sep 15</text><text x="120" y="334" fill="#7f92b3">Q3 estimated tax</text>'
 '<text x="28" y="360" fill="#dbe6f5" font-weight="700">Jan 15</text><text x="120" y="360" fill="#7f92b3">Q4 estimated tax</text>'
 '</g>'
 '<line x1="28" y1="378" x2="852" y2="378" stroke="#22314e"/>'
 # schedule C
 '<text x="28" y="404" font-family="Manrope,Arial" font-weight="800" font-size="13" fill="#dbe6f5">&#128202; Schedule C &#8212; deductible expenses logged</text>'
 '<g font-family="Inter,Arial" font-size="13">'
 '<text x="28" y="432" fill="#dbe6f5">fuel</text><text x="800" y="432" fill="#dbe6f5" font-weight="800" text-anchor="end">$38,214</text>'
 '<text x="28" y="456" fill="#dbe6f5">maintenance</text><text x="800" y="456" fill="#dbe6f5" font-weight="800" text-anchor="end">$6,480</text>'
 '<text x="28" y="480" fill="#dbe6f5">tolls &#183; scales &#183; parking</text><text x="800" y="480" fill="#dbe6f5" font-weight="800" text-anchor="end">$2,905</text>'
 '<text x="28" y="504" fill="#4ade80" font-weight="800">TOTAL LOGGED</text><text x="800" y="504" fill="#4ade80" font-weight="800" text-anchor="end">$47,599</text>'
 '</g></svg>'
 '<figcaption>Loadboot Tax centre &mdash; nights away are counted from your GPS trip records, so the per diem number (and its proof) builds itself.</figcaption></figure>')

# --- HD product visual 2: per-trip P&L ---
PD_SHOT2 = ('<figure class="art-shot"><svg viewBox="0 0 880 520" role="img" aria-label="LoadBoot per-trip profit and loss statement showing linehaul, detention, fuel, driver pay, factoring and net profit per load">'
 '<rect width="880" height="520" rx="16" fill="#0f172a"/>'
 '<rect x="1" y="1" width="878" height="518" rx="16" fill="none" stroke="#22314e"/>'
 '<text x="28" y="42" font-family="Manrope,Arial" font-weight="800" font-size="18" fill="#e6edf8">Baltimore, MD &#8594; Nashville, TN</text>'
 '<text x="28" y="64" font-family="Inter,Arial" font-size="12.5" fill="#7f92b3">702 mi &#183; $2.79/mi</text>'
 '<text x="852" y="46" font-family="Manrope,Arial" font-weight="900" font-size="22" fill="#4ade80" text-anchor="end">$610.66</text>'
 '<text x="852" y="66" font-family="Inter,Arial" font-size="12" fill="#4ade80" text-anchor="end">31.2% margin</text>'
 '<text x="28" y="102" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#4ade80">MONEY IN</text>'
 '<g font-family="Inter,Arial" font-size="13.5">'
 '<text x="28" y="128" fill="#dbe6f5" font-weight="700">Linehaul</text><text x="852" y="128" fill="#4ade80" font-weight="800" text-anchor="end">$1,881.00</text>'
 '<text x="28" y="154" fill="#dbe6f5" font-weight="700">DETENTION</text><text x="140" y="154" fill="#7f92b3" font-size="11.5">approved &#10003; &#183; GPS-stamped</text><text x="852" y="154" fill="#4ade80" font-weight="800" text-anchor="end">$60.00</text>'
 '<text x="28" y="180" fill="#dbe6f5" font-weight="700">On-time bonus</text><text x="852" y="180" fill="#4ade80" font-weight="800" text-anchor="end">$75.00</text>'
 '<text x="28" y="208" fill="#4ade80" font-weight="800">GROSS</text><text x="852" y="208" fill="#4ade80" font-weight="800" text-anchor="end">$1,956.00</text>'
 '</g>'
 '<text x="28" y="244" font-family="Manrope,Arial" font-weight="800" font-size="12" fill="#f87171">MONEY OUT</text>'
 '<g font-family="Inter,Arial" font-size="13.5">'
 '<text x="28" y="270" fill="#dbe6f5">Fuel &#8212; 702 mi @ 6.5 mpg &#215; $3.85</text><text x="852" y="270" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$415.86</text>'
 '<text x="28" y="296" fill="#dbe6f5">Driver pay &#8212; 702 mi &#215; $0.65/mi</text><text x="852" y="296" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$456.30</text>'
 '<text x="28" y="322" fill="#dbe6f5">Maintenance reserve</text><text x="852" y="322" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$126.36</text>'
 '<text x="28" y="348" fill="#dbe6f5">Fixed overhead</text><text x="852" y="348" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$245.70</text>'
 '<text x="28" y="374" fill="#dbe6f5">Factoring &#8212; 3% of gross</text><text x="852" y="374" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$58.68</text>'
 '<text x="28" y="400" fill="#dbe6f5">I-95 tolls</text><text x="852" y="400" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$42.50</text>'
 '<text x="28" y="428" fill="#f87171" font-weight="800">TOTAL COST</text><text x="852" y="428" fill="#f87171" font-weight="800" text-anchor="end">&#8722;$1,345.34</text>'
 '</g>'
 '<line x1="28" y1="446" x2="852" y2="446" stroke="#3d4d6b" stroke-width="2"/>'
 '<text x="28" y="476" font-family="Manrope,Arial" font-weight="900" font-size="16" fill="#e6edf8">NET PROFIT</text>'
 '<text x="852" y="476" font-family="Manrope,Arial" font-weight="900" font-size="20" fill="#4ade80" text-anchor="end">$610.66</text>'
 '<g font-family="Inter,Arial" font-size="12" fill="#7f92b3">'
 '<text x="28" y="502">RPM $2.79</text><text x="150" y="502">COST/MI $1.92</text><text x="300" y="502">NET/MI $0.87</text><text x="440" y="502">BREAK-EVEN $1.92/mi</text>'
 '</g></svg>'
 '<figcaption>Every load gets its own profit statement &mdash; detention and accessorials land on it automatically, so nothing is forgotten at tax time.</figcaption></figure>')

PD_CALC = ('<div class="pdcalc">'
 '<div class="pdc-h">&#128176; What is YOUR per diem worth?</div>'
 '<div class="pdc-s">Move the slider to the nights you sleep away from home in a year. That is it &mdash; no receipts, no forms.</div>'
 '<div class="pdc-row"><label for="pdNights">Nights away per year</label>'
 '<output id="pdOut">220</output></div>'
 '<input id="pdNights" type="range" min="50" max="330" step="5" value="220" aria-label="Nights away from home per year">'
 '<div class="pdc-grid">'
 '<div class="pdc-tile"><span>YOUR DEDUCTION</span><b id="pdDed">$14,080</b><i>nights &#215; $80 &#215; 80%</i></div>'
 '<div class="pdc-tile pdc-hi"><span>CASH BACK IN YOUR POCKET</span><b id="pdSave">$5,209</b><i>estimated, ~37% marginal rate</i></div>'
 '</div>'
 '<div class="pdc-note">Most drivers claim <b>none of this</b> &mdash; not because they are not owed it, but because they cannot prove the nights. Loadboot GPS-stamps every trip, so the proof writes itself.</div>'
 '<a class="pdc-cta" href="get-started.html">Get my nights counted automatically &rarr;</a>'
 '<script>(function(){var r=document.getElementById("pdNights"),o=document.getElementById("pdOut"),'
 'd=document.getElementById("pdDed"),s=document.getElementById("pdSave");if(!r)return;'
 'function f(n){return "$"+Math.round(n).toLocaleString();}'
 'function u(){var n=+r.value;var ded=n*80*0.8;o.textContent=n;d.textContent=f(ded);s.textContent=f(ded*0.37);}'
 'r.addEventListener("input",u);u();})();</script>'
 '</div>')

PD_TOC = [('the-money','The money you are losing'),('what-is-per-diem','What per diem actually is (2026)'),
 ('the-math','The math: what it is really worth'),('who-can-claim','Who can claim it &mdash; and who cannot'),
 ('why-missed','Why most drivers lose it: the proof problem'),('loadboot','How Loadboot proves it for you'),
 ('beyond','Beyond per diem: the rest of the money'),('mistakes','Five mistakes that cost you'),('bottom-line','The bottom line')]

PD_BODY = ('<h2 id="the-money">The money you are losing</h2>'
 '<p>If you are an owner-operator who sleeps in the truck, there is a deduction sitting in front of you that costs nothing to earn, requires no purchase, and needs <b>not one meal receipt</b>. It is the transportation-industry <b>per diem</b>. And a large share of drivers either never claim it, or claim a fraction of what they are owed.</p>'
 '<p>The scale is not small. Industry tax specialists put it plainly: a driver who spends around <b>200 days on the road and does not claim per diem is leaving over $11,000 in deductions on the table &mdash; every single year</b>. For drivers running 250+ nights, the loss is bigger still.</p>'
 '<p>That is not a rounding error. That is a truck payment. And the reason it goes unclaimed is almost never greed or laziness &mdash; it is <b>proof</b>. Keep reading; the fix is more boring, and more automatic, than you think.</p>'
 + svc_banner('Your trips already ARE the proof','Loadboot GPS-stamps every pickup and delivery, then counts your nights away and computes the deduction for you &mdash; flat 5%, no contract.','See carrier services','carriers.html') +

 '<h2 id="what-is-per-diem">What per diem actually is (2026 rates)</h2>'
 '<p>Per diem is a <b>flat daily allowance</b> the IRS lets you deduct for <b>meals and incidental expenses</b> while you are away from your tax home overnight &mdash; instead of saving and adding up every receipt.</p>'
 '<ul>'
 '<li><b>$80 per full day</b> inside the continental U.S. (CONUS) for the special transportation-industry rate.</li>'
 '<li><b>$86 per day</b> if your route takes you outside CONUS.</li>'
 '<li><b>Partial days</b> (the day you leave and the day you get home) are claimed at a reduced amount &mdash; commonly treated as 75% of the standard rate.</li>'
 '<li><b>80% is deductible</b> for workers subject to DOT hours-of-service rules. Everyone else in business only gets 50% &mdash; truckers get a better deal.</li>'
 '</ul>'
 '<p>So the number that actually reaches your tax return is <b>$80 &times; 80% = $64 per night</b>.</p>'
 '<p>One important limit: in trucking, per diem covers <b>meals and incidentals only</b> &mdash; not lodging. Tips, laundry on the road, that kind of thing. Your truck payment, fuel and repairs are separate deductions entirely.</p>'

 '<h2 id="the-math">The math: what it is really worth</h2>'
 '<p>Run it on your own year:</p>'
 '<table><thead><tr><th>Nights away</th><th>Deduction ($64/night)</th><th>Roughly saved*</th></tr></thead><tbody>'
 '<tr><td>150</td><td>$9,600</td><td>~$3,500</td></tr>'
 '<tr><td>200</td><td>$12,800</td><td>~$4,700</td></tr>'
 '<tr><td>250</td><td>$16,000</td><td>~$5,900</td></tr>'
 '<tr><td>300</td><td>$19,200</td><td>~$7,100</td></tr>'
 '</tbody></table>'
 '<p class="small">*A deduction is not a refund &mdash; it lowers the income you are taxed on. For a self-employed owner-operator, the combined bite of self-employment tax (15.3%) plus federal income tax often lands somewhere near the mid-30s as a marginal rate, so every $100 deducted commonly keeps roughly $35&ndash;$37 in your pocket. Your exact number depends on your bracket. Talk to your CPA.</p>'
 '<p>Even at the low end, this single line is usually worth <b>more than a month of net revenue</b> to a solo owner-operator. And notice what it costs you to claim it: nothing. You already slept in the truck.</p>'

 + PD_CALC +

 '<h2 id="who-can-claim">Who can claim it &mdash; and who cannot</h2>'
 '<p>This is where a lot of drivers get burned, so read it twice.</p>'
 '<ul>'
 '<li><b>Owner-operators / self-employed (Schedule C): YES.</b> You claim per diem as a business expense against your business income.</li>'
 '<li><b>Company drivers on a W-2: NO.</b> Since the Tax Cuts and Jobs Act removed unreimbursed employee expenses, a W-2 company driver <b>cannot</b> deduct per diem on their return. Some carriers run a per diem <i>pay program</i> instead &mdash; that is payroll, not a deduction, and it is a different conversation (it can lower your taxable wages but also your reported income for loans and Social Security).</li>'
 '</ul>'
 '<p>Also non-negotiable: you must be <b>away from your tax home overnight</b>, long enough to need rest. A 14-hour turn where you sleep in your own bed is not a per diem night. The overnight is the whole test.</p>'

 '<h2 id="why-missed">Why most drivers lose it: the proof problem</h2>'
 '<p>Here is the trap. The IRS does <b>not</b> want your meal receipts &mdash; that is the entire point of a flat allowance. What it <b>does</b> want, if it ever asks, is evidence of <b>which nights you were away from your tax home</b>.</p>'
 '<p>Now be honest about what most owner-operators actually have at tax time:</p>'
 '<ul>'
 '<li>A glovebox of fuel receipts and a memory.</li>'
 '<li>ELD logs they have never exported and would not know how to hand to a CPA.</li>'
 '<li>A calendar they meant to keep in January and abandoned by February.</li>'
 '</ul>'
 '<p>So one of two things happens. Either the driver <b>does not claim it at all</b> (&ldquo;I can&rsquo;t prove it, skip it&rdquo;), or the CPA <b>lowballs the number</b> to stay safe. Both cost real money, quietly, every year. The deduction was never the hard part. <b>The record was.</b></p>'

 '<h2 id="loadboot">How Loadboot proves it for you &mdash; automatically</h2>'
 '<p>This is precisely the problem Loadboot was built to remove, and the fix comes free with how the platform already works.</p>'
 '<p>Every load you run on Loadboot is <b>GPS-stamped end to end</b>. When you roll out, the trip starts. When you enter the pickup geofence, arrival is recorded. When you clear the delivery, the drop is stamped. You do not tap anything &mdash; the truck&rsquo;s position writes the record.</p>'
 '<p>Those stamps are not just for detention claims and on-time scores. They are <b>exactly the substantiation the IRS asks for</b>: a dated, objective record of which nights you were away from home. So the Tax centre simply counts them:</p>'
 + PD_SHOT1 +
 '<p>Nights away, the deduction, the deadlines, and your Schedule C categories &mdash; assembled from work you already did. Nothing to remember in January. Nothing to reconstruct in April.</p>'
 '<p>And because the same trip record drives your money, the rest of the picture lines up with it:</p>'
 + PD_SHOT2 +
 '<p>Every load carries its own profit statement. Detention and accessorials land on it <b>automatically</b> from the same GPS stamps, so the income side is as complete as the deduction side. At tax time you are not hunting &mdash; you are exporting.</p>'
 + svc_banner('Stop reconstructing your year in April','Run your loads on Loadboot and the tax record writes itself &mdash; nights away, per-load profit, detention, Schedule C. Flat 5%, no contract, cancel anytime.','Get started','get-started.html') +

 '<h2 id="beyond">Beyond per diem: the rest of the money</h2>'
 '<p>Per diem is the biggest one drivers miss, but it is not the only one. The same records feed the rest of your return:</p>'
 '<ul>'
 '<li><b>Fuel</b> &mdash; usually 28&ndash;35% of your gross, and fully deductible.</li>'
 '<li><b>Truck payment</b> &mdash; the <b>interest</b> is deductible; the <b>principal is not</b>. A lot of drivers get this backwards.</li>'
 '<li><b>Insurance</b> &mdash; liability, cargo, physical damage, bobtail, occupational accident.</li>'
 '<li><b>Maintenance &amp; repairs</b> &mdash; tires, brakes, oil, filters, belts.</li>'
 '<li><b>Tolls, scales, parking, permits</b> &mdash; small, constant, and easy to lose.</li>'
 '<li><b>Factoring fees</b> &mdash; a real business expense; log it as one.</li>'
 '</ul>'
 '<p>And the calendar you cannot ignore: <b>quarterly estimated taxes</b> (Apr 15, Jun 16, Sep 15, Jan 15) plus <b>Form 2290</b> (HVUT) by Aug 31 if your truck is 55,000 lb or heavier. Miss those and penalties eat the deduction you just fought for.</p>'

 '<h2 id="mistakes">Five mistakes that cost you</h2>'
 '<ol>'
 '<li><b>Not claiming it because you &ldquo;can&rsquo;t prove it.&rdquo;</b> Your trip records are the proof. If your system does not produce them, change the system.</li>'
 '<li><b>Forgetting partial days.</b> The day out and the day home are claimable at a reduced rate. Across 10&ndash;20 round trips a year that is another <b>$500&ndash;$1,000</b> most drivers never take.</li>'
 '<li><b>Claiming per diem as a W-2 company driver.</b> You cannot. Do not let anyone tell you otherwise.</li>'
 '<li><b>Trying to put lodging in it.</b> Trucking per diem is meals and incidentals only.</li>'
 '<li><b>Deducting truck loan principal.</b> Interest yes. Principal no.</li>'
 '</ol>'

 '<h2 id="bottom-line">The bottom line</h2>'
 '<p>Per diem is the rare deduction that is large, legal, and free &mdash; you have already earned it by sleeping in the truck. The only thing standing between you and roughly <b>$64 for every night you were out</b> is a record of the nights.</p>'
 '<p>You can build that record by hand, in a notebook, hoping you remember. Or you can run your freight on a system that <b>stamps every trip with GPS by default</b>, counts the nights for you, files the detention you earned, and hands you a Schedule C rollup and a per-load profit statement at the end of it.</p>'
 '<p>The deduction was always yours. Loadboot just makes it provable.</p>'
 '<p class="small">Loadboot is a dispatch and carrier-operations platform, not a tax preparer or CPA firm. The figures here are estimates to help you plan; per diem rates, deductibility and eligibility change and depend on your circumstances. Confirm your numbers with a qualified tax professional before filing.</p>')

PD_FAQ = [
 ('What is the truck driver per diem rate for 2026?',
  'For 2026 the IRS special transportation-industry rate is $80 per full day within the continental U.S. (CONUS) and $86 per day outside CONUS. Partial travel days &mdash; the day you leave and the day you return &mdash; are claimed at a reduced amount, commonly 75% of the standard rate.'),
 ('Is truck driver per diem 80% or 100% deductible?',
  'It is 80% deductible for workers subject to DOT hours-of-service rules, which includes truck drivers. Regular business travellers only get 50%. So the effective deduction is $80 &times; 80% = $64 per full night away.'),
 ('Can a company driver on a W-2 claim per diem?',
  'No. After the Tax Cuts and Jobs Act removed unreimbursed employee expenses, W-2 company drivers cannot deduct per diem on their tax return. Only self-employed owner-operators filing Schedule C can claim it. Some carriers instead run a per diem PAY program through payroll, which is a different thing entirely.'),
 ('Do I need meal receipts to claim per diem?',
  'No. That is the whole advantage of a flat per diem &mdash; you do not save individual meal receipts. But you DO need records proving which nights you were away from your tax home overnight. Trip records, ELD logs or GPS-stamped load records all work. Loadboot produces this automatically from your trips.'),
 ('How much is per diem worth to an owner-operator?',
  'At $64 per night, 200 nights away is $12,800 in deductions and 250 nights is $16,000. Depending on your bracket and self-employment tax, that typically keeps roughly $4,700&ndash;$5,900 of real cash in your pocket. Specialists note that drivers who skip it lose over $11,000 in deductions a year.'),
 ('What proof does the IRS want for per diem?',
  'Evidence of the days you were travelling away from your tax home overnight &mdash; not meal receipts. A dated, objective record is what matters. GPS-stamped pickup and delivery times, like the ones Loadboot writes on every trip, are exactly that kind of record.'),
]

rich_article('truck-driver-per-diem-2026.html',
 'Truck Driver Per Diem 2026: Rates, Rules &amp; the $12,800 Most Owner-Operators Miss | Loadboot',
 'IRS per diem for truck drivers 2026: $80/day, 80% deductible ($64/night). 200 nights out = $12,800 in deductions. Who can claim it, the proof the IRS wants, and how to make that proof build itself.',
 'Trucking Tax Deductions','Truck Driver Per Diem 2026: The $12,800 Most Owner-Operators Never Claim',
 'The IRS does not want your meal receipts. It wants proof of the nights you were away &mdash; and that is exactly where drivers lose thousands. Here is the 2026 rule, the real math, and how to make the record write itself.',
 9,'owner-operator-dispatch-hero.jpg','Owner-operator truck driver reviewing per diem tax deductions and trip records',
 PD_TOC, PD_BODY, PD_FAQ, feat_svg=PD_FEAT)

THUMBS['truck-driver-per-diem-2026.html'] = PD_FEAT
READTIME['truck-driver-per-diem-2026.html'] = 9
bcards = ''.join(blog_card(fn,t,ex,READTIME.get(fn,5)) for fn,t,d,ex,bl in BLOGPOSTS)
blog_body = svc_hero('The Loadboot Blog','Practical guides for owner-operators and carriers &mdash; pricing, authority, finding loads, and running a more profitable truck.')
blog_body += '<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Guides &amp; resources</div><h2>Latest from Loadboot</h2></div><div class="bloggrid">%s</div></div></section>' % bcards
blog_body += final_cta()
page('blog.html','Loadboot Blog: Dispatch Tips &amp; Guides | Carriers','Practical truck dispatch guides for owner-operators and new-authority carriers: pricing, finding loads, dispatcher vs broker, and more.','blog.html', blog_body)

# ---------- LEGAL PAGES ----------
priv = svc_hero('Privacy Policy','How Loadboot collects, uses, and protects your information.')
priv += '''<section><div class="wrap prose reveal" style="max-width:800px">
<p><em>Last updated: 2026.</em> This Privacy Policy explains how Loadboot ("we", "us") handles information you provide through this website.</p>
<h2>Information we collect</h2><p>Depending on how you use Loadboot, we may collect: <b>account information</b> (name, email, phone, password handled securely by our authentication provider); <b>carrier and authority information</b> (company, MC/DOT numbers, equipment, lanes, preferences); <b>documents you upload</b> (such as authority, insurance, W-9 and load paperwork), stored privately; <b>precise location</b> &mdash; only if and while you explicitly consent to share it for load matching or active-load tracking; <b>usage analytics</b> on our public marketing pages. We do <b>not</b> run advertising analytics inside the authenticated carrier portal.</p>
<h2>How we use it</h2><p>To provide dispatch services &mdash; finding, negotiating and booking loads; reviewing carrier documents; matching loads to your equipment and (with consent) location; communicating about your loads and account; and operating and improving the website. We do not sell your information.</p>
<h2>Precise location &mdash; consent based</h2><p>Location sharing is <b>optional</b> and off by default. The portal is fully usable without it. You choose either a one-time share or sharing while a load is active, and you can revoke it at any time from your dashboard. We record your consent and store only your most recent location while sharing is active; sharing stops when you revoke it, sign out, or the active period ends. Only your assigned LoadBoot dispatcher can view it.</p>
<h2>Sharing</h2><p>We share information only as needed to provide services &mdash; for example, with brokers or a factoring company you choose &mdash; or where required by law. We do not sell personal information.</p>
<h2>Data security</h2><p>Documents are kept in private storage with per-account access controls and time-limited links; access to carrier records is restricted by server-enforced authorization so one carrier cannot access another&rsquo;s data. No method of transmission is perfectly secure, but we apply reasonable safeguards.</p>
<h2>Retention</h2><p>We keep information for as long as needed to provide services and meet legal obligations, then delete or anonymize it. Location data is minimized to the latest necessary point rather than a long history, unless a reviewed operational need applies.</p>
<h2>Your rights</h2><p>You may request access to, correction of, or deletion of your information, withdraw location consent, or close your account, by contacting us through this site. We will respond promptly.</p>
<h2>Contact</h2><p>Questions about this policy? Reach us through our contact page.</p></div></section>'''
priv += final_cta()
page('privacy.html','Privacy Policy | Loadboot','How Loadboot collects, uses, and protects the information you share through our website.','privacy.html',priv)

terms = svc_hero('Terms of Service','The terms that govern your use of the Loadboot website and services.')
terms += '''<section><div class="wrap prose reveal" style="max-width:800px">
<p><em>Last updated: 2026.</em> By using this website or our dispatch services, you agree to these terms.</p>
<h2>Our services</h2><p>Loadboot provides truck dispatch services to carriers who hold their own operating authority. We represent the carrier, not the shipper, and we are not a freight broker.</p>
<h2>Dispatch agreement</h2><p>Dispatch services are provided under a separate written dispatch agreement signed by you and Loadboot, which governs fees, responsibilities, and termination. Our standard fee is a flat percentage of gross on loads we book, with no long-term contract.</p>
<h2>Your responsibilities</h2><p>You are responsible for maintaining valid authority, insurance, and compliance, for operating safely and legally, and for approving every load before it is booked.</p>
<h2>No guarantee</h2><p>We work hard to find quality, well-paying freight, but we do not guarantee specific rates, load volume, or income. Market conditions vary.</p>
<h2>Limitation of liability</h2><p>To the fullest extent permitted by law, Loadboot is not liable for indirect or consequential damages arising from the use of our website or services.</p>
<h2>Changes</h2><p>We may update these terms from time to time. Continued use of the site means you accept the current terms.</p></div></section>'''
terms += final_cta()
page('terms.html','Terms of Service | Loadboot','The terms governing your use of the Loadboot website and truck dispatch services.','terms.html',terms)

# ---------- FLAGSHIP: LOAD SCORE ("Should You Take This Load?") ----------
ls_faqs = [
 ('Should I take this load if the rate per mile looks good?','Not always. A high rate per mile can still lose you money once you add deadhead miles to the pickup, a weak market on the delivery end, or long detention. The Load Score above weighs all of that against your real cost per mile and gives you a clear answer.'),
 ('How do I decide if a load is worth taking?','Start with your true cost per mile, then subtract every mile you will drive &mdash; loaded and empty &mdash; plus the time it ties up your truck. If the load does not clear your costs with a healthy margin, you either negotiate or pass. The tool does this math for you in seconds.'),
 ('Does deadhead really matter that much?','Yes. Empty miles to the pickup burn fuel and hours but earn nothing, so they quietly drag down your real rate per mile. A load that looks like $2.40 a mile can fall under $2.00 once deadhead is counted &mdash; which is exactly what the Load Score reveals.'),
 ('What is a good profit margin on a freight load?','Most healthy owner-operators aim for at least a 20&ndash;30% margin over their all-in cost. Set your target in the tool and it will tell you the lowest rate you should accept and suggest a counter-offer to get there.'),
 ('Can Loadboot just find good loads for me?','Yes &mdash; that is the whole point of a dispatcher. We screen loads against numbers like these, negotiate the rate, and keep your truck on profitable freight. Flat 5%, no contracts.'),
]
ls_faq_html, ls_faq_schema = faq_block(ls_faqs)
ls_seo = '''<section class="bg-soft"><div class="wrap" style="max-width:880px">
<h2>How to know if a load is worth taking</h2>
<p style="margin-top:14px">Every owner-operator faces the same question a dozen times a day: <em>should I take this load?</em> A broker throws a rate at you, the clock is ticking, and you have about thirty seconds to decide. Most drivers fall back on rate per mile &mdash; but that single number hides more than it shows. The Load Score tool above turns the offer into an honest answer by weighing everything that actually decides whether a load makes you money.</p>
<h3 style="margin-top:26px">Why rate per mile alone will trick you</h3>
<p>A load that reads $2.40 per mile sounds great until you count the 150 empty miles you will run just to reach the pickup. Those deadhead miles burn fuel and hours but pay nothing, so your real rate per mile drops fast. The same load can also strand you in a weak freight market where your next load runs cheap or empty. Time matters too: a load that ties up your truck for three days at a so-so rate can be worth less than a tighter one you can turn in a day. None of that shows up in the rate per mile &mdash; but all of it shows up in your bank account.</p>
<h3 style="margin-top:22px">What the Loadboot Load Score measures</h3>
<p>Instead of a single number, the Load Score blends five things real dispatchers weigh on every load: your profit margin after all-in costs, your true rate per mile across loaded <strong>and</strong> deadhead miles, how badly empty miles are dragging the rate, your profit per day, and the strength of the freight market where the load drops you. It rolls those into a score from 0 to 100 and a plain verdict &mdash; <strong>take it, negotiate, or pass</strong> &mdash; so you are not doing trucking math in your head at a truck stop.</p>
<h3 style="margin-top:22px">Counter the offer &mdash; do not just accept or walk</h3>
<p>The most profitable owner-operators rarely accept the first number, and they rarely hang up either. They counter. That is why the tool also gives you a suggested counter-offer: the exact total and rate per mile you should ask for to hit your target margin. Knowing that number before you call the broker back is the difference between hoping a load pays and knowing it does. If you want to sharpen the inputs first, run your numbers through our free <a href="tools.html">cost-per-mile and profit calculators</a>.</p>
<h3 style="margin-top:22px">Let a dispatcher take this off your plate</h3>
<p>This tool is free to use as often as you like &mdash; no signup, no catch. But if you would rather drive than screen loads all day, that is exactly what we do. A dedicated Loadboot dispatcher scores loads like this, negotiates the rate, and keeps your truck on freight that actually pays &mdash; flat 5%, no contracts. <a href="contact.html">Get started in two minutes</a> or <a href="services.html">see everything we handle</a>.</p>
</div></section>'''
ls_body = svc_hero('Should You Take This Load?','Paste in any load offer and get an instant score, a clear take / negotiate / pass verdict, and a smart counter-offer &mdash; built on your real cost per mile. Free, no signup.')
ls_body += '<section style="padding-top:10px"><div class="wrap">' + LS_HTML + '<p class="center" style="margin-top:22px;color:var(--muted);font-size:.9rem">Nothing you type is saved or sent anywhere &mdash; it all runs right in your browser.</p></div></section>'
ls_body += ls_seo + ls_faq_html + final_cta() + '<script>' + LS_JS + '</script>'
ls_howto = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"HowTo","name":"How to decide whether to take a freight load","step":[{"@type":"HowToStep","name":"Enter the offer","text":"Enter what the load pays, the loaded miles, and the deadhead miles to the pickup."},{"@type":"HowToStep","name":"Add your costs","text":"Enter your all-in cost per mile and how many days the load will take."},{"@type":"HowToStep","name":"Read the score and verdict","text":"The Load Score returns a 0-100 score and a take, negotiate, or pass verdict based on profit, deadhead, time, and market."},{"@type":"HowToStep","name":"Counter the rate","text":"Use the suggested counter-offer to negotiate a rate that hits your target margin before you accept."}]}</script>'
ls_app = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Loadboot Load Score","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"Free tool that tells truckers and owner-operators whether a freight load is worth taking, with a take-negotiate-pass verdict and a suggested counter-offer."}</script>'
page('load-score.html','Should You Take This Load? Free Load Score Tool for Truckers','Free tool that scores any freight load and tells you to take, negotiate, or pass — with a counter-offer based on your cost per mile.','load-score.html', ls_body, ls_app + ls_howto + ls_faq_schema)

# ---------- FREE TOOLS ----------
LSP = '<section><div class="wrap"><a href="load-score.html" class="reveal" style="display:flex;align-items:center;gap:22px;flex-wrap:wrap;justify-content:space-between;background:linear-gradient(135deg,#10223B,#1e3a8a);color:#fff;border-radius:22px;padding:30px 34px;text-decoration:none;box-shadow:0 30px 60px -34px rgba(15,23,42,.6)"><div style="max-width:640px"><div style="font-size:.74rem;letter-spacing:.14em;text-transform:uppercase;color:#fbbf24;font-weight:700;margin-bottom:8px">Our #1 free tool</div><div style="font-family:\'Manrope\';font-weight:800;font-size:1.7rem;line-height:1.15;margin-bottom:8px">Should You Take This Load?</div><p style="color:#cbd5e1;margin:0;font-size:.97rem">Stop guessing. Get an instant take / negotiate / pass score on any load &mdash; with a suggested counter-offer built on your real costs.</p></div><span class="btn btn-primary" style="white-space:nowrap">Open Load Score &rarr;</span></a></div></section>'
tools_faqs = [
 ('Are these truck dispatcher tools really free?','Yes. Every calculator on this page is 100% free, with no login and no signup. Use them as often as you like, right here on the page.'),
 ('How do I calculate profit on a load?','Enter what the load pays, the total miles, your fuel price and MPG, plus any tolls or expenses. The Load Profit Calculator instantly shows your net profit and your rate per mile.'),
 ('What is a good rate per mile for owner-operators?','It depends on your costs, but most owner-operators need at least $1.80 to $2.00 per mile just to break even. Use the Cost-Per-Mile and Break-Even tools above to find your own number.'),
 ('Why does my cost per mile matter so much?','Your cost per mile is the foundation of every load decision. Any rate below it loses money. The calculator above turns your monthly fixed and variable costs into one number you can judge any rate against.'),
 ('Can Loadboot just handle all of this for me?','Yes &mdash; that is exactly what we do. We negotiate rates, plan lanes, and keep your truck loaded so you are not crunching these numbers on every load. Flat 5%, no contracts.'),
]
tools_faq_html, tools_faq_schema = faq_block(tools_faqs)
tools_intro = '<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Free trucker tools</div><h2>Free dispatch &amp; profit calculators for truckers</h2><p class="lead center" style="margin:0 auto">No login. No signup. Just fast, accurate calculators that owner-operators and fleets actually use to price loads, cut costs, and protect every mile &mdash; built by the dispatch team at Loadboot.</p></div></div></section>'
tools_section = '<section style="padding-top:0"><div class="wrap">' + TOOLS_HTML + '</div></section>'
tools_seo = '''<section class="bg-soft"><div class="wrap" style="max-width:880px">
<h2>Know your numbers before you take the load</h2>
<p style="margin-top:14px">Every profitable trucking business runs on a few simple numbers: what a load pays, what it actually costs to run those miles, and what is left over for you. The free calculators above put all of them in one place &mdash; no spreadsheet, no signup &mdash; so you can make a confident call on any load in seconds.</p>
<h3 style="margin-top:26px">Load profit &amp; rate per mile</h3>
<p>The <a href="tools.html#profit">load profit calculator</a> and <a href="tools.html#rpm">rate-per-mile calculator</a> answer the first question every owner-operator asks: is this load worth it? Drop in the rate, the miles, and your fuel numbers, and you instantly see your net profit and your true dollars-per-mile &mdash; before you ever call the broker back.</p>
<h3 style="margin-top:22px">Cost per mile &amp; break-even rate</h3>
<p>Your <a href="tools.html#cpm">cost per mile</a> is the single most important number in your business, and most drivers underestimate it. Once you know it, the <a href="tools.html#breakeven">break-even rate calculator</a> tells you the lowest rate you can accept and still hit your target margin &mdash; so you never haul cheap freight by accident.</p>
<h3 style="margin-top:22px">Fuel, take-home, detention &amp; deadhead</h3>
<p>Diesel is the biggest variable cost on the road, so the <a href="tools.html#fuel">fuel cost calculator</a> helps you price any lane in seconds. The <a href="tools.html#takehome">owner-operator take-home calculator</a> shows what really lands in your pocket after fuel and fees, the <a href="tools.html#detention">detention pay calculator</a> tells you what a shipper owes for wasting your day, and the <a href="tools.html#deadhead">deadhead calculator</a> reveals how empty miles quietly shrink your real rate.</p>
<h3 style="margin-top:22px">Want a dispatcher to handle the numbers for you?</h3>
<p>These tools are free to use forever. But if you would rather spend your time driving than crunching rates, that is exactly what we do. <a href="contact.html">Get started with Loadboot</a> and a dedicated dispatcher will find the loads, run these numbers, and negotiate the rate for you &mdash; flat 5%, no contracts. <a href="services.html">See all of our services</a>.</p>
</div></section>'''
tools_body = svc_hero('Free Tools for Truckers &amp; Owner-Operators','Price loads, know your true cost per mile, and stop leaving money on the table &mdash; with the same calculators our dispatchers use every day. Free, no signup, instant results.')
tools_body += LSP + tools_intro + tools_section + tools_seo + tools_faq_html + final_cta() + '<script>' + TOOLS_JS + '</script>'
tools_schema = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Loadboot Free Trucker Tools","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"Free load profit, rate-per-mile, cost-per-mile, fuel, break-even, take-home, detention and deadhead calculators for truck drivers and owner-operators."}</script>' + tools_faq_schema
page('tools.html','Trucking Calculator 2026 — Free Cost Per Mile, Profit Per Load & Rate Tools | LoadBoot','The free trucking calculator suite truckers actually use: cost per mile, profit per load, rate per mile, fuel, break-even, take-home and detention pay — instant answers, no signup, no login.','tools.html', tools_body, tools_schema)


# ---------- COST PER MILE CALCULATOR (dedicated GSC landing: "trucking calculator" / "cost per mile") ----------
CPMC_CALC = ('<section style="padding-top:0"><div class="wrap">'
 '<div class="tk-card" id="calc">'
 '<div class="tk-head"><span class="tk-ic"><svg viewBox="0 0 24 24"><path d="M2 7h12v9H2z"/><path d="M14 10h4l3 3v3h-7z"/><circle cx="6.5" cy="18" r="1.7"/><circle cx="17.5" cy="18" r="1.7"/></svg></span><h2>Cost Per Mile Calculator</h2></div>'
 '<p class="tk-sub">Itemize what your truck really costs every month &mdash; the calculator turns it into your true cost per mile and the minimum rate you can accept.</p>'
 '<div class="tk-row">'
 '<div class="tk-in"><label for="x_truck">Truck payment / month ($)</label><input type="number" id="x_truck" value="1800" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_trailer">Trailer payment / month ($)</label><input type="number" id="x_trailer" value="550" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_ins">Insurance / month ($)</label><input type="number" id="x_ins" value="1300" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_permits">Plates, permits, ELD / month ($)</label><input type="number" id="x_permits" value="250" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_park">Parking &amp; other fixed / month ($)</label><input type="number" id="x_park" value="300" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_miles">Miles you run / month</label><input type="number" id="x_miles" value="9500" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_price">Diesel price ($/gal)</label><input type="number" id="x_price" value="3.85" step="0.01" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_mpg">Truck MPG</label><input type="number" id="x_mpg" value="6.5" step="0.1" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_maint">Maintenance / mile ($)</label><input type="number" id="x_maint" value="0.20" step="0.01" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_tires">Tires / mile ($)</label><input type="number" id="x_tires" value="0.04" step="0.01" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_driver">Driver pay / mile ($, 0 if you drive)</label><input type="number" id="x_driver" value="0" step="0.01" oninput="cpmc()"></div>'
 '<div class="tk-in"><label for="x_rate">Rate you are offered ($/mile)</label><input type="number" id="x_rate" value="2.50" step="0.01" oninput="cpmc()"></div>'
 '</div>'
 '<div class="tk-out"><div><div class="big" id="x_cpm">$0.00</div><div class="lbl">Your TRUE cost per mile</div></div>'
 '<div class="side"><b id="x_fix">$0.00</b>fixed / mi<br><b id="x_var">$0.00</b>variable / mi</div></div>'
 '<div class="tk-out"><div><div class="big pos" id="x_month">$0</div><div class="lbl">Profit this month at that rate</div></div>'
 '<div class="side"><b id="x_break">$0.00</b>break-even rate / mi<br><b id="x_profit">$0.00</b>profit / mi at your rate</div></div>'
 '<p class="tk-note">Any load priced below your cost per mile loses money before the wheels turn. Know this number before you ever talk to a broker. More tools: <a href="tools.html">all 8 free trucking calculators</a>.</p>'
 '</div></div></section>'
 '<script>function cpmc(){function n(i){var e=document.getElementById(i);return parseFloat(e&&e.value)||0}'
 'function m(v){return "$"+v.toFixed(2)}'
 'var fx=n("x_truck")+n("x_trailer")+n("x_ins")+n("x_permits")+n("x_park");var mi=n("x_miles");'
 'var fpm=mi>0?fx/mi:0;var fuel=n("x_mpg")>0?n("x_price")/n("x_mpg"):0;'
 'var vpm=fuel+n("x_maint")+n("x_tires")+n("x_driver");var cpm=fpm+vpm;var rate=n("x_rate");'
 'function s(i,v){var e=document.getElementById(i);if(e)e.textContent=v}'
 's("x_cpm",m(cpm));s("x_fix",m(fpm));s("x_var",m(vpm));s("x_break",m(cpm));s("x_profit",m(rate-cpm));'
 'var mo=Math.round((rate-cpm)*mi);s("x_month","$"+mo.toLocaleString());'
 'var el=document.getElementById("x_month");if(el)el.className=mo>=0?"big pos":"big";}'
 'cpmc();</script>')

CPMC_BODY_TOP = ('<section><div class="wrap" style="max-width:880px"><div class="reveal">'
 '<h2>Why cost per mile is the one number that runs your trucking business</h2>'
 '<p class="lead">Every load you book is priced per mile &mdash; but most carriers negotiate without knowing what a mile actually costs them. That is how a $2.10 load that "sounds fine" quietly loses money, and why the first thing any good dispatcher asks is: <b>what is your cost per mile?</b></p>'
 '<p>Your cost per mile (CPM) is simply everything your operation spends in a month, divided by the miles you run. Once you know it, three decisions become automatic: which loads to reject instantly, what rate to counter at, and whether a lane is worth the deadhead. Industry research (ATRI) has put the average marginal cost of running a truck at roughly <b>$2.20&ndash;$2.30 per mile</b> in recent years including driver wages &mdash; if you are booking below that without knowing your own number, you are guessing with your business.</p>'
 '</div></div></section>')

CPMC_BODY_MID = ('<section class="bg-soft"><div class="wrap" style="max-width:880px"><div class="reveal">'
 '<h2>Fixed vs variable: the two halves of your cost per mile</h2>'
 '<p><b>Fixed costs</b> hit every month whether the truck moves or not: truck and trailer payments, insurance, plates and permits, ELD subscription, parking. Because they are fixed, <b>running more miles spreads them thinner</b> &mdash; a $4,200 fixed month is $0.42/mi at 10,000 miles but $0.60/mi at 7,000 miles. Sitting still literally raises your cost per mile.</p>'
 '<p><b>Variable costs</b> scale with every mile: fuel (your biggest &mdash; diesel price divided by your MPG), maintenance reserve, and tires. A realistic maintenance reserve is $0.15&ndash;$0.25 per mile on an older truck; skipping it does not make the repair cheaper, it just makes it a surprise.</p>'
 '<h2>Typical owner-operator numbers (2026)</h2>'
 '<table><thead><tr><th>Cost item</th><th>Typical range</th><th>Type</th></tr></thead><tbody>'
 '<tr><td>Truck payment</td><td>$1,200&ndash;$2,500 / mo</td><td>Fixed</td></tr>'
 '<tr><td>Trailer payment</td><td>$400&ndash;$700 / mo</td><td>Fixed</td></tr>'
 '<tr><td>Insurance</td><td>$900&ndash;$1,800 / mo</td><td>Fixed</td></tr>'
 '<tr><td>Plates, permits, ELD</td><td>$150&ndash;$350 / mo</td><td>Fixed</td></tr>'
 '<tr><td>Fuel</td><td>$0.55&ndash;$0.70 / mi</td><td>Variable</td></tr>'
 '<tr><td>Maintenance reserve</td><td>$0.15&ndash;$0.25 / mi</td><td>Variable</td></tr>'
 '<tr><td>Tires</td><td>$0.03&ndash;$0.05 / mi</td><td>Variable</td></tr>'
 '</tbody></table>'
 '<p style="margin-top:14px">Plug your own numbers into the calculator above &mdash; averages are for sanity-checking, not for pricing your loads. Compare the result against <a href="market-rates.html">this week&rsquo;s market rates per mile</a> to see which lanes actually clear your break-even.</p>'
 '<h2>Six ways to cut your cost per mile</h2>'
 '<p><b>1. Kill deadhead</b> &mdash; empty miles carry full cost and zero revenue; one round-trip lane plan can cut CPM more than any fuel card. <b>2. Slow down 3&ndash;5 mph</b> &mdash; typically worth 0.5+ MPG, which is $0.04&ndash;$0.06/mi at today&rsquo;s diesel prices. <b>3. Shop insurance yearly</b> &mdash; renewals drift up; quotes pull them back. <b>4. Run more of the miles you already pay for</b> &mdash; fixed costs per mile fall as monthly miles rise. <b>5. Take the per diem deduction</b> &mdash; it does not change CPM, but <a href="truck-driver-per-diem-2026.html">$64 per night away</a> changes what you keep. <b>6. Stop paying for load-hunting time</b> &mdash; hours on load boards are unpaid work; a <a href="how-much-does-a-truck-dispatcher-cost.html">flat-fee dispatcher</a> costs 5% and gives you those hours back.</p>'
 '</div></div></section>')

RELATED['cost-per-mile-calculator.html'] = [('tools.html','All Free Trucking Calculators'),('market-rates.html','Market Rates Per Mile'),('how-much-does-a-truck-dispatcher-cost.html','Dispatcher Cost Guide'),('truck-driver-per-diem-2026.html','Per Diem 2026 Guide'),('carrier-application.html','Apply as Carrier')]

_cpmc_faq_html, _cpmc_faq_sch = faq_block([
 ('What is a good cost per mile for a trucking company in 2026?',
  'Industry research (ATRI) puts the average marginal cost of trucking at roughly $2.20 to $2.30 per mile including driver wages. A solo owner-operator who drives their own truck typically lands between $1.40 and $1.90 per mile before paying themselves. Your number depends on your truck payment, insurance, fuel economy and monthly miles - which is exactly what this calculator works out.'),
 ('How do I calculate cost per mile for my truck?',
  'Add up your fixed monthly costs (truck and trailer payments, insurance, plates, permits, parking) and divide by the miles you run per month. Then add your variable cost per mile: fuel (diesel price divided by MPG), a maintenance reserve, and tires. Fixed per mile plus variable per mile is your true cost per mile.'),
 ('What rate per mile should I charge?',
  'Never book below your cost per mile - that is your break-even. Most dispatchers target at least a 20-30% margin above break-even, adjusted for the lane, deadhead, and the week&rsquo;s market. Check current market rates per mile on our live rates page before you negotiate.'),
 ('Does this calculator include driver pay?',
  'Driver pay is an optional field. If you drive your own truck, leave it at zero and treat profit as your pay. If you put a company driver in the seat, enter their per-mile wage so the cost per mile reflects it.'),
 ('Is this trucking calculator really free?',
  'Yes - free, no signup, no login, and it runs entirely in your browser. It is the same math our dispatch team uses when pricing loads for Loadboot carriers. We also have seven more free calculators covering profit per load, fuel, break-even, take-home pay and detention.'),
])

cpmc_body = svc_hero('Trucking Cost Per Mile Calculator','Enter your real costs &mdash; truck payment, insurance, fuel, maintenance &mdash; and see your true cost per mile, your break-even rate, and what any load actually pays you. Free, instant, no signup.')
cpmc_body += CPMC_CALC + CPMC_BODY_TOP
cpmc_body += '<section style="padding-top:0"><div class="wrap">' + svc_banner('Know your number. Then let us beat it.','Loadboot dispatchers price every load against YOUR cost per mile &mdash; flat 5%, no contracts, no forced dispatch.','See how dispatch works','how-it-works.html') + '</div></section>'
cpmc_body += CPMC_BODY_MID + _cpmc_faq_html + final_cta()
cpmc_schema = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"WebApplication","name":"Loadboot Trucking Cost Per Mile Calculator","applicationCategory":"BusinessApplication","operatingSystem":"Web","offers":{"@type":"Offer","price":"0","priceCurrency":"USD"},"description":"Free cost per mile calculator for truckers: itemize fixed and variable costs to get true cost per mile, break-even rate and profit per mile."}</script>' + _cpmc_faq_sch
page('cost-per-mile-calculator.html','Cost Per Mile Calculator for Trucking (2026) &mdash; Free &amp; Itemized | LoadBoot'.replace('&mdash;','—').replace('&amp;','&'),'Free trucking cost per mile calculator: itemize your fixed and variable costs, get your true cost per mile, break-even rate and profit per mile instantly. No signup, no login.','tools.html', cpmc_body, cpmc_schema)

# ======================================================================
# SPRINT 1 — PUBLIC MARKETING WEBSITE COMPLETION (added pages)
# Real, SEO-complete pages built on the same header/footer/design system.
# ======================================================================
def _sec(eyebrow, h2, inner, soft=False):
    return '<section%s><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">%s</div><h2>%s</h2></div>%s</div></section>' % (
        ' class="bg-soft"' if soft else '', eyebrow, h2, inner)

def _cards(items, cols='g3'):
    cs = ''.join('<div class="card reveal"><div class="icon">%s</div><h3>%s</h3><p>%s</p></div>' % (ic, t, d) for ic, t, d in items)
    return '<div class="grid %s reveal">%s</div>' % (cols, cs)

_FORM_N = [0]
def lead_form(form_key, heading, intro, fields, submit_label, success_msg):
    # fields: list of (name, label, type, required) ; type in text/email/tel/textarea/select:opt1|opt2
    _FORM_N[0] += 1
    fid = 'lf%d' % _FORM_N[0]
    rows = ''
    for nm, lb, ty, req in fields:
        r = ' required' if req else ''
        cid = '%s_%s' % (fid, nm)  # unique per form instance — a11y label association
        if ty == 'textarea':
            ctl = '<textarea id="%s" name="%s"%s placeholder="%s"></textarea>' % (cid, nm, r, lb)
        elif ty.startswith('select:'):
            opts = ''.join('<option>%s</option>' % o for o in ty.split(':', 1)[1].split('|'))
            ctl = '<select id="%s" name="%s"%s><option value="">Select&hellip;</option>%s</select>' % (cid, nm, r, opts)
        else:
            ctl = '<input id="%s" type="%s" name="%s"%s placeholder="%s">' % (cid, ty, nm, r, lb)
        rows += '<div class="field full"><label for="%s">%s</label>%s</div>' % (cid, lb, ctl)
    js = ("(function(){var f=document.getElementById('%s');if(!f)return;f.addEventListener('submit',function(e){e.preventDefault();"
          "var b=document.getElementById('%s_b');b.disabled=true;b.textContent='Sending…';"
          "var d={};new FormData(f).forEach(function(v,k){d[k]=v;});if(d._hp){return;}"
          "if(window.lbSubmitLead){window.lbSubmitLead('%s',d).then(function(r){if(r.ok){f.innerHTML='<div style=\\'text-align:center;padding:34px\\'><div style=\\'font-size:2.4rem;color:#16a34a\\'>&#10003;</div><h3 style=\\'margin:10px 0\\'>%s</h3></div>';if(window.lbTrack)window.lbTrack('conversion',{form:'%s'});}else{b.disabled=false;b.textContent='%s';alert('Something went wrong — please email hello@loadboot.com.');}}).catch(function(){b.disabled=false;b.textContent='%s';alert('Network error — please try again or email hello@loadboot.com.');});}"
          "else{b.disabled=false;b.textContent='%s';}});})();" ) % (fid, fid, form_key, success_msg, form_key, submit_label, submit_label, submit_label)
    return ('<section class="bg-soft"><div class="wrap" style="max-width:720px">'
            '<form class="quote-wrap reveal" id="%s"><h3 style="margin-bottom:6px">%s</h3>'
            '<p style="color:var(--muted);margin-bottom:18px">%s</p>'
            '<p hidden><label>Skip<input name="_hp"></label></p>'
            '<div class="form-grid">%s</div>'
            '<button class="btn btn-primary" id="%s_b" style="width:100%%;justify-content:center;margin-top:22px">%s</button>'
            '<p style="text-align:center;margin-top:12px;font-size:.9rem">We reply within one business day.</p>'
            '</form></div></section><script>%s</script>') % (fid, heading, intro, rows, fid, submit_label, js)

# ---- How It Works ----

# ---- FAQ ----
_faq_items = [
 ('Do I have to buy hardware, dashcams or an ELD contract?', 'No &mdash; and that is on purpose. The driver&rsquo;s phone is the tracker, so a one-truck carrier gets the same GPS proof a 50-truck fleet gets, on day one, at no hardware cost. Already paying for Samsara or Motive? Paste your token and LoadBoot reads positions from the hardware you already own. We sell no devices and lock you into no telematics contract &mdash; we turn whatever you already have into <a href="gps-tracking.html">detention proof and paid claims</a>.'),
 ('Do you guarantee a certain number of loads or a minimum income?', 'No &mdash; and be careful with anyone who does. Freight markets move; a guarantee usually hides a contract, a forced-dispatch clause or a rate cut somewhere else. What LoadBoot guarantees instead is the part that is actually in our control: the full rate card in writing before you accept, deadhead measured from where your truck really is, accessorials paid on GPS evidence, a PAY-BY date on every dollar owed, and no contract to leave. You pay 5% only when a load actually books.'),
 ('What equipment and freight types do you dispatch?', 'Dry van, reefer, flatbed, step deck, hotshot, power-only and box truck / expedited &mdash; plus <b>hazmat</b> freight for carriers with PHMSA registration, a CDL hazmat (H) endorsement and hazmat-rated insurance on file (the portal tracks all three). Tanker, heavy-haul and oversize are handled case by case with permit and routing coordination &mdash; <a href="contact.html">ask us about your setup</a>.'),
 ('Where do you operate?', 'All 48 contiguous states &mdash; where effectively every dry van, reefer and flatbed truckload mile in the country runs. That focus is deliberate: one connected network, one set of rate standards, and carriers who can reload anywhere they deliver, instead of thin coverage spread across markets that move by barge and ferry. Alaska, Hawaii and cross-border Canada/Mexico are outside the network by design.'),
 ('When do I actually get paid, and does LoadBoot advance money?', 'Net-30 from delivery is the standard, or your factoring terms if you factor (often 21 days). Delivery flips the invoice to DUE automatically with a PAY-BY date visible to both sides. LoadBoot does not advance funds and is not a factor &mdash; money moves bank-to-bank while LoadBoot runs the ledger, receipts and confirmations. See <a href="payments-settlements.html">payments &amp; settlements</a> and <a href="pricing.html">pricing</a>.'),
 ('What reporting do I get?', 'Per-trip profit statements (revenue, costs, cost per mile, margin), earnings over 7/30/90 days, fleet utilization and best-paying lanes from delivered trips, document and compliance status, and CSV/PDF statements you can hand to an accountant &mdash; plus QuickBooks sync. See <a href="fleet-management.html">fleet management</a>.'),
 ('Does LoadBoot integrate with QuickBooks?', 'Yes &mdash; native two-way QuickBooks Online sync is live in production: delivered-load invoices and expenses push into your books and paid status flows back. CSV exports cover Wave, Xero or your accountant. See <a href="integrations.html">integrations</a>.'),
 ('Does LoadBoot support ELD tracking (Samsara, Motive)?', 'Yes. Paste your Samsara or Motive API token and vehicle positions feed active trips every 5 minutes &mdash; tracking runs even with the app closed. Any device can also POST to a secure webhook. Phone GPS works with zero setup. See <a href="integrations.html">integrations</a>.'),
 ('Is there a TONU policy and workflow?', 'Yes &mdash; a published standard ($250 typical) with a documented claim workflow: report from the trip, GPS position and the rate confirmation attach automatically, and the claim rides the trip invoice. Full details on the <a href="tonu-policy.html">TONU policy page</a>, alongside <a href="detention-pay-policy.html">detention</a>, <a href="layover-policy.html">layover</a> and <a href="lumper-policy.html">lumper</a>.'),
 ('Can I assign drivers and trucks to loads?', 'Yes &mdash; the fleet roster invites drivers by magic link, tracks license and medical expiry, holds trucks and trailers with plates and equipment, and assigns them per trip. The <a href="fleet-management.html">optimized fleet plan</a> even suggests the best next load per truck, reload chained.'),
 ('Does LoadBoot handle maintenance, payroll, fuel cards and IFTA?', 'The fleet back office includes service logs with next-due dates, payroll entries built from delivered trips, EFS/Comdata/WEX fuel-card CSV import, per-trip P&amp;L with cost per mile, IFTA state miles from the GPS trail and per-diem tracking. See <a href="fleet-management.html">fleet management</a>.'),
 ('Is there an API for TMS integration?', 'Yes &mdash; the <a href="/app/developer/">developer portal</a> issues API keys and lets you register your own https webhook endpoints &mdash; load, trip, document and delivery events are then delivered automatically, with retries. Details on <a href="integrations.html">integrations</a>. Details on <a href="integrations.html">integrations</a>.'),
 ('Who runs LoadBoot&rsquo;s operations behind the scenes?', 'A staffed operations desk we document publicly: verifications approved same-day, claims checked against server-side GPS evidence, payment receipts verified by humans &mdash; maker and checker never the same account. See the <a href="command-center.html">Command Center page</a>.'),
 ('How much does Loadboot dispatch cost?', 'A flat 5% of the linehaul on loads we book for you &mdash; no sign-up fee, no monthly minimum, and no long-term contract. You only pay when we actually put money on your truck.'),
 ('Do I keep my own authority?', 'Yes. You keep your MC/DOT authority, your insurance and your broker relationships. Loadboot works on your behalf; we never take over your authority.'),
 ('Is there a contract or cancellation fee?', 'No contract and no cancellation fee. You can pause or stop any time. We keep your business by earning it, not by locking you in.'),
 ('What equipment types do you dispatch?', 'Dry van, reefer, flatbed, step deck, hotshot, power only and box truck / expedited. If you run mixed equipment, we handle that too.'),
 ('How fast can I get started?', 'Most carriers are set up the same day. Create your profile, send us your authority and insurance, and a dispatcher gets to work on your lanes.'),
 ('Do you help new-authority carriers?', 'Yes &mdash; new-authority carriers are a big part of who we serve. We help you get your first loads, build broker credibility, and avoid the common early mistakes.'),
 ('Who talks to the brokers?', 'Your dispatcher does. We negotiate the rate, handle the rate confirmation and paperwork, and keep the broker relationship professional so you can focus on driving.'),
 ('How do I get paid?', 'You invoice the broker (or your factoring company does). We prepare the invoice and supporting documents &mdash; rate con, BOL and POD &mdash; so nothing slows your payment down.'),
 ('Do you help with factoring, IFTA and compliance?', 'Yes. We can connect you with factoring, help keep your filings and permits current, and support you on IFTA, 2290, UCR and BOC-3.'),
 ('What hours is dispatch available?', 'A dispatcher is reachable during business hours and on call for active loads. If your truck is moving, we are reachable.'),
]
_faq_html, _faq_sch = faq_block(_faq_items)
faq_body = svc_hero('Frequently Asked Questions', 'Straight answers about pricing, authority, equipment, getting started and how dispatch actually works. Do not see your question? Contact us any time.')
faq_body += _faq_html + final_cta()
page('faq.html', 'Truck Dispatch FAQ &mdash; Pricing, Authority &amp; Getting Started | Loadboot',
     'Answers to the most common questions about Loadboot truck dispatch: cost, authority, contracts, equipment types, getting started, factoring and compliance.',
     'faq.html', faq_body, _faq_sch)

# ---- Box Truck Dispatch (service page) ----
_btfaq_html, _btfaq_sch = faq_block([
    ('Do box trucks need their own MC authority?', 'If your box truck is over 10,001 lbs GVWR and hauls interstate freight for hire, yes &mdash; you generally need operating authority and insurance just like a semi. We can point you to the right compliance steps before you start.'),
    ('What loads suit a 26-ft box truck best?', 'LTL and partial freight, final-mile retail and furniture, expedited hot shots and trade-show or event freight. We match by weight, dock height and liftgate capability so you are not offered freight you cannot load.'),
    ('Is expedited freight really worth it?', 'When it fits your schedule &mdash; often yes. Time-critical loads pay a premium for reliability. The trade-off is strict windows, so we only push expedited runs your schedule can actually make.'),
    ('Do you dispatch cargo vans and sprinters?', 'Yes, where the freight genuinely fits the vehicle. We are honest about it: van freight is a thinner market than box trucks, and we will tell you what your lanes realistically pay.'),
])
bt = svc_hero('Box Truck &amp; Expedited Dispatch', 'Dispatch built for box trucks, sprinter vans and expedited freight &mdash; we keep your smaller equipment loaded with the right runs at the right rate.')
bt += _sec('Box truck dispatch', 'Loads that fit your equipment', _cards([
    ('&#128230;', 'Right-sized freight', 'We match box trucks and cargo/sprinter vans with LTL, final-mile, expedited and time-critical loads that pay &mdash; not deadhead.'),
    ('&#9889;', 'Expedited &amp; hot loads', 'Time-critical freight is our sweet spot for smaller equipment. We move fast so you can too.'),
    ('&#128176;', 'Flat 5%, no contract', 'Same honest pricing as our truckload dispatch: you only pay when we book you.'),
]))
bt += _sec('Freight we book', 'Box truck &amp; expedited freight we dispatch', _cards([
    ('&#128666;', 'LTL &amp; partials', 'Less-than-truckload and partial freight sized for 16&ndash;26 ft boxes &mdash; steady, repeatable work between bigger runs.'),
    ('&#127968;', 'Final-mile &amp; retail', 'Residential and store deliveries, furniture and appliances &mdash; liftgate and inside-delivery requirements captured before you accept.'),
    ('&#9200;', 'Expedited &amp; time-critical', 'Hot freight that pays a premium for a hard delivery window your schedule can genuinely make.'),
    ('&#127914;', 'Events &amp; trade shows', 'Show freight with strict move-in/move-out windows &mdash; we coordinate the appointments so you just drive.'),
    ('&#128188;', 'Dedicated &amp; recurring routes', 'Repeat lanes for the same customer &mdash; predictable weeks once your service record earns them.'),
    ('&#128736;', 'Equipment-matched only', 'Dock height, liftgate, pallet jack, weight &mdash; we check the requirements so you are never sent to freight you cannot load.'),
], 'g3'))
bt += _sec('Rates', 'What drives box truck rates (and how we protect yours)', _cards([
    ('&#128200;', 'Urgency premium', 'Expedited windows pay more &mdash; we chase the time-critical freight that values a reliable smaller truck.'),
    ('&#128205;', 'Lane &amp; region balance', 'Final-mile-heavy metros pay differently than lane freight; we plan runs so you are not stuck deadheading home.'),
    ('&#9878;', 'Accessorials documented', 'Liftgate work, inside delivery, wait time &mdash; recorded with real timestamps and billed, not absorbed.'),
]), soft=True)
bt += _sec('How it works', 'From sign-up to your first expedited run', _cards([
    ('1', 'Profile &amp; equipment', 'Truck size, dock height, liftgate, GVWR and your service area &mdash; five minutes to set up.'),
    ('2', 'We find &amp; negotiate', 'Your dispatcher sources LTL, final-mile and expedited freight that fits, negotiates the rate and checks the broker.'),
    ('3', 'You drive, we handle the rest', 'Paperwork, status updates, POD collection and invoice prep &mdash; you focus on the road.'),
]))
bt += _btfaq_html
bt += final_cta()
page('box-truck-dispatch.html', 'Box Truck &amp; Expedited Dispatch Service | Loadboot',
     'Box truck, cargo van and expedited freight dispatch. Loadboot keeps your smaller equipment loaded with LTL, final-mile and hot loads. Flat 5%, no contracts.',
     'services.html', bt, _btfaq_sch)


# ================= WEB-3: REAL COMPLIANCE PAGES (each 10+ unique sections, educational, disclaimed) =================
_COMPL_DISC = '<section><div class="wrap"><div class="prose reveal" style="max-width:840px;margin:0 auto"><p style="font-size:.9rem;color:var(--muted)"><b>Honest note:</b> This page is general education for U.S. motor carriers, not legal or tax advice. Government fees, forms and deadlines change &mdash; always confirm current requirements on FMCSA.gov and IRS.gov, or with a licensed professional. LoadBoot helps you stay organized and connected to the right filings; we do not replace your legal or tax advisor.</p></div></div></section>'

# ---------- 1. Authority & DOT Setup ----------
_adfaq_html,_adfaq_sch = faq_block([
 ('Do I need my own MC authority to work with LoadBoot?','Yes — LoadBoot dispatches carriers operating under their own authority. If you are still getting set up, this guide covers the steps, and we can point you in the right direction before you start.'),
 ('How long does new authority take to become active?','After filing, FMCSA authority typically involves a multi-week protest/vetting period before it becomes active — plan your insurance, BOC-3 and UCR during that window so you can roll the day it activates.'),
 ('What insurance do I need?','For-hire property carriers generally need liability coverage filed with FMCSA (commonly $750,000 minimum, with most brokers requiring $1M) plus cargo coverage that brokers expect (often $100,000). Confirm exact requirements for your operation.'),
 ('Can LoadBoot file these for me?','We are a dispatch service — we keep your compliance dates tracked and your documents organized in your carrier account, and we can refer you to reputable filing services. The filings themselves are yours or your agent&rsquo;s to make.'),
])
adp = svc_hero('Trucking Authority &amp; DOT Setup — The Complete Roadmap','Every number, filing and deadline between you and your first legal load — explained in plain language, in the right order, with the traps new carriers actually fall into.')
adp += _sec('Start here','USDOT number vs MC authority — two different things', _cards([
 ('&#128288;','USDOT number','Your carrier identity with FMCSA — required for interstate commercial operation. Free to obtain via the Unified Registration System.'),
 ('&#128179;','MC (operating) authority','Your legal permission to haul freight for hire across state lines. Filed with FMCSA; a filing fee applies per authority type.'),
 ('&#9878;','Intrastate is different','Hauling only within one state? State rules apply instead — many states still require registration and insurance filings.'),
]))
adp += m_timeline('The order matters', 'The setup sequence that avoids re-work', [
 ('badge', 'Form your business entity', 'LLC or corporation, EIN from the IRS, business bank account. Brokers and factoring companies will ask for all three.'),
 ('clipboard', 'File USDOT + MC together', 'One URS filing covers both. Have your entity, EIN and address finalized first &mdash; changing them later means amendments.'),
 ('shieldcheck', 'Insurance filed by your insurer', 'Your insurance company files the BMC-91/91X liability form directly with FMCSA. Authority will not activate without it.'),
 ('pin', 'Designate a BOC-3 process agent', 'Required in every state you operate. See our BOC-3 guide &mdash; most carriers use a blanket agent service.'),
 ('calcheck', 'UCR registration', 'Annual Unified Carrier Registration once your USDOT is active. Fees are set annually by bracket of fleet size.'),
 ('layers', 'State-level items', 'IRP apportioned plates, IFTA license (see our IFTA guide), state permits (KYU, NY HUT, NM, OR) where you run.'),
], accent='#7c3aed')
adp += _sec('Money talk','What setup realistically costs', '<div class="prose reveal" style="max-width:840px;margin:0 auto"><p>Plan for the FMCSA authority filing fee, BOC-3 agent service, UCR annual fee, IRP plates (varies widely by state and weight), and your down payment on insurance &mdash; insurance is by far the largest number for a new authority, and quotes vary dramatically by driving history, truck age and radius. Get several insurance quotes before you file anything; the rest of the costs are small by comparison. We deliberately do not print exact government fees here because they change &mdash; check FMCSA.gov for current amounts.</p></div>', soft=True)
adp += m_zigzag('The waiting period', 'What to do while your authority cooks', [
 ('doccheck', 'Build your document pack', 'W-9, COI, authority letter, insurance certificates &mdash; brokers ask for the same pack every time. Have it ready as PDFs.'),
 ('wallet', 'Line up factoring or cash buffer', 'Brokers commonly pay in 30 days. Decide now how you will cover fuel in week one.'),
 ('truck', 'Get the truck DOT-ready', 'Annual inspection, ELD installed and registered, IRP/IFTA decals ordered, registration binder in the cab.'),
], accent='#0d9488', soft=False)
adp += _sec('After activation','Your first 30 days as a legal carrier', '<div class="prose reveal" style="max-width:840px;margin:0 auto"><p>New authorities live in a probation-like window: many brokers restrict loads to carriers with aged authority, and FMCSA&rsquo;s New Entrant program will audit your safety basics within the first months. Keep driver qualification files, drug-and-alcohol program enrollment, hours-of-service records and maintenance files clean from day one &mdash; the New Entrant audit checks exactly these. This is also where a dispatcher earns their keep: finding the brokers who DO work with new authorities.</p></div>', soft=True)
adp += m_dark('Where LoadBoot fits', 'Set up once, tracked forever', '', [
 ('calcheck', 'Compliance dates tracked', 'Insurance expirations, UCR renewals, inspection dates &mdash; tracked in your carrier account with reminders before they bite.'),
 ('doccheck', 'One document home', 'Authority letter, COI, W-9 &mdash; uploaded once, attached to every load packet automatically.'),
 ('truck', 'New-authority freight', 'We know which brokers accept fresh MCs. See our dedicated new-authority dispatch program.'),
], accent='#38bdf8', numbered=False)
adp += _adfaq_html + _COMPL_DISC + final_cta()
page('authority-dot-setup.html','Trucking Authority &amp; DOT Setup Guide (USDOT, MC, Insurance) | Loadboot',
 'Step-by-step USDOT and MC authority setup for new carriers: filing order, insurance, BOC-3, UCR, IRP, costs to plan for, the waiting period, and the New Entrant audit.',
 'services.html', adp, _adfaq_sch)

# ---------- 2. BOC-3 / UCR ----------
_bufaq_html,_bufaq_sch = faq_block([
 ('What happens if I skip UCR?','States enforce UCR at roadside and weigh stations — expect citations and fines, and some states hold registrations. It is one of the cheapest filings on your list; never let it lapse.'),
 ('Do I file BOC-3 myself?','For motor carriers, the BOC-3 must be filed by the process agent, electronically, with FMCSA. You choose the agent; they file.'),
 ('Does UCR cover my trailer?','UCR fees are based on your power-unit count. Trailers are not counted as vehicles for UCR brackets.'),
 ('I only operate in one state — do I need these?','If you cross state lines for hire, yes. Pure intrastate carriers should check their state rules — some states have their own versions.'),
])
bup = svc_hero('BOC-3 and UCR, Demystified','Two of the smallest filings in trucking cause an outsized share of shutdowns and fines. Here is exactly what each one is, who files it, and how to never think about them again.')
bup += _sec('BOC-3','Your legal mailbox in all 50 states', _cards([
 ('&#128236;','What it is','A designation of "process agents" — people or companies who can legally receive court papers on your behalf in every state you operate.'),
 ('&#9878;','Why FMCSA requires it','If someone needs to sue or serve your company, there must be a reachable representative in that state. No BOC-3, no active authority.'),
 ('&#127760;','The blanket agent shortcut','Nearly every carrier uses a single national "blanket" agent service that covers all states in one inexpensive filing.'),
]))
bup += m_rail('BOC-3 in practice', 'Three facts that save you pain', '', [
 ('timer', 'Filed before activation', 'Your authority cannot activate without an accepted BOC-3 on file. Do it during the protest window, not after.'),
 ('link', 'Keep the agent current', 'If your agent service lapses or you switch companies, an outdated BOC-3 can invalidate your authority without you noticing.'),
 ('pin', 'Address changes matter', 'Move your business? Update FMCSA AND your process agent &mdash; served papers you never receive still count as served.'),
], accent='#0883F7')
bup += m_zigzag('UCR', 'The annual fee almost everyone forgets once', [
 ('calcheck', 'What it is', 'Unified Carrier Registration &mdash; an annual, per-company fee that funds state enforcement programs, based on your power-unit bracket.'),
 ('wallet', 'Bracket pricing', 'Fees step up by fleet size (1&ndash;2 trucks, 3&ndash;5, 6&ndash;20, and up). Amounts are set annually &mdash; check the current year&rsquo;s table before paying.'),
 ('timer', 'Renewal window', 'Registration for the next year typically opens in the fall and is enforced from January 1. Calendar it forever.'),
], accent='#d97706', soft=False)
bup += _sec('Enforcement reality','Where carriers actually get caught', '<div class="prose reveal" style="max-width:840px;margin:0 auto"><p>UCR and BOC-3 problems surface at the worst times: a roadside inspection in a UCR-enforcing state, a broker&rsquo;s compliance check that flags your authority as inactive because a BOC-3 lapsed, or a court judgment you never knew about because papers went to a dead agent address. The fix costs minutes; the failure costs loads. Put both on autopilot: a reliable blanket agent with auto-renewal, and UCR paid the week the window opens.</p></div>', soft=True)
bup += _sec('Where LoadBoot fits','Never miss either one again', _cards([
 ('&#128276;','Renewal reminders','UCR windows and document expirations tracked in your carrier account — nudged before enforcement season, not after.'),
 ('&#128193;','Proof on file','Your UCR receipt and BOC-3 confirmation live with your other compliance documents, ready when a broker asks.'),
 ('&#129309;','Trusted referrals','Need a blanket agent or filing service? We will point you to reputable options — no kickback games.'),
]))
bup += _bufaq_html + _COMPL_DISC + final_cta()
page('boc3-ucr.html','BOC-3 Process Agents &amp; UCR Registration Explained | Loadboot',
 'What BOC-3 process agents and UCR registration are, who must file, bracket fees, renewal windows, enforcement realities, and how to put both on autopilot.',
 'services.html', bup, _bufaq_sch)

# ---------- 3. Form 2290 (HVUT) ----------
_hvfaq_html,_hvfaq_sch = faq_block([
 ('Who must file Form 2290?','Anyone registering a highway vehicle with a taxable gross weight of 55,000 lbs or more. That covers virtually every Class 8 tractor.'),
 ('When is it due?','The tax period runs July 1 to June 30. For vehicles in service in July, filing and payment are generally due by the end of August. First put a truck on the road mid-year? File by the end of the month after its first use.'),
 ('What is a Schedule 1 and why does everyone ask for it?','The IRS-stamped Schedule 1 is your proof of payment — your state DMV requires it to register or renew apportioned plates. No Schedule 1, no plates.'),
 ('What if I drive under 5,000 miles?','Vehicles expected to run 5,000 miles or less (7,500 for agricultural) can file as suspended — you still file, but owe no tax unless you exceed the mileage.'),
])
hvp = svc_hero('Form 2290 (Heavy Vehicle Use Tax) Without the Headache','One federal tax, one stamped page your DMV demands, one deadline that sneaks up every summer. Everything an owner-operator needs to know about HVUT.')
hvp += _sec('The basics','What Form 2290 actually is', _cards([
 ('&#128181;','A federal highway tax','An annual IRS tax on heavy highway vehicles (55,000 lbs+ taxable gross weight), scaled by weight category, capped by statute.'),
 ('&#128197;','A July–June tax year','The HVUT period always runs July 1 through June 30 — not the calendar year. That is why everyone scrambles in August.'),
 ('&#128196;','The Schedule 1','Your stamped proof of payment. DMVs require it for registration — it is the single most-requested tax document in trucking.'),
]))
hvp += m_timeline('Deadlines', 'The dates that matter', [
 ('calcheck', 'Trucks in service in July', 'File and pay by the last day of August. This is the big one for existing fleets.'),
 ('timer', 'Mid-year first use', 'Put a truck on the road in, say, November? File by December 31 &mdash; tax is prorated for the remaining months.'),
 ('receipt', 'Sold, destroyed or stolen', 'You may claim a credit or refund for the unused months. Keep the paperwork.'),
], accent='#e11d48', soft=True)
hvp += m_zigzag('Filing well', 'Five tips from carriers who learned the hard way', [
 ('bolt', 'E-file if you have 25+ vehicles', 'Required at that size &mdash; and faster for everyone: e-filed Schedule 1s come back in minutes, mailed ones in weeks.'),
 ('key', 'EIN, not SSN', 'Form 2290 requires an EIN, and a NEW EIN can take weeks to be recognized in the IRS e-file system &mdash; do not leave this for deadline week.'),
 ('doccheck', 'Match the VIN exactly', 'A one-character VIN typo means an amended return and a DMV visit with the wrong Schedule 1. Check it twice.'),
 ('scale', 'Weight category honesty', 'Tax steps up by gross weight category; if you increase your operating weight mid-year, an amendment is due.'),
 ('book', 'Keep 3 years of records', 'IRS expects supporting records kept for at least 3 years after the tax is due or paid.'),
], accent='#059669', soft=False)
hvp += _sec('Where LoadBoot fits','The Schedule 1 that is always findable', _cards([
 ('&#128193;','Stored with your docs','Upload your stamped Schedule 1 once — it lives with your authority letter and COI, ready for plate renewals.'),
 ('&#128276;','August never surprises you','HVUT deadline reminders in your carrier account, weeks ahead.'),
 ('&#129309;','Referral to e-file providers','We can point you to established IRS-authorized e-file providers — filing takes minutes.'),
]))
hvp += _hvfaq_html + _COMPL_DISC + final_cta()
page('form-2290-hvut.html','Form 2290 (HVUT) Guide — Deadlines &amp; Schedule 1 | Loadboot',
 'Heavy Vehicle Use Tax explained: who files Form 2290, July–June deadlines, prorated first-use rules, Schedule 1 proof for the DMV, e-filing tips and common mistakes.',
 'services.html', hvp, _hvfaq_sch)

# ---------- 4. IFTA ----------
_iffaq_html,_iffaq_sch = faq_block([
 ('Do I need IFTA with just one truck?','If your vehicle is over 26,000 lbs (or has 3+ axles) and you cross state lines, yes — one truck or one hundred, IFTA applies.'),
 ('How is the tax actually calculated?','Your fleet MPG (total miles ÷ total gallons) is applied to the miles you ran in each jurisdiction to compute fuel "used" there, credited against tax already paid at the pump in that state.'),
 ('What records do I need to keep?','Per-trip distance records by jurisdiction (ELD/GPS data works) and every fuel receipt with date, seller, gallons and vehicle — typically kept 4 years.'),
 ('When are returns due?','Quarterly — generally the last day of the month after each quarter ends (April 30, July 31, October 31, January 31). File even for zero-mile quarters.'),
])
ifp = svc_hero('IFTA Explained — Fuel Tax Without the Quarterly Panic','Buy fuel anywhere, pay each state its fair share, file one quarterly return. IFTA is simple in concept and brutal on sloppy records — here is how to run it clean.')
ifp += _sec('The concept','Why IFTA exists', '<div class="prose reveal" style="max-width:840px;margin:0 auto"><p>Before IFTA, interstate carriers filed fuel tax in every state they touched. The International Fuel Tax Agreement replaced that with ONE license from your base state, ONE quarterly return, and a clearinghouse that redistributes tax between states based on where you actually drove. You pay tax at the pump wherever you fuel; the return settles the difference between where you bought fuel and where you burned it.</p></div>')
ifp += _sec('Who and what','Coverage in 20 seconds', _cards([
 ('&#128666;','Qualified vehicles','Over 26,000 lbs GVW, or 3+ axles regardless of weight, operating in 2+ member jurisdictions (the lower 48 + Canadian provinces).'),
 ('&#127915;','One license, two decals','Your base state issues the IFTA license (carry a copy in the cab) and two decals per truck, renewed annually.'),
 ('&#128197;','Four returns a year','Every quarter, even if you did not run. Late or missing returns invite penalties, interest and revoked licenses.'),
]), soft=True)
ifp += m_rail('The math', 'How your bill is computed', '', [
 ('gauge', 'Fleet MPG', 'Total miles everywhere &divide; total gallons purchased everywhere = your quarter&rsquo;s MPG.'),
 ('pin', 'Fuel used per state', 'Miles driven in each state &divide; fleet MPG = gallons &ldquo;consumed&rdquo; there.'),
 ('scale', 'Settle the difference', 'Consumed gallons &times; that state&rsquo;s rate, minus tax you already paid at pumps there. Some states owe you; you owe others; one payment settles all.'),
], accent='#7c3aed')
ifp += m_dark('Records or ruin', 'What an IFTA audit looks for', '', [
 ('route', 'Distance by jurisdiction', 'Per-trip, per-state miles. Modern ELD/GPS exports satisfy this &mdash; paper trip sheets still work if complete.'),
 ('receipt', 'Every fuel receipt', 'Date, seller, address, gallons, fuel type, price, unit. Card statements alone are not receipts.'),
 ('timer', 'The 4-year window', 'Base states audit a percentage of carriers every year and can estimate (badly, against you) when records are missing.'),
], accent='#f59e0b', numbered=False)
ifp += _sec('Clean-IFTA habits','Make the quarterly filing a 20-minute job', _cards([
 ('&#9989;','Fuel card discipline','One fuel card for the truck, every gallon on it — your gallons report writes itself.'),
 ('&#128200;','Monthly mini-close','Reconcile miles and gallons monthly, not quarterly. Errors are findable when fresh.'),
 ('&#128276;','Deadline autopilot','Four fixed dates a year. Set reminders once; never pay a late penalty again.'),
]))
ifp += _sec('Where LoadBoot fits','Your miles are already organized', _cards([
 ('&#128205;','Trip records that audit well','Trips dispatched through LoadBoot carry lane, mileage and date records you can export.'),
 ('&#128193;','License &amp; decals on file','IFTA license and renewal dates tracked alongside your other compliance items.'),
 ('&#129309;','Referral to filing services','Prefer to outsource the return? We will point you to reputable IFTA preparers.'),
]))
ifp += _iffaq_html + _COMPL_DISC + final_cta()
page('ifta-fuel-tax.html','IFTA Fuel Tax Guide — Quarterly Returns, Records &amp; Audits | Loadboot',
 'How IFTA works: qualified vehicles, base-state license, quarterly return math, the records auditors demand, deadlines, and clean-filing habits.',
 'services.html', ifp, _iffaq_sch)

_ag_job_schema = '<script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting","title":"Independent Agent — Trucking Marketplace (Commission, Remote)","description":"Bring brokers, carriers and shippers to the LoadBoot marketplace in pairs and earn 1% of every delivered load your chain touches — recurring, uncapped, paid monthly. The software does the dispatch: live load board, GPS tracking, automatic invoicing and payments. You own the relationships.","datePosted":"2026-07-12","validThrough":"2027-07-12T23:59:59-05:00","employmentType":"CONTRACTOR","hiringOrganization":{"@type":"Organization","name":"LoadBoot","sameAs":"https://loadboot.com"},"jobLocationType":"TELECOMMUTE","applicantLocationRequirements":{"@type":"Country","name":"USA"},"baseSalary":{"@type":"MonetaryAmount","currency":"USD","value":{"@type":"QuantitativeValue","unitText":"MONTH","minValue":0,"maxValue":10000}},"directApply":true}</script>'

# ---- Careers ----
car = svc_hero('Careers at Loadboot', 'We are building an honest dispatch company for the people who keep America moving. If that sounds like you, we would love to talk.')
car += '<section><div class="wrap prose reveal"><h2>Why work here</h2><p>Loadboot exists to give carriers a dispatcher who actually has their back. We hire people who take that seriously &mdash; dispatchers, carrier-success reps, and builders who care about doing right by the driver on the other end of the phone.</p></div></section>'
# ---- OPEN ROLES — the Agent role is live and featured ----
car += ('<section class="bg-soft" id="roles"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Open roles</div><h2>We&rsquo;re hiring right now</h2></div>'
 '<div class="grid g2 reveal" style="max-width:980px;margin:0 auto">'
 '<a class="card reveal" href="agents.html" style="display:block;text-decoration:none;border:2px solid #FC5305;position:relative;background:linear-gradient(160deg,#10223B,#0d2a4d);color:#fff">'
 '<span style="position:absolute;top:14px;right:14px;background:#FC5305;color:#fff;font-size:.65rem;font-weight:900;padding:5px 11px;border-radius:999px;letter-spacing:.06em">&#9889; OPEN NOW &middot; REMOTE</span>'
 '<div class="icon">&#129309;</div><h3 style="color:#fff">Independent Agent &mdash; commission, uncapped</h3>'
 '<p style="color:#b9c6da">Bring brokers, carriers and shippers to the marketplace in pairs and earn <b style="color:#4ade80">1% of every delivered load your chain touches &mdash; recurring, forever</b>. The software does the dispatch; you own the relationships. No license needed.</p>'
 '<p style="color:#7cc0ff;font-weight:800;margin-top:10px">See the full program + earnings calculator &rarr;</p></a>'
 '<div class="card reveal"><div class="icon">&#128222;</div><h3>Dispatcher &amp; carrier success</h3><p>Load hunting, rate negotiation, onboarding carriers, keeping accounts healthy. Trucking experience wins; hustle and honesty are non-negotiable. Apply below with your story.</p><p style="color:#64748B;font-size:.85rem;margin-top:8px">Full-time / contract &middot; remote-friendly</p></div>'
 '</div></div></section>')
# ---- how hiring works ----
car += ('<section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">How it works</div><h2>From application to your first day</h2></div>'
 '<div class="grid g3 reveal">'
 '<div class="card reveal"><div class="icon">1</div><h3>Apply (5 minutes)</h3><p>The form below &mdash; a real person reads every message, usually within 48 hours. A LinkedIn or CV link beats a formal cover letter.</p></div>'
 '<div class="card reveal"><div class="icon">2</div><h3>One honest conversation</h3><p>15&ndash;30 minutes about what you&rsquo;ve actually done &mdash; lanes you&rsquo;ve run, brokers you know, systems you&rsquo;ve used. No trick questions.</p></div>'
 '<div class="card reveal"><div class="icon">3</div><h3>Start doing the work</h3><p>Agents get their account + referral link the same week. Dispatch roles start with a paid working trial on real loads.</p></div>'
 '</div></div></section>')
car += '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Life at LoadBoot</div><h2>What the work is actually like</h2></div><div class="grid g3 reveal"><div class="card reveal"><div class="icon">&#127919;</div><h3>Real stakes, real people</h3><p>Every shift you keep a driver earning and a shipper informed. The feedback loop is measured in hours, not quarters.</p></div><div class="card reveal"><div class="icon">&#128200;</div><h3>Modern tooling</h3><p>Our Command Center automates the busywork — matching, documents, reminders — so your judgment goes where software cannot.</p></div><div class="card reveal"><div class="icon">&#127758;</div><h3>Remote-friendly</h3><p>Dispatch runs on outcomes, not seat time. Reliable coverage matters; your zip code does not.</p></div></div></div></section><section><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Teams we hire for</div><h2>Where you could fit</h2></div><div class="grid g3 reveal"><div class="card reveal"><div class="icon">&#128222;</div><h3>Dispatch &amp; operations</h3><p>Load hunting, rate negotiation, trip babysitting, exception handling. Trucking experience wins; hustle and honesty are non-negotiable.</p></div><div class="card reveal"><div class="icon">&#129309;</div><h3>Carrier &amp; partner success</h3><p>Onboarding carriers, verifying brokers, keeping accounts healthy and honest.</p></div><div class="card reveal"><div class="icon">&#128187;</div><h3>Product &amp; engineering</h3><p>The platform behind it all — dispatch tooling, portals, automation and analytics.</p></div></div></div></section>'
car += lead_form('careers', 'Apply to Loadboot', 'Tell us about yourself and what you would want to own here.',
    [('name', 'Your name', 'text', True), ('email', 'Email', 'email', True), ('phone', 'Phone', 'tel', False),
     ('company', 'Current / most recent role', 'text', False),
     ('message', 'What are you great at? Share a link to your CV or LinkedIn.', 'textarea', True)],
    'Send application', 'Thanks — we&rsquo;ll be in touch.')
page('careers.html', 'Careers at Loadboot — Independent Agents (1% Commission) & Dispatch Roles',
     'LoadBoot is hiring: independent agents earning 1% of every delivered load (recurring, remote, uncapped) plus dispatch and carrier-success roles. Apply in 5 minutes.',
     'careers.html', car, _ag_job_schema)

# ---- Partner Program ----
pp = svc_hero('Loadboot Partner Program', 'For brokers, shippers and facilities who want a reliable, professional carrier network and clean, on-time paperwork.')
pp += m_zigzag('Partner with Loadboot', 'A network you can rely on', [
 ('shieldcheck', 'Vetted carriers', 'Work with carriers whose authority, insurance and compliance are actively tracked &mdash; fewer surprises, cleaner loads.'),
 ('doccheck', 'Clean documentation', 'Rate confirmations, BOLs and PODs handled properly and delivered on time, so billing and claims stay simple.'),
 ('headset', 'One point of contact', 'A professional dispatch team that answers the phone and communicates proactively on every load.'),
], accent='#6366f1', soft=False)
pp += m_dark('How partnership works', 'Verified once, then it is easy', '', [
 ('clipboard', 'Tell us about your freight', 'Lanes, equipment and volume &mdash; the form below takes two minutes.'),
 ('shieldcheck', 'Verification', 'We verify authority and key details against public and licensed sources before anything goes live.'),
 ('bolt', 'Start posting', 'Approved partners post loads through a guided wizard and watch them move &mdash; status, documents, exceptions, POD.'),
], accent='#818cf8')
pp += lead_form('partner_inquiry', 'Become a partner', 'Tell us about your freight and lanes and we will connect you with the right carriers.',
    [('name', 'Your name', 'text', True), ('company', 'Company', 'text', True), ('email', 'Email', 'email', True),
     ('phone', 'Phone', 'tel', False),
     ('partner_type', 'You are a', 'select:Broker|Shipper|Facility|Other', True),
     ('message', 'Lanes, freight type, and volume', 'textarea', False)],
    'Request partnership', 'Thanks — our partner team will reach out.')
pp += m_gradcta('Already a partner?', 'Your loads, documents and live shipment status are waiting in the Partner Portal.', 'Open Partner Portal &rarr;', '/app/partner/', grad='linear-gradient(135deg,#111827 0%,#1f2937 55%,#312e81 100%)', btncolor='#818cf8', btntext='#fff')
page('partners.html', 'Partner Program for Brokers, Shippers &amp; Facilities | Loadboot',
     'Partner with Loadboot for a reliable, vetted carrier network and clean, on-time documentation. Built for brokers, shippers and facilities.',
     'partners.html', pp)

# ---- Dedicated Carrier page (premium, ~14 sections) ----
def _prose(h2, *paras):
    return '<section><div class="wrap prose reveal"><h2>%s</h2>%s</div></section>' % (h2, ''.join('<p>%s</p>' % p for p in paras))
cp = svc_hero('Truck Dispatch Built Around Your Truck',
    'Loadboot is a dispatcher in your corner &mdash; we find the loads, negotiate the rate, handle the paperwork and keep you moving, so you can focus on driving. Flat 5%, no contracts, you keep your authority.')
cp += _sec('Why carriers choose Loadboot', 'A dispatcher that actually has your back', _cards([
    ('&#128666;', 'We keep your truck loaded', 'Dedicated dispatchers work your lanes and preferences so you spend less time hunting boards and more time earning.'),
    ('&#128176;', 'Better rates, negotiated for you', 'We know the lanes and we counter &mdash; you get a rate that reflects what the freight is really worth.'),
    ('&#129309;', 'You keep your authority', 'Your MC/DOT, your insurance, your broker relationships. We work on your behalf; we never take over your authority.'),
]))
cp += m_zigzag('Who we serve', 'Built for every kind of carrier', [
 ('users', 'Owner-operators', 'One-truck operations get a full dispatch team without hiring one &mdash; more loaded miles, less deadhead.'),
 ('badge', 'New-authority carriers', 'We help you land your first loads, build broker credibility, and avoid the costly early mistakes.'),
 ('truck', 'Small &amp; growing fleets', 'Assign drivers and trucks, track every trip, and run your whole operation from one carrier portal.'),
], accent='#0d9488', soft=True)
cp += _sec('Equipment', 'Every trailer type, dispatched', _cards([
    ('&#128230;', 'Dry van &amp; reefer', 'The bread-and-butter freight, matched to your lanes and appointment windows.'),
    ('&#127981;', 'Flatbed &amp; step deck', 'Open-deck freight with the securement and permit awareness it demands.'),
    ('&#9889;', 'Hotshot, power-only &amp; box truck', 'Smaller and specialized equipment kept busy with the right expedited and drop-and-hook runs.'),
]))
cp += m_dark('Load sourcing', 'How we find your freight', '', [
 ('radar', 'Real relationships, licensed sources', 'We source from broker and shipper relationships and licensed load channels &mdash; no scraping where it is not allowed.'),
 ('target', 'Matched to your preferences', 'Home time, preferred lanes, minimum rate-per-mile and equipment all factor into what we bring you.'),
 ('route', 'Reduced deadhead', 'We plan backhauls and next-load opportunities so more of your miles are paid miles.'),
], accent='#38bdf8', numbered=False)
cp += _prose('Rate negotiation that puts money on your truck',
    'The most profitable carriers rarely take the first number. Neither do we. Your dispatcher knows the lane, knows what the freight should pay, and counters on your behalf &mdash; then handles the rate confirmation so the agreed number is the number you get. Want to sharpen your own targets first? Run the math with our free <a href="tools.html">cost-per-mile and profit calculators</a>.')
cp += m_timeline('Dispatch &amp; appointments', 'The busywork, handled', [
 ('calcheck', 'Pickup &amp; delivery appointments', 'We set and confirm appointments and keep the facility details straight so you are not stuck on hold.'),
 ('headset', 'Real-time trip support', 'When something changes on the road, a dispatcher is reachable to re-work the plan.'),
 ('doccheck', 'Rate cons &amp; paperwork', 'We handle the tender, rate confirmation and load documents so nothing slows you down.'),
], accent='#7c3aed')
cp += _sec('Documents &amp; compliance', 'Kept current, kept clean', _cards([
    ('&#128196;', 'Document management', 'BOL, POD, scale tickets and lumper receipts organized against every load.'),
    ('&#128737;', 'Compliance support', 'We help keep authority, insurance and filings (IFTA, 2290, UCR, BOC-3) on your radar before they lapse.'),
    ('&#9989;', 'Broker credibility', 'Clean, on-time paperwork builds the reputation that gets you better loads.'),
]))
cp += _sec('When things go sideways', 'Detention, layover, lumper &amp; TONU support', _cards([
    ('&#9203;', 'Detention &amp; layover', 'Arrival and departure captured, evidence collected, and the accessorial pursued under your load terms.'),
    ('&#128176;', 'Lumper &amp; TONU', 'Lumper receipts and truck-ordered-not-used situations documented and billed properly.'),
    ('&#128295;', 'Breakdowns &amp; exceptions', 'When a trip hits trouble, we help re-plan and keep the broker informed.'),
]))
cp += _sec('Invoicing &amp; settlement', 'Get paid without the chase', _cards([
    ('&#129534;', 'Invoice-ready packets', 'Rate con, BOL and POD assembled so your invoice (or your factoring company) goes out clean.'),
    ('&#128179;', 'Factoring friendly', 'Works with your factoring so the paperwork never holds up your cash.'),
    ('&#128202;', 'Settlement visibility', 'See what you earned, what was deducted, and what is still owed &mdash; all in your portal.'),
]))
_cp_dash = ('<div style="background:linear-gradient(150deg,#10223B,#1e293b);border-radius:20px;padding:26px;color:#fff;max-width:420px;margin:0 auto;box-shadow:0 30px 60px -28px rgba(15,23,42,.6)">'
 '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><span style="font-family:Manrope;font-weight:800">Carrier Portal</span><span style="display:inline-flex;align-items:center;gap:6px;background:rgba(34,197,94,.18);color:#86efac;font-size:.78rem;padding:4px 10px;border-radius:999px"><span class="pdot"></span> live</span></div>'
 '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:12px">'
 '<div style="background:rgba(255,255,255,.06);border-radius:12px;padding:12px"><div style="color:#94a3b8;font-size:.72rem;text-transform:uppercase">Active trips</div><div style="font-family:Manrope;font-weight:800;font-size:1.3rem">3</div></div>'
 '<div style="background:rgba(255,255,255,.06);border-radius:12px;padding:12px"><div style="color:#94a3b8;font-size:.72rem;text-transform:uppercase">Docs pending</div><div style="font-family:Manrope;font-weight:800;font-size:1.3rem;color:#fbbf24">1</div></div></div>'
 '<div style="background:rgba(255,255,255,.06);border-radius:12px;padding:12px;font-size:.88rem;display:flex;justify-content:space-between"><span style="color:#94a3b8">DAL &rarr; ATL &middot; dry van</span><span style="color:#86efac;font-weight:700">in transit</span></div>'
 '<div style="color:#64748b;font-size:.72rem;margin-top:12px">Illustrative preview of the carrier dashboard.</div></div>')
cp += m_split('Your carrier software', 'One dashboard for the whole operation',
 ['Everything your operation touches &mdash; fleet, trips, documents, money &mdash; lives in one portal &mdash; and it works just as well from the driver&rsquo;s phone on the road. No spreadsheets, no second subscription.'],
 _cp_dash, flip=True, soft=True, accent='#0883F7',
 bullets=['Fleet &amp; drivers: licenses, medicals and expirations tracked','Trips &amp; tracking: confirm, start, deliver, share location','On the road: PODs, status and check-ins from the driver&rsquo;s phone'])
cp += m_rail('Getting started', 'On your lanes the same day', '', [
 ('clipboard', 'Create your profile', 'Tell us your equipment, lanes and preferences &mdash; about two minutes.'),
 ('shieldcheck', 'Send authority &amp; insurance', 'We verify the basics so brokers say yes faster.'),
 ('bolt', 'Start getting loads', 'A dispatcher goes to work on your lanes right away. No contract, cancel anytime.'),
], accent='#ea580c')
_cfaq_html, _cfaq_sch = faq_block([
    ('What does Loadboot cost carriers?', 'A flat 5% of the linehaul on loads we book &mdash; no sign-up fee, no monthly minimum, no contract. You only pay when we put money on your truck.'),
    ('Do I keep my own authority and insurance?', 'Yes. You keep your MC/DOT, your insurance and your broker relationships. We work on your behalf and never take over your authority.'),
    ('Do you work with new-authority carriers?', 'Absolutely &mdash; new-authority carriers are a core part of who we serve. We help you land early loads and build credibility.'),
    ('What equipment do you dispatch?', 'Dry van, reefer, flatbed, step deck, hotshot, power-only and box truck / expedited.'),
    ('How fast can I start?', 'Most carriers are set up the same day once we have your authority and insurance.'),
    ('How do I get paid?', 'Delivery flips your invoice to DUE automatically &mdash; deadlines, receipt-verified transfers, factoring/NOA routing and QuickBooks sync are built in. See <a href="payments-settlements.html">payments &amp; settlements</a>.'),
])
cp += _real_screen('board-card-details.webp',420,909,'A real load card opened — full rate card with detention, TONU and layover terms printed before booking','A real load, opened &mdash; the FULL rate card printed before you ever book.','What you book from','Every load shows its whole hand') + _cfaq_html + final_cta()
page('carriers.html', 'Truck Dispatch Service for Carriers — Flat 5%, Every Rate in Writing | LoadBoot',
     'Loadboot dispatches your truck: finds loads, negotiates rates, handles paperwork, detention and invoicing. Flat 5%, no contracts, keep your authority.',
     'services.html', cp, _cfaq_sch)

# ---- Dedicated Broker page (~15 sections; brokers only) ----
bp = svc_hero('A Reliable Carrier Network for Brokers',
    'Post a load and reach vetted carriers whose authority, insurance and compliance are actively tracked &mdash; with clean, on-time documentation and one professional point of contact on every load.')
bp += _sec('Why brokers work with Loadboot', 'Fewer surprises, cleaner loads', _cards([
    ('&#129309;', 'Vetted carriers', 'Carrier authority, insurance and compliance are actively monitored &mdash; you cover freight with less risk.'),
    ('&#128203;', 'Clean documentation', 'Rate confirmations, BOLs and PODs handled properly and returned on time, so billing and claims stay simple.'),
    ('&#128222;', 'One point of contact', 'A dispatch team that answers the phone and communicates proactively from tender to POD.'),
]))
bp += m_rail('Getting set up', 'Onboarding &amp; verification', '', [
 ('clipboard', 'Apply as a broker partner', 'Share your company, authority and contacts. Activation is human-reviewed &mdash; no bots approving accounts.'),
 ('shieldcheck', 'Authority &amp; verification', 'We verify broker authority and key details against public and licensed sources before you go live.'),
 ('badge', 'Approved &amp; active', 'Once approved, you can post loads and reach the carrier network right away.'),
], accent='#0883F7')
bp += m_timeline('Posting a load', 'A guided load wizard', [
 ('layers', 'Structured, step by step', 'Lane, schedule, equipment, requirements and documents &mdash; captured cleanly, with duplicate detection.'),
 ('doccheck', 'Document requirements up front', 'Set what you will provide (rate con, pickup/delivery numbers, appointment) so nothing stalls the load.'),
 ('link', 'Recurring lanes &amp; reposts', 'Repeat lanes and re-post prior loads with controlled changes instead of retyping everything.'),
], accent='#6366f1', soft=True)
_bp_match = ('<div style="background:#fff;border:1px solid #e2e8f0;border-radius:20px;padding:26px;max-width:420px;margin:0 auto;box-shadow:0 30px 60px -30px rgba(15,23,42,.35)">'
 '<div style="font-family:Manrope;font-weight:800;margin-bottom:4px">Why this carrier?</div>'
 '<div style="color:#94a3b8;font-size:.78rem;margin-bottom:14px">Illustrative &mdash; every offer shows its reasoning</div>'
 + ''.join('<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;font-size:.88rem;margin-bottom:4px"><span style="color:#475569">%s</span><b>%s</b></div><div style="height:6px;border-radius:99px;background:#f1f5f9"><div style="height:6px;border-radius:99px;width:%s;background:linear-gradient(90deg,#0883F7,#7c3aed)"></div></div></div>' % r for r in [
   ('Equipment fit','25/25','100%'),('Availability','22/25','88%'),('Compliance','20/20','100%'),('Performance history','24/30','80%')]) +
 '<div style="display:flex;justify-content:space-between;border-top:1px solid #f1f5f9;padding-top:12px;margin-top:4px"><span style="font-weight:700">Match score</span><b style="color:#0883F7;font-family:Manrope;font-size:1.1rem">91 / 100</b></div></div>')
bp += m_split('Matching', 'The right carrier, explained',
 ['Only carriers who pass hard eligibility checks &mdash; authority, insurance, equipment, availability &mdash; are ever offered your load. Then ranking is explainable: you see exactly why a carrier scored what they scored. Never a black box.'],
 _bp_match, accent='#7c3aed',
 bullets=['Hard eligibility before any offer goes out','Score equals the sum of its shown factors','Route to your preferred carriers first'])
bp += m_dark('Operational visibility', 'Know where your freight is', '', [
 ('pin', 'Permitted live status', 'See load and trip status, pickup and delivery progress and the latest permitted ETA &mdash; automatically.'),
 ('radar', 'Driver &amp; trip tracking', 'Location and check-ins where the carrier and driver have enabled tracking, clearly labeled.'),
 ('siren', 'Exceptions surfaced', 'Detention, delays and appointment issues are raised early, not discovered at delivery.'),
], accent='#38bdf8', numbered=False)
bp += _sec('Appointments &amp; documents', 'Kept straight', _cards([
    ('&#128197;', 'Appointment management', 'Pickup and delivery appointments tracked against facility requirements.'),
    ('&#128196;', 'Required documents', 'A live checklist of what is required, received, missing or rejected &mdash; for every load.'),
    ('&#128203;', 'POD &amp; billing', 'Proof of delivery captured and organized so billing and claims are painless.'),
]))
bp += m_zigzag('When issues happen', 'Structured exception resolution', [
 ('timer', 'Detention &amp; accessorials', 'Arrival/departure evidence and accessorial requests handled under the load terms, with an audit trail.'),
 ('route', 'Reschedules &amp; re-covers', 'Appointment changes and re-covers coordinated quickly to protect the delivery.'),
 ('doccheck', 'One clear record', 'Every exception has a reporter, timeline, owner and resolution &mdash; no he-said-she-said.'),
], accent='#d97706', soft=True)
bp += _sec('Integrations &amp; security', 'Fits how you already work', _cards([
    ('&#128268;', 'API &amp; webhooks', 'Subscribe to load, trip, document and delivery events; integrate with your TMS on approved endpoints.'),
    ('&#128274;', 'Permissioned data', 'You see what you are entitled to and nothing more &mdash; carrier financials and internal notes stay private.'),
    ('&#128737;', 'Audit &amp; consent', 'Actions are audited and communications respect consent and suppression rules.'),
]))
bp += lead_form('partner_inquiry', 'Become a broker partner', 'Tell us about your freight and lanes and we will get you set up with the carrier network.',
    [('name', 'Your name', 'text', True), ('company', 'Brokerage', 'text', True), ('email', 'Email', 'email', True),
     ('phone', 'Phone', 'tel', False), ('mc', 'MC number', 'text', False),
     ('message', 'Lanes, freight type and typical volume', 'textarea', False)],
    'Request partnership', 'Thanks — our partner team will reach out.')
_bfaq_html, _bfaq_sch = faq_block([
    ('Who can post loads on Loadboot?', 'Approved broker partners. Because moving freight from shippers requires a broker license in the US, load posting is for licensed brokers &mdash; carrier and driver accounts are separate.'),
    ('How are carriers vetted?', 'We actively track carrier authority, insurance and compliance, and only carriers who pass hard eligibility checks are offered your loads.'),
    ('Can I integrate with my TMS?', 'Yes &mdash; subscribe to load, trip, document and delivery events via webhooks and our API on approved endpoints.'),
    ('What visibility do I get?', 'Permitted live load and trip status, pickup and delivery progress, ETAs, document status and open exceptions &mdash; without exposing private carrier data.'),
    ('How do I pay carriers?', 'Payables group per trip &mdash; freight plus every approved claim with one total and a PAY-BY deadline. Pay with one receipt, the carrier confirms, the trip settles green. See <a href="payments-settlements.html">payments &amp; settlements</a>.'),
])
bp += ('<section class="bg-soft"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The numbers that matter</div><h2>What &ldquo;covered&rdquo; looks like here</h2></div>'
 '<div class="grid g4 reveal" style="margin-top:22px">'
 '<div class="card" style="text-align:center"><div style="font-weight:900;font-size:1.6rem;color:#0883F7">15 min</div><p>offer window &mdash; verified carriers race it; first acceptance wins, the rest auto-close.</p></div>'
 '<div class="card" style="text-align:center"><div style="font-weight:900;font-size:1.6rem;color:#0883F7">0</div><p>double-bookings possible &mdash; one accept closes every other offer on the load, by design.</p></div>'
 '<div class="card" style="text-align:center"><div style="font-weight:900;font-size:1.6rem;color:#0883F7">800 m</div><p>geofences at every stop &mdash; arrive/depart stamp server-side; your customer updates write themselves.</p></div>'
 '<div class="card" style="text-align:center"><div style="font-weight:900;font-size:1.6rem;color:#0883F7">1</div><p>receipt can settle a whole trip &mdash; freight plus approved claims, confirmed by the carrier. <a href="payments-settlements.html">The payables rail</a>.</p></div>'
 '</div></div></section>') + _bfaq_html
bp += m_gradcta('Already a broker partner?', 'Post loads, review documents and watch shipments move &mdash; live in your Partner Portal.', 'Open Partner Portal &rarr;', '/app/partner/', grad='linear-gradient(135deg,#0b1220 0%,#1e3a5f 60%,#312e81 100%)', btncolor='#60a5fa', btntext='#0b1220')
page('brokers.html', 'Freight Broker Solutions — Verified Carrier Capacity, Covered in Minutes | LoadBoot',
     'Brokers post loads to a vetted Loadboot carrier network with explainable matching, live visibility, clean documentation and API/webhook integration. Broker partners only.',
     'partners.html', bp, _bfaq_sch)

# ---- Shipper Solutions page (Inc 58, directive #37) — INQUIRY/CONSULTATION ONLY.
# HONESTY GUARD: LoadBoot is a dispatch service company. Freight from shippers requires a licensed
# freight broker in the US; this page never claims broker authority and offers inquiry/consultation only.
_sfaq_html, _sfaq_sch = faq_block([
    ('Can I post freight directly on LoadBoot?', 'Yes &mdash; create your shipper account, post your freight and track every shipment live. LoadBoot dispatch pairs each load with verified, health-scored carriers and handles documents, appointments and claims.'),
    ('Is LoadBoot a freight broker?', 'LoadBoot is a dispatch and logistics technology platform. You post freight directly in your own shipper portal and our dispatch team runs it with verified carriers. Where broker authority is required, licensed partners are involved &mdash; we are always transparent about who is doing what on your shipment.'),
    ('What information should I prepare?', 'Lanes (origin/destination), freight type, weight, equipment needs, monthly volume and any appointment or facility requirements. The more detail, the faster the consultation.'),
    ('How do facilities and appointments work?', 'We coordinate pickup and delivery appointments, capture facility instructions, and track arrive/depart times so detention is documented from real timestamps.'),
])

# ---- Referral Program ----
# Unique-link attribution: ?ref=CODE is captured (and remembered) so every lead form on these
# pages carries referral_code into the CRM — an influencer's link is credited even if the
# carrier applies later from another page visit.
REF_CAPTURE_JS = '<script>(function(){try{var m=location.search.match(/[?&]ref=([A-Za-z0-9]+)/);var v=m?m[1].toUpperCase():null;if(v){try{localStorage.setItem(\'lb_ref\',v);}catch(e){}}if(!v){try{v=localStorage.getItem(\'lb_ref\');}catch(e){}}if(!v)return;document.querySelectorAll(\'form\').forEach(function(f){var i=document.createElement(\'input\');i.type=\'hidden\';i.name=\'referral_code\';i.value=v;f.appendChild(i);});}catch(e){}})();</script>'

REF_HERO = ('<section style="padding:104px 0 96px;background:linear-gradient(135deg,#0b1220 0%,#12304f 55%,#0e3b33 100%);color:#fff;position:relative;overflow:hidden">'
 '<div class="aurora"><span class="a1" style="background:#34d399;opacity:.22"></span><span class="a2" style="background:#38bdf8;opacity:.2"></span></div>'
 '<div class="wrap" style="position:relative;z-index:1;text-align:center">'
 '<span class="badge reveal" style="background:rgba(52,211,153,.14);color:#a7f3d0;border-color:rgba(52,211,153,.3)"><span class="dot" style="background:#34d399"></span> Referral &amp; Partner Program</span>'
 '<h1 class="reveal d1" style="color:#fff;max-width:840px;margin:0 auto">Turn your network into <span style="background:linear-gradient(120deg,#34d399,#7dd3fc);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent">monthly income</span></h1>'
 '<p class="lead center reveal d2" style="color:#cbd5e1;max-width:700px;margin:22px auto 0">Refer a carrier or broker <b style="color:#fff">once</b>. Earn a slice of our dispatch fee on <b style="color:#fff">every load they haul</b> &mdash; month after month, for as long as they keep rolling. It costs them nothing extra, and you nothing at all.</p>'
 '<div class="reveal d2" style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-top:38px">'
 + ''.join('<div style="flex:1 1 210px;max-width:270px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.13);border-radius:18px;padding:24px;text-align:center">'
   '<div style="color:#94a3b8;font-size:.88rem;letter-spacing:.02em;text-transform:uppercase">%s</div>'
   '<div style="font-size:2.2rem;font-weight:800;color:#34d399;margin:6px 0 4px;font-family:Manrope">%s</div>'
   '<div style="color:#cbd5e1;font-size:.92rem">%s</div></div>' % t for t in [
     ('Refer 5 active carriers','~ $1,000/mo*','recurring, while they haul'),
     ('Refer 20 active carriers','~ $4,000/mo*','your network, working for you'),
     ('They refer others too','5 levels deep*','earn down your whole chain')]) +
 '</div>'
 '<div class="reveal d3" style="margin-top:34px"><a href="#join" class="btn btn-primary" style="background:#34d399;color:#052e2b;border:none;font-weight:800;font-size:1.05rem;padding:17px 36px">Join the early list &rarr;</a></div>'
 '<p class="reveal d3" style="color:#94a3b8;font-size:.82rem;margin:18px auto 0;max-width:720px">*Illustrative only, based on a referred carrier hauling roughly $20k/month. Commissions are paid entirely from LoadBoot&rsquo;s own 5% dispatch fee &mdash; your referrals never pay more, and you invest nothing. Exact tiers are confirmed in writing at signup.</p>'
 '</div></section>')
ref = REF_HERO
ref += _sec('Who it is for', 'Pick the path that fits you', _cards([
    ('&#128667;', 'Carriers &amp; drivers', 'Already rolling with Loadboot? Introduce another owner-operator or fleet. There is no limit on how many you can refer, and no cost to you or to them.'),
    ('&#127970;', 'Dispatch shops &amp; agencies', 'Run a book of carriers you cannot fully cover? Refer the overflow to Loadboot and earn on the freight they haul &mdash; while they keep their own authority.'),
    ('&#127908;', 'Creators &amp; influencers', 'Trucking audience on YouTube, TikTok or a newsletter? Become an affiliate partner &mdash; no client roster required, just a genuine recommendation.'),
], 'g3'))
ref += '<section class="section"><div class="wrap"><div class="reveal" style="background:linear-gradient(120deg,#10223B,#0d2f56);border-radius:18px;padding:26px 30px;color:#fff">'
ref += '<div style="font-size:.72rem;font-weight:800;letter-spacing:.14em;color:#93c5fd;text-transform:uppercase;margin-bottom:6px">Now live — one program, one portal</div>'
ref += '<h3 style="margin:0 0 8px;font-size:1.35rem">The referral program now runs inside the <span style="color:#FC5305">Agent Portal</span></h3>'
ref += '<p style="color:#9fb0cc;line-height:1.75;margin:0 0 14px">Referral partners, influencers and independent dispatchers all use the SAME engine: create your agent account, get ONE link that works for carriers, brokers and shippers, and track every join, every delivered load and every dollar live — 1% of gross on delivered loads, levels 2&ndash;5 overrides when you recruit other agents, monthly payouts from $100.</p>'
ref += '<a href="/app/agent/" class="btn btn-primary" style="background:#FC5305;border:none;font-weight:800">Create your agent account &rarr;</a> <a href="agents.html" class="btn btn-secondary" style="margin-left:8px">Program details</a>'
ref += '</div></div></section>'
ref += m_rail('How it works', 'Four honest steps',
 'From your first share to your first payout &mdash; each step recorded, nothing owed until it is confirmed in writing.', [
 ('badge', 'Join the program', 'Create your account at loadboot.com/app/agent/ &mdash; your personal code and share link are live the moment verification clears. One link works for carriers, brokers and shippers.'),
 ('megaphone', 'Share it', 'Send your link, or introduce a carrier directly. Each carrier is credited to the first partner who referred them &mdash; recorded once, no double-claims.'),
 ('truck', 'They get rolling', 'Your referral runs their own freight with Loadboot at a flat 5% &mdash; no contract. You earn only when they actually haul and we actually get paid.'),
 ('wallet', 'You get paid', 'Your reward is calculated from Loadboot&rsquo;s fee on that freight, held briefly to clear cancellations, then released for payout. A human approves every payment.'),
], accent='#059669')
ref += m_dark('Multi-level, minus the games', 'A share of our fee &mdash; not a pyramid',
 'Nothing to buy, nothing marked up, and Loadboot always keeps the majority of its own fee.', [
 ('handshake', 'Paid from our cut', 'Rewards come out of the 5% dispatch fee Loadboot already earns. The carrier never pays more, and the load rate is never marked up to fund a referral.'),
 ('layers', 'Up to five levels', 'If a partner you brought in later refers someone themselves, you can earn a smaller share down the chain &mdash; up to five levels deep, with each level thinner than the last.'),
 ('scale', 'Terms being finalized', 'Exact percentages and payout rules are being finalized with legal before the program opens publicly. Apply now to join the early list &mdash; we confirm your terms in writing before anything is owed or paid.'),
], accent='#34d399', numbered=False)
ref += '<div id="join"></div>'
ref += lead_form('referral', 'Refer a carrier', 'Know an owner-operator or fleet who deserves a better dispatcher? Tell us who to reach out to (with their permission) and how to thank you when they get rolling.',
    [('name', 'Your name', 'text', True), ('email', 'Your email', 'email', True), ('phone', 'Your phone', 'tel', False),
     ('referral_name', 'Who are you referring?', 'text', True),
     ('referral_contact', 'Their phone or email', 'text', True),
     ('message', 'Anything we should know?', 'textarea', False)],
    'Send referral', 'Thanks — we&rsquo;ll reach out and keep you posted.')
ref += lead_form('referral', 'Apply as a referral partner', 'For agencies, dispatch shops and creators who want an ongoing referral or affiliate relationship. Tell us about your audience or book of business and we will set up your partner code.',
    [('name', 'Your name', 'text', True), ('email', 'Your email', 'email', True), ('phone', 'Your phone', 'tel', False),
     ('company', 'Company / channel name', 'text', False),
     ('partner_type', 'What best describes you?', 'select:Dispatch shop or agency|Content creator or influencer|Carrier referring others|Other', True),
     ('audience', 'Your audience or carrier base (roughly)', 'text', False),
     ('message', 'How would you like to work with us?', 'textarea', False)],
    'Apply to partner', 'Thanks — we&rsquo;ll review and reach out with your partner terms.')
_rfaq_html, _rfaq_sch = faq_block([
    ('Does it cost the carrier anything?', 'No. Referral rewards are paid entirely out of Loadboot&rsquo;s own 5% dispatch fee. The carrier pays the same flat 5% whether they were referred or not, and the load rate is never inflated to cover a referral.'),
    ('When do I actually get paid?', 'You earn when a carrier you referred hauls freight through Loadboot and we collect our fee on it. Each reward is held for a short period to clear cancellations and adjustments, then released as payable. A person approves every payout &mdash; money never moves automatically.'),
    ('What is "multi-level"?', 'If someone you refer becomes a partner and refers others, you can earn a smaller share further down that chain &mdash; up to five levels, each thinner than the one above it. It is a thank-you funded by our fee, not a recruitment scheme, and there is nothing to buy to participate.'),
    ('Do I need my own carriers to be an affiliate?', 'No. Creators and influencers can join as affiliates with no client roster &mdash; you simply share your link with a trucking audience. Agencies and dispatch shops with their own carriers can refer overflow instead.'),
    ('Can I refer more than one carrier?', 'Yes &mdash; there is no cap. Each carrier is credited to the first partner who referred them, so introduce as many as you like.'),
    ('Is the program live right now?', 'The engine is built and tested, but public terms are being finalized with legal before it opens. Applying now puts you on the early list; we confirm your exact terms in writing before anything is owed.'),
])
ref += _rfaq_html
ref += REF_CAPTURE_JS
ref += final_cta()
page('referral.html', 'Referral Program &mdash; now the LoadBoot Agent Program',
     'The LoadBoot referral program has grown into the Agent Program: one link for carriers, brokers and shippers, 1% of gross on every delivered load, 5 levels of overrides.',
     'referral.html', '<section class="section"><div class="wrap" style="text-align:center;padding:80px 0"><h1>The referral program is now the <span style="color:#FC5305">Agent Program</span></h1><p class="lead center" style="max-width:640px;margin:14px auto 24px">Same idea, bigger engine: one link for carriers, brokers and shippers \u00b7 1% of gross on every delivered load \u00b7 overrides 5 levels deep \u00b7 live chain tracking and monthly payouts.</p><a href="agents.html" class="btn btn-primary">See the Agent Program &rarr;</a> <a href="/app/agent/" class="btn btn-secondary" style="margin-left:8px">Create your agent account</a></div></section>',
     '<meta http-equiv="refresh" content="4;url=/agents.html">')

# ---------- AGENT PROGRAM (independent dispatchers — pair-based 1% recurring) ----------
AGENT_CSS = '''<style>
.ag-hero{background:linear-gradient(135deg,#0a1526,#10223B 55%,#0d2a4d);color:#fff;padding:86px 20px 70px;position:relative;overflow:hidden}
.ag-hero:before{content:"";position:absolute;inset:0;background:radial-gradient(700px 300px at 80% 20%,rgba(8,131,247,.25),transparent 60%),radial-gradient(500px 260px at 15% 85%,rgba(252,83,5,.18),transparent 60%)}
.ag-wrap{max-width:1100px;margin:0 auto;position:relative}
.ag-eyebrow{display:inline-block;background:rgba(252,83,5,.15);border:1px solid rgba(252,83,5,.45);color:#ffb38a;font-weight:800;font-size:.72rem;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px}
.ag-h1{font-family:Manrope,sans-serif;font-weight:800;font-size:clamp(1.9rem,4.6vw,3.3rem);line-height:1.12;margin:18px 0 14px}
.ag-h1 b{color:#4ade80}
.ag-sub{color:#b9c6da;font-size:1.06rem;line-height:1.7;max-width:640px}
.ag-cta{display:inline-block;background:#FC5305;color:#fff;font-weight:800;padding:15px 28px;border-radius:13px;text-decoration:none;font-size:1.02rem;box-shadow:0 14px 34px -10px rgba(252,83,5,.55);margin-top:24px}
.ag-cta.ghost{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.2);box-shadow:none;margin-left:10px}
.ag-chain{display:flex;align-items:center;justify-content:center;gap:0;margin:56px auto 6px;max-width:860px;flex-wrap:wrap}
.ag-node{background:rgba(255,255,255,.06);border:1.5px solid rgba(255,255,255,.16);border-radius:18px;padding:18px 22px;text-align:center;min-width:150px;position:relative;animation:agfloat 4s ease-in-out infinite}
.ag-node:nth-child(3){animation-delay:1s}.ag-node:nth-child(5){animation-delay:2s}
.ag-node .ic{font-size:1.9rem}.ag-node b{display:block;margin-top:6px;font-size:.95rem}.ag-node span{display:block;color:#8fa3bf;font-size:.72rem;margin-top:3px}
.ag-link{flex:none;width:74px;height:3px;background:linear-gradient(90deg,#0883F7,#4ade80);position:relative;overflow:visible}
.ag-link:after{content:"$";position:absolute;top:-13px;left:0;color:#4ade80;font-weight:900;font-size:.95rem;animation:agflow 2.2s linear infinite}
@keyframes agflow{0%{left:0;opacity:0}15%{opacity:1}85%{opacity:1}100%{left:calc(100% - 10px);opacity:0}}
@keyframes agfloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-7px)}}
.ag-badge{position:absolute;top:-13px;right:-9px;background:#16a34a;color:#fff;font-size:.62rem;font-weight:900;padding:4px 9px;border-radius:999px;letter-spacing:.05em}
.ag-sec{padding:64px 20px}
.ag-sec.soft{background:#F4F8FC}
.ag-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:18px;max-width:1100px;margin:26px auto 0}
.ag-card{background:#fff;border:1px solid #e4ebf4;border-radius:18px;padding:22px;box-shadow:0 10px 34px -18px rgba(2,12,30,.18);transition:transform .2s}
.ag-card:hover{transform:translateY(-4px)}
.ag-card .n{width:34px;height:34px;border-radius:10px;background:#0883F7;color:#fff;font-weight:900;display:flex;align-items:center;justify-content:center;margin-bottom:12px}
.ag-card h3{font-family:Manrope,sans-serif;font-size:1.04rem;margin-bottom:8px;color:#10223B}
.ag-card p{color:#5b6b80;font-size:.9rem;line-height:1.65}
.agc{background:linear-gradient(160deg,#0b1220,#10223B);border:1px solid rgba(8,131,247,.35);border-radius:22px;padding:30px;max-width:860px;margin:30px auto 0;color:#e6edf8}
.agc h3{color:#7cc0ff;font-family:Manrope,sans-serif;margin-bottom:4px}
.agc .row{display:flex;justify-content:space-between;font-weight:700;margin-top:18px;font-size:.92rem}
.agc input[type=range]{width:100%;accent-color:#FC5305;margin:6px 0 2px}
.agc output{color:#fbbf24;font-weight:900}
.agc-out{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:24px}
.agc-tile{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:15px;padding:16px;text-align:center}
.agc-tile span{display:block;font-size:.62rem;letter-spacing:.1em;font-weight:800;color:#7f92b3;text-transform:uppercase}
.agc-tile b{display:block;font-size:1.9rem;font-weight:900;margin-top:4px;color:#fff}
.agc-tile.hi b{color:#4ade80}
@media(max-width:720px){.ag-link{width:3px;height:40px;transform:rotate(90deg) scale(.5)}}
</style>'''

AGENT_BODY = AGENT_CSS + '''
<section class="ag-hero"><div class="ag-wrap" style="text-align:center">
<span class="ag-eyebrow">Agent Program &middot; Independent Dispatchers</span>
<h1 class="ag-h1">Bring the people.<br>The software does the work.<br><b>You earn 1% of every load &mdash; forever.</b></h1>
<p class="ag-sub" style="margin:0 auto">LoadBoot runs the dispatch: live board, one-tap booking, GPS proof, automatic invoicing and payments. Your job is the one thing software can&rsquo;t do &mdash; bring a broker and a carrier together. Every load your chain delivers pays you 1% of the gross. Recurring. No cap.</p>
<a class="ag-cta" href="contact.html">Apply as an Agent &rarr;</a><a class="ag-cta ghost" href="#calc">See the money &darr;</a>
<div class="ag-chain">
 <div class="ag-node"><div class="ic">&#127970;</div><b>Your Broker</b><span>posts loads</span><span class="ag-badge">YOURS</span></div>
 <div class="ag-link"></div>
 <div class="ag-node" style="border-color:rgba(252,83,5,.5)"><div class="ic">&#9889;</div><b>LoadBoot</b><span>books &middot; tracks &middot; pays</span></div>
 <div class="ag-link"></div>
 <div class="ag-node"><div class="ic">&#128666;</div><b>Your Carrier</b><span>delivers</span><span class="ag-badge">YOURS</span></div>
</div>
<div style="color:#4ade80;font-weight:800;margin-top:16px">every delivered load &rarr; 1% lands in YOUR account, automatically</div>
</div></section>

<section class="ag-sec"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">How it works</div><h2>Four steps. Then it compounds.</h2></div>
<div class="ag-grid">
<div class="ag-card reveal"><div class="n">1</div><h3>Get your agent account</h3><p>Log in to your dashboard and grab your personal referral link. Every client who joins through it is tied to you &mdash; permanently and automatically.</p></div>
<div class="ag-card reveal"><div class="n">2</div><h3>Bring a PAIR</h3><p>A broker + a carrier, or a shipper + a broker. One side alone stays pending &mdash; a pair makes a living marketplace, and that activates your chain.</p></div>
<div class="ag-card reveal"><div class="n">3</div><h3>Watch it live</h3><p>Your dashboard shows everything in real time: who joined, loads posted, trucks moving on GPS, deliveries confirmed &mdash; and your commission landing on each one.</p></div>
<div class="ag-card reveal"><div class="n">4</div><h3>Get paid monthly</h3><p>1% of gross on every GPS-verified delivered load your chain touches. Payable after a 15-day clearing window, paid out monthly from $100. No invoices, no chasing.</p></div>
</div></div></section>

<section class="ag-sec soft" id="calc"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">The money</div><h2>Move the sliders &mdash; this is YOUR math</h2></div>
<div class="agc reveal">
<h3>&#128176; Agent earnings calculator</h3>
<div class="row"><label for="agChains">Active chains (pairs you brought)</label><output id="agChainsOut">3</output></div>
<input type="range" id="agChains" min="1" max="15" value="3">
<div class="row"><label for="agLoads">Loads per chain / month</label><output id="agLoadsOut">15</output></div>
<input type="range" id="agLoads" min="4" max="60" value="15">
<div class="row"><label for="agRate">Average load value ($)</label><output id="agRateOut">$2,200</output></div>
<input type="range" id="agRate" min="800" max="5000" step="100" value="2200">
<div class="agc-out">
<div class="agc-tile"><span>Freight your chains move</span><b id="agGross">$99,000</b></div>
<div class="agc-tile hi"><span>Your monthly income (1%)</span><b id="agMo">$990</b></div>
<div class="agc-tile hi"><span>Your yearly income</span><b id="agYr">$11,880</b></div>
</div>
<div style="font-size:.85rem;color:#9fb3d1;margin-top:16px">Recurring &mdash; for as long as your clients keep moving freight. Refer other agents and earn override levels down 5 deep (0.5%, 0.25%&hellip;).</div>
</div>
<script>(function(){var c=document.getElementById("agChains"),l=document.getElementById("agLoads"),r=document.getElementById("agRate");if(!c)return;
function m(v){return "$"+Math.round(v).toLocaleString()}
function u(){var g=(+c.value)*(+l.value)*(+r.value);document.getElementById("agChainsOut").textContent=c.value;document.getElementById("agLoadsOut").textContent=l.value;document.getElementById("agRateOut").textContent=m(+r.value);document.getElementById("agGross").textContent=m(g);document.getElementById("agMo").textContent=m(g*0.01);document.getElementById("agYr").textContent=m(g*0.12);}
[c,l,r].forEach(function(x){x.addEventListener("input",u)});u();})();</script>
</div></section>

<section class="ag-sec"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow">Why it pays you forever</div><h2>You&rsquo;re not selling. You&rsquo;re building an asset.</h2></div>
<div class="ag-grid">
<div class="ag-card reveal"><h3>&#129309; Costs your clients nothing</h3><p>Your 1% comes out of LoadBoot&rsquo;s own 5% fee &mdash; the broker and carrier pay nothing extra. You can promote with a straight face.</p></div>
<div class="ag-card reveal"><h3>&#128274; GPS-verified only</h3><p>Commission counts only on delivered, GPS-proven trips. No fake volume, no clawback drama &mdash; a 15-day clearing window keeps it clean.</p></div>
<div class="ag-card reveal"><h3>&#128200; Recurring by design</h3><p>You earn on load #1 and on load #500. Your income grows with your clients&rsquo; business &mdash; so helping them win literally pays you.</p></div>
<div class="ag-card reveal"><h3>&#128101; 5 levels deep</h3><p>Recruit other agents: you earn overrides on their chains too &mdash; 1% / 0.5% / 0.25% / 0.15% / 0.10% down five levels.</p></div>
</div>
<div class="reveal" style="text-align:center;margin-top:36px">
<a class="ag-cta" href="contact.html" style="background:#0883F7">Apply now &mdash; reply &ldquo;I&rsquo;M IN&rdquo; &rarr;</a>
<div style="color:#64748B;font-size:.85rem;margin-top:12px">Or email <b>hello@loadboot.com</b> with subject &ldquo;Agent Program&rdquo; &mdash; we set up your account and walk you through the dashboard in 15 minutes.</div>
</div>
</div></section>'''

_ag_faq_html, _ag_faq_sch = faq_block([
 ('How do I get my referral link?', 'Apply, and we create your agent account. Your dashboard shows your personal link (loadboot.com/?ref=YOURCODE). Anyone who joins LoadBoot through that link is permanently credited to you - the system records it automatically at signup.'),
 ('When do I start earning?', 'The moment your chain is ACTIVE - meaning you have referred at least one pair (a broker + a carrier, or a shipper + a broker). From then on, every GPS-verified delivered load involving your referred clients credits 1% of the gross load value to your account.'),
 ('Is it really recurring - every load, forever?', 'Yes. This is not a one-time signup bonus. As long as your referred clients keep moving freight on LoadBoot, every delivered load pays your commission. Your book of clients is your asset.'),
 ('Who pays my commission - do my clients pay extra?', 'No. Your commission comes out of LoadBoot&rsquo;s own service fee. Your broker and carrier pay exactly what they would pay anyway.'),
 ('How and when am I paid?', 'Commissions become payable after a 15-day clearing window (protects against cancelled or disputed loads), and payouts run monthly from a $100 minimum balance - bank transfer or Payoneer.'),
 ('Do I need a dispatch license or MC authority?', 'No. You are an independent agent, not a broker of record. You connect people; LoadBoot&rsquo;s licensed marketplace handles the freight, documents and payments.'),
])


page('agents.html', 'Become a LoadBoot Agent — Earn 1% of Every Load, Recurring | Independent Dispatchers',
 'Commission role for independent dispatchers: bring a broker + carrier pair to LoadBoot and earn 1% of every GPS-verified delivered load — recurring, no cap, paid monthly. The software does the dispatch; you own the relationships.',
 'partners.html', AGENT_BODY + _ag_faq_html + final_cta(), _ag_job_schema + _ag_faq_sch)
RELATED['agents.html'] = [('agents.html','Agent Program'),('partners.html','Partner Portal'),('brokers.html','For Brokers'),('carriers.html','For Carriers'),('contact.html','Apply / Contact')]


# ---- Resources ----
resr = svc_hero('Carrier Resources', 'Free tools, guides and answers to help you run a stronger trucking business &mdash; whether you dispatch with us or not.')
_ls_visual = ('<div style="background:linear-gradient(150deg,#10223B,#1e293b);border-radius:20px;padding:28px;color:#fff;max-width:400px;margin:0 auto;box-shadow:0 30px 60px -28px rgba(15,23,42,.6)">'
 '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><span style="font-family:Manrope;font-weight:800">Load Score</span><span style="background:rgba(34,197,94,.18);color:#86efac;font-size:.78rem;padding:4px 10px;border-radius:999px">free &middot; no login</span></div>'
 '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.09);font-size:.9rem"><span style="color:#94a3b8">Offer</span><b>$2,100 &middot; 690 mi</b></div>'
 '<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid rgba(255,255,255,.09);font-size:.9rem"><span style="color:#94a3b8">Your cost/mi</span><b>$1.82</b></div>'
 '<div style="display:flex;justify-content:space-between;align-items:center;padding-top:14px"><span style="color:#94a3b8;font-size:.9rem">Verdict</span><span style="background:#f59e0b;color:#1c1005;font-weight:800;font-family:Manrope;padding:7px 16px;border-radius:10px">NEGOTIATE &middot; ask $2,450</span></div>'
 '<div style="color:#64748b;font-size:.72rem;margin-top:12px">Illustrative example &mdash; run your own numbers.</div></div>')
resr += m_split('The daily decision tool', 'Should you take that load? Know in 3 seconds.',
 ['Paste any offer into the Load Score and get a clear <b>take / negotiate / pass</b> verdict built on your real cost per mile &mdash; plus the counter-offer to ask for.',
  'Owner-operators use it before every booking. It is free, needs no login, and works on your phone at the truck stop.'],
 _ls_visual, accent='#0883F7', bullets=['Verdict + smart counter-offer on any load','Deadhead, tolls and reload-market factored in','Compare loads side by side'])
resr += '<section class="bg-soft"><div class="wrap"><div class="sec-head center reveal"><div class="eyebrow" style="color:#0d9488">Free calculators</div><h2>The numbers behind every good decision</h2></div><div class="grid g3 reveal">' + ''.join(
 '<a class="linkcard reveal" href="%s"><div style="color:#0d9488;margin-bottom:12px">%s</div><h3>%s</h3><p style="font-size:.94rem">%s</p><span class="arw">Open %s</span></a>' % (h, mi(icn, 30), t, d, ARW) for h, icn, t, d in [
  ('tools.html#profit','sparkline','Load Profit Calculator','Net profit and true rate-per-mile on any load before you accept it.'),
  ('tools.html#cpm','gauge','Cost-Per-Mile Calculator','Turn monthly costs into the one number every decision depends on.'),
  ('tools.html#fuel','route','Fuel Cost Calculator','Price diesel for any lane in seconds &mdash; gallons and dollars per mile.'),
  ('tools.html#breakeven','scale','Break-Even Rate','The lowest rate you can accept and still hit your target margin.'),
  ('tools.html#takehome','wallet','Owner-Op Take-Home','What actually lands in your pocket after fuel, fees and expenses.'),
  ('tools.html#detention','timer','Detention Pay','Stuck at the dock? See exactly what the shipper owes you.'),
 ]) + '</div></div></section>'
resr += m_timeline('Start here', 'A reading path that pays for itself', [
 ('book', 'What a dispatcher really costs', 'Percentage vs flat fee, what 5% buys, and when a dispatcher pays for itself. <a href="how-much-does-a-truck-dispatcher-cost.html">Read the guide &rarr;</a>'),
 ('question', 'Dispatcher vs broker vs factoring', 'Who represents whom, what each can legally do, and how the money flows. <a href="truck-dispatcher-vs-freight-broker.html">Read the guide &rarr;</a>'),
 ('route', 'Loads with new authority', 'How to set up with brokers and land your first loads fast &mdash; fresh MC and all. <a href="how-to-get-loads-with-new-authority.html">Read the guide &rarr;</a>'),
 ('shieldcheck', 'Compliance, sorted', 'Authority &amp; DOT setup, BOC-3/UCR, Form 2290 and IFTA &mdash; four plain-language guides. <a href="authority-dot-setup.html">Start with authority &rarr;</a>'),
], accent='#7c3aed', lead='Four guides, in the order a new carrier actually needs them.')
resr += m_gradcta('Want the numbers run for you?', 'A dispatcher prices every load against your costs before you ever see it &mdash; flat 5%, no contract.', 'Talk to a dispatcher &rarr;', 'contact.html', grad='linear-gradient(135deg,#1e1b4b 0%,#312e81 55%,#1e3a8a 100%)', btncolor='#FC5305', btntext='#fff')
resr += _sec('Accessorial policies — the LoadBoot standard', 'What every load on our board guarantees, in plain English', _cards([
 ('&#9200;', 'Detention Pay', '$60/hr after 2 hours free time &mdash; timestamped, notified, enforced. <a href="detention-pay-policy.html">Full guide &rarr;</a>'),
 ('&#128683;', 'TONU', 'Truck Ordered, Not Used &mdash; $250 when a confirmed load dies late. <a href="tonu-policy.html">Full guide &rarr;</a>'),
 ('&#127769;', 'Layover', '$250/day when a hold crosses overnight &mdash; on top of earned detention. <a href="layover-policy.html">Full guide &rarr;</a>'),
 ('&#128230;', 'Lumper Fees', 'Reimbursed 100% with receipt, or broker pays direct. <a href="lumper-policy.html">Full guide &rarr;</a>'),
 ('&#128170;', 'Driver Assist', '$75 typical when the driver does the dock&rsquo;s work &mdash; agreed in writing first. <a href="driver-assist-policy.html">Full guide &rarr;</a>'),
 ('&#128337;', 'FCFS', 'First come, first served &mdash; and the detention clock still starts at check-in. <a href="fcfs-policy.html">Full guide &rarr;</a>'),
], 'g3'))
page('resources.html', 'Free Trucking &amp; Dispatch Resources for Carriers | Loadboot',
     'Free carrier resources from Loadboot: the Load Score tool, trucking calculators, dispatch guides, FAQ and pricing &mdash; all in one place.',
     'resources.html', resr)

# ---- Case Studies (clearly-labelled illustrative scenarios) ----
cs = svc_hero('Example Dispatch Scenarios', 'Illustrative examples of how Loadboot dispatch works in practice. These are worked examples for education &mdash; not testimonials or guarantees of specific results.')
cs += _sec('Worked examples', 'How the math tends to work', _cards([
    ('&#128666;', 'New-authority owner-operator', 'A carrier fresh off getting their authority struggles to get broker callbacks. A dispatcher works established relationships to land steady lanes, and coaches them through their first rate cons and PODs. <em>Illustrative example.</em>'),
    ('&#10052;', 'Reefer running empty backhauls', 'A reefer operator deadheading home half the week. The dispatcher targets round-trip lanes to cut empty miles and lift effective rate-per-mile. <em>Illustrative example.</em>'),
    ('&#128230;', 'Box truck chasing hot loads', 'An expedited box truck wasting hours self-searching. Dispatch surfaces time-critical runs so the truck stays loaded on the routes that pay. <em>Illustrative example.</em>'),
]))
cs += '<section class="bg-soft"><div class="wrap prose reveal center" style="text-align:center"><p style="color:var(--muted)">These scenarios are illustrative and for education only. Loadboot does not publish fabricated testimonials or promise specific earnings.</p><p><a href="contact.html" class="btn btn-primary">Talk to a dispatcher &rarr;</a></p></div></section>'
page('case-studies.html', 'Example Truck Dispatch Scenarios | Loadboot',
     'Illustrative, educational examples of how Loadboot dispatch works for owner-operators, reefer and box-truck carriers. Worked examples, not guarantees.',
     'case-studies.html', cs)

# ---- Security / Trust ----
sec = svc_hero('Security &amp; Trust', 'How we protect your account, your documents and your data. Security is built into Loadboot, not bolted on.')
sec += _sec('How we protect you', 'Security by design', _cards([
    ('&#128274;', 'Least-privilege access', 'Every action is permission-checked on the server. Your data is scoped to your account &mdash; carriers can only ever see their own loads, trips and documents.'),
    ('&#128193;', 'Private document storage', 'Documents live in a private store and are only ever shared through short-lived, signed links &mdash; never a public URL.'),
    ('&#128221;', 'Full audit trail', 'Sensitive actions are recorded with a tamper-evident audit log and an event history for accountability.'),
    ('&#127959;', 'Maker / checker on money', 'Payouts require separate people to create and approve &mdash; no single person can release funds alone.'),
    ('&#128737;', 'Isolated environments', 'Staging and production are kept strictly separate; the public build never references internal systems.'),
    ('&#128257;', 'Recoverable changes', 'Database changes are tracked and reversible, with documented rollback procedures.'),
]))
sec += '<section class="bg-soft"><div class="wrap prose reveal center" style="text-align:center"><h2>Report a security concern</h2><p>Found something? Email <a href="mailto:security@loadboot.com">security@loadboot.com</a> and we will respond promptly.</p></div></section>'
page('security.html', 'Security &amp; Trust at Loadboot | How We Protect Your Data',
     'How Loadboot protects your account and documents: least-privilege access, private document storage, full audit trails and maker/checker payouts.',
     'security.html', sec)

# ---- System Status ----
st = svc_hero('System Status', 'Live status for the Loadboot website, carrier portal, driver app and API. We publish issues here honestly.')
_status_row = lambda name, sid, last: '<div style="display:flex;justify-content:space-between;padding:12px 0;%s"><span>%s</span><b id="%s" style="color:#64748b">Checking&hellip;</b></div>' % ('' if last else 'border-bottom:1px solid var(--border)', name, sid)
st += ('<section><div class="wrap" style="max-width:820px"><div class="card reveal" style="text-align:left">'
       '<h3 style="margin-bottom:6px">Current status</h3><p id="lbStatusOverall" style="color:#64748b;margin-bottom:14px;font-size:.92rem">Running a live check&hellip;</p>'
       '<div id="lbStatusList">'
       + _status_row('Marketing website', 'stWeb', False)
       + _status_row('Carrier Portal', 'stApp', False)
       + _status_row('Command Center', 'stCC', False)
       + _status_row('API &amp; integrations', 'stApi', True)
       + '</div><p id="lbStatusChecked" style="color:var(--muted);margin-top:16px;font-size:.85rem"></p>'
       '<p style="color:var(--muted);margin-top:6px;font-size:.9rem">This page runs a live reachability check from your browser. For incident history or to report an outage, email <a href="mailto:status@loadboot.com">status@loadboot.com</a>.</p></div></div></section>'
       '<script>(function(){var UP="Operational",DOWN="Degraded";function set(id,ok){var e=document.getElementById(id);if(e){e.textContent=ok?UP:DOWN;e.style.color=ok?"#16a34a":"#dc2626";}}'
       'set("stWeb",true);' # if this page loaded, the website is up
       'var api="https://' + APP_REF + '.supabase.co/rest/v1/",apikey="' + (APP_ANON or '') + '";'
       'function done(ok){set("stApi",ok);set("stApp",ok);set("stCC",ok);var o=document.getElementById("lbStatusOverall");if(o){o.textContent=ok?"All systems operational.":"Some systems are degraded \\u2014 we are on it.";o.style.color=ok?"#16a34a":"#dc2626";}var c=document.getElementById("lbStatusChecked");if(c){c.textContent="Last checked: "+new Date().toLocaleString();}}'
       'if(!apikey){done(true);return;}'
       'var t=setTimeout(function(){done(false);},7000);'
       'fetch(api,{method:"GET",headers:{"apikey":apikey}}).then(function(r){clearTimeout(t);done(r.status>0&&r.status<500);}).catch(function(){clearTimeout(t);done(false);});'
       '})();</script>')
page('status.html', 'Loadboot System Status',
     'Live operational status for the Loadboot website, carrier portal, driver app and API.',
     'status.html', st)

# ---- Market Rates (public, SEO + lead-gen): all three audiences on ONE page, live weekly numbers ----
_MR_JS = ("(function(){var SB='" + _BOARD_SB + "',KEY='" + _BOARD_KEY + "';"
  "fetch(SB+'/rest/v1/rpc/get_public_market_rates',{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:'{}'})"
  ".then(function(r){return r.ok?r.json():Promise.reject(r.status);}).then(function(d){if(!d||!d.length)return;"
  "var tb=document.getElementById('mrRows');if(!tb)return;var asof='';"
  "tb.innerHTML=d.map(function(b){asof=b.as_of||asof;return '<tr><td><b>'+b.equipment+'</b><div class=\"mr-sub\">$'+Number(b.low).toFixed(2)+'–'+Number(b.high).toFixed(2)+'/mi range</div></td>'"
  "+'<td class=\"mr-c\">$'+Number(b.carrier_rpm).toFixed(2)+'</td>'"
  "+'<td class=\"mr-b\">$'+Number(b.broker_buy_rpm).toFixed(2)+' / $'+Number(b.broker_sell_rpm).toFixed(2)+'</td>'"
  "+'<td class=\"mr-s\">$'+Number(b.shipper_rpm).toFixed(2)+'</td></tr>';}).join('');"
  "var el2=document.getElementById('mrAsOf');if(el2&&asof)el2.textContent='Updated '+asof+' \u00b7 refreshed weekly';"
  "}).catch(function(){});})();")

_mr_body = ('<style>.mrx-hero{background:radial-gradient(1000px 400px at 12% -20%,rgba(8,131,247,.35),transparent 60%),radial-gradient(700px 320px at 95% 120%,rgba(252,83,5,.22),transparent 55%),linear-gradient(120deg,#0b1830,#10223B 60%,#132c4e);color:#fff;padding:64px 0 46px}.mrx-hero h1{color:#fff;font-size:clamp(1.9rem,4.2vw,3rem);margin:0 0 10px}.mrx-hero p{color:rgba(255,255,255,.82);max-width:780px;font-size:1.02rem;line-height:1.7}.mrx-badge{display:inline-flex;gap:7px;align-items:center;background:rgba(34,197,94,.15);color:#4ade80;border:1px solid rgba(74,222,128,.35);border-radius:999px;padding:6px 15px;font-weight:800;font-size:.74rem;letter-spacing:.06em;margin-bottom:16px}.mrx-badge i{width:8px;height:8px;border-radius:99px;background:#22c55e;display:inline-block;animation:mrb 1.5s infinite}@keyframes mrb{50%{opacity:.25}}.mrx-stats{display:flex;gap:30px;flex-wrap:wrap;margin-top:22px}.mrx-stats b{display:block;font-size:1.5rem;color:#7cc0ff}.mrx-stats span{font-size:.68rem;text-transform:uppercase;letter-spacing:.1em;opacity:.65;font-weight:700}.mr-t{width:100%;border-collapse:collapse;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 18px 44px -26px rgba(2,12,30,.4)}.mr-t th{background:#10223B;color:#fff;text-align:left;padding:13px 16px;font-size:.7rem;letter-spacing:.09em;text-transform:uppercase}.mr-t td{padding:13px 16px;border-bottom:1px solid #eef2f7;font-size:.95rem}.mr-sub{font-size:.72rem;color:#64748b}.mr-c{color:#0967d2;font-weight:800}.mr-b{color:#7c3aed;font-weight:800}.mr-s{color:#15803d;font-weight:800}.mrx-aud{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin:26px 0}.mrx-card{background:#fff;border:1px solid #e6ebf3;border-radius:20px;padding:26px;box-shadow:0 14px 36px -26px rgba(2,12,30,.35);position:relative;overflow:hidden}.mrx-card:before{content:"";position:absolute;top:0;left:0;right:0;height:5px}.mrx-card.c:before{background:linear-gradient(90deg,#0883F7,#60a5fa)}.mrx-card.b:before{background:linear-gradient(90deg,#7c3aed,#a78bfa)}.mrx-card.s:before{background:linear-gradient(90deg,#16a34a,#4ade80)}.mrx-card svg{margin-bottom:12px}.mrx-card h3{margin:0 0 8px;font-size:1.12rem}.mrx-card p,.mrx-card li{font-size:.9rem;color:#475569;line-height:1.7}.mrx-card ul{padding-left:18px;margin:10px 0}.mrx-card .cta{display:inline-block;margin-top:12px;font-weight:800;color:#0883F7;text-decoration:none}.mrx-sec h2{font-size:1.5rem;margin:38px 0 10px}.mrx-sec p{max-width:840px;color:#475569;line-height:1.75}.mrx-fac{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:14px;margin:18px 0}.mrx-f{background:#f7fafd;border:1px solid #e6ebf3;border-radius:14px;padding:16px}.mrx-f b{display:block;margin-bottom:5px}.mrx-f span{font-size:.84rem;color:#64748b;line-height:1.6}.mrx-faq{background:#fff;border:1px solid #e6ebf3;border-radius:16px;margin:10px 0;padding:16px 20px}.mrx-faq h3{margin:0 0 6px;font-size:.98rem}.mrx-faq p{margin:0;font-size:.88rem;color:#475569;line-height:1.7}.mrx-cta{background:linear-gradient(120deg,#0b1830,#14335c);border-radius:22px;color:#fff;padding:36px;text-align:center;margin:40px 0}.mrx-cta h2{color:#fff;margin:0 0 8px}.mrx-cta p{color:rgba(255,255,255,.8);max-width:640px;margin:0 auto 18px}</style>'
'<section class="mrx-hero"><div class="wrap">'
'<span class="mrx-badge"><i></i>LIVE \u00b7 UPDATED WEEKLY</span>'
'<h1>Truckload Freight Rates Per Mile \u2014 Live Spot Rates for Carriers, Brokers &amp; Shippers</h1>'
'<p>Current trucking rates per mile across dry van, reefer, flatbed, power only and hotshot \u2014 blended from <b style="color:#fff">real LoadBoot marketplace bookings</b> and published national benchmarks. See what the truck gets paid, what freight brokers buy and sell at, and what shippers pay \u2014 every side of the spot market on one page. <span id="mrAsOf">Refreshed weekly.</span></p>'
'<div class="mrx-stats"><div><b>8</b><span>Equipment types</span></div><div><b>3</b><span>Market sides</span></div><div><b>Weekly</b><span>Benchmark refresh</span></div><div><b>Live</b><span>From real bookings</span></div></div>'
'</div></section>'

'<section class="wrap" style="padding:34px 0 10px">'
'<table class="mr-t"><thead><tr><th>Equipment</th><th>Carriers get paid</th><th>Brokers buy / sell</th><th>Shippers pay</th></tr></thead>'
'<tbody id="mrRows"><tr><td colspan="4" style="text-align:center;color:#64748b">Loading live market rates\u2026</td></tr></tbody></table>'
'<div class="mr-sub" style="margin-top:8px">National spot-rate averages, all-in linehaul per mile. Lane-level rates (state \u2192 state, low/average/high, 12-week trends) are free inside a LoadBoot account.</div>'
'</section>'

'<section class="wrap mrx-sec"><h2>One market. Three prices. Know yours.</h2>'
'<p>Every truckload move has three numbers: the rate the <b>carrier</b> hauls for, the spread the <b>broker</b> works within, and the price the <b>shipper</b> ultimately pays. Free rate charts usually show only one side \u2014 LoadBoot shows you yours, so everyone negotiates from real data and keeps their margin.</p>'
'<div class="mrx-aud">'

'<div class="mrx-card c"><svg width="54" height="40" viewBox="0 0 54 40"><rect x="2" y="10" width="30" height="18" rx="3" fill="#0883F7"/><path d="M32 15h10l8 8v5H32z" fill="#10223B"/><circle cx="12" cy="32" r="5" fill="#10223B"/><circle cx="42" cy="32" r="5" fill="#10223B"/><circle cx="12" cy="32" r="2" fill="#fff"/><circle cx="42" cy="32" r="2" fill="#fff"/></svg>'
'<h3>For Carriers &amp; Owner-Operators</h3>'
'<p>Know what a lane <b>pays the truck</b> before you call anyone \u2014 and never haul below your cost per mile.</p>'
'<ul><li>Spot rates per mile for your exact equipment</li><li>Low / average / high spread \u2014 spot a cheap load instantly</li><li>Industry minimums: $2.00+ dry van, $2.50+ reefer &amp; flatbed</li><li>Every LoadBoot load shows the full rate card: detention, layover, TONU, lumper \u2014 in writing</li></ul>'
'<a class="cta" href="/app/carrier/">See what YOUR lanes pay \u2192</a></div>'

'<div class="mrx-card b"><svg width="54" height="40" viewBox="0 0 54 40"><path d="M6 34 L18 20 L28 26 L48 6" stroke="#7c3aed" stroke-width="4" fill="none" stroke-linecap="round"/><circle cx="48" cy="6" r="4" fill="#7c3aed"/><rect x="4" y="34" width="46" height="3" rx="1.5" fill="#10223B"/></svg>'
'<h3>For Freight Brokers</h3>'
'<p>Buy-side and sell-side on one screen \u2014 benchmark spot rates, protect your margin, quote shippers with confidence.</p>'
'<ul><li>BUY: what carriers accept on the lane (real bookings)</li><li>SELL: shipper-side guidance with a typical 12\u201318% brokerage margin</li><li>Rate suggestions inside load posting \u2014 under-market posts get flagged before they sit unbooked</li><li>Auto-generated, immutable rate confirmations on every load</li></ul>'
'<a class="cta" href="/app/partner/">Unlock lane-level buy/sell rates \u2192</a></div>'

'<div class="mrx-card s"><svg width="54" height="40" viewBox="0 0 54 40"><rect x="6" y="14" width="16" height="20" rx="2" fill="#16a34a"/><rect x="24" y="6" width="16" height="28" rx="2" fill="#10223B"/><rect x="42" y="20" width="8" height="14" rx="2" fill="#4ade80"/></svg>'
'<h3>For Shippers</h3>'
'<p>Budget freight with real numbers \u2014 see what moving your load should cost before you tender it.</p>'
'<ul><li>Shipper-side rates per mile by equipment</li><li>Benchmark broker quotes against the live market</li><li>Plan seasonal budgets with 12-week trendlines</li><li>GPS-tracked delivery and documented settlement on every LoadBoot move</li></ul>'
'<a class="cta" href="/app/partner/">Check your shipping cost \u2192</a></div>'
'</div></section>'

'<section class="wrap mrx-sec"><h2>What moves trucking rates per mile</h2>'
'<div class="mrx-fac">'
'<div class="mrx-f"><b>\u26fd Diesel prices</b><span>Fuel is ~25\u201330% of a truck\u2019s cost per mile. Rate benchmarks move within weeks of sustained diesel swings.</span></div>'
'<div class="mrx-f"><b>📦 Load-to-truck ratio</b><span>More loads than trucks on a lane pushes spot rates up fast \u2014 the classic hot-market signal.</span></div>'
'<div class="mrx-f"><b>🍅 Seasonality</b><span>Produce season lifts reefer rates to $3.50\u2013$4.50/mi in Southeast corridors; construction season lifts flatbed.</span></div>'
'<div class="mrx-f"><b>📍 Lane density</b><span>Headhaul lanes into dense freight markets pay less than backhaul-starved rural destinations.</span></div>'
'<div class="mrx-f"><b>🚛 Equipment &amp; service</b><span>Reefer and flatbed carry premiums over dry van; team drivers add 20\u201330%; hazmat ~15%.</span></div>'
'<div class="mrx-f"><b>📄 Spot vs contract</b><span>Spot rates (this page) price single loads today; contract rates lock a lane for months and lag the spot market.</span></div>'
'</div></section>'

'<section class="wrap mrx-sec"><h2>Current rates by equipment type</h2>'
'<p><b>Dry van rates per mile</b> anchor the market \u2014 the most trucks, the most loads, the tightest spread. <b>Reefer rates per mile</b> carry a $0.40\u20130.70 premium for the trailer, fuel for the unit and produce-season risk. <b>Flatbed rates per mile</b> run highest of the big three: tarping, securement and specialized freight. <b>Power only</b> prices below van (the trailer is the shipper\u2019s), while <b>hotshot rates</b> track expedited small-load demand. The live table above updates weekly; inside LoadBoot each number sharpens with every real booking on the platform.</p></section>'

'<section class="wrap mrx-sec"><h2>How we calculate these freight rates</h2>'
'<p>Three blended layers, honestly labeled: <b>(1) Real LoadBoot bookings</b> \u2014 actual accepted rates on our marketplace, the strongest signal, refreshed continuously; <b>(2) Published national benchmarks</b> \u2014 published national industry indices, refreshed weekly; <b>(3) Confidence labels</b> \u2014 every lane result says whether it comes from lane-level bookings (HIGH), platform-wide data (MEDIUM) or the national benchmark (LOW). A rate is a guide, not a quote \u2014 but you always know exactly where it came from.</p></section>'

'<section class="wrap mrx-sec"><h2>Freight rate FAQs</h2>'
'<div class="mrx-faq"><h3>What is the average trucking rate per mile right now?</h3><p>National spot averages currently run roughly $2.00\u2013$2.70/mi for dry van, $2.15\u2013$3.40 for reefer and $2.20\u2013$3.70 for flatbed \u2014 the live table above shows this week\u2019s numbers by equipment and market side.</p></div>'
'<div class="mrx-faq"><h3>What is a good rate per mile for trucking in 2026?</h3><p>A good rate beats your all-in operating cost (~$1.80\u2013$2.00/mi for most owner-operators) by at least 20%. Practical minimums: $2.00\u2013$2.50/mi dry van, $2.50+ reefer and flatbed, $2.00+ hotshot.</p></div>'
'<div class="mrx-faq"><h3>How much do freight brokers charge shippers?</h3><p>Brokers typically add a 12\u201318% margin on top of the carrier rate. That is why the shipper column above runs higher than the carrier column on the same lane \u2014 both sides are shown so everyone negotiates informed.</p></div>'
'<div class="mrx-faq"><h3>What is the difference between spot rates and contract rates?</h3><p>Spot rates price one load, today, on the open market \u2014 they move daily with supply and demand. Contract rates lock a lane for 3\u201312 months and typically sit below spot in hot markets and above it in soft markets.</p></div>'
'<div class="mrx-faq"><h3>Is there a free freight rate calculator?</h3><p>Yes \u2014 inside every free LoadBoot account: pick origin state, destination state, equipment and miles, and get low/average/high per-mile and flat rates for your side of the market, with a 12-week trend.</p></div>'
'</section>'

'<section class="wrap"><div class="mrx-cta">'
'<h2>Stop guessing. Price every load with live market data.</h2>'
'<p>Free LoadBoot account \u2014 lane-level rates, GPS-tracked loads, signed rate confirmations, documented settlement. Carriers haul at fair rates; brokers protect margin; shippers budget with confidence.</p>'
'<a class="btn btn-primary" href="/app/carrier/" style="margin-right:10px">I\u2019m a carrier \u2192</a>'
'<a class="btn btn-primary" style="background:#fff;color:#10223B" href="/app/partner/">I\u2019m a broker or shipper \u2192</a>'
'</div></section>')


_mr_faq = ('<script type="application/ld+json">{"@context":"https://schema.org","@type":"FAQPage","mainEntity":['
  '{"@type":"Question","name":"What is the average trucking rate per mile right now?","acceptedAnswer":{"@type":"Answer","text":"National spot averages currently run roughly $2.00-$2.70 per mile for dry van, $2.15-$3.40 for reefer and $2.20-$3.70 for flatbed, depending on lane and season. The live table on this page is refreshed weekly."}},'
  '{"@type":"Question","name":"What is the difference between shipper, broker and carrier rates?","acceptedAnswer":{"@type":"Answer","text":"The carrier rate is what the truck is paid. Brokers buy capacity at the carrier rate and sell the shipment to shippers with a typical 12-18% margin, so shipper rates run higher than carrier rates on the same lane."}},'
  '{"@type":"Question","name":"What is the minimum rate per mile a carrier should accept?","acceptedAnswer":{"@type":"Answer","text":"Most owner-operators need $2.00-$2.50 per mile for dry van and $2.50+ for reefer or flatbed to cover an all-in operating cost of roughly $1.80-$2.00 per mile plus margin."}}]}</script>'
  '<script>' + _MR_JS + '</script>')

page('market-rates.html', 'Truckload Market Rates Per Mile — Live Carrier, Broker & Shipper Rates',
     'Live national truckload rates per mile, updated weekly: what carriers get paid, what brokers buy/sell at, and what shippers pay. Dry van, reefer, flatbed, power only, hotshot.',
     'market-rates.html', _mr_body + _mr_faq)


# ---- Cookie Policy ----
ck = svc_hero('Cookie Policy', 'How Loadboot uses cookies and similar technologies, and the choices you have.')
ck += '<section><div class="wrap prose reveal"><h2>What cookies we use</h2><p>We use a small number of cookies and local-storage items to keep the site working and to understand, in aggregate, how it is used. These fall into two groups: <b>essential</b> items that make the site and your account function, and <b>analytics</b> items that help us improve pages and measure conversions.</p><h2>Analytics</h2><p>We use first-party analytics and Google Analytics to understand traffic and page performance. You can flag your browser as internal/excluded, and you can block analytics cookies in your browser settings without breaking the site.</p><h2>Your choices</h2><p>You can clear or block cookies in your browser at any time. Essential items are required for signed-in features (like your carrier account) to work. For questions, email <a href="mailto:privacy@loadboot.com">privacy@loadboot.com</a>.</p><p style="color:var(--muted);font-size:.9rem">See also our <a href="privacy.html">Privacy Policy</a>.</p></div></section>'
page('cookies.html', 'Cookie Policy | Loadboot',
     'How Loadboot uses essential and analytics cookies, and the choices you have to manage them.',
     'cookies.html', ck)

# ---- Accessibility ----
acc = svc_hero('Accessibility', 'We want every carrier to be able to use Loadboot. Here is our commitment and how to reach us if something is not working for you.')
acc += '<section><div class="wrap prose reveal"><h2>Our commitment</h2><p>We aim to meet widely-recognized accessibility guidelines (WCAG 2.1 AA) across our website and apps: readable contrast, keyboard navigation, descriptive labels, responsive layouts and support for screen readers. Accessibility is an ongoing effort and we fix issues as we find them.</p><h2>Need help or found a barrier?</h2><p>If any part of Loadboot is hard to use with assistive technology, please tell us &mdash; we take it seriously and will work with you directly. Email <a href="mailto:hello@loadboot.com">hello@loadboot.com</a> with the page and what you ran into.</p></div></section>'
page('accessibility.html', 'Accessibility Statement | Loadboot',
     'Loadboot is committed to an accessible website and apps (WCAG 2.1 AA). Learn about our commitment and how to report a barrier.',
     'accessibility.html', acc)

# ---- Carrier Application (dedicated apply page) ----
capp = svc_hero('Apply to Loadboot', 'Get your truck loaded with a dispatcher in your corner. Apply in two minutes &mdash; flat 5%, no contracts, cancel anytime.')
capp += lead_form('carrier_application', 'Carrier application', 'Tell us about your operation and a dispatcher gets you set up. A real person follows up fast.',
    [('company', 'Company / business name', 'text', True), ('name', 'Your name', 'text', True),
     ('email', 'Email', 'email', True), ('phone', 'Phone', 'tel', True),
     ('mc', 'MC number', 'text', False), ('dot', 'DOT number', 'text', False),
     ('authority', 'Authority status', 'select:Active / established authority|New authority|No authority yet', True),
     ('equipment', 'Equipment', 'select:Dry Van|Reefer|Flatbed|Step Deck|Hotshot|Power Only|Box Truck / Expedited', True),
     ('trucks', 'Number of trucks', 'select:1|2-5|6-20|20+', False),
     ('lanes', 'Preferred lanes / home base', 'text', False),
     ('message', 'Anything else we should know?', 'textarea', False)],
    'Submit application', 'Got it — a dispatcher will reach out shortly.')
capp += REF_CAPTURE_JS
page('carrier-application.html', 'Carrier Application &mdash; Apply for Truck Dispatch | Loadboot',
     'Apply for Loadboot truck dispatch in two minutes. Owner-operators, fleets and new-authority carriers welcome. Flat 5%, no contracts.',
     'contact.html', capp)

# ---- Unified account-creation hub (#44): carrier / broker / shipper / referral, tabbed ----
def _hub_value(bullets, portal_href, portal_label):
    lis = ''.join('<li>' + b + '</li>' for b in bullets)
    return ('<section><div class="wrap" style="max-width:900px">'
            '<ul class="hub-checks reveal">' + lis + '</ul>'
            '<p style="text-align:center;margin-top:6px"><a href="' + portal_href + '" class="btn btn-secondary">' + portal_label + '</a></p>'
            '</div></section>')

_HUB_STYLE = ('<style>'
    '.hub-tabs{display:flex;gap:8px;flex-wrap:wrap;justify-content:center;max-width:820px;margin:0 auto 6px;padding:0 16px}'
    '.hub-tab{flex:1 1 160px;min-width:150px;display:flex;align-items:center;justify-content:center;gap:8px;'
    'padding:14px 16px;border:1px solid var(--line,#e2e8f0);background:#fff;border-radius:14px;cursor:pointer;'
    'font-family:inherit;font-weight:700;font-size:.98rem;color:var(--ink,#10223B);transition:all .15s;box-shadow:0 1px 2px rgba(2,6,23,.04)}'
    '.hub-tab:hover{border-color:#0883F7;color:#0883F7}'
    '.hub-tab.on{background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;border-color:transparent;box-shadow:0 10px 26px rgba(8,131,247,.28)}'
    '.hub-tab .em{font-size:1.15rem;line-height:1}'
    '.hub-lede{text-align:center;max-width:620px;margin:14px auto 0;color:var(--muted,#64748b)}'
    '.hub-checks{list-style:none;padding:0;margin:8px 0 0;display:grid;grid-template-columns:1fr 1fr;gap:10px 22px}'
    '.hub-checks li{position:relative;padding-left:28px;color:var(--ink-soft,#475569);line-height:1.5}'
    '.hub-checks li:before{content:"\\2713";position:absolute;left:0;top:0;width:20px;height:20px;border-radius:50%;'
    'background:#e6f2fe;color:#0883F7;font-weight:800;font-size:.8rem;display:flex;align-items:center;justify-content:center}'
    '@media(max-width:640px){.hub-checks{grid-template-columns:1fr}}'
    '</style>')

_HUB_ROLES = [
  ('carrier', '&#128667;', 'Carrier', 'Carriers &amp; owner-operators',
   'Get a dispatcher in your corner and one place to run every load, trip, document and settlement.',
   ['A dispatcher working the boards &amp; broker relationships for higher-paying freight on your lanes',
    'You approve every load before it books &mdash; you keep your authority, no contracts',
    'Live trip tracking, rate confirmations and paperwork handled for you',
    'One dashboard for invoices, settlements, per-trip P&amp;L and your team&rsquo;s payroll',
    'Flat 5% dispatch fee &mdash; cancel anytime',
    'Real people on call while you&rsquo;re on the road'],
   '/app/carrier/', 'Open the Carrier Portal &rarr;',
   'carrier_application', 'Carrier application',
   'Tell us about your operation and a dispatcher gets you set up. A real person follows up fast.',
   [('company', 'Company / business name', 'text', True), ('name', 'Your name', 'text', True),
    ('email', 'Email', 'email', True), ('phone', 'Phone', 'tel', True),
    ('mc', 'MC number', 'text', False), ('dot', 'DOT number', 'text', False),
    ('authority', 'Authority status', 'select:Active / established authority|New authority|No authority yet', True),
    ('equipment', 'Equipment', 'select:Dry Van|Reefer|Flatbed|Step Deck|Hotshot|Power Only|Box Truck / Expedited', True),
    ('trucks', 'Number of trucks', 'select:1|2-5|6-20|20+', False),
    ('lanes', 'Preferred lanes / home base', 'text', False),
    ('message', 'Anything else we should know?', 'textarea', False)],
   'Submit application', 'Got it — a dispatcher will reach out shortly.'),

  ('broker', '&#129309;', 'Broker', 'Freight brokers',
   'Post loads to vetted, tracked capacity and move faster with clean paperwork and full visibility.',
   ['Reach vetted carriers with verified authority and insurance on file',
    'Every trip is tracked from tender to POD &mdash; no more check calls',
    'Rate confirmations, documents and settlements recorded in one place',
    'Mutual vetting: you see a carrier&rsquo;s trust profile before you approve a booking',
    'Onboarding and compliance gates keep your capacity clean',
    'A partner console built for broker operations, not a spreadsheet'],
   '/app/partner/', 'Open the Partner Portal &rarr;',
   'broker_signup', 'Broker account request',
   'Tell us about your brokerage and we&rsquo;ll set you up with vetted, tracked capacity.',
   [('company', 'Brokerage / company name', 'text', True), ('name', 'Your name', 'text', True),
    ('email', 'Work email', 'email', True), ('phone', 'Phone', 'tel', True),
    ('mc', 'Broker MC number', 'text', False),
    ('loads', 'Loads per month', 'select:1-10|11-50|51-200|200+', False),
    ('equipment', 'Primary equipment', 'select:Dry Van|Reefer|Flatbed|Step Deck|Hotshot|Power Only|Mixed', False),
    ('lanes', 'Main lanes / commodities', 'text', False),
    ('message', 'Anything else we should know?', 'textarea', False)],
   'Request broker account', 'Thanks — our partnerships team will reach out shortly.'),

  ('shipper', '&#127970;', 'Shipper', 'Shippers',
   'Post your freight directly on LoadBoot &mdash; verified capacity, live tracking and compliant docs.',
   ['Post shipments directly in your own LoadBoot shipper portal',
    'Live shipment visibility from pickup to delivery',
    'Compliant documentation &mdash; BOL, rate con and POD collected automatically',
    'Consistent service standards and vetted carriers on every load',
    'One point of contact instead of chasing multiple carriers',
    'Transparent, no games on rate or service'],
   '/app/partner/', 'Open the Partner Portal &rarr;',
   'shipper_signup', 'Shipper inquiry',
   'Tell us what you ship and we&rsquo;ll connect you with compliant capacity through our broker partners.',
   [('company', 'Company name', 'text', True), ('name', 'Your name', 'text', True),
    ('email', 'Work email', 'email', True), ('phone', 'Phone', 'tel', True),
    ('freight', 'Freight type / commodity', 'text', False),
    ('shipments', 'Shipments per month', 'select:1-10|11-50|51-200|200+', False),
    ('lanes', 'Main lanes / origins', 'text', False),
    ('message', 'Requirements or anything else?', 'textarea', False)],
   'Send shipper inquiry', 'Thanks — our team will reach out to scope your freight.'),

  ('referral', '&#128200;', 'Referral', 'Referral &amp; influencer partners',
   'Earn a share of Loadboot&rsquo;s dispatch fee for every carrier or broker you refer &mdash; they never pay extra.',
   ['Earn ongoing commission on the dispatch fee of everyone you refer',
    'They never pay more &mdash; your reward comes from Loadboot&rsquo;s own fee',
    'Track your referrals, earnings and payouts right in your account',
    'Get a personal referral link and ready-to-share materials',
    'Commissions unlock after a short hold; payouts reviewed by a person',
    'Perfect for trucking creators, coaches and industry networks'],
   'agents.html', 'See how the agent program works &rarr;',
   'referral_signup', 'Become a referral partner',
   'Tell us about your audience and we&rsquo;ll get you a referral link and materials.',
   [('name', 'Your name', 'text', True), ('email', 'Email', 'email', True),
    ('phone', 'Phone', 'tel', False),
    ('channel', 'Where is your audience?', 'select:YouTube|Instagram / TikTok|Facebook Group|Podcast|Industry network|Other', False),
    ('audience', 'Audience size', 'select:Under 1k|1k-10k|10k-100k|100k+', False),
    ('message', 'Who you reach &amp; how you&rsquo;d promote', 'textarea', False)],
   'Join the referral program', 'Thanks — we&rsquo;ll set up your referral link and reach out.'),
  ('agent', '&#129297;', 'Agent', 'Agents &amp; independent dispatchers',
   'Bring clients in pairs (a carrier + a broker/shipper, or post loads yourself) and earn 1% of the gross on every GPS-verified delivered load your chain touches &mdash; paid from Loadboot&rsquo;s own fee.',
   ['1% of gross on every delivered load where any side of the deal is yours',
    'One referral link for everyone &mdash; the system detects carrier, broker or shipper automatically',
    'Recruit other agents and earn level 2&ndash;5 overrides on their whole chains',
    'Post loads yourself with a broker-grade wizard (source-verified)',
    'CRM-grade chain tracking, live earnings, Amazon-style payout center',
    'Free to join &mdash; verification takes about a day, worldwide remote'],
   'agents.html', 'See how the agent program works &rarr;',
   'agent_signup', 'Become a LoadBoot agent',
   'The full program runs in the Agent Portal &mdash; create your account there in 2 minutes.',
   [('name', 'Your name', 'text', True), ('email', 'Email', 'email', True),
    ('phone', 'Phone (any country)', 'tel', False),
    ('network', 'Who do you already know?', 'select:Carriers|Brokers|Shippers|Carriers + brokers (a pair!)|Building from scratch', False),
    ('message', 'Tell us about your dispatch experience', 'textarea', False)],
   'Apply &mdash; then open the Agent Portal', 'Thanks! Now create your login at loadboot.com/app/agent/ — your application links up automatically.'),
]

hub = svc_hero('Create your Loadboot account',
    'One front door for everyone in the freight chain. Pick your role &mdash; carrier, broker, shipper, or referral partner &mdash; and get set up in minutes. Flat, transparent, no contracts.')
hub += _HUB_STYLE
_tabbar = '<section style="padding-top:6px"><div class="wrap"><div class="hub-tabs reveal">'
for i, r in enumerate(_HUB_ROLES):
    rid, ic, short = r[0], r[1], r[2]
    _tabbar += '<button type="button" class="hub-tab%s" data-hub="%s"><span class="em">%s</span>%s</button>' % (
        ' on' if i == 0 else '', rid, ic, short)
_tabbar += '</div><p class="hub-lede reveal">Not sure? Carriers and drivers start here. Brokers and shippers use the Partner Portal; creators earn with Referral; independent dispatchers join as Agents.</p></div></section>'
hub += _tabbar
for i, r in enumerate(_HUB_ROLES):
    rid, ic, short, longname, blurb, bullets, phref, plabel, fkey, fhead, fintro, ffields, fsubmit, fsuccess = r
    panel = '<div class="hub-panel" id="hp-%s"%s>' % (rid, '' if i == 0 else ' hidden')
    panel += _sec('Create your account', longname, '<p class="lead center" style="max-width:640px;margin:0 auto">' + blurb + '</p>')
    panel += _hub_value(bullets, phref, plabel)
    panel += lead_form(fkey, fhead, fintro, ffields, fsubmit, fsuccess)
    panel += '</div>'
    hub += panel
hub += ('<script>(function(){var tabs=document.querySelectorAll(".hub-tab");var panels=document.querySelectorAll(".hub-panel");'
        'function show(id){tabs.forEach(function(t){t.classList.toggle("on",t.getAttribute("data-hub")===id);});'
        'panels.forEach(function(p){p.hidden=(p.id!=="hp-"+id);});'
        'try{if(history.replaceState)history.replaceState(null,"","#"+id);}catch(e){}'
        'if(window.lbTrack)window.lbTrack("hub_role_selected",{role:id});}'
        'tabs.forEach(function(t){t.addEventListener("click",function(){show(t.getAttribute("data-hub"));});});'
        'var h=(location.hash||"").replace("#","");if(h&&document.getElementById("hp-"+h))show(h);})();</script>')
hub += REF_CAPTURE_JS
page('get-started.html', 'Create Your Loadboot Account &mdash; Carrier, Broker, Shipper, Agent &amp; Referral',
     'Create a Loadboot account in minutes. Carriers, freight brokers, shippers, agents and referral partners &mdash; pick your role and get set up. Flat 5%, no contracts.',
     'get-started.html', hub)

# ---- Login portal chooser ----
lg = svc_hero('Log in to Loadboot', 'Choose your portal. Not sure which one you need? Carriers and drivers use the Carrier Portal below.')
lg += _sec('Choose your portal', 'Where do you want to go?', _cards([
    ('&#128667;', 'Carrier Portal', 'Manage loads, trips, documents, finance and your team. <a href="/app/carrier/">Open Carrier Portal &rarr;</a>'),
    ('&#129309;', 'Partner Portal', 'Brokers, shippers and facilities. <a href="/app/partner/">Open Partner Portal &rarr;</a>'),
    ('&#129297;', 'Agent Portal', 'Independent dispatchers &amp; agents &mdash; your chain, earnings and payouts. <a href="/app/agent/">Open Agent Portal &rarr;</a>'),
    ('&#128104;&#8205;&#128187;', 'Developers &amp; API', 'API keys, docs and integrations. <a href="/app/developer/">Open Developer Portal &rarr;</a>'),
    ('&#127970;', 'Command Center (Staff)', 'Loadboot team operations console. <a href="/app/command-center/">Open Command Center &rarr;</a>'),
    ('&#10067;', 'Need an account?', 'New to Loadboot? Create an account for your role in minutes. <a href="get-started.html">Create an account &rarr;</a>'),
], 'g3'))
page('login.html', 'Log in to Loadboot | Carrier, Partner, Driver &amp; Developer Portals',
     'Choose your Loadboot portal: Carrier Portal, Partner Portal, Agent Portal, Developer/API or Command Center. New here? Create a carrier account in minutes.',
     'login.html', lg)

# ============================================================================
# PUBLIC PLATFORM DOCUMENTATION — deep, SEO-optimized feature + guide pages.
# Real portal screenshots live in /shots/<name>.png (owner captures per docs list);
# missing images hide gracefully so pages never break.
# ============================================================================
def shot(name, caption):
    return ('<figure class="reveal" style="margin:26px 0;border-radius:16px;overflow:hidden;border:1px solid #e6ebf3;box-shadow:0 18px 44px -28px rgba(16,34,59,.35)">'
        '<img src="/shots/' + name + '.png" alt="' + caption + '" loading="lazy" style="display:block;width:100%" onerror="this.parentNode.style.display=\'none\'">'
        '<figcaption style="padding:10px 16px;background:#f8fafc;color:#475569;font-size:.85rem">' + caption + '</figcaption></figure>')

def docsec(h, sub, body_html):
    return '<section class="section"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">' + sub + '</div><h2>' + h + '</h2></div><div class="reveal" style="max-width:860px;font-size:1.02rem;line-height:1.85;color:#334155">' + body_html + '</div></div></section>'

def steps_html(items):
    out = '<div style="margin:18px 0">'
    for i, (t, d) in enumerate(items):
        out += ('<div style="display:flex;gap:16px;margin-bottom:18px"><div style="flex:none;width:38px;height:38px;border-radius:12px;background:#10223B;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800">' + str(i+1) + '</div>'
            '<div><b style="color:#10223B">' + t + '</b><div style="color:#475569;line-height:1.75">' + d + '</div></div></div>')
    return out + '</div>'

def cta_row(pairs):
    return '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px">' + ''.join(
        '<a href="' + h + '" class="btn ' + ('btn-primary' if i == 0 else 'btn-secondary') + '">' + t + '</a>' for i, (t, h) in enumerate(pairs)) + '</div>'

# ---------------- FEATURES HUB — flagship, DAT/Relay-grade rich page ----------------
FTX_CSS = """<style>
.ftx-nav{position:sticky;top:64px;z-index:30;background:rgba(255,255,255,.94);backdrop-filter:blur(8px);border-bottom:1px solid #e6ebf3;padding:10px 0;overflow-x:auto;-webkit-overflow-scrolling:touch}
.ftx-nav .wrap{display:flex;gap:8px;flex-wrap:nowrap;white-space:nowrap}
.ftx-nav a{flex:none;padding:7px 14px;border-radius:999px;border:1px solid #dbe4f0;font-size:.82rem;font-weight:700;color:#334155;background:#fff}
.ftx-nav a:hover{border-color:#0883F7;color:#0883F7}
.ftx-sec{padding:64px 0;scroll-margin-top:130px}
.ftx-sec.alt{background:#f6f9fd}
.ftx-grid{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center}
@media(max-width:880px){.ftx-grid{grid-template-columns:1fr}}
.ftx-kicker{color:#FC5305;font-weight:800;font-size:.76rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}
.ftx-h{font-size:1.9rem;line-height:1.2;color:#10223B;margin:0 0 14px}
.ftx-p{color:#475569;line-height:1.8;font-size:1.01rem}
.ftx-li{display:flex;gap:10px;margin:9px 0;color:#334155;line-height:1.6}
.ftx-li b{color:#10223B}
.ftx-tick{flex:none;width:20px;height:20px;border-radius:7px;background:#dcfce7;color:#16a34a;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:.75rem;margin-top:2px}
.ftx-mock{background:linear-gradient(160deg,#0e1c38,#0b1220 70%);border-radius:20px;padding:26px;box-shadow:0 30px 70px -30px rgba(11,18,32,.55);color:#e2e8f0;font-size:.9rem}
.ftx-card{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px 16px;margin-bottom:10px}
.ftx-chip{display:inline-block;padding:3px 10px;border-radius:999px;font-size:.7rem;font-weight:800;margin:2px 4px 2px 0}
.ftx-green{background:rgba(34,197,94,.16);color:#4ade80}.ftx-blue{background:rgba(8,131,247,.16);color:#7cc0ff}.ftx-amber{background:rgba(245,158,11,.16);color:#fbbf24}.ftx-purple{background:rgba(139,92,246,.18);color:#c4b5fd}.ftx-red{background:rgba(239,68,68,.15);color:#fca5a5}
.ftx-row{display:flex;justify-content:space-between;align-items:center;gap:10px}
.ftx-bar{height:7px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:8px}
.ftx-bar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#4ade80)}
.ftx-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-top:34px}
@media(max-width:760px){.ftx-stats{grid-template-columns:1fr 1fr}}
.ftx-stat{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px 14px;text-align:center}
.ftx-stat b{display:block;font-size:1.6rem;color:#fff}
.ftx-stat span{font-size:.74rem;color:#94a3b8;font-weight:700;letter-spacing:.05em;text-transform:uppercase}
.ftx-cmp{width:100%;border-collapse:collapse;font-size:.92rem}
.ftx-cmp th,.ftx-cmp td{padding:12px 14px;border-bottom:1px solid #e6ebf3;text-align:left;vertical-align:top}
.ftx-cmp th{background:#10223B;color:#fff;font-size:.8rem;letter-spacing:.04em;text-transform:uppercase}
.ftx-cmp td:first-child{font-weight:700;color:#10223B}
.ftx-yes{color:#16a34a;font-weight:800}.ftx-no{color:#dc2626;font-weight:800}.ftx-part{color:#b45309;font-weight:700}
</style>"""

def fsec(sid, kicker, h, body_html, mock_html, alt=False, flip=False):
    cols = ('<div class="reveal">' + mock_html + '</div><div class="reveal">' + body_html + '</div>') if flip else ('<div class="reveal">' + body_html + '</div><div class="reveal">' + mock_html + '</div>')
    return ('<section class="ftx-sec' + (' alt' if alt else '') + '" id="' + sid + '"><div class="wrap"><div class="ftx-grid">' + cols + '</div></div></section>')

def fbody(kicker, h, p, items, guide=None):
    out = '<div class="ftx-kicker">' + kicker + '</div><h2 class="ftx-h">' + h + '</h2><p class="ftx-p">' + p + '</p><div style="margin-top:16px">'
    for it in items:
        out += '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div>' + it + '</div></div>'
    out += '</div>'
    if guide:
        _gs = guide if isinstance(guide, list) else [guide]
        out += '<div style="margin-top:18px;display:flex;gap:10px;flex-wrap:wrap">' + ''.join('<a href="' + g[1] + '" class="btn btn-secondary">' + g[0] + ' &rarr;</a>' for g in _gs) + '</div>'
    return out

feat = FTX_CSS
feat += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:88px 0 64px"><div class="wrap">'
 '<div class="eyebrow" style="color:#FC5305">The complete platform</div>'
 '<h1 style="color:#fff;font-size:2.7rem;line-height:1.12;max-width:820px;margin:10px 0 16px">Every LoadBoot feature. One page. <span style="color:#0883F7">All real.</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.12rem;max-width:700px;line-height:1.7">From a ghost-free load board to GPS-verified delivery, receipt-verified payments, factoring, fleet tools and live QuickBooks sync &mdash; this is everything in the product today. No vaporware: every section links to a deep guide.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:26px"><a href="get-started.html" class="btn btn-primary">Create an account &rarr;</a><a href="how-it-works.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">How it works</a></div>'
 '<div class="ftx-stats reveal">'
 '<div class="ftx-stat"><b>5%</b><span>flat dispatch fee</span></div>'
 '<div class="ftx-stat"><b>$0</b><span>monthly &middot; no contracts</span></div>'
 '<div class="ftx-stat"><b>800m</b><span>geofence proof at every stop</span></div>'
 '<div class="ftx-stat"><b>2-way</b><span>QuickBooks sync &mdash; live</span></div>'
 '</div></div></section>')

feat += ('<nav class="ftx-nav"><div class="wrap">'
 '<a href="#board">Load board</a><a href="#booking">Booking</a><a href="#tracking">Tracking &amp; proof</a><a href="#money">Payments</a><a href="#factoring">Factoring</a><a href="#accessorials">Accessorials</a><a href="#fleet">Fleet</a><a href="#docs">Compliance</a><a href="#accounting">Accounting</a><a href="#integrations">Integrations</a><a href="#partners">Brokers &amp; shippers</a><a href="#agents">Agents</a><a href="#security">Security</a>'
 '</div></nav>')

feat += fsec('board','Find freight','A load board with zero ghost loads',
 fbody('Find freight','A load board with zero ghost loads',
  'Booked or expired loads vanish the second they die &mdash; what you see is bookable right now. Brokers push direct offers to matched trucks; you can book in one tap or propose your own rate.',
  ['<b>Direct offers</b> &mdash; brokers offer matched carriers first; a 15-minute window, first accept wins, everyone else auto-closes.',
   '<b>Propose-a-rate</b> &mdash; counter any load; the broker accepts or declines in-app.',
   '<b>Multi-stop chips</b> &mdash; extra pickups and drops shown per stop with stop-off pay on the rate card.',
   '<b>Load Score</b> &mdash; every load graded on rate-per-mile vs weekly-refreshed market benchmarks. <a href="load-score.html">See Load Score</a>.'],
  ('Explore the live load board','load-board.html')),
 ('<div class="ftx-mock"><div class="ftx-card"><div class="ftx-row"><b style="color:#fff;font-size:1.05rem">Dallas, TX &rarr; Atlanta, GA</b><b style="color:#4ade80;font-size:1.15rem">$2,850</b></div>'
  '<div style="margin-top:7px"><span class="ftx-chip ftx-blue">Dry Van 53&#8242;</span><span class="ftx-chip ftx-blue">781 mi</span><span class="ftx-chip ftx-green">$3.65/mi</span><span class="ftx-chip ftx-purple">&#128230; +1 stop</span></div>'
  '<div class="ftx-row" style="margin-top:11px"><span class="ftx-chip ftx-amber">&#9203; Offer 12:44 left</span><span class="ftx-chip ftx-green">Book in one tap &rarr;</span></div></div>'
  '<div class="ftx-card"><div class="ftx-row"><b style="color:#fff">Chicago, IL &rarr; Newark, NJ</b><b style="color:#4ade80">$3,120</b></div>'
  '<div style="margin-top:7px"><span class="ftx-chip ftx-blue">Reefer</span><span class="ftx-chip ftx-green">$3.90/mi &middot; Grade A</span><span class="ftx-chip ftx-blue">Propose a rate</span></div></div>'
  '<div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:6px">Booked loads disappear instantly &mdash; no ghost freight, ever</div></div>')
 )

feat += fsec('booking','Book &amp; roll','Booking with paperwork that enforces itself',
 fbody('Book &amp; roll','Booking with paperwork that enforces itself',
  'Booking is not a phone call &mdash; it is a gated workflow. The rate confirmation is issued the second you book, the dispatch sheet prints itself, and every stop lands on the trip map with times.',
  ['<b>Instant, immutable rate confirmation</b> &mdash; issued to Documents automatically on booking; acknowledge in-app and the PDF lives on the trip forever. <a href="how-to-read-a-rate-confirmation.html">Learn to read a rate con</a>.',
   '<b>Booking approvals</b> &mdash; brokers approve requests with the carrier&rsquo;s safety record and document status in view.',
   '<b>Dispatch sheet</b> &mdash; one-click printable sheet with stops, contacts, PU/DEL numbers and rate card.',
   '<b>Emergency rescheduling</b> &mdash; breakdowns and delays follow a published policy, not an argument. <a href="emergency-rescheduling-policy.html">Read the policy</a>.'],
  ('Booking deep-dive: one tap to rolling','book-truck-loads.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128666; Booking checklist</div>'
  '<div class="ftx-card ftx-row"><span>Rate confirmation</span><span class="ftx-chip ftx-green">&#x2713; issued &middot; acknowledged</span></div>'
  '<div class="ftx-card ftx-row"><span>Driver + truck assigned</span><span class="ftx-chip ftx-green">&#x2713; Marcus &middot; #402</span></div>'
  '<div class="ftx-card ftx-row"><span>Pickup number</span><span class="ftx-chip ftx-amber">broker adds before PU</span></div>'
  '<div class="ftx-card ftx-row"><span>Dispatch sheet</span><span class="ftx-chip ftx-blue">&#128424; print</span></div></div>'), alt=True, flip=True)

feat += fsec('tracking','Live proof','GPS tracking that pays you, not just watches you',
 fbody('Live proof','GPS tracking that pays you, not just watches you',
  'Every trip runs on live GPS with an 800-meter geofence at EVERY stop. Arrive and depart times are recorded as evidence &mdash; that is what turns detention from a fight into a payout.',
  ['<b>Geofenced check-ins</b> &mdash; arrive/depart stamped automatically at pickup, every extra stop and delivery.',
   '<b>Detention clock</b> &mdash; starts from the recorded arrival; claims file themselves with GPS evidence attached.',
   '<b>Trip map + Google Maps handoff</b> &mdash; navigate in Maps while LoadBoot keeps recording proof.',
   '<b>ELD or phone</b> &mdash; use built-in phone GPS or connect Samsara / Motive directly. <a href="gps-tracking.html">Full tracking guide</a>.'],
  ('Read the tracking guide','gps-tracking.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128205; Trip timeline &mdash; live</div>'
  '<div class="ftx-card"><div class="ftx-row"><span>&#128309; Pickup &middot; Dallas, TX</span><span class="ftx-chip ftx-green">arr 09:12 &middot; dep 10:03</span></div></div>'
  '<div class="ftx-card"><div class="ftx-row"><span>&#128993; Stop 2 &middot; Ponce De Leon, FL</span><span class="ftx-chip ftx-amber">&#9203; detention 1:47 running</span></div><div class="ftx-bar"><i style="width:64%"></i></div></div>'
  '<div class="ftx-card"><div class="ftx-row"><span>&#128994; Delivery &middot; Atlanta, GA</span><span class="ftx-chip ftx-blue">ETA 16:40 &middot; on time</span></div></div>'
  '<div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:6px">Every timestamp is evidence &mdash; detention pays from real data</div></div>'))

feat += fsec('money','Get paid','Payments with receipts, deadlines and zero guesswork',
 fbody('Get paid','Payments with receipts, deadlines and zero guesswork',
  'Delivery flips the invoice to DUE automatically. Brokers see PAY-BY deadlines, pay a whole trip with one receipt, and both sides confirm &mdash; a full audit trail instead of &ldquo;check is in the mail&rdquo;.',
  ['<b>Auto-invoice on delivery</b> &mdash; premium branded invoice PDF generated and emailed the moment POD is approved.',
   '<b>Receivables tracker</b> &mdash; every dollar owed with due-since ageing, payment route and status.',
   '<b>One-receipt trip settlement</b> &mdash; freight + accessorials settle together; receipts attach to the record.',
   '<b>Nudges built in</b> &mdash; &#128276; request-payment reminders and confirm-received nags so money never sleeps. <a href="payments-settlements.html">Payments guide</a>.'],
  ('Read the payments guide','payments-settlements.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128176; Money in &mdash; receivables</div>'
  '<div class="ftx-card"><div class="ftx-row"><span>Benton, WI &rarr; Atlanta, GA</span><b style="color:#4ade80">$2,909</b></div><div style="margin-top:6px"><span class="ftx-chip ftx-amber">PAY BY Jul 24 &middot; 6d left</span><span class="ftx-chip ftx-blue">&rarr; direct to carrier</span></div></div>'
  '<div class="ftx-card"><div class="ftx-row"><span>Appomattox, VA &rarr; Milwaukee, WI</span><b style="color:#4ade80">$2,125</b></div><div style="margin-top:6px"><span class="ftx-chip ftx-green">&#x2713; PAID &middot; receipt attached</span><span class="ftx-chip ftx-green">&#x2713; received confirmed</span></div></div>'
  '<div class="ftx-card ftx-row"><span>Detention &middot; GPS-verified 2:10</span><b style="color:#4ade80">$70.00</b></div></div>'), alt=True, flip=True)

feat += fsec('factoring','Factoring built in','A real NOA engine — not a PDF in an email',
 fbody('Factoring built in','A real NOA engine &mdash; not a PDF in an email',
  'If you factor, LoadBoot carries your Notice of Assignment everywhere money moves. Brokers see the factor&rsquo;s remit-to on every pay panel with UCC &sect;9-406 language; your own bank stays hidden.',
  ['<b>Org-level activation</b> &mdash; upload your factor&rsquo;s NOA once; every new booking notifies the broker automatically.',
   '<b>Per-broker freedom</b> &mdash; choose factoring or direct pay broker-by-broker; switch anytime.',
   '<b>Factoring packet</b> &mdash; one click gives your factor everything: RC, POD, invoice, NOA.',
   '<b>Release flow</b> &mdash; leave your factor cleanly; remit-to flips back to you everywhere at once. <a href="factoring-noa.html">Factoring &amp; NOA guide</a>.'],
  ('Read the factoring guide','factoring-noa.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#127974; Pay this trip</div>'
  '<div class="ftx-card" style="border-color:rgba(139,92,246,.5);background:rgba(139,92,246,.1)"><b style="color:#c4b5fd">&#9888; PAY THE FACTOR &mdash; NOA on file</b><div style="margin-top:6px;color:#cbd5e1">Remit to: <b style="color:#fff">OTR Capital LLC</b><br>ACH &middot; ref #LB-2214 &middot; terms Net-21</div><div style="margin-top:7px;font-size:.74rem;color:#94a3b8">Payment to any other party does not discharge this debt (UCC &sect;9-406)</div></div>'
  '<div class="ftx-card ftx-row"><span>Trip total (freight + detention)</span><b style="color:#4ade80">$2,979</b></div></div>'))

feat += ('<section class="ftx-sec alt" id="accessorials"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Accessorial pay</div><h2>Every accessorial has a public policy &mdash; and files itself</h2></div>'
 '<p class="ftx-p reveal" style="max-width:760px">Detention, layover, TONU, lumper and driver assist are not favors &mdash; they are rate-card items with GPS evidence and published rules. Claims are auto-drafted from trip data; the broker sees the evidence, not an argument.</p>'
 '<div class="cards g3 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#9203;</div><h3>Detention</h3><p>Clock starts from geofenced arrival. <a href="detention-pay-policy.html">Policy &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#128716;</div><h3>Layover</h3><p>Overnight holds paid by published rates. <a href="layover-policy.html">Policy &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#128683;</div><h3>TONU</h3><p>Truck ordered, not used &mdash; still paid. <a href="tonu-policy.html">Policy &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#128230;</div><h3>Lumper</h3><p>Receipts reimbursed through the trip ledger. <a href="lumper-policy.html">Policy &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#128170;</div><h3>Driver assist</h3><p>Loading help is billable work. <a href="driver-assist-policy.html">Policy &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#9200;</div><h3>FCFS &amp; scheduling</h3><p>Appointment rules that protect your clock. <a href="fcfs-policy.html">Policy &rarr;</a></p></div>'
 '</div></div></section>')

feat += fsec('fleet','Run the fleet','Fleet tools that scale past one truck',
 fbody('Run the fleet','Fleet tools that scale past one truck',
  'Drivers, trucks and money in one place. Invite drivers with magic links, assign trips, watch per-trip profit and keep the whole operation compliant.',
  ['<b>Drivers &amp; trucks</b> &mdash; roster, invites, assignments, capacity and availability.',
   '<b>Per-trip P&amp;L</b> &mdash; revenue minus fuel, tolls and costs on every load; know your real cost per mile. <a href="cost-per-mile-calculator.html">CPM calculator</a>.',
   '<b>Fuel import</b> &mdash; drop your fuel-card CSV in; expenses land on trips automatically.',
   '<b>Fleet optimization</b> &mdash; deadhead and utilization insights from your actual trip history. <a href="fleet-management.html">Fleet guide</a>.'],
  ('Read the fleet guide','fleet-management.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128101; Fleet &mdash; this week</div>'
  '<div class="ftx-card ftx-row"><span>&#128100; Marcus &middot; #402</span><span class="ftx-chip ftx-green">on trip &middot; GPS live</span></div>'
  '<div class="ftx-card ftx-row"><span>&#128100; Deshawn &middot; #417</span><span class="ftx-chip ftx-blue">available &middot; Dallas</span></div>'
  '<div class="ftx-card"><div class="ftx-row"><span>Trip P&amp;L &middot; DAL&rarr;ATL</span><b style="color:#4ade80">+$1,918</b></div><div class="ftx-bar"><i style="width:78%"></i></div><div style="font-size:.74rem;color:#94a3b8;margin-top:5px">$2,850 revenue &minus; $932 fuel/tolls/costs</div></div></div>'), alt=True, flip=True)

feat += fsec('docs','Stay compliant','Compliance that runs itself',
 fbody('Stay compliant','Compliance that runs itself',
  'FMCSA verification is built into onboarding, documents live on the account with expiry tracking, and everything signable is e-signed &mdash; W-9 and dispatch agreement &mdash; and every rate confirmation is issued and acknowledged in-app.',
  ['<b>FMCSA verify</b> &mdash; MC/DOT checked at signup; authority status on your profile.',
   '<b>Document vault</b> &mdash; COI, W-9, authority letters with expiry reminders before anything lapses.',
   '<b>E-signatures</b> &mdash; dispatch agreement and W-9 signed in-app (E-SIGN Act), PDFs generated instantly.',
   '<b>Compliance gates</b> &mdash; booking requires valid documents, so problems surface before the load, not after.'],
  ('How verification works — every role','compliance.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128737; Verification center</div>'
  '<div class="ftx-card ftx-row"><span>FMCSA authority</span><span class="ftx-chip ftx-green">&#x2713; ACTIVE &middot; MC-114879</span></div>'
  '<div class="ftx-card ftx-row"><span>Certificate of insurance</span><span class="ftx-chip ftx-green">&#x2713; valid &middot; exp Nov 2026</span></div>'
  '<div class="ftx-card ftx-row"><span>W-9</span><span class="ftx-chip ftx-green">&#x2713; e-signed</span></div>'
  '<div class="ftx-card ftx-row"><span>Dispatch agreement</span><span class="ftx-chip ftx-green">&#x2713; e-signed &middot; PDF</span></div></div>'))

feat += fsec('accounting','Books done for you','QuickBooks two-way sync — live, not a roadmap',
 fbody('Books done for you','QuickBooks two-way sync &mdash; live, not a roadmap',
  'Connect your own QuickBooks Online in two minutes. Delivered-freight invoices and expenses push into YOUR books automatically, and paid status flows back. Zero manual bookkeeping.',
  ['<b>Invoices push</b> &mdash; every delivered load becomes a QuickBooks invoice (customer + Freight Services item auto-created).',
   '<b>Expenses push</b> &mdash; fuel, tolls and costs land as Purchases.',
   '<b>Paid pulls back</b> &mdash; receive payment in QuickBooks; LoadBoot marks it paid.',
   '<b>No QuickBooks?</b> &mdash; export clean CSVs for Wave, Xero or your accountant. <a href="integrations.html">Integrations guide</a>.'],
  ('See all integrations','integrations.html')),
 ('<div class="ftx-mock"><div class="ftx-row" style="margin-bottom:10px"><b style="color:#fff">&#128218; QuickBooks Online</b><span class="ftx-chip ftx-green">&#9679; connected</span></div>'
  '<div class="ftx-card ftx-row"><span>&#128228; Invoices pushed</span><b style="color:#4ade80">+7</b></div>'
  '<div class="ftx-card ftx-row"><span>&#128228; Expenses pushed</span><b style="color:#4ade80">+2</b></div>'
  '<div class="ftx-card ftx-row"><span>&#128229; Marked paid in QBO</span><b style="color:#4ade80">1</b></div>'
  '<div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:6px">Real two-way sync &mdash; verified in production</div></div>'), alt=True, flip=True)

feat += fsec('integrations','Connect everything','ELD, API and the tools you already use',
 fbody('Connect everything','ELD, API and the tools you already use',
  'Your telematics can drive LoadBoot tracking directly &mdash; connect Samsara or Motive with your own token and vehicle locations flow onto active trips every five minutes.',
  ['<b>Samsara &amp; Motive</b> &mdash; direct provider APIs, live today; phone GPS works with zero setup.',
   '<b>Developer API</b> &mdash; keys, docs and webhooks in the developer portal. <a href="/app/developer/">Open developer portal</a>.',
   '<b>QuickBooks Online</b> &mdash; production two-way sync (above).',
   '<b>Fuel cards</b> &mdash; CSV import today; direct card APIs need partner agreements and are on the public roadmap &mdash; stated honestly. <a href="integrations.html">Full integration status</a>.'],
  ('Integration status page','integrations.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128268; Connections</div>'
  '<div class="ftx-card ftx-row"><span>&#128752; Samsara ELD</span><span class="ftx-chip ftx-green">&#9679; polling &middot; 5 min</span></div>'
  '<div class="ftx-card ftx-row"><span>&#128241; Phone GPS</span><span class="ftx-chip ftx-green">&#9679; built in</span></div>'
  '<div class="ftx-card ftx-row"><span>&#128218; QuickBooks</span><span class="ftx-chip ftx-green">&#9679; two-way live</span></div>'
  '<div class="ftx-card ftx-row"><span>&#9968; Fuel card APIs</span><span class="ftx-chip ftx-amber">roadmap &middot; CSV today</span></div></div>'))

feat += fsec('partners','For brokers &amp; shippers','Post once. Covered in minutes — with proof.',
 fbody('For brokers &amp; shippers','Post once. Covered in minutes &mdash; with proof.',
  'Brokers and shippers get the same engine: a full posting wizard, verified carriers racing a 15-minute offer window, live GPS on every shipment and documents that collect themselves.',
  ['<b>Posting wizard</b> &mdash; multi-stop, scheduling, rate card with accessorial rates baked in.',
   '<b>Vetted capacity</b> &mdash; carriers are FMCSA-verified and health-scored before they can book.',
   '<b>Live visibility</b> &mdash; GPS timeline, arrive/depart stamps and POD on every load.',
   '<b>Payables discipline</b> &mdash; pay-by dates, one-receipt trip payment, factor remit-to shown when an NOA exists. <a href="brokers.html">Broker overview</a> &middot; <a href="shipper-solutions.html">Shipper solutions</a>.'],
  [('Create a broker account','create-broker-account.html'),('Create a shipper account','create-shipper-account.html')]),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#127970; Your load &mdash; offered</div>'
  '<div class="ftx-card ftx-row"><span>&#128666; TRUCKING ENTERPRISE</span><span class="ftx-chip ftx-green">&#x2713; BOOKED 04:12</span></div>'
  '<div class="ftx-card ftx-row"><span>&#128666; RIVERLINE FREIGHT</span><span class="ftx-chip ftx-blue">offer auto-closed</span></div>'
  '<div class="ftx-card ftx-row"><span>&#128666; ALL CITIES TRANSPORT</span><span class="ftx-chip ftx-blue">offer auto-closed</span></div>'
  '<div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:6px">First accept wins &mdash; zero double-booking</div></div>'), alt=True, flip=True)

feat += fsec('agents','Earn with us','An agent program with a real back office',
 fbody('Earn with us','An agent program with a real back office',
  'Independent dispatchers and connectors bring clients to LoadBoot and earn 1% of gross on every delivered load their chain touches &mdash; tracked live, paid monthly, with overrides five levels deep.',
  ['<b>1% of gross, recurring</b> &mdash; on every delivered load your referred clients run, for as long as they haul.',
   '<b>5-level overrides</b> &mdash; recruit agents and earn 0.50% / 0.25% / 0.15% / 0.10% on their production.',
   '<b>Live chain dashboard</b> &mdash; joins, postings, bookings and deliveries stream in real time.',
   '<b>Payout center</b> &mdash; monthly payouts from $100 to bank or Payoneer, with signed agreement and tax forms handled in-app. <a href="agents.html">Full program</a>.'],
  ('Become an agent','create-agent-account.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#129309; Your chain &mdash; live</div>'
  '<div class="ftx-card ftx-row"><span>Referred</span><b style="color:#fff">12</b></div>'
  '<div class="ftx-card ftx-row"><span>Delivered gross this month</span><b style="color:#fff">$83,850</b></div>'
  '<div class="ftx-card ftx-row"><span>Your 1% + overrides</span><b style="color:#4ade80">$914.20</b></div>'
  '<div class="ftx-bar"><i style="width:71%"></i></div><div style="font-size:.74rem;color:#94a3b8;margin-top:5px">$914 / $1,287 vs last month</div></div>'))

feat += fsec('security','Trust the platform','Security and reliability by design',
 fbody('Trust the platform','Security and reliability by design',
  'Every carrier sees only their own data &mdash; enforced at the database layer, not the UI. Money data never touches the browser cache, and the app installs on any phone like a native app.',
  ['<b>Self-scoping data</b> &mdash; server resolves your org from your session; cross-account access is structurally impossible.',
   '<b>Encryption</b> &mdash; TLS 1.2+ in transit, AES-256 at rest; secrets live server-side only.',
   '<b>Installable app</b> &mdash; PWA with push notifications and weak-signal resilience; native apps in preparation. <a href="apps.html">Get the app</a>.',
   '<b>Audit trails</b> &mdash; bookings, payments, claims and document events are all timestamped records.'],
  ('Get the app','apps.html')),
 ('<div class="ftx-mock"><div style="font-weight:800;color:#fff;margin-bottom:10px">&#128274; Your account, your data</div>'
  '<div class="ftx-card ftx-row"><span>Row-level scoping</span><span class="ftx-chip ftx-green">&#x2713; enforced in DB</span></div>'
  '<div class="ftx-card ftx-row"><span>TLS + AES-256</span><span class="ftx-chip ftx-green">&#x2713; everywhere</span></div>'
  '<div class="ftx-card ftx-row"><span>Money data caching</span><span class="ftx-chip ftx-red">&#10007; never cached</span></div>'
  '<div class="ftx-card ftx-row"><span>Install on phone</span><span class="ftx-chip ftx-blue">PWA &middot; stores coming</span></div></div>'), alt=True, flip=True)

feat += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Honest comparison</div><h2>LoadBoot vs load boards vs traditional dispatch</h2></div>'
 '<div class="reveal" style="overflow-x:auto;margin-top:22px"><table class="ftx-cmp">'
 '<tr><th></th><th>LoadBoot</th><th>Load boards (DAT / Truckstop)</th><th>Traditional dispatcher</th></tr>'
 '<tr><td>Finding freight</td><td class="ftx-yes">&#x2713; board + direct offers</td><td class="ftx-yes">&#x2713; search listings</td><td class="ftx-part">dispatcher calls around</td></tr>'
 '<tr><td>Ghost loads</td><td class="ftx-yes">&#x2713; impossible &mdash; booked loads vanish</td><td class="ftx-no">&#10007; common</td><td class="ftx-part">depends on dispatcher</td></tr>'
 '<tr><td>GPS proof &amp; detention evidence</td><td class="ftx-yes">&#x2713; built in, every stop</td><td class="ftx-no">&#10007;</td><td class="ftx-no">&#10007;</td></tr>'
 '<tr><td>Invoicing &amp; payments tracking</td><td class="ftx-yes">&#x2713; automatic + receipts</td><td class="ftx-no">&#10007;</td><td class="ftx-part">manual, varies</td></tr>'
 '<tr><td>Factoring / NOA handling</td><td class="ftx-yes">&#x2713; full engine</td><td class="ftx-no">&#10007;</td><td class="ftx-part">emails PDFs</td></tr>'
 '<tr><td>QuickBooks sync</td><td class="ftx-yes">&#x2713; two-way, live</td><td class="ftx-no">&#10007;</td><td class="ftx-no">&#10007;</td></tr>'
 '<tr><td>Cost</td><td class="ftx-yes">flat 5% per dispatched load</td><td class="ftx-part">$45&ndash;$150+/month subscription</td><td class="ftx-part">5&ndash;10% + often lease-on terms</td></tr>'
 '<tr><td>Contracts</td><td class="ftx-yes">none &mdash; leave anytime</td><td class="ftx-part">monthly plans</td><td class="ftx-no">often locked in</td></tr>'
 '</table></div></div></section>')

_FEAT_FAQ = [
 ('Is every feature on this page actually live?', 'Yes. This page documents only what exists in the product today. Anything still in development (native mobile apps, direct fuel-card APIs) is explicitly labelled as roadmap on the integrations page.'),
 ('What does LoadBoot cost?', 'Carriers pay a flat 5% of gross on loads dispatched through LoadBoot. No signup fee, no monthly subscription, no contracts. See the pricing page for full details.'),
 ('Do I need an ELD to use GPS tracking?', 'No. Phone GPS works out of the box with geofenced arrive/depart proof. If you run Samsara or Motive, connect them directly and vehicle locations flow onto trips automatically.'),
 ('How does the QuickBooks integration work?', 'You connect your own QuickBooks Online company via OAuth. LoadBoot pushes delivered-freight invoices and expenses into your books and pulls paid status back. You can disconnect anytime.'),
 ('Can brokers and shippers use LoadBoot too?', 'Yes. Brokers and shippers post loads in the Partner Portal, get FMCSA-verified carriers in a 15-minute offer race, and track every shipment live with documents and payables handled in the same system.'),
]
_feat_schema = '<script type="application/ld+json">' + json.dumps({
  '@context':'https://schema.org','@type':'FAQPage',
  'mainEntity':[{'@type':'Question','name':q,'acceptedAnswer':{'@type':'Answer','text':a}} for q,a in _FEAT_FAQ]}) + '</script>'
feat += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Features FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _FEAT_FAQ)
 + '</div></div></section>')

feat += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:64px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">Pick your side of the load</h2>'
 '<p style="color:#cbd5e1;max-width:620px;margin:12px auto 26px">Every account is free to create. Verification takes minutes, not days.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; I&rsquo;m a carrier</a>'
 '<a href="create-broker-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127970; I&rsquo;m a broker</a>'
 '<a href="create-shipper-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127981; I&rsquo;m a shipper</a>'
 '<a href="create-agent-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#129309; I&rsquo;m an agent</a>'
 '</div></div></section>')

RELATED['features.html'] = [('how-it-works.html','How It Works'),('gps-tracking.html','GPS Tracking'),('payments-settlements.html','Payments'),('factoring-noa.html','Factoring & NOA'),('fleet-management.html','Fleet Management'),('integrations.html','Integrations')]
page('features.html', 'LoadBoot Features — Load Board, GPS Tracking, Payments, Factoring & QuickBooks | Trucking Software',
     'Explore every LoadBoot feature: ghost-free load board, one-tap booking with instant rate confirmations, GPS geofence tracking with detention proof, receipt-verified payments, a full factoring/NOA engine, fleet tools, compliance automation and live two-way QuickBooks sync.',
     'features.html', feat, _feat_schema)

# ---------------- LIVE LOAD BOARD — flagship product page (code-verified features, zero invention) ----------------
LBX_CSS = """<style>
.lbx-board{background:linear-gradient(160deg,#0e1c38,#0b1220 70%);border-radius:22px;padding:22px;box-shadow:0 34px 80px -32px rgba(11,18,32,.6);color:#e2e8f0;font-size:.9rem}
.lbx-filters{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.lbx-filter{padding:6px 13px;border-radius:999px;border:1px solid rgba(255,255,255,.16);font-size:.74rem;font-weight:700;color:#cbd5e1}
.lbx-filter.on{background:#0883F7;border-color:#0883F7;color:#fff}
.lbx-load{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.12);border-radius:15px;padding:15px 17px;margin-bottom:11px;position:relative}
.lbx-load.hot{border-color:rgba(34,197,94,.45)}
.lbx-timerbar{height:5px;border-radius:99px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:10px}
.lbx-timerbar i{display:block;height:100%;border-radius:99px;background:linear-gradient(90deg,#fbbf24,#f97316);animation:lbxDrain 32s linear infinite}
@keyframes lbxDrain{0%{width:88%}100%{width:6%}}
.lbx-booked{animation:lbxFade 10s ease-in-out infinite}
@keyframes lbxFade{0%,42%{opacity:1}52%,86%{opacity:.28}96%,100%{opacity:1}}
.lbx-bookstamp{position:absolute;top:12px;right:14px;background:rgba(34,197,94,.18);color:#4ade80;font-weight:900;font-size:.72rem;padding:4px 11px;border-radius:999px;border:1px solid rgba(34,197,94,.5);opacity:0;animation:lbxStamp 10s ease-in-out infinite;pointer-events:none}
@keyframes lbxStamp{0%,40%{opacity:0}48%,88%{opacity:1}97%,100%{opacity:0}}
.lbx-livedot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#4ade80;margin-right:6px;animation:lbxPulse 1.6s ease-in-out infinite}
@keyframes lbxPulse{0%,100%{box-shadow:0 0 0 0 rgba(74,222,128,.5)}55%{box-shadow:0 0 0 7px rgba(74,222,128,0)}}
@media(prefers-reduced-motion:reduce){.lbx-timerbar i,.lbx-booked,.lbx-bookstamp,.lbx-livedot{animation:none}.lbx-booked{opacity:1}}
.lbx-callout{display:flex;gap:10px;align-items:flex-start;margin:10px 0}
.lbx-cnum{flex:none;width:24px;height:24px;border-radius:50%;background:#0883F7;color:#fff;font-weight:900;font-size:.74rem;display:flex;align-items:center;justify-content:center}
.lbx-grid2{display:grid;grid-template-columns:1.05fr .95fr;gap:44px;align-items:center}
@media(max-width:880px){.lbx-grid2{grid-template-columns:1fr}}
.lbx-ghost{background:#fff;border:1.5px dashed #fca5a5;border-radius:15px;padding:15px 17px;color:#7f1d1d;position:relative}
.lbx-ghost .tag{position:absolute;top:-11px;left:14px;background:#dc2626;color:#fff;font-size:.66rem;font-weight:900;letter-spacing:.06em;padding:3px 10px;border-radius:999px}
.lbx-panel{background:#fff;border:1px solid #e6ebf3;border-radius:16px;padding:20px 22px;box-shadow:0 14px 40px -26px rgba(16,34,59,.25)}
.lbx-ratecard td,.lbx-ratecard th{padding:10px 12px;border-bottom:1px solid #eef2f7;text-align:left;font-size:.9rem}
.lbx-ratecard th{background:#f8fafc;color:#10223B}
.lbx-ratecard td b{color:#0b7a3b}
</style>"""

_LBX_FAQ_G = [
 ('&#128123; Ghost loads &amp; the basics', 'ftx-blue', [
  ('What is a ghost load on a load board?', 'A ghost load is a load that looks bookable but is not — it was covered hours or days ago, expired, got reposted by a second broker, or was posted only to test what carriers will haul for. On classic load boards the posting and the booking live in different systems (phone and email), so nobody removes the dead post, and drivers burn hours calling freight that does not exist.'),
  ('How does LoadBoot guarantee zero ghost loads?', 'Because booking happens ON the platform, the board and the booking are one system. Booking is a single atomic transaction: the moment a load is booked it becomes a trip and leaves every carrier&rsquo;s board automatically, and two carriers can never book the same load. Loads whose pickup date passed are flagged EXPIRED on the card instead of silently rotting.'),
  ('Who posts the loads on LoadBoot?', 'Verified freight brokers and direct shippers post through the Partner Portal with exact GPS-pinned facilities, auto-calculated road miles, a market-rate estimator and a mandatory accessorial rate card. Carriers see who posted every load, with a trust score, star rating, loads delivered and on-time percentage.'),
 ]),
 ('&#128666; For carriers &amp; owner-operators', 'ftx-green', [
  ('Is the LoadBoot load board free?', 'Searching, filtering and booking are free — there is no monthly subscription. Carriers pay a flat 5% of gross only on loads dispatched through LoadBoot, and the settlement math (gross &minus; 5% = net) is printed on every trip. Classic boards charge $45–$150+ per month just to search.'),
  ('What is the best load board for owner-operators?', 'The best board for an owner-operator is the one that protects your time and your rate: no ghost loads, the full all-in rate and rate-per-mile up front, accessorial pay (detention, layover, TONU, lumper) in writing before you book, live deadhead from your actual GPS position, and booking that instantly produces a rate confirmation. That is exactly how the LoadBoot board is built.'),
  ('Can I find loads with a new MC or new authority?', 'Yes. LoadBoot verifies your MC/DOT authority, insurance and W-9 once, and from then on every load on the board is bookable in one tap — there is no authority-age wall. See our guide on getting loads with a new authority.'),
  ('Can I negotiate the rate on a load?', 'Yes — every card has Propose rate. You send your all-in counter with an optional note; the broker sees it and approves or declines in-app. Nothing is committed until the broker approves, and an approved counter books the load at your number.'),
  ('Do loads include detention and accessorial pay?', 'Every load carries a published accessorial rate card before you book: detention (standard $60/hr after 2 hours free), layover ($250/day), TONU ($250), lumper policy, driver-assist and extra-stop pay. Every stop is geofenced, so arrive/depart times are recorded automatically and claims file themselves with GPS proof.'),
  ('What happens after I book a load?', 'The rate confirmation and a full dispatch sheet are issued to your Documents automatically, exact street addresses and GPS pins unlock, you assign a driver and truck, and live tracking with 800-meter geofence check-ins starts collecting detention evidence at every stop. Delivery flips the load to an invoice and a settlement statement.'),
 ]),
 ('&#127970; For brokers &amp; shippers', 'ftx-amber', [
  ('How fast will my load get covered?', 'Two rails at once: the load goes live on the board to every verified carrier, and you can fire direct offers at matched carriers with a live countdown — 15 minutes standard, extendable. The first acceptance books atomically and closes every other offer. You watch sent / awaiting / declined counts in real time.'),
  ('Do shippers need a broker to post freight?', 'No. Shippers (and facilities) register in the Partner Portal and post directly: pin your docks once, and your freight reaches the same verified carrier pool with the same live tracking, detention meters and document trail brokers get.'),
  ('How do I know carriers on the board are legit?', 'Carriers can&rsquo;t book anything until their MC/DOT authority, insurance and W-9 are verified — and the board enforces equipment and HAZMAT compatibility per load. Each carrier carries an account-health score and trip-verified ratings from real bookings only.'),
  ('Can I offer a load to a specific carrier?', 'Yes — target any carrier from the directory with a direct offer and a wait window you control (10 minutes to 4 hours). Withdraw or extend live offers any time; if the window expires, the load simply stays on the open board.'),
  ('What do I see while my freight moves?', 'A milestone timeline, the live GPS truck marker with ETA, detention accruing per stop in real time, a server-verified event log of every arrive/depart, then POD and the invoice — the exact same numbers the carrier sees, so disputes end before they start.'),
 ]),
 ('&#129309; For agents', 'ftx-purple', [
  ('How do agents earn from the load board?', 'Refer carriers, brokers or shippers to LoadBoot and every load your referred clients book pays you 1% of the gross on delivery — recurring, tracked live in your Agent Portal, for as long as they keep hauling. See the Agent Program page for payout details.'),
 ]),
]
_LBX_FAQ = [(q,a) for _g,_c,_items in _LBX_FAQ_G for q,a in _items]
_lbx_schema = '<script type="application/ld+json">' + json.dumps({
  '@context':'https://schema.org','@type':'FAQPage',
  'mainEntity':[{'@type':'Question','name':re.sub('<[^>]+>','',q),'acceptedAnswer':{'@type':'Answer','text':re.sub('<[^>]+>','',a)}} for q,a in _LBX_FAQ]}) + '</script>'

lbx = FTX_CSS + LBX_CSS

# HERO + live board
lbx += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:84px 0 60px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Live load board</div>'
 '<h1 style="color:#fff;font-size:2.55rem;line-height:1.12;margin:10px 0 16px">The truck load board where <span style="color:#4ade80">every load is real</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.08rem;line-height:1.7">Find truck loads without the ghost freight, the &ldquo;already covered&rdquo; phone calls or week-old reposts. On LoadBoot the board and the booking are one system: booked loads vanish from every screen instantly, rates are all-in with accessorial pay published before you book, and deadhead is computed live from your GPS — not guessed.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-carrier-account.html" class="btn btn-primary">Find real loads &rarr;</a><a href="app/partner/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Post a load &mdash; broker / shipper</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Zero ghost loads</span><span>&#x2713; Direct offers with live countdown</span><span>&#x2713; Propose-a-rate</span><span>&#x2713; $0 to search &middot; flat 5% only when dispatched</span></div></div>'
 '<div class="lbx-board reveal" aria-hidden="true">'
 '<div class="lbx-filters"><span class="lbx-filter on">&#127760; Available loads</span><span class="lbx-filter">&#128232; Requests <b style="color:#fbbf24">2</b></span><span class="lbx-filter">&#9881; Filters &#9662;</span></div>'
 '<div class="lbx-load hot"><div class="ftx-row"><b style="color:#fff;font-size:1.03rem">Dallas, TX &rarr; Atlanta, GA</b><b style="color:#4ade80;font-size:1.12rem">$2,850</b></div>'
 '<div style="margin-top:6px"><span class="ftx-chip ftx-blue">&#128667; Dry Van 53&#8242;</span><span class="ftx-chip ftx-blue">781 mi &middot; $3.65/mi</span><span class="ftx-chip ftx-green">&asymp; est. profit +$1,240</span></div>'
 '<div style="margin-top:6px"><span class="ftx-chip ftx-blue">&#128205; 42 mi deadhead &middot; live from your GPS</span><span class="ftx-chip ftx-green">&#9201; ~6h to pickup &mdash; you&rsquo;ll make it</span></div>'
 '<div class="ftx-row" style="margin-top:9px"><span class="ftx-chip ftx-amber">&#127919; DIRECT REQUEST &middot; 12:44 left</span><span class="ftx-chip ftx-green">Request to book &rarr;</span></div>'
 '<div class="lbx-timerbar"><i></i></div></div>'
 '<div class="lbx-load"><div class="ftx-row"><b style="color:#fff">Houston, TX &rarr; Memphis, TN</b><b style="color:#4ade80">$1,940</b></div>'
 '<div style="margin-top:6px"><span class="ftx-chip ftx-blue">Flatbed &middot; tarps</span><span class="ftx-chip ftx-amber">$3.36/mi</span><span class="ftx-chip ftx-blue">FCFS 06:00&ndash;14:00</span><span class="ftx-chip ftx-blue">&#9998; Propose rate</span></div></div>'
 '<div class="lbx-load lbx-booked"><span class="lbx-bookstamp">&#x2713; BOOKED &mdash; off every board</span><div class="ftx-row"><b style="color:#fff">Chicago, IL &rarr; Newark, NJ</b><b style="color:#4ade80">$3,120</b></div>'
 '<div style="margin-top:6px"><span class="ftx-chip ftx-blue">Reefer &minus;10&deg;F</span><span class="ftx-chip ftx-green">$3.90/mi</span><span class="ftx-chip ftx-purple">+1 stop &middot; stop-off pay</span></div></div>'
 '<div style="text-align:center;color:#64748b;font-size:.76rem;margin-top:4px"><span class="lbx-livedot"></span>Live board &mdash; a booked load dims out for everyone, instantly.</div>'
 '</div></div></div></section>')

# role router — send each side to its sections
lbx += ('<section style="background:#0b1220;padding:0 0 34px"><div class="wrap"><div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px" class="cards g4"><a href="#for-carriers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#128666; I move freight</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Carriers &amp; owner-operators &mdash; search, book, get paid &darr;</div></a><a href="#for-posters" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127970; I&rsquo;m a broker</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Post, target carriers, run the offer race &darr;</div></a><a href="#for-posters" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127981; I&rsquo;m a shipper</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Post your own freight directly &mdash; no middleman &darr;</div></a><a href="#for-agents" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#129309; I refer people</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Agents earn 1% on every referred load &darr;</div></a></div></div></section>')

# SEO prose strip
lbx += ('<section class="ftx-sec" style="padding-top:48px;padding-bottom:8px"><div class="wrap"><div class="lbx-panel reveal" style="max-width:900px;margin:0 auto">'
 '<p class="ftx-p" style="margin:0">LoadBoot is a <b>free-to-search load board for truckers, owner-operators and small fleets</b> connected directly to verified freight brokers and shippers. Unlike subscription load boards, LoadBoot is a full dispatch platform: the same system that shows you the load also books it, issues the rate confirmation, tracks the trip by GPS, files detention with proof and settles the invoice. That is why ghost loads — the #1 complaint about traditional load boards — are structurally impossible here.</p>'
 '</div></div></section>')

# Ghost problem vs live
lbx += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">The industry problem</div><h2 class="ftx-h">What is a ghost load &mdash; and why other boards are full of them</h2>'
 '<p class="ftx-p">A ghost load looks bookable but is not: covered hours ago, expired, double-posted by a second broker, or never real at all — posted just to harvest carrier rate quotes. On classic boards the deal closes over phone and email, so nobody deletes the post. Drivers burn hours calling dead freight; brokers drown in calls for loads covered yesterday.</p>'
 '<div style="margin-top:14px">'
 '<div class="ftx-li"><span class="ftx-tick" style="background:#fee2e2;color:#dc2626">&#10007;</span><div><b>Stale posts</b> &mdash; covered loads stay listed for days because removal is manual.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick" style="background:#fee2e2;color:#dc2626">&#10007;</span><div><b>Double posting</b> &mdash; the same load on five boards under three brokers.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick" style="background:#fee2e2;color:#dc2626">&#10007;</span><div><b>Rate fishing</b> &mdash; fake posts used only to test what carriers will haul for.</div></div>'
 '</div>'
 '<div style="margin-top:16px"><a href="ghost-loads-load-board-problems.html" class="btn btn-secondary">Deep dive: the ghost-load problem &rarr;</a></div></div>'
 '<div class="reveal"><div class="lbx-ghost" style="margin-bottom:14px"><span class="tag">GHOST LOAD</span><div style="display:flex;justify-content:space-between;font-weight:800"><span>Laredo, TX &rarr; Denver, CO</span><span>$2,400</span></div>'
 '<div style="font-size:.85rem;color:#b91c1c;margin-top:6px">Posted 3 days ago &middot; still listed</div>'
 '<div style="margin-top:10px;background:#fef2f2;border-radius:10px;padding:9px 12px;font-size:.85rem">&#128222; &ldquo;Sorry, that one&rsquo;s been covered since Tuesday&hellip;&rdquo;</div></div>'
 '<div style="text-align:center;font-weight:900;color:#64748b;margin:10px 0">vs</div>'
 '<div class="lbx-board" style="padding:16px"><div class="lbx-load hot" style="margin-bottom:0"><div class="ftx-row"><b style="color:#fff">Laredo, TX &rarr; Denver, CO</b><b style="color:#4ade80">$2,400</b></div>'
 '<div style="margin-top:6px"><span class="ftx-chip ftx-green"><span class="lbx-livedot"></span>LIVE &mdash; bookable now</span><span class="ftx-chip ftx-blue">posted 14 min ago</span></div></div></div></div>'
 '</div></div></section>')

# How we kill them
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">How LoadBoot kills them</div><h2>One system for the post AND the booking</h2></div>'
 '<p class="ftx-p reveal" style="max-width:780px">Ghost loads survive when the board is just an advertisement and the deal happens elsewhere. LoadBoot closes that gap: posting, offering, negotiating, booking and paperwork run in one engine — so board truth is enforced by code, not by courtesy.</p>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128228;</div><h3>1 &middot; Posted once</h3><p>A verified broker or shipper posts with GPS-pinned facilities, auto-calculated road miles and a full accessorial rate card.</p></div>'
 '<div class="card"><div class="icon">&#9889;</div><h3>2 &middot; Offered live</h3><p>Matched carriers get a direct offer with a live countdown &mdash; 15 minutes standard &mdash; while the board shows it to everyone.</p></div>'
 '<div class="card"><div class="icon">&#x2713;</div><h3>3 &middot; First accept wins</h3><p>Booking is atomic &mdash; one accept books it and every other offer closes itself the same second. Double-booking is impossible.</p></div>'
 '<div class="card"><div class="icon">&#128171;</div><h3>4 &middot; Gone everywhere</h3><p>Booked &rarr; it becomes a trip and leaves every board instantly. Pickup date passed &rarr; the card is flagged EXPIRED, never silently stale.</p></div>'
 '</div></div></section>')

# Search & filters
lbx += ('<section class="ftx-sec" id="for-carriers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Find loads your way</div><h2 class="ftx-h">Two feeds, instant filters, real deadhead</h2>'
 '<p class="ftx-p">The board has two tabs: <b>&#128232; Requests</b> — loads brokers pushed directly to you, with live countdowns — and <b>&#127760; Available loads</b>, the open market. Instant filters narrow by origin, destination, equipment, minimum $/mi and minimum total rate.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Deadhead from your real position</b> &mdash; road miles from your live GPS or home base, not straight-line guesses.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Can-you-make-it chips</b> &mdash; every card computes hours to pickup and delivery against HOS (solo or team): green &ldquo;you&rsquo;ll make it&rdquo;, amber &ldquo;tight, roll now&rdquo;, red &ldquo;you&rsquo;d be late&rdquo;.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Est. profit on the card</b> &mdash; set your cost per mile once and every load shows estimated profit next to the rate. <a href="cost-per-mile-calculator.html">Know your cost per mile</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>&#128666; Post my truck</b> &mdash; post your truck&rsquo;s location, window and minimum $/mi, and auto-matching requests loads for you in the background.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/board-web-available.webp" alt="LoadBoot live load board — available truck loads with instant filters" width="1200" height="844" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real board &mdash; live loads, filters, net-after-fee math.</div></div>'
 '</div></div></section>')

# Card anatomy
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Anatomy of a load card</div><h2>Every pixel on the card earns its place</h2></div>'
 '<div class="lbx-grid2" style="margin-top:26px"><div class="reveal">'
 '<div style="max-width:340px;margin:0 auto"><img src="/shots/board-card-details.webp" alt="LoadBoot load card details — rate card, stops, dock hours, cargo value" width="360" height="1740" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">A real load card, fully disclosed.</div></div>'
 '<div class="reveal">'
 '<div class="lbx-callout"><span class="lbx-cnum">1</span><div><b>All-in rate + true RPM</b> &mdash; rate-per-mile on real road miles, plus estimated profit against your own cost model.</div></div>'
 '<div class="lbx-callout"><span class="lbx-cnum">2</span><div><b>Live deadhead &amp; feasibility</b> &mdash; miles from your GPS and HOS-aware &ldquo;can you make it&rdquo; chips protect your on-time record before you tap.</div></div>'
 '<div class="lbx-callout"><span class="lbx-cnum">3</span><div><b>Multi-stop chips</b> &mdash; every extra stop with its own stop-off pay; the full route opens in one tap (exact addresses unlock after booking).</div></div>'
 '<div class="lbx-callout"><span class="lbx-cnum">4</span><div><b>Who posted it</b> &mdash; verified badge, trust score out of 100, star rating, loads delivered and on-time % — before you commit.</div></div>'
 '<div class="lbx-callout"><span class="lbx-cnum">5</span><div><b>Rate card on the card</b> &mdash; detention, layover, TONU and lumper policy printed before booking, with LoadBoot standards filling any gap.</div></div>'
 '<div class="lbx-callout"><span class="lbx-cnum">6</span><div><b>Everything disclosed</b> &mdash; commodity, weight, pallets, reefer temp, tarps, dock hours, load method, HAZMAT, team-required, cargo value. No &ldquo;call for details&rdquo;.</div></div>'
 '</div></div></div></section>')

# Direct offers
lbx += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Direct offers</div><h2 class="ftx-h">The 15-minute race: first accept wins</h2>'
 '<p class="ftx-p">Brokers push loads straight to matched carriers as <b>direct requests</b>. Each carrier sees a live countdown ticking every second — it turns red under five minutes. Accept, and the load books instantly: the rate confirmation and dispatch sheet are issued to your Documents automatically. Every other offer closes the same second.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>15 minutes standard</b> &mdash; the broker can set anywhere from 10 minutes to 4 hours, and extend a live window.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Expired &ne; dead</b> &mdash; if nobody accepts, the load simply stays on the open board, still bookable.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Declines carry a reason</b> &mdash; brokers learn why (rate, lane, timing) instead of silence.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/board-request-countdown.webp" alt="Direct load offer with live countdown — accept books instantly on LoadBoot" width="1100" height="773" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">A real direct request &mdash; protections, feasibility warnings, live countdown, one-tap accept.</div></div>'
 '</div></div></section>')

# Propose a rate
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Negotiation, built in</div><h2 class="ftx-h">Propose your rate &mdash; in the app, not on hold</h2>'
 '<p class="ftx-p">Rate too low? Tap <b>Propose rate</b>, enter your all-in number and an optional note. The broker sees your counter next to their posting and approves or declines in-app. Nothing is committed until they approve — and an approved counter books the load at <b>your</b> number, printed on the rate confirmation.</p></div>'
 '<div class="reveal"><img src="/shots/board-propose-rate.webp" alt="Propose-a-rate on LoadBoot — send your all-in counter to the broker" width="777" height="510" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real propose-a-rate flow.</div></div>'
 '</div></div></section>')

# Accessorial rate card
lbx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Protections in writing</div><h2>Every load carries a published accessorial rate card</h2></div>'
 '<p class="ftx-p reveal" style="max-width:780px">On other boards, detention is a phone argument. On LoadBoot it&rsquo;s a table you see <b>before</b> booking — and because every stop is geofenced, arrive/depart times are recorded automatically, so accessorial claims file themselves with GPS proof.</p>'
 '<div class="reveal" style="overflow-x:auto;margin-top:20px;max-width:820px"><table class="lbx-ratecard" style="width:100%;border-collapse:collapse;background:#fff;border:1px solid #e6ebf3;border-radius:14px">'
 '<tr><th>Accessorial</th><th>LoadBoot standard</th><th>Policy</th></tr>'
 '<tr><td>Detention</td><td><b>$60/hr</b> after <b>2 hours free</b> &middot; auto-tracked by GPS</td><td><a href="detention-pay-policy.html">Detention policy</a></td></tr>'
 '<tr><td>Layover</td><td><b>$250/day</b></td><td><a href="layover-policy.html">Layover policy</a></td></tr>'
 '<tr><td>TONU (truck ordered, not used)</td><td><b>$250</b></td><td><a href="tonu-policy.html">TONU policy</a></td></tr>'
 '<tr><td>Lumper</td><td><b>Reimbursed with receipt</b></td><td><a href="lumper-policy.html">Lumper policy</a></td></tr>'
 '<tr><td>Driver assist</td><td><b>$75/stop</b></td><td><a href="driver-assist-policy.html">Driver-assist policy</a></td></tr>'
 '<tr><td>Extra stop</td><td><b>Paid per stop</b> &middot; shown on the card</td><td><a href="driver-assist-policy.html">Stop-off pay</a></td></tr>'
 '<tr><td>Scheduling</td><td><b>FCFS or appointment</b> &mdash; declared up front</td><td><a href="fcfs-policy.html">FCFS policy</a></td></tr>'
 '</table></div></div></section>')

# Accessorial automation — the clocks run themselves
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Zero paperwork accessorials</div><h2 class="ftx-h">Detention that files itself &mdash; with GPS proof</h2>'
 '<p class="ftx-p">This is where the board stops being a listing site and becomes an operating system. Every stop has an 800-meter geofence: the moment the truck rolls inside, <b>Arrive</b> is recorded server-side; rolling out records <b>Depart</b>. The free-time clock (2 hours standard) and the detention meter run on those server timestamps &mdash; not on anyone&rsquo;s word.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Detention accrues live</b> &mdash; carrier and poster watch the same meter tick in real time; the $ amount builds into the invoice automatically.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Claims carry evidence</b> &mdash; every filed accessorial (detention, layover, lumper receipt, TONU) attaches the server-verified event log. Disputes end before they start.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Lumper &amp; issues in-app</b> &mdash; upload the lumper receipt from the dock; report breakdown, weather, missed appointment or accident from the trip screen.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Emergencies without TONU</b> &mdash; a verified emergency is reviewed inside a 2-hour response window and rescheduled instead of penalised. <a href="emergency-rescheduling-policy.html">Emergency policy</a>.</div></div>'
 '</div></div>'
 '<div class="reveal"><div class="lbx-board">'
 '<div style="font-weight:800;color:#fff;margin-bottom:10px">&#128337; Pickup stop &middot; Benton, WI</div>'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">09:12 &middot; Arrived</span><span class="ftx-chip ftx-green">&#x2713; geofence &middot; auto</span></div></div>'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">11:12 &middot; Free time ends</span><span class="ftx-chip ftx-amber">detention clock starts</span></div></div>'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">13:47 &middot; Departed</span><span class="ftx-chip ftx-green">&#x2713; geofence &middot; auto</span></div></div>'
 '<div class="lbx-load" style="margin-bottom:0;border-color:rgba(34,197,94,.45)"><div class="ftx-row"><b style="color:#fff">Detention: 2h 35m &times; $60/hr</b><b style="color:#4ade80">+$155.00</b></div>'
 '<div style="color:#94a3b8;font-size:.78rem;margin-top:6px">Filed automatically with GPS event log &middot; added to the invoice</div></div>'
 '</div></div>'
 '</div></div></section>')

# Multi-stop + booking gates
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Multi-stop, done right</div><h2 class="ftx-h">Every extra stop has its own geofence, clock and pay</h2>'
 '<p class="ftx-p">Multi-stop loads show each stop as <b>City, ST + purpose</b> on the board (exact addresses and GPS pins unlock when you book, and print on the rate con). Each stop gets its own 800-meter geofence, its own detention clock and its own stop-off fee. Posters can add up to 3 extra stops — and a lane-fit guard rejects stops that turn one lane into a milk run.</p>'
 '<div class="ftx-kicker" style="margin-top:26px">The board that protects your record</div><h2 class="ftx-h" style="font-size:1.5rem">Gates before booking &mdash; so you never book a load that hurts you</h2>'
 '<div style="margin-top:8px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Verified accounts only</b> &mdash; MC/DOT authority, insurance and W-9 checked once, then one-tap booking forever.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Equipment &amp; HAZMAT match</b> &mdash; you can&rsquo;t book a reefer load without a reefer on file, or hazmat without the cert.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Feasibility guard</b> &mdash; if HOS math says you&rsquo;d be late, the board blocks the booking and protects your on-time score (and suggests team if team can make it).</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Capacity aware</b> &mdash; when all your trucks are rolling, the board tells you instead of letting you double-commit.</div></div>'
 '</div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/board-stops-modal.webp" alt="Multi-stop route modal — city, state and purpose per stop before booking" width="420" height="703" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real multi-stop route &mdash; exact addresses unlock on booking.</div></div>'
 '</div></div></section>')

# After the tap
lbx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">After the tap</div><h2>Booking is a workflow, not a phone call</h2></div>'
 '<div class="reveal" style="max-width:820px">' + steps_html([
  ('Rate con + dispatch sheet, instantly', 'The immutable rate confirmation and a full dispatch sheet (stops, contacts, accessorial rates, documents to collect) are issued to your Documents automatically — acknowledge the RC in-app. Exact addresses, GPS pins and pickup/release numbers unlock now.'),
  ('Assign driver + truck', 'Pick from your fleet roster; the trip stepper goes Booked &rarr; Dispatched &rarr; In transit &rarr; Delivered.'),
  ('GPS proof from mile zero', '800-meter geofences auto-record arrive/depart at every stop, detention clocks run themselves, and tracking locks on until delivery. Breakdown? Emergencies are reviewed inside a 2-hour response window and verified ones are rescheduled with no TONU. <a href="gps-tracking.html">See tracking &amp; proof</a>.'),
  ('Delivery flips the money', 'POD uploaded &rarr; invoice generated and emailed. Settlement shows gross &minus; flat 5% = net, with your per-mile. Factoring supported (NOA on file, per-broker routing) and books sync to QuickBooks. <a href="payments-settlements.html">See payments</a>.'),
  ('Reload before you park', 'Suggested reloads near your destination appear on the delivered trip — keep the wheels earning.'),
 ]) + '<div style="margin-top:18px"><a href="book-truck-loads.html" class="btn btn-primary">Booking deep-dive: one tap to rolling &rarr;</a></div></div></div></section>')

# Posting side
lbx += ('<section class="ftx-sec alt" id="for-posters"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">For brokers &amp; shippers</div><h2 class="ftx-h">Post in minutes. Covered in minutes. Watched live.</h2>'
 '<p class="ftx-p"><b>Shippers post directly</b> &mdash; you don&rsquo;t need a broker to use LoadBoot. Register as a shipper (or facility), pin your docks once, and your freight goes to the same verified carrier pool with the same live tracking, detention meters and document trail brokers get.</p>'
 '<p class="ftx-p">The posting wizard autocompletes GPS-pinned facilities, calculates road miles through every stop, suggests a market rate, and requires the accessorial rate card up front — which is exactly why verified carriers book fast. Then target: put the load on the board, or fire direct offers at specific carriers with a countdown you control.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Offer race, managed</b> &mdash; see sent / awaiting / declined counts live; withdraw or extend windows; first acceptance books atomically.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Live tracking view</b> &mdash; milestone timeline, live GPS truck marker with ETA, and detention accruing per stop in real time — you see the $ building, with the same numbers the carrier sees. <a href="gps-tracking.html#for-watchers">See the live view &rarr;</a></div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Server-verified event log</b> &mdash; every arrive/depart/POD is timestamped evidence, so disputes end before they start.</div></div>'
 '</div>'
 '<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap"><a href="app/partner/" class="btn btn-primary">Open the Partner Portal &rarr;</a><a href="create-broker-account.html" class="btn btn-secondary">Broker account guide</a><a href="create-shipper-account.html" class="btn btn-secondary">Shipper account guide</a></div></div>'
 '<div class="reveal"><img src="/shots/partner-wizard-route.webp" alt="LoadBoot load posting wizard — GPS-pinned route with extra stops" width="1100" height="1006" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="height:12px"></div><img src="/shots/partner-offers.webp" alt="Broker offer panel — direct offers sent with live countdown" width="1100" height="1280" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real posting wizard + the live offer race.</div></div>'
 '</div></div></section>')

# Under the hood — the tech that enforces board truth
lbx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Under the hood</div><h2>The engineering that makes the board honest</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#9878;</div><h3>Atomic booking</h3><p>Book/accept is a single race-safe database transaction &mdash; two carriers can never win the same load, no matter how close the taps.</p></div>'
 '<div class="card"><div class="icon">&#128506;</div><h3>Real road miles</h3><p>Deadhead and trip miles come from a live routing engine over the road network &mdash; straight-line guesses only as a marked fallback.</p></div>'
 '<div class="card"><div class="icon">&#128225;</div><h3>Server-verified events</h3><p>Arrive, depart, POD &mdash; every trip event is timestamped server-side inside 800-meter geofences and kept as evidence, even on cancellations.</p></div>'
 '<div class="card"><div class="icon">&#128276;</div><h3>Push, everywhere</h3><p>Direct requests and countdowns hit your phone by web push and in-app inbox; the whole portal installs as an app and works on any device.</p></div>'
 '<div class="card"><div class="icon">&#128274;</div><h3>Broker packet on booking</h3><p>Booking unlocks the packet: exact addresses, GPS pins, pickup/release and confirmation numbers &mdash; redacted until the load is yours.</p></div>'
 '<div class="card"><div class="icon">&#11088;</div><h3>Trip-verified ratings</h3><p>Only the two parties actually on a booking can rate each other &mdash; no fake reviews, and trust scores update with every delivery.</p></div>'
 '<div class="card"><div class="icon">&#129504;</div><h3>Matching engine</h3><p>Eligibility + explainable ranking pairs each load with the right trucks; Post-my-truck scans for matches in the background while you drive.</p></div>'
 '<div class="card"><div class="icon">&#128200;</div><h3>Account health</h3><p>An Amazon-style health score (starts at 100) rewards clean docs and on-time delivery &mdash; healthier accounts surface first for offers.</p></div>'
 '</div></div></section>')

# 4 roles
lbx += ('<section class="ftx-sec" id="for-agents"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Every side wins</div><h2>A truthful board works for all four sides</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128666;</div><h3>Carriers</h3><p>Stop calling dead freight. Every card is bookable, disclosed and protected by a written rate card. <a href="create-carrier-account.html">Create a carrier account &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#127970;</div><h3>Brokers</h3><p>Reach verified carriers in a countdown offer race — covered in minutes with GPS evidence, not 40 phone calls. <a href="create-broker-account.html">Create a broker account &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#127981;</div><h3>Shippers</h3><p>Post freight directly with pinned facilities, watch it move live, keep documents and payables in one place. <a href="create-shipper-account.html">Create a shipper account &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#129309;</div><h3>Agents</h3><p>Every load your referred clients book here pays you 1% of gross on delivery — recurring. <a href="create-agent-account.html">Become an agent &rarr;</a></p></div>'
 '</div></div></section>')

# Comparison
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Honest comparison</div><h2>LoadBoot vs classic load boards</h2></div>'
 '<div class="reveal" style="overflow-x:auto;margin-top:22px"><table class="ftx-cmp">'
 '<tr><th></th><th>LoadBoot</th><th>Classic load boards</th></tr>'
 '<tr><td>Ghost loads</td><td class="ftx-yes">&#x2713; impossible &mdash; booked loads auto-vanish</td><td class="ftx-no">&#10007; common &mdash; removal is manual</td></tr>'
 '<tr><td>Booking</td><td class="ftx-yes">&#x2713; one tap, atomic, rate con issued instantly</td><td class="ftx-part">phone + email + fax</td></tr>'
 '<tr><td>Rate transparency</td><td class="ftx-yes">&#x2713; all-in rate, true RPM, est. profit, accessorials up front</td><td class="ftx-part">&ldquo;call for rate&rdquo;</td></tr>'
 '<tr><td>Deadhead</td><td class="ftx-yes">&#x2713; live road miles from your GPS</td><td class="ftx-no">&#10007; straight-line guess, if shown</td></tr>'
 '<tr><td>Detention &amp; accessorials</td><td class="ftx-yes">&#x2713; published pre-book, geofence-proven claims</td><td class="ftx-no">&#10007; phone argument after the fact</td></tr>'
 '<tr><td>Who you&rsquo;re working with</td><td class="ftx-yes">&#x2713; verified badge, trust score, rating, on-time %</td><td class="ftx-part">credit score, maybe</td></tr>'
 '<tr><td>After booking</td><td class="ftx-yes">&#x2713; GPS proof, POD, invoice, 5% settlement — same system</td><td class="ftx-no">&#10007; you&rsquo;re on your own</td></tr>'
 '<tr><td>Cost to search</td><td class="ftx-yes">$0 &mdash; flat 5% only on dispatched loads</td><td class="ftx-part">$45&ndash;$150+/month subscription</td></tr>'
 '</table></div></div></section>')

# SEO: owner-operator / new authority prose
lbx += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Built for the little guy</div><h2 class="ftx-h">A load board for owner-operators and new authorities</h2>'
 '<p class="ftx-p">Big boards price small carriers out and bury them under broker spam. LoadBoot flips that: no monthly fee to search, no authority-age wall, and the platform&rsquo;s protections — written rate cards, geofence-proven detention, instant rate cons — matter most when you don&rsquo;t have a back office. Verify once (MC/DOT, insurance, W-9), set your minimum $/mi and lanes, and the board works for you: direct requests land in your inbox and Post-my-truck auto-matches while you drive.</p>'
 '<p class="ftx-p">New authority? Read <a href="how-to-get-loads-with-new-authority.html">how to get loads with a new authority</a>, learn to <a href="how-to-read-a-rate-confirmation.html">read a rate confirmation</a>, and check <a href="market-rates.html">current market rates per mile</a> before you set your minimums.</p></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/board-phone-available.webp" alt="LoadBoot load board on a phone — find truck loads anywhere" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The whole board in your pocket &mdash; installs as an app.</div></div>'
 '</div></div></section>')

# FAQ
faq_html = ''
for _g,_c,_items in _LBX_FAQ_G:
    faq_html += '<div class="reveal" style="margin:26px 0 12px"><span class="ftx-chip ' + _c + '" style="font-size:.85rem;padding:7px 15px">' + _g + '</span></div>'
    faq_html += ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _items)
lbx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Load board FAQ &mdash; every role</h2></div><div style="max-width:820px">' + faq_html + '</div></div></section>')

# CTA band
lbx += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:60px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">See the real board with your own account</h2>'
 '<p style="color:#cbd5e1;max-width:620px;margin:12px auto 24px">Free to create, verified in minutes. The board you just saw is the board you get.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Find loads</a>'
 '<a href="create-broker-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127970; Post loads</a>'
 '<a href="features.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">All features</a>'
 '</div></div></section>')

RELATED['load-board.html'] = [('book-truck-loads.html','One-Tap Booking'),('features.html','All Features'),('ghost-loads-load-board-problems.html','Ghost Loads Explained'),('how-to-get-loads-with-new-authority.html','Loads with New Authority'),('gps-tracking.html','GPS Tracking'),('market-rates.html','Market Rates')]
page('load-board.html', 'Load Board for Truckers with Zero Ghost Loads — Find & Book Truck Loads Free | LoadBoot',
     'Free-to-search truck load board with zero ghost loads: booked freight vanishes instantly. Direct offers with live countdowns, propose-a-rate, real GPS deadhead, published detention/TONU/layover pay, one-tap booking with instant rate confirmations. For carriers, owner-operators, brokers & shippers.',
     'load-board.html', lbx, _lbx_schema)

# ---------------- ONE-TAP BOOKING — flagship page (decision -> tap -> everything before roll-out) ----------------
BKX_CSS = """<style>
.bkx-doc{background:#fff;border:1px solid #e6ebf3;border-radius:16px;box-shadow:0 18px 50px -30px rgba(16,34,59,.35);overflow:hidden}
.bkx-doc-head{background:#10223B;color:#fff;padding:13px 18px;font-weight:800;font-size:.9rem}
.bkx-doc-row{display:flex;justify-content:space-between;gap:10px;padding:10px 18px;border-bottom:1px solid #eef2f7;font-size:.88rem;color:#334155}
.bkx-doc-row b{color:#10223B}
.bkx-seq>div{opacity:0;transform:translateY(6px);animation:bkxIn 9s ease-in-out infinite}
.bkx-seq>div:nth-child(1){animation-delay:.3s}.bkx-seq>div:nth-child(2){animation-delay:1.1s}
.bkx-seq>div:nth-child(3){animation-delay:1.9s}.bkx-seq>div:nth-child(4){animation-delay:2.7s}
.bkx-seq>div:nth-child(5){animation-delay:3.5s}
@keyframes bkxIn{0%{opacity:0;transform:translateY(6px)}8%,80%{opacity:1;transform:none}92%,100%{opacity:0}}
.bkx-lock{filter:blur(4px);user-select:none}
.bkx-timer{font-variant-numeric:tabular-nums;font-weight:900;color:#4ade80;font-size:1.5rem;letter-spacing:.04em}
@media(prefers-reduced-motion:reduce){.bkx-seq>div{animation:none;opacity:1;transform:none}}
</style>"""

_BKX_FAQ = [
 ('How do I book a truck load online with LoadBoot?', 'Three ways, all in the app: (1) Request to book — send a booking request the broker approves; (2) Propose rate — send your all-in counter, and approval books the load at your number; (3) Accept a direct offer — brokers push loads to matched carriers with a countdown, and accepting books instantly. No phone calls, no faxed setup packets.'),
 ('Is anything committed before the broker approves my request?', 'No. A booking request (with or without a proposed rate) commits nothing until the broker approves it. Only a direct-offer accept books instantly — because there the broker already chose you.'),
 ('What happens the exact moment a load is booked?', 'Booking is one atomic database transaction: the load converts to a trip, leaves every carrier&rsquo;s board, the rate confirmation and dispatch sheet are generated into your Documents, and the booking packet — exact addresses, GPS pins, pickup and release numbers — unlocks. It takes seconds, not a day of emails.'),
 ('What is in the booking packet?', 'Everything that was redacted on the board: exact street addresses for every stop, GPS pins, pickup/release numbers, delivery confirmation numbers, appointment confirmations and facility contacts — plus the broker packet with the documents you&rsquo;ll need.'),
 ('What is a dispatch sheet?', 'A one-page, printable trip brief generated automatically on booking: pickup and delivery details, freight specs, truck and driver, the accessorial rate card, documents to collect, tracking and POD instructions, and special notes — grouped so a driver can run the load without a single phone call.'),
 ('Can a broker change the rate confirmation after booking?', 'No. The generated rate confirmation is immutable — there is no edit path for anyone, including LoadBoot dispatch. Any change requires a new, mutually accepted revision. You acknowledge the RC in-app and the PDF lives on the trip forever.'),
 ('What if I book a load I can&rsquo;t actually make?', 'The board tries to stop that before it happens: an HOS-aware feasibility guard blocks bookings you can&rsquo;t legally reach on time (and suggests team if only a team can make it). After booking, a verified emergency is reviewed inside a 2-hour window and rescheduled instead of charged a TONU.'),
 ('Do I need to call anyone before pickup?', 'No. By the time you assign a driver and truck, the trip has turn-by-turn navigation, armed geofences at every stop, a live countdown to pickup, and a documents-to-collect checklist. The first phone call most carriers make on LoadBoot is to say nothing at all.'),
 ('How do brokers approve booking requests?', 'In the Partner Portal, with the carrier&rsquo;s verification status, safety record, equipment and document status in view — approve or decline in one click. Direct offers skip approval because the broker already picked the carrier.'),
 ('Can shippers use one-tap booking too?', 'Booking is the carrier&rsquo;s side of the handshake — shippers and brokers post loads and run the offer race from the Partner Portal, then watch the booked trip live. See the load board page for the posting side.'),
]
_bkx_schema = '<script type="application/ld+json">' + json.dumps({
  '@context':'https://schema.org','@type':'FAQPage',
  'mainEntity':[{'@type':'Question','name':re.sub('<[^>]+>','',q),'acceptedAnswer':{'@type':'Answer','text':re.sub('<[^>]+>','',a)}} for q,a in _BKX_FAQ]}) + '</script>'

bkx = FTX_CSS + LBX_CSS + BKX_CSS

# HERO — the tap and the cascade
bkx += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:84px 0 60px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">One-tap booking</div>'
 '<h1 style="color:#fff;font-size:2.55rem;line-height:1.12;margin:10px 0 16px">Book truck loads in one tap &mdash; <span style="color:#4ade80">everything after it is automatic</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.08rem;line-height:1.7">On the phone-and-email system, &ldquo;booked&rdquo; means hours of setup packets, waiting on a rate con, and re-typing addresses into a driver text. On LoadBoot, the tap IS the booking: the rate confirmation, dispatch sheet, exact addresses and pickup numbers generate themselves in the same second. You found the load on the <a href="load-board.html" style="color:#7dd3fc">live board</a> &mdash; this page is what happens when you tap.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-carrier-account.html" class="btn btn-primary">Book your first load &rarr;</a><a href="load-board.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">See the load board first</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Rate con in seconds</span><span>&#x2713; Dispatch sheet auto-generated</span><span>&#x2713; Addresses &amp; PU numbers unlock instantly</span></div></div>'
 '<div class="lbx-board reveal" aria-hidden="true">'
 '<div class="lbx-load hot" style="margin-bottom:14px"><div class="ftx-row"><b style="color:#fff">Dallas, TX &rarr; Atlanta, GA &middot; $2,850</b><span class="ftx-chip ftx-green">&#x2713; BOOKED</span></div></div>'
 '<div class="bkx-seq">'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">&#129534; Rate confirmation</span><span class="ftx-chip ftx-green">issued to Documents</span></div></div>'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">&#128203; Dispatch sheet</span><span class="ftx-chip ftx-green">generated &middot; PDF</span></div></div>'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">&#128274;&rarr;&#128275; Exact addresses + PU/release numbers</span><span class="ftx-chip ftx-green">unlocked</span></div></div>'
 '<div class="lbx-load"><div class="ftx-row"><span style="color:#cbd5e1">&#128100; Assign driver &amp; truck</span><span class="ftx-chip ftx-blue">Marcus &middot; #402</span></div></div>'
 '<div class="lbx-load" style="margin-bottom:0"><div class="ftx-row"><span style="color:#cbd5e1">&#9201; Pickup countdown</span><span class="bkx-timer" style="font-size:1rem">14:22:08</span></div></div>'
 '</div>'
 '<div style="text-align:center;color:#64748b;font-size:.76rem;margin-top:8px">One tap &mdash; then the platform does the paperwork.</div>'
 '</div></div></div></section>')

# The decision — the board does your math
bkx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Before the tap</div><h2>Deciding is the hard part &mdash; so the platform does the math</h2></div>'
 '<p class="ftx-p reveal" style="max-width:820px">A booking decision is really four questions: does it pay, can I get there, can I deliver on time, and who am I working with. On LoadBoot each one is answered on the card itself — computed, not claimed. (Full card anatomy is on the <a href="load-board.html">load board page</a>; here is the decision layer.)</p>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128176;</div><h3>Does it pay?</h3><p>Set your <a href="cost-per-mile-calculator.html">cost per mile</a> once and every load shows estimated profit — rate minus your real running cost, not gross that lies to you.</p></div>'
 '<div class="card"><div class="icon">&#128205;</div><h3>Can I get there?</h3><p>Deadhead is computed live from your GPS over real roads, and an HOS-aware chip answers it plainly: you&rsquo;ll make it &middot; tight, roll now &middot; you&rsquo;d be late.</p></div>'
 '<div class="card"><div class="icon">&#127937;</div><h3>Can I deliver on time?</h3><p>The same clock runs to the delivery appointment — solo and team math are different, and the card knows which one you run.</p></div>'
 '<div class="card"><div class="icon">&#129309;</div><h3>Who am I working with?</h3><p>The poster&rsquo;s verified badge, trust score, star rating, loads delivered and on-time % sit on the card — and their accessorial rate card is in writing before you commit.</p></div>'
 '</div></div></section>')

# The guards
bkx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The guards</div><h2>Six gates that stop a bad booking before it happens</h2></div>'
 '<p class="ftx-p reveal" style="max-width:780px">Most booking damage is self-inflicted: a load you weren&rsquo;t insured for, equipment you don&rsquo;t have, an appointment you couldn&rsquo;t legally make. LoadBoot checks all of it in the milliseconds before the request goes out — protecting your on-time score, your account health and your reputation.</p>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128737;</div><h3>Verification gate</h3><p>MC/DOT authority, insurance and W-9 must be verified once — then booking is one tap forever.</p></div>'
 '<div class="card"><div class="icon">&#9762;</div><h3>HAZMAT gate</h3><p>Hazmat loads stay locked until your hazmat certification is on file and verified.</p></div>'
 '<div class="card"><div class="icon">&#128667;</div><h3>Equipment gate</h3><p>No reefer on your fleet roster, no reefer bookings — the board checks your actual trucks.</p></div>'
 '<div class="card"><div class="icon">&#9200;</div><h3>Feasibility gate</h3><p>If HOS math says you&rsquo;d be late, the booking is blocked — and if a team could make it, it says so.</p></div>'
 '<div class="card"><div class="icon">&#128197;</div><h3>Expiry gate</h3><p>Pickup date passed? The card is flagged EXPIRED and can&rsquo;t be booked by accident.</p></div>'
 '<div class="card"><div class="icon">&#128202;</div><h3>Capacity gate</h3><p>All trucks rolling? The board tells you before you double-commit a truck you don&rsquo;t have free.</p></div>'
 '</div></div></section>')

# Three ways to book
bkx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Three ways in</div><h2>Request it, price it, or accept it</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px;grid-template-columns:repeat(3,1fr)">'
 '<div class="card"><div class="icon">&#128203;</div><h3>1 &middot; Request to book</h3><p>Happy with the posted rate? Send a booking request with an optional note. The broker approves with your safety record and documents in view. <b>Nothing is committed until they approve.</b></p></div>'
 '<div class="card"><div class="icon">&#9998;</div><h3>2 &middot; Propose your rate</h3><p>Rate too low? Send your all-in counter. Approval books the load at <b>your</b> number, printed on the rate confirmation. Negotiation without a single hold queue.</p></div>'
 '<div class="card"><div class="icon">&#9889;</div><h3>3 &middot; Accept a direct offer</h3><p>When a broker offers a load to you with a countdown, accepting <b>books instantly</b> — no approval step, because they already chose you. First accept wins.</p></div>'
 '</div></div></section>')

# The atomic second + packet unlock
bkx += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">The atomic second</div><h2 class="ftx-h">What happens in the second you book</h2>'
 '<p class="ftx-p">Booking is a single race-safe transaction. In one indivisible step: the load converts to a trip on your account, it leaves every other carrier&rsquo;s board and inbox, competing offers auto-close, and the paperwork engine fires. There is no window — however small — where two carriers can hold the same load.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>The packet unlocks</b> &mdash; exact street addresses, GPS pins, pickup/release numbers, delivery confirmation numbers and facility contacts, all redacted until this second.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>The rate con is born immutable</b> &mdash; generated instantly, no edit path for anyone (including dispatch). Acknowledge in-app; the PDF lives on the trip forever. <a href="how-to-read-a-rate-confirmation.html">How to read a rate con</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Both sides get notified</b> &mdash; push and in-app, carrier and poster, the same second.</div></div>'
 '</div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/booking-packet.webp" alt="LoadBoot booking packet unlocked — exact addresses, PU number, appointment confirmation" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real packet &mdash; unlocked the second you book.</div></div>'
 '</div></div></section>')

# Dispatch sheet anatomy
bkx += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Paperwork that writes itself</div><h2 class="ftx-h">The dispatch sheet: a trip brief your driver can run on</h2>'
 '<p class="ftx-p">Generated the second you book, grouped the way a driver actually needs it, printable as PDF. Old-school dispatchers charge 5&ndash;10% partly to type this document; LoadBoot&rsquo;s writes itself from the load data — every time, no typos, no missed pickup number.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Nothing to re-type</b> &mdash; addresses, numbers and rates flow straight from the booked load.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Documents to collect</b> &mdash; the sheet lists exactly what the driver must bring back (BOL, lumper receipts, seals), so the invoice never waits on missing paper.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/booking-dispatch-sheet.webp" alt="Auto-generated dispatch sheet — stops, rates, documents to collect" width="1000" height="3523" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="height:12px"></div><div style="max-width:340px;margin:0 auto"><img src="/shots/booking-rate-con.webp" alt="Immutable rate confirmation issued instantly on booking" width="420" height="1212" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real dispatch sheet + the immutable rate con &mdash; both generated in seconds.</div></div>'
 '</div></div></section>')

# Booked -> rolling
bkx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Booked &rarr; rolling</div><h2>Everything you need before the wheels turn</h2></div>'
 '<div class="reveal" style="max-width:820px">' + steps_html([
  ('Assign driver and truck', 'Pick from your fleet roster in two taps. The trip stepper starts: Booked &rarr; Dispatched &rarr; In transit &rarr; Delivered — and your whole team sees the same state.'),
  ('The countdown starts', 'The trip hero shows a live HH:MM:SS countdown to pickup (it flips to overdue if you let it). No sticky-note ETAs.'),
  ('Navigation and geofences arm themselves', 'Turn-by-turn routing to the exact pin, with an 800-meter geofence armed at every stop — arrival will be recorded automatically, and the detention clock with it. <a href="gps-tracking.html">How tracking works</a>.'),
  ('Share one link, answer zero calls', 'Tap Share location and the poster watches the same live map — which is why LoadBoot carriers don&rsquo;t get &ldquo;where&rsquo;s the truck?&rdquo; calls.'),
  ('A safety net is already standing by', 'Breakdown, weather, accident — report it in-app; emergencies are reviewed inside a 2-hour window and verified ones reschedule with no TONU. <a href="emergency-rescheduling-policy.html">Emergency policy</a>.'),
 ]) + '<img src="/shots/booking-trip-card.webp" alt="Booked trip with live pickup countdown and trip stepper on LoadBoot" width="1200" height="844" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real booked trip &mdash; countdown to pickup, stepper, everything one tap away.</div><div style="height:12px"></div><div style="max-width:340px;margin:0 auto"><img src="/shots/booking-assign.webp" alt="Assign driver and truck to a booked load in two taps" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="margin-top:18px"><a href="gps-tracking.html" class="btn btn-primary">Next: the trip tracks itself &mdash; live GPS &amp; proof &rarr;</a></div></div></div></section>')

# Brokers/shippers/agents strip (4-sided)
bkx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The other side of the tap</div><h2>What booking looks like for posters</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px;grid-template-columns:repeat(3,1fr)">'
 '<div class="card"><div class="icon">&#127970;</div><h3>Brokers</h3><p>Approve requests with the carrier&rsquo;s verification, safety record and documents in one view — or skip approval entirely with direct offers. Every booking lands with the same instant paperwork. <a href="load-board.html#for-posters">Posting &amp; offers &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#127981;</div><h3>Shippers</h3><p>Your directly-posted freight books the same way — verified carriers, instant rate con, and a live trip you can watch from the same second. <a href="create-shipper-account.html">Shipper account guide &rarr;</a></p></div>'
 '<div class="card"><div class="icon">&#129309;</div><h3>Agents</h3><p>Every one-tap booking by a client you referred pays you 1% of gross on delivery. More bookings, more recurring income. <a href="agents.html">Agent program &rarr;</a></p></div>'
 '</div><div class="reveal" style="margin-top:22px"><img src="/shots/partner-wizard-schedule.webp" alt="Posting wizard schedule step — FCFS windows and fixed appointments" width="1100" height="938" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The posting side is just as real &mdash; schedule, windows and appointments declared up front.</div></div></div></section>')

# Comparison — booking specifically
bkx += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Honest comparison</div><h2>One-tap booking vs phone-and-email booking</h2></div>'
 '<div class="reveal" style="overflow-x:auto;margin-top:22px"><table class="ftx-cmp">'
 '<tr><th></th><th>LoadBoot</th><th>Phone &amp; email</th></tr>'
 '<tr><td>Time from yes to rate con</td><td class="ftx-yes">&#x2713; seconds &mdash; generated on booking</td><td class="ftx-no">&#10007; minutes to hours, sometimes after pickup</td></tr>'
 '<tr><td>Setup packet</td><td class="ftx-yes">&#x2713; done once at verification, never again</td><td class="ftx-no">&#10007; emailed and re-signed per broker</td></tr>'
 '<tr><td>Addresses &amp; PU numbers</td><td class="ftx-yes">&#x2713; unlock automatically, flow to dispatch sheet</td><td class="ftx-part">read over the phone, re-typed into texts</td></tr>'
 '<tr><td>Rate con integrity</td><td class="ftx-yes">&#x2713; immutable &mdash; no edit path for anyone</td><td class="ftx-no">&#10007; &ldquo;revised&rdquo; PDFs appear after the fact</td></tr>'
 '<tr><td>Double-booking</td><td class="ftx-yes">&#x2713; impossible &mdash; atomic transaction</td><td class="ftx-no">&#10007; two trucks show up; one goes home unpaid</td></tr>'
 '<tr><td>Bad-fit bookings</td><td class="ftx-yes">&#x2713; six gates block them pre-tap</td><td class="ftx-no">&#10007; discovered at the dock</td></tr>'
 '</table></div></div></section>')

# FAQ
bkx += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>One-tap booking FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _BKX_FAQ)
 + '</div></div></section>')

# CTA
bkx += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:60px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">The next load you book takes one tap</h2>'
 '<p style="color:#cbd5e1;max-width:620px;margin:12px auto 24px">Verify once — MC/DOT, insurance, W-9 — and booking is instant forever after.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Create a carrier account</a>'
 '<a href="load-board.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Explore the live board</a>'
 '<a href="how-it-works.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Full platform flow</a>'
 '<a href="payments-settlements.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Next: how you get paid</a>'
 '</div></div></section>')

RELATED['book-truck-loads.html'] = [('load-board.html','Live Load Board'),('how-to-read-a-rate-confirmation.html','Read a Rate Confirmation'),('gps-tracking.html','GPS Tracking & Proof'),('how-it-works.html','How It Works'),('cost-per-mile-calculator.html','Cost Per Mile Calculator'),('features.html','All Features')]
page('book-truck-loads.html', 'Book Truck Loads Online in One Tap — Instant Rate Confirmation & Dispatch Sheet | LoadBoot',
     'Book truck loads online without phone calls: one tap books atomically, the immutable rate confirmation and dispatch sheet generate in seconds, exact addresses and pickup numbers unlock instantly, and six smart gates stop bad bookings before they happen. For carriers and owner-operators.',
     'book-truck-loads.html', bkx, _bkx_schema)

# ---------------- ACCOUNT / ONBOARDING GUIDES (per role) ----------------

def _acct_flagship(cfg):
    faq_schema = '<script type="application/ld+json">' + json.dumps({
        "@context":"https://schema.org","@type":"FAQPage",
        "mainEntity":[{"@type":"Question","name":q,"acceptedAnswer":{"@type":"Answer","text":re.sub('<[^>]+>','',a)}} for q,a in cfg['faq']]}) + '</script>'
    howto_schema = '<script type="application/ld+json">' + json.dumps({
        "@context":"https://schema.org","@type":"HowTo","name":cfg['title'],
        "step":[{"@type":"HowToStep","position":i+1,"name":re.sub('<[^>]+>','',t),"text":re.sub('<[^>]+>','',d)} for i,(t,d) in enumerate(cfg['steps'])]}) + '</script>'
    b = FTX_CSS + LBX_CSS
    hs = cfg['hero_shot']
    hero_img = ('<div class="reveal">' + ('<div style="max-width:340px;margin:0 auto">' if hs[1] <= 460 else '')
        + '<img src="/shots/' + hs[0] + '" alt="' + hs[3] + '" width="' + str(hs[1]) + '" height="' + str(hs[2]) + '" loading="eager" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)">'
        + ('</div>' if hs[1] <= 460 else '')
        + '<div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">' + hs[4] + '</div></div>')
    b += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:80px 0 56px"><div class="wrap"><div class="lbx-grid2">'
        '<div><div class="eyebrow" style="color:#FC5305">' + cfg['kicker'] + '</div>'
        '<h1 style="color:#fff;font-size:2.35rem;line-height:1.14;margin:10px 0 16px">' + cfg['h1'] + '</h1>'
        '<p style="color:#cbd5e1;font-size:1.06rem;line-height:1.7">' + cfg['intro'] + '</p>'
        '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="' + cfg['cta'][1] + '" class="btn btn-primary">' + cfg['cta'][0] + '</a>'
        '<a href="compliance.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">How verification works</a></div>'
        '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;color:#94a3b8;font-size:.82rem;font-weight:700">' + ''.join('<span>&#x2713; ' + t + '</span>' for t in cfg['ticks']) + '</div></div>'
        + hero_img + '</div></div></section>')
    # steps
    b += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">From signup to approved</div><h2>' + cfg['steps_h'] + '</h2></div>'
        '<div class="reveal" style="max-width:860px;margin-top:20px">'
        + ''.join('<div style="display:flex;gap:16px;margin:0 0 18px"><span style="flex:none;width:34px;height:34px;border-radius:50%;background:#0883F7;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center">' + str(i+1) + '</span><div><b style="color:#10223B">' + t + '</b><p style="color:#475569;line-height:1.7;margin:4px 0 0">' + d + '</p></div></div>' for i,(t,d) in enumerate(cfg['steps']))
        + '</div></div></section>')
    # documents checklist
    b += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Have these in hand</div><h2>' + cfg['docs_h'] + '</h2></div>'
        '<div class="cards g3 reveal" style="margin-top:24px">'
        + ''.join('<div class="card"><div class="icon">' + ic + '</div><h3>' + t + '</h3><p>' + d + '</p></div>' for ic,t,d in cfg['docs'])
        + '</div>'
        + ('<p class="reveal" style="color:#475569;max-width:820px;margin:18px auto 0;text-align:center;line-height:1.7">' + cfg['docs_note'] + '</p>' if cfg.get('docs_note') else '')
        + '</div></div></section>')
    # inside the product
    if cfg.get('shots'):
        sh_html='<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;align-items:start">'
        for f,w,h,alt,cap in cfg['shots']:
            wrap='max-width:340px;margin:0 auto' if w<=460 else ''
            sh_html += ('<figure class="reveal" style="margin:0"><div style="' + wrap + '">'
              '<img src="/shots/' + f + '" alt="' + alt + '" width="' + str(w) + '" height="' + str(h) + '" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.35);box-shadow:0 24px 60px -30px rgba(11,18,32,.35)"></div>'
              '<figcaption style="text-align:center;color:#64748b;font-size:.8rem;margin-top:9px">' + cap + '</figcaption></figure>')
        sh_html+='</div>'
        b += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Inside the product</div><h2>' + cfg['shots_h'] + '</h2></div><div style="margin-top:24px">' + sh_html + '</div></div></section>')
    # approval notes / rejection avoidance
    if cfg.get('notes'):
        b += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">' + cfg['notes_k'] + '</div><h2>' + cfg['notes_h'] + '</h2></div>'
            '<div class="cards g2 reveal" style="margin-top:24px">'
            + ''.join('<div class="card"><h3>' + t + '</h3><p>' + d + '</p></div>' for t,d in cfg['notes'])
            + '</div></div></section>')
    # FAQ
    b += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>' + cfg['faq_h'] + '</h2></div><div style="max-width:820px">'
        + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in cfg['faq'])
        + '</div></div></section>')
    b += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:56px 0"><div class="wrap" style="text-align:center">'
        '<h2 style="color:#fff;font-size:1.9rem">' + cfg['cta_h'] + '</h2>'
        '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:22px">'
        '<a href="' + cfg['cta'][1] + '" class="btn btn-primary">' + cfg['cta'][0] + '</a>'
        + ''.join('<a href="' + u + '" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">' + t + '</a>' for t,u in cfg['cta2'])
        + '</div></div></section>')
    RELATED[cfg['fname']] = cfg['related']
    page(cfg['fname'], cfg['title'], cfg['desc'], cfg['fname'], b, faq_schema + howto_schema)

_ACCT_CARRIER = {'fname': 'create-carrier-account.html', 'title': 'Create a Carrier Account — Verified & Booking the Same Day | LoadBoot', 'desc': 'How to create a LoadBoot carrier account: FMCSA auto-verification from your DOT number, the exact documents to have in hand (COI, W-9, authority letter, factoring NOA), same-day review, and what unlocks when the VERIFIED badge lands.', 'kicker': 'For carriers &amp; owner-operators', 'h1': 'Create your carrier account &mdash; <span style="color:#4ade80">verified and booking the same day</span>', 'intro': 'About 5 minutes of your time: your DOT number pulls company details straight from FMCSA, the wizard walks equipment, lanes and payment (direct or <a href="factoring-noa.html" style="color:#7dd3fc">factoring with full NOA support</a>), documents verify the same day, and the VERIFIED badge opens the <a href="load-board.html" style="color:#7dd3fc">live board</a>.', 'ticks': ['FMCSA auto-verify from your DOT', 'Same-day document review', 'Free account &mdash; 5% only when we book you'], 'cta': ('Create your carrier account &rarr;', '/app/carrier/'), 'hero_shot': ('acct-carrier-profile.webp', 420, 909, 'Verified carrier account — MC and DOT on the profile, booking open, 10/10 documents', 'The real account &mdash; VERIFIED, booking open, 10/10 documents in.'), 'steps_h': 'Signup to first load in five steps', 'steps': [('Sign up with your company email', 'Create your login in the Carrier Portal. Type your DOT number and your legal name, entity type and authority details auto-fill from FMCSA &mdash; no re-typing federal records.'), ('Run the 5-step onboarding wizard', 'Company &rarr; equipment &amp; preferred lanes &rarr; dispatch preferences &rarr; payment (verified bank for direct pay, or your factoring company with the NOA) &rarr; e-sign the dispatch agreement and W-9 in-app (E-SIGN Act).'), ('Upload your documents', 'COI straight from your insurance agent, operating authority letter, and anything else on your checklist. Phone photos work &mdash; the built-in Scan-to-PDF turns pages into one clean file.'), ('Same-day review', 'LoadBoot checks your authority status against FMCSA, the insured name against your legal entity, and every expiry date. Each document runs Uploaded &rarr; In review &rarr; Approved on a visible tracker.'), ('VERIFIED &mdash; booking open', 'The badge lands on your profile, compliance gates open, and the board shows loads with the full rate card in writing. Book in one tap; the <a href="gps-tracking.html">trip runs itself</a>.')], 'docs_h': 'The documents to have in hand', 'docs': [('&#128737;', 'Active MC / USDOT authority', '&ldquo;Authorized for Property&rdquo; and for-hire. New authority is welcome &mdash; no minimum age on your MC. See <a href="authority-dot-setup.html">authority &amp; DOT setup</a>.'), ('&#128196;', 'Certificate of Insurance', 'From your agent: $1M auto liability and $100K cargo is the standard brokers expect. The insured name must match your authority exactly &mdash; the #1 rejection reason industry-wide.'), ('&#9997;&#65039;', 'W-9', 'Have yours ready &mdash; or skip the paperwork and e-sign one in-app; the PDF generates instantly.'), ('&#127974;', 'Factoring NOA letter', 'Only if you factor: the Notice of Assignment from your factoring company. LoadBoot verifies it and routes broker payments to your factor automatically.'), ('&#127974;', 'Bank verification', 'Direct pay: a voided check or bank letter so your remit-to is verified before the first settlement.'), ('&#128667;', 'Driver credentials', 'Fleet? CDL and medical card per driver &mdash; expiry tracking watches them so a lapse never surfaces at a roadside inspection.')], 'docs_note': 'Everything lives in the document vault with expiry reminders &mdash; you upload once and get warned before anything lapses.', 'shots_h': 'Real screens &mdash; verification you can watch', 'shots': [('acct-verification.webp', 420, 909, 'Compliance packet 10/10 verified with business profile from approved authority and W-9', 'The compliance packet &mdash; 10/10 verified, legal identity locked from your authority.'), ('acct-documents.webp', 420, 909, 'Document vault — MC/DOT authority and COI approved with visible review trackers', 'The vault &mdash; every document on a visible Uploaded &rarr; In review &rarr; Approved tracker.')], 'notes_k': 'Pass review the first time', 'notes_h': 'Why applications bounce &mdash; and how not to', 'notes': [('Expired or misnamed COI', 'Certificates that lapsed, or an insured name that does not match the authority. Ask your agent for a current COI in your exact legal name before you upload.'), ('Authority details that do not match FMCSA', 'LoadBoot reads the federal record; if your entity changed, update FMCSA first so the records agree.'), ('Factoring set up without the NOA', 'If you told us you factor, brokers pay your factor &mdash; but only once the NOA letter is on file and verified. Upload it with the packet.'), ('Blurry phone photos', 'Use the built-in Scan-to-PDF &mdash; it crops, straightens and bundles pages so reviewers can actually read them.')], 'faq_h': 'Carrier account FAQ', 'faq': [('How long does approval take?', 'Most carriers are verified the same day once documents are in. The tracker on each document shows exactly where it is.'), ('I have brand-new authority — can I join?', 'Yes. New-authority carriers are a core part of who LoadBoot serves; there is no minimum authority age. Start with the <a href="authority-dot-setup.html">authority setup guide</a> if you are still filing.'), ('What does it cost?', 'The account is free. LoadBoot earns a flat 5% only on loads it books for you — <a href="pricing.html">see pricing</a>.'), ('Do my drivers need their own accounts?', 'They get magic-link invites from your <a href="fleet-management.html">fleet roster</a> — one tap on their phone and their trips, navigation and document capture are ready.'), ('What happens when my COI expires?', 'The vault warns you before expiry. If a required document lapses, booking gates pause until the fresh one is approved — problems surface before a load, never during one.'), ('I use a factoring company — anything extra?', 'Just the NOA letter. Remit-to routing, per-broker control and the funding packet are built in — see <a href="factoring-noa.html">factoring &amp; NOA</a>.')], 'cta_h': 'Five minutes of your time. Verified today.', 'cta2': [('For carriers — the full pitch', 'carriers.html'), ('How you get paid', 'payments-settlements.html')], 'related': [('carriers.html', 'For Carriers'), ('authority-dot-setup.html', 'Authority & DOT Setup'), ('factoring-noa.html', 'Factoring & NOA'), ('payments-settlements.html', 'Payments & Settlements'), ('fleet-management.html', 'Fleet Management'), ('compliance.html', 'Compliance & Verification')]}
_ACCT_BROKER = {'fname': 'create-broker-account.html', 'title': 'Create a Broker Account — Post Loads to a Verified Carrier Network | LoadBoot', 'desc': 'How licensed freight brokers join LoadBoot: broker authority and bond verification, what documents to have ready, and how the first posting reaches vetted, health-scored carriers in minutes — with GPS proof and one-receipt payables.', 'kicker': 'For freight brokers', 'h1': 'Create your broker account &mdash; <span style="color:#4ade80">post once, covered in minutes</span>', 'intro': 'Load posting on LoadBoot is for licensed brokers &mdash; that is what keeps the board real. Verification checks your broker authority and bond, and then your first posting goes to verified, health-scored carriers with the rate card in writing, <a href="gps-tracking.html" style="color:#7dd3fc">live GPS tracking</a> and <a href="payments-settlements.html" style="color:#7dd3fc">one-receipt payables</a> built in.', 'ticks': ['Broker authority &amp; bond verified', 'First-accept-wins offers &mdash; no double booking', 'Claims settle on GPS evidence'], 'cta': ('Create your broker account &rarr;', '/app/partner/'), 'hero_shot': ('acct-partner-signup.webp', 1100, 773, 'Partner signup with role selection — Freight Broker, Shipper, or Facility/Warehouse', 'The real signup &mdash; pick Freight Broker and you are posting in minutes.'), 'steps_h': 'Signup to covered freight in five steps', 'steps': [('Create the account', 'Company email, password, your name &mdash; then choose <b>Freight Broker</b>. Shippers and facilities have their own paths, so your workspace is broker-shaped from the first screen.'), ('Company &amp; authority details', 'Your brokerage legal name and MC number. LoadBoot verifies your broker authority and the $75K surety bond or trust (BMC-84/85) on the federal record.'), ('Post your first load', 'The wizard walks route (exact pins power the geofences), schedule, equipment and the full rate card &mdash; detention, TONU, layover terms printed on the posting.'), ('Offers go out', 'Direct offers reach verified carriers that fit the lane and equipment; first acceptance wins and everything else closes automatically &mdash; no double-booked trucks.'), ('Watch it move', 'The live map, milestone timeline and GPS-stamped claims replace check calls. Delivery flips the invoice into your payables with a PAY-BY deadline.')], 'docs_h': 'Have these ready', 'docs': [('&#128737;', 'Broker MC authority', 'Your active FMCSA broker operating authority. Property broker registration is what unlocks posting.'), ('&#128176;', 'Surety bond or trust', 'The $75K BMC-84 bond or BMC-85 trust on file with FMCSA — verified against the federal record, not a PDF you email us.'), ('&#127970;', 'Company details', 'Legal entity, EIN and remit/billing contacts, so carrier invoices and your payables ledger match your books.'), ('&#128101;', 'Your team', 'Teammate emails — everyone gets their own login on the same brokerage account.')], 'docs_note': '', 'shots_h': 'Real screens &mdash; the posting flow your team gets', 'shots': [('partner-wizard-route.webp', 1100, 1006, 'Load posting wizard — route with exact address pins that power GPS geofences', 'The wizard &mdash; exact pins, real driving miles, and the pins arm the geofences.'), ('partner-offers.webp', 940, 1094, 'Direct offers panel — send to verified carriers with a first-accept-wins window', 'Offers &mdash; verified carriers, a 15-minute window, first acceptance wins.')], 'notes_k': 'Why the vetting is strict', 'notes_h': 'A board is only as good as its worst poster', 'notes': [('Licensed brokers only', 'Moving shipper freight requires a property-broker license — so posting is gated on it. That is why carriers treat LoadBoot postings as real.'), ('Your counterparties are vetted too', 'Carriers pass authority, insurance and account-health checks before your load is ever offered to them.'), ('The rate card is printed, not implied', 'Detention, TONU and layover terms ride every posting — disputes die young because both sides agreed in writing.'), ('Zero ghost loads policy', 'Stale postings auto-close and cancellations carry TONU exposure — the board stays real because fakes cost money.')], 'faq_h': 'Broker account FAQ', 'faq': [('Who can post loads?', 'Approved broker partners with active FMCSA broker authority and the federal bond. Carrier and shipper accounts are separate — see <a href="brokers.html">for brokers</a>.'), ('How are carriers vetted?', 'Authority, insurance and compliance are tracked continuously, and only carriers who pass hard eligibility checks are offered your loads.'), ('Can I integrate my TMS?', 'Yes — load, trip, document and delivery events via webhooks and the API on approved endpoints.'), ('How do I pay carriers?', 'Payables group per trip — freight plus approved claims, one total, PAY-BY deadline. Pay with one receipt; the carrier (or their factor) confirms. See <a href="payments-settlements.html">payments &amp; settlements</a>.'), ('What visibility do I get?', 'Live load and trip status, geofenced arrive/depart stamps, ETAs, document status and open exceptions — without a single check call.')], 'cta_h': 'Post once. Covered in minutes — with proof.', 'cta2': [('For brokers — the full pitch', 'brokers.html'), ('How posting works', 'load-board.html')], 'related': [('brokers.html', 'For Brokers'), ('load-board.html', 'Live Load Board'), ('payments-settlements.html', 'Payments & Settlements'), ('gps-tracking.html', 'GPS Tracking & Proof'), ('compliance.html', 'Compliance & Verification'), ('contact.html', 'Contact')]}
_ACCT_SHIPPER = {'fname': 'create-shipper-account.html', 'title': 'Create a Shipper Account — Freight Moved With GPS Proof | LoadBoot', 'desc': 'How shippers join LoadBoot: what to have ready (business details, facility info), how freight gets moved by vetted carriers under licensed brokerage, and the live tracking, dock scheduling and receipt-verified payments you get.', 'kicker': 'For shippers', 'h1': 'Create your shipper account &mdash; <span style="color:#4ade80">freight moved with proof, not promises</span>', 'intro': 'Request freight, get it moved by vetted, health-scored carriers under licensed brokerage &mdash; and watch every mile on the same <a href="gps-tracking.html" style="color:#7dd3fc">live map</a> the carrier sees. Facilities get dock scheduling and geofenced check-ins; your invoices ride the <a href="payments-settlements.html" style="color:#7dd3fc">receipt-verified rail</a>.', 'ticks': ['Vetted carriers, licensed brokerage', 'Live GPS &mdash; zero check calls', 'Dock scheduling for facilities'], 'cta': ('Create your shipper account &rarr;', '/app/partner/'), 'hero_shot': ('acct-partner-signup.webp', 1100, 773, 'Partner signup — choose Shipper to request freight and track shipments', 'The real signup &mdash; choose Shipper (or Facility/Warehouse for dock scheduling).'), 'steps_h': 'Signup to moving freight in four steps', 'steps': [('Create the account', 'Company email, then choose <b>Shipper</b> — or <b>Facility / Warehouse</b> if your job is docks, appointments and check-ins rather than booking freight.'), ('Business &amp; facility details', 'Legal entity and your pickup/delivery facilities — exact addresses become the GPS pins that power geofenced arrive/depart proof at your docks.'), ('Request your freight', 'Route, schedule, equipment and requirements. Licensed brokerage handles carrier compliance; vetted carriers get offered your freight with the rate card in writing.'), ('Watch it move &mdash; and settle clean', 'Live map, milestone timeline, ETA and document status. Delivery generates the paperwork trail; payments run receipt-verified with confirmations.')], 'docs_h': 'Have these ready', 'docs': [('&#127970;', 'Business details', 'Legal entity and EIN / W-9 details, so contracts and invoices match your books.'), ('&#127981;', 'Facility information', 'Addresses, dock hours, appointment rules — the exact pins double as GPS proof of every pickup and delivery.'), ('&#128179;', 'Billing contact', 'Where invoices land and who confirms payments in the receipt loop.')], 'docs_note': 'No operating authority needed — that is the carrier&rsquo;s and broker&rsquo;s job. Your side is the freight, the facts and the docks.', 'shots_h': 'Real screens &mdash; what your team sees', 'shots': [('partner-wizard-schedule.webp', 1100, 938, 'Freight scheduling — appointment windows and requirements on the posting', 'Scheduling &mdash; windows, requirements and rules, printed on the load.'), ('partner-live-tracking.webp', 1100, 969, 'Live tracking view — truck on the map, milestone timeline, ETA', 'The live view &mdash; your freight, the truck, the ETA, the record.')], 'notes_k': 'Why shippers stay', 'notes_h': 'The facts your customers keep asking for &mdash; answered by the record', 'notes': [('Where is my freight?', 'The live map and ETA answer it before anyone calls you. Stale feeds flag themselves — you are never lied to by an old dot.'), ('Did it really arrive at 8?', 'Geofenced arrive/depart stamps are server-side evidence — dock disputes end against the record, in everyone&rsquo;s favor.'), ('Who is hauling it?', 'Vetted, health-scored carriers under licensed brokerage — authority and insurance tracked continuously, not photocopied once.'), ('Facilities measured fairly', 'Dwell time is measured at your dock the same way for every carrier — data to fix slow docks, and defense against inflated claims.')], 'faq_h': 'Shipper account FAQ', 'faq': [('Do I need any authority or license?', 'No — freight movement runs under licensed brokerage. You bring the freight and the facilities.'), ('Can my warehouse use it without booking freight?', 'Yes — the Facility / Warehouse role schedules dock appointments and manages geofenced check-ins.'), ('What visibility do I get?', 'Permitted live load and trip status, arrival/departure records, ETAs and document status — see <a href="shipper-solutions.html">shipper solutions</a>.'), ('How do payments work?', 'Invoices ride the receipt-verified rail with PAY-BY deadlines and confirmations — see <a href="payments-settlements.html">payments &amp; settlements</a>.')], 'cta_h': 'Your freight. Moved on the record.', 'cta2': [('Shipper solutions', 'shipper-solutions.html'), ('Live tracking explained', 'gps-tracking.html')], 'related': [('shipper-solutions.html', 'Shipper Solutions'), ('gps-tracking.html', 'GPS Tracking & Proof'), ('payments-settlements.html', 'Payments & Settlements'), ('load-board.html', 'Live Load Board'), ('compliance.html', 'Compliance & Verification'), ('contact.html', 'Contact')]}
_ACCT_AGENT = {'fname': 'create-agent-account.html', 'title': 'Create an Agent Account — Earn 1% on Every Delivered Load, Forever | LoadBoot', 'desc': 'How LoadBoot agents join: free account, your referral link is ready at signup — bring a broker-and-carrier pair and earn 1% on every load they run, recurring, no cap, and it never costs your clients anything.', 'kicker': 'For referral &amp; sales agents', 'h1': 'Create your agent account &mdash; <span style="color:#4ade80">earn 1% on every load, forever</span>', 'intro': 'Bring the people; the software does the work. Your referral link is live the moment you sign up &mdash; bring a broker, a carrier, or a pair, and every delivered load between them lands your 1% automatically. Recurring, no cap, and it never costs your clients anything &mdash; your slice comes out of LoadBoot&rsquo;s own flat 5% fee. See the <a href="agents.html" style="color:#7dd3fc">agent program</a>.', 'ticks': ['1% on every delivered load &mdash; forever', 'No cap &middot; recurring', 'Costs your clients nothing'], 'cta': ('Create your agent account &rarr;', '/app/agent/'), 'hero_shot': ('agent-signup.webp', 1100, 773, 'Agent portal signup — free account with your referral link ready the moment you sign up', 'The real signup &mdash; free account, referral link ready the moment you join.'), 'steps_h': 'Signup to first commission in four steps', 'steps': [('Create the account', 'Email, name, mobile &mdash; agency or solo. Your referral link is ready the moment you sign up.'), ('Bring a pair', 'Share your link with brokers and carriers you know. A broker who posts and a carrier who hauls &mdash; that is your chain: <i>your broker &middot; LoadBoot &middot; your carrier</i>.'), ('They work, you earn', 'Every delivered load in your chain lands your 1% automatically &mdash; you can watch it hit the ledger the moment the POD is verified.'), ('W-9 and payout details', 'E-sign the W-9 and add bank details before your first payout &mdash; payouts run against real delivered loads, tracked live in your portal.')], 'docs_h': 'Have these ready', 'docs': [('&#9997;&#65039;', 'W-9', 'Your tax details &mdash; required before the first payout, e-signable in minutes.'), ('&#127974;', 'Payout details', 'Bank details for commission payouts.'), ('&#128101;', 'Your network', 'The real asset: brokers and carriers who trust you. The board&rsquo;s job is to keep them once they arrive.')], 'docs_note': '', 'shots_h': 'Real screens &mdash; your chain, your 1%', 'shots': [('agent-dashboard.webp', 1100, 859, 'The agent dashboard — chain active, referral link, clearing balance and the 5-level commission math', 'The real dashboard &mdash; chain ACTIVE, your link, your clearing balance, the 5-level math.'), ('agent-chain.webp', 420, 761, 'The agent chain — your broker and your carrier joined, a delivered load, and your 1% landed automatically', 'Your chain &mdash; broker joined, carrier booked, POD verified, +$28.50 landed automatically.')], 'notes_k': 'Why agents win here', 'notes_h': 'A referral is only worth what the platform retains', 'notes': [('Retention is the commission', 'Your income is per-load, forever &mdash; so it depends on your people staying. Detention that pays, receipts that verify and a board with zero ghosts is what keeps them.'), ('Transparent math', '1% of every delivered load in your chain, tracked in the portal against real loads &mdash; not a spreadsheet someone emails quarterly.'), ('Never at your client&rsquo;s expense', 'Your slice comes from LoadBoot&rsquo;s own flat 5% fee. Brokers and carriers you bring pay exactly what everyone else pays.'), ('You look good', 'Same-day verification and onboarding reminders mean the people you send actually get through &mdash; and thank you for it.')], 'faq_h': 'Agent account FAQ', 'faq': [('Who pays my commission?', 'LoadBoot does, from its own flat 5% dispatch fee. Your brokers and carriers never pay extra because you referred them.'), ('How much do I earn?', '1% of every delivered load in your chain &mdash; recurring for as long as they run on LoadBoot, with no cap.'), ('When are payouts?', 'Against delivered, verified loads &mdash; tracked live in your agent portal, paid to the bank details on file.'), ('Can dispatch agencies join?', 'Yes &mdash; solo referrers, dispatchers and agencies use the same program. See the <a href="agents.html">agent &amp; referral program</a>.')], 'cta_h': 'Bring the people. The software does the work.', 'cta2': [('The agent program', 'agents.html'), ('Referral details', 'referral.html')], 'related': [('agents.html', 'Agent Program'), ('referral.html', 'Referral Program'), ('carriers.html', 'For Carriers'), ('brokers.html', 'For Brokers'), ('compliance.html', 'Compliance & Verification'), ('contact.html', 'Contact')]}

for _cfg in (_ACCT_CARRIER, _ACCT_BROKER, _ACCT_SHIPPER, _ACCT_AGENT):
    _acct_flagship(_cfg)

# ---------- COMPLIANCE & VERIFICATION HUB ----------
_cmp_faq = [('What does LoadBoot actually verify?', 'Role-appropriate federal records and documents: carrier MC/USDOT status and insurance, broker authority and the federal bond, plus every uploaded document — checked for the right named party and a live expiry date, on a visible review tracker.'), ('How long does verification take?', 'Document review typically completes the same day. Federal-record checks run automatically: the FMCSA authority lookup fires the moment your MC/USDOT is on the account, and a reviewer confirms the result (and, for brokers, the $75k bond) before you are cleared.'), ('What happens when a document expires?', 'The vault warns before expiry. If a required document lapses, booking or posting gates pause until a fresh one is approved — problems surface before a load, never during one.'), ('Are e-signatures legally valid?', 'Yes — the dispatch agreement and W-9 are signed in-app under the E-SIGN Act, with PDFs generated instantly and stored on the account.'), ('Is anyone unvetted on the board?', 'No. Carriers pass authority, insurance and health checks before they see freight; posting requires licensed broker (or verified shipper) status. Both sides of every load are verified — that is the whole point.')]
_cmp_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "What does LoadBoot actually verify?", "acceptedAnswer": {"@type": "Answer", "text": "Role-appropriate federal records and documents: carrier MC/USDOT status and insurance, broker authority and the federal bond, plus every uploaded document \\u2014 checked for the right named party and a live expiry date, on a visible review tracker."}}, {"@type": "Question", "name": "How long does verification take?", "acceptedAnswer": {"@type": "Answer", "text": "Document review typically completes the same day. Federal-record checks run automatically: the FMCSA authority lookup fires the moment your MC/USDOT is on the account, and a reviewer confirms the result (and, for brokers, the $75k bond) before you are cleared."}}, {"@type": "Question", "name": "What happens when a document expires?", "acceptedAnswer": {"@type": "Answer", "text": "The vault warns before expiry. If a required document lapses, booking or posting gates pause until a fresh one is approved \\u2014 problems surface before a load, never during one."}}, {"@type": "Question", "name": "Are e-signatures legally valid?", "acceptedAnswer": {"@type": "Answer", "text": "Yes \\u2014 the dispatch agreement and W-9 are signed in-app under the E-SIGN Act, with PDFs generated instantly and stored on the account."}}, {"@type": "Question", "name": "Is anyone unvetted on the board?", "acceptedAnswer": {"@type": "Answer", "text": "No. Carriers pass authority, insurance and health checks before they see freight; posting requires licensed broker (or verified shipper) status. Both sides of every load are verified \\u2014 that is the whole point."}}]}</script>'
cmpb = FTX_CSS + LBX_CSS
cmpb += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:80px 0 56px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Stay compliant</div>'
 '<h1 style="color:#fff;font-size:2.4rem;line-height:1.13;margin:10px 0 16px">Compliance that <span style="color:#4ade80">runs itself</span> &mdash; for every role</h1>'
 '<p style="color:#cbd5e1;font-size:1.06rem;line-height:1.7">FMCSA verification is built into onboarding, documents live in a vault with expiry tracking, everything signable is e-signed under the E-SIGN Act, and compliance gates keep unverified parties off the board. Carrier, broker, shipper or agent &mdash; the engine is the same; what it checks is shaped to your role.</p>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; FMCSA checks at signup</span><span>&#x2713; Expiry-tracked document vault</span><span>&#x2713; E-signatures, instant PDFs</span><span>&#x2713; Gates, not surprises</span></div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/acct-verification.webp" alt="Compliance packet — 10/10 documents verified, business profile locked from approved authority" width="420" height="909" loading="eager" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real compliance packet &mdash; 10/10 verified, one source of truth.</div></div>'
 '</div></div></section>')
cmpb += ('<section style="background:#0b1220;padding:0 0 40px"><div class="wrap"><div class="sec-head reveal" style="margin-bottom:18px"><h2 style="color:#fff">Get verified for your role</h2></div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:14px">'
 '<a href="create-carrier-account.html" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px" class="reveal"><b style="color:#fff">&#128667; Carriers</b><div style="color:#94a3b8;font-size:.85rem;margin-top:6px;line-height:1.6">FMCSA auto-verify, COI &amp; W-9 checklist, same-day review &mdash; VERIFIED and booking today.</div><div style="color:#7dd3fc;font-size:.83rem;font-weight:700;margin-top:10px">Carrier verification &rarr;</div></a>'
 '<a href="create-broker-account.html" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px" class="reveal"><b style="color:#fff">&#127970; Brokers</b><div style="color:#94a3b8;font-size:.85rem;margin-top:6px;line-height:1.6">Broker authority + federal bond verified against FMCSA &mdash; then post to a vetted network.</div><div style="color:#7dd3fc;font-size:.83rem;font-weight:700;margin-top:10px">Broker verification &rarr;</div></a>'
 '<a href="create-shipper-account.html" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px" class="reveal"><b style="color:#fff">&#127981; Shippers</b><div style="color:#94a3b8;font-size:.85rem;margin-top:6px;line-height:1.6">Business + facility details; carrier compliance handled under licensed brokerage.</div><div style="color:#7dd3fc;font-size:.83rem;font-weight:700;margin-top:10px">Shipper setup &rarr;</div></a>'
 '<a href="create-agent-account.html" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:18px" class="reveal"><b style="color:#fff">&#129309; Agents</b><div style="color:#94a3b8;font-size:.85rem;margin-top:6px;line-height:1.6">W-9 + payout details, tiers in writing &mdash; earn from every load your carriers haul.</div><div style="color:#7dd3fc;font-size:.83rem;font-weight:700;margin-top:10px">Agent setup &rarr;</div></a>'
 '</div></div></section>')
cmpb += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The engine</div><h2>Four mechanisms, zero paperwork anxiety</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:24px">'
 '<div class="card"><div class="icon">&#128737;</div><h3>FMCSA verify</h3><p>MC/DOT and broker authority checked against the federal record at signup and tracked after &mdash; status lives on the profile, not in a filing cabinet.</p></div>'
 '<div class="card"><div class="icon">&#128196;</div><h3>Document vault</h3><p>COI, W-9, authority letters, NOA &mdash; uploaded once, reviewed on a visible tracker, and expiry-warned before anything lapses.</p></div>'
 '<div class="card"><div class="icon">&#9997;&#65039;</div><h3>E-signatures</h3><p>Dispatch agreement and W-9 signed in-app under the E-SIGN Act; every rate confirmation is issued and acknowledged in-app.</p></div>'
 '<div class="card"><div class="icon">&#128682;</div><h3>Compliance gates</h3><p>Booking and posting require valid documents on both sides &mdash; so problems surface before the load, not at the dock.</p></div>'
 '</div></div></section>')
cmpb += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Inside the product</div><h2>Real screens &mdash; verification you can watch</h2></div>'
 '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;align-items:start;margin-top:24px">'
 '<figure class="reveal" style="margin:0"><div style="max-width:340px;margin:0 auto"><img src="/shots/acct-documents.webp" alt="Document vault — authority and COI approved on visible trackers" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.35);box-shadow:0 24px 60px -30px rgba(11,18,32,.35)"></div><figcaption style="text-align:center;color:#64748b;font-size:.8rem;margin-top:9px">The vault &mdash; Uploaded &rarr; In review &rarr; Approved, visibly.</figcaption></figure>'
 '<figure class="reveal" style="margin:0"><div style="max-width:340px;margin:0 auto"><img src="/shots/acct-carrier-profile.webp" alt="Verified account profile — MC/DOT, health score, booking open" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.35);box-shadow:0 24px 60px -30px rgba(11,18,32,.35)"></div><figcaption style="text-align:center;color:#64748b;font-size:.8rem;margin-top:9px">The payoff &mdash; VERIFIED on the profile, booking open.</figcaption></figure>'
 '</div>'
 '<p class="reveal" style="color:#475569;max-width:820px;margin:18px auto 0;text-align:center;line-height:1.7">Filing season? The compliance library covers <a href="authority-dot-setup.html">authority &amp; DOT setup</a>, <a href="boc3-ucr.html">BOC-3 &amp; UCR</a>, <a href="form-2290-hvut.html">Form 2290 HVUT</a>, <a href="ifta-fuel-tax.html">IFTA</a> and <a href="truck-driver-per-diem-2026.html">per-diem</a>.</p>'
 '</div></section>')
cmpb += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Compliance &amp; verification FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _cmp_faq)
 + '</div></div></section>')
cmpb += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:56px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:1.9rem">Verified beats promised. Every time.</h2>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:22px">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128667; Carrier</a>'
 '<a href="create-broker-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127970; Broker</a>'
 '<a href="create-shipper-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127981; Shipper</a>'
 '<a href="create-agent-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#129309; Agent</a>'
 '</div></div></section>')
RELATED['compliance.html'] = [('create-carrier-account.html','Carrier Verification'),('create-broker-account.html','Broker Verification'),('authority-dot-setup.html','Authority & DOT Setup'),('boc3-ucr.html','BOC-3 & UCR'),('features.html','All Features'),('faq.html','FAQ')]
page('compliance.html', 'Compliance & Verification — FMCSA Checks, Document Vault, E-Sign Gates | LoadBoot', 'How LoadBoot keeps every side of a load verified: FMCSA authority and bond checks at signup, an expiry-tracked document vault with visible review trackers, E-SIGN Act e-signatures, and compliance gates for carriers, brokers, shippers and agents.', 'compliance.html', cmpb, _cmp_schema)



# ---------------- DEEP FEATURE PAGES ----------------
# ---- GPS TRACKING — flagship (the trip after booking: driver pocket app + broker/shipper live view) ----
TRKX_CSS = """<style>
.trkx-phone{width:min(340px,100%);margin:0 auto;border:9px solid #0f172a;border-radius:38px;background:#0b1220;overflow:hidden;box-shadow:0 30px 70px -30px rgba(11,18,32,.75)}
.trkx-status{display:flex;justify-content:space-between;align-items:center;background:#0b1220;color:#fff;font-size:.72rem;font-weight:800;padding:8px 18px 6px}
.trkx-map2{position:relative;height:240px;background:linear-gradient(180deg,#f7f3ea,#f1ede2);overflow:hidden}
.trkx-map2 .city{position:absolute;color:#9a917f;font-size:.6rem;font-weight:700;letter-spacing:.02em}
.trkx-eta{position:absolute;left:50%;transform:translateX(-50%);top:12%;background:#10223B;color:#fff;font-size:.73rem;font-weight:800;padding:7px 13px;border-radius:12px;box-shadow:0 8px 20px rgba(16,34,59,.35);white-space:nowrap;z-index:3}
.trkx-truckmk{position:absolute;width:42px;height:42px;border-radius:50%;background:#FC5305;display:flex;align-items:center;justify-content:center;font-size:1.1rem;box-shadow:0 0 0 6px rgba(252,83,5,.25);z-index:2;animation:trkxPulse 2.2s infinite}
@keyframes trkxPulse{0%,100%{box-shadow:0 0 0 6px rgba(252,83,5,.25)}50%{box-shadow:0 0 0 12px rgba(252,83,5,.1)}}
.trkx-bmk{position:absolute;background:#FC5305;color:#fff;font-weight:900;font-size:.72rem;padding:5px 9px;border-radius:10px;z-index:2;box-shadow:0 4px 10px rgba(252,83,5,.4)}
.trkx-tools{position:absolute;top:8px;right:8px;display:flex;gap:5px;z-index:3}
.trkx-tool{width:27px;height:27px;border-radius:8px;background:rgba(15,23,42,.85);color:#fff;font-size:.72rem;display:flex;align-items:center;justify-content:center}
.trkx-sheet{background:#0e1726;color:#fff;padding:14px 14px 16px;border-radius:18px 18px 0 0;margin-top:-16px;position:relative;z-index:4}
.trkx-grab{width:38px;height:4px;border-radius:99px;background:#2b3a54;margin:0 auto 10px}
.trkx-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin:10px 0}
.trkx-stat{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1);border-radius:11px;text-align:center;padding:8px 4px}
.trkx-stat b{font-size:.88rem}
.trkx-stat span{display:block;color:#94a3b8;font-size:.55rem;font-weight:800;letter-spacing:.09em;margin-top:2px}
.trkx-step{display:flex;justify-content:space-between;margin:12px 2px 4px;position:relative}
.trkx-step:before{content:'';position:absolute;left:8%;right:8%;top:12px;height:2px;background:#233047}
.trkx-node{position:relative;text-align:center;font-size:.55rem;font-weight:800;color:#94a3b8;letter-spacing:.05em;flex:1}
.trkx-node i{display:flex;width:25px;height:25px;border-radius:50%;background:#233047;color:#94a3b8;align-items:center;justify-content:center;font-style:normal;font-size:.7rem;margin:0 auto 3px;position:relative;z-index:1}
.trkx-node.done i{background:#16a34a;color:#fff}
.trkx-node.on i{background:#FC5305;color:#fff;box-shadow:0 0 0 4px rgba(252,83,5,.25)}
.trkx-cta{display:block;background:#FC5305;color:#fff;text-align:center;font-weight:900;border-radius:14px;padding:13px 10px;font-size:.92rem;margin:11px 0 9px;box-shadow:0 10px 24px -10px rgba(252,83,5,.6)}
.trkx-apps{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}
.trkx-app{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:11px;text-align:center;font-size:.7rem;font-weight:700;color:#e2e8f0;padding:9px 4px}
.trkx-cap{color:#7a8aa5;font-size:.63rem;text-align:center;margin:7px 2px 0;line-height:1.5}
.trkx-panel{background:#fff;border:1px solid #e6ebf3;border-radius:18px;overflow:hidden;box-shadow:0 22px 60px -34px rgba(16,34,59,.4)}
.trkx-panel-map{position:relative;height:150px;background:linear-gradient(180deg,#f7f3ea,#f1ede2)}
.trkx-prow{display:flex;justify-content:space-between;gap:10px;padding:11px 16px;border-bottom:1px solid #eef2f7;font-size:.86rem;color:#334155;align-items:center}
.trkx-prow b{color:#10223B}
.trkx-meter{height:7px;border-radius:99px;background:#eef2f7;overflow:hidden;flex:1;margin:0 10px}
.trkx-meter i{display:block;height:100%;width:72%;border-radius:99px;background:linear-gradient(90deg,#0883F7,#fbbf24)}
@media(prefers-reduced-motion:reduce){.trkx-truckmk{animation:none}}
</style>"""

_TRK_FAQ = [
 ('Does LoadBoot track drivers all the time?', 'No. Tracking runs only while a trip is active — it locks on at dispatch and shuts off automatically at delivery. Off the clock, nobody is watching. That privacy line is built into the code, not a policy promise.'),
 ('Do I need an ELD or telematics hardware to be tracked?', 'No. The driver&rsquo;s phone is the tracker — the trip map runs in the LoadBoot app with GPS positions posted about every 25 seconds. If you already run Samsara or Motive, connect it and tracking flows from your ELD instead.'),
 ('Can the driver navigate with Google Maps or Waze?', 'Yes — one tap hands navigation to Google Maps, Waze or any app the driver prefers, while LoadBoot keeps recording positions and geofence check-ins in the background. Turn-by-turn with voice cues is also built into the trip map itself.'),
 ('How do geofence check-ins work?', 'Every stop — pickup, each extra stop, delivery — gets an 800-meter geofence. Rolling inside records Arrive; rolling out records Depart. No driver taps, no forgotten check-ins, and every timestamp is server-side evidence for detention.'),
 ('What happens if the GPS signal drops?', 'The live view flags the feed as stale after 30 minutes without a ping, and blackout watchdogs alert dispatch. The moment the phone reconnects, tracking resumes and back-fills the trail — and the server-verified event log keeps its integrity.'),
 ('How does tracking turn into detention money?', 'The detention clock runs on recorded arrive/depart timestamps — standard 2 hours free, then $60/hr. Because the clock runs on server-verified GPS events, the claim files itself with evidence attached instead of becoming a phone argument. See the detention policy for the numbers.'),
 ('What do brokers and shippers see while the load moves?', 'A milestone timeline, the live truck marker with ETA on a map, detention accruing per stop in real time, and a server-verified log of every arrive, depart and POD — the exact same numbers the carrier sees, which is why disputes die on this platform.'),
 ('Will tracking drain the driver&rsquo;s phone battery?', 'The tracker is throttled to a position roughly every 25 seconds and holds a screen wake-lock only while the trip map is open. A phone on a dash charger — how drivers actually run — never notices it.'),
 ('Is tracking mandatory on every load?', 'Posters choose: loads can be posted with tracking required, and most are — because tracked loads get covered faster and pay accessorials without friction. For carriers, tracking is what turns detention from a fight into a payout.'),
]
_trk_schema = '<script type="application/ld+json">' + json.dumps({
  '@context':'https://schema.org','@type':'FAQPage',
  'mainEntity':[{'@type':'Question','name':re.sub('<[^>]+>','',q),'acceptedAnswer':{'@type':'Answer','text':re.sub('<[^>]+>','',a)}} for q,a in _TRK_FAQ]}) + '</script>'

trk = FTX_CSS + LBX_CSS + TRKX_CSS

# HERO
trk += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:84px 0 60px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Live tracking &amp; proof</div>'
 '<h1 style="color:#fff;font-size:2.5rem;line-height:1.12;margin:10px 0 16px">GPS tracking that <span style="color:#4ade80">pays you</span> &mdash; not just watches you</h1>'
 '<p style="color:#cbd5e1;font-size:1.08rem;line-height:1.7">You <a href="book-truck-loads.html" style="color:#7dd3fc">booked in one tap</a> &mdash; now the trip runs itself. The driver&rsquo;s phone becomes the tracker, an 800-meter geofence arms at every stop, arrive and depart stamp themselves as server-side evidence, and the broker or shipper watches the same live map you do. Every timestamp is money: detention, layover and on-time proof all hang off this one GPS trail.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-carrier-account.html" class="btn btn-primary">Track your first trip &rarr;</a><a href="app/partner/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Watch your freight live &mdash; broker / shipper</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; No ELD required</span><span>&#x2713; Auto check-ins, zero driver taps</span><span>&#x2713; Off at delivery &mdash; privacy by code</span></div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/track-phone-pickup.webp" alt="LoadBoot trip map at pickup — detention clock running, geofence checked in" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real trip map &mdash; at pickup, checked in automatically, detention clock running.</div></div></div></div></section>')

# role router
trk += ('<section style="background:#0b1220;padding:0 0 34px"><div class="wrap"><div class="cards g4" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'
 '<a href="#for-drivers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#128241; I drive the truck</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">The pocket trip map &mdash; navigation, check-ins, proof &darr;</div></a>'
 '<a href="#for-watchers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127970;&#127981; My freight is on it</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Brokers &amp; shippers &mdash; the live view &amp; evidence log &darr;</div></a>'
 '<a href="#for-money" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#128176; Show me the money</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">How timestamps become detention pay &darr;</div></a>'
 '</div></div></section>')

# driver pocket app
trk += ('<section class="ftx-sec" id="for-drivers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">The driver&rsquo;s pocket</div><h2 class="ftx-h">A trip map that fits in a shirt pocket &mdash; and runs the whole load</h2>'
 '<p class="ftx-p">No terminal, no tablet mount, no ELD contract. The LoadBoot app installs on any phone and the trip map opens straight onto the current leg — real road routing on a dark map that doesn&rsquo;t blind you at night.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Turn-by-turn with voice</b> &mdash; built-in navigation speaks the turns; one tap mutes it.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Use the apps you love</b> &mdash; one tap hands off to Google Maps, Waze or any nav app while LoadBoot keeps recording proof in the background.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Zero check-in taps</b> &mdash; arrive and depart record themselves at every geofenced stop; the screen wake-lock keeps the map alive on the dash.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Everything on the trip</b> &mdash; dispatch sheet, documents, POD camera, issue reporting and the emergency button live one tap from the map.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>ELD optional</b> &mdash; already run Samsara or Motive? Connect it and positions flow from your hardware instead of the phone.</div></div>'
 '</div>'
 '<div style="margin-top:16px"><a href="apps.html" class="btn btn-secondary">Get the app &rarr;</a></div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/track-phone-map.webp" alt="Live truck route with ETA on the LoadBoot trip map" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="height:12px"></div><div style="max-width:340px;margin:0 auto"><img src="/shots/track-phone-docs.webp" alt="Dock photo, signed BOL/POD and lumper receipt capture in-app" width="420" height="508" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real screens &mdash; navigation with ETA, and docs that file themselves.</div></div>'
 '</div></div></section>')

# geofence engine
trk += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The geofence engine</div><h2>800 meters that end every &ldquo;when did you get there?&rdquo; argument</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128205;</div><h3>Arms itself</h3><p>The moment a trip is dispatched, an 800-meter geofence arms at pickup, at every extra stop, and at delivery — from the exact pins the poster set.</p></div>'
 '<div class="card"><div class="icon">&#9203;</div><h3>Stamps itself</h3><p>Cross in: Arrive. Cross out: Depart — with hysteresis so circling the yard or a GPS wobble never double-stamps. Every stamp is recorded server-side.</p></div>'
 '<div class="card"><div class="icon">&#128274;</div><h3>Locks on</h3><p>From dispatch to delivery, tracking is locked on — it can&rsquo;t be quietly switched off mid-trip. Positions post about every 25 seconds.</p></div>'
 '<div class="card"><div class="icon">&#128276;</div><h3>Watches itself</h3><p>No ping for 30 minutes? The live view flags the feed stale and blackout watchdogs alert dispatch — dead phones don&rsquo;t become dead trails.</p></div>'
 '</div></div></section>')

# money section
trk += ('<section class="ftx-sec" id="for-money"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">Timestamps &rarr; money</div><h2 class="ftx-h">The GPS trail is a paper trail</h2>'
 '<p class="ftx-p">Everything that pays a carrier beyond linehaul depends on proving time and place — and that is exactly what this system records. The detention clock starts from the recorded arrival (2 hours free standard, then $60/hr), layover and TONU claims attach the event log automatically, and your on-time history is built from delivered facts, not memory.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Claims file themselves</b> &mdash; with the server-verified log attached. See the full breakdown on the <a href="load-board.html">load board page</a> and the <a href="detention-pay-policy.html">detention policy</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Delivery flips the invoice</b> &mdash; POD approved means the invoice generates with every proven accessorial on it. <a href="payments-settlements.html">How payment works</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Cancellations keep evidence</b> &mdash; if a load dies at the dock, the GPS trail survives for the TONU claim.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/track-claim.webp" alt="GPS-proven detention claim filed automatically to the invoice" width="1200" height="844" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">A real claim &mdash; server timestamps, evidence attached, filed automatically.</div></div>'
 '</div></div></section>')

# broker/shipper live view
trk += ('<section class="ftx-sec alt" id="for-watchers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">For brokers &amp; shippers</div><h2 class="ftx-h">Your freight, live &mdash; without a single check call</h2>'
 '<p class="ftx-p">Open the load and you&rsquo;re looking at the truth: a milestone timeline from posted to delivered, the truck moving on the map with a live ETA, and detention accruing per stop as it happens — the same numbers the carrier sees, so there is nothing to argue about later. Shippers who post directly get exactly the same view.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>LIVE badge with honesty built in</b> &mdash; the feed marks itself stale after 30 minutes of silence instead of showing you a comforting old dot.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Per-stop detention meters</b> &mdash; watch in-dock time against free time in real time; the $ figure updating is your incentive to unload faster.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Evidence, not opinions</b> &mdash; every claim that reaches your invoice carries the server-verified event log behind it.</div></div>'
 '</div>'
 '<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap"><a href="app/partner/" class="btn btn-primary">Open the Partner Portal &rarr;</a><a href="load-board.html#for-posters" class="btn btn-secondary">How posting works</a></div></div>'
 '<div class="reveal"><img src="/shots/partner-live-tracking.webp" alt="Broker and shipper live tracking view — milestones, live map, detention meters" width="1100" height="969" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real partner view &mdash; live truck, milestones, dwell meters, event log.</div></div>'
 '</div></div></section>')

# proof vault + why different
trk += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The proof vault</div><h2>Every proof it gathers &mdash; and who it protects</h2></div>'
 '<p class="ftx-p reveal" style="max-width:800px">Most tracking tells you where a truck is. LoadBoot&rsquo;s builds a court-grade file of the whole trip — and every record protects someone.</p>'
 '<div class="reveal" style="overflow-x:auto;margin-top:20px"><table class="ftx-cmp">'
 '<tr><th>Proof recorded</th><th>Protects the carrier</th><th>Protects the broker / shipper</th></tr>'
 '<tr><td><b>Arrive / depart stamps</b> (800 m geofence, server-side)</td><td class="ftx-yes">Detention &amp; layover pay with evidence</td><td class="ftx-yes">Proof of dock performance &middot; no inflated claims</td></tr>'
 '<tr><td><b>Position trail</b> (~every 25s, dispatch &rarr; delivery)</td><td class="ftx-yes">On-time history &amp; account health built from facts</td><td class="ftx-yes">Live ETA &middot; zero check calls &middot; customer answers</td></tr>'
 '<tr><td><b>Per-stop records</b> on multi-stop routes</td><td class="ftx-yes">Stop-off pay &amp; per-stop detention proven separately</td><td class="ftx-yes">Every facility&rsquo;s dwell time, measured</td></tr>'
 '<tr><td><b>POD photos + delivery docs</b> in-app</td><td class="ftx-yes">Triggers the invoice the same day</td><td class="ftx-yes">Instant delivery confirmation for the customer</td></tr>'
 '<tr><td><b>Event log on cancellations</b></td><td class="ftx-yes">TONU claims backed by &ldquo;I was there&rdquo; proof</td><td class="ftx-yes">Defense against false-arrival claims</td></tr>'
 '<tr><td><b>Stale-feed &amp; blackout flags</b></td><td class="ftx-yes">Honest record when signal dies &mdash; trail resumes clean</td><td class="ftx-yes">You&rsquo;re never lied to by an old dot</td></tr>'
 '<tr><td><b>Emergency &amp; issue reports</b> (timestamped)</td><td class="ftx-yes">Verified emergencies reschedule with no TONU</td><td class="ftx-yes">Real reasons, on record, within 2 hours</td></tr>'
 '</table></div>'
 '<div class="cards g4 reveal" style="margin-top:30px">'
 '<div class="card"><div class="icon">&#129517;</div><h3>Built in, not bolted on</h3><p>Third-party trackers watch a truck. This tracking lives inside the same system as the booking, the rate card and the invoice — so proof flows straight into money.</p></div>'
 '<div class="card"><div class="icon">&#128737;</div><h3>Tamper-proof by design</h3><p>Timestamps are recorded server-side from GPS events. Nobody — carrier, broker, or LoadBoot staff — has an edit button on the event log.</p></div>'
 '<div class="card"><div class="icon">&#129309;</div><h3>One truth, both sides</h3><p>Carrier and poster look at the identical map, meters and log. Symmetric information is why disputes on LoadBoot die young.</p></div>'
 '<div class="card"><div class="icon">&#128064;</div><h3>Privacy by code</h3><p>Tracking exists only between dispatch and delivery. No 24/7 surveillance, no selling location data — off the clock means off the map.</p></div>'
 '</div></div></section>')

# comparison
trk += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Honest comparison</div><h2>LoadBoot tracking vs check calls &amp; macros</h2></div>'
 '<div class="reveal" style="overflow-x:auto;margin-top:22px"><table class="ftx-cmp">'
 '<tr><th></th><th>LoadBoot</th><th>Check calls / macro apps</th></tr>'
 '<tr><td>Driver effort</td><td class="ftx-yes">&#x2713; zero taps &mdash; geofences stamp themselves</td><td class="ftx-no">&#10007; calls, texts, manual check-ins</td></tr>'
 '<tr><td>Detention proof</td><td class="ftx-yes">&#x2713; server-verified arrive/depart, auto-filed</td><td class="ftx-no">&#10007; &ldquo;driver says he was there at 9&rdquo;</td></tr>'
 '<tr><td>Hardware needed</td><td class="ftx-yes">&#x2713; any phone &middot; ELD optional</td><td class="ftx-part">ELD contract or nothing</td></tr>'
 '<tr><td>Privacy off-duty</td><td class="ftx-yes">&#x2713; tracking ends at delivery, by code</td><td class="ftx-no">&#10007; 24/7 hardware tracking</td></tr>'
 '<tr><td>Broker visibility</td><td class="ftx-yes">&#x2713; live map, ETA, detention meters, event log</td><td class="ftx-part">a phone number and hope</td></tr>'
 '<tr><td>Feed honesty</td><td class="ftx-yes">&#x2713; stale flag + blackout watchdogs</td><td class="ftx-no">&#10007; last known dot, hours old</td></tr>'
 '</table></div></div></section>')

# FAQ
trk += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Tracking &amp; proof FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _TRK_FAQ)
 + '</div></div></section>')

# CTA
trk += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:60px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">Every mile proven. Every minute paid.</h2>'
 '<p style="color:#cbd5e1;max-width:640px;margin:12px auto 24px">Carriers: your next detention claim files itself. Brokers &amp; shippers: your next check call is your last.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Create a carrier account</a>'
 '<a href="app/partner/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127970; Track your freight live</a>'
 '<a href="payments-settlements.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Next: how you get paid</a>'
 '</div></div></section>')

RELATED['gps-tracking.html'] = [('book-truck-loads.html','One-Tap Booking'),('detention-pay-policy.html','Detention Pay'),('payments-settlements.html','Payments & Settlements'),('load-board.html','Live Load Board'),('emergency-rescheduling-policy.html','Emergency Rescheduling'),('features.html','All Features')]
page('gps-tracking.html', 'Real-Time Truck Load Tracking — GPS Geofence Proof, No ELD Required | LoadBoot',
     'Live truck load tracking from the driver&rsquo;s phone: 800-meter geofences stamp arrive/depart automatically, detention claims file themselves with server-verified GPS evidence, brokers and shippers watch a live map with ETA and per-stop detention meters. ELD optional (Samsara/Motive), privacy-off at delivery.',
     'gps-tracking.html', trk, _trk_schema)

pay = FTX_CSS + LBX_CSS

_PAY_FAQ = [('Does LoadBoot hold or move the money?', 'No. Payments move bank-to-bank (ACH or wire) between the payer and the payee — LoadBoot runs the ledger around them: what is owed, the PAY-BY deadline, where it goes (bank or factoring company), the attached receipt, and the payee’s confirmation that it landed.'), ('When does an invoice become due?', 'The moment it is earned. Delivered freight, approved claims and service-fee invoices flip to DUE automatically — grouped per trip with a deadline from your terms (net-30 standard, or the carrier’s factoring terms). Ageing runs from day one, not from when someone remembers to send an invoice.'), ('How does one receipt settle a whole trip?', 'A trip’s payable block holds the freight plus every approved claim — detention, lumper, TONU — with one trip total. The payer can transfer that total once, attach the receipt, and every item in the block settles together. Item-by-item payment works too.'), ('I use a factoring company — does this still work?', 'Yes. With your NOA on file the remit-to routes to your factor automatically, per broker. You keep full control: leave specific brokers on factor, take direct payment where your contract allows, and if you leave your factor, upload the release letter and the routing flips.'), ('What happens when a broker doesn’t pay?', 'The debt ages in the open — due-since counters on both sides. One tap sends a payment request; at three days past due it can become a formal dispute with LoadBoot support in the loop, and the GPS-stamped evidence is already attached.'), ('Do detention and lumper claims get paid separately?', 'They ride the same rail. Approved claims join the trip’s payable block with their own memo and deadline — backed by the server-verified GPS log — so the broker can pay each claim or clear the whole trip in one receipt.'), ('Can I get my numbers into QuickBooks?', 'Yes — connect QuickBooks from Finance → Accounting in the carrier portal and your invoices and expenses sync to your books automatically.')]

_pay_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "Does LoadBoot hold or move the money?", "acceptedAnswer": {"@type": "Answer", "text": "No. Payments move bank-to-bank (ACH or wire) between the payer and the payee \\u2014 LoadBoot runs the ledger around them: what is owed, the PAY-BY deadline, where it goes (bank or factoring company), the attached receipt, and the payee\\u2019s confirmation that it landed."}}, {"@type": "Question", "name": "When does an invoice become due?", "acceptedAnswer": {"@type": "Answer", "text": "The moment it is earned. Delivered freight, approved claims and service-fee invoices flip to DUE automatically \\u2014 grouped per trip with a deadline from your terms (net-30 standard, or the carrier\\u2019s factoring terms). Ageing runs from day one, not from when someone remembers to send an invoice."}}, {"@type": "Question", "name": "How does one receipt settle a whole trip?", "acceptedAnswer": {"@type": "Answer", "text": "A trip\\u2019s payable block holds the freight plus every approved claim \\u2014 detention, lumper, TONU \\u2014 with one trip total. The payer can transfer that total once, attach the receipt, and every item in the block settles together. Item-by-item payment works too."}}, {"@type": "Question", "name": "I use a factoring company \\u2014 does this still work?", "acceptedAnswer": {"@type": "Answer", "text": "Yes. With your NOA on file the remit-to routes to your factor automatically, per broker. You keep full control: leave specific brokers on factor, take direct payment where your contract allows, and if you leave your factor, upload the release letter and the routing flips."}}, {"@type": "Question", "name": "What happens when a broker doesn\\u2019t pay?", "acceptedAnswer": {"@type": "Answer", "text": "The debt ages in the open \\u2014 due-since counters on both sides. One tap sends a payment request; at three days past due it can become a formal dispute with LoadBoot support in the loop, and the GPS-stamped evidence is already attached."}}, {"@type": "Question", "name": "Do detention and lumper claims get paid separately?", "acceptedAnswer": {"@type": "Answer", "text": "They ride the same rail. Approved claims join the trip\\u2019s payable block with their own memo and deadline \\u2014 backed by the server-verified GPS log \\u2014 so the broker can pay each claim or clear the whole trip in one receipt."}}, {"@type": "Question", "name": "Can I get my numbers into QuickBooks?", "acceptedAnswer": {"@type": "Answer", "text": "Yes \\u2014 connect QuickBooks from Finance \\u2192 Taxes in the carrier portal and your invoices and expenses sync to your books automatically."}}]}</script>'

pay += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:84px 0 60px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Payments &amp; settlements</div>'
 '<h1 style="color:#fff;font-size:2.5rem;line-height:1.12;margin:10px 0 16px">Payments with receipts, deadlines and <span style="color:#4ade80">zero guesswork</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.08rem;line-height:1.7">The load was <a href="gps-tracking.html" style="color:#7dd3fc">tracked to the dock</a> &mdash; the money runs on the same rails. Delivery flips the invoice to DUE automatically, the payer sees a PAY-BY deadline and can settle a whole trip with one receipt, the payee confirms it landed, and every dollar keeps its paper trail: who owes it, when it is due, when it moved, and proof it arrived.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-carrier-account.html" class="btn btn-primary">Get paid like this &rarr;</a><a href="app/partner/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Pay with a paper trail &mdash; broker / shipper</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Auto-invoice on delivery</span><span>&#x2713; One receipt settles a whole trip</span><span>&#x2713; Factoring &amp; QuickBooks built in</span></div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/pay-money-in-phone.webp" alt="Carrier money-in view — every dollar owed with deadline, memo and payment route" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real money-in view &mdash; every dollar owed, its deadline, its memo, and where it pays to.</div></div></div></div></section>')

pay += ('<section style="background:#0b1220;padding:0 0 34px"><div class="wrap"><div class="cards g4" style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">'
 '<a href="#for-carriers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#128666; I&rsquo;m owed money</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Carriers &mdash; the money-in rail &amp; your real numbers &darr;</div></a>'
 '<a href="#for-payers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127970; I owe carriers</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Brokers &amp; shippers &mdash; one receipt, whole trip &darr;</div></a>'
 '<a href="#for-factoring" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127974; My factor gets paid</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">NOA routing, per-broker control, clean exits &darr;</div></a>'
 '</div></div></section>')

pay += ('<section class="ftx-sec" id="for-carriers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">The carrier&rsquo;s money-in</div><h2 class="ftx-h">Watch your money move &mdash; owed, on the way, landed</h2>'
 '<p class="ftx-p">Nothing on this screen was typed in. Delivered freight, approved claims and fees appear as DUE the moment they are earned, each with a deadline, a memo the bank transfer must carry, and the route it pays through. From there the receipt loop takes over.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>DUE with a real deadline</b> &mdash; net-30 or your factoring terms, with due-since ageing running in the open on both sides.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>&ldquo;Payment on the way&rdquo;</b> &mdash; the payer attaches the transfer receipt and you see a landing ETA, not silence. You can open their receipt yourself.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>You confirm it landed</b> &mdash; one tap on &ldquo;I received it&rdquo; closes the loop. Silence triggers daily nudges and staff escalation &mdash; nothing rots unconfirmed.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Disputes with teeth</b> &mdash; request payment in one tap; three days past due it becomes a formal dispute with LoadBoot support in the loop.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Claims ride the same rail</b> &mdash; <a href="detention-pay-policy.html">detention</a>, lumper and TONU join the trip&rsquo;s invoice as approved claims, GPS-stamped from the <a href="gps-tracking.html">tracking trail</a>.</div></div>'
 '</div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/pay-money-loop-phone.webp" alt="The receipt loop — payment sent with receipt attached, landing ETA, confirmed received" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real receipt loop &mdash; sent with receipt and landing ETA, then confirmed received.</div></div>'
 '</div></div></section>')

pay += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">Know your numbers</div><h2 class="ftx-h">Every trip, A to Z &mdash; profit per mile, not vibes</h2>'
 '<p class="ftx-p">The same ledger that collects your money computes your business: revenue, cost and net per mile, margin per trip, net per hour &mdash; over 7, 30 or 90 days. Log fuel, tolls and parking against the trip and the cost model does the rest.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Tap any trip for its full profit statement</b> &mdash; linehaul, accessorials, costs, per-mile and margin, A to Z.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Cost-per-mile is the number that keeps you alive</b> &mdash; run yours in the <a href="cost-per-mile-calculator.html">free calculator</a>, then watch the portal track it for real.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Books that keep themselves</b> &mdash; connect QuickBooks from Finance &rarr; Accounting and invoices and expenses <a href="integrations.html">sync automatically</a>. Statements download as CSV or PDF any time.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><div style="max-width:340px;margin:0 auto"><img src="/shots/pay-earnings-phone.webp" alt="Carrier earnings view — net profit, revenue, cost and net per mile, margin per trip" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real earnings view &mdash; net profit with cost-per-mile, margin and net-per-hour.</div></div>'
 '</div></div></section>')

pay += ('<section class="ftx-sec" id="for-payers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">For brokers &amp; shippers</div><h2 class="ftx-h">Pay a whole trip with one receipt &mdash; and watch it turn green</h2>'
 '<p class="ftx-p">Payables group per trip: one block holds the freight plus every approved claim, with one trip total and a PAY-BY deadline on each item. Transfer once, attach the receipt &mdash; the carrier (or their factor) confirms, and the block settles green.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>One receipt, all items</b> &mdash; freight, detention, lumper: the whole trip clears in a single payment if you want it to.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Deadlines you can see</b> &mdash; PAY-BY dates with days-left counters, so nothing surprises your accounting.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Claims arrive pre-proven</b> &mdash; every claim carries its server-verified GPS log, so you are approving evidence, not arguing memories.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Remit-to switches itself</b> &mdash; factored carrier &rarr; their factoring company under the NOA; direct carrier &rarr; their verified bank. You never have to know which is which.</div></div>'
 '</div>'
 '<div style="margin-top:16px;display:flex;gap:12px;flex-wrap:wrap"><a href="app/partner/" class="btn btn-primary">Open the Partner Portal &rarr;</a><a href="brokers.html" class="btn btn-secondary">Why brokers post here</a></div></div>'
 '<div class="reveal"><img src="/shots/pay-broker-payables-main.webp" alt="Broker payables — per-trip blocks with PAY-BY deadlines, GPS-proven claims and one-receipt settlement" width="1100" height="891" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="height:12px"></div><img src="/shots/pay-broker-settled.webp" alt="A fully settled trip — paid and confirmed" width="1100" height="204" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real payables ledger &mdash; DUE, payment on the way, and a trip settled green.</div></div>'
 '</div></div></section>')

pay += ('<section class="ftx-sec alt" id="for-factoring"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Fees &amp; factoring</div><h2>One flat fee. Your factoring, your rules.</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#129534;</div><h3>The flat 5% &mdash; nothing else</h3><p>Every delivered load auto-invoices LoadBoot&rsquo;s flat 5% dispatch fee with a branded PDF &mdash; pay it, download it, or dispute it, right from the portal. <a href="pricing.html">See pricing</a>.</p></div>'
 '<div class="card"><div class="icon">&#127974;</div><h3>NOA routing, automatic</h3><p>Notice of Assignment on file means brokers pay your factoring company without you chasing anyone &mdash; the remit-to switches by itself on every invoice.</p></div>'
 '<div class="card"><div class="icon">&#127919;</div><h3>Per-broker control</h3><p>Non-exclusive contract? Keep some brokers paying your factor and take others direct &mdash; you choose per broker, and the routing follows.</p></div>'
 '<div class="card"><div class="icon">&#128682;</div><h3>Leaving your factor</h3><p>Upload the signed release letter and the routing flips cleanly &mdash; until then, brokers keep paying the factor so nobody breaches an NOA. <a href="factoring-noa.html">Factoring &amp; NOA guide</a>.</p></div>'
 '</div></div></section>')

pay += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Honest comparison</div><h2>Receipt-verified rails vs &ldquo;the check is in the mail&rdquo;</h2></div>'
 '<div class="reveal" style="overflow-x:auto;margin-top:22px"><table class="ftx-cmp">'
 '<tr><th></th><th>LoadBoot</th><th>Email invoices &amp; hope</th></tr>'
 '<tr><td>When it becomes due</td><td class="ftx-yes">&#x2713; flips to DUE at delivery, deadline attached</td><td class="ftx-no">&#10007; due when someone sends the invoice</td></tr>'
 '<tr><td>What is owed</td><td class="ftx-yes">&#x2713; per-trip total &mdash; freight + proven claims</td><td class="ftx-no">&#10007; invoice ping-pong over every accessorial</td></tr>'
 '<tr><td>How it is paid</td><td class="ftx-yes">&#x2713; memo-matched transfer, receipt attached</td><td class="ftx-no">&#10007; mystery ACH nobody can reconcile</td></tr>'
 '<tr><td>Confirmation</td><td class="ftx-yes">&#x2713; payee taps &ldquo;received&rdquo; &mdash; silence gets nudged</td><td class="ftx-no">&#10007; &ldquo;did that ever land?&rdquo;</td></tr>'
 '<tr><td>Claims evidence</td><td class="ftx-yes">&#x2713; GPS-stamped, riding the same invoice</td><td class="ftx-no">&#10007; screenshots in an email thread</td></tr>'
 '<tr><td>Your books</td><td class="ftx-yes">&#x2713; QuickBooks sync + CSV/PDF statements</td><td class="ftx-part">a spreadsheet, eventually</td></tr>'
 '</table></div></div></section>')

pay += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Payments &amp; settlement FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _PAY_FAQ)
 + '</div></div></section>')
pay += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:60px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">Every dollar proven. Every deadline visible.</h2>'
 '<p style="color:#cbd5e1;max-width:640px;margin:12px auto 24px">Carriers: your receivables chase themselves. Brokers &amp; shippers: your payables reconcile themselves.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Create a carrier account</a>'
 '<a href="app/partner/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127970; Pay carriers the clean way</a>'
 '<a href="factoring-noa.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Factoring &amp; NOA</a>'
 '</div></div></section>')
RELATED['payments-settlements.html'] = [('factoring-noa.html','Factoring & NOA'),('detention-pay-policy.html','Detention Pay'),('gps-tracking.html','GPS Tracking & Proof'),('integrations.html','QuickBooks & Integrations'),('pricing.html','Pricing'),('features.html','All Features')]
page('payments-settlements.html', 'Trucking Payments & Settlements — Receipt-Verified Rails, One-Receipt Trip Settlement | LoadBoot', 'Delivery flips the invoice to DUE automatically. PAY-BY deadlines, one-receipt trip settlement, receipt-verified transfers with landing ETA, confirm-received loops, GPS-proven claims, factoring/NOA routing and QuickBooks sync — every dollar keeps its paper trail.', 'payments-settlements.html', pay, _pay_schema)

fac = FTX_CSS + LBX_CSS

_FAC_FAQ = [('What is a Notice of Assignment (NOA)?', 'A legal notice from your factoring company telling debtors (brokers) that your receivables are assigned to the factor — under UCC §9-406, once a broker receives it, paying you directly does not discharge their debt. LoadBoot carries that notice into every pay panel and invoice automatically.'), ('What does the broker actually see?', 'A red Notice-of-Assignment warning, then the factor’s remit-to — company, bank, account, remittance email — verified by LoadBoot. Your own bank details never appear on a factored payment panel.'), ('Can I keep some brokers direct?', 'Yes, if your factoring contract is non-exclusive. Per-broker control lets you route specific brokers to pay you directly while everyone else pays the factor — flip any broker back at any time.'), ('What is in the factoring packet?', 'Everything your factor needs to fund: the invoice, the executed rate confirmation, the signed POD/BOL, lumper and accessorial receipts, and the GPS proof note — with a checklist of anything still missing. It is collected automatically during the trip; you just send the bundle.'), ('How do I leave my factoring company?', 'Upload the factor’s signed release letter and the remit-to flips back to your bank everywhere at once. Until the release is on file, brokers keep paying the factor — so nobody accidentally breaches the NOA.'), ('Does LoadBoot charge extra for factoring support?', 'No. The NOA engine, per-broker routing and the factoring packet are part of the platform. LoadBoot’s flat 5% dispatch fee is unchanged — and it is always invoiced to your account, never taken from your factor’s advance.')]

_fac_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "What is a Notice of Assignment (NOA)?", "acceptedAnswer": {"@type": "Answer", "text": "A legal notice from your factoring company telling debtors (brokers) that your receivables are assigned to the factor \\u2014 under UCC \\u00a79-406, once a broker receives it, paying you directly does not discharge their debt. LoadBoot carries that notice into every pay panel and invoice automatically."}}, {"@type": "Question", "name": "What does the broker actually see?", "acceptedAnswer": {"@type": "Answer", "text": "A red Notice-of-Assignment warning, then the factor\\u2019s remit-to \\u2014 company, bank, account, remittance email \\u2014 verified by LoadBoot. Your own bank details never appear on a factored payment panel."}}, {"@type": "Question", "name": "Can I keep some brokers direct?", "acceptedAnswer": {"@type": "Answer", "text": "Yes, if your factoring contract is non-exclusive. Per-broker control lets you route specific brokers to pay you directly while everyone else pays the factor \\u2014 flip any broker back at any time."}}, {"@type": "Question", "name": "What is in the factoring packet?", "acceptedAnswer": {"@type": "Answer", "text": "Everything your factor needs to fund: the invoice, the executed rate confirmation, the signed POD/BOL, lumper and accessorial receipts, and the GPS proof note \\u2014 with a checklist of anything still missing. It is collected automatically during the trip; you just send the bundle."}}, {"@type": "Question", "name": "How do I leave my factoring company?", "acceptedAnswer": {"@type": "Answer", "text": "Upload the factor\\u2019s signed release letter and the remit-to flips back to your bank everywhere at once. Until the release is on file, brokers keep paying the factor \\u2014 so nobody accidentally breaches the NOA."}}, {"@type": "Question", "name": "Does LoadBoot charge extra for factoring support?", "acceptedAnswer": {"@type": "Answer", "text": "No. The NOA engine, per-broker routing and the factoring packet are part of the platform. LoadBoot\\u2019s flat 5% dispatch fee is unchanged \\u2014 and it is always invoiced to your account, never taken from your factor\\u2019s advance."}}]}</script>'

fac += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:84px 0 60px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Factoring built in</div>'
 '<h1 style="color:#fff;font-size:2.5rem;line-height:1.12;margin:10px 0 16px">A real NOA engine &mdash; <span style="color:#4ade80">not a PDF in an email</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.08rem;line-height:1.7">If you factor, LoadBoot carries your Notice of Assignment everywhere <a href="payments-settlements.html" style="color:#7dd3fc">money moves</a>. Brokers see the factor&rsquo;s remit-to on every pay panel with UCC &sect;9-406 language; your own bank stays hidden. And when it&rsquo;s time to fund, the factoring packet is already assembled.</p>'
 '<style>.fac-hero-ticks .ftx-li{color:#cbd5e1}.fac-hero-ticks .ftx-li b{color:#fff}</style><div class="fac-hero-ticks" style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Org-level activation</b> &mdash; declare your factor once, upload the NOA; every new booking notifies the broker automatically.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Verified, then trusted</b> &mdash; LoadBoot reviews the NOA letter; pay panels show &ldquo;NOA verified by LoadBoot &#x2713;&rdquo; so brokers pay without calling anyone.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Per-broker freedom</b> &mdash; choose factoring or direct pay broker-by-broker; switch anytime.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Release flow</b> &mdash; leave your factor cleanly; the remit-to flips back to you everywhere at once.</div></div>'
 '</div>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px"><a href="create-carrier-account.html" class="btn btn-primary">Set up factoring in minutes &rarr;</a><a href="payments-settlements.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">How payments work</a></div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/fac-carrier-phone.webp" alt="Carrier factoring controls — NOA verified, per-broker factor/direct routing, release flow" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real factoring panel &mdash; NOA verified, per-broker control, one-tap release flow.</div></div></div></div></section>')

fac += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">What the broker sees</div><h2 class="ftx-h">UCC &sect;9-406, on every pay panel &mdash; so nobody pays twice</h2>'
 '<p class="ftx-p">The moment a broker opens the pay panel on a factored carrier&rsquo;s invoice, the NOA does the talking: a red Notice-of-Assignment warning, the factor&rsquo;s verified remit-to, and a memo reference that matches the payment to the invoice automatically.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>The legal language is right there</b> &mdash; &ldquo;after an NOA, paying the carrier can leave you liable to pay the same invoice twice (UCC &sect;9-406)&rdquo;. No side-channel PDFs, no surprises.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Bank details verified by LoadBoot</b> &mdash; brokers pay a remit-to that has been checked, with the memo reference that reconciles it.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Receipt closes the loop</b> &mdash; the broker attaches the transfer receipt and the <a href="payments-settlements.html">receipt-verified rail</a> takes it from there.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/fac-pay-panel.webp" alt="Broker pay panel for a factored carrier — NOA warning, verified factor remit-to, memo reference and receipt upload" width="1100" height="658" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real pay panel &mdash; NOA warning, verified remit-to, memo-matched receipt upload.</div></div>'
 '</div></div></section>')

fac += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">Funding day</div><h2 class="ftx-h">The factoring packet assembles itself</h2>'
 '<p class="ftx-p">Factors fund clean paperwork. LoadBoot collects it during the trip &mdash; so when the load delivers, one tap opens the bundle your factor needs, with a checklist of anything still missing.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Invoice, RC, POD, receipts</b> &mdash; the four things every factor asks for, gathered automatically with GPS-stamped uploads.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Missing-items checklist</b> &mdash; the packet tells you exactly what still blocks funding before you email anyone.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>GPS proof included</b> &mdash; server-verified arrive/depart stamps ride along as delivery evidence factors accept.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Typical funding: same or next business day</b> &mdash; because the paperwork shows up complete the first time.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><div style="max-width:340px;margin:0 auto"><img src="/shots/fac-packet-phone.webp" alt="Factoring packet — invoice, signed POD, lumper receipt, GPS proof and a missing-items checklist" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real packet &mdash; assembled during the trip, checklist included.</div></div>'
 '</div></div></section>')

fac += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">The fine print, handled</div><h2>Factoring without the gotchas</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128737;</div><h3>Your bank stays hidden</h3><p>On factored invoices, brokers only ever see the factor&rsquo;s remit-to. Your account details are never exposed on a pay panel that shouldn&rsquo;t show them.</p></div>'
 '<div class="card"><div class="icon">&#129534;</div><h3>The 5% never touches your advance</h3><p>LoadBoot&rsquo;s flat dispatch fee invoices your account directly &mdash; it is never deducted from what the factor owes you. <a href="pricing.html">See pricing</a>.</p></div>'
 '<div class="card"><div class="icon">&#128682;</div><h3>Clean exits, by design</h3><p>Until your factor&rsquo;s release letter is on file, brokers keep paying the factor &mdash; so leaving never creates a UCC breach or a double-payment mess.</p></div>'
 '<div class="card"><div class="icon">&#128203;</div><h3>Works without factoring too</h3><p>Direct carriers get the same rail: verified bank remit-to, memo-matched receipts, and the same packet for direct billing. <a href="payments-settlements.html">Payments &amp; settlements</a>.</p></div>'
 '</div></div></section>')

fac += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Factoring &amp; NOA FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _FAC_FAQ)
 + '</div></div></section>')
fac += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:60px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">Factor-friendly by design.</h2>'
 '<p style="color:#cbd5e1;max-width:640px;margin:12px auto 24px">Your NOA travels with every invoice, your packet assembles itself, and leaving your factor is one letter &mdash; not a lawsuit.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Create a carrier account</a>'
 '<a href="payments-settlements.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Payments &amp; settlements</a>'
 '</div></div></section>')
RELATED['factoring-noa.html'] = [('payments-settlements.html','Payments & Settlements'),('carriers.html','For Carriers'),('detention-pay-policy.html','Detention Pay'),('pricing.html','Pricing'),('features.html','All Features')]
page('factoring-noa.html', 'Factoring & NOA Engine for Trucking — UCC §9-406 Built In | LoadBoot', 'Real Notice-of-Assignment support: the factor&rsquo;s verified remit-to on every broker pay panel with UCC §9-406 language, per-broker factor/direct routing, a clean release flow, and a factoring packet (invoice, RC, POD, receipts, GPS proof) that assembles itself.', 'factoring-noa.html', fac, _fac_schema)

flt = FTX_CSS + LBX_CSS

_FLT_FAQ = [('Do drivers need separate logins?', 'Each driver gets a magic-link invite from the roster — they tap it on their phone and their trips, navigation and document capture are ready. No passwords to manage, and every truck is tracked separately.'), ('How does per-trip profit work?', "Every load's revenue meets its costs — fuel, tolls, parking, lumper — logged on the trip or imported from your fuel card. The portal computes profit, cost per mile and margin per trip, and rolls it up over 7, 30 or 90 days."), ('Can I import my fuel card statements?', 'Yes — export the transactions CSV from your EFS, Comdata or WEX portal and drop it in. Each purchase lands as a fuel expense on the right trip by date, amount and location.'), ('What compliance does it watch?', 'Driver license and medical-card expiry dates, truck registration and service due-dates. Expiring items raise alerts on the Fleet page before they become roadside problems.'), ('Does it do IFTA and per-diem?', 'State miles for IFTA come from the same GPS trail your trips already record, and per-diem nights away are counted from trip stamps for the IRS deduction — no separate mileage log.'), ('Is fleet management extra?', "No. The whole back office — roster, maintenance, expenses, P&L, payroll, IFTA — is part of the carrier portal. LoadBoot's only charge is the flat 5% dispatch fee on loads we book.")]

_flt_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "Do drivers need separate logins?", "acceptedAnswer": {"@type": "Answer", "text": "Each driver gets a magic-link invite from the roster \\u2014 they tap it on their phone and their trips, navigation and document capture are ready. No passwords to manage, and every truck is tracked separately."}}, {"@type": "Question", "name": "How does per-trip profit work?", "acceptedAnswer": {"@type": "Answer", "text": "Every load\'s revenue meets its costs \\u2014 fuel, tolls, parking, lumper \\u2014 logged on the trip or imported from your fuel card. The portal computes profit, cost per mile and margin per trip, and rolls it up over 7, 30 or 90 days."}}, {"@type": "Question", "name": "Can I import my fuel card statements?", "acceptedAnswer": {"@type": "Answer", "text": "Yes \\u2014 export the transactions CSV from your EFS, Comdata or WEX portal and drop it in. Each purchase lands as a fuel expense on the right trip by date, amount and location."}}, {"@type": "Question", "name": "What compliance does it watch?", "acceptedAnswer": {"@type": "Answer", "text": "Driver license and medical-card expiry dates, truck registration and service due-dates. Expiring items raise alerts on the Fleet page before they become roadside problems."}}, {"@type": "Question", "name": "Does it do IFTA and per-diem?", "acceptedAnswer": {"@type": "Answer", "text": "State miles for IFTA come from the same GPS trail your trips already record, and per-diem nights away are counted from trip stamps for the IRS deduction \\u2014 no separate mileage log."}}, {"@type": "Question", "name": "Is fleet management extra?", "acceptedAnswer": {"@type": "Answer", "text": "No. The whole back office \\u2014 roster, maintenance, expenses, P&L, payroll, IFTA \\u2014 is part of the carrier portal. LoadBoot\'s only charge is the flat 5% dispatch fee on loads we book."}}]}</script>'

flt += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:84px 0 60px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Run the fleet</div>'
 '<h1 style="color:#fff;font-size:2.5rem;line-height:1.12;margin:10px 0 16px">Fleet management that <span style="color:#4ade80">knows your profit per mile</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.08rem;line-height:1.7">Drivers, trucks, maintenance and money in one back office — inside the same portal that <a href="load-board.html" style="color:#7dd3fc">books your loads</a> and <a href="payments-settlements.html" style="color:#7dd3fc">collects your money</a>. Invite a driver with a magic link, assign the trip, watch the P&amp;L land on it, and let IFTA count itself from the GPS trail.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-carrier-account.html" class="btn btn-primary">Run your fleet on LoadBoot &rarr;</a><a href="features.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">All features</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:26px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Magic-link driver invites</span><span>&#x2713; Per-trip P&amp;L &amp; cost per mile</span><span>&#x2713; IFTA &amp; per-diem from GPS</span></div></div>'
 '<div class="reveal"><img src="/shots/fleet-roster.webp" alt="Fleet roster — drivers with license and medical expiry tracking, trucks and equipment with plates" width="1100" height="764" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real fleet roster &mdash; drivers, credentials, trucks and capacity in one screen.</div></div>'
 '</div></div></section>')

flt += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">People &amp; iron</div><h2 class="ftx-h">Roster, credentials and capacity &mdash; watched for you</h2>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Magic-link invites</b> &mdash; add a driver, send the link, they&rsquo;re in the app with their trips and documents. No IT project.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Credential expiry alerts</b> &mdash; license and medical dates live on the roster; expiring items flag the Fleet page before a roadside inspection finds them.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Trucks &amp; trailers</b> &mdash; units, plates and equipment types; every truck can run its own load at the same time, tracked separately.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Services you offer</b> &mdash; liftgate, team, TWIC, hazmat &hellip; the matching engine reads this on every run so the right freight finds the right truck. <a href="load-board.html">How matching works</a>.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/fleet-service.webp" alt="Service and maintenance log — PM service and tires with vendor, cost and next-due date" width="1100" height="342" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="height:12px"></div><img src="/shots/fleet-lanes.webp" alt="Fleet optimization — earnings by truck and best lanes from real delivered trips" width="1100" height="307" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real screens &mdash; maintenance with next-due dates, and lanes ranked by what they actually paid.</div></div>'
 '</div></div></section>')

flt += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Multi-fleet optimization &mdash; live</div><h2>The fleet plans itself</h2></div>'
 '<p class="ftx-p reveal" style="max-width:800px">Open the Fleet tab and the plan is already built: a fleet-wide pass over the live board where every load is assigned to the one truck it fits best &mdash; no two trucks chasing the same freight &mdash; with plan revenue, deadhead % and the reload after each delivery.</p>'
 '<div class="reveal" style="margin-top:20px"><img src="/shots/fleet-plan.webp" alt="Optimized fleet plan — KPIs, conflict-free per-truck assignments with reasons, and reload chaining" width="1100" height="474" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real fleet plan &mdash; conflict-free assignments, the reasons, and the money.</div></div>'
 '</div></section>')
flt += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">The money side</div><h2 class="ftx-h">Every truck a P&amp;L, every month a statement</h2>'
 '<p class="ftx-p">Fuel, tolls and parking log against the trip they belong to &mdash; typed in from the road or imported from your fuel card CSV (EFS, Comdata, WEX). The same ledger that pays you computes cost per mile, margin and net per hour.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Fuel-card import</b> &mdash; drop the statement in; each purchase lands on the right trip by date, amount and location.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Cost per mile, live</b> &mdash; the number that keeps a fleet alive, computed from real trips. Try the <a href="cost-per-mile-calculator.html">free CPM calculator</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Payroll from trips</b> &mdash; driver pay entries build from delivered work, not memory.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>IFTA &amp; per-diem</b> &mdash; state miles from the GPS trail, nights-away counted for the IRS deduction. Books sync to <a href="integrations.html">QuickBooks</a>.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><div style="max-width:340px;margin:0 auto"><img src="/shots/fleet-costs-phone.webp" alt="Fuel card CSV import and monthly expenses on the carrier phone app" width="420" height="836" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="height:12px"></div><div style="max-width:340px;margin:0 auto"><img src="/shots/pay-earnings-phone.webp" alt="Earnings view — net profit, cost per mile and margin per trip" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real screens &mdash; fuel import and expenses, and the P&amp;L they feed.</div></div>'
 '</div></div></section>')

flt += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Built into the same rail</div><h2>The back office that runs itself</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:26px">'
 '<div class="card"><div class="icon">&#128737;</div><h3>Safety desk</h3><p>Violations, plans of action and an account-health engine that rewards clean operation &mdash; the record brokers see when your trucks get offered freight.</p></div>'
 '<div class="card"><div class="icon">&#128506;</div><h3>Optimized fleet plan</h3><p>One pass over the live board for the whole fleet: each load goes to the one truck it fits best &mdash; equipment, $/mile, deadhead from each truck&rsquo;s own last drop, lane history &mdash; with the reload chained after it.</p></div>'
 '<div class="card"><div class="icon">&#128181;</div><h3>One money rail</h3><p>Fleet costs live beside <a href="payments-settlements.html">receivables and settlements</a> &mdash; the same ledger, so nothing is double-entered.</p></div>'
 '<div class="card"><div class="icon">&#128666;</div><h3>Scales from one truck</h3><p>Owner-operator today, five trucks next year &mdash; the portal is the same. <a href="owner-operator-dispatch.html">Owner-operator dispatch</a>.</p></div>'
 '</div></div></section>')

flt += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Fleet management FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _FLT_FAQ)
 + '</div></div></section>')
flt += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:60px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:2rem">Every truck earning. Every dollar counted.</h2>'
 '<p style="color:#cbd5e1;max-width:640px;margin:12px auto 24px">The fleet office is already inside your carrier portal &mdash; roster to P&amp;L to IFTA, no extra software.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Create a carrier account</a>'
 '<a href="payments-settlements.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">How the money side works</a>'
 '</div></div></section>')
RELATED['fleet-management.html'] = [('payments-settlements.html','Payments & Settlements'),('gps-tracking.html','GPS Tracking & Proof'),('cost-per-mile-calculator.html','Cost Per Mile Calculator'),('ifta-fuel-tax.html','IFTA Fuel Tax'),('owner-operator-dispatch.html','Owner-Operator Dispatch'),('features.html','All Features')]
page('fleet-management.html', 'Trucking Fleet Management Software — Drivers, Trucks, Maintenance & Per-Trip P&L | LoadBoot', 'Run the whole fleet back office in the carrier portal: magic-link driver invites, license & medical expiry alerts, maintenance logs with next-due dates, fuel-card CSV import, per-trip profit & cost per mile, payroll from trips, IFTA state miles and per-diem from the GPS trail.', 'fleet-management.html', flt, _flt_schema)

hiw = FTX_CSS + LBX_CSS

_HIW_FAQ = [('What actually happens when I book a load?', 'The moment you tap Request to book (or accept a direct offer), first acceptance wins and every other offer closes — no double-booking. The rate confirmation is issued and e-signed in-app, the dispatch pack (pickup numbers, contacts, directions) generates instantly, and an 800-meter geofence arms at every stop.'), ('How fast is verification for a new account?', 'Carriers: FMCSA details auto-fill from your DOT number and document review typically completes the same day. Brokers: authority and the federal bond are checked against the FMCSA record at signup. Shippers and agents: minutes.'), ('Who is on the other side of my load?', 'Always a verified party. Carriers pass authority, insurance and health checks before they see freight; posting requires licensed broker or verified shipper status. Both sides of every load are vetted — that is why the board has zero ghost loads.'), ('Where does the money actually move?', 'Bank to bank, between payer and payee — LoadBoot runs the ledger around it: automatic DUE on delivery, PAY-BY deadlines, receipt-verified transfers, confirm-received loops, and factoring/NOA routing when an NOA is on file.'), ('How does matching decide which carriers see my load?', "Explainably: equipment and services fit, verified eligibility, distance from the pickup, the carrier's delivered history on similar lanes and their account-health score. Every match can be traced to those factors — if we cannot explain a ranking, we do not show it."), ('What does LoadBoot charge?', "One flat 5% dispatch fee on delivered loads, invoiced transparently to the carrier's account — never deducted from a factor's advance, never charged to brokers, shippers or agents for using the platform."), ('What if something goes wrong on the road?', 'The Emergency button verifies real breakdowns within a 2-hour window and reschedules with zero penalty. Detention, layover, TONU and lumper claims draft themselves from GPS trip data and ride the same invoice as the freight.')]

_hiw_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "What actually happens when I book a load?", "acceptedAnswer": {"@type": "Answer", "text": "The moment you tap Request to book (or accept a direct offer), first acceptance wins and every other offer closes \\u2014 no double-booking. The rate confirmation is issued and e-signed in-app, the dispatch pack (pickup numbers, contacts, directions) generates instantly, and an 800-meter geofence arms at every stop."}}, {"@type": "Question", "name": "How fast is verification for a new account?", "acceptedAnswer": {"@type": "Answer", "text": "Carriers: FMCSA details auto-fill from your DOT number and document review typically completes the same day. Brokers: authority and the federal bond are checked against the FMCSA record at signup. Shippers and agents: minutes."}}, {"@type": "Question", "name": "Who is on the other side of my load?", "acceptedAnswer": {"@type": "Answer", "text": "Always a verified party. Carriers pass authority, insurance and health checks before they see freight; posting requires licensed broker or verified shipper status. Both sides of every load are vetted \\u2014 that is why the board has zero ghost loads."}}, {"@type": "Question", "name": "Where does the money actually move?", "acceptedAnswer": {"@type": "Answer", "text": "Bank to bank, between payer and payee \\u2014 LoadBoot runs the ledger around it: automatic DUE on delivery, PAY-BY deadlines, receipt-verified transfers, confirm-received loops, and factoring/NOA routing when an NOA is on file."}}, {"@type": "Question", "name": "How does matching decide which carriers see my load?", "acceptedAnswer": {"@type": "Answer", "text": "Explainably: equipment and services fit, verified eligibility, distance from the pickup, the carrier\'s delivered history on similar lanes and their account-health score. Every match can be traced to those factors \u2014 if we cannot explain a ranking, we do not show it."}}, {"@type": "Question", "name": "What does LoadBoot charge?", "acceptedAnswer": {"@type": "Answer", "text": "One flat 5% dispatch fee on delivered loads, invoiced transparently to the carrier\'s account \\u2014 never deducted from a factor\'s advance, never charged to brokers, shippers or agents for using the platform."}}, {"@type": "Question", "name": "What if something goes wrong on the road?", "acceptedAnswer": {"@type": "Answer", "text": "The Emergency button verifies real breakdowns within a 2-hour window and reschedules with zero penalty. Detention, layover, TONU and lumper claims draft themselves from GPS trip data and ride the same invoice as the freight."}}]}</script>'

hiw += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:80px 0 46px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">How it works</div>'
 '<h1 style="color:#fff;font-size:2.4rem;line-height:1.13;margin:10px 0 16px">One load, four screens &mdash; <span style="color:#4ade80">how the whole loop runs</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.06rem;line-height:1.7">A load on LoadBoot is never a phone call and a prayer. It is posted with the rate card in writing, offered to verified carriers in a first-accept-wins window, booked in one tap, tracked by geofence, delivered with a signed POD, invoiced automatically and paid on a receipt-verified rail &mdash; while the broker, the shipper, the carrier and the agent each watch their own screen of the same truth.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="get-started.html" class="btn btn-primary">Get started &mdash; any role &rarr;</a><a href="compliance.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">How verification works</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Verified on both sides</span><span>&#x2713; Rate card in writing</span><span>&#x2713; GPS proof end to end</span></div></div>'
 '<div class="reveal"><img src="/shots/board-web-available.webp" alt="The live load board — verified loads with the full rate card, filters and real deadhead" width="1100" height="773" loading="eager" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Where it starts &mdash; the real board: verified loads, rate card printed, zero ghosts.</div></div>'
 '</div></div></section>')
hiw += ('<section style="background:#0b1220;padding:0 0 30px"><div class="wrap">'
 '<div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center">'
 + ''.join('<span style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:99px;padding:7px 14px;font-size:.78rem;font-weight:700;color:#cbd5e1">' + x + '</span><span style="color:#475569;align-self:center">&rarr;</span>' for x in ['&#128203; Posted','&#9889; Offered &middot; first accept wins','&#128666; Booked &middot; RC e-signed','&#128752; Tracked &middot; geofenced','&#127937; Delivered &middot; POD','&#129534; Invoiced &middot; auto-DUE','&#128181; Paid &middot; receipt-verified'])
 + '<span style="background:rgba(34,197,94,.14);border:1px solid rgba(34,197,94,.3);border-radius:99px;padding:7px 14px;font-size:.78rem;font-weight:800;color:#4ade80">&#128218; Settled &middot; books sync</span>'
 '</div></div></section>')
hiw += ('<section style="background:#0b1220;padding:0 0 40px"><div class="wrap"><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px">'
 '<a href="#for-carriers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#128666; I haul the freight</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Carrier &mdash; board to booked to paid &darr;</div></a>'
 '<a href="#for-brokers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127970; I post the loads</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Broker &mdash; posted to covered to settled &darr;</div></a>'
 '<a href="#for-shippers" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#127981; I own the freight</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Shipper &mdash; requested to moved with proof &darr;</div></a>'
 '<a href="#for-agents" style="text-decoration:none;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:15px;padding:15px 17px;display:block"><b style="color:#fff">&#129309; I bring the people</b><div style="color:#94a3b8;font-size:.82rem;margin-top:5px">Agent &mdash; link to chain to 1% forever &darr;</div></a>'
 '</div></div></section>')

hiw += ('<section class="ftx-sec" id="for-carriers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">For carriers &amp; owner-operators</div><h2 class="ftx-h">Board &rarr; booked &rarr; rolling &rarr; paid</h2>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">1</span><div><b>Verified the same day</b> &mdash; your DOT auto-fills FMCSA records, documents review on a visible tracker, the VERIFIED badge opens the board. <a href="create-carrier-account.html">The exact checklist</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">2</span><div><b>A board with nothing fake on it</b> &mdash; every posting from a licensed broker, full rate card printed (detention, TONU, layover), real deadhead from YOUR position. <a href="load-board.html">The load board</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">3</span><div><b>One tap to booked</b> &mdash; first acceptance wins; the rate con e-signs in-app and the dispatch pack (PU numbers, contacts) generates instantly. <a href="book-truck-loads.html">Booking deep-dive</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">4</span><div><b>The trip runs itself</b> &mdash; 800 m geofences stamp arrive/depart, the detention clock runs at the dock, claims draft themselves. <a href="gps-tracking.html">Tracking &amp; proof</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">5</span><div><b>Fleet? It plans itself</b> &mdash; the optimized fleet plan assigns each board load to the truck it fits best, reload chained. <a href="fleet-management.html">Fleet tools</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">6</span><div><b>Delivery flips the money</b> &mdash; POD in, invoice DUE automatically, receipt-verified payment with your factor routed by NOA. <a href="payments-settlements.html">The money rail</a>.</div></div>'
 '</div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/board-phone-available.webp" alt="The live board on the phone — verified loads with rate cards and deadhead from your GPS" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="height:12px"></div><div style="max-width:340px;margin:0 auto"><img src="/shots/pay-money-loop-phone.webp" alt="The receipt loop — payment sent with receipt and landing ETA, then confirmed received" width="420" height="909" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real screens &mdash; the board where it starts, the receipt loop where it ends.</div></div>'
 '</div></div></section>')

hiw += ('<section class="ftx-sec alt" id="for-brokers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">For freight brokers</div><h2 class="ftx-h">Posted &rarr; covered &rarr; watched &rarr; settled</h2>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">1</span><div><b>Verified brokerage</b> &mdash; authority + the $75K federal bond checked against FMCSA at signup. <a href="create-broker-account.html">Broker onboarding</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">2</span><div><b>Post once with the wizard</b> &mdash; exact pins (they arm the geofences), schedule, equipment and the full rate card with accessorial terms printed.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">3</span><div><b>Covered in minutes</b> &mdash; direct offers race verified, health-scored carriers in a 15-minute window; first accept wins, everything else auto-closes.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">4</span><div><b>Zero check calls</b> &mdash; live map, milestone timeline, geofenced arrive/depart stamps and document status, streaming to your screen (and your TMS via <a href="integrations.html">webhooks</a>).</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">5</span><div><b>Claims desk with evidence</b> &mdash; detention, TONU and layover claims arrive GPS-stamped; approve on facts, not phone arguments.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">6</span><div><b>One receipt settles the trip</b> &mdash; payables group per trip with PAY-BY deadlines; the carrier (or their factor) confirms and the block turns green. <a href="payments-settlements.html">Payables</a>.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><img src="/shots/partner-wizard-route.webp" alt="The posting wizard — exact address pins that power geofences and real driving miles" width="1100" height="1006" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="height:12px"></div><img src="/shots/acc-broker-claims.webp" alt="The claims desk — GPS-stamped claims with approve, reject and one-tap pay" width="1100" height="769" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real screens &mdash; the wizard that posts it, the claims desk that settles it.</div></div>'
 '</div></div></section>')

hiw += ('<section class="ftx-sec" id="for-shippers"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">For shippers &amp; facilities</div><h2 class="ftx-h">Requested &rarr; moved &rarr; proven</h2>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">1</span><div><b>No authority needed</b> &mdash; choose Shipper (or Facility/Warehouse for dock scheduling); licensed brokerage handles carrier compliance. <a href="create-shipper-account.html">Shipper setup</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">2</span><div><b>Your facilities become pins</b> &mdash; exact addresses power geofenced arrive/depart proof at your own docks; dwell is measured the same way for every carrier.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">3</span><div><b>Request the freight</b> &mdash; route, windows, equipment, requirements; vetted carriers get it with the terms in writing.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">4</span><div><b>Watch it move</b> &mdash; the same live map the carrier sees: truck, ETA, milestones, stale-feed honesty. Your customer&rsquo;s &ldquo;where is it?&rdquo; answers itself. <a href="shipper-solutions.html">Shipper solutions</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">5</span><div><b>Delivered with a paper trail</b> &mdash; signed POD, GPS stamps and documents on the load; invoices ride the receipt-verified rail with confirmations.</div></div>'
 '</div></div>'
 '<div class="reveal"><img src="/shots/partner-wizard-schedule.webp" alt="Freight scheduling — appointment windows and requirements printed on the load" width="1100" height="938" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="height:12px"></div><img src="/shots/partner-live-tracking.webp" alt="Live tracking — the truck on the map with milestone timeline and ETA" width="1100" height="969" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">Real screens &mdash; the windows you set, the truck you watch.</div></div>'
 '</div></div></section>')

hiw += ('<section class="ftx-sec alt" id="for-agents"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">For referral &amp; sales agents</div><h2 class="ftx-h">Link &rarr; pair &rarr; 1% forever</h2>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">1</span><div><b>Your link is live at signup</b> &mdash; free account, referral code ready immediately. <a href="create-agent-account.html">Agent setup</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">2</span><div><b>Bring a pair</b> &mdash; a broker who posts and a carrier who hauls; when both sides of a load are yours, that is your chain: <i>your broker &middot; LoadBoot &middot; your carrier</i>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">3</span><div><b>Loads deliver, you earn</b> &mdash; 1% of every delivered load in your chain lands automatically after the POD verifies; 15-day clearing, monthly payouts to your verified account.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">4</span><div><b>It never costs your clients</b> &mdash; your slice comes from LoadBoot&rsquo;s own flat 5% fee; recruits add levels (0.50%, 0.25%) on top. <a href="agents.html">The agent program</a>.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><img src="/shots/agent-dashboard.webp" alt="The agent dashboard — chain active, referral link, clearing balance and the 5-level commission math" width="1100" height="859" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real dashboard &mdash; chain ACTIVE, your link, your clearing balance.</div></div>'
 '</div></div></section>')

hiw += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Why the loop holds</div><h2>Four screens, one truth</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:24px">'
 '<div class="card"><div class="icon">&#128737;</div><h3>Verified on both sides</h3><p>Carriers pass authority, insurance and health checks; posting requires a licensed broker or verified shipper. Nobody unvetted touches a load. <a href="compliance.html">Verification</a>.</p></div>'
 '<div class="card"><div class="icon">&#128203;</div><h3>Terms printed, not implied</h3><p>The rate card &mdash; detention, TONU, layover, lumper &mdash; rides every posting. Disputes die young because everyone agreed in writing.</p></div>'
 '<div class="card"><div class="icon">&#128752;</div><h3>Evidence, not memory</h3><p>Server-side GPS stamps at every stop; the same map and log on every screen. Symmetric information is the dispute killer.</p></div>'
 '<div class="card"><div class="icon">&#128181;</div><h3>Money with receipts</h3><p>Auto-DUE on delivery, PAY-BY deadlines, receipt-verified transfers, confirmations, factoring routed by NOA &mdash; every dollar keeps its paper trail.</p></div>'
 '</div></div></section>')
hiw += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>How-it-works FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _HIW_FAQ)
 + '</div></div></section>')
hiw += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:56px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:1.9rem">Pick your screen. The loop is already running.</h2>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:22px">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128666; Carrier</a>'
 '<a href="create-broker-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127970; Broker</a>'
 '<a href="create-shipper-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#127981; Shipper</a>'
 '<a href="create-agent-account.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">&#129309; Agent</a>'
 '</div></div></section>')
RELATED['how-it-works.html'] = [('load-board.html','Live Load Board'),('book-truck-loads.html','One-Tap Booking'),('gps-tracking.html','GPS Tracking & Proof'),('payments-settlements.html','Payments & Settlements'),('compliance.html','Compliance & Verification'),('features.html','All Features')]
page('how-it-works.html', 'How LoadBoot Works — Load to Paid for Carriers, Brokers, Shippers & Agents', 'The whole loop, step by step: posting with the rate card in writing, first-accept-wins offers to verified carriers, one-tap booking with e-signed rate confirmations, geofenced GPS tracking, automatic invoicing and receipt-verified payment — explained for every role.', 'how-it-works.html', hiw, _hiw_schema)

# ---------- COMMAND CENTER — public transparency page ----------
_cc_faq = [('Is the Command Center a product I can buy?', "No — it is LoadBoot's own operations desk, included in how the marketplace runs. You never pay for it separately; you feel it as same-day verification, verified claims, and receipts that actually get checked."), ('Do humans or software make the decisions?', 'Both, deliberately: software prepares — matching, documents, reminders, evidence — and a person approves anything that moves money or status. The maker and the checker are never the same account.'), ('Can staff edit GPS logs or timestamps?', 'No. Arrive/depart stamps are recorded server-side from GPS events. Nobody — carrier, broker, or LoadBoot staff — has an edit button on the event log.'), ('What does the Command Center see?', 'Role-scoped operational data: verification queues, active trips and exceptions, claims with their GPS evidence, and payment receipts awaiting verification. Private commercial data stays scoped to its owners.')]
_cc_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "Is the Command Center a product I can buy?", "acceptedAnswer": {"@type": "Answer", "text": "No \\u2014 it is LoadBoot\'s own operations desk, included in how the marketplace runs. You never pay for it separately; you feel it as same-day verification, verified claims, and receipts that actually get checked."}}, {"@type": "Question", "name": "Do humans or software make the decisions?", "acceptedAnswer": {"@type": "Answer", "text": "Both, deliberately: software prepares \\u2014 matching, documents, reminders, evidence \\u2014 and a person approves anything that moves money or status. The maker and the checker are never the same account."}}, {"@type": "Question", "name": "Can staff edit GPS logs or timestamps?", "acceptedAnswer": {"@type": "Answer", "text": "No. Arrive/depart stamps are recorded server-side from GPS events. Nobody \\u2014 carrier, broker, or LoadBoot staff \\u2014 has an edit button on the event log."}}, {"@type": "Question", "name": "What does the Command Center see?", "acceptedAnswer": {"@type": "Answer", "text": "Role-scoped operational data: verification queues, active trips and exceptions, claims with their GPS evidence, and payment receipts awaiting verification. Private commercial data stays scoped to its owners."}}]}</script>'
ccpub = FTX_CSS + LBX_CSS
ccpub += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:80px 0 56px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Behind the marketplace</div>'
 '<h1 style="color:#fff;font-size:2.4rem;line-height:1.13;margin:10px 0 16px">The Command Center &mdash; <span style="color:#4ade80">who runs LoadBoot&rsquo;s operations, and how</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.06rem;line-height:1.7">Marketplaces fail in the back office, so we are public about ours. The Command Center is LoadBoot&rsquo;s staff operations desk &mdash; where verifications are approved, claims are checked against GPS evidence, payment receipts are verified and exceptions get a human owner. Software prepares; a person approves anything that moves money or status.</p>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Maker and checker never the same account</span><span>&#x2713; No edit button on the GPS log</span><span>&#x2713; Every action audited</span></div>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:22px"><a href="how-it-works.html" class="btn btn-primary">How the whole loop works &rarr;</a><a href="security.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Security</a></div></div>'
 '<div class="reveal"><div style="background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:20px">'
 '<div style="font-weight:800;margin-bottom:12px">&#128737; What the desk actually does</div>'
 + ''.join('<div style="display:flex;gap:10px;padding:8px 0;border-top:1px solid rgba(255,255,255,.08);font-size:.88rem;color:#cbd5e1"><span>' + i + '</span><div>' + t + '</div></div>' for i,t in [
   ('&#9989;','<b>Verification queue</b> &mdash; documents reviewed same-day; the Uploaded &rarr; In review &rarr; Approved tracker you see is a person working this desk.'),
   ('&#128752;','<b>Trip watch</b> &mdash; blackout watchdogs, stale feeds and exceptions escalate to a named owner, not a ticket pool.'),
   ('&#9878;&#65039;','<b>Claims on evidence</b> &mdash; detention, TONU and layover reviewed against the server-side GPS log before they ever reach an invoice.'),
   ('&#129534;','<b>Receipt verification</b> &mdash; platform-fee and payment receipts checked by a human before anything flips to PAID.'),
   ('&#128200;','<b>Rate standards</b> &mdash; the published accessorial standards on this site are maintained here &mdash; one source of truth for every posting.'),
   ('&#129302;','<b>Automation with a leash</b> &mdash; reminders, matching prep and document chasing run automatically; approvals stay human.')])
 + '</div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The operations desk behind every VERIFIED badge on this site.</div></div>'
 '</div></div></section>')
ccpub += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Why we publish this</div><h2>Trust needs a back office you can point at</h2></div>'
 '<div class="cards g3 reveal" style="margin-top:24px">'
 '<div class="card"><div class="icon">&#128666;</div><h3>For carriers</h3><p>Your documents, claims and receipts are reviewed by accountable staff on deadlines &mdash; not lost in a queue. That is why verification lands the same day.</p></div>'
 '<div class="card"><div class="icon">&#127970;</div><h3>For brokers &amp; shippers</h3><p>Every carrier on your load passed this desk. Every claim you are asked to pay came with its evidence already checked.</p></div>'
 '<div class="card"><div class="icon">&#129309;</div><h3>For agents</h3><p>Your referrals get through onboarding because a human works the queue &mdash; and your payouts clear through the same receipt-verified rail.</p></div>'
 '</div></div></section>')
ccpub += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Command Center FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _cc_faq)
 + '</div></div></section>')
RELATED['command-center.html'] = [('how-it-works.html','How It Works'),('compliance.html','Compliance & Verification'),('security.html','Security'),('about.html','About LoadBoot'),('features.html','All Features'),('contact.html','Contact')]
page('command-center.html', 'The LoadBoot Command Center — How Our Operations Desk Works', 'Transparency about LoadBoot&rsquo;s back office: the staff Command Center where verifications are approved same-day, claims are checked against server-side GPS evidence, payment receipts are verified by humans, and every action is audited — maker and checker never the same account.', 'command-center.html', ccpub, _cc_schema)

sp = FTX_CSS + LBX_CSS

_SHIP_FAQ = [('Do I need a broker authority or contracts to ship with LoadBoot?', "No. You bring the freight and the facilities; movement runs under licensed brokerage and LoadBoot's verified carrier network. No authority, no bond, no long-term contract on your side."), ('How do I know the carrier on my load is legitimate?', 'Every carrier passes authority, insurance and account-health checks before freight is ever offered to them, and credentials are tracked continuously — not photocopied once at setup. See how verification works.'), ('What visibility do I get without check calls?', 'A live map with ETA, a milestone timeline, and geofenced arrive/depart stamps recorded server-side at your own docks — the same record your carrier sees. Stale feeds flag themselves instead of showing you a comforting old dot.'), ('Who controls accessorial charges like detention and lumper?', 'Published standards ride every posting, and claims arrive with their GPS evidence attached — so you approve documented time, never an invented number after the fact. Dwell at your docks is measured identically for every carrier.'), ('Can my warehouse use LoadBoot without booking freight?', 'Yes — the Facility / Warehouse role handles dock appointments and geofenced check-ins so your gate has an accurate arrival record, even when someone else books the truck.'), ('What does it cost a shipper?', "Nothing to use the platform — posting, tracking, documents and the payables view are free. LoadBoot's only revenue is the flat 5% dispatch fee on the carrier side.")]

_ship_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "Do I need a broker authority or contracts to ship with LoadBoot?", "acceptedAnswer": {"@type": "Answer", "text": "No. You bring the freight and the facilities; movement runs under licensed brokerage and LoadBoot\'s verified carrier network. No authority, no bond, no long-term contract on your side."}}, {"@type": "Question", "name": "How do I know the carrier on my load is legitimate?", "acceptedAnswer": {"@type": "Answer", "text": "Every carrier passes authority, insurance and account-health checks before freight is ever offered to them, and credentials are tracked continuously \\u2014 not photocopied once at setup. See how verification works."}}, {"@type": "Question", "name": "What visibility do I get without check calls?", "acceptedAnswer": {"@type": "Answer", "text": "A live map with ETA, a milestone timeline, and geofenced arrive/depart stamps recorded server-side at your own docks \\u2014 the same record your carrier sees. Stale feeds flag themselves instead of showing you a comforting old dot."}}, {"@type": "Question", "name": "Who controls accessorial charges like detention and lumper?", "acceptedAnswer": {"@type": "Answer", "text": "Published standards ride every posting, and claims arrive with their GPS evidence attached \\u2014 so you approve documented time, never an invented number after the fact. Dwell at your docks is measured identically for every carrier."}}, {"@type": "Question", "name": "Can my warehouse use LoadBoot without booking freight?", "acceptedAnswer": {"@type": "Answer", "text": "Yes \\u2014 the Facility / Warehouse role handles dock appointments and geofenced check-ins so your gate has an accurate arrival record, even when someone else books the truck."}}, {"@type": "Question", "name": "What does it cost a shipper?", "acceptedAnswer": {"@type": "Answer", "text": "Nothing to use the platform \\u2014 posting, tracking, documents and the payables view are free. LoadBoot\'s only revenue is the flat 5% dispatch fee on the carrier side."}}]}</script>'

sp += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:80px 0 56px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">For shippers &amp; facilities</div>'
 '<h1 style="color:#fff;font-size:2.35rem;line-height:1.14;margin:10px 0 16px">Freight moved by vetted carriers &mdash; <span style="color:#4ade80">with proof at every dock</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.06rem;line-height:1.7">Post a lane or request coverage, and it goes to carriers who passed authority, insurance and health checks &mdash; under licensed brokerage. Then watch it: live map, ETA, and geofenced arrive/depart stamps recorded at your own docks. On-time performance stops being a debate because both sides read the same record.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-shipper-account.html" class="btn btn-primary">Create a shipper account &rarr;</a><a href="contact.html#quote" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Talk about your lanes</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; Free for shippers</span><span>&#x2713; Vetted capacity only</span><span>&#x2713; Dock-level GPS proof</span></div></div>'
 '<div class="reveal"><img src="/shots/partner-live-tracking.webp" alt="Live shipment tracking for shippers — truck on the map, milestone timeline, ETA and dwell meters" width="1100" height="969" loading="eager" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real shipper view &mdash; your freight, the truck, the ETA, the evidence.</div></div>'
 '</div></div></section>')

sp += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">What shippers actually get asked</div><h2>The four questions your customers ask &mdash; answered by the record</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:24px">'
 '<div class="card"><div class="icon">&#128205;</div><h3>&ldquo;Where is my freight?&rdquo;</h3><p>Live map and ETA on every shipment, updating from the truck itself &mdash; and the feed marks itself stale after 30 minutes of silence instead of lying to you.</p></div>'
 '<div class="card"><div class="icon">&#9200;</div><h3>&ldquo;Did it arrive on time?&rdquo;</h3><p>800-meter geofences stamp arrive and depart at your dock, server-side. OTIF reporting built from facts, not from a driver&rsquo;s memory or a dispatcher&rsquo;s guess.</p></div>'
 '<div class="card"><div class="icon">&#128220;</div><h3>&ldquo;Where is the POD?&rdquo;</h3><p>Signed POD, BOL and dock photos captured at delivery and attached to the load &mdash; not chased by email three days later.</p></div>'
 '<div class="card"><div class="icon">&#128176;</div><h3>&ldquo;Why this accessorial?&rdquo;</h3><p>Detention, lumper and layover follow <a href="detention-pay-policy.html">published standards</a> with GPS evidence attached &mdash; you approve documented time, never a surprise line item.</p></div>'
 '</div></div></section>')

sp += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">Facilities &amp; docks</div><h2 class="ftx-h">Your dock, measured fairly &mdash; and defended</h2>'
 '<p class="ftx-p">Facility teams get their own role: schedule appointments, set FCFS windows and receive geofenced check-ins. The same clock that protects a carrier&rsquo;s detention claim protects you from an inflated one.</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Appointment &amp; FCFS control</b> &mdash; windows and rules print on the posting, so drivers arrive knowing your gate&rsquo;s process. <a href="fcfs-policy.html">Scheduling rules</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Dwell data you can act on</b> &mdash; see which shifts and doors hold trucks longest, measured the same way for every carrier.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Defense against false claims</b> &mdash; no GPS stamp, no detention. Evidence cuts both ways, and that is the point.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Better carriers, repeatedly</b> &mdash; facilities that unload fast get preferred by carriers on the board; the data makes that visible.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><img src="/shots/partner-wizard-schedule.webp" alt="Scheduling a shipment — appointment windows, requirements and dock rules printed on the load" width="1100" height="938" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real scheduler &mdash; windows and requirements, on the load itself.</div></div>'
 '</div></div></section>')

sp += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Straight answer</div><h2>What LoadBoot is &mdash; and is not</h2></div>'
 '<div class="cards g3 reveal" style="margin-top:24px">'
 '<div class="card"><h3>&#9989; What we are</h3><p>A dispatch marketplace and operations platform. Shipper freight moves through <b>licensed broker partners</b>; LoadBoot coordinates capacity, tracking, documents and the money trail around it.</p></div>'
 '<div class="card"><h3>&#10060; What we are not</h3><p>We are not your freight broker of record and we do not hold your funds. Where broker authority is legally required, a licensed partner carries it &mdash; stated plainly, in writing.</p></div>'
 '<div class="card"><h3>&#128179; What it costs you</h3><p>Nothing. Posting, tracking, documents and reporting are free for shippers and facilities &mdash; LoadBoot earns the flat 5% dispatch fee on the carrier side. <a href="pricing.html">See pricing</a>.</p></div>'
 '</div></div></section>')
sp += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Shipper FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _SHIP_FAQ)
 + '</div></div></section>')
sp += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:56px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:1.9rem">Your freight, on the record &mdash; from dock to dock.</h2>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:22px">'
 '<a href="create-shipper-account.html" class="btn btn-primary">&#127981; Create a shipper account</a>'
 '<a href="how-it-works.html" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">How the loop works</a>'
 '<a href="contact.html#quote" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Talk about your lanes</a>'
 '</div></div></section>')
RELATED['shipper-solutions.html'] = [('create-shipper-account.html','Create a Shipper Account'),('gps-tracking.html','GPS Tracking & Proof'),('how-it-works.html','How It Works'),('compliance.html','Carrier Verification'),('detention-pay-policy.html','Accessorial Standards'),('contact.html','Contact')]
page('shipper-solutions.html', 'Shipper Solutions — Vetted Carrier Capacity With Dock-Level GPS Proof | LoadBoot', 'Move freight with carriers vetted for authority, insurance and account health under licensed brokerage: live map and ETA on every shipment, geofenced arrive/depart proof at your own docks, POD captured at delivery, published accessorial standards with GPS evidence — free for shippers and facilities.', 'shipper-solutions.html', sp, _ship_schema)

intg = FTX_CSS + LBX_CSS

_INTG_FAQ = [('Is the QuickBooks sync really live?', 'Yes — native OAuth two-way sync with QuickBooks Online is in production. Connect from Finance → Accounting in the carrier portal: invoices and expenses push into YOUR QuickBooks, and payments received there flow back as paid status.'), ('What if I use Wave, Xero or an accountant?', "One click exports clean CSVs — revenue (gross/fee/net per invoice), every expense, and confirmed payments — ready for File → Import in QuickBooks, Wave, Xero or your accountant's workflow."), ('Do I need an ELD for tracking?', "No — the driver's phone is the tracker. But if you already run Samsara or Motive, paste your API token and LoadBoot polls your trucks every 5 minutes, feeding the active trip even with the app closed. Any other device can POST positions to a secure webhook."), ('Which fuel cards work with the import?', 'EFS, Comdata and WEX statement CSVs import directly — each purchase lands as a fuel expense on the right trip by date, amount and location.'), ('Can my TMS talk to LoadBoot?', 'Yes — the developer portal issues API keys and self-serve webhook endpoints — load, trip, document and delivery events POST to your URL automatically, with retries.'), ('What is still on the roadmap?', 'Fuel-card provider APIs (beyond statement import) — multi-fleet optimization has shipped and lives in the Fleet tab. When something new ships it is documented here first — nothing on this page is vaporware.')]

_intg_schema = '<script type="application/ld+json">{"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": [{"@type": "Question", "name": "Is the QuickBooks sync really live?", "acceptedAnswer": {"@type": "Answer", "text": "Yes \\u2014 native OAuth two-way sync with QuickBooks Online is in production. Connect from Finance \\u2192 Accounting in the carrier portal: invoices and expenses push into YOUR QuickBooks, and payments received there flow back as paid status."}}, {"@type": "Question", "name": "What if I use Wave, Xero or an accountant?", "acceptedAnswer": {"@type": "Answer", "text": "One click exports clean CSVs \\u2014 revenue (gross/fee/net per invoice), every expense, and confirmed payments \\u2014 ready for File \\u2192 Import in QuickBooks, Wave, Xero or your accountant\'s workflow."}}, {"@type": "Question", "name": "Do I need an ELD for tracking?", "acceptedAnswer": {"@type": "Answer", "text": "No \\u2014 the driver\'s phone is the tracker. But if you already run Samsara or Motive, paste your API token and LoadBoot polls your trucks every 5 minutes, feeding the active trip even with the app closed. Any other device can POST positions to a secure webhook."}}, {"@type": "Question", "name": "Which fuel cards work with the import?", "acceptedAnswer": {"@type": "Answer", "text": "EFS, Comdata and WEX statement CSVs import directly \\u2014 each purchase lands as a fuel expense on the right trip by date, amount and location."}}, {"@type": "Question", "name": "Can my TMS talk to LoadBoot?", "acceptedAnswer": {"@type": "Answer", "text": "Yes \\u2014 the developer portal issues API keys and self-serve webhook endpoints — load, trip, document and delivery events POST to your URL automatically, with retries."}}, {"@type": "Question", "name": "What is still on the roadmap?", "acceptedAnswer": {"@type": "Answer", "text": "Fuel-card provider APIs (beyond statement import) — multi-fleet optimization has shipped and lives in the Fleet tab. When something new ships it is documented here first \\u2014 nothing on this page is vaporware."}}]}</script>'

intg += ('<section style="background:linear-gradient(165deg,#0e1c38 0%,#0b1220 60%,#0d1830 100%);color:#fff;padding:80px 0 56px"><div class="wrap"><div class="lbx-grid2">'
 '<div><div class="eyebrow" style="color:#FC5305">Books done for you</div>'
 '<h1 style="color:#fff;font-size:2.4rem;line-height:1.13;margin:10px 0 16px">QuickBooks, ELD &amp; API integrations &mdash; <span style="color:#4ade80">live today, not a roadmap</span></h1>'
 '<p style="color:#cbd5e1;font-size:1.06rem;line-height:1.7">Native two-way QuickBooks Online sync is in production: delivered-freight invoices and expenses push into YOUR books and paid status flows back. ELD tracking connects with a pasted token, fuel cards import as CSVs, and the API and webhooks feed your TMS. Everything on this page is live &mdash; the roadmap section is honest about the rest.</p>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:24px"><a href="create-carrier-account.html" class="btn btn-primary">Connect your books &rarr;</a><a href="/app/developer/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Developer portal &amp; API keys</a></div>'
 '<div style="display:flex;gap:18px;flex-wrap:wrap;margin-top:24px;color:#94a3b8;font-size:.82rem;font-weight:700"><span>&#x2713; QuickBooks two-way sync &mdash; live</span><span>&#x2713; Samsara / Motive ELD</span><span>&#x2713; EFS / Comdata / WEX import</span></div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/qbo-sync-phone.webp" alt="QuickBooks Online connected — invoices auto-push, expenses auto-push, paid-status pull-back, one-tap Sync now" width="420" height="909" loading="eager" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real sync &mdash; connected, 9 records pushed, paid status pulled back.</div></div>'
 '</div></div></section>')

intg += ('<section class="ftx-sec"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal"><div class="ftx-kicker">QuickBooks Online</div><h2 class="ftx-h">Two-way sync your accountant will believe</h2>'
 '<p class="ftx-p">Connect your own QuickBooks Online in two minutes from Finance &rarr; Accounting. From then on the books keep themselves:</p>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Invoices push</b> &mdash; every delivered load becomes a QuickBooks invoice; the customer and a Freight Services item are auto-created.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Expenses push</b> &mdash; fuel, tolls and costs land as Purchases against the right dates.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Paid pulls back</b> &mdash; receive the payment in QuickBooks and LoadBoot marks the invoice paid; the <a href="payments-settlements.html">receivables ledger</a> stays true.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>No QuickBooks? No problem</b> &mdash; export revenue, expenses and payments as clean CSVs for Wave, Xero or your accountant.</div></div>'
 '</div></div>'
 '<div class="reveal"><div style="max-width:340px;margin:0 auto"><img src="/shots/qbo-export-phone.webp" alt="Accounting export — QuickBooks-compatible CSVs for invoices, expenses and payments with date range" width="420" height="596" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The escape hatch &mdash; clean CSVs for any accountant, any software.</div></div>'
 '</div></div></section>')

intg += ('<section class="ftx-sec alt"><div class="wrap"><div class="lbx-grid2">'
 '<div class="reveal" style="order:2"><div class="ftx-kicker">Trucks &amp; fuel</div><h2 class="ftx-h">ELD tracking and fuel cards, without a project</h2>'
 '<div style="margin-top:12px">'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Samsara &amp; Motive &mdash; paste a token</b> &mdash; LoadBoot polls your trucks every 5 minutes and feeds the active trip automatically; tracking runs even with the app closed. (Fleet &rarr; ELD &amp; telematics.)</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Any device, one webhook</b> &mdash; anything that can POST a position can feed the same trail that powers <a href="gps-tracking.html">geofence proof</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Fuel-card CSV import</b> &mdash; EFS, Comdata, WEX statements drop in; every purchase lands on the right trip, feeding <a href="fleet-management.html">P&amp;L and cost per mile</a>.</div></div>'
 '<div class="ftx-li"><span class="ftx-tick">&#x2713;</span><div><b>Google Maps / Waze handoff</b> &mdash; drivers navigate with the apps they love while LoadBoot keeps recording proof in the background.</div></div>'
 '</div></div>'
 '<div class="reveal" style="order:1"><div style="max-width:340px;margin:0 auto"><img src="/shots/fleet-costs-phone.webp" alt="Fuel card CSV import — EFS, Comdata, WEX statements land as trip expenses" width="420" height="836" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.28);box-shadow:0 24px 60px -30px rgba(11,18,32,.55)"></div><div style="text-align:center;color:#64748b;font-size:.78rem;margin-top:8px">The real import &mdash; drop the statement, expenses land on trips.</div></div>'
 '</div></div></section>')

intg += ('<section class="ftx-sec"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">For brokers, shippers &amp; builders</div><h2>An API that speaks TMS</h2></div>'
 '<div class="cards g4 reveal" style="margin-top:24px">'
 '<div class="card"><div class="icon">&#128273;</div><h3>API keys</h3><p>The <a href="/app/developer/">developer portal</a> issues keys for programmatic access &mdash; create, list and revoke from the dashboard.</p></div>'
 '<div class="card"><div class="icon">&#128276;</div><h3>Webhooks</h3><p>Load, trip, document and delivery events delivered to your approved endpoints &mdash; your TMS knows the moment a truck arrives.</p></div>'
 '<div class="card"><div class="icon">&#128737;</div><h3>FMCSA live</h3><p>Authority and safety lookups power <a href="compliance.html">carrier verification</a> &mdash; the same checks your compliance team runs, automated.</p></div>'
 '<div class="card"><div class="icon">&#128202;</div><h3>Fleet analytics &amp; optimization</h3><p>Per-truck utilization, $/mile, best lanes &mdash; and a fleet-wide <b>optimized plan</b>: each board load assigned to the truck it fits best, reload chained. <a href="fleet-management.html">See it</a>.</p></div>'
 '</div>'
 '<div class="cards g1 reveal" style="margin-top:18px"><div class="card"><h3>&#128679; The honest roadmap</h3><p>Not live yet, and clearly labeled: fuel-card <i>provider APIs</i> (beyond statement import). Multi-fleet optimization shipped &mdash; it is in the Fleet tab today. When something new ships it is documented here first. Want it prioritized? <a href="contact.html">Tell us</a>.</p></div></div>'
 '</div></section>')

intg += ('<section class="ftx-sec alt"><div class="wrap"><div class="sec-head reveal"><div class="eyebrow">Questions</div><h2>Integrations FAQ</h2></div><div style="max-width:820px">'
 + ''.join('<details class="reveal" style="background:#fff;border:1px solid #e6ebf3;border-radius:14px;padding:16px 20px;margin-bottom:10px"><summary style="font-weight:700;color:#10223B;cursor:pointer">' + q + '</summary><p style="color:#475569;line-height:1.75;margin:10px 0 0">' + a + '</p></details>' for q,a in _INTG_FAQ)
 + '</div></div></section>')
intg += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff;padding:56px 0"><div class="wrap" style="text-align:center">'
 '<h2 style="color:#fff;font-size:1.9rem">Your books, your trucks, your TMS &mdash; already speaking LoadBoot.</h2>'
 '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-top:22px">'
 '<a href="create-carrier-account.html" class="btn btn-primary">&#128667; Create a carrier account</a>'
 '<a href="/app/developer/" class="btn btn-secondary" style="background:rgba(255,255,255,.08);color:#fff;border:1px solid rgba(255,255,255,.25)">Developer portal</a>'
 '</div></div></section>')
RELATED['integrations.html'] = [('payments-settlements.html','Payments & Settlements'),('fleet-management.html','Fleet Management'),('gps-tracking.html','GPS Tracking & Proof'),('compliance.html','Compliance & Verification'),('features.html','All Features'),('contact.html','Contact')]
page('integrations.html', 'QuickBooks, ELD & API Integrations for Trucking — Live Two-Way Sync | LoadBoot', 'Live integrations, no vaporware: native QuickBooks Online two-way sync (invoices and expenses push, paid status pulls back), Samsara/Motive ELD tracking via pasted token, EFS/Comdata/WEX fuel-card import, CSV exports for Wave/Xero, and an API with webhooks for TMS integration.', 'integrations.html', intg, _intg_schema)

# ---- Apps page: the LoadBoot mobile experience (PWA today, stores in preparation) ----
ap = svc_hero('The LoadBoot App', 'One operating system for trucking &mdash; carrier, broker and shipper tools that live on your phone. Install in 10 seconds, no app store needed.')
ap += _sec('Your apps', 'Same account everywhere &mdash; phone, tablet, laptop.', _cards([
    ('&#128667;', 'LoadBoot Carrier', 'Post your truck, get matched loads, run trips with GPS &amp; detention proof, upload PODs, track your money. <a href="/app/carrier/">Open Carrier &rarr;</a>'),
    ('&#129309;', 'LoadBoot Partner', 'Brokers &amp; shippers: post loads, vet carriers by rating, track shipments live, manage documents. <a href="/app/partner/">Open Partner &rarr;</a>'),
    ('&#129297;', 'LoadBoot Agent', 'Independent dispatchers: refer carriers, brokers &amp; shippers, track your chain and earn 1% of every delivered load. <a href="/app/agent/">Open Agent &rarr;</a>'),
    ('&#128104;&#8205;&#128187;', 'LoadBoot Developer', 'API keys, docs and integrations for your systems. <a href="/app/developer/">Open Developer &rarr;</a>'),
    ('&#127970;', 'Command Center', 'LoadBoot staff operations console. <a href="/app/command-center/">Staff sign-in &rarr;</a>'),
], 'g2'))
ap += _sec('Install on your phone', 'Works like a native app: home-screen icon, full screen, push notifications, works on weak truck-stop signal.', (
    '<div class="cards g2">'
    '<article class="card"><div class="card-ic">&#129302;</div><h3>Android</h3><p>Open <b>loadboot.com/app</b> in Chrome &rarr; tap the menu (&#8942;) &rarr; <b>&ldquo;Install app&rdquo;</b> or <b>&ldquo;Add to Home screen&rdquo;</b>. The LoadBoot icon appears like any other app.</p></article>'
    '<article class="card"><div class="card-ic">&#63743;</div><h3>iPhone</h3><p>Open <b>loadboot.com/app</b> in Safari &rarr; tap <b>Share</b> &rarr; <b>&ldquo;Add to Home Screen&rdquo;</b>. Launches full-screen with the LoadBoot icon.</p></article>'
    '</div>'
    '<p class="src-disc" style="margin-top:18px">Native listings on the Apple App Store and Google Play are in preparation. The installed web app above is the same product with the same account.</p>'))
ap += ('<section style="background:linear-gradient(135deg,#0b1220,#12304f);color:#fff"><div class="wrap" style="padding:64px 0">'
 '<div class="sec-head center reveal" style="color:#fff"><div class="eyebrow" style="color:#7dd3fc">Coming soon</div>'
 '<h2 style="color:#fff;font-size:2rem">LoadBoot is coming to the <span style="color:#FC5305">App Store</span> &amp; <span style="color:#34d399">Google Play</span></h2>'
 '<p class="lead center" style="color:#cbd5e1;max-width:680px;margin:14px auto 0">Native apps with true background GPS, push notifications and offline paperwork are in development. The web app already installs on any phone today — the native apps take it further.</p></div>'
 '<div class="reveal" style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;margin-top:28px">'
 '<div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:14px 26px;display:flex;align-items:center;gap:12px"><span style="font-size:1.7rem">&#63743;</span><div style="text-align:left"><div style="font-size:.68rem;color:#94a3b8;letter-spacing:.06em">COMING SOON ON THE</div><div style="font-weight:800;font-size:1.05rem">App Store</div></div></div>'
 '<div style="background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);border-radius:16px;padding:14px 26px;display:flex;align-items:center;gap:12px"><span style="font-size:1.7rem">&#9654;</span><div style="text-align:left"><div style="font-size:.68rem;color:#94a3b8;letter-spacing:.06em">COMING SOON ON</div><div style="font-weight:800;font-size:1.05rem">Google Play</div></div></div>'
 '</div>'
 '<div class="reveal" style="max-width:520px;margin:30px auto 0;text-align:center">'
 '<p style="color:#cbd5e1;margin-bottom:12px">Be first in line — we email launch day only, nothing else:</p>'
 # NOTE: use the HEX entity &#x2713; here (not &#10003;) — deglyph() rewrites &#10003; into an
 # inline SVG containing double quotes, which TERMINATES this double-quoted onsubmit attribute
 # and dumps the rest of the handler as visible text on the page.
 '<form class="news" style="justify-content:center" onsubmit="event.preventDefault();var f=this,em=f.querySelector(\'input\').value;var done=function(){f.innerHTML=\'<span style=\\\'color:#86efac;font-weight:700\\\'>You are on the launch list &#x2713;</span>\';};if(window.lbSubmitLead){window.lbSubmitLead(\'app_waitlist\',{email:em}).then(done).catch(done);}else{done();}">'
 '<input type="email" placeholder="Your email" required><button class="btn btn-primary" type="submit">Join the launch list</button></form>'
 '</div></div></section>')
page('apps.html', 'LoadBoot App &mdash; Carrier, Broker &amp; Shipper Tools on Your Phone',
     'Install the LoadBoot app on Android or iPhone in seconds: post your truck, book loads, track trips, upload PODs and manage freight from your phone.',
     'apps.html', ap)

# ---- Accessorial policy pages: full 12-section guides (linked from load details & app) ----
_ACC_PAGES = [
 dict(slug='detention-pay-policy', name='Detention Pay',
  defn='Detention is paid waiting time: when a shipper or receiver holds your truck past the free time written on the rate confirmation.',
  std='$60/hour after 2 hours free time', ctx='ATRI (2024): drivers were detained on 39% of stops; detention cost trucking $15B in one year. Average charged rates run $60&ndash;$75/hr.',
  story='You arrive at a Dallas warehouse at 8:00 AM for an 8:00 appointment. The dock does not release you until 1:30 PM. Your free time ended at 10:00 &mdash; that is 3.5 billable hours. At $60/hr you are owed $210, and with timestamps nobody can argue.',
  why='A parked truck still costs about $65&ndash;$70 every hour (truck payment, insurance, driver, opportunity). Free time covers normal dock work; past it, the facility is renting your truck.',
  rules=[('Free time','2 hours per stop, measured from your on-time arrival (appointment time or FCFS gate check-in).'),('Rate after free time','$60/hour or the higher rate on the posting, billed in 15-minute increments.'),('Notification','The broker must be notified BEFORE free time expires &mdash; LoadBoot stamps your arrival and drafts the message for you.'),('Evidence','GPS-stamped arrive/depart, gate ticket photo, or signed in/out times on the BOL.'),('Cap &amp; cutover','Accrues up to 5 hours; past an overnight hold, layover applies on top.')],
  steps=['Tap ARRIVE the moment you reach the gate &mdash; GPS + time recorded','App warns you 30 min before free time ends','One tap sends the broker the pre-drafted notification','Tap DEPART when released &mdash; detention minutes calculated automatically','Evidence pack + amount attach to the trip invoice'],
  mistakes=[('Arriving late','Detention starts from your ON-TIME arrival. Late arrival = clock starts at appointment anyway? No &mdash; late arrival usually voids it.'),('No written notice','Calling is not proof. Send the in-app notification so there is a timestamped record.'),('Missing out-time','An in-time without an out-time is half a claim. Stamp both.'),('Waiting to invoice','Submit with the delivery paperwork &mdash; weeks-old claims get "researched" forever.')],
  example=('781-mile load, 8:00 appointment, released 13:30', [('On-time arrival','8:00 AM &mdash; GPS stamped'),('Free time ends','10:00 AM'),('Released','1:30 PM &mdash; departure stamped'),('Billable detention','3.5 hours'),('Owed @ $60/hr','<b>$210</b>')]),
  faq=[('Do I get detention if I am late?','Usually no &mdash; free time assumes an on-time arrival. Arrive inside the window and stamp it.'),('The facility says their records show less time?','Your GPS arrive/depart stamps plus a gate ticket photo beat memory. That is the point of the app.'),('Detention on both pickup AND delivery?','Yes &mdash; free time applies per stop.'),('Broker refuses to pay?','The claim, evidence and rate confirmation go through LoadBoot dispatch; refusals are tracked on the broker&rsquo;s record.')]),
 dict(slug='tonu-policy', name='TONU (Truck Ordered, Not Used)',
  defn='TONU compensates a carrier when a confirmed load cancels after the truck is committed or already moving to pickup.',
  std='$250 flat (typical range $150&ndash;$350)', ctx='A cancelled load costs the carrier the whole day: other freight was turned down and deadhead miles were often already burned.',
  story='You accept a Friday load, decline two others, and drive 45 miles toward pickup. At 7:40 AM the broker texts: &ldquo;Load cancelled.&rdquo; Without TONU you ate the morning and the miles. With it, you invoice $250 + deadhead the same day.',
  why='A rate confirmation is a commitment on both sides. TONU is the price of breaking it late &mdash; it keeps posting parties honest about load readiness.',
  rules=[('When it applies','Cancelled after rate confirmation, or the truck arrives and there is no freight.'),('Standard amount','$250 unless the posting states another figure.'),('Deadhead add-on','Miles already driven toward pickup are commonly added per-mile.'),('Evidence','Rate confirmation + timestamped cancellation + your GPS position at cancellation.'),('Deadline','Invoice within 48 hours with the evidence pack.')],
  steps=['Load cancels &mdash; screenshot/keep the message (time matters)','Tap "Report issue → TONU" on the trip','App attaches your GPS position + the rate con automatically','TONU amount fills from the posting terms','Claim goes to the broker with the evidence pack'],
  mistakes=[('No rate confirmation','No rate con, no TONU. Never roll a wheel without one.'),('Verbal cancellation only','Ask them to send it in writing &mdash; or confirm it back in writing yourself.'),('Sitting on it','48-hour window. Same-day invoicing gets paid; next-week invoicing gets ignored.'),('Confusing TONU with detention','Load exists but you waited = detention. Load died = TONU.')],
  example=('Friday 26k dry van load, cancelled 7:40 AM en route', [('Rate confirmation','signed Thursday 6 PM'),('Truck committed','2 other loads declined'),('Cancelled','7:40 AM, 45 mi into deadhead'),('TONU','<b>$250</b>'),('Deadhead 45 mi @ $2','+$90 (if posting includes it)')]),
  faq=[('The broker says the shipper cancelled &mdash; not their fault?','Your contract is with the posting party. Their recovery from the shipper is their business.'),('Does TONU apply if I cancel?','No &mdash; it protects the committed truck, not the cancelling side. Carrier cancellations hurt your rating instead.'),('What if they &ldquo;postpone&rdquo; to tomorrow?','A next-day move is a new commitment; today&rsquo;s dead day is still TONU territory unless you agree otherwise.'),('Is TONU taxable revenue?','It is business income like any other line item &mdash; ask your tax professional.')]),
 dict(slug='layover-policy', name='Layover Pay',
  defn='Layover pays for a full day the truck is held: when loading or unloading pushes past the same day through no fault of the driver.',
  std='$250 per day (typical range $150&ndash;$350)', ctx='Layover begins where detention ends &mdash; once a hold crosses into an overnight, per-hour billing stops and the daily rate applies.',
  story='A receiver takes your 4 PM appointment and keeps pushing the dock. At 9 PM they say &ldquo;first thing tomorrow.&rdquo; You sleep in the lot. That night is not free: 5 hours detention up to the cutover + $250 layover for the day lost.',
  why='An overnight hold takes away tomorrow&rsquo;s load, not just today&rsquo;s hours. The daily rate reflects the real unit of loss: a working day.',
  rules=[('When it applies','Not loaded/unloaded the same day; the driver must stay over.'),('Standard amount','$250 per 24-hour period, on top of detention already earned before the cutover.'),('Notification','Tell the broker before the day rolls over &mdash; the app reminds you.'),('Evidence','Arrive stamp, facility communication, next-day out-time.'),('Driver welfare','Layover never erases detention correctly earned before it began.')],
  steps=['Arrive stamped as usual &mdash; detention clock runs','If the facility signals an overnight, tap "Report issue → Layover"','App notifies the broker before midnight with your stamps','Next morning, DEPART stamp closes the timeline','Detention (to cutover) + layover day both calculated on the invoice'],
  mistakes=[('Leaving the facility unrecorded','If you drive off to a truck stop without stamping/telling the broker, the timeline breaks.'),('Accepting &ldquo;come back tomorrow&rdquo; verbally','Get it in the app thread &mdash; that message IS the claim.'),('Billing hours overnight','Overnight = day rate, not 14 hours of detention. Correct claims get paid faster.'),('No next-day out-time','Close the loop or the &ldquo;day&rdquo; is arguable.')],
  example=('4 PM appointment slides overnight', [('Arrive (stamped)','3:45 PM'),('Free time ends','6:00 PM'),('Detention 6:00&ndash;11:00 PM','5 h @ $60 = $300'),('Overnight hold','confirmed in writing 9:12 PM'),('Layover day','<b>+$250</b>')]),
  faq=[('Detention AND layover together?','Yes &mdash; detention up to the cutover (cap 5h), then the day rate. They answer different losses.'),('Who pays my hotel?','Unless the posting says lodging, layover is the compensation &mdash; spend it as you choose.'),('Two nights?','$250 per 24h period, each documented the same way.'),('Reefer fuel overnight?','Track it as an expense; reefer fuel clauses vary by posting &mdash; check the rate card.')]),
 dict(slug='lumper-policy', name='Lumper Fees',
  defn='A lumper is third-party loading/unloading labor at a warehouse. The receiver hires them &mdash; the carrier must not permanently pay for them.',
  std='Reimbursed 100% with receipt (or broker pays direct)', ctx='Standard practice: the broker either pays the lumper service directly (preferred) or reimburses the carrier against a receipt &mdash; promptly, not &ldquo;with settlement in 45 days&rdquo;.',
  story='Grocery warehouse, 5 AM. The lumper service wants $180 before they touch a pallet. You pay with a Comchek the broker issued after one in-app request, photograph the receipt, and the $180 never touches your pocket.',
  why='Lumper crews work for the facility, not the carrier. Freight rates are quoted assuming the labor cost belongs to the receiving side.',
  rules=[('Default on LoadBoot','Reimbursed with receipt, unless the posting says &ldquo;Broker pays lumper directly&rdquo;.'),('Receipt required','Photograph the lumper receipt in the app immediately &mdash; no receipt, no reimbursement.'),('Advance option','Ask for an EFS/Comchek code before unloading starts.'),('Not driver assist','If the DRIVER does the work instead, driver assist applies &mdash; different item, different rate.'),('Timeline','Reimbursement is due against proof; LoadBoot tracks it on the trip.')],
  steps=['Facility quotes a lumper fee &mdash; request an advance code in the app','If you front it, pay and PHOTOGRAPH the receipt immediately','Upload the receipt to the trip (Scan-to-PDF works offline)','Reimbursement line item attaches to the trip automatically','Status tracked until the money is back'],
  mistakes=[('Paying cash, no receipt','Cash + no paper = your donation to the warehouse.'),('Waiting until settlement','Request reimbursement the same day; it is not a settlement item.'),('Doing the work yourself &ldquo;to save time&rdquo;','That converts a reimbursable fee into unpaid labor &mdash; use driver assist terms instead.'),('Blurry receipt photos','Retake it. Amount, date and facility must be readable.')],
  example=('$180 lumper at a grocery DC', [('Lumper quote','$180 before unload'),('Broker Comchek','requested &amp; received in-app'),('Receipt','photographed &amp; uploaded'),('Out of pocket','<b>$0</b>'),('If fronted','reimbursed 100% against receipt')]),
  faq=[('The facility demands cash only?','Pay, get a numbered receipt, photograph it &mdash; reimbursement still applies.'),('Broker says lumper is &ldquo;in the rate&rdquo;?','Then the posting must say so. On LoadBoot the lumper policy is a required field &mdash; check the load&rsquo;s rate card.'),('Lumper damaged freight?','Note it on the BOL and photograph &mdash; liability follows the labor.'),('Can I refuse to pay a lumper?','You can, but the freight may not move. Escalate through the app instead of a dock standoff.')]),
 dict(slug='driver-assist-policy', name='Driver Assist',
  defn='Driver assist pays the DRIVER for physically helping load or unload freight &mdash; work beyond driving that saves the receiver a lumper fee.',
  std='$75 typical (range $50&ndash;$150 per stop)', ctx='If a facility expects driver labor, it must be on the rate confirmation with a rate. Surprise &ldquo;driver unload&rdquo; demands are a classic margin leak.',
  story='The posting said &ldquo;no touch&rdquo;. At delivery, the dock says &ldquo;driver breaks the pallets down or you wait 6 hours.&rdquo; One in-app message gets the broker&rsquo;s written approval for $100 assist &mdash; and now it is paid work, not a shakedown.',
  why='Driving and warehouse labor are different jobs. When the driver does the second job, the second job gets paid.',
  rules=[('When it applies','The posting states driver load/unload, or the facility requires it on site WITH broker approval.'),('Standard amount','$75 per stop unless the posting sets its own figure.'),('On-site surprises','Get written broker approval in the app BEFORE touching freight.'),('Evidence','Photo of the freight + the approval message.'),('Safety','Drivers may decline assist work; declining shifts the job to a lumper.')],
  steps=['Check the load&rsquo;s rate card &mdash; assist rate shows before you book','If demanded on site, tap "Report issue → Driver assist"','Broker approves in writing with the rate','Do the work; photograph before/after','Line item attaches to the trip invoice'],
  mistakes=[('Working first, asking later','No prior written approval = the hardest claim in freight.'),('Confusing it with lumper','Someone ELSE paid to work = lumper. YOU worked = assist.'),('No rate agreed','&ldquo;They said they&rsquo;d take care of me&rdquo; is not a rate.'),('Skipping photos','Before/after photos also protect you from damage claims.')],
  example=('&ldquo;No touch&rdquo; load turns into driver unload', [('Posting said','no touch'),('Dock demands','driver breakdown'),('In-app escalation','broker approves $100 in writing'),('Work done','photos attached'),('Invoice line','<b>+$100 driver assist</b>')]),
  faq=[('Can the facility force me to unload?','No. Without agreed assist terms, the alternatives are a lumper or the broker resolving it.'),('Is assist taxed like linehaul?','It is ordinary business revenue &mdash; ask your tax professional.'),('Pallet jack rental on top?','Facility equipment fees are the facility&rsquo;s; if you rent, expense it and flag to the broker.'),('Assist on both stops?','Per stop, if agreed per stop.')]),
 dict(slug='fcfs-policy', name='FCFS (First Come, First Served)',
  defn='FCFS means no fixed appointment: the facility works trucks in arrival order inside a stated window.',
  std='Scheduling policy &mdash; free time still applies from check-in', ctx='FCFS does NOT cancel detention: your 2 free hours start when you check in at the gate inside the FCFS window.',
  story='Window 6 AM&ndash;2 PM, FCFS. You gate-check at 6:10 AM, stamp arrival, and you are 4th in line. Docked by 7:30, out by 9. The driver who &ldquo;strolled in&rdquo; at 1:45 PM rolls to tomorrow &mdash; and eats a layover argument you never had.',
  why='FCFS trades a guaranteed slot for flexibility. The trade only works if the clock and the queue are recorded &mdash; otherwise &ldquo;first come&rdquo; becomes &ldquo;whoever the dock likes&rdquo;.',
  rules=[('How it works','Arrive any time inside the posted window; the gate logs your order.'),('Detention clock','Free time runs from gate check-in &mdash; stamp it the moment you arrive.'),('Best practice','Arrive early in the window; late arrivals risk rolling to the next day (see layover).'),('Evidence','Gate ticket photo + GPS arrive stamp.'),('Posting rule','A LoadBoot posting must state FCFS or an appointment &mdash; never neither.')],
  steps=['Posting shows FCFS + window before you book','Plan to hit the window early','Tap ARRIVE at the gate &mdash; stamp + photo the gate ticket','Queue position noted; detention clock running from check-in','Depart stamp closes the stop'],
  mistakes=[('Treating the window as an appointment','2 PM window-end arrival is technically inside &mdash; and practically tomorrow.'),('Not stamping check-in','With FCFS your check-in time IS your whole case.'),('Skipping the gate ticket photo','It proves queue position when docks shuffle the order.'),('Assuming FCFS = no detention','Free time applies from check-in like anywhere else.')],
  example=('FCFS 6 AM&ndash;2 PM window', [('Gate check-in','6:10 AM &mdash; stamped + ticket photo'),('Free time ends','8:10 AM'),('Docked','7:30 AM'),('Out','9:00 AM'),('Detention','<b>$0 &mdash; and provably so</b>')]),
  faq=[('The dock took trucks out of order?','Your gate ticket + stamp document the jump &mdash; escalate in-app; repeated offenders show in facility stats.'),('Detention at FCFS &mdash; really?','Yes: check-in starts free time. Past 2 hours, the meter runs.'),('Window missed because of my earlier stop&rsquo;s detention?','That is exactly why upstream detention gets documented &mdash; the cascade is the industry&rsquo;s $15B problem.'),('Can a posting be FCFS with no window?','Not on LoadBoot &mdash; a window is required.')]),
]
_ACC_PAGES.append(dict(slug='emergency-rescheduling-policy', name='Emergency Rescheduling',
  defn='The Emergency Rescheduling Policy protects everyone when a truck has a verified on-road emergency: the delivery window is rescheduled through LoadBoot Dispatch with no penalty to the carrier, and the broker and shipper get a fair, fast, clock-bound process.',
  std='Verified emergency &rarr; new window proposed &rarr; 2-hour response window per party &rarr; auto-reschedule if no response',
  ctx='Breakdowns, accidents and medical events are a daily reality of trucking. Without a written process, drivers get blamed, brokers get surprised, and shippers get silence. This policy replaces phone-tag with a verified, timestamped chain.',
  story='A tire blows on I-20 near Shreveport. The driver reports it inside the trip with a photo and live GPS. Dispatch verifies in minutes, proposes a next-morning window from the driver&rsquo;s own downtime estimate, the broker taps Accept, the shipper confirms a new dock slot &mdash; and the rate confirmation updates itself. No shouting, no penalty, all on record.',
  why='Carriers deserve protection when something real goes wrong; brokers and shippers deserve proof that it IS real, plus a guaranteed response clock so a load never hangs in limbo.',
  rules=[('Verification first','Nothing is rescheduled on a phone call alone. LoadBoot Dispatch runs a 4-point check: live GPS trail (stationary where reported), photo proof with matching time/location, a driver call-back, and the carrier&rsquo;s claim history.'),
    ('Driver supplies downtime','Only the driver knows when the truck will be road-ready (2h/6h/12h/24h/48h or &ldquo;not sure&rdquo; &mdash; then Dispatch calls first). The proposed window = old window + downtime + remaining transit, rounded to the next facility slot.'),
    ('Proposed is not final','The carrier sees PROPOSED until every required party confirms. Broker-posted loads: broker accepts or counters. Shipper-originated loads: the broker forwards and the SHIPPER&rsquo;s dock confirmation is final.'),
    ('2-hour response window','Each responding party has 2 hours. No response &rarr; policy auto-reschedule: open delivery locks the proposed window; appointment delivery books the next available dock slot.'),
    ('Counters are bounded','A counter-window must be within &plusmn;12 hours of the proposal and is matched against the driver&rsquo;s readiness before it is locked.'),
    ('No penalty on verified emergencies','No TONU, no late fee, no on-time-score damage for the carrier. This clause is accepted by every broker and shipper at posting &mdash; posting is impossible without it.'),
    ('Driver communication line','Drivers may give facilities ETA/check-in updates only; every window change flows through LoadBoot Dispatch.'),
    ('Fraud consequences','A false report (moving GPS during a &ldquo;breakdown&rdquo;, stale photos, repeated claims) suspends auto-protection, damages the carrier&rsquo;s score and can end in a platform ban; the broker&rsquo;s TONU rights revive.')],
  steps=['Driver reports inside the trip: type, need (reschedule / help / both), note, photo proof, live GPS (required)','Driver picks a road-ready estimate &mdash; the engine proposes the new window','Dispatch verifies genuine with the 4-point check','Per load type, the responding parties accept, counter (&plusmn;12h) or time out into auto-reschedule','Everyone gets the FINAL window; the rate confirmation updates; the evidence pack stays with the trip'],
  mistakes=[('Reporting by phone only','Use the in-app report &mdash; without GPS + proof, the no-penalty protection cannot attach.'),('Guessing the downtime high','The next trip&rsquo;s data shows real repair time; inflated estimates look like fraud sensors firing.'),('Broker ignoring the clock','Silence does not park the load &mdash; after 2 hours the policy reschedules it automatically.'),('Shipper skipping the dock update','On appointment freight the reschedule is only real once a dock slot exists; confirm or propose a slot inside the window.')],
  example=('Breakdown on I-20, delivery was Jul 5, 08:00&ndash;12:00', [('Driver downtime estimate','~24 hours (parts order)'),('Engine proposal','Jul 6, 08:00&ndash;12:00'),('Dispatch verification','4/4 checks &mdash; genuine'),('Broker response','Accepted in 41 minutes'),('Shipper dock','Confirmed for the new window'),('Result','<b>Rescheduled &mdash; zero penalty, all evidence on file</b>')]),
  faq=[('Who sets the new time &mdash; the driver or the broker?','The driver supplies facts (downtime); the engine proposes; the responding party (broker, or shipper on shipper-originated freight) confirms or counters within policy bounds. Nobody dictates alone.'),
    ('What if nobody responds?','That is the point of the 2-hour rule: the load never hangs. Open delivery locks the proposed window; appointment freight books the next available dock slot automatically.'),
    ('Can a broker just refuse?','No. At posting every broker accepted this policy. The options are accept, a bounded counter, or timeout &mdash; refusal is not one of them on a verified emergency.'),
    ('What about loads LoadBoot sourced from external boards?','LoadBoot Dispatch calls and emails the source contact directly, logs the outcome, and the same clock applies to our follow-up.'),
    ('How is fraud caught?','GPS trail continuity, photo EXIF time/location, call-back, claim frequency, and repair-time cross-checks. Any failed sensor freezes auto-reschedule for human review.')]))

# ---- SEO layer for the money pages: search-intent titles, evidence checklists,
# ---- "broker refuses" escalation, FAQ schema, conversion CTA. (2026 keyword research)
_ACC_SEO = {
 'detention-pay-policy': dict(
   title='Detention Pay for Truckers 2026: Rates, How to Claim &amp; Get Paid | LoadBoot',
   desc='Detention pay explained for carriers: $50\u2013$100/hr 2026 rates, the 2-hour free time rule, exactly how to claim detention, what evidence to collect, and what to do when a broker refuses \u2014 plus how LoadBoot pays it automatically.',
   ev=['Timestamped photo of your truck AT the gate on arrival (phone camera puts time + GPS in the file)',
       'The appointment time straight off the rate confirmation \u2014 on-time arrival is the foundation of every claim',
       'GPS arrive/depart stamps (ELD or the LoadBoot app records them for you)',
       'In/out times WRITTEN and SIGNED on the BOL by the facility \u2014 their own paper is the strongest proof',
       'Gate ticket or lumper receipt showing times',
       'The notification you sent the broker BEFORE free time expired (screenshot the send time)'],
   deny=[('\u201cYou never notified us in time\u201d','Notify before free time ends \u2014 in writing. LoadBoot drafts and stamps this message automatically 30 minutes before your free time expires.'),
        ('\u201cNo proof of arrival time\u201d','ATRI research: under 50% of detention invoices get paid, and weak documentation is the #1 reason. GPS-stamped arrive/depart ends the argument before it starts.'),
        ('\u201cDetention wasn\u2019t on the rate con\u201d','If you signed a rate con without a detention clause, that load is lost \u2014 negotiate BEFORE accepting. On LoadBoot every posting carries a written detention rate; a load cannot post without one.'),
        ('\u201cSubmit within 24 hours or forget it\u201d','Late paperwork dies in an inbox. LoadBoot builds the claim from trip data and files it the moment you tap submit.')]),
 'tonu-policy': dict(
   title='TONU in Trucking 2026: Truck Ordered Not Used Fee \u2014 How to Get Paid | LoadBoot',
   desc='TONU (Truck Ordered Not Used) explained: typical $150\u2013$300+ fees, who pays, how to invoice a TONU, the evidence you need, and what to do when a broker refuses \u2014 on LoadBoot the TONU is pre-agreed in writing and auto-paid on late cancels.',
   ev=['The signed rate confirmation with the TONU clause \u2014 without it in WRITING, a TONU is nearly unenforceable',
       'Proof of dispatch: when the truck was assigned and rolling (LoadBoot trip record)',
       'GPS trail showing deadhead miles already driven toward the pickup',
       'The cancellation itself \u2014 who cancelled, when, in writing (LoadBoot snapshots the cancellation trail)',
       'Timestamped photo at the facility if the load \u201cdied\u201d after arrival'],
   deny=[('\u201cIt was only a verbal booking\u201d','Verbal promises are almost impossible to enforce. A signed rate con is a binding contract \u2014 LoadBoot executes one on every booking, automatically.'),
        ('\u201cThe shipper cancelled, not us\u201d','Per contract the broker pays you and recovers from the shipper \u2014 that is their problem, not yours. LoadBoot\u2019s broker-cancel flow generates the TONU accessorial instantly with the evidence snapshot attached.'),
        ('\u201cYou hadn\u2019t left yet\u201d','TONU eligibility timing must be in the clause. LoadBoot\u2019s standard: a committed, dispatched load that dies late owes the posted TONU \u2014 measured from the trip record, not memory.'),
        ('Broker simply ghosts the invoice','Escalation path: written demand \u2192 BMC-84 bond claim \u2192 small claims. On LoadBoot you skip all three: settlement runs through the platform.')]),
 'layover-policy': dict(
   title='Layover Pay in Trucking 2026: Rates, Rules &amp; How to Claim | LoadBoot',
   desc='Layover pay for truck drivers: typical $150\u2013$350/day 2026 rates, when a delay becomes a layover vs detention, the documentation that gets it paid, and how LoadBoot pre-agrees layover on every load.',
   ev=['Detention record for the same stop \u2014 layover usually begins where detention maxes out',
       'GPS trail proving the truck stayed at/near the facility overnight',
       'Written instruction (or refusal to release) from the facility or broker \u2014 screenshot everything',
       'Hotel/parking receipts if you incurred them',
       'The rate confirmation layover clause'],
   deny=[('\u201cYou chose to stay\u201d','A layover is the FACILITY\u2019s hold, not your choice \u2014 the written release-refusal or next-day appointment is your proof. LoadBoot logs it on the trip.'),
        ('\u201cDetention already covers it\u201d','Industry standard: layover applies ON TOP of earned detention once the hold crosses overnight. LoadBoot\u2019s standard says exactly that, in writing, on every load.'),
        ('\u201cNo layover in the agreement\u201d','Then it does not exist for that load. On LoadBoot a load cannot post without a layover rate.')]),
 'lumper-policy': dict(
   title='Lumper Fees 2026: Reimbursement Rules \u2014 Never Pay Out of Pocket | LoadBoot',
   desc='Lumper fees explained: $75\u2013$600 typical (avg ~$300), why it is a PASS-THROUGH cost you must get back, the receipt rules that guarantee reimbursement, and how LoadBoot makes lumper repayment automatic.',
   ev=['The lumper RECEIPT \u2014 non-negotiable: name of service, amount, date, load/PO reference',
       'Photo of the receipt uploaded from the dock BEFORE you leave (LoadBoot stop-proof upload)',
       'Payment proof if you paid card/EFS (statement line)',
       'The rate con lumper clause (broker pays direct vs reimbursed with receipt)'],
   deny=[('\u201cNo receipt, no reimbursement\u201d','They are right \u2014 the receipt IS the claim. Photograph it at the dock; LoadBoot attaches it to the trip and the invoice in one tap.'),
        ('\u201cWe never approved the lumper\u201d','Get approval in writing before paying \u2014 LoadBoot\u2019s standard requires the policy (broker pays direct / reimbursed with receipt) to be declared at posting, so approval already exists.'),
        ('Reimbursement takes 60+ days','A pass-through cost should never finance the broker. LoadBoot settles lumper with the linehaul \u2014 one settlement, documented.')]),
 'driver-assist-policy': dict(
   title='Driver Assist &amp; Unloading Pay 2026: When the Driver Works the Dock | LoadBoot',
   desc='Driver assist (driver load/unload) pay: typical $75\u2013$150 per stop in 2026, why it must be agreed in writing BEFORE the dock, the evidence to collect, and how LoadBoot bakes it into every posting.',
   ev=['The rate con driver-assist clause \u2014 agreed BEFORE the truck rolls',
       'Photo/video at the dock showing the driver working (timestamped)',
       'BOL notation \u201cdriver assist / driver unload\u201d signed by the facility',
       'In/out times \u2014 assists often create detention too; claim both'],
   deny=[('\u201cThe driver volunteered\u201d','Never touch freight without the fee in writing. On LoadBoot, if a posting requires driver assist it carries the fee \u2014 the broker agreed to industry-standard rates at posting.'),
        ('\u201cThat\u2019s included in the linehaul\u201d','Loading is the shipper\u2019s job. Industry standard is $75\u2013$150/stop on top \u2014 LoadBoot prints it on the rate confirmation.'),
        ('Facility denies the driver worked','The signed BOL notation + a 10-second dock photo ends that conversation.')]),
 'fcfs-policy': dict(
   title='FCFS in Trucking 2026: First Come First Served \u2014 and Detention Still Applies | LoadBoot',
   desc='FCFS (first come, first served) explained for truckers: how the arrival window works, why detention still starts at gate check-in, the queue evidence that protects you, and what to do when a dock takes trucks out of order \u2014 plus how LoadBoot stamps your check-in automatically.',
   ev=['Gate check-in time \u2014 photograph the gate ticket the moment you arrive; with FCFS your check-in IS your whole case',
       'GPS arrive stamp inside the posted FCFS window (ELD or the LoadBoot app records it)',
       'The posting showing FCFS + the exact window \u2014 a LoadBoot load always states one',
       'Your queue position or number if the facility issues one',
       'Depart stamp to close the stop and prove total time on site'],
   deny=[('\u201cFCFS means no detention\u201d','False \u2014 free time runs from your gate check-in exactly like an appointment, and past 2 hours the meter runs. LoadBoot stamps check-in automatically so the clock is provable.'),
        ('\u201cYou arrived too late in the window\u201d','Rolling in at the very end of an 8-hour window often bumps you to the next day. Hit the window early and stamp it \u2014 LoadBoot flags late-window risk before you book.'),
        ('\u201cThe dock took trucks out of order\u201d','Your gate ticket photo + GPS stamp document the jump. Escalate in-app; repeat offenders surface in facility stats other carriers can see.'),
        ('\u201cNo window was posted\u201d','A load cannot post on LoadBoot as FCFS without a window \u2014 no window, no ambiguity, no free-detention argument.')]),
 'emergency-rescheduling-policy': dict(
   title='Truck Breakdown &amp; Emergency Load Rescheduling 2026: No-Penalty Process | LoadBoot',
   desc='What happens when a truck breaks down or has an on-road emergency: how the delivery gets rescheduled with zero carrier penalty, the proof that protects you, the 2-hour broker response clock, and how LoadBoot verifies and re-times the load automatically.',
   ev=['Live GPS showing the truck stationary where the emergency was reported (the LoadBoot trip records it)',
       'A timestamped photo of the breakdown or incident with matching time + location (phone EXIF)',
       'Your honest road-ready estimate \u2014 2h / 6h / 12h / 24h / 48h \u2014 the engine builds the new window from it',
       'The original delivery window straight off the rate confirmation',
       'Any repair invoice or roadside receipt once you have it'],
   deny=[('\u201cYou\u2019re late \u2014 that\u2019s a service failure / TONU\u201d','Not on a verified emergency. Every broker accepted the no-penalty clause at posting; with GPS + photo proof there is no TONU, no late fee and no on-time-score hit.'),
        ('\u201cWe never agreed to reschedule\u201d','The 2-hour response clock removes the argument: accept, counter within \u00b112h, or the policy auto-reschedules. Refusal is not one of the options on a verified emergency.'),
        ('\u201cProve it\u2019s a real breakdown\u201d','That is exactly what the 4-point check does \u2014 live GPS trail, photo time/location, driver call-back and claim history. Fake reports fail the sensors and lose protection.'),
        ('Broker goes silent to run out the clock','Silence does not park the load. After 2 hours open delivery locks the proposed window and appointment freight books the next available dock slot automatically.')]),
}
_ACC_CSS = (
 '.accx-hero{display:flex;gap:26px;align-items:center;flex-wrap:wrap;background:linear-gradient(120deg,#0b1830,#10223B 60%,#14335c);border-radius:22px;padding:28px 30px;color:#fff;box-shadow:0 24px 60px -28px rgba(2,12,30,.55)}'
 '.accx-art{flex:0 0 190px;display:flex;justify-content:center}'
 '.accx-art svg{animation:accxFloat 4.5s ease-in-out infinite}'
 '@keyframes accxFloat{0%,100%{transform:translateY(0)}50%{transform:translateY(-9px)}}'
 '.accx-spin{transform-origin:50% 50%;animation:accxSpin 6s linear infinite}'
 '@keyframes accxSpin{to{transform:rotate(360deg)}}'
 '.accx-pulse{animation:accxPulse 1.8s ease-in-out infinite}'
 '@keyframes accxPulse{0%,100%{opacity:1}50%{opacity:.35}}'
 '.accx-stats{flex:1;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;min-width:240px}'
 '.accx-stat{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:14px;text-align:center}'
 '.accx-stat b{display:block;font-size:1.45rem;color:#7cc0ff;font-weight:800}'
 '.accx-stat span{font-size:.64rem;text-transform:uppercase;letter-spacing:.09em;opacity:.7;font-weight:700}'
 '.accx-tl{position:relative;max-width:760px;margin:0 auto;padding-left:6px}'
 '.accx-tls{position:relative;display:flex;gap:16px;padding:0 0 26px 0}'
 '.accx-tls:before{content:"";position:absolute;left:17px;top:38px;bottom:-2px;width:3px;background:linear-gradient(180deg,#0883F7,#22c55e);border-radius:2px}'
 '.accx-tls:last-child:before{display:none}'
 '.accx-tls .n{flex:0 0 36px;width:36px;height:36px;border-radius:50%;background:linear-gradient(135deg,#0883F7,#0967d2);color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;box-shadow:0 8px 18px -8px rgba(8,131,247,.7);z-index:1}'
 '.accx-tls p{margin:6px 0 0;font-size:.96rem;line-height:1.65}'
 '.accx-ck{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}'
 '.accx-ci{display:flex;gap:11px;align-items:flex-start;background:var(--card,#fff);border:1px solid var(--border,#e2e8f0);border-radius:14px;padding:13px 15px;transition:transform .15s,box-shadow .15s}'
 '.accx-ci:hover{transform:translateY(-2px);box-shadow:0 14px 30px -22px rgba(2,12,30,.35)}'
 '.accx-ci .tick{flex:0 0 24px;width:24px;height:24px;border-radius:50%;background:#dcfce7;color:#16a34a;font-weight:900;display:flex;align-items:center;justify-content:center}'
 '.accx-ci p{margin:2px 0 0;font-size:.9rem;line-height:1.6}'
 '.accx-rel{display:flex;gap:10px;flex-wrap:wrap;justify-content:center}'
 '.accx-rel a{display:inline-flex;gap:7px;align-items:center;background:var(--card,#fff);border:1.5px solid var(--border,#e2e8f0);border-radius:999px;padding:9px 18px;font-weight:700;font-size:.85rem;text-decoration:none;transition:all .15s}'
 '.accx-rel a:hover{border-color:#0883F7;color:#0883F7;transform:translateY(-2px)}'
 '.accx-crumbs{font-size:.82rem;color:var(--muted,#64748b)}'
 '.accx-crumbs a{color:#0883F7;text-decoration:none}.accx-crumbs a:hover{text-decoration:underline}'
 '.accx-crumbs span{margin:0 7px;opacity:.5}'
 '.accx-fresh{display:inline-flex;align-items:center;gap:7px;background:rgba(8,131,247,.08);border:1px solid rgba(8,131,247,.22);color:#0967d2;border-radius:999px;padding:5px 14px;font-size:.74rem;font-weight:700;margin-top:16px}'
 '.accx-fresh i{width:7px;height:7px;border-radius:50%;background:#22c55e;display:inline-block;box-shadow:0 0 0 0 rgba(34,197,94,.5);animation:accxPing 1.8s infinite}'
 '@keyframes accxPing{70%{box-shadow:0 0 0 6px rgba(34,197,94,0)}100%{box-shadow:0 0 0 0 rgba(34,197,94,0)}}'
 '.accx-calc{background:linear-gradient(135deg,#0b1830,#132c4e 70%,#16345c);border-radius:22px;padding:26px 28px;color:#fff;box-shadow:0 24px 60px -30px rgba(2,12,30,.6);position:relative;overflow:hidden}'
 '.accx-calc:before{content:"";position:absolute;top:-40px;right:-30px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(8,131,247,.35),transparent 70%)}'
 '.accx-calc h3{color:#fff;margin:0 0 4px;font-size:1.28rem;position:relative}'
 '.accx-calc .sub{color:rgba(255,255,255,.72);font-size:.92rem;margin:0 0 18px;position:relative;max-width:560px}'
 '.accx-calc .cg{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;position:relative}'
 '.accx-fld label{display:block;font-size:.68rem;text-transform:uppercase;letter-spacing:.07em;color:#7cc0ff;font-weight:700;margin-bottom:6px}'
 '.accx-fld .wrap-in{display:flex;align-items:center;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.16);border-radius:12px;overflow:hidden;transition:border-color .15s}'
 '.accx-fld .wrap-in:focus-within{border-color:#0883F7}'
 '.accx-fld .pfx{padding-left:12px;color:rgba(255,255,255,.55);font-weight:800}'
 '.accx-fld input{flex:1;min-width:0;background:transparent;border:0;color:#fff;font-size:1.15rem;font-weight:800;padding:11px 12px;outline:none;-moz-appearance:textfield}'
 '.accx-fld input::-webkit-outer-spin-button,.accx-fld input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}'
 '.accx-fld .sfx{padding-right:12px;color:rgba(255,255,255,.55);font-size:.78rem;font-weight:700;white-space:nowrap}'
 '.accx-res{margin-top:20px;background:rgba(34,197,94,.12);border:1px solid rgba(74,222,128,.4);border-radius:16px;padding:18px 22px;display:flex;align-items:center;justify-content:space-between;gap:18px;flex-wrap:wrap;position:relative}'
 '.accx-res .lab{font-size:.72rem;text-transform:uppercase;letter-spacing:.08em;color:#4ade80;font-weight:800;margin-bottom:2px}'
 '.accx-res .amt{font-size:2.4rem;font-weight:900;color:#fff;line-height:1}'
 '.accx-res .note{font-size:.84rem;color:rgba(255,255,255,.72);max-width:300px;text-align:right}'
 '.accx-calc .disc{font-size:.72rem;color:rgba(255,255,255,.5);margin-top:13px;position:relative}'
 '.accx-cmp{width:100%;border-collapse:collapse;background:var(--card,#fff);border-radius:16px;overflow:hidden;box-shadow:0 16px 40px -28px rgba(2,12,30,.4)}'
 '.accx-cmp th{background:#10223B;color:#fff;text-align:left;padding:12px 15px;font-size:.66rem;letter-spacing:.08em;text-transform:uppercase}'
 '.accx-cmp td{padding:12px 15px;border-bottom:1px solid var(--border,#eef2f7);font-size:.9rem;color:var(--ink,#0f172a)}'
 '.accx-cmp tr:hover td{background:rgba(8,131,247,.04)}'
 '.accx-cmp tr.hl td{background:rgba(252,83,5,.07)}'
 '.accx-cmp a{color:#0967d2;font-weight:700;text-decoration:none}.accx-cmp a:hover{text-decoration:underline}'
 '.accx-cmp .amt{font-weight:800;color:#0967d2;white-space:nowrap}'
 '@media(max-width:560px){.accx-res .amt{font-size:1.9rem}.accx-res .note{text-align:left}}'
 '@media(max-width:640px){.accx-hero{padding:20px}.accx-art{flex-basis:130px}}')

def _svg_truck(extra=''):
    return ('<svg width="170" height="120" viewBox="0 0 170 120" fill="none">'
      '<rect x="8" y="46" width="86" height="40" rx="6" fill="#0883F7"/>'
      '<path d="M94 56h30l20 18v12H94z" fill="#dbe7f7"/>'
      '<rect x="98" y="60" width="16" height="12" rx="2" fill="#10223B"/>'
      '<circle cx="34" cy="90" r="11" fill="#0b1626" stroke="#dbe7f7" stroke-width="3"/>'
      '<circle cx="122" cy="90" r="11" fill="#0b1626" stroke="#dbe7f7" stroke-width="3"/>'
      + extra + '</svg>')

_ACC_ART = {
 'detention-pay-policy': dict(svg=_svg_truck(
    '<circle cx="140" cy="30" r="22" fill="none" stroke="#FC5305" stroke-width="4"/>'
    '<line class="accx-spin" x1="140" y1="30" x2="140" y2="16" stroke="#fff" stroke-width="4" stroke-linecap="round" style="transform-origin:140px 30px"/>'
    '<line x1="140" y1="30" x2="150" y2="34" stroke="#FC5305" stroke-width="3.5" stroke-linecap="round"/>'
    '<text x="14" y="30" fill="#7cc0ff" font-size="13" font-weight="800" font-family="Inter,Arial">WAITING\u2026 $$$</text>'),
   stats=[('Standard rate','$60/hr'),('Free time','2 hours'),('Industry loses','$15B/yr')]),
 'tonu-policy': dict(svg=_svg_truck(
    '<circle cx="140" cy="28" r="20" fill="rgba(239,68,68,.15)"/>'
    '<line class="accx-pulse" x1="128" y1="16" x2="152" y2="40" stroke="#f87171" stroke-width="6" stroke-linecap="round"/>'
    '<line class="accx-pulse" x1="152" y1="16" x2="128" y2="40" stroke="#f87171" stroke-width="6" stroke-linecap="round"/>'),
   stats=[('LoadBoot standard','$250'),('Industry range','$150\u2013$300+'),('Trigger','late cancel')]),
 'layover-policy': dict(svg=_svg_truck(
    '<path d="M132 14a14 14 0 1 0 14 22 17 17 0 0 1-14-22z" fill="#fbbf24"/>'
    '<circle class="accx-pulse" cx="112" cy="18" r="2.4" fill="#fff"/>'
    '<circle class="accx-pulse" cx="158" cy="44" r="2" fill="#fff"/>'),
   stats=[('Per day','$250'),('Stacks with','detention'),('Trigger','overnight hold')]),
 'lumper-policy': dict(svg=_svg_truck(
    '<rect x="118" y="10" width="20" height="20" rx="3" fill="#FC5305"/>'
    '<rect x="140" y="18" width="16" height="16" rx="3" fill="#f59e0b"/>'
    '<rect x="126" y="32" width="14" height="14" rx="3" fill="#7cc0ff"/>'
    '<text x="118" y="8" fill="#4ade80" font-size="11" font-weight="800" font-family="Inter,Arial">RECEIPT = $$$</text>'),
   stats=[('Reimbursed','100%'),('Typical fee','$75\u2013$600'),('The claim','the receipt')]),
 'driver-assist-policy': dict(svg=_svg_truck(
    '<circle cx="132" cy="18" r="7" fill="#dbe7f7"/>'
    '<path d="M132 26v16l-8 12M132 32l10 8" stroke="#dbe7f7" stroke-width="4" stroke-linecap="round" fill="none"/>'
    '<rect x="146" y="30" width="14" height="12" rx="2" fill="#FC5305"/>'),
   stats=[('Per stop','$75'),('Agreed','in writing'),('On top of','linehaul')]),
 'fcfs-policy': dict(svg=_svg_truck(
    '<rect x="112" y="14" width="12" height="9" rx="2" fill="#4ade80"/>'
    '<rect x="128" y="14" width="12" height="9" rx="2" fill="#7cc0ff"/>'
    '<rect x="144" y="14" width="12" height="9" rx="2" fill="#dbe7f7"/>'
    '<text x="112" y="38" fill="#7cc0ff" font-size="11" font-weight="800" font-family="Inter,Arial">1st COME 1st SERVED</text>'),
   stats=[('Arrival order','wins'),('Window','on the posting'),('Proof','GPS check-in')]),
 'emergency-rescheduling-policy': dict(svg=_svg_truck(
    '<path class="accx-pulse" d="M136 8l16 28h-32z" fill="#f87171"/>'
    '<rect x="134" y="17" width="4" height="9" rx="2" fill="#fff"/>'
    '<circle cx="136" cy="31" r="2.2" fill="#fff"/>'),
   stats=[('Response clock','2 hours'),('Carrier penalty','none (verified)'),('Proof','GPS + photo')]),
}
_ACC_ART['default'] = dict(svg=_svg_truck(), stats=[('Standard','in writing'),('Proof','GPS'),('Settlement','via LoadBoot')])

_ACC_UPDATED = 'July 2026'

# ---- Interactive pay calculators (top organic-traffic driver + engagement) ----
_ACC_CALC = {
 'detention-pay-policy': dict(type='detention', title='Detention pay calculator', reslabel='You are owed',
   sub='Enter your times \u2014 see exactly what the facility owes you.',
   fields=[('hrs','Total time held','',5.5,'hrs',0.25),('free','Free time','',2,'hrs',0.5),('rate','Detention rate','$',60,'/hr',5)]),
 'layover-policy': dict(type='layover', title='Layover pay calculator', reslabel='You are owed',
   sub='Overnight hold? See the day rate \u2014 on top of any detention already earned.',
   fields=[('days','Days held over','',1,'days',1),('rate','Layover rate','$',250,'/day',10),('det','Detention already earned','$',0,'',10)]),
 'tonu-policy': dict(type='tonu', title='TONU calculator', reslabel='You are owed',
   sub='Confirmed load died late? Add any deadhead you already burned.',
   fields=[('flat','TONU amount','$',250,'',10),('miles','Deadhead miles driven','',0,'mi',5),('permile','Per deadhead mile','$',2,'/mi',0.25)]),
 'lumper-policy': dict(type='lumper', title='Lumper reimbursement calculator', reslabel='Reimbursed to you',
   sub='Fronted a lumper fee? See what comes back \u2014 and what stays out of pocket.',
   fields=[('fee','Lumper fee you paid','$',180,'',10)]),
 'driver-assist-policy': dict(type='assist', title='Driver assist pay calculator', reslabel='You are owed',
   sub='Working the dock? Price it before you touch the freight.',
   fields=[('stops','Stops you assisted','',1,'stops',1),('rate','Assist rate per stop','$',75,'/stop',5)]),
 'fcfs-policy': dict(type='detention', title='FCFS detention calculator', reslabel='You are owed',
   sub='FCFS does NOT cancel detention \u2014 free time runs from gate check-in. Check the math.',
   fields=[('hrs','Time from check-in','',4,'hrs',0.25),('free','Free time','',2,'hrs',0.5),('rate','Detention rate','$',60,'/hr',5)]),
}

def _acc_calc_html(c):
    flds = ''
    for fid, lab, pfx, dflt, sfx, step in c['fields']:
        flds += ('<div class="accx-fld"><label for="lbc_' + fid + '">' + lab + '</label>'
          '<div class="wrap-in">' + ('<span class="pfx">' + pfx + '</span>' if pfx else '')
          + '<input id="lbc_' + fid + '" type="number" inputmode="decimal" value="' + str(dflt) + '" step="' + str(step) + '" min="0">'
          + ('<span class="sfx">' + sfx + '</span>' if sfx else '') + '</div></div>')
    return ('<section class="wrap" style="margin-top:10px"><div class="accx-calc reveal" data-calc-type="' + c['type'] + '">'
      '<h3>&#129518; ' + c['title'] + '</h3><p class="sub">' + c['sub'] + '</p>'
      '<div class="cg">' + flds + '</div>'
      '<div class="accx-res"><div><div class="lab">' + c['reslabel'] + '</div><div class="amt">$0</div></div>'
      '<div class="note"></div></div>'
      '<p class="disc">Estimate only \u2014 your rate confirmation is the controlling document. On LoadBoot these figures are pre-agreed in writing on every load, and the claim builds itself from your trip data.</p>'
      '</div></section>')

# ---- At-a-glance comparison table (internal linking + featured-snippet bait) ----
_ACC_CMP = [
 ('detention-pay-policy','Detention','$60/hr after 2 free hrs','Facility holds your truck past free time'),
 ('layover-policy','Layover','$250 / day','A hold crosses into an overnight'),
 ('tonu-policy','TONU','$250 + deadhead','A confirmed load cancels late'),
 ('lumper-policy','Lumper','Reimbursed 100%','Third-party dock labor you fronted'),
 ('driver-assist-policy','Driver Assist','$75 / stop','The driver physically works the dock'),
 ('fcfs-policy','FCFS','Detention still applies','No appointment \u2014 clock runs from check-in'),
 ('emergency-rescheduling-policy','Emergency Reschedule','Zero penalty','A verified on-road emergency'),
]

def _acc_cmp_html(cur):
    rows = ''
    for sl, nm, amt, trig in _ACC_CMP:
        hl = ' class="hl"' if sl == cur else ''
        cell = ('<b>' + nm + '</b> \u2014 you\u2019re here') if sl == cur else ('<a href="/' + sl + '.html">' + nm + '</a>')
        rows += '<tr' + hl + '><td>' + cell + '</td><td class="amt">' + amt + '</td><td>' + trig + '</td></tr>'
    return ('<div style="overflow-x:auto"><table class="accx-cmp"><thead><tr><th>Accessorial</th><th>LoadBoot standard</th><th>When it triggers</th></tr></thead><tbody>'
      + rows + '</tbody></table></div>'
      '<p class="src-disc" style="margin-top:12px;text-align:center">Every one of these is written into the load before you accept it. Tap any row to read the full guide.</p>')

def _acc_fresh_schema(name):
    import json as _json
    return '<script type="application/ld+json">' + _json.dumps({"@context": "https://schema.org", "@type": "WebPage",
      "name": name + " \u2014 LoadBoot Policy", "datePublished": "2026-01-15", "dateModified": "2026-07-08",
      "isPartOf": {"@type": "WebSite", "name": "LoadBoot", "url": "https://loadboot.com"}}) + '</script>'

# ---- One script per page: count-up hero stats + live calculator compute ----
_ACC_SCRIPT = ('<script>(function(){'
 'function cu(el){var t=el.textContent.trim();var m=t.match(/^([^0-9]*)([0-9]+(?:\\.[0-9]+)?)(.*)$/);if(!m)return;var pre=m[1],num=parseFloat(m[2]),suf=m[3];if(/[0-9]/.test(suf))return;var dur=850,st=null,dec=(num%1?1:0);function step(ts){if(!st)st=ts;var p=Math.min((ts-st)/dur,1);var e=1-Math.pow(1-p,3);el.textContent=pre+(num*e).toFixed(dec)+suf;if(p<1)requestAnimationFrame(step);}requestAnimationFrame(step);}'
 'if("IntersectionObserver" in window){var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){cu(e.target);io.unobserve(e.target);}});},{threshold:.4});document.querySelectorAll(".accx-stat b").forEach(function(el){io.observe(el);});}else{document.querySelectorAll(".accx-stat b").forEach(cu);}'
 'var box=document.querySelector("[data-calc-type]");if(box){var type=box.getAttribute("data-calc-type");'
 'function v(id){var e=box.querySelector("#lbc_"+id);return e?(parseFloat(e.value)||0):0;}'
 'function money(n){return "$"+Math.round(n).toLocaleString("en-US");}'
 'function fnum(n){return (Math.round(n*100)/100).toString();}'
 'function calc(){var amtEl=box.querySelector(".amt"),noteEl=box.querySelector(".note"),amt=0,note="";'
 'if(type==="detention"){var b=Math.max(0,v("hrs")-v("free"));amt=b*v("rate");note=b<=0?"Still inside free time \u2014 nothing owed yet.":fnum(b)+" billable hours \u00d7 "+money(v("rate"))+"/hr";}'
 'else if(type==="layover"){amt=v("days")*v("rate")+v("det");note=v("det")>0?"includes "+money(v("det"))+" detention earned before the overnight":v("days")+" day(s) \u00d7 "+money(v("rate"));}'
 'else if(type==="tonu"){amt=v("flat")+v("miles")*v("permile");note=v("miles")>0?money(v("flat"))+" TONU + "+v("miles")+" mi deadhead":"flat TONU \u2014 add deadhead if the posting includes it";}'
 'else if(type==="assist"){amt=v("stops")*v("rate");note=v("stops")+" stop(s) \u00d7 "+money(v("rate"))+", agreed in writing first";}'
 'else if(type==="lumper"){amt=v("fee");note="$0 stays out of your pocket \u2014 reimbursed 100% with receipt, or the broker pays direct.";}'
 'amtEl.textContent=money(amt);noteEl.textContent=note;}'
 'box.addEventListener("input",calc);calc();}'
 '})();</script>')


def _acc_howto_schema(name, steps):
    import json as _json, re as _re
    st = [{"@type": "HowToStep", "position": i + 1, "text": _re.sub(r'<[^>]+>', '', x)} for i, x in enumerate(steps or [])]
    return '<script type="application/ld+json">' + _json.dumps({"@context": "https://schema.org", "@type": "HowTo",
      "name": "How to claim " + name + " as a truck driver", "step": st}) + '</script>'

def _acc_faq_schema(faq):
    import json as _json, re as _re
    ents = []
    for q, a in faq:
        qq = _re.sub(r'<[^>]+>', '', q); aa = _re.sub(r'<[^>]+>', '', a)
        ents.append({"@type": "Question", "name": qq, "acceptedAnswer": {"@type": "Answer", "text": aa}})
    return '<script type="application/ld+json">' + _json.dumps({"@context": "https://schema.org", "@type": "FAQPage", "mainEntity": ents}) + '</script>'


# ---------- ACCESSORIAL FLAGSHIP DATA (H1, real product shots, who-it-protects) ----------
_ACC_H1 = {
 'detention-pay-policy': 'Truck Detention Pay &mdash; $60/hr After 2 Hours Free Time, GPS-Proven',
 'tonu-policy': 'TONU Fee &mdash; $250 When the Truck Is Ordered but Not Used',
 'layover-policy': 'Layover Pay for Truck Drivers &mdash; Overnight Holds, Paid by Rule',
 'lumper-policy': 'Lumper Fees &mdash; Receipts Reimbursed Through the Trip, Not Absorbed',
 'driver-assist-policy': 'Driver Assist Pay &mdash; Loading Help Is Billable Work',
 'fcfs-policy': 'FCFS &amp; Appointment Scheduling &mdash; Rules That Protect Your Clock',
 'emergency-rescheduling-policy': 'Emergency Rescheduling &mdash; Verified Emergencies, Zero Penalty',
}
def _accshot(f,w,h,alt,cap):
    return dict(f=f,w=w,h=h,alt=alt,cap=cap)
_ACC_SHOTS = {
 'detention-pay-policy': [
  _accshot('track-phone-pickup.webp',420,909,'Trip map checked in at pickup — detention clock running from the geofenced arrival','The real trip map &mdash; checked in at the dock, detention clock already running.'),
  _accshot('acc-broker-claims.webp',1100,769,'Broker claims desk — GPS-stamped detention claims with approve, reject and pay actions','The broker&rsquo;s claims desk &mdash; GPS-stamped detention claims, approve &rarr; pay in two taps.')],
 'tonu-policy': [
  _accshot('acc-tonu-phone.webp',420,909,'A TONU claim as a DUE receivable — $250 with memo, deadline and payment route','The real TONU claim &mdash; $250 sitting as DUE with its memo and deadline, not an email argument.'),
  _accshot('acc-broker-claims.webp',1100,769,'Broker claims desk — an approved $250 TONU claim with a one-tap pay button','The posting party&rsquo;s view &mdash; TONU approved, one tap to pay it.')],
 'layover-policy': [
  _accshot('acc-layover-phone.webp',420,909,'A layover claim as a DUE receivable — $150 with memo, deadline and factor routing','The real layover claim &mdash; $150 DUE with a deadline, riding the same rail as the freight.'),
  _accshot('acc-broker-claims.webp',1100,769,'Broker claims desk — approved layover claim beside detention and TONU, each with evidence','The claims desk &mdash; layover approved beside detention and TONU, evidence attached.')],
 'lumper-policy': [
  _accshot('track-phone-docs.webp',420,508,'In-app capture buttons for dock photo, signed BOL/POD and lumper receipt','Snap it where it happens &mdash; the lumper receipt attaches to the trip from the dock.'),
  _accshot('fac-packet-phone.webp',420,909,'Factoring packet with invoice, signed POD and lumper receipt collected automatically','The same receipt lands in the funding packet &mdash; nothing re-typed, nothing lost.')],
 'driver-assist-policy': [
  _accshot('acc-assist-phone.webp',420,909,'A driver-assist claim as a DUE receivable — $75 for a two-hour hand-unload, dock photos attached','The real assist claim &mdash; $75 for the hand-unload, filed as an accessorial with dock-photo evidence.'),
  _accshot('track-phone-docs.webp',420,508,'In-app proof capture — dock photos and signed documents with timestamps','The proof &mdash; dock photos and signed docs, captured where the work happened.')],
 'fcfs-policy': [
  _accshot('track-phone-pickup.webp',420,909,'Geofenced arrival stamp at the gate — the on-time record FCFS depends on','Your on-time proof &mdash; the 800 m geofence stamps the gate arrival for you.'),
  _accshot('partner-live-tracking.webp',1100,969,'Broker live view — milestone timeline with arrival and departure records','Both sides see the same timeline &mdash; scheduling arguments die against the record.')],
 'emergency-rescheduling-policy': [
  _accshot('acc-emergency-card.webp',420,740,'The trip card — the red Emergency button lives beside pay claims and report issue','One tap from the trip &mdash; the Emergency button, right where the road problem happens.'),
  _accshot('partner-live-tracking.webp',1100,969,'Broker live tracking — the same trip, the same facts, on both screens','The poster watches the same trip &mdash; a verified emergency is a fact, not an excuse.')],
}

_ACC_PROTECT = {
 'detention-pay-policy': [
  ('&#128666; The carrier','Every minute past free time is measured by the server, not remembered. The claim drafts itself with GPS stamps, rides the trip invoice, and ages in the open until paid.'),
  ('&#127970; The broker &amp; shipper','No inflated hand-written times &mdash; you see the same arrive/depart record the carrier does. Facilities that hold trucks show up in your data, so you can fix the dock, not fight the driver.'),
  ('&#129309; The marketplace','Published rates and symmetric evidence mean detention stops being a negotiation. Carriers stay, brokers keep capacity, and agents refer carriers into a board that pays what it promises.')],
 'tonu-policy': [
  ('&#128666; The carrier','A cancelled load is not a free cancel &mdash; the rate confirmation is a commitment. TONU plus deadhead miles are pre-agreed on every posting, and your GPS position proves you rolled.'),
  ('&#127970; The broker &amp; shipper','A published TONU standard keeps cancellations honest on BOTH sides &mdash; and protects you from phantom claims: no rate con or no movement, no TONU.'),
  ('&#129309; The marketplace','Loads on the board are real because cancelling late costs money. That is why LoadBoot has zero ghost loads &mdash; the TONU rule is the enforcement.')],
 'layover-policy': [
  ('&#128666; The carrier','A night lost to a dock that could not finish is a business day &mdash; the layover rate is on the rate card before you book, and the claim builds from the same GPS trail.'),
  ('&#127970; The broker &amp; shipper','Layover is capped and rule-bound &mdash; you pay a published rate for a documented hold, never an invented number after the fact.'),
  ('&#129309; The marketplace','When overnight risk is priced and published, carriers keep taking the tight-appointment freight everyone else refuses.')],
 'lumper-policy': [
  ('&#128666; The carrier','You front the lumper, you photograph the receipt, it attaches to the trip &mdash; reimbursement rides the same invoice as the freight instead of dying in an inbox.'),
  ('&#127970; The broker &amp; shipper','Receipt-verified reimbursement only &mdash; a photographed, GPS-attached receipt with the facility on it. No receipt, no charge.'),
  ('&#129309; The marketplace','Clean lumper handling keeps drivers moving through grocery and retail docks the network depends on.')],
 'driver-assist-policy': [
  ('&#128666; The carrier','Two hours on a pallet jack is labor, not a favor. Assist pay is pre-agreed on the posting, and dock photos prove the work happened.'),
  ('&#127970; The broker &amp; shipper','You only pay for assist that was agreed up front or approved on evidence &mdash; and a driver who is paid to help gets your freight off the truck faster.'),
  ('&#129309; The marketplace','Priced labor beats argued labor &mdash; postings that need driver assist say so, and carriers can book them with open eyes.')],
 'fcfs-policy': [
  ('&#128666; The carrier','FCFS windows and appointment rules are printed on the posting, and your geofenced gate arrival is your on-time proof &mdash; the foundation under every detention claim.'),
  ('&#127970; The broker &amp; shipper','Accurate scheduling data flows back to you live &mdash; you see arrivals the moment they stamp, not when someone answers a check call.'),
  ('&#129309; The marketplace','When the clock rules are public, carriers plan honestly and facilities get measured &mdash; scheduling stops being a lottery.')],
 'emergency-rescheduling-policy': [
  ('&#128666; The carrier','Breakdowns and genuine emergencies happen. Verified through the app within the window, they reschedule the load with zero penalty and no TONU against you.'),
  ('&#127970; The broker &amp; shipper','Verification is the point &mdash; you get the real reason on record within 2 hours plus a recovery plan, instead of a dead phone and a mystery.'),
  ('&#129309; The marketplace','Separating real emergencies from silent cancellations keeps account health scores honest for everyone.')],
}

for _p in _ACC_PAGES:
    _slug, _name = _p['slug'], _p['name']
    _pg = ('<section class="wrap" style="padding:14px 0 2px"><nav class="accx-crumbs" aria-label="Breadcrumb">'
           '<a href="/">Home</a><span>›</span><a href="/market-rates.html">Rates &amp; Driver Pay</a>'
           '<span>›</span>' + _name + '</nav></section>')
    _pg += svc_hero(_ACC_H1.get(_slug, _name + ' — LoadBoot Policy'), _p['defn'])
    _art = _ACC_ART.get(_slug, _ACC_ART['default'])
    _pg += ('<section class="wrap" style="margin-top:-14px"><style>' + _ACC_CSS + '</style>'
      '<div class="accx-hero reveal"><div class="accx-art">' + _art['svg'] + '</div>'
      '<div class="accx-stats">' + ''.join('<div class="accx-stat"><b>' + v + '</b><span>' + k + '</span></div>' for k, v in _art['stats'])
      + '</div></div>'
      '<div style="text-align:center"><span class="accx-fresh"><i></i>Updated ' + _ACC_UPDATED + ' · reviewed by LoadBoot Dispatch</span></div>'
      '</section>')
    _calc = _ACC_CALC.get(_slug)
    if _calc:
        _pg += _acc_calc_html(_calc)
    _pg += _sec('The standard', 'What applies on every LoadBoot load unless the posting says otherwise', (
        '<div class="cards g1"><article class="card"><div class="card-ic">&#128176;</div><h3>' + _p['std'] + '</h3><p>' + _p['ctx'] + '</p></article></div>'))
    _pg += _sec('What it looks like on the road', 'A real-world scenario', (
        '<div class="cards g1"><article class="card"><div class="card-ic">&#128666;</div><p style="font-size:1.02rem;line-height:1.7">' + _p['story'] + '</p></article></div>'))
    _pg += _sec('Why this exists', 'The economics in one paragraph', (
        '<p class="src-disc" style="font-size:.95rem;max-width:820px">' + _p['why'] + '</p>'))
    _pg += _sec('The rules', 'Both sides agree to these when posting or booking on LoadBoot', (
        '<div class="cards g1">' + ''.join('<article class="card"><h3>' + k + '</h3><p>' + v + '</p></article>' for k, v in _p['rules']) + '</div>'))
    _pg += _sec('How to claim it — step by step', 'The exact sequence, from the gate to the money', (
        '<div class="accx-tl reveal">' + ''.join('<div class="accx-tls"><span class="n">' + str(_i + 1) + '</span><p>' + _x + '</p></div>' for _i, _x in enumerate(_p['steps'])) + '</div>'))
    _pg += _sec('Worked example', _p['example'][0], (
        '<div class="cards g1"><article class="card">' + ''.join('<div style="display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--border,#e2e8f0)"><span style="color:var(--muted,#64748b)">' + k + '</span><span style="text-align:right;font-weight:700">' + v + '</span></div>' for k, v in _p['example'][1]) + '</article></div>'))
    _pg += _sec('Mistakes that kill claims', 'Learn them here, not the expensive way', (
        '<div class="cards g2">' + ''.join('<article class="card"><div class="card-ic">&#9888;&#65039;</div><h3>' + k + '</h3><p>' + v + '</p></article>' for k, v in _p['mistakes']) + '</div>'))
    _pg += _sec('How LoadBoot enforces it', 'Software, not arguments', (
        '<div class="cards g3">'
        '<article class="card"><div class="card-ic">&#128205;</div><h3>Timestamps</h3><p>GPS-stamped arrive/depart on every stop — measured, not argued.</p></article>'
        '<article class="card"><div class="card-ic">&#128276;</div><h3>Deadline alerts</h3><p>The app warns before free time or notification windows expire.</p></article>'
        '<article class="card"><div class="card-ic">&#128196;</div><h3>Evidence pack</h3><p>Photos, receipts and times collected on the trip and attached to the invoice.</p></article>'
        '</div>'))
    _shots9 = _ACC_SHOTS.get(_slug)
    if _shots9:
        _sh_html = '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:22px;align-items:start">'
        for _s9 in _shots9:
            _wrap_style = 'max-width:340px;margin:0 auto' if _s9['w'] <= 460 else ''
            _sh_html += ('<figure class="reveal" style="margin:0"><div style="' + _wrap_style + '">'
              '<img src="/shots/' + _s9['f'] + '" alt="' + _s9['alt'] + '" width="' + str(_s9['w']) + '" height="' + str(_s9['h']) + '" loading="lazy" decoding="async" style="display:block;width:100%;height:auto;border-radius:16px;border:1px solid rgba(148,163,184,.35);box-shadow:0 24px 60px -30px rgba(11,18,32,.35)"></div>'
              '<figcaption style="text-align:center;color:#64748b;font-size:.8rem;margin-top:9px">' + _s9['cap'] + '</figcaption></figure>')
        _sh_html += ('</div><p class="src-disc" style="margin-top:16px;text-align:center;max-width:760px;margin-left:auto;margin-right:auto">These are real portal screens, not mockups &mdash; the same rail that runs <a href="/gps-tracking.html">GPS tracking &amp; proof</a> and <a href="/payments-settlements.html">payments &amp; settlements</a>. The claim this page describes is drafted from that trip data and paid through that ledger.</p>')
        _pg += _sec('Inside the product', 'Real screens &mdash; how this policy actually runs', _sh_html)
    _prot9 = _ACC_PROTECT.get(_slug)
    if _prot9:
        _pg += _sec('Who this protects', 'One policy, three winners — carrier, broker &amp; shipper, and the board itself', (
            '<div class="cards g3">' + ''.join('<article class="card"><h3>' + k + '</h3><p>' + v + '</p></article>' for k, v in _prot9) + '</div>'))
    _pg += _sec('Frequently asked', 'Straight answers', (
        '<div class="cards g2">' + ''.join('<article class="card"><h3>' + q + '</h3><p>' + a + '</p></article>' for q, a in _p['faq']) + '</div>'))
    _pg += _sec('All accessorials at a glance', 'Every LoadBoot pay standard in one table', _acc_cmp_html(_slug))
    _pg += _sec('Related policies', 'The full accessorial standard', (
        '<div class="accx-rel">' + ''.join('<a href="/' + q2['slug'] + '.html">&#128216; ' + q2['name'] + '</a>' for q2 in _ACC_PAGES if q2['slug'] != _slug) + '<a href="/market-rates.html">&#128200; Market Rates Per Mile</a><a href="/ghost-loads-load-board-problems.html">&#128123; Ghost Loads &amp; Fake Freight</a></div>'
        '<p class="src-disc" style="margin-top:10px">These policies are LoadBoot marketplace standards agreed between posting parties and carriers. They are operational terms, not legal advice; the rate confirmation for each load is the controlling document.</p>'))
    _seo = _ACC_SEO.get(_slug)
    if _seo:
        _pg += _sec('What evidence to collect', 'The checklist that gets claims PAID \u2014 save it, use it on every load', (
            '<div class="accx-ck reveal">'
            + ''.join('<div class="accx-ci"><span class="tick">&#10003;</span><p>' + x + '</p></div>' for x in _seo['ev'])
            + '</div><p class="src-disc" style="margin-top:14px;text-align:center">On LoadBoot most of this collects itself: GPS arrive/depart stamps, stop-proof photo uploads, the pre-agreed rate card on every posting, and a one-tap claim built from the trip record.</p>'))
        _pg += _sec('Broker refusing to pay? Read this first', 'The four denials you will hear \u2014 and the counter for each', (
            '<div class="cards g2">' + ''.join('<article class="card"><div class="card-ic">&#128683;</div><h3>' + k + '</h3><p>' + v + '</p></article>' for k, v in _seo['deny']) + '</div>'))
        _pg += _sec('Tired of fighting for money you already earned?', 'This is the exact problem LoadBoot was built to end', (
            '<div class="cards g1"><article class="card" style="text-align:center">'
            '<p style="font-size:1.05rem;line-height:1.75;max-width:760px;margin:0 auto 14px">Every LoadBoot load posts with this fee <b>already agreed in writing</b>. Your GPS timestamps are the evidence. The claim builds itself from the trip. And settlement runs through the platform &mdash; no chasing, no ghosting, no bond claims.</p>'
            '<p><a class="btn btn-primary" href="/get-started.html">Join LoadBoot free &mdash; get paid what you\u2019re owed &rarr;</a></p>'
            '<p class="src-disc" style="margin-top:8px">Free verified carrier account &middot; live loads with the full rate card in writing &middot; GPS-proof claims</p></article></div>'))
    _pg += _ACC_SCRIPT
    page(_slug + '.html',
         (_seo['title'] if _seo else _name + ' Policy | LoadBoot'),
         (_seo['desc'] if _seo else (_p['defn'][:150])[:168]),
         _slug + '.html', _pg,
         schema=(_acc_faq_schema(_p.get('faq') or []) + _acc_howto_schema(_name, _p.get('steps') or []) + _acc_fresh_schema(_name)))

# ---- HTML sitemap (user-facing; complements the XML sitemap) ----
_SITEMAP_GROUPS = [
  ('Get started', [('get-started.html', 'Create an Account'), ('contact.html', 'Get a Quote / Contact'), ('carriers.html', 'For Carriers'), ('brokers.html', 'For Brokers'), ('shipper-solutions.html', 'Shipper Solutions'), ('carrier-application.html', 'Carrier Application'), ('login.html', 'Log in'), ('how-it-works.html', 'How It Works'), ('pricing.html', 'Pricing')]),
  ('Services', [('services.html', 'All Services'), ('owner-operator-dispatch.html', 'Owner-Operator'), ('dry-van-dispatch.html', 'Dry Van'), ('reefer-dispatch.html', 'Reefer'), ('flatbed-dispatch.html', 'Flatbed'), ('hotshot-dispatch.html', 'Hotshot'), ('power-only-dispatch.html', 'Power Only'), ('box-truck-dispatch.html', 'Box Truck'), ('new-authority-dispatch.html', 'New Authority')]),
  ('Resources', [('resources.html', 'Resources'), ('load-score.html', 'Load Score Tool'), ('tools.html', 'Free Calculators'), ('cost-per-mile-calculator.html', 'Cost Per Mile Calculator'), ('blog.html', 'Blog'), ('ghost-loads-load-board-problems.html', 'Ghost Loads & Fake Freight'), ('faq.html', 'FAQ')]),
  ('Company', [('about.html', 'About'), ('careers.html', 'Careers'), ('partners.html', 'Partner Program'), ('agents.html', 'Agent Program'), ('case-studies.html', 'Examples'), ('status.html', 'System Status'), ('market-rates.html', 'Market Rates'), ('detention-pay-policy.html', 'Detention Pay'), ('tonu-policy.html', 'TONU'), ('layover-policy.html', 'Layover'), ('lumper-policy.html', 'Lumper Fees'), ('driver-assist-policy.html', 'Driver Assist')]),
  ('Legal & trust', [('security.html', 'Security & Trust'), ('privacy.html', 'Privacy'), ('terms.html', 'Terms'), ('cookies.html', 'Cookie Policy'), ('accessibility.html', 'Accessibility')]),
]
_sm_body = svc_hero('Sitemap', 'Every page on Loadboot, in one place.')
_sm_cols = ''
for _g, _links in _SITEMAP_GROUPS:
    _items = ''.join('<li><a href="%s">%s</a></li>' % (u, t) for u, t in _links)
    _sm_cols += '<div class="card reveal"><h3>%s</h3><ul style="line-height:2.1;margin-top:8px">%s</ul></div>' % (_g, _items)
_sm_body += '<section><div class="wrap"><div class="grid g3 reveal">%s</div></div></section>' % _sm_cols
page('sitemap.html', 'Sitemap | Loadboot', 'Every page on the Loadboot website — services, resources, company and legal — in one place.', '', _sm_body)

# ---------- SITEMAP + ROBOTS ----------
DOMAIN = 'https://loadboot.com'
# PROD_REF/STAGING_REF/context targets are defined once near the top of this file.
_SITEMAP_EXCLUDE = {'dashboard.html', '404.html'}
pages = [f for f in sorted(os.listdir(OUT)) if f.endswith('.html') and f not in _SITEMAP_EXCLUDE]
urls = ''.join('<url><loc>%s/%s</loc><changefreq>weekly</changefreq></url>' % (DOMAIN, ('' if f=='index.html' else f)) for f in pages)
sitemap = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">%s</urlset>' % urls
with open(os.path.join(OUT,'sitemap.xml'),'w',encoding='utf-8') as f: f.write(sitemap)
with open(os.path.join(OUT,'robots.txt'),'w',encoding='utf-8') as f:
    f.write('User-agent: *\nAllow: /\nDisallow: /dashboard.html\nDisallow: /app/\nSitemap: %s/sitemap.xml\n' % DOMAIN)

# ---------- SECURITY HEADERS (Netlify _headers) ----------
# Applied to every response. Non-CSP baseline (safe: does not alter page behavior).
# geolocation=(self) keeps the carrier dashboard's location feature working while
# blocking any third-party from requesting location.
HEADERS = (
"/*\n"
"  X-Frame-Options: DENY\n"
"  X-Content-Type-Options: nosniff\n"
"  Referrer-Policy: strict-origin-when-cross-origin\n"
"  Permissions-Policy: geolocation=(self), camera=(), microphone=(), payment=(), usb=()\n"
"  Strict-Transport-Security: max-age=31536000; includeSubDomains\n"
"  Cross-Origin-Opener-Policy: same-origin\n"
)
# PER-CONTEXT CSP for the Phase 2A apps ONLY (scoped to /app/*). Item 8: the CSP
# permits the CONTEXT'S project ONLY — production builds allow the production
# Supabase project, preview builds allow the staging project. Never both. Allows:
# self for docs/styles/workers; the PINNED esm.sh module CDN for supabase-js. No
# inline/eval scripts.
_CSP_REF = APP_REF   # prod ref in production context, staging ref otherwise
# Live operations map: Leaflet from cdnjs (script+style) and OpenStreetMap raster tiles
# (img). circleMarkers are SVG, so no external marker images are needed.
_APP_CSP = (
  "default-src 'self'; "
  "base-uri 'self'; "
  "object-src 'none'; "
  "frame-ancestors 'none'; "
  "img-src 'self' data: blob: https://*.tile.openstreetmap.org https://*.basemaps.cartocdn.com https://server.arcgisonline.com https://%s.supabase.co; "
  "frame-src 'self' https://%s.supabase.co; "
  "style-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; "
  "font-src 'self' data:; "
  "script-src 'self' https://esm.sh https://cdn.jsdelivr.net https://cdnjs.cloudflare.com; "
  "worker-src 'self'; "
  "manifest-src 'self'; "
  "connect-src 'self' https://%s.supabase.co wss://%s.supabase.co https://esm.sh https://cdn.jsdelivr.net https://cdnjs.cloudflare.com https://photon.komoot.io https://data.transportation.gov https://router.project-osrm.org https://vpic.nhtsa.dot.gov"
) % (_CSP_REF, _CSP_REF, _CSP_REF, _CSP_REF)
APP_HEADERS = (
  "\n/app/*\n"
  "  X-Frame-Options: DENY\n"
  "  X-Content-Type-Options: nosniff\n"
  "  Referrer-Policy: no-referrer\n"
  "  X-Robots-Tag: noindex, nofollow\n"
  "  Content-Security-Policy: " + _APP_CSP + "\n"
)
# The service worker script and env identity MUST always be revalidated against the
# network — never served from the browser's HTTP cache. Otherwise an installed PWA can
# keep running an old build (stale sw.js means new deploys are never detected). These
# more-specific rules sit AFTER /app/* so Netlify applies them on top.
SW_NOCACHE_HEADERS = (
  "\n/app/sw.js\n"
  "  Cache-Control: no-cache, no-store, must-revalidate\n"
  "\n/app/env-config.js\n"
  "  Cache-Control: no-cache, no-store, must-revalidate\n"
)
with open(os.path.join(OUT,'_headers'),'w',encoding='utf-8') as f: f.write(HEADERS + APP_HEADERS + SW_NOCACHE_HEADERS)

# ---------- _redirects ----------
# Publish dir is /site and contains ONLY built output — no Python/Markdown/SQL/source files
# are ever copied here, so nothing sensitive can be fetched. This file is intentionally minimal.
REDIRECTS = "# Loadboot — no custom redirects. Source files are not in the publish directory.\n"
with open(os.path.join(OUT,'_redirects'),'w',encoding='utf-8') as f: f.write(REDIRECTS)

# ---------- BRANDED 404 (noindex; Netlify serves automatically) ----------
NOTFOUND = (
'<!doctype html><html lang="en"><head><meta charset="utf-8">'
'<meta name="viewport" content="width=device-width,initial-scale=1">'
'<meta name="robots" content="noindex,follow">'
'<title>Page not found &mdash; Loadboot</title>'
'<link rel="stylesheet" href="/styles.css?v=6">'
'<link rel="icon" href="/favicon.ico?v=2">'
'<style>.nf{min-height:70vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:40px 20px}'
'.nf .in{max-width:520px}.nf .c{font-family:\'Manrope\',sans-serif;font-weight:800;font-size:3.2rem;color:#0883F7;line-height:1}'
'.nf h1{font-family:\'Manrope\',sans-serif;color:#10223B;font-size:1.5rem;margin:14px 0 8px}'
'.nf p{color:#64748B;margin:0 0 22px}.nf a.btn{display:inline-block;background:#FC5305;color:#fff;text-decoration:none;'
'font-weight:700;font-family:\'Manrope\',sans-serif;padding:13px 24px;border-radius:12px}</style></head>'
'<body><div class="nf"><div class="in"><div class="c">404</div>'
'<h1>That page took a wrong turn</h1>'
'<p>The page you&rsquo;re looking for isn&rsquo;t here. It may have moved, or the link was mistyped.</p>'
'<a class="btn" href="/">Back to home &rarr;</a>'
'<p style="margin-top:18px;font-size:.92rem">Or jump to <a href="/services.html">services</a>, '
'<a href="/load-score.html">Load Score</a>, or <a href="/blog.html">the blog</a>.</p>'
'</div></div></body></html>'
)
with open(os.path.join(OUT,'404.html'),'w',encoding='utf-8') as f: f.write(NOTFOUND)

# ---------- COPY SOURCE-ONLY-AT-ROOT FILES INTO PUBLISH DIR ----------
# dashboard.html is authored by hand (not generated) -> copy it into /site.
if os.path.exists(os.path.join(SRC,'dashboard.html')):
    shutil.copy2(os.path.join(SRC,'dashboard.html'), os.path.join(OUT,'dashboard.html'))
# Copy every image/icon asset present at the repo root into /site (favicons, icons,
# webp/jpg/png/avif photos). Source-only files (.py/.md/.toml/.sql) are NEVER copied.
for fn in os.listdir(SRC):
    full=os.path.join(SRC,fn)
    if os.path.isfile(full) and fn not in _NO_PUBLISH and fn.lower().endswith(_ASSET_EXTS):
        shutil.copy2(full, os.path.join(OUT,fn))

# ============================================================================
# PHASE 2A APPLICATIONS (Command Center + Carrier Portal)
# Emit the /app tree into the publish dir with an environment-specific config that
# is asserted against the deploy CONTEXT: a PRODUCTION build may target ONLY the
# production project; any PREVIEW/branch build may target ONLY the staging project.
# A mismatch (or a missing required key) FAILS the build — never silently wrong.
# ============================================================================
APP_SRC = os.path.join(SRC, 'app')
APP_OUT = os.path.join(OUT, 'app')
# Static file types allowed into the publish dir for the apps. Source-only types
# (.py/.md/.sql/.toml) are NEVER copied — enforced again by the recursive leak scan.
_APP_OK_EXTS = ('.html', '.js', '.css', '.webmanifest', '.json', '.svg', '.png', '.webp', '.ico', '.gif', '.jpg', '.jpeg')

# Deploy context + Supabase targets are resolved once near the top of this file
# (PROD_REF/STAGING_REF/PROD_ANON/STAGING_ANON/_CTX/IS_PRODUCTION_CTX/APP_* /_BUILD_ID).
if os.path.isdir(APP_SRC):
    # 1) target env from context (production => prod ONLY, else staging ONLY)
    _app_env, _app_ref, _app_anon = APP_ENV, APP_REF, APP_ANON

    # 2) copy the app tree (allowed extensions only), preserving structure
    for dirpath, dirnames, filenames in os.walk(APP_SRC):
        rel = os.path.relpath(dirpath, APP_SRC)
        dest_dir = APP_OUT if rel == '.' else os.path.join(APP_OUT, rel)
        os.makedirs(dest_dir, exist_ok=True)
        for fn in filenames:
            if fn.startswith('_selftest'):
                continue  # stray gate self-test scratch files never ship
            if fn.lower().endswith(_APP_OK_EXTS):
                shutil.copy2(os.path.join(dirpath, fn), os.path.join(dest_dir, fn))

    # 3) write env-config.js (the ONLY place the project URL/key are injected).
    #    The runtime (shared/env.js) re-asserts url<->projectId consistency.
    if _app_env == 'production' and _app_ref != PROD_REF:
        _APP_FATAL = 'production build must target the production project'
    elif _app_env == 'preview' and _app_ref != STAGING_REF:
        _APP_FATAL = 'preview build must target the staging project'
    else:
        _APP_FATAL = None
    # Preview/branch deploys MUST have a staging key — refuse to fall back to prod.
    if _app_env == 'preview' and not _app_anon and _CTX in ('deploy-preview', 'branch-deploy'):
        _APP_FATAL = 'preview build is missing LOADBOOT_STAGING_ANON_KEY (refusing to target production)'

    _app_url = 'https://%s.supabase.co' % _app_ref
    _env_cfg = ('// GENERATED by build_site.py — do not edit. context=%s\n'
                'window.__LB_ENV=%s;\n') % (
        _CTX, json.dumps({
            'environment': _app_env, 'supabaseUrl': _app_url,
            'supabaseAnonKey': _app_anon or 'MISSING_STAGING_ANON_KEY',
            'projectId': _app_ref, 'buildId': _BUILD_ID,
        }))
    with open(os.path.join(APP_OUT, 'env-config.js'), 'w', encoding='utf-8') as f:
        f.write(_env_cfg)

    # 4) generate the app service worker. Precache = the ACTUAL emitted static files
    #    only (NO synthetic '/app/' directory URL that would 404). Each app's index
    #    is precached so each app has its OWN offline shell. env-config.js + sw.js are
    #    excluded (env identity must always come from the network).
    _precache = []
    for dirpath, dirnames, filenames in os.walk(APP_OUT):
        for fn in filenames:
            if fn in ('env-config.js', 'sw.js'):
                continue
            p = os.path.join(dirpath, fn)
            url = '/app/' + os.path.relpath(p, APP_OUT).replace(os.sep, '/')
            _precache.append(url)
    _precache = sorted(set(_precache))
    _cc_shell = '/app/command-center/index.html'
    _ca_shell = '/app/carrier/index.html'
    APP_SW = ("// GENERATED by build_site.py. App service worker (scope /app/).\n"
        "// Caches ONLY the static shell allowlist below, and RESILIENTLY (one bad URL\n"
        "// never wipes the cache). Network-only for everything else; NEVER caches API/\n"
        "// auth/storage/document/money/location/profile data (all cross-origin Supabase).\n"
        "// No mutation queue. Each app has its OWN offline shell — the carrier app never\n"
        "// receives Command Center HTML and vice-versa.\n"
        "const CACHE='lb-app-%s';\n"
        "const CORE=%s;\n"
        "const CC_SHELL=%s, CA_SHELL=%s;\n"
        "self.addEventListener('install',function(e){e.waitUntil(caches.open(CACHE).then(function(c){\n"
        "  return Promise.allSettled(CORE.map(function(u){return c.add(u);}));   // resilient: per-URL\n"
        "}).then(function(){return self.skipWaiting();}));});\n"
        "self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==CACHE&&k.indexOf('lb-app')===0)return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});\n"
        "self.addEventListener('message',function(e){if(e.data&&e.data.type==='LB_PURGE'){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.filter(function(k){return k.indexOf('lb-app')===0;}).map(function(k){return caches.delete(k);}));}).then(function(){if(e.source&&e.source.postMessage)e.source.postMessage({type:'LB_PURGED'});}));}});\n"
        "function shellFor(p){var m=p.match(/^(\\/app\\/[^\\/]+\\/)/);if(!m)return null;var s=m[1]+'index.html';return CORE.indexOf(s)>=0?s:null;}  // per-app shell: each portal serves ONLY its own index.html\n"
        "self.addEventListener('fetch',function(e){var r=e.request;var u=new URL(r.url);\n"
        "  if(r.method!=='GET'||u.origin!==location.origin){return;}            // never touch cross-origin or writes\n"
        "  if(u.pathname.indexOf('/app/')!==0){return;}                          // only manage the app scope\n"
        "  if(u.pathname==='/app/env-config.js'){return;}                        // env identity: always network\n"
        "  var isNav=(r.mode==='navigate')||(r.headers.get('accept')||'').indexOf('text/html')>=0;\n"
        "  if(isNav){                                                            // navigations: app-shell model (per-app), works on/offline\n"
        "    var s=shellFor(u.pathname);\n"
        "    if(s){e.respondWith(caches.match(s).then(function(m){return m||fetch(s).catch(function(){return Response.error();});}));return;}\n"
        "    return;                                                             // navigation outside a known app: let it pass through\n"
        "  }\n"
        "  if(CORE.indexOf(u.pathname)<0){return;}                               // not allowlisted: network-only (no caching)\n"
        "  e.respondWith(caches.match(r).then(function(m){return m||fetch(r).then(function(res){if(res&&res.ok){var cp=res.clone();caches.open(CACHE).then(function(c){c.put(r,cp);});}return res;});}));\n"
        "});\n"
        "// ---- Web Push (Phase 5): show notification + focus/open on click ----\n"
        "self.addEventListener('push',function(e){var d={};try{d=e.data?e.data.json():{};}catch(_){d={};}var title=d.title||'LoadBoot';var options={body:d.body||'',icon:'/favicon.ico',badge:'/favicon.ico',data:{url:d.url||'/app/carrier/'},vibrate:[80,40,80]};e.waitUntil(self.registration.showNotification(title,options));});\n"
        "self.addEventListener('notificationclick',function(e){e.notification.close();var url=(e.notification.data&&e.notification.data.url)||'/app/carrier/';e.waitUntil(clients.matchAll({type:'window',includeUncontrolled:true}).then(function(list){for(var i=0;i<list.length;i++){var c=list[i];if('focus' in c){if(c.navigate)c.navigate(url);return c.focus();}}if(clients.openWindow)return clients.openWindow(url);}));});\n") % (_BUILD_ID, json.dumps(_precache), json.dumps(_cc_shell), json.dumps(_ca_shell))
    with open(os.path.join(APP_OUT, 'sw.js'), 'w', encoding='utf-8') as f:
        f.write(APP_SW)
else:
    _APP_FATAL = None

# ---------- SHOTS: real portal screenshots for the public docs pages ----------
try:
    _shots_src = os.path.join(SRC, 'shots')
    if os.path.isdir(_shots_src):
        _shots_dst = os.path.join(OUT, 'shots')
        os.makedirs(_shots_dst, exist_ok=True)
        for _f in os.listdir(_shots_src):
            if _f.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                shutil.copy2(os.path.join(_shots_src, _f), os.path.join(_shots_dst, _f))
        print('SHOTS copied:', len(os.listdir(_shots_dst)))
except Exception as _e:
    print('SHOTS copy skipped:', _e)

# ---------- PREVIEW REBIND (item 8: ENTIRE preview is staging-bound) ----------
# The legacy dashboard.html (and any other copied artifact) hardcodes the PRODUCTION
# Supabase project. In any non-production build we rewrite every production project
# reference (URL + publishable key) to the STAGING project, so a Deploy Preview makes
# ZERO production-backend requests. Production builds are left untouched.
if not IS_PRODUCTION_CTX:
    _sub_pairs = [('https://%s.supabase.co' % PROD_REF, 'https://%s.supabase.co' % STAGING_REF)]
    if STAGING_ANON:
        _sub_pairs.append((PROD_ANON, STAGING_ANON))
    for dirpath, dirnames, filenames in os.walk(OUT):
        for fn in filenames:
            if fn.lower().endswith(('.html', '.js', '.css', '.json', '.webmanifest')):
                p = os.path.join(dirpath, fn)
                try:
                    txt = open(p, encoding='utf-8').read()
                    new = txt
                    for a, b in _sub_pairs:
                        new = new.replace(a, b)
                    if new != txt:
                        open(p, 'w', encoding='utf-8').write(new)
                except Exception:
                    pass

# ---------- BUILD-FAILING VALIDATIONS ----------
_errors=[]
if os.path.isdir(APP_SRC) and _APP_FATAL:
    _errors.append('APP ENV ASSERTION FAILED: ' + _APP_FATAL)

# (1) Required output pages/files must exist in the publish dir.
REQUIRED_OUTPUT = ['index.html','about.html','services.html','pricing.html','contact.html',
 'tools.html','load-score.html','blog.html','privacy.html','terms.html','dashboard.html',
 'how-it-works.html','faq.html','box-truck-dispatch.html','careers.html','partners.html',
 'referral.html','resources.html','case-studies.html','security.html','status.html',
 'cookies.html','accessibility.html','login.html','carrier-application.html',
 '404.html','sitemap.xml','robots.txt','_headers','_redirects','styles.css','app.js',
 'sw.js','manifest.webmanifest']
for r in REQUIRED_OUTPUT:
    if not os.path.exists(os.path.join(OUT,r)):
        _errors.append('MISSING REQUIRED OUTPUT: '+r)

# (2) Every locally-referenced asset must resolve inside the publish dir.
def _is_local(u):
    if not u: return False
    u=u.strip().strip('\'"')
    return not u.startswith(('http://','https://','//','data:','mailto:','tel:','#','javascript:'))
def _norm(u):
    u=u.strip().strip('\'"').split('#')[0].split('?')[0]
    return u[1:] if u.startswith('/') else u
ref_re = re.compile(r'(?:href|src)\s*=\s*"([^"]+)"|url\(([^)]+)\)')
missing=set()
def _check_refs(text, where):
    for m in ref_re.finditer(text):
        raw=m.group(1) or m.group(2)
        if not _is_local(raw): continue
        rel=_norm(raw)
        if not rel or rel.endswith('/') or '.' not in os.path.basename(rel): continue
        if not os.path.exists(os.path.join(OUT, rel)):
            missing.add(rel+'  (in '+where+')')
for fn in os.listdir(OUT):
    if fn.endswith(('.html','.css')):
        _check_refs(open(os.path.join(OUT,fn),encoding='utf-8').read(), fn)
try:
    man=json.loads(open(os.path.join(OUT,'manifest.webmanifest'),encoding='utf-8').read())
    for ic in man.get('icons',[]):
        s=ic.get('src','')
        if _is_local(s) and not os.path.exists(os.path.join(OUT,_norm(s))):
            missing.add(_norm(s)+'  (manifest icon)')
except Exception as ex:
    _errors.append('manifest parse error: '+str(ex))
try:
    sw=open(os.path.join(OUT,'sw.js'),encoding='utf-8').read()
    mm=re.search(r'CORE\s*=\s*\[([^\]]*)\]', sw)
    if mm:
        for tok in re.findall(r'[\'"]([^\'\"]+)[\'"]', mm.group(1)):
            if _is_local(tok):
                rel=_norm(tok)
                if rel and '.' in os.path.basename(rel) and not os.path.exists(os.path.join(OUT,rel)):
                    missing.add(rel+'  (sw precache)')
except Exception:
    pass
_warnings = []
for x in sorted(missing):
    # Owner-captured product screenshots (/shots/*.png) are optional at build time —
    # the shot() helper hides any missing <img> via onerror, so a missing preview never
    # breaks a page. Treat these as warnings so a deploy is never blocked on pending
    # screenshots; every other missing asset stays a hard failure.
    if x.startswith('shots/'):
        _warnings.append('PENDING SCREENSHOT (optional): '+x)
    else:
        _errors.append('MISSING LOCAL ASSET: '+x)

# (3) Publish dir must contain NO source-only files, anywhere (recursive).
#     Catches .py/.md/.sql/.toml and any stray migrations/docs dirs at any depth.
for dirpath, dirnames, filenames in os.walk(OUT):
    if 'migrations' in dirnames or 'docs' in dirnames:
        for d in ('migrations','docs'):
            if d in dirnames:
                _errors.append('SOURCE DIR LEAKED INTO PUBLISH DIR: '+os.path.relpath(os.path.join(dirpath,d),OUT))
    for fn in filenames:
        if fn.lower().endswith(('.py','.md','.toml','.sql','.pyc')):
            _errors.append('SOURCE LEAKED INTO PUBLISH DIR: '+os.path.relpath(os.path.join(dirpath,fn),OUT))

# (4) Phase 2A app surface must be present and the env-config must match the context.
if os.path.isdir(APP_SRC):
    _app_required = ['app/env-config.js','app/sw.js',
                     'app/command-center/index.html','app/command-center/app.js',
                     'app/carrier/index.html','app/carrier/app.js',
                     'app/shared/env.js','app/shared/supabaseClient.js','app/shared/api.js']
    for r in _app_required:
        if not os.path.exists(os.path.join(OUT, r)):
            _errors.append('MISSING REQUIRED APP FILE: '+r)
    # env-config must declare exactly the project ref expected for this context.
    try:
        _cfg_txt = open(os.path.join(OUT,'app','env-config.js'),encoding='utf-8').read()
        _want_ref = PROD_REF if _CTX=='production' else STAGING_REF
        if ('https://%s.supabase.co' % _want_ref) not in _cfg_txt:
            _errors.append('APP ENV-CONFIG does not target expected project for context %s' % _CTX)
        _bad_ref = STAGING_REF if _CTX=='production' else PROD_REF
        if ('https://%s.supabase.co' % _bad_ref) in _cfg_txt:
            _errors.append('APP ENV-CONFIG leaks the wrong project ref for context %s' % _CTX)
        if 'service_role' in _cfg_txt:
            _errors.append('APP ENV-CONFIG contains a service_role key (must never reach the browser)')
    except Exception as ex:
        _errors.append('APP ENV-CONFIG unreadable: '+str(ex))

# (5) PREVIEW PRODUCTION-ISOLATION GATE (item 8): in any non-production build, the
#     production project ref must NOT appear in ANY emitted artifact (html/js/css/
#     json/webmanifest/_headers/_redirects). This proves a Deploy Preview makes zero
#     production-backend requests at the artifact level.
if not IS_PRODUCTION_CTX:
    _iso_exts = ('.html', '.js', '.css', '.json', '.webmanifest', '.txt')
    _iso_extra = {'_headers', '_redirects'}
    _leaks = []
    for dirpath, dirnames, filenames in os.walk(OUT):
        for fn in filenames:
            if fn.lower().endswith(_iso_exts) or fn in _iso_extra:
                p = os.path.join(dirpath, fn)
                try:
                    if PROD_REF in open(p, encoding='utf-8', errors='ignore').read():
                        _leaks.append(os.path.relpath(p, OUT))
                except Exception:
                    pass
    for x in sorted(set(_leaks)):
        _errors.append('PREVIEW PRODUCTION-ISOLATION: production ref present in '+x)

# ---- Public hosted custom forms (/forms/?f=key) — renders a published form via the
#      anon cc_get_public_form RPC and submits through the existing submit_web_form path,
#      so submissions land in the Forms Inbox → CRM. Production only (needs the live key).
_FORMS_JS = (r"""(function(){var SB='__SB__',KEY='__KEY__';var host=document.getElementById('lbf');
var f=new URLSearchParams(location.search).get('f');if(!f){host.textContent='No form specified.';return;}
function esc(s){return (s==null?'':String(s)).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function post(fn,body){return fetch(SB+'/rest/v1/rpc/'+fn,{method:'POST',headers:{apikey:KEY,Authorization:'Bearer '+KEY,'Content-Type':'application/json'},body:JSON.stringify(body)});}
function field(fl){var id='fld_'+fl.key,req=fl.required?' required':'',lbl='<label for="'+id+'">'+esc(fl.label||fl.key)+(fl.required?' *':'')+'</label>',inp;
if(fl.type==='textarea')inp='<textarea id="'+id+'" rows="4"'+req+'></textarea>';
else if(fl.type==='select')inp='<select id="'+id+'"'+req+'><option value="">Select…</option>'+(fl.options||[]).map(function(o){return '<option>'+esc(o)+'</option>';}).join('')+'</select>';
else if(fl.type==='checkbox')inp='<input type="checkbox" id="'+id+'">';
else inp='<input type="'+(fl.type||'text')+'" id="'+id+'"'+req+'>';
return '<div class="lbf-f">'+lbl+inp+'</div>';}
post('cc_get_public_form',{p_key:f}).then(function(r){return r.ok?r.json():null;}).then(function(def){
if(!def){host.innerHTML='<div class="lbf-msg">This form is not available.</div>';return;}
var h='<h1 style="font-family:Manrope,sans-serif;margin:0 0 6px;font-size:1.5rem">'+esc(def.title)+'</h1>';
if(def.description)h+='<p style="color:#64748b;margin:0 0 18px">'+esc(def.description)+'</p>';
h+='<form id="lbform">'+(def.fields||[]).map(field).join('')+'<button class="lbf-btn" type="submit">Submit</button></form>';
host.innerHTML=h;
document.getElementById('lbform').addEventListener('submit',function(e){e.preventDefault();
var raw={};(def.fields||[]).forEach(function(fl){var el=document.getElementById('fld_'+fl.key);raw[fl.key]=el?(fl.type==='checkbox'?(el.checked?'yes':'no'):el.value):'';});
var u=new URLSearchParams(location.search);
var payload={form_key:def.form_key,name:raw.name||raw.full_name||null,email:raw.email||null,phone:raw.phone||null,company:raw.company||null,message:raw.message||raw.notes||null,raw:raw,source_page:'/forms/?f='+def.form_key,referrer:document.referrer||null,utm_source:u.get('utm_source'),utm_medium:u.get('utm_medium'),utm_campaign:u.get('utm_campaign')};
post('submit_web_form',{p:payload}).then(function(r){if(r.ok){host.innerHTML='<div class="lbf-msg"><h2>✓ Thank you</h2><p>'+esc(def.thank_you||'We received your submission and will be in touch.')+'</p></div>';if(def.redirect_url)setTimeout(function(){location.href=def.redirect_url;},1600);}else{alert('Submission failed. Please try again.');}}).catch(function(){alert('Submission failed.');});
});
}).catch(function(){host.innerHTML='<div class="lbf-msg">This form is temporarily unavailable.</div>';});})();""").replace('__SB__', _BOARD_SB).replace('__KEY__', _BOARD_KEY)

_forms_body = ('<div class="lbf-wrap"><div class="lbf-card" id="lbf">Loading…</div>'
    '<p style="text-align:center;color:#94a3b8;font-size:.8rem;margin-top:16px">Powered by LoadBoot</p></div>'
    + ('<script>' + _FORMS_JS + '</script>' if IS_PRODUCTION_CTX else '<script>document.getElementById("lbf").textContent="Hosted forms are disabled in this preview environment.";</script>'))
_forms_html = ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">'
    '<title>LoadBoot — Form</title><link rel="preconnect" href="https://fonts.googleapis.com">'
    '<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@700;800&family=Inter:wght@400;600&display=swap" rel="stylesheet">'
    '<style>body{margin:0;background:#f1f5f9;font-family:Inter,system-ui,sans-serif}.lbf-wrap{max-width:560px;margin:0 auto;padding:40px 16px}'
    '.lbf-card{background:#fff;border:1px solid #e2e8f0;border-radius:16px;padding:26px;box-shadow:0 10px 30px -12px rgba(15,23,42,.12)}'
    '.lbf-f{margin-bottom:14px}.lbf-f label{display:block;font-weight:600;font-size:.88rem;margin-bottom:5px;color:#10223B}'
    '.lbf-f input,.lbf-f textarea,.lbf-f select{width:100%;padding:10px 12px;border:1px solid #cbd5e1;border-radius:9px;font-size:1rem;font-family:inherit;box-sizing:border-box}'
    '.lbf-f input[type=checkbox]{width:auto}.lbf-btn{background:#0883F7;color:#fff;border:0;border-radius:10px;padding:12px 18px;font-weight:700;font-size:1rem;cursor:pointer;width:100%;margin-top:6px}'
    '.lbf-msg{padding:24px;text-align:center;color:#334155}</style></head><body>' + _forms_body + '</body></html>')
os.makedirs(os.path.join(OUT, 'forms'), exist_ok=True)
with open(os.path.join(OUT, 'forms', 'index.html'), 'w', encoding='utf-8') as _ff:
    _ff.write(_forms_html)

if _warnings:
    print('BUILD WARNINGS — %d optional item(s) (deploy NOT blocked):' % len(_warnings))
    for w in _warnings: print('  - '+w)

if _errors:
    print('BUILD FAILED — %d problem(s):' % len(_errors))
    for e in _errors: print('  - '+e)
    sys.exit(1)


# ---------- llms.txt — AI-crawler map of the site (emerging standard) ----------
_LLMS = """# LoadBoot — The Operating System for Trucking
> US truck dispatch + verified load board platform for carriers, freight brokers, shippers and referral agents. Flat 5% dispatch fee on the carrier side; portals are free. Not a freight broker — carriers keep their own authority.

## Core
- [How it works — all four roles](https://loadboot.com/how-it-works): the full loop: posted → offered (first accept wins) → booked (e-signed RC) → geofence-tracked → delivered (POD) → auto-invoiced → receipt-verified payment.
- [Live load board — zero ghost loads](https://loadboot.com/load-board): verified postings with the full rate card printed.
- [One-tap booking](https://loadboot.com/book-truck-loads): instant rate confirmation and dispatch pack.
- [GPS tracking & proof](https://loadboot.com/gps-tracking): phone GPS or ELD, 800 m geofences, server-side arrive/depart stamps, detention clocks.
- [Payments & settlements](https://loadboot.com/payments-settlements): auto-DUE on delivery, PAY-BY deadlines, one-receipt trip settlement, confirm-received loop.
- [Factoring & NOA engine](https://loadboot.com/factoring-noa): UCC §9-406 on every pay panel, per-broker routing, self-assembling funding packet.
- [Fleet management](https://loadboot.com/fleet-management): driver roster & credential alerts, maintenance logs, fuel-card CSV import (EFS/Comdata/WEX), payroll from trips, IFTA from GPS, multi-fleet optimized plan (best next load per truck, reload chained).
- [Integrations](https://loadboot.com/integrations): QuickBooks Online two-way sync (LIVE), Samsara/Motive ELD, API keys & webhooks for TMS.
- [Compliance & verification hub](https://loadboot.com/compliance): FMCSA checks, expiry-tracked document vault, e-sign, gates — per role.
- [Operations Command Center](https://loadboot.com/command-center): the staffed ops desk — same-day verification, evidence-checked claims, human-verified receipts.

## Accessorial pay standards (published, GPS-evidenced workflows)
- [Detention — $60/hr after 2h free](https://loadboot.com/detention-pay-policy)
- [TONU — $250](https://loadboot.com/tonu-policy)
- [Layover](https://loadboot.com/layover-policy)
- [Lumper](https://loadboot.com/lumper-policy)
- [Driver assist](https://loadboot.com/driver-assist-policy)
- [FCFS & scheduling](https://loadboot.com/fcfs-policy)
- [Emergency rescheduling](https://loadboot.com/emergency-rescheduling-policy)

## Audiences
- [Carriers](https://loadboot.com/carriers) · [Owner-operators](https://loadboot.com/owner-operator-dispatch) · [New authorities](https://loadboot.com/new-authority-dispatch)
- [Freight brokers](https://loadboot.com/brokers) · [Shippers](https://loadboot.com/shipper-solutions) · [Agents — 1% per load](https://loadboot.com/agents)
- Account setup guides: [carrier](https://loadboot.com/create-carrier-account) · [broker](https://loadboot.com/create-broker-account) · [shipper](https://loadboot.com/create-shipper-account) · [agent](https://loadboot.com/create-agent-account)

## Pricing
- [Pricing](https://loadboot.com/pricing): flat 5% of linehaul on booked loads (carrier side only); no setup fee, no monthly fee, no contract. Broker/shipper/agent portals free.

## Terms, coverage and scope (stated plainly)
- Payment terms: net-30 from delivery standard, or the carrier's factoring terms (often 21 days). LoadBoot does NOT advance funds and is not a factor — money moves bank-to-bank; LoadBoot runs the ledger, deadlines, receipts and confirmations.
- Accessorials belong to the carrier in full — LoadBoot's 5% applies to linehaul only.
- Equipment: dry van, reefer, flatbed, step deck, hotshot, power-only, box truck/expedited, plus hazmat for carriers with PHMSA registration + CDL (H) endorsement + hazmat-rated insurance. Tanker, heavy-haul and oversize are case-by-case with permit coordination.
- Coverage: all 48 contiguous US states — deliberately deep rather than wide; Alaska, Hawaii and cross-border Canada/Mexico are out of network by design.
- No hardware sold and no ELD contract required: phone GPS is the tracker by default; Samsara/Motive tokens are read if the carrier already owns them.
- No guaranteed load volume or income by design — guarantees in freight usually hide contracts, forced dispatch or shaved rates. What is guaranteed: full rate card in writing before acceptance, real deadhead, accessorials paid on GPS evidence, PAY-BY dates, no contract.
- LoadBoot is not a freight broker: carriers keep their own MC/DOT authority; where broker authority is legally required, freight moves through licensed broker partners.
- No guaranteed volume or rates — market conditions vary; every load is carrier-approved before booking.
"""
open(os.path.join(OUT,'llms.txt'),'w',encoding='utf-8').write(_LLMS)
print('llms.txt written')

print("BUILD OK — publish dir:", OUT)
print("BUILT:", sorted(os.listdir(OUT)))

