# Item O — wrong-slot uploads (bl_doc_0539 / 0539b / 0539c) — 11 Oct 2026

Staging: everything applied + edge fn `doc-precheck` v17 (= repo v6). Prod: **APPLIED 13 Oct 2026** (owner: "laga do") — `bl_doc_0539_precheck_failed_state`, `bl_doc_0539b_no_silent_supersede`,
`bl_doc_0539c_reclassify_restore` (each replaced body diffed against prod first: prod was exactly the pre-0539 base, nothing
lost); edge fn `doc-precheck` = repo v6 (prod version 11, verify_jwt true; prod v10 was repo v5 of 5 Sep). Smoke: POST without a
user JWT → 401 `not_authorized` from our code (boots). Anon SECDEF 36, names unchanged. The frontend was ALREADY on `main`
(merged before this) — so between that merge and 13 Oct the portal was sending slot/detect_only to v5; now closed.

## Root cause, proven from prod (read-only)

| # | Finding | Evidence |
|---|---|---|
| O.1 | AI pre-check not saving | 6/85 docs in 45 days have `ai_verdict`. Client began saving only on 30 Sep (5167ce4); since then ~28 checked-slot uploads → 4 real verdicts + 2 `queued`. |
| | 45 s client abort | 10 Oct: POST workers booted 17:01:14 / 17:02:03 / 17:02:53, no response logged; docs inserted 17:01:59 / 17:02:49 / 17:03:39 = boot + 45 s exactly. `lbAiPrecheck` returned `null` → nothing saved. |
| | Slow model | successful calls 11–35 s (gemini-2.5-flash thinking on; fresh worker per request so `WORKING_MODEL` never sticks). |
| | "queued" shown green | truncated JSON → `ai:true, verdict:'queued'`; CC `aiCard` painted it `#16a34a`. |
| | Paths with no check | reinstatement "Attach" + dashboard NOA card (9 Oct 19:54 NOA: no call in logs). |
| O.2 | Wrong slot | 9–10 Oct: `documents.type` ≠ storage folder on 4 rows (MC cert in COI slot ×2, COI in authority slot, COI in bank slot) — staff reclassified. AI never asked "what is this file?". |
| O.4 | Silent supersede | 10 Oct 17:26:48 real bank check `b1705893` → 14 s later a COI into the same slot → trigger superseded the bank check. Trigger also drops a **valid** requirement to pending on any upload; `admin_review_document` overwrote a valid requirement with `rejected` when the newcomer was rejected. |
| O.5 | Reclassify half-done | `cc_reclassify_document` left the old requirement pointing at the moved file, never restored what it superseded, and overwrote a valid target requirement. Not in any migration file. |

## What changed

- **O.1** edge fn v6 (thinking off, JSON mode, 20 s/model, 38 s budget, explicit `unchecked` + `ai_status`, key scrubbed
  from errors) · portal records `unchecked` instead of `null`, check added to the 2 missing paths · CC: "AI: check
  failed / not run" (never green) + **Run AI check** · `doc_set_ai_verdict` may replace a missing/unchecked/queued verdict
  (real ones stay write-once), staff with documents.review/compliance.verify allowed.
- **O.2** AI returns `detected_type`; `wrong_slot` → carrier modal "This looks like your Operating authority, not an
  Insurance / COI — upload it to Operating authority instead?" (one tap, check re-run there) · non-checklist slots get a
  detect-only call · CC "⚠ possible wrong slot".
- **O.3** `lbNameSlot` file-name check before the AI (unambiguous names only; 17 cases tested).
- **O.4** trigger: valid requirement untouched until the replacement is approved; a flagged file never supersedes; reject
  of a replacement keeps the requirement valid · portal confirms before uploading over an APPROVED doc.
- **O.5** reclassify hands the left slot back (restores the superseded file), never knocks out a valid target, restores a
  superseded doc (same type) · CC drawer: **Move to <suggested>**, any-slot move, **Restore to pending**, Superseded tab.

## Owner test on staging (cannot be done from a session without a staging login — a new auth user fires
`trg_new_account_notify`, a password change fires the security email)

1. Staging carrier login → Documents → pick **Insurance / COI**, upload an MC authority PDF → expect "Wrong slot?" modal → tap move → it lands in Operating authority.
2. Upload a file named `MC_Authority.pdf` to the COI slot → name modal appears before "Checking…".
3. CC → Documents → open that row → AI card + "Move to …" button; Superseded tab → Restore to pending.

## Prod data NOT touched (decide in CC after deploy)

- carrier `a77f8156…`: bank check `b1705893` still `superseded` (bank_verification is valid on `03683399`, so harmless);
  COI `ea335508` is `pending` with no requirement pointing at it (insurance_coi → `d4e5d6cd`, rejected) — review it.

## Rollback — prod `cc_reclassify_document` before 0539c (verbatim body)

```sql
declare d public.documents; v_old text; v_key text; v_org uuid;
begin
  if not (public.has_global_permission('documents.review') or public.has_global_permission('compliance.verify')
          or public.has_global_permission('carriers.manage')) then
    raise exception 'not authorized' using errcode='42501';
  end if;
  select * into d from public.documents where id = p_doc;
  if d.id is null then raise exception 'document not found' using errcode='22023'; end if;
  if not exists (select 1 from app_private.compliance_requirements r where r.active and r.doc_type = p_type)
     and p_type not in ('rate_con','bol','pod','agreement','other','noa') then
    raise exception 'invalid document type: %', p_type using errcode='22023';
  end if;
  v_old := d.type;
  update public.documents set type = p_type where id = p_doc;
  select key into v_key from app_private.compliance_requirements
    where active and doc_type = (case when p_type = 'agreement' then 'dispatch_agreement' else p_type end) limit 1;
  if v_key is not null then
    select o.id into v_org from public.organizations o where o.kind='carrier' and o.owner_user_id = d.carrier_id limit 1;
    if v_org is null then
      select m.org_id into v_org from public.organization_memberships m
        join public.organizations o on o.id = m.org_id and o.kind='carrier'
       where m.user_id = d.carrier_id limit 1;
    end if;
    if v_org is not null then
      insert into app_private.carrier_compliance (carrier_id, requirement_key, status, document_id, note, updated_at)
        values (v_org, v_key, 'pending', d.id, 'Reclassified by staff — awaiting review', now())
      on conflict (carrier_id, requirement_key) do update
        set status = 'pending', document_id = excluded.document_id,
            note = 'Reclassified by staff — awaiting review', updated_at = now();
    end if;
  end if;
  perform app_private.log_audit('document.reclassify','document',p_doc::text,null,
    format('%s -> %s', v_old, p_type), jsonb_build_object('from',v_old,'to',p_type));
  return jsonb_build_object('id', p_doc, 'from', v_old, 'to', p_type, 'requirement', v_key);
end;
```
