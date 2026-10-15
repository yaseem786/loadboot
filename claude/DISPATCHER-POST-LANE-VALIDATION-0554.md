# bl_disp_0554 — dispatcher posts: strict "City, ST" lane + required loaded miles

Owner, 15 Oct 2026: "Haan, strict". Trigger: a prod dispatcher post went out as origin `austin`, destination `tx`,
miles null — no lane a carrier can plan, and with no miles the $/mi floor check in `disp_post_normalise` never ran.

| Where | What |
|---|---|
| `migrations/bl_disp_0554_dispatcher_post_lane_validation.sql` | NEW `app_private.disp_city_st(text)` → `'City, ST'` or null (immutable, not SECDEF, revoked from public/anon/authenticated). Two exact-once `fn_patch` anchors on `app_private.disp_post_normalise`: (a) origin + destination must parse, stored normalised; (b) miles required, 1..4,000. |
| `app/agent/dispatcher-workspace.js` | `cityST()` = the same rule in JS; the post form refuses a bad lane / missing miles before the RPC and writes the normalised value back into the fields. |

Rules
- State: 50 US states + DC + PR + 13 Canadian provinces/territories. Full names ("Dallas, Texas") are refused —
  the message shows the format. Mexico is not accepted (guess: no MX lanes today; add codes to both lists if needed).
- City: letters (accents ok), space, `.`, `'`, `-`; 2–40 chars. All-lower / all-upper → title case; mixed case kept.
- Stripped before parsing: trailing US ZIP (+4), Canadian postal code, ", USA" / ", US" / ", Canada".
- Miles: `1,234`, `450.5` (rounds), `450 mi`, `450 miles`, a JSON number. Junk or empty → "loaded miles are required".
- Callers: `dispatcher_post_load` and `dispatcher_update_load` — editing an old bad post now has to fix its lane.
  Not touched: booking multi-stop locations, carrier-side reads.

Checks
- Staging 15 Oct: helper on 15 inputs (Dallas,TX / Dallas, TX 75201 / NEW YORK NY → New York, NY / Montréal, QC /
  Coeur d'Alene, ID ok; austin / tx / Dallas, Texas / Dallas, XX / 123, TX null). `disp_post_normalise` on the newest
  staging dispatcher post's carrier: ok lane + "240.6 mi" → 241; austin/tx refused; empty, 9000 and "abc" miles refused;
  "1,234" → 1234.
- Prod 15 Oct: pre-apply md5 53c60175… = staging; post-apply normalise 57d91956…, disp_city_st b3bb1a4b… = staging;
  ACL `{postgres=X/postgres}` both; anon SECURITY DEFINER surface 36 (prod) / 35 (staging), names unchanged.
- Revert: re-apply `disp_post_normalise` from 0549 (two anchors reversed); the helper can stay.
