# Why the site still shows the old page — and the one command that fixes it

## What actually happened

Nothing I built is in `origin/main`. I checked:

```
git ls-tree origin/main -r --name-only | grep -i doctrust     → nothing
git show origin/main:app/shared/api.js | grep -c manual_list   → 0
git show origin/main:app/command-center/command-center.css | grep -c 'cc-chip-btn.on' → 0
```

Your commit `603b2fc "ok"` (merged as PR #173) added, among other things:

```
Claude outputs/cc-campaign-fixes-frontend.patch
```

**The patch file itself got committed into the repo, instead of being applied to it.** A `.patch`
file is a set of instructions for changing code — committing it just stores the instructions.
That is why the deploy succeeded and the site looks identical: from Netlify's point of view,
nothing about the site changed.

Nothing was lost and nothing is broken. The database-side fixes are all live already (they went
in through migrations, not through the repo), which is why sending the campaign still worked.

## The fix — one command

From the repo root, on a fresh branch:

```bash
git checkout main
git pull
git checkout -b feat/privacy-terms-flagship

git apply APPLY-ME-loadboot-2026-09-06.patch

python3 build_site.py          # sanity check that the site still builds
node --check app/carrier/app.js
node --check app/partner/app.js
node --check app/shared/ui/docTrust.js

git add -A
git commit -m "Flagship privacy + terms pages, document trust badges, campaign manager fixes"
git push -u origin feat/privacy-terms-flagship
```

I verified this patch applies cleanly to the current `origin/main` — I cloned it, checked out
`origin/main`, and ran `git apply --check` against it. It reports no conflicts.

If `git apply` ever complains, `git apply --3way APPLY-ME-loadboot-2026-09-06.patch` will merge
it rather than refuse.

## What is in this patch (15 files)

**New flagship pages**
- `privacy_module.py` — privacy.html, 1,097 → ~4,500 words, 11 sections, FAQ schema
- `terms_module.py` — terms.html, 1,333 → ~3,800 words, all 19 clauses with plain-English notes
- `build_site.py` — wires both in, replacing the old inline blocks

**Document trust badges**
- `app/shared/ui/docTrust.js` — the single source of truth for "who can open this document"
- `app/carrier/app.js` — main Documents form, onboarding wizard, agent ID + bank upload
- `app/partner/app.js` — the packet modal, which covers every broker and shipper document

**Campaign manager fixes (frontend half — the DB half is already live)**
- `app/shared/api.js` — `manual_list` audience type; `?? null` → `|| null` so a blank Schedule
  field stops sending `''` (that was the 22007 error)
- `app/command-center/views/audiences.js` — paste-a-list UI for manual audiences
- `app/command-center/command-center.css` + `cc-dark.css` — the missing `.cc-chip-btn.on` rule
  that made the channel chips look dead

**Migration files** (already applied to staging and production — these are the record)
- `bl_camp_0325` manual_list audience + utm_campaign fix
- `bl_camp_0326` empty-string coercion in cc_cmp_save
- `bl_camp_0327` solo-operator self-approval
- `bl_camp_0328` analytics count opens/clicks by timestamp

## Housekeeping

`Claude outputs/` now holds committed copies of old patch files and a stray
`EMAIL-PREVIEW-...html`. Once this patch is applied those are dead weight in the repo — worth a
`git rm -r "Claude outputs"` in the same branch, unless you are keeping them on purpose.

There is also a stale root-level `privacy.html` tracked in the repo, left over from before the
site was generated. It is **not** served — `netlify.toml` publishes `site/` only — but it is
confusing to find, and worth deleting.

## After it deploys

Check these three:
1. `loadboot.com/privacy.html` — hero should say "LoadBoot Privacy Policy", tab title
   "Privacy Policy & Data Practices"
2. `loadboot.com/terms.html` — should show the 19 numbered clauses with green plain-English notes
3. Carrier portal → Documents → pick "Bank verification" in the dropdown → a green padlock badge
   should appear saying your dispatcher can never open it
