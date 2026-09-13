# F10 document access — recovered September 13

Read-only production catalog review; no policy changes. This replaces the missing September 8 local matrix with current evidence, not an assertion that its unpublished decisions were approved. Production `documents` bucket is private. Raw-object access and metadata access are different surfaces.

## Current access routes

All listed read policies are permissive: any matching route permits the read. An explicit documents.view deny does not override the independent staff policy.

| Caller or relationship | Current raw document access | Source |
|---|---|---|
| Owner of first path segment | Every documents object under their auth UID prefix | doc_read |
| Carrier linked to approved metadata row | Exact file_path matching approved documents.carrier_id = auth.uid() | doc_read_by_documents_row |
| Profile role admin | All documents objects | doc_read → is_admin |
| Any active internal staff | All documents objects, irrespective of document type | staff read documents → is_active_staff |
| Active staff with documents.view | All documents objects | doc_read → has_global_permission |
| Assigned dispatcher | Assigned carrier owner prefix, second segment authority / insurance / w9 / noa | doc_read_assigned_dispatcher → dispatcher_can_read_doc |
| Partner for a load | Associated trip paths tagged pod, bol_signed, pod_signed, lumper_receipt, gate_ticket or stop_photo | partner read claim stop documents → partner_can_read_stop_doc |
| Payer or payee carrier / payer partner organization | Exact payment receipt path for the associated transfer | payment receipt read → pay_can_read_receipt |
| Unrelated authenticated user | No route established by these policies | Requires negative integration test |
| Service backend | Service privilege can bypass RLS | Separate endpoint authorization review required |

Roles with documents.view: owner, operations_admin, compliance_reviewer, support, auditor. Only the first three have documents.review in the captured role defaults. Individual allow/deny grants and active scoped assignments also affect the permission helper. Blanket active-staff access remains independently sufficient.

Metadata: production documents policies target authenticated; owner can insert/read own rows, profile admin can manage all rows. Staging targets PUBLIC on these same metadata policies; their predicates remain present. Neither direct metadata RLS nor list visibility proves raw object secrecy. cc_list_documents uses documents.view and must be included in the final permission design.

Uploads: owner-prefix INSERT and documents.review staff-on-behalf INSERT are separate policies. No document UPDATE/DELETE policy was present in the captured set. Any new replacement/upsert flow needs explicit validation rather than assuming INSERT covers it.

## Proposed intended access — decision required

These are implementation recommendations, not approved business policy. “Assigned” means an active relationship to the exact carrier/trip, not all records. No new role or grant has been created.

| Role | Authority / insurance | Tax W-9 | NOA | Bank evidence | Identity / DOB | Trip proof / receipts |
|---|---|---|---|---|---|---|
| Owner / super admin | All | All | All | All | All | All |
| Compliance reviewer | Review scope | Review scope | Review scope | No by default | Review scope | Only explicit case scope |
| Finance reviewer | Status only | Assigned payment scope | Assigned payment scope | Assigned payment scope | No by default | Assigned financial scope |
| Operations admin | Operational scope | No by default | Operational scope | No by default | No by default | Operational scope |
| Dispatcher | Assigned carrier | No raw file by default | Assigned carrier if remit details needed | No | No | Assigned trip |
| Support | Status only | No | Status only | No | No | Case-scoped exception only |
| Auditor | Status / audit log | Time-limited explicit scope | Time-limited explicit scope | Time-limited explicit scope | No by default | Time-limited explicit scope |
| Carrier / owner | Own documents | Own | Own | Own | Own | Own relationships |
| Broker / shipper | Approved packet only if product flow requires | Explicit packet sharing only | Explicit packet sharing only | No | No | Own load relationship |

Resolve operations/compliance scope and dispatcher packet requirements with Yaseen before narrowing permissions. Audit exceptions need explicit expiration and logging; the table does not silently grant those capabilities.

## Implementation and verification sequence

1. Inventory path classes and document metadata types without downloading customer documents. Include staff-uploaded non-owner prefixes, legacy paths, payment receipts and trip document_files. Do not classify sensitivity from a filename supplied by the uploader alone.
2. Implement one authoritative document-type/relationship predicate and align raw storage, metadata/list RPCs, signed-URL services and exports with it. Preserve service-only workflow permission checks.
3. In the same staging transaction, address both blanket staff access and broad documents.view access. Evaluate dispatcher W-9/NOA independently; removing one policy alone leaves the others active.
4. Test positive and negative role/type pairs, suspended/expired assignments, explicit denies, owner/other-owner, malformed/unknown type and path, approved staff-uploaded owner records, revoked dispatcher assignments, broker trip isolation and payer/payee receipt isolation.
5. Check actual download and newly issued signed URL behavior in a staging browser; separately account for already issued URLs. Save every prior policy/function/grant for rollback and compare exact anonymous function names. Production requires separate approval.

Evidence: `F10-PROD-POLICIES-2026-09-13.json`; staging policy comparison was read-only. No customer document was opened and no policy was changed.
