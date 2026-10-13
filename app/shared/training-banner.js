// bl_train_0548 — the one "nothing here is real" strip for demo / training accounts.
// Carrier portal: shown while the signed-in carrier is a demo org (training sandbox or store-review).
// Dispatcher workspace: shown while the carrier being worked is a demo carrier.
// It is the first child of .cp-main and sticky; the sticky header moves down by its height, so it
// never scrolls away and never covers the page title.

const CSS = `
.lb-train-banner{position:sticky;top:0;z-index:21;display:flex;align-items:center;justify-content:center;gap:10px;flex-wrap:wrap;
  min-height:30px;padding:5px 16px;background:#10223B;color:#FC5305;border-bottom:2px solid #FC5305;
  font:800 .74rem/1.3 Manrope,Inter,system-ui,sans-serif;letter-spacing:.08em;text-transform:uppercase;text-align:center}
.lb-train-banner .lbt-dot{width:8px;height:8px;border-radius:50%;background:#FC5305;flex:none;box-shadow:0 0 0 3px rgba(252,83,5,.25)}
.lb-train-banner .lbt-sub{color:#dbe6f5;font-weight:700;letter-spacing:.01em;text-transform:none}
.lb-train-banner[hidden]{display:none}
body.lb-training .cp-top{top:var(--lb-train-h,30px)}
@media (max-width:560px){.lb-train-banner{font-size:.7rem;padding:5px 12px}.lb-train-banner .lbt-sub{display:none}}
`;

function injectCss() {
  if (document.getElementById('lb-train-css')) return;
  const s = document.createElement('style'); s.id = 'lb-train-css'; s.textContent = CSS; document.head.appendChild(s);
}

// setTrainingBanner(true, { title, sub }) shows it; setTrainingBanner(false) hides it.
export function setTrainingBanner(on, opts = {}) {
  let el = document.querySelector('.lb-train-banner');
  if (!on) {
    if (el) el.hidden = true;
    document.body.classList.remove('lb-training');
    document.documentElement.style.removeProperty('--lb-train-h');
    return null;
  }
  const main = document.querySelector('.cp-main');
  if (!main) return null;
  injectCss();
  if (!el) {
    el = document.createElement('div'); el.className = 'lb-train-banner';
    el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  }
  if (el.parentNode !== main) main.insertBefore(el, main.firstChild);
  const dot = document.createElement('span'); dot.className = 'lbt-dot'; dot.setAttribute('aria-hidden', 'true');
  const title = document.createElement('span'); title.textContent = opts.title || 'TRAINING ACCOUNT — nothing here is real';
  const kids = [dot, title];
  if (opts.sub) { const sub = document.createElement('span'); sub.className = 'lbt-sub'; sub.textContent = opts.sub; kids.push(sub); }
  el.replaceChildren(...kids);
  el.hidden = false;
  document.body.classList.add('lb-training');
  document.documentElement.style.setProperty('--lb-train-h', (el.offsetHeight || 30) + 'px');
  return el;
}

// Height currently taken by the strip (0 when hidden) — for views that stack their own sticky bars.
export function trainingBannerHeight() {
  const el = document.querySelector('.lb-train-banner');
  return el && !el.hidden ? el.offsetHeight || 0 : 0;
}
