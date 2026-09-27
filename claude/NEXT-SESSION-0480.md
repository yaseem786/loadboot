# Next session — hand-off written 27 Sep 2026 ~19:40 UTC (owner: "agla session likh do")

Paste this whole file into the new session. Roman Urdu + English, be direct, CLAUDE.md applies.

## Ids
- Supabase prod `rwscphuhpjoudvljvmdk` · staging `snslhvmkjusozgjelghi`
- Netlify site `6882ea72-0dd6-4b16-80f8-64fe9136573e` (loadboot) · current prod deploy = commit 4c1c2c7 (v6 widget)
- Branch `claude/sharp-rubin-zpncl7` = origin, HEAD 0a0ae58 (bl_brain_0479). Not merged to main.

## State right now
- bl_lc_0475 (widget v6 + specialists): live on site (deploy 18:31) and `rule.chat_specialists` live on prod (18:41). Done.
- bl_brain_0479 (AI chat visibility): **DB live on prod + staging**, code committed 0a0ae58, **NOT deployed to Netlify**
  (this container's network policy blocks registry.npmjs.org, so the Netlify uploader could not run).
  → First job: deploy 0a0ae58. Either allow `registry.npmjs.org` in the environment's Network access and run the
    Netlify MCP `deploy-site` for the site id above, or merge → main → push from GitHub Desktop → Netlify deploy.
  Doc: `claude/LIVECHAT-VISIBILITY-0479.md`.

## Owner asks for this session (27 Sep, in order)

### A. Carrier choices — their own tab, on the main page, deep-linked to Dispatcher 360 (bl_disp_048x)
What exists: a dispatcher candidate picks a carrier from the Fleet Book; the owner accepts/declines on the
Dispatcher 360 page only (`app/command-center/views/dispatcher-360.js` ~L600–670, card "Carrier choice waiting":
Accept — start trial + assign / Decline — candidate chooses again). RPCs already there in `app/shared/api.js`:
`ccDispatcherChoices(status='pending', user)` → `cc_dispatcher_choices`, and
`ccDispatcherChoiceDecide(id, 'accept'|'decline', note, sop)` → `cc_dispatcher_choice_decide`.
`views/dispatchers.js` L250 already loads pending choices for a count. Dispatchers group tabs are in
`app/command-center/app.js` L281–295 (`team`); Carrier requests tab (`creq`, `views/carrierRequests.js`) is the
pattern to copy. Dispatcher 360 route: `#/dispatcher?id=<user_id>&tab=carriers` (app.js L388).
Build:
1. New tab **"Carrier choices"** under Dispatchers & agents (`#/carrier-choices`): every pending choice across all
   candidates — candidate, carrier (name, MC, exact-match flag, equipment, floor $/mi, city), chosen-when, candidate's
   test score/status, terms state (commission set? trial window?) — with **Accept / Decline right on the card**
   (reuse the exact drawer + SOP flow from dispatcher-360.js so behaviour is identical), and a deep link to the
   Dispatcher 360 profile. "Decided recently" list below (like Carrier requests). Amazon/Uber-grade: no dead ends,
   every fact clickable, one screen to clear the queue.
2. **Main page**: CC home = Action center (`views/actionCenter.js`, read-only via `cc_action_center`). Add a
   "Carrier choices waiting" item (count + link to the tab); a migration extends `cc_action_center`.
   Check `cc_action_center` first — it may already count choices under another name.
3. Bell: confirm `dispatcher.carrier.chosen` notifications link to the new tab (today they link to 360 with tab=carriers;
   keep that, it is fine) — nothing to change unless the owner wants it.
Gate: staging first (there are pending choices on staging? check), then prod; anon-secdef names unchanged (36/35).

### B. "Carrier call planning AI" (Riley call plans) — build it, Amazon/Uber standard (bl_voice_048x)
Today: nothing built. `brain_permissions.source.voice` = planned. Plan is `docs/livechat/LIVECHAT-CLAUDE-BRAIN-PLAN.md`
§9 (L287–295): Phase 1 = the brain schedules/triggers calls via `retell_dial()` (only to people who asked — TCPA),
reads transcript + post-call analysis back, continues the thread. Fix first: number wiring + prompt publish per
`docs/voice-agent/RILEY-0458.md`. Owner decision 27 Sep: Riley stays on Retell's hosted LLM while the $30 balance
lasts; Phase 2 (Claude behind Riley) after. Existing Riley control plane: `ccRileyCalls`, `ccRileySettingsGet`,
`ccRetellCallback` (api.js L582–590), edge functions `retell-admin`, `retell-hook`, `retell-inbound-hook`.
Session plan (decide with the owner in one message, then build):
1. Read RILEY-0458.md + §9 + §14 control map; verify Retell balance line in CC → Riley → Settings.
2. Define "call plan": brain job `source.voice`, route `voice_plan` — input = who (carrier/candidate + why: onboarding
   gap, document missing, choice pending, no reply to email), output = {goal, 5 talking points, facts to confirm,
   do-not-say, best time, language}; stored on the job, shown in CC → Riley → Calls (plan before, transcript +
   post-call summary after) and on the Dispatcher/Carrier 360 pages. Every capability = a `brain_permissions` row
   (`source.voice` → live, tools `tool.retell_dial` prep → live only when the owner says), logged via `brain_log`.
3. Triggers: manual first ("Plan a call" button on Carrier 360 / Dispatcher 360 / Carrier choices), auto later.
4. TCPA + consent: only numbers with consent (`sms_consent_*` / callback requests). Never a demo org. Never a real
   customer in tests — throwaway record, then clean up.
5. Cost line in the plan job (Retell ≈ $0.13/min + brain ≈ $0.05/call) shown on the screen.

### C. Left over from before (unchanged)
- `delivery-worker` / `delivery-worker-sms` → `cc_delivery_release_due` 403 "not authorized" every minute for 48 h+
  (`can_manage_comms()` is false for service_role). Harmless today (no `scheduled` deliveries) but a latent bug:
  small migration — accept service_role in `cc_delivery_release_due` (or a dedicated guard), keep it revoked from anon.
- `REP-PLAN-0477.md` / `WHATSAPP-AI-DESK-0478.md` exist on no branch (never committed). WhatsApp desk session 1
  (notify + schema + lock + buttons) and the Rep plan need re-planning before build.

## Facts settled today (do not re-investigate)
- "Portals not opening" (18:36/18:54) = carrier portal opened with the staff account 20190myaseen (no carrier org →
  "No carrier account"); the carrier account's sign-in happened inside the chat widget onboarding, which keeps its own
  token. Not a regression. Real carriers boot fine (carolleelogistics 17:22).
- CC → Carrier requests "Nothing waiting" is correct: `app_private.dispatcher_carrier_requests` is empty on prod.
- CC → AI Brain → Permissions: `source.voice` planned; no call-plan screen exists yet (→ B above).
