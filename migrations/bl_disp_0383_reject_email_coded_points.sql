-- bl_disp_0383 — the rejection e-mail lists the CODED points, not just the free-text note.
--
-- Until now app_private.disp_reject_email rendered only the staff note typed in the CC reject box.
-- bl_disp_0378 added dispatcher_profiles.reject_reasons (text[]), and the CC calls
-- cc_dispatcher_set_reject_reasons BEFORE cc_dispatcher_decide('reject'), so by the time the e-mail
-- is built the codes are already on the row. This lists them under the note.
--
-- Additive and reversible: if reject_reasons is null/empty the e-mail is byte-identical to today's.
-- The note stays the lead paragraph — the coded points are a secondary "What was missing" block.
-- Wording is rejection-phrased (a statement), NOT the disp_gap_text wording, which is written as a
-- request for the re-apply invitation ("please tell us…") and would read wrong in a rejection.

create or replace function app_private.disp_reject_point(p_code text)
returns text
language sql
immutable
as $function$
  select case p_code
    when 'no_own_board'     then 'How you find and book loads yourself. Any route counts — a load board login (your own, or your employer''s or carrier''s), Facebook or WhatsApp freight groups, brokers you already work with, or direct shippers — but we could not see one on your application.'
    when 'board_unknown'    then 'How you find and book loads yourself — your application did not make this clear.'
    when 'no_booking_proof' then 'Two loads you booked yourself, with the lane, the broker, the month and the rate.'
    when 'experience'       then 'At least a year of US dispatch experience.'
    when 'english'          then 'English at a professional or fluent level — the next stage is a spoken role-play with a broker.'
    when 'availability'     then '40+ hours a week, with overlap with US business hours.'
    when 'no_cv'            then 'A CV we can open and read.'
    when 'no_id'            then 'A government photo ID. Every LoadBoot dispatcher is verified before a carrier''s account is handed over.'
    when 'inconsistent'     then 'A consistent set of answers — parts of your application contradicted each other.'
    else null end;
$function$;

comment on function app_private.disp_reject_point(text) is
  'bl_disp_0383 — rejection-phrased label for a reject_reasons code. Returns null for codes with no '
  'standalone wording (''other'' is covered by the staff note itself).';

revoke all on function app_private.disp_reject_point(text) from public, anon;

create or replace function app_private.disp_reject_email(p_user uuid, p_note text)
returns void
language plpgsql
security definer
set search_path to 'app_private', 'public'
as $function$
declare
  v_mail text; v_name text; v_reason text; v_html text; v_text text;
  v_codes text[]; v_items text := ''; v_plain text := ''; c text; t text; v_block text := ''; v_blockp text := '';
begin
  select u.email into v_mail from auth.users u where u.id = p_user;
  if v_mail is null then return; end if;
  select full_name, reject_reasons into v_name, v_codes
    from app_private.dispatcher_profiles where user_id = p_user;
  v_reason := coalesce(nullif(btrim(coalesce(p_note,'')), ''),
    'After reviewing your application against the requirements of our current dispatcher openings, we will not be taking it forward at this stage.');
  v_reason := replace(replace(replace(v_reason, '&', '&amp;'), '<', '&lt;'), '>', '&gt;');
  v_reason := replace(v_reason, E'\n', '<br>');

  foreach c in array coalesce(v_codes, '{}'::text[]) loop
    t := app_private.disp_reject_point(c);
    if t is not null then
      v_items := v_items || '<tr><td style="padding:0 0 10px 0;vertical-align:top;width:22px;color:#FC5305;font-weight:800">&#9656;</td>'
                         || '<td style="padding:0 0 10px 0;color:#334155">' || t || '</td></tr>';
      v_plain := v_plain || '  - ' || t || E'\n';
    end if;
  end loop;
  if v_items <> '' then
    v_block := '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;margin:0 0 16px"><tr><td style="padding:14px 16px">'
            || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:8px">What we were looking for</div>'
            || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' || v_items || '</table>'
            || '</td></tr></table>';
    v_blockp := E'\n\nWhat we were looking for:\n' || rtrim(v_plain, E'\n');
  end if;

  v_html :=
    '<div style="font-family:Inter,Segoe UI,Arial,sans-serif;color:#0f172a;font-size:15px;line-height:1.65">'
    || '<div style="font-size:11px;letter-spacing:.16em;font-weight:700;color:#0883F7;text-transform:uppercase;margin-bottom:6px">LoadBoot Dispatch &middot; Recruiting</div>'
    || '<div style="font-size:22px;font-weight:800;color:#10223B;letter-spacing:-.01em;margin:0 0 14px">Your dispatcher application</div>'
    || '<p style="margin:0 0 12px">Dear ' || coalesce(nullif(v_name,''), 'Applicant') || ',</p>'
    || '<p style="margin:0 0 14px">Thank you for applying to dispatch with LoadBoot, and for the time you put into your application.</p>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid #FC5305;background:#fff8f2;border-radius:0 10px 10px 0;margin:0 0 16px">'
    || '<tr><td style="padding:12px 16px">' || v_reason || '</td></tr></table>'
    || v_block
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e9f0;border-radius:12px;margin:0 0 16px">'
    || '<tr><td style="padding:14px 16px">'
    || '<div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:6px">What this means</div>'
    || '<div style="color:#334155">Your LoadBoot account remains open and nothing has been deleted. You can update your profile at any time, and you are welcome to apply again once your experience has moved on. Applications are reviewed on their own merits each time.</div>'
    || '</td></tr></table>'
    || '<p style="margin:0 0 18px"><a href="https://loadboot.com/careers" style="display:inline-block;background:#10223B;color:#ffffff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 20px;border-radius:8px">View current openings</a></p>'
    || '<p style="margin:0 0 4px">We wish you every success.</p>'
    || '<p style="margin:0 0 16px"><b>LoadBoot Dispatch</b><br><span style="color:#64748b">Recruiting</span></p>'
    || '<p style="color:#8ea2c3;font-size:12px;margin:0">You are receiving this because you submitted a dispatcher application at loadboot.com. No further action is required.</p>'
    || '</div>';

  v_text := 'Dear ' || coalesce(nullif(v_name,''), 'Applicant') || E',\n\nThank you for applying to dispatch with LoadBoot.\n\n'
    || coalesce(nullif(btrim(coalesce(p_note,'')), ''), 'After reviewing your application against the requirements of our current dispatcher openings, we will not be taking it forward at this stage.')
    || v_blockp
    || E'\n\nYour LoadBoot account remains open and nothing has been deleted. You can update your profile at any time and apply again once your experience has moved on.\n\nCurrent openings: https://loadboot.com/careers\n\nWe wish you every success.\nLoadBoot Dispatch - Recruiting';

  perform app_private.sys_email(v_mail, 'dispatcher.status.rejected',
    'Your LoadBoot dispatcher application', v_html, v_text,
    'disp.reject:' || p_user::text || ':' || extract(epoch from now())::bigint::text);
end $function$;
