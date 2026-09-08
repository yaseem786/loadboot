// formDraft.js — "I filled half of this, got interrupted, and lost everything."
//
// The truck form asks for ~30 fields. A carrier fills fifteen at a truck stop, a call comes in,
// the modal closes, and the work is gone. That is the single cheapest way to make someone stop
// trusting a product. This keeps an unfinished form on their own device and offers it back.
//
// Design decisions worth keeping:
//  • localStorage only. The draft never leaves the device and never reaches our servers — which
//    is exactly what /cookies.html tells carriers we do with "an unsent draft".
//  • Drafts EXPIRE. A stale draft is worse than none: it silently reintroduces yesterday's
//    answer into today's form. Availability posts expire in 60 minutes because they describe
//    "right now"; the fleet forms get 7 days because they describe a truck, which does not move.
//  • The availability form's dates ride the 60-minute window on purpose. The product promise is
//    that a carrier types today's window every time and never sees the one they saved last time
//    (bl_avail_0322). A draft from a few minutes ago is the same sitting; a draft from yesterday
//    is not, and it is thrown away rather than restored.
//  • Restoring is ANNOUNCED and reversible. Silently repopulating a form people did not expect
//    is its own kind of bug, so the caller shows a line with a "Start fresh" button.

const PREFIX = 'lb:draft:';

function readRaw(key) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!o || typeof o !== 'object' || !o.at || !o.v) return null;
    return o;
  } catch (_) { return null; }
}

export function clearDraft(key) {
  try { localStorage.removeItem(PREFIX + key); } catch (_) {}
}

/**
 * @param {string} key      stable per form + record, e.g. 'truck:new' or 'truck:<id>'
 * @param {object} fields   name -> element, or name -> { get():any, set(v):void }
 * @param {object} [opts]   { ttlMinutes:number, onRestore:fn(ageMinutes) }
 * @returns {{restore:fn, save:fn, clear:fn, hasDraft:fn}}
 */
export function attachDraft(key, fields, opts) {
  const o = opts || {};
  const ttl = (o.ttlMinutes || 60 * 24 * 7) * 60000;
  const names = Object.keys(fields || {});

  const readField = (f) => {
    if (!f) return undefined;
    if (typeof f.get === 'function') return f.get();
    if (f.type === 'checkbox') return !!f.checked;
    return f.value;
  };
  const writeField = (f, v) => {
    if (!f || v === undefined || v === null) return;
    if (typeof f.set === 'function') { f.set(v); return; }
    if (f.type === 'checkbox') { f.checked = !!v; return; }
    f.value = v;
  };

  const snapshot = () => {
    const v = {};
    let any = false;
    names.forEach((n) => {
      const val = readField(fields[n]);
      if (val === undefined || val === null || val === '' || val === false) return;
      if (Array.isArray(val) && !val.length) return;
      v[n] = val; any = true;
    });
    return any ? v : null;
  };

  let timer = 0;
  const save = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const v = snapshot();
      try {
        if (!v) { localStorage.removeItem(PREFIX + key); return; }
        localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v }));
      } catch (_) { /* private mode, quota — a lost draft must never break the form */ }
    }, 400);
  };

  // Listen on the real elements. Accessor-backed fields (place / destination pickers) are
  // captured on the same events because they live inside the modal.
  names.forEach((n) => {
    const f = fields[n];
    if (f && f.addEventListener) {
      f.addEventListener('input', save);
      f.addEventListener('change', save);
    }
  });

  const restore = () => {
    const d = readRaw(key);
    if (!d) return 0;
    const age = Date.now() - d.at;
    if (age > ttl) { clearDraft(key); return 0; }
    names.forEach((n) => { if (n in d.v) writeField(fields[n], d.v[n]); });
    const mins = Math.max(1, Math.round(age / 60000));
    if (typeof o.onRestore === 'function') { try { o.onRestore(mins); } catch (_) {} }
    return mins;
  };

  return {
    restore,
    save: () => { clearTimeout(timer); const v = snapshot();
      try { if (v) localStorage.setItem(PREFIX + key, JSON.stringify({ at: Date.now(), v })); } catch (_) {} },
    clear: () => { clearTimeout(timer); clearDraft(key); },
    hasDraft: () => !!readRaw(key),
  };
}

/** A "we brought your unfinished entry back" line with a Start fresh escape hatch. */
export function draftBanner(mins, onFresh) {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'margin-bottom:9px;padding:9px 11px;border-radius:10px;border:1px solid rgba(74,222,128,.30);'
    + 'background:rgba(74,222,128,.07);font-size:.82rem;line-height:1.55;color:#cbd5e1;display:flex;gap:10px;'
    + 'align-items:center;flex-wrap:wrap';
  const txt = document.createElement('span');
  txt.style.flex = '1';
  txt.innerHTML = '<b style="color:#4ade80">Picked up where you left off</b> — restored what you had typed '
    + (mins < 60 ? (mins + ' minute' + (mins === 1 ? '' : 's')) : (Math.round(mins / 60) + ' hour' + (Math.round(mins / 60) === 1 ? '' : 's')))
    + ' ago. Nothing was sent.';
  const btn = document.createElement('button');
  btn.className = 'cp-btn-ghost cp-btn-sm';
  btn.type = 'button';
  btn.textContent = 'Start fresh';
  btn.onclick = () => { try { onFresh(); } catch (_) {} };
  wrap.appendChild(txt); wrap.appendChild(btn);
  return wrap;
}


/**
 * Draft a whole modal without naming thirty fields by hand.
 * Keys each control by name > placeholder > tag+index, so if a placeholder is ever reworded
 * that ONE field simply is not restored — the rest still are. Failing quiet and partial beats
 * failing loud, and beats restoring a value into the wrong box.
 *
 * @param {string} key
 * @param {HTMLElement} root  the modal body — call AFTER it is populated
 * @param {object} [opts]     { ttlMinutes, skip:[keys], onRestore }
 */
export function attachDraftToContainer(key, root, opts) {
  const o = opts || {};
  const skip = o.skip || [];
  const fields = {};
  const seen = {};
  const els = root ? root.querySelectorAll('input, select, textarea') : [];
  for (let i = 0; i < els.length; i++) {
    const e = els[i];
    if (e.type === 'file' || e.type === 'password' || e.type === 'button' || e.type === 'submit') continue;
    let k = e.getAttribute('name') || e.getAttribute('placeholder') || (e.tagName.toLowerCase() + i);
    seen[k] = (seen[k] || 0) + 1;
    if (seen[k] > 1) k = k + '#' + seen[k];
    if (skip.indexOf(k) >= 0) continue;
    fields[k] = e;
  }
  return attachDraft(key, fields, o);
}

export default { attachDraft, attachDraftToContainer, clearDraft, draftBanner };
