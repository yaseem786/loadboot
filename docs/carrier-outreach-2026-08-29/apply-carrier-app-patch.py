# -*- coding: utf-8 -*-
"""Idempotent patch for app/carrier/app.js.

Re-runnable against ANY base: every edit checks whether it is already there and skips if so.
That matters because another session is editing this file at the same time and has overwritten
it from a stale copy three times today — this script is how the work is re-applied in seconds
onto whatever the newest file happens to be, instead of being reconstructed by hand.

  1  bl_disp_0302 ack lines (dropped by a stale overwrite — restored)
  2  deep links  #tab/target
  3  fleet + documents anchors for those deep links
  4  the COI certificate-holder block on the insurance row
  5  the notification centre rebuild
"""
import io, sys

P = sys.argv[1] if len(sys.argv) > 1 else 'base.js'
s = io.open(P, encoding='utf-8').read()
orig = len(s)
applied, skipped = [], []


def edit(marker, old, new, label):
    """Apply `old`->`new` unless `marker` is already in the file."""
    global s
    if marker in s:
        skipped.append(label)
        return
    n = s.count(old)
    if n != 1:
        raise SystemExit(f"ANCHOR FAIL [{label}]: expected 1 match, found {n}")
    s = s.replace(old, new, 1)
    applied.append(label)


# ── 1 ── bl_disp_0302: '?ack=' must survive the in-app login ───────────────────
edit("lb_disp_ack",
     "// inDrive-style theme system — Off (light) / On (dark) / System. Official palette only.\nconst THEME_KEY",
     "// inDrive-style theme system — Off (light) / On (dark) / System. Official palette only.\n"
     "// bl_disp_0302: '?ack=<assignment>' from the \"meet your dispatcher\" e-mail survives the in-app login → dispatcher-card.js acknowledges it.\n"
     "try { const _ack0 = new URLSearchParams(location.search).get('ack'); if (_ack0) sessionStorage.setItem('lb_disp_ack', _ack0); } catch (_) {}\n"
     "const THEME_KEY",
     "bl_disp_0302 ack lines")

# ── 2 ── deep links ────────────────────────────────────────────────────────────
MOUNT = "const mount = (el, kids) => { el.innerHTML = ''; (Array.isArray(kids) ? kids : [kids]).forEach(c => c && el.appendChild(c)); };"
DEEP = MOUNT + r"""

// ── DEEP LINKS  #tab/target ───────────────────────────────────────────────────
// An email or a push says "add your truck"; the link should land on the Add-truck button, not on
// a tab the carrier then has to read. app.js already splits "#fleet/add-truck" into
// window.__lbDeepEnt = {tab,id}; this map turns the id into a real element. Anything not in the
// map is ignored, so an old link — or a typo — still lands correctly on the tab. A trailing "!"
// means click it too, and is only ever used on buttons that open a modal, never on a file picker,
// which a browser blocks without a real user gesture.
const LB_DEEP = {
  account: {
    profile: '#s-profile', verification: '#s-verify', verify: '#s-verify',
    business: '#s-biz', biz: '#s-biz', dispatch: '#s-disp', prefs: '#s-disp',
    preferences: '#s-disp', security: '#s-sec', alerts: '#s-notif',
    payments: '#s-pay', pay: '#s-pay', bank: '#s-pay', support: '#s-support',
  },
  fleet: {
    'add-truck': '[data-lb="add-truck"]!', truck: '[data-lb="trucks-card"]', trucks: '[data-lb="trucks-card"]',
    'add-driver': '[data-lb="add-driver"]!', driver: '[data-lb="drivers-card"]', drivers: '[data-lb="drivers-card"]',
  },
  documents: {
    checklist: '[data-lb="doc-checklist"]', upload: '[data-lb="doc-upload"]',
    w9: '[data-lb="docbtn-w9"]!', agreement: '[data-lb="docbtn-dispatch_agreement"]!',
    insurance: '[data-lb="doc-insurance"]', coi: '[data-lb="doc-insurance"]',
    authority: '[data-lb="doc-authority"]', mc: '[data-lb="doc-authority"]',
    bank: '[data-lb="doc-bank_check"]', mcs150: '[data-lb="doc-mcs150"]',
  },
};
function lbRunDeepLink(tab) {
  let de; try { de = window.__lbDeepEnt; } catch (_) { return; }
  if (!de || !de.id || de.tab !== tab) return;
  const map = LB_DEEP[tab]; if (!map) return;                    // loads/trips keep their own handlers
  const spec = map[String(de.id).toLowerCase()]; if (!spec) return;
  window.__lbDeepEnt = null;
  const doClick = spec.slice(-1) === '!';
  const sel = doClick ? spec.slice(0, -1) : spec;
  let n = 0;                                                      // views mount async — wait for the node
  const iv = setInterval(() => {
    n++;
    let el = null; try { el = document.querySelector(sel); } catch (_) {}
    if (!el) { if (n > 40) clearInterval(iv); return; }            // 40 x 200ms = 8s, then give up quietly
    clearInterval(iv);
    try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (_) {}
    if (sel.charAt(0) === '#') {                                  // account page: light the matching chip
      try { document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('on', '#' + c.dataset.t === sel)); } catch (_) {}
    }
    try { el.style.outline = '2px solid #0883F7'; el.style.outlineOffset = '3px';
          setTimeout(() => { el.style.outline = ''; }, 3500); } catch (_) {}
    if (doClick) setTimeout(() => { try { el.click(); } catch (_) {} }, 500);
  }, 200);
}"""
edit("function lbRunDeepLink", MOUNT, DEEP, "deep-link resolver")

edit("try { lbRunDeepLink(tab); } catch (_) {}",
     "} else if (n9 > 25) clearInterval(iv9); }, 200); } } catch (_) {}\n  }\n",
     "} else if (n9 > 25) clearInterval(iv9); }, 200); } } catch (_) {}\n"
     "    try { lbRunDeepLink(tab); } catch (_) {}   // #fleet/add-truck, #account/payments, #documents/w9 …\n  }\n",
     "render() hook")

# ── 3 ── anchors the deep links land on ────────────────────────────────────────
edit("'data-lb': 'drivers-card'",
     """      h('div', { class: 'cp-card' }, [
        cardHead('Drivers', drivers.length + ' total'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', onClick: () => driverForm(null) }, '+ Add driver'),""",
     """      h('div', { class: 'cp-card', 'data-lb': 'drivers-card' }, [
        cardHead('Drivers', drivers.length + ' total'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', 'data-lb': 'add-driver', onClick: () => driverForm(null) }, '+ Add driver'),""",
     "fleet drivers anchor")

edit("'data-lb': 'trucks-card'",
     """      h('div', { class: 'cp-card' }, [
        cardHead('Trucks & equipment', trucks.length + ' total'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', onClick: () => truckForm(null) }, '+ Add truck'),""",
     """      h('div', { class: 'cp-card', 'data-lb': 'trucks-card' }, [
        cardHead('Trucks & equipment', trucks.length + ' total'),
        h('button', { class: 'cp-btn cp-btn-sm', style: 'margin-bottom:12px', 'data-lb': 'add-truck', onClick: () => truckForm(null) }, '+ Add truck'),""",
     "fleet trucks anchor")

edit("'data-lb': 'doc-checklist'",
     "mount(reqHost, h('div', { style: 'margin-bottom:10px' }, [h('div', { class: 'cp-row-t', style: 'margin-bottom:4px' }, 'Required documents checklist')",
     "mount(reqHost, h('div', { style: 'margin-bottom:10px', 'data-lb': 'doc-checklist' }, [h('div', { class: 'cp-row-t', style: 'margin-bottom:4px' }, 'Required documents checklist')",
     "checklist anchor")

edit("'docbtn-' + _k9",
     "          const why = bad && r.note ?",
     "          // deep-link anchor: #documents/w9, /agreement, /insurance, /authority, /bank land on THIS row.\n"
     "          try { const _b9 = (act && act.tagName === 'BUTTON') ? act : (act && act.querySelector ? act.querySelector('button') : null); const _k9 = r.doc_type || dt0; if (_b9 && _k9) _b9.setAttribute('data-lb', 'docbtn-' + _k9); } catch (_) {}\n"
     "          const why = bad && r.note ?",
     "doc action-button anchor")

edit("'data-lb': 'doc-upload'",
     "h('div', { class: 'cp-inlineform' }, [fileIn, up, msg])",
     "h('div', { class: 'cp-inlineform', 'data-lb': 'doc-upload' }, [fileIn, up, msg])",
     "upload form anchor")

# ── 4 ── the COI holder block, on the insurance row itself ─────────────────────
GUIDE_TAIL = "    return h('div', { class: 'cp-card', style: 'border-left:4px solid #0883F7;margin:10px 0;background:rgba(8,131,247,.05)' }, kids9);\n  }\n"
COI_FN = GUIDE_TAIL + r"""
  // ── The one box that sends most certificates back ────────────────────────────
  // 29 Aug 2026 audit: 7 of the 11 open carrier blockers were the same thing — an ACORD 25 whose
  // CERTIFICATE HOLDER named the carrier itself, or DAT, or a policy monitoring service, never
  // LoadBoot. The coverage was almost always already right. The guide card that explains this only
  // appears once the carrier opens the upload dropdown — which is AFTER he has phoned his agent and
  // been sent the wrong certificate. So the holder box now sits on the requirement row itself,
  // copy-ready, at the moment he first reads that a COI is needed.
  function lbCoiHolderBlock(nm9) {
    const copyBtn9 = (label9, text9, done9) => h('button', { class: 'cp-btn cp-btn-sm ghost', style: 'margin:0 8px 6px 0', onClick: async (ev9) => {
      const b9 = ev9.currentTarget;
      try { await navigator.clipboard.writeText(text9()); b9.textContent = done9; } catch (_) { alert(text9()); }
      setTimeout(() => { b9.textContent = label9; }, 3000);
    } }, label9);
    return h('div', { class: 'cp-card', 'data-lb': 'coi-holder', style: 'border-left:4px solid #FC5305;margin:8px 0 14px;background:rgba(252,83,5,.06)' }, [
      h('div', { class: 'cp-row-t', style: 'font-size:.92rem' }, '⚠ Before you call your agent — the box that sends most certificates back'),
      h('div', { class: 'cp-row-s', style: 'margin-top:4px' }, 'Your coverage is usually already right. What gets a certificate rejected is the CERTIFICATE HOLDER box naming your own company, your factor, or a monitoring service. It has to read exactly this:'),
      h('div', { style: 'margin:9px 0;padding:11px 13px;border:1px dashed rgba(252,83,5,.55);border-radius:10px;font-weight:800;line-height:1.6;white-space:pre-line;font-size:.9rem' }, LB_COI_HOLDER_BLOCK),
      h('div', { class: 'cp-row-s', style: 'margin-bottom:9px' }, 'Certificate holder ONLY — not additional insured. That means no endorsement and no extra premium, and it takes an agent about two minutes. While they have the file open, ask for $1,000,000 commercial auto liability, $100,000 motor truck cargo, and every truck scheduled with its VIN — we can only dispatch a truck the policy actually names.'),
      h('div', null, [
        copyBtn9('📋 Copy the holder address', () => LB_COI_HOLDER_BLOCK, '✓ Copied'),
        copyBtn9('✉ Copy the whole message for your agent', () => LB_DOC_GUIDE.insurance.script(nm9), '✓ Copied — paste it into a text or email'),
      ]),
    ]);
  }
"""
edit("function lbCoiHolderBlock", GUIDE_TAIL, COI_FN, "lbCoiHolderBlock()")

ROW_OLD = """          return h('div', { class: 'cp-row', style: 'border-left:3px solid ' + col + ';padding-left:10px' }, [h('div', { style: 'min-width:0;flex:1' }, [h('div', { class: 'cp-row-t', style: 'font-size:.88rem' }, r.name), h('div', { class: 'cp-row-s' }, okd ? 'Approved \\u2713' : rev ? 'Submitted \\u00b7 in review' : bad ? (st === 'expired' ? '\\u2715 Expired \\u2014 send a current one' : '\\u2715 Rejected \\u2014 fix it and re-upload') : (r.mandatory ? 'Required \\u2014 not on file' : 'Optional')), why].filter(Boolean)), act]); })]));"""
ROW_NEW = """          const row9 = h('div', { class: 'cp-row', 'data-lb': (r.doc_type || dt0) ? 'doc-' + (r.doc_type || dt0) : null, style: 'border-left:3px solid ' + col + ';padding-left:10px' }, [h('div', { style: 'min-width:0;flex:1' }, [h('div', { class: 'cp-row-t', style: 'font-size:.88rem' }, r.name), h('div', { class: 'cp-row-s' }, okd ? 'Approved \\u2713' : rev ? 'Submitted \\u00b7 in review' : bad ? (st === 'expired' ? '\\u2715 Expired \\u2014 send a current one' : '\\u2715 Rejected \\u2014 fix it and re-upload') : (r.mandatory ? 'Required \\u2014 not on file' : 'Optional')), why].filter(Boolean)), act]);
          // The holder block rides with the row while the item is still open — not once it is
          // approved or already in review, where it would only be noise.
          const isCoi9 = (r.doc_type === 'insurance' || r.doc_type === 'hazmat_coi' || /certificate of insurance/i.test(r.name || ''));
          return (isCoi9 && !okd && !rev) ? h('div', null, [row9, lbCoiHolderBlock(ov && ov.carrier)]) : row9; })]));"""
edit("isCoi9", ROW_OLD, ROW_NEW, "insurance row + COI hook")


# ── 5 ── the notification centre ───────────────────────────────────────────────
NOTIF_NEW = '  // ── NOTIFICATION CENTRE ──────────────────────────────────────────────────────\n  // 29 Aug 2026 audit: onboarding nudges were read at 4% (158 sent, 7 read); one carrier carried\n  // ten unread notifications describing one missing certificate; 166 rows had no tone at all and\n  // rendered neutral grey. The list also coloured only urgent/success/"everything else blue",\n  // throwing away four of the five tones the app already defines in TONE. This rebuild uses all\n  // five, groups by day, collapses repeats, shows relative time, and puts a real action button on\n  // anything that needs the carrier — pointed at the exact card via the #tab/target deep links.\n  let _lbNotifFilter = \'all\';\n  function lbNotifGlyph(k) {\n    k = String(k || \'\').toLowerCase();\n    if (/pay|invoice|settle|payout|factoring|bank|fee|remit/.test(k)) return \'💰\';\n    if (/trip|tracking|pod|detention|pickup|delivery/.test(k)) return \'🗺\';\n    if (/posting|fleet|truck|driver/.test(k)) return \'🚛\';\n    if (/offer|load|book|match/.test(k)) return \'📦\';\n    if (/document|compliance|onboarding|packet|w9|coi|insurance|authority/.test(k)) return \'📄\';\n    if (/health|violation|strike|rating|safety/.test(k)) return \'🛡\';\n    if (/account|profile|email|deletion/.test(k)) return \'👤\';\n    return \'🔔\';\n  }\n  function lbRelTime(iso) {\n    try {\n      const d = new Date(iso), ms = Date.now() - d.getTime();\n      if (!isFinite(ms)) return \'\';\n      const m = Math.round(ms / 60000);\n      if (m < 1) return \'just now\';\n      if (m < 60) return m + \' min ago\';\n      const hrs = Math.round(m / 60);\n      if (hrs < 24) return hrs + \' h ago\';\n      const days = Math.round(hrs / 24);\n      if (days === 1) return \'Yesterday \' + d.toLocaleTimeString(\'en-US\', { hour: \'numeric\', minute: \'2-digit\' });\n      if (days < 7) return days + \' days ago\';\n      return d.toLocaleDateString(\'en-US\', { month: \'short\', day: \'numeric\' });\n    } catch (_) { return \'\'; }\n  }\n  function lbNotifBucket(iso) {\n    try {\n      const d = new Date(iso), n = new Date(), same = (a, b) => a.toDateString() === b.toDateString();\n      if (same(d, n)) return \'Today\';\n      const y = new Date(n); y.setDate(y.getDate() - 1);\n      if (same(d, y)) return \'Yesterday\';\n      return \'Earlier\';\n    } catch (_) { return \'Earlier\'; }\n  }\n  function lbNotifSubject(n) { const p = n.payload || {}; return String(p.subject || p.doc || n.template_key || \'\'); }\n  const lbNotifNeeds = (n) => !n.read_at && [\'urgent\', \'warning\', \'action\'].indexOf(((n.payload || {}).tone) || \'info\') >= 0;\n\n  async function loadNotifications() {\n    showSkeleton(content, \'cards\');\n    let rows;\n    try { rows = await pocketNotifications(60); }\n    catch (e) { mount(content, h(\'div\', { class: \'cp-card\' }, [h(\'div\', { class: \'cp-muted\' }, \'Could not load notifications — check your connection.\'), h(\'button\', { class: \'cp-btn cp-btn-sm\', style: \'margin-top:8px\', onClick: () => loadNotifications() }, \'Retry\')])); return; }\n    rows = rows || [];\n    if (!rows.length) { mount(content, h(\'div\', { class: \'cp-card\' }, h(\'div\', { class: \'cp-muted\' }, \'No notifications yet. Alerts about your loads, payments and onboarding will appear here.\'))); refreshUnread(); return; }\n\n    const unread9 = rows.filter((n) => !n.read_at).length;\n    const needsN = rows.filter(lbNotifNeeds).length;\n\n    // Collapse repeats of the same subject into one row with a count. Eight "Document received"\n    // receipts are one fact, not eight.\n    const seen = {}, list = [];\n    rows.forEach((n) => {\n      const k = (n.template_key || \'\') + \'|\' + lbNotifSubject(n);\n      if (seen[k] !== undefined) { list[seen[k]]._dup = (list[seen[k]]._dup || 1) + 1; return; }\n      seen[k] = list.length; list.push(n);\n    });\n    const shown = list.filter((n) => _lbNotifFilter === \'all\' ? true : _lbNotifFilter === \'unread\' ? !n.read_at : lbNotifNeeds(n));\n\n    const chip = (id, label, count) => h(\'button\', { class: \'cp-btn cp-btn-sm\' + (_lbNotifFilter === id ? \'\' : \' ghost\'), style: \'margin:0 7px 8px 0\',\n      onClick: () => { _lbNotifFilter = id; loadNotifications(); } }, label + (count != null ? \' · \' + count : \'\'));\n\n    const kids = [\n      cardHead(\'Notifications\', unread9 ? unread9 + \' unread\' : \'All caught up\'),\n      h(\'div\', { style: \'margin:2px 0 6px\' }, [\n        chip(\'needs\', \'Needs you\', needsN), chip(\'unread\', \'Unread\', unread9), chip(\'all\', \'All\', list.length),\n        unread9 ? h(\'button\', { class: \'cp-btn cp-btn-sm ghost\', style: \'margin:0 0 8px\', onClick: async (e9) => {\n          e9.currentTarget.disabled = true;\n          try { await pocketMarkAllNotificationsRead(); } catch (_) {}\n          refreshUnread(); loadNotifications();\n        } }, \'✓ Mark all read\') : null,\n      ].filter(Boolean)),\n    ];\n    if (!shown.length) kids.push(h(\'div\', { class: \'cp-muted\', style: \'padding:10px 0\' }, _lbNotifFilter === \'needs\' ? \'Nothing needs you right now.\' : \'Nothing unread — you are up to date.\'));\n\n    let bucket = null;\n    shown.forEach((n) => {\n      const p = n.payload || {}, tone = toneOf(p.tone), b = lbNotifBucket(n.created_at);\n      if (b !== bucket) { bucket = b; kids.push(h(\'div\', { style: \'font-size:.63rem;font-weight:800;letter-spacing:.13em;text-transform:uppercase;color:#94a3b8;margin:15px 0 3px\' }, b)); }\n      const dest = lbNotifDest(n, p), navItem = NAV.find((x) => x[0] === dest);\n      const open9 = async () => {\n        if (!n.read_at) { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); refreshUnread(); } catch (_) {} }\n        go(dest);\n      };\n      const act = ([\'urgent\', \'warning\', \'action\'].indexOf(p.tone) >= 0 && !n.read_at)\n        ? h(\'div\', { style: \'margin-top:9px;display:flex;align-items:center;gap:11px;flex-wrap:wrap\' }, [\n            h(\'button\', { class: \'cp-btn cp-btn-sm\', style: \'margin:0;background:\' + tone.c + \';color:#07101d;font-weight:800\', onClick: (e9) => { e9.stopPropagation(); open9(); } },\n              (p.cta || (p.tone === \'urgent\' ? \'Fix it\' : \'Open\')) + \' →\'),\n            navItem ? h(\'span\', { style: \'font-size:.68rem;color:#94a3b8\' }, navItem[1]) : null,\n          ].filter(Boolean))\n        : null;\n      // The icon is the real LoadBoot app icon with a tone ring; the small corner glyph is what\n      // says at a glance whether this is a document, a truck or a payment.\n      const mark = \'<span style="position:relative;display:inline-block">\'\n        + \'<img src="/icon-512.png" width="36" height="36" alt="LoadBoot" style="display:block;border-radius:11px;box-shadow:0 0 0 2px \' + tone.c + \'">\'\n        + \'<span style="position:absolute;right:-6px;bottom:-6px;width:19px;height:19px;border-radius:7px;background:#0e1726;border:1.5px solid \' + tone.c + \';font-size:10px;line-height:16px;text-align:center">\' + lbNotifGlyph(n.template_key) + \'</span></span>\';\n      const row = h(\'div\', { class: \'cp-row cp-notif\' + (n.read_at ? \'\' : \' unread\'),\n        style: \'align-items:flex-start;gap:12px;border-left:3px solid \' + tone.c + \';padding-left:11px;border-radius:0 12px 12px 0\'\n               + (n.read_at ? \';opacity:.72\' : \';background:\' + tone.bg),\n        onClick: open9, title: \'Open the page this notification is about\' }, [\n        h(\'span\', { html: mark, style: \'flex:none;line-height:0;margin-top:2px\' }),\n        h(\'div\', { style: \'min-width:0;flex:1\' }, [\n          h(\'div\', { style: \'display:flex;align-items:center;gap:8px;flex-wrap:wrap\' }, [\n            h(\'span\', { style: \'font-size:.6rem;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:\' + tone.c }, tone.label),\n            n._dup ? h(\'span\', { style: \'font-size:.62rem;font-weight:800;color:#94a3b8;background:rgba(148,163,184,.16);border-radius:999px;padding:1px 7px\' }, \'×\' + n._dup) : null,\n            h(\'span\', { style: \'margin-left:auto;font-size:.66rem;color:#94a3b8;white-space:nowrap\' }, lbRelTime(n.created_at)),\n          ].filter(Boolean)),\n          h(\'div\', { class: \'cp-row-t\', style: \'margin-top:1px\' }, p.title || n.template_key || \'Notification\'),\n          p.body ? h(\'div\', { class: \'cp-row-s\' }, p.body) : null,\n          act,\n        ].filter(Boolean)),\n        n.read_at ? null : h(\'span\', { class: \'cp-pill blue\' }, \'new\'),\n      ].filter(Boolean));\n      // swipe a row left to mark it read (iOS Mail pattern) — kept from the previous build\n      if (!n.read_at) attachSwipeAction(row, { onAction: async () => { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); refreshUnread(); loadNotifications(); } catch (_) {} } });\n      kids.push(row);\n    });\n    mount(content, h(\'div\', { class: \'cp-card\' }, kids));\n    refreshUnread();\n  }\n'
if "_lbNotifFilter" in s:
    skipped.append("notification centre")
else:
    a = s.index("  async function loadNotifications() {")
    b = s.index("\n  go(tab);", a)
    s = s[:a] + NOTIF_NEW + s[b + 1:]
    applied.append("notification centre")

# ── 6 ── lbNotifDest must understand #tab/target ───────────────────────────────
edit("the target is handled by lbRunDeepLink",
     "  if (p && p.url && p.url.indexOf('#') >= 0) { const t = p.url.split('#')[1]; if (t && TABS9.indexOf(t.replace(/^\\//, '')) >= 0) return t.replace(/^\\//, ''); }",
     '  // a deep link is "#tab/target" — take the tab, the target is handled by lbRunDeepLink\n  if (p && p.url && p.url.indexOf(\'#\') >= 0) { const t = p.url.split(\'#\')[1]; if (t) { const t0 = t.replace(/^\\//, \'\').split(\'/\')[0]; if (TABS9.indexOf(t0) >= 0) return t0; } }',
     "lbNotifDest deep-link aware")


# ── 7 ── open the deep target, not just the tab ────────────────────────────
edit("const hash9 =",
     '      const open9 = async () => {\n        if (!n.read_at) { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); refreshUnread(); } catch (_) {} }\n        go(dest);\n      };',
     '      const open9 = async () => {\n        if (!n.read_at) { try { await pocketMarkNotificationRead(n.id); n.read_at = new Date().toISOString(); refreshUnread(); } catch (_) {} }\n        // a notification that carries a deep target ("#documents/insurance") sets the hash so the\n        // resolver runs and lands on the exact card; a plain tab just navigates.\n        const hash9 = (p.url && p.url.indexOf(\'#\') >= 0) ? p.url.split(\'#\')[1].replace(/^\\//, \'\') : \'\';\n        if (hash9.indexOf(\'/\') > 0) { try { location.hash = \'#\' + hash9; return; } catch (_) {} }\n        go(dest);\n      };',
     "notification opens the deep target")


io.open(P, 'w', encoding='utf-8').write(s)
print("applied:", ", ".join(applied) or "(none)")
print("skipped (already present):", ", ".join(skipped) or "(none)")
print("bytes", orig, "->", len(s))
