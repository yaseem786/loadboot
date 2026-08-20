import io
p = 'app/carrier/app.js'
s = io.open(p, encoding='utf-8').read()

# 1) Onboarding doc step: the requirements card rendered BELOW the file picker, and the
#    dropdown defaults to W-9 — so a carrier uploading a COI never saw the COI rules.
old = ("h('div', { class: 'cp-inlineform' }, [typeSel, fileIn, up, msg]), guideHostW, "
       "h('div', { style: 'margin-top:10px' }, list)]);")
new = ("typeSel, guideHostW, h('div', { class: 'cp-inlineform' }, [fileIn, up, msg]), "
       "h('div', { style: 'margin-top:10px' }, list)]);")
assert old in s, 'docStep layout anchor'
s = s.replace(old, new, 1)

# 2) Default the picker to the document that actually gets rejected, so the rules for it
#    are the first thing on screen rather than the W-9 rules.
old2 = "      const typeSel = h('select', { class: 'cp-in' }, types.map(([v, l]) => h('option', { value: v }, l)));\n      const fileIn = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });"
new2 = ("      const typeSel = h('select', { class: 'cp-in' }, types.map(([v, l]) => h('option', { value: v, selected: v === 'insurance' ? 'selected' : null }, l)));\n"
        "      const fileIn = h('input', { class: 'cp-in', type: 'file', accept: '.pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx' });")
assert old2 in s, 'typeSel anchor'
s = s.replace(old2, new2, 1)

io.open(p, 'w', encoding='utf-8').write(s)
print('patched: guide now sits above the file picker, and defaults to the COI rules')
