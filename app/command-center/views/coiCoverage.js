// coiCoverage.js — "what does this certificate actually cover?"
//
// This is the missing half of the VIN↔COI system. cc_vin_coverage, the green/red banner on
// the carrier's truck form and the LB001 gate that refuses to post an uninsured truck were
// all built and all work — but they read app_private.coi_vehicles, and nothing had ever
// filled it. The automatic path (coi_ingest_from_document reading the AI precheck verdict)
// cannot fire, because the precheck runs in the carrier's browser and its verdict is never
// stored; and storing a browser-supplied verdict would be worse, since it decides which
// VINs count as insured.
//
// So the reviewer records it, at the one moment they are already looking at the certificate.
// Backend: cc_coi_panel / cc_set_coi_coverage — bl_coi_0234.
import { el, mount } from '../../shared/ui/dom.js';
import { coiPanel, setCoiCoverage } from '../../shared/api.js';
import { humanizeError, toast } from '../../shared/errors.js';
import { can } from '../../shared/permissions.js';

// Same normalisation the database uses: certificates print VINs broken by hyphens, dots
// and line wraps, and a VIN we fail to read locks a carrier out of their own truck.
const VIN_RE = /(?:^|[^A-Z0-9])([A-HJ-NPR-Z0-9]{17})(?![A-Z0-9])/g;
export function extractVins(raw) {
  const flat = String(raw || '').replace(/[-.]/g, '').replace(/[^A-Za-z0-9]/g, ' ').toUpperCase();
  const out = []; const seen = {};
  let m;
  VIN_RE.lastIndex = 0;
  while ((m = VIN_RE.exec(' ' + flat + ' ')) !== null) {
    if (!seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
  }
  return out;
}

const MODES = [
  ['scheduled', 'Scheduled autos', 'The policy lists specific vehicles. Only those VINs can be dispatched.'],
  ['any_auto', 'Any auto', 'The policy covers any vehicle the carrier operates. Every truck is dispatchable.'],
  ['unknown', 'Cannot tell from this document', 'Nothing is blocked, but no truck is verified either. Ask the carrier for the schedule.'],
];

const S = {
  wrap: 'border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin-top:16px;background:#f8fafc',
  h: 'font-weight:800;font-size:.95rem;color:#0f172a',
  sub: 'font-size:.82rem;color:#64748b;line-height:1.55',
  chipRow: 'display:flex;gap:7px;flex-wrap:wrap;margin:10px 0 4px',
  vinChip: 'display:inline-flex;align-items:center;gap:6px;background:#0f172a;color:#e2e8f0;border-radius:8px;padding:4px 9px;font:700 .74rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em',
};

function modeChip(value, current, onPick) {
  const on = value[0] === current;
  return el('button', {
    type: 'button', title: value[2],
    style: 'text-align:left;cursor:pointer;border-radius:11px;padding:8px 12px;font:700 .82rem inherit;'
      + (on ? 'background:#0883F7;color:#fff;border:1px solid #0883F7'
            : 'background:#fff;color:#334155;border:1px solid #cbd5e1'),
    onClick: () => onPick(value[0]),
  }, (on ? '✓ ' : '') + value[1]);
}

/**
 * Returns a host element; it fills itself in. Renders nothing at all for non-insurance
 * documents, so documents.js can mount it unconditionally.
 */
export function coiCoverageCard(doc, onSaved) {
  const host = el('div');
  if (!doc || doc.type !== 'insurance') return host;

  (async () => {
    let p;
    try { p = await coiPanel(doc.id); }
    catch (e) { mount(host, el('div', { style: S.wrap }, el('div', { style: S.sub }, 'Could not load coverage: ' + humanizeError(e)))); return; }
    if (!p || !p.ok) {
      mount(host, el('div', { style: S.wrap }, [
        el('div', { style: S.h }, 'Coverage cannot be recorded'),
        el('div', { style: S.sub }, (p && p.reason) || 'This uploader is not linked to a carrier organisation.'),
      ]));
      return;
    }

    let mode = p.mode === 'unset' ? 'scheduled' : p.mode;
    let vins = Array.isArray(p.vins) ? p.vins.slice() : [];

    const paste = el('textarea', {
      class: 'cc-input', rows: '4',
      placeholder: 'Paste the vehicle schedule straight off the certificate — we pull the VINs out of it.\n\ne.g. 2016 FORD ECONOLINE  VIN 1FDWE3FL0GDC37133',
      style: 'width:100%;font:400 .84rem/1.5 ui-monospace,SFMono-Regular,Menlo,monospace',
    });
    const expiry = el('input', { class: 'cc-input', type: 'date', value: p.expiry_date || '' });
    const note = el('input', {
      class: 'cc-input', type: 'text', value: p.note || '',
      placeholder: 'Insurer, policy number, limits — what you read on the page',
    });

    const vinHost = el('div');
    const fleetHost = el('div');
    const modeHost = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:8px' });
    const schedHost = el('div');
    const saveMsg = el('div', { style: 'font-size:.82rem;margin-top:8px' });

    const drawVins = () => {
      mount(vinHost, vins.length
        ? el('div', { style: S.chipRow }, vins.map((v, i) => el('span', { style: S.vinChip }, [
            v,
            el('button', {
              type: 'button', title: 'Remove',
              style: 'background:none;border:0;color:#94a3b8;cursor:pointer;font-weight:800;padding:0 0 0 2px',
              onClick: () => { vins.splice(i, 1); drawVins(); drawFleet(); },
            }, '×'),
          ])))
        : el('div', { style: S.sub }, 'No VINs yet — paste the schedule below, or type one in.'));
    };

    // What this decision does to the carrier's actual trucks. A reviewer should see that
    // before they save it, not after the carrier fails to post a load.
    const drawFleet = () => {
      const trucks = p.trucks || [];
      if (!trucks.length) {
        mount(fleetHost, el('div', { style: S.sub + ';margin-top:10px' }, 'This carrier has no trucks registered yet.'));
        return;
      }
      const rows = trucks.map((t) => {
        const covered = mode === 'any_auto' ? true
          : mode === 'unknown' ? null
          : (t.vin ? vins.indexOf(String(t.vin).toUpperCase()) >= 0 : false);
        const tone = covered === true ? ['#15803d', '✓ dispatchable']
          : covered === null ? ['#92400e', '— unverified']
          : ['#b91c1c', '✕ cannot be dispatched'];
        return el('div', { style: 'display:flex;justify-content:space-between;gap:10px;padding:6px 0;border-top:1px solid #e2e8f0;font-size:.82rem' }, [
          el('span', { style: 'color:#334155' }, 'Unit ' + (t.unit_no || '—') + ' · ' + (t.vin || 'no VIN on file')),
          el('b', { style: 'color:' + tone[0] + ';white-space:nowrap' }, tone[1]),
        ]);
      });
      mount(fleetHost, el('div', { style: 'margin-top:10px' }, [
        el('div', { style: S.sub + ';font-weight:700;color:#475569' }, 'What this does to their fleet'),
        ...rows,
      ]));
    };

    const drawMode = () => {
      mount(modeHost, MODES.map((m) => modeChip(m, mode, (v) => { mode = v; drawMode(); drawSched(); drawFleet(); })));
      const m = MODES.find((x) => x[0] === mode);
      mount(schedHost, [
        el('div', { style: S.sub + ';margin-top:6px' }, m ? m[2] : ''),
        mode === 'scheduled' ? el('div', null, [
          vinHost,
          paste,
          el('div', { style: 'display:flex;gap:8px;margin-top:6px;flex-wrap:wrap' }, [
            el('button', {
              type: 'button', class: 'lb-btn lb-btn-secondary',
              onClick: () => {
                const found = extractVins(paste.value);
                if (!found.length) { saveMsg.style.color = '#b91c1c'; saveMsg.textContent = 'No 17-character VIN found in that text.'; return; }
                let added = 0;
                found.forEach((v) => { if (vins.indexOf(v) < 0) { vins.push(v); added++; } });
                paste.value = '';
                saveMsg.style.color = '#15803d';
                saveMsg.textContent = added ? ('Added ' + added + ' VIN' + (added === 1 ? '' : 's') + '.') : 'Already on the list.';
                drawVins(); drawFleet();
              },
            }, 'Pull VINs out of that'),
          ]),
        ]) : null,
      ]);
    };

    const saveBtn = el('button', {
      class: 'lb-btn lb-btn-primary',
      onClick: async (ev) => {
        const b = ev.currentTarget; b.disabled = true; b.textContent = 'Saving…';
        saveMsg.textContent = '';
        try {
          const r = await setCoiCoverage({
            org: p.org_id, mode,
            vins: mode === 'scheduled' ? vins : null,
            document: doc.id,
            expiry: expiry.value || null,
            note: note.value || null,
          });
          toast(mode === 'scheduled'
            ? ('Coverage recorded — ' + (r && r.vins) + ' VIN' + ((r && r.vins) === 1 ? '' : 's') + ' now dispatchable')
            : 'Coverage recorded', 'success');
          if (typeof onSaved === 'function') onSaved();
          p = await coiPanel(doc.id);
          vins = Array.isArray(p.vins) ? p.vins.slice() : [];
          drawVins(); drawFleet();
        } catch (e) {
          saveMsg.style.color = '#b91c1c'; saveMsg.textContent = humanizeError(e);
        }
        b.disabled = false; b.textContent = 'Save coverage';
      },
    }, 'Save coverage');

    const stateLine = p.mode === 'unset'
      ? el('div', { style: 'margin-top:6px;border-radius:10px;padding:9px 12px;background:#fef3c7;border:1px solid #fcd34d;color:#92400e;font-size:.82rem;font-weight:700' },
          '⚠ Not recorded yet. Until it is, no truck on this account can be matched to a policy.')
      : el('div', { style: S.sub + ';margin-top:6px' },
          'Currently ' + (p.mode === 'any_auto' ? 'any auto' : p.mode === 'scheduled' ? (p.vins || []).length + ' scheduled VIN(s)' : 'unclear')
          + (p.source ? ' · set by ' + (p.source === 'staff' ? 'a reviewer' : p.source) : '')
          + (p.expiry_date ? ' · expires ' + p.expiry_date : '')
          + (p.expired ? ' — EXPIRED' : ''));

    drawVins(); drawMode(); drawFleet();

    mount(host, el('div', { style: S.wrap }, [
      el('div', { style: S.h }, 'What does this certificate cover?'),
      el('div', { style: S.sub }, 'This is what decides which trucks we are allowed to dispatch. Read it off the document on the left.'),
      stateLine,
      modeHost,
      schedHost,
      el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:12px' }, [
        el('label', { style: 'flex:1;min-width:150px' }, [el('div', { style: S.sub + ';font-weight:700' }, 'Policy expiry'), expiry]),
      ]),
      el('label', { style: 'display:block;margin-top:8px' }, [el('div', { style: S.sub + ';font-weight:700' }, 'Note for the file'), note]),
      fleetHost,
      el('div', { style: 'margin-top:12px' }, saveBtn),
      saveMsg,
    ]));

    if (!can('documents.review')) {
      saveBtn.disabled = true;
      saveBtn.title = 'You have view-only access to documents.';
    }
  })();

  return host;
}

export default coiCoverageCard;
