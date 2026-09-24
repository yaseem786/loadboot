-- bl_inv_0414_notify_premium.sql — premium investor notifications (in-app + e-mail + phone push)
--  * every CC action on an investor's money reaches the investor three ways:
--      in-app (inv_notifications, now with structured `data`), e-mail in the investor's language
--      (Roman Urdu / Urdu / English), and a phone push that works with the app closed
--  * new events: staff-recorded payment, agreement signed by both sides, receipt added later,
--    file added to a request, expense reversed
--  * e-mail has the amount, a balance strip (given / spent / left) and a button to the exact item
--    (https://loadboot.com/app/investor/#n/<notification id>) — files open only after login
--  * expense e-mails are debounced (90 s): 5 expenses logged together = 1 e-mail with the list
--  * per-investor e-mail preference: all | important | off  (push is controlled on the device)
--  * push: app_private.push_outbox → edge fn push-worker (Web Push + APNs), kicked instantly by
--    pg_net and swept every minute by pg_cron. No device registered = nothing queued.
-- Additive. Old e-mail template (inv_email_html) kept as the fallback. Staging first, then prod.

-- ---------------------------------------------------------------- 1. columns & tables
alter table app_private.inv_notifications add column if not exists data jsonb;
alter table app_private.inv_investors add column if not exists notify_email text not null default 'all';
do $$ begin
  alter table app_private.inv_investors add constraint inv_investors_notify_email_chk check (notify_email in ('all','important','off'));
exception when duplicate_object then null; end $$;

create table if not exists app_private.inv_email_batch (
  id bigserial primary key, investor_id uuid not null, agreement_id uuid, notif_id uuid not null,
  created_at timestamptz not null default now(), sent_at timestamptz);
create index if not exists inv_email_batch_open on app_private.inv_email_batch (investor_id) where sent_at is null;

create table if not exists app_private.push_outbox (
  id bigserial primary key, user_id uuid not null, title text not null, body text, url text, tag text,
  created_at timestamptz not null default now(), sent_at timestamptz, attempts int not null default 0,
  last_try_at timestamptz, result jsonb);
create index if not exists push_outbox_open on app_private.push_outbox (id) where sent_at is null;

create table if not exists app_private.push_worker_config (
  id int primary key default 1 check (id = 1), fn_url text not null, secret text not null);
insert into app_private.push_worker_config (id, fn_url, secret)
select 1, fn_base || '/functions/v1/push-worker', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
from app_private.dmail_config where id = 1
on conflict (id) do nothing;
revoke all on app_private.push_worker_config from public, anon, authenticated;

-- ---------------------------------------------------------------- 2. small helpers
create or replace function app_private.inv_h(p text) returns text language sql immutable as
$$ select replace(replace(replace(coalesce(p,''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') $$;

-- money with lakh grouping for PKR (1,00,000.35), plain grouping otherwise
create or replace function app_private.inv_money(p_cur text, p_amt numeric) returns text language plpgsql immutable as $$
declare a numeric := abs(coalesce(p_amt, 0)); i text; h text; r text; fr numeric;
begin
  i := trunc(a)::bigint::text; fr := round(a - trunc(a), 2);
  if coalesce(p_cur, 'PKR') in ('PKR', 'INR') and length(i) > 3 then
    r := right(i, 3); h := left(i, length(i) - 3);
    while length(h) > 2 loop r := right(h, 2) || ',' || r; h := left(h, length(h) - 2); end loop;
    r := h || ',' || r;
  else r := to_char(trunc(a)::bigint, 'FM999,999,999,999,990'); end if;
  if fr > 0 then r := r || substr(to_char(fr, 'FM0.00'), 2); end if;
  return case when coalesce(p_amt, 0) < 0 then '−' else '' end || coalesce(p_cur, 'PKR') || ' ' || r;
end $$;

-- "24 Sep 2026, 6:56 PM PKT" when a time is known, else "24 Sep 2026"
create or replace function app_private.inv_when(p_day date, p_at timestamptz) returns text language sql immutable as $$
  select case when p_at is not null then to_char(p_at at time zone 'Asia/Karachi', 'FMDD Mon YYYY, FMHH12:MI AM') || ' PKT'
              when p_day is not null then to_char(p_day, 'FMDD Mon YYYY') end $$;

create or replace function app_private.inv_kv(p_k text, p_v text) returns jsonb language sql immutable as
$$ select case when nullif(trim(coalesce(p_v, '')), '') is null then null else jsonb_build_object('k', p_k, 'v', p_v) end $$;

create or replace function app_private.inv_rows(variadic p jsonb[]) returns jsonb language sql immutable as
$$ select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(p) x where x is not null $$;

-- ---------------------------------------------------------------- 3. dictionary (en / ur_roman / ur)
create or replace function app_private.inv_tx(p_lang text, p_key text, variadic p_args text[] default '{}'::text[])
returns text language plpgsql immutable as $$
declare d jsonb := $j${
 "pill_exp":{"en":"New expense","ur_roman":"Naya kharcha","ur":"نیا خرچ"},
 "h_exp":{"en":"An expense was paid from your money","ur_roman":"Aap ke paise se kharcha hua","ur":"آپ کے پیسے سے خرچ ہوا"},
 "i_exp":{"en":"LoadBoot recorded this expense from the money you invested.","ur_roman":"LoadBoot ne aap ke diye hue paise se ye kharcha darj kiya hai.","ur":"لوڈ بوٹ نے آپ کے دیے ہوئے پیسے سے یہ خرچ درج کیا ہے۔"},
 "i_exp_proof":{"en":"The receipt is attached.","ur_roman":"Raseed saath lagi hai.","ur":"رسید ساتھ لگی ہے۔"},
 "i_exp_noproof":{"en":"The receipt is not attached yet — you will be told when it is.","ur_roman":"Raseed abhi nahi lagi — lagte hi aap ko bataya jayega.","ur":"رسید ابھی نہیں لگی — لگتے ہی آپ کو بتایا جائے گا۔"},
 "s_exp":{"en":"Expense recorded: {1} — {2}","ur_roman":"Kharcha darj: {1} — {2}","ur":"خرچ درج: {1} — {2}"},
 "k_for":{"en":"What for","ur_roman":"Kis cheez par","ur":"کس چیز پر"},
 "k_paid_to":{"en":"Paid to","ur_roman":"Kis ko diya","ur":"کس کو دیا"},
 "k_cat":{"en":"Category","ur_roman":"Qism","ur":"قسم"},
 "k_when":{"en":"When (Pakistan time)","ur_roman":"Kab (Pakistan waqt)","ur":"کب (پاکستان وقت)"},
 "st_given":{"en":"You invested","ur_roman":"Aap ne diya","ur":"آپ نے دیا"},
 "st_spent":{"en":"Spent","ur_roman":"Kharch hua","ur":"خرچ ہوا"},
 "st_left":{"en":"Left","ur_roman":"Baqi","ur":"باقی"},
 "cta_receipt":{"en":"⬇ Download receipt","ur_roman":"⬇ Raseed download","ur":"⬇ رسید ڈاؤن لوڈ"},
 "cta_open":{"en":"Open in the portal","ur_roman":"Portal mein dekhein","ur":"پورٹل میں دیکھیں"},
 "f_record":{"en":"This is a record notice — you don't need to do anything. Questions? Tap \"Ask a question\" in the portal.","ur_roman":"Ye record ki itla hai — aap ko kuch karna zaroori nahi. Koi sawal ho to portal mein \"Sawal poochein\" dabayein.","ur":"یہ ریکارڈ کی اطلاع ہے — آپ کو کچھ کرنا ضروری نہیں۔ کوئی سوال ہو تو پورٹل میں \"سوال پوچھیں\" دبائیں۔"},
 "f_money":{"en":"Always check the request in the portal before sending money. LoadBoot never sends a new bank account by e-mail or WhatsApp.","ur_roman":"Paisa bhejne se pehle portal mein darkhwast zaroor dekhein. LoadBoot kabhi email ya WhatsApp par naya bank account nahi bhejta.","ur":"پیسہ بھیجنے سے پہلے پورٹل میں درخواست ضرور دیکھیں۔ لوڈ بوٹ کبھی ای میل یا واٹس ایپ پر نیا بینک اکاؤنٹ نہیں بھیجتا۔"},
 "f_secure":{"en":"Files open only after you sign in, so this e-mail is safe even if someone else sees it.","ur_roman":"Files sirf login ke baad khulti hain — ye email kisi aur ke haath lag bhi jaye to file nahi khulegi.","ur":"فائلیں صرف لاگ ان کے بعد کھلتی ہیں — یہ ای میل کسی اور کے ہاتھ لگ بھی جائے تو فائل نہیں کھلے گی۔"},
 "pill_batch":{"en":"New expenses","ur_roman":"Naye kharche","ur":"نئے اخراجات"},
 "h_batch":{"en":"{1} new expenses recorded","ur_roman":"{1} naye kharche darj hue","ur":"{1} نئے اخراجات درج ہوئے"},
 "i_batch":{"en":"LoadBoot recorded these expenses from your money:","ur_roman":"LoadBoot ne aap ke paise se ye kharche darj kiye hain:","ur":"لوڈ بوٹ نے آپ کے پیسے سے یہ اخراجات درج کیے ہیں:"},
 "s_batch":{"en":"{1} expenses recorded — {2}","ur_roman":"{1} kharche darj — kul {2}","ur":"{1} اخراجات درج — کل {2}"},
 "k_total":{"en":"Total","ur_roman":"Kul","ur":"کل"},
 "cta_all":{"en":"See all expenses","ur_roman":"Sab kharche dekhein","ur":"سب اخراجات دیکھیں"},
 "pill_proof":{"en":"Receipt added","ur_roman":"Raseed lag gayi","ur":"رسید لگ گئی"},
 "h_proof":{"en":"Receipt added: {1}","ur_roman":"Raseed lag gayi: {1}","ur":"رسید لگ گئی: {1}"},
 "i_proof":{"en":"The receipt that was missing for this expense is now attached.","ur_roman":"Jis kharche ki raseed baqi thi, ab lag gayi hai.","ur":"جس خرچ کی رسید باقی تھی، اب لگ گئی ہے۔"},
 "pill_rev":{"en":"Correction","ur_roman":"Durusti","ur":"درستی"},
 "h_rev":{"en":"An expense was reversed","ur_roman":"Kharcha wapas liya gaya","ur":"خرچ واپس لیا گیا"},
 "i_rev":{"en":"This expense was recorded by mistake and has been reversed. The amount is back in your remaining money.","ur_roman":"Ye kharcha galti se darj hua tha, is liye wapas le liya gaya. Raqam aap ke baqi paise mein wapas jud gayi hai.","ur":"یہ خرچ غلطی سے درج ہوا تھا، اس لیے واپس لے لیا گیا۔ رقم آپ کے باقی پیسے میں واپس جڑ گئی ہے۔"},
 "pill_req":{"en":"Your answer needed","ur_roman":"Aap ka jawab chahiye","ur":"آپ کا جواب چاہیے"},
 "h_req":{"en":"LoadBoot needs money","ur_roman":"LoadBoot ko paise chahiye","ur":"لوڈ بوٹ کو پیسے چاہییں"},
 "s_req":{"en":"Request for {1} — {2}","ur_roman":"Aap se {1} ki darkhwast — {2}","ur":"آپ سے {1} کی درخواست — {2}"},
 "k_why":{"en":"For","ur_roman":"Kis liye","ur":"کس لیے"},
 "k_asked":{"en":"Asked on","ur_roman":"Maanga gaya","ur":"مانگا گیا"},
 "k_needed":{"en":"Needed by","ur_roman":"Kab tak chahiye","ur":"کب تک چاہیے"},
 "k_cash":{"en":"LoadBoot holds now","ur_roman":"Abhi LoadBoot ke paas","ur":"ابھی لوڈ بوٹ کے پاس"},
 "k_files":{"en":"Proof","ur_roman":"Saboot","ur":"ثبوت"},
 "v_files":{"en":"📎 {1} file(s)","ur_roman":"📎 {1} file","ur":"📎 {1} فائل"},
 "cta_req":{"en":"See the request and reply","ur_roman":"Darkhwast dekhein aur jawab dein","ur":"درخواست دیکھیں اور جواب دیں"},
 "pill_rfile":{"en":"New file","ur_roman":"Nayi file","ur":"نئی فائل"},
 "h_rfile":{"en":"Proof added to request #{1}","ur_roman":"Darkhwast #{1} mein saboot laga","ur":"درخواست #{1} میں ثبوت لگا"},
 "i_rfile":{"en":"LoadBoot attached a file to the request: {1}","ur_roman":"LoadBoot ne darkhwast ke saath file lagayi hai: {1}","ur":"لوڈ بوٹ نے درخواست کے ساتھ فائل لگائی ہے: {1}"},
 "cta_rfile":{"en":"See the file","ur_roman":"File dekhein","ur":"فائل دیکھیں"},
 "pill_rc":{"en":"Money received","ur_roman":"Paisa mil gaya","ur":"پیسہ مل گیا"},
 "h_rc":{"en":"Thank you — your payment arrived","ur_roman":"Shukriya — aap ki payment pahunch gayi","ur":"شکریہ — آپ کی ادائیگی پہنچ گئی"},
 "i_rc":{"en":"LoadBoot confirmed the money you sent in its account. It now counts toward your funded amount.","ur_roman":"LoadBoot ne aap ki bheji hui raqam apne account mein confirm kar di hai. Ye aap ke funded amount mein shamil ho gayi.","ur":"لوڈ بوٹ نے آپ کی بھیجی ہوئی رقم اپنے اکاؤنٹ میں کنفرم کر دی ہے۔ یہ آپ کی فنڈڈ رقم میں شامل ہو گئی۔"},
 "s_rc":{"en":"Your payment of {1} is confirmed","ur_roman":"Aap ki {1} ki payment confirm ho gayi","ur":"آپ کی {1} کی ادائیگی کنفرم ہو گئی"},
 "k_sent":{"en":"Sent on","ur_roman":"Kab bheja","ur":"کب بھیجا"},
 "k_from":{"en":"From","ur_roman":"Kahan se","ur":"کہاں سے"},
 "k_into":{"en":"Into","ur_roman":"Kis account mein","ur":"کس اکاؤنٹ میں"},
 "k_conf":{"en":"LoadBoot confirmed","ur_roman":"LoadBoot ne confirm kiya","ur":"لوڈ بوٹ نے کنفرم کیا"},
 "cta_rc":{"en":"⬇ Payment confirmation (PDF)","ur_roman":"⬇ Payment ki tasdeeq (PDF)","ur":"⬇ ادائیگی کی تصدیق (PDF)"},
 "pill_rj":{"en":"Attention","ur_roman":"Tawajjoh","ur":"توجہ"},
 "h_rj":{"en":"Payment not found","ur_roman":"Payment nahi mili","ur":"ادائیگی نہیں ملی"},
 "i_rj":{"en":"The payment you told us about has not reached LoadBoot's account. Reason: {1}","ur_roman":"Aap ne jo payment batayi thi wo LoadBoot ke account mein nahi mili. Wajah: {1}","ur":"آپ نے جو ادائیگی بتائی تھی وہ لوڈ بوٹ کے اکاؤنٹ میں نہیں ملی۔ وجہ: {1}"},
 "pill_doc":{"en":"New document","ur_roman":"Naya document","ur":"نئی دستاویز"},
 "h_doc":{"en":"Agreement version {1} is ready","ur_roman":"Agreement ki version {1} aa gayi","ur":"معاہدے کا ورژن {1} آ گیا"},
 "i_doc":{"en":"Read it in the portal and sign when you are ready.","ur_roman":"Portal mein parhein aur jab tayyar hon sign karein.","ur":"پورٹل میں پڑھیں اور جب تیار ہوں دستخط کریں۔"},
 "cta_doc":{"en":"Read the agreement","ur_roman":"Agreement parhein","ur":"معاہدہ پڑھیں"},
 "pill_sig":{"en":"Complete","ur_roman":"Mukammal","ur":"مکمل"},
 "h_sig":{"en":"The agreement is now final","ur_roman":"Agreement ab pakka hai","ur":"معاہدہ اب پکا ہے"},
 "i_sig":{"en":"You signed and LoadBoot countersigned. Keep your copy safe.","ur_roman":"Aap ne sign kiya aur LoadBoot ne bhi sign kar diya. Apni copy sambhal kar rakhein.","ur":"آپ نے دستخط کیے اور لوڈ بوٹ نے بھی دستخط کر دیے۔ اپنی کاپی سنبھال کر رکھیں۔"},
 "s_sig":{"en":"Agreement signed by both sides — your copy","ur_roman":"Agreement dono taraf se sign ho gaya — aap ki copy","ur":"معاہدہ دونوں طرف سے دستخط ہو گیا — آپ کی کاپی"},
 "k_doc":{"en":"Document","ur_roman":"Document","ur":"دستاویز"},
 "v_doc":{"en":"Investment Agreement v{1}","ur_roman":"Investment Agreement v{1}","ur":"سرمایہ کاری معاہدہ v{1}"},
 "k_you_sig":{"en":"Your signature","ur_roman":"Aap ka sign","ur":"آپ کے دستخط"},
 "k_lb_sig":{"en":"LoadBoot's signature","ur_roman":"LoadBoot ka sign","ur":"لوڈ بوٹ کے دستخط"},
 "cta_sig":{"en":"⬇ Signed agreement (PDF)","ur_roman":"⬇ Signed agreement (PDF)","ur":"⬇ دستخط شدہ معاہدہ (PDF)"},
 "pill_po":{"en":"Payout sent","ur_roman":"Munafa bheja","ur":"منافع بھیجا"},
 "h_po":{"en":"Your payout was sent","ur_roman":"Aap ka payout bhej diya gaya","ur":"آپ کا منافع بھیج دیا گیا"},
 "i_po":{"en":"Please confirm in the portal once it reaches you.","ur_roman":"Pahunchne par portal mein confirm kar dein.","ur":"پہنچنے پر پورٹل میں کنفرم کر دیں۔"},
 "pill_st":{"en":"Monthly statement","ur_roman":"Mahana hisaab","ur":"ماہانہ حساب"},
 "h_st":{"en":"Statement for {1}","ur_roman":"{1} ka hisaab","ur":"{1} کا حساب"},
 "i_st_profit":{"en":"Profit {1} · your payout {2}","ur_roman":"Munafa {1} · aap ka hissa {2}","ur":"منافع {1} · آپ کا حصہ {2}"},
 "i_st_none":{"en":"No profit this month — nothing is owed and nothing piles up.","ur_roman":"Is mahine munafa nahi hua — na kuch wajib hai, na kuch jama hota hai.","ur":"اس مہینے منافع نہیں ہوا — نہ کچھ واجب ہے، نہ کچھ جمع ہوتا ہے۔"},
 "h_cr":{"en":"Money being returned","ur_roman":"Paisa wapas ho raha hai","ur":"پیسہ واپس ہو رہا ہے"},
 "i_cr":{"en":"Unspent money is being returned to you: {1}","ur_roman":"Na-kharch shuda paisa aap ko wapas kiya ja raha hai: {1}","ur":"غیر خرچ شدہ پیسہ آپ کو واپس کیا جا رہا ہے: {1}"},
 "pill_am":{"en":"Decision","ur_roman":"Faisla","ur":"فیصلہ"},
 "h_am_accepted":{"en":"Your proposal was accepted","ur_roman":"Aap ki tajweez qabool ho gayi","ur":"آپ کی تجویز قبول ہو گئی"},
 "h_am_declined":{"en":"Your proposal was declined","ur_roman":"Aap ki tajweez qabool nahi hui","ur":"آپ کی تجویز قبول نہیں ہوئی"},
 "pill_fl":{"en":"Answered","ur_roman":"Jawab aa gaya","ur":"جواب آ گیا"},
 "h_fl":{"en":"Your question was answered","ur_roman":"Aap ke sawal ka jawab aa gaya","ur":"آپ کے سوال کا جواب آ گیا"},
 "pill_up":{"en":"LoadBoot update","ur_roman":"LoadBoot update","ur":"لوڈ بوٹ اپ ڈیٹ"}
}$j$::jsonb; s text; i int;
begin
  s := coalesce(d -> p_key ->> coalesce(nullif(p_lang, ''), 'en'), d -> p_key ->> 'en', p_key);
  for i in 1 .. coalesce(array_length(p_args, 1), 0) loop s := replace(s, '{' || i || '}', coalesce(p_args[i], '')); end loop;
  return s;
end $$;

-- ---------------------------------------------------------------- 4. premium e-mail shell
create or replace function app_private.inv_email_v2(p_lang text, p_pill text, p_tone text, p_title text, p_intro text, p_big text,
  p_rows jsonb, p_strip jsonb, p_c1l text, p_c1u text, p_c2l text, p_c2u text, p_foot text)
returns text language plpgsql immutable as $$
declare rtl boolean := p_lang = 'ur'; st text; en text; dir text; v_rows text := ''; r jsonb; pb text; pf text; c1 text;
begin
  st := case when rtl then 'right' else 'left' end; en := case when rtl then 'left' else 'right' end; dir := case when rtl then 'rtl' else 'ltr' end;
  select b, f into pb, pf from (values ('exp','#FFF1EA','#C2410C'),('req','#E8F2FF','#0666C4'),('in','#E7F8EE','#15803D'),('doc','#F3ECFF','#7C3AED'),('warn','#FFF8E6','#8A6100'),('info','#EEF2F7','#334155')) t(k,b,f) where k = coalesce(p_tone,'info');
  c1 := case when p_tone = 'doc' then '#FC5305' else '#0883F7' end;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    v_rows := v_rows || '<tr><td style="padding:10px 0;border-top:1px solid #EDF1F6;font-size:13px;color:#6B7A90;text-align:' || st || ';width:44%">' || app_private.inv_h(r->>'k')
      || '</td><td style="padding:10px 0;border-top:1px solid #EDF1F6;font-size:14px;font-weight:700;color:#10223B;text-align:' || en || '">' || app_private.inv_h(r->>'v') || '</td></tr>';
  end loop;
  return '<!doctype html><html dir="' || dir || '"><body style="margin:0;background:#EEF2F7;font-family:Arial,Helvetica,sans-serif">'
    || '<div style="display:none;max-height:0;overflow:hidden">' || app_private.inv_h(coalesce(p_big || ' · ', '') || p_title) || '</div>'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#EEF2F7;padding:26px 12px" dir="' || dir || '"><tr><td align="center">'
    || '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #DDE4EE">'
    || '<tr><td style="background:#10223B;padding:20px 26px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
    || '<td style="text-align:' || st || '"><a href="https://loadboot.com" style="text-decoration:none"><img src="https://loadboot.com/email-logo-white-2x.png" width="124" height="30" alt="LoadBoot" style="display:inline-block;border:0"></a></td>'
    || '<td style="text-align:' || en || ';font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#9FB3CF">Investor Portal</td></tr></table></td></tr>'
    || '<tr><td style="height:3px;background:#FC5305;line-height:3px;font-size:0">&nbsp;</td></tr>'
    || '<tr><td style="padding:26px 26px 6px;text-align:' || st || '">'
    || '<span style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:5px 11px;border-radius:99px;background:' || pb || ';color:' || pf || '">' || app_private.inv_h(p_pill) || '</span>'
    || '<h1 style="margin:12px 0 6px;font-size:21px;line-height:1.3;color:#10223B">' || app_private.inv_h(p_title) || '</h1>'
    || '<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4B5B73">' || app_private.inv_h(p_intro) || '</p>'
    || case when p_big is not null then '<div style="font-size:32px;font-weight:800;color:#10223B;margin:0 0 14px;letter-spacing:-.01em">' || app_private.inv_h(p_big) || '</div>' else '' end
    || case when v_rows <> '' then '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px">' || v_rows || '</table>' else '' end
    || case when p_strip is not null then
         '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F8FC;border:1px solid #E3EAF3;border-radius:12px;margin:0 0 18px"><tr>'
         || '<td style="padding:11px 12px;text-align:' || st || '"><div style="font-size:10px;color:#6B7A90;text-transform:uppercase;letter-spacing:.05em">' || app_private.inv_h(p_strip->>'l1') || '</div><div style="font-size:14px;font-weight:700;color:#10223B">' || app_private.inv_h(p_strip->>'v1') || '</div></td>'
         || '<td style="padding:11px 12px;border-left:1px solid #E3EAF3;border-right:1px solid #E3EAF3;text-align:' || st || '"><div style="font-size:10px;color:#6B7A90;text-transform:uppercase;letter-spacing:.05em">' || app_private.inv_h(p_strip->>'l2') || '</div><div style="font-size:14px;font-weight:700;color:#10223B">' || app_private.inv_h(p_strip->>'v2') || '</div></td>'
         || '<td style="padding:11px 12px;text-align:' || st || '"><div style="font-size:10px;color:#6B7A90;text-transform:uppercase;letter-spacing:.05em">' || app_private.inv_h(p_strip->>'l3') || '</div><div style="font-size:14px;font-weight:700;color:#15803D">' || app_private.inv_h(p_strip->>'v3') || '</div></td>'
         || '</tr></table>' else '' end
    || '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px"><tr>'
    || case when p_c1u is not null then '<td style="padding:0 0 6px"><a href="' || p_c1u || '" style="display:inline-block;background:' || c1 || ';color:#fff;text-decoration:none;font-weight:700;padding:13px 20px;border-radius:10px;font-size:14px">' || app_private.inv_h(p_c1l) || '</a></td>' else '' end
    || case when p_c2l is not null and p_c2u is not null then '<td style="padding:0 8px 6px"><a href="' || p_c2u || '" style="display:inline-block;background:#fff;color:#10223B;text-decoration:none;font-weight:700;padding:11px 16px;border-radius:10px;font-size:14px;border:1.5px solid #CFD9E6">' || app_private.inv_h(p_c2l) || '</a></td>' else '' end
    || '</tr></table></td></tr>'
    || '<tr><td style="background:#F5F8FC;padding:15px 26px;font-size:12px;line-height:1.6;color:#7B8AA0;border-top:1px solid #E3EAF3;text-align:' || st || '">' || app_private.inv_h(p_foot)
    || '<br>LoadBoot LLC · <a href="https://loadboot.com" style="color:#0883F7;text-decoration:none">loadboot.com</a></td></tr>'
    || '</table></td></tr></table></body></html>';
end $$;

-- ---------------------------------------------------------------- 5. compose one notice (subject / html / text / push)
create or replace function app_private.inv_compose(p_lang text, p_ev text, d jsonb, p_agreement uuid, p_url text)
returns jsonb language plpgsql security definer set search_path = app_private, public as $$
declare L text := p_lang; cur text := coalesce(d->>'cur', 'PKR'); amt text; pos jsonb; strip jsonb;
  pill text; tone text := 'info'; h text; i text; subj text; rows jsonb := '[]'; big text;
  c1l text; c1u text := p_url; c2l text; c2u text := p_url; foot text; imp boolean := true; pt text; pb text;
  what text; proof boolean; n int; tot numeric := 0; x record; txt text;
begin
  amt := case when d ? 'amount' then app_private.inv_money(cur, (d->>'amount')::numeric) end;
  foot := app_private.inv_tx(L, 'f_record');
  pos := case when p_agreement is not null then app_private.inv_position(p_agreement) end;
  strip := case when pos is not null then jsonb_build_object(
    'l1', app_private.inv_tx(L,'st_given'), 'v1', app_private.inv_money(cur, (pos->>'funded')::numeric),
    'l2', app_private.inv_tx(L,'st_spent'), 'v2', app_private.inv_money(cur, (pos->>'spent')::numeric),
    'l3', app_private.inv_tx(L,'st_left'),  'v3', app_private.inv_money(cur, (pos->>'fund_cash')::numeric)) end;
  c1l := app_private.inv_tx(L, 'cta_open');

  if p_ev = 'expense.new' then
    proof := coalesce((select receipt_url is not null from inv_expenses where id::text = d->>'id'), (d->>'proof')::boolean, false);
    what := coalesce(nullif(d->>'description', ''), nullif(d->>'vendor', ''), initcap(d->>'category'));
    imp := false; tone := 'exp'; pill := app_private.inv_tx(L,'pill_exp'); h := app_private.inv_tx(L,'h_exp');
    i := app_private.inv_tx(L,'i_exp') || ' ' || app_private.inv_tx(L, case when proof then 'i_exp_proof' else 'i_exp_noproof' end);
    big := amt; subj := app_private.inv_tx(L,'s_exp', amt, what);
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_for'), what), app_private.inv_kv(app_private.inv_tx(L,'k_paid_to'), d->>'vendor'),
      app_private.inv_kv(app_private.inv_tx(L,'k_cat'), initcap(d->>'category')), app_private.inv_kv(app_private.inv_tx(L,'k_when'), app_private.inv_when((d->>'date')::date, (d->>'at')::timestamptz)));
    if proof then c1l := app_private.inv_tx(L,'cta_receipt'); c2l := app_private.inv_tx(L,'cta_open'); end if;
    pt := pill || ' · ' || amt; pb := what || coalesce(' — ' || nullif(d->>'vendor', ''), '');
  elsif p_ev = 'expense.batch' then
    imp := false; tone := 'exp'; n := 0;
    for x in select nn.data from inv_notifications nn where nn.id::text in (select jsonb_array_elements_text(d->'nids')) order by nn.created_at loop
      n := n + 1; tot := tot + coalesce((x.data->>'amount')::numeric, 0); cur := coalesce(x.data->>'cur', cur);
      rows := rows || jsonb_build_array(jsonb_build_object('k', coalesce(nullif(x.data->>'description',''), x.data->>'vendor', initcap(x.data->>'category')) || coalesce(' · ' || nullif(x.data->>'vendor',''), ''),
                                                           'v', app_private.inv_money(cur, (x.data->>'amount')::numeric)));
    end loop;
    rows := rows || jsonb_build_array(jsonb_build_object('k', app_private.inv_tx(L,'k_total'), 'v', app_private.inv_money(cur, tot)));
    pill := app_private.inv_tx(L,'pill_batch'); h := app_private.inv_tx(L,'h_batch', n::text); i := app_private.inv_tx(L,'i_batch');
    big := app_private.inv_money(cur, tot); subj := app_private.inv_tx(L,'s_batch', n::text, big); c1l := app_private.inv_tx(L,'cta_all');
    pt := h; pb := big;
  elsif p_ev = 'expense.proof' then
    what := coalesce(nullif(d->>'description', ''), nullif(d->>'vendor', ''), initcap(d->>'category'));
    imp := false; tone := 'exp'; pill := app_private.inv_tx(L,'pill_proof'); h := app_private.inv_tx(L,'h_proof', what); i := app_private.inv_tx(L,'i_proof');
    big := amt; subj := h; c1l := app_private.inv_tx(L,'cta_receipt'); strip := null;
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_paid_to'), d->>'vendor'), app_private.inv_kv(app_private.inv_tx(L,'k_when'), app_private.inv_when((d->>'date')::date, (d->>'at')::timestamptz)));
    pt := pill || ' · ' || amt; pb := what;
  elsif p_ev = 'expense.reversal' then
    tone := 'warn'; pill := app_private.inv_tx(L,'pill_rev'); h := app_private.inv_tx(L,'h_rev'); i := app_private.inv_tx(L,'i_rev');
    big := amt; subj := h || ' — ' || amt;
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_paid_to'), d->>'vendor'));
    pt := h; pb := amt || coalesce(' · ' || nullif(d->>'vendor',''), '');
  elsif p_ev = 'request.new' then
    tone := 'req'; pill := app_private.inv_tx(L,'pill_req'); h := app_private.inv_tx(L,'h_req'); i := coalesce(nullif(d->>'reason', ''), h);
    big := amt; subj := app_private.inv_tx(L,'s_req', amt, left(coalesce(d->>'reason', ''), 60)); strip := null;
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_why'), d->>'reason'),
      app_private.inv_kv(app_private.inv_tx(L,'k_asked'), app_private.inv_when(null, (d->>'at')::timestamptz)),
      app_private.inv_kv(app_private.inv_tx(L,'k_needed'), app_private.inv_when((d->>'needed_by')::date, null)),
      app_private.inv_kv(app_private.inv_tx(L,'k_cash'), case when pos is not null then app_private.inv_money(cur, (pos->>'fund_cash')::numeric) end),
      app_private.inv_kv(app_private.inv_tx(L,'k_files'), case when coalesce((d->>'files')::int, 0) > 0 then app_private.inv_tx(L,'v_files', d->>'files') end));
    c1l := app_private.inv_tx(L,'cta_req'); foot := app_private.inv_tx(L,'f_money');
    pt := app_private.inv_tx(L,'h_req') || ' · ' || amt; pb := coalesce(d->>'reason', '');
  elsif p_ev = 'request.file' then
    tone := 'req'; pill := app_private.inv_tx(L,'pill_rfile'); h := app_private.inv_tx(L,'h_rfile', d->>'seq'); i := app_private.inv_tx(L,'i_rfile', coalesce(d->>'reason', ''));
    big := amt; subj := h; strip := null; c1l := app_private.inv_tx(L,'cta_rfile');
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_files'), app_private.inv_tx(L,'v_files', d->>'files')));
    pt := h; pb := coalesce(d->>'reason', '') || coalesce(' · ' || amt, '');
  elsif p_ev = 'receipt.confirmed' then
    tone := 'in'; pill := app_private.inv_tx(L,'pill_rc'); h := app_private.inv_tx(L,'h_rc'); i := app_private.inv_tx(L,'i_rc');
    big := amt; subj := app_private.inv_tx(L,'s_rc', amt);
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_sent'), app_private.inv_when((d->>'date')::date, (d->>'at')::timestamptz)),
      app_private.inv_kv(app_private.inv_tx(L,'k_from'), d->>'from'), app_private.inv_kv(app_private.inv_tx(L,'k_into'), d->>'into'),
      app_private.inv_kv(app_private.inv_tx(L,'k_conf'), app_private.inv_when(null, (d->>'confirmed_at')::timestamptz)));
    c1l := app_private.inv_tx(L,'cta_rc'); c2l := app_private.inv_tx(L,'cta_open');
    pt := pill || ' · ' || amt; pb := h;
  elsif p_ev = 'receipt.rejected' then
    tone := 'warn'; pill := app_private.inv_tx(L,'pill_rj'); h := app_private.inv_tx(L,'h_rj'); i := app_private.inv_tx(L,'i_rj', coalesce(d->>'reason', '—'));
    big := amt; subj := h || coalesce(' — ' || amt, ''); strip := null; pt := h; pb := coalesce(d->>'reason', '');
  elsif p_ev = 'document.published' then
    tone := 'doc'; pill := app_private.inv_tx(L,'pill_doc'); h := app_private.inv_tx(L,'h_doc', d->>'version'); i := app_private.inv_tx(L,'i_doc');
    subj := h; strip := null; c1l := app_private.inv_tx(L,'cta_doc'); pt := h; pb := i;
  elsif p_ev = 'document.signed' then
    tone := 'doc'; pill := app_private.inv_tx(L,'pill_sig'); h := app_private.inv_tx(L,'h_sig'); i := app_private.inv_tx(L,'i_sig');
    subj := app_private.inv_tx(L,'s_sig'); strip := null; c1l := app_private.inv_tx(L,'cta_sig'); c2l := app_private.inv_tx(L,'cta_open');
    rows := app_private.inv_rows(app_private.inv_kv(app_private.inv_tx(L,'k_doc'), app_private.inv_tx(L,'v_doc', d->>'version')),
      app_private.inv_kv(app_private.inv_tx(L,'k_you_sig'), app_private.inv_when(null, (d->>'you_at')::timestamptz)),
      app_private.inv_kv(app_private.inv_tx(L,'k_lb_sig'), app_private.inv_when(null, (d->>'lb_at')::timestamptz)));
    pt := h; pb := i;
  elsif p_ev = 'payout.paid' then
    tone := 'in'; pill := app_private.inv_tx(L,'pill_po'); h := app_private.inv_tx(L,'h_po'); i := app_private.inv_tx(L,'i_po');
    big := amt; subj := h || coalesce(' — ' || amt, ''); pt := h; pb := coalesce(amt, '');
  elsif p_ev = 'statement' then
    tone := 'in'; pill := app_private.inv_tx(L,'pill_st'); strip := null;
    if coalesce((d->>'capital_return')::boolean, false) then
      h := app_private.inv_tx(L,'h_cr'); i := app_private.inv_tx(L,'i_cr', app_private.inv_money(cur, (d->>'total')::numeric));
    else
      h := app_private.inv_tx(L,'h_st', to_char((d->>'month')::date, 'Mon YYYY'));
      i := case when coalesce((d->>'total')::numeric, 0) > 0 then app_private.inv_tx(L,'i_st_profit', app_private.inv_money(cur, (d->>'profit')::numeric), app_private.inv_money(cur, (d->>'total')::numeric)) else app_private.inv_tx(L,'i_st_none') end;
    end if;
    subj := h; pt := h; pb := i;
  elsif p_ev = 'amendment' then
    tone := case when d->>'status' = 'accepted' then 'in' else 'warn' end; pill := app_private.inv_tx(L,'pill_am');
    h := app_private.inv_tx(L, 'h_am_' || coalesce(d->>'status', 'declined')); i := coalesce(nullif(d->>'note', ''), h); subj := h; strip := null; pt := h; pb := coalesce(d->>'note', '');
  elsif p_ev = 'flag' then
    tone := 'info'; pill := app_private.inv_tx(L,'pill_fl'); h := app_private.inv_tx(L,'h_fl'); i := coalesce(d->>'answer', ''); subj := h; strip := null; pt := h; pb := left(i, 140);
  else -- update and anything unknown: the staff-written title/body as is
    imp := p_ev <> 'update'; tone := 'info'; pill := app_private.inv_tx(L,'pill_up'); h := coalesce(d->>'title', 'LoadBoot'); i := coalesce(d->>'body', ''); subj := h; strip := null;
    rows := coalesce(d->'rows', '[]'::jsonb); pt := h; pb := left(i, 140);
  end if;

  txt := h || E'\n\n' || i || E'\n\n' || coalesce(big || E'\n', '')
    || coalesce((select string_agg((e->>'k') || ': ' || (e->>'v'), E'\n') from jsonb_array_elements(rows) e), '') || E'\n\n'
    || c1l || ': ' || p_url || E'\n\n' || foot || E'\nLoadBoot LLC · loadboot.com';
  return jsonb_build_object('subject', 'LoadBoot · ' || subj, 'important', imp, 'push_t', pt, 'push_b', pb, 'text', txt,
    'html', app_private.inv_email_v2(L, pill, tone, h, i, big, rows, strip, c1l, c1u, c2l, c2u, foot || ' ' || app_private.inv_tx(L,'f_secure')));
end $$;

-- ---------------------------------------------------------------- 6. push outbox
create or replace function app_private.push_kick() returns void language plpgsql security definer set search_path = app_private, public as $$
declare c record;
begin
  select * into c from app_private.push_worker_config where id = 1;
  if not found then return; end if;
  perform net.http_post(url := c.fn_url, headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', c.secret), body := '{}'::jsonb);
exception when others then null;
end $$;

create or replace function app_private.push_enqueue(p_user uuid, p_title text, p_body text, p_url text, p_tag text) returns void
language plpgsql security definer set search_path = app_private, public as $$
begin
  if p_user is null or not exists (select 1 from app_private.push_subscriptions where user_id = p_user) then return; end if;
  insert into app_private.push_outbox (user_id, title, body, url, tag) values (p_user, left(coalesce(p_title, 'LoadBoot'), 120), left(p_body, 300), p_url, p_tag);
  perform app_private.push_kick();
end $$;

create or replace function public.svc_push_claim(p_secret text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v jsonb;
begin
  if p_secret is null or p_secret is distinct from (select secret from app_private.push_worker_config where id = 1) then
    raise exception 'forbidden' using errcode = '42501'; end if;
  with c as (
    select id from app_private.push_outbox
    where sent_at is null and attempts < 5 and created_at > now() - interval '1 day' and (last_try_at is null or last_try_at < now() - interval '2 minutes')
    order by id limit 50 for update skip locked),
  u as (update app_private.push_outbox o set attempts = o.attempts + 1, last_try_at = now() from c where o.id = c.id
        returning o.id, o.user_id, o.title, o.body, o.url, o.tag)
  select coalesce(jsonb_agg(jsonb_build_object('id', u.id, 'title', u.title, 'body', u.body, 'url', u.url, 'tag', u.tag,
    'subs', (select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
             from app_private.push_subscriptions s where s.user_id = u.user_id))), '[]'::jsonb) into v from u;
  return v;
end $$;

create or replace function public.svc_push_done(p_secret text, p_results jsonb) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare r jsonb; n int := 0;
begin
  if p_secret is null or p_secret is distinct from (select secret from app_private.push_worker_config where id = 1) then
    raise exception 'forbidden' using errcode = '42501'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) loop
    update app_private.push_outbox set result = r,
      sent_at = case when coalesce((r->>'sent')::int, 0) > 0 or coalesce((r->>'targeted')::int, 0) = 0 then now() end
    where id = (r->>'id')::bigint;
    delete from app_private.push_subscriptions where endpoint in (select jsonb_array_elements_text(coalesce(r->'dead', '[]'::jsonb)));
    n := n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'n', n);
end $$;
revoke all on function public.svc_push_claim(text) from public, anon, authenticated;
revoke all on function public.svc_push_done(text, jsonb) from public, anon, authenticated;
grant execute on function public.svc_push_claim(text) to service_role;
grant execute on function public.svc_push_done(text, jsonb) to service_role;

-- ---------------------------------------------------------------- 7. the notifier
drop function if exists app_private.inv_notify(uuid, uuid, text, text, text, text, text, jsonb);
create or replace function app_private.inv_notify(p_investor uuid, p_agreement uuid, p_kind text, p_title text, p_body text,
  p_ref_kind text, p_ref_id text, p_rows jsonb default '[]'::jsonb, p_ev text default null, p_data jsonb default '{}'::jsonb, p_email boolean default true)
returns uuid language plpgsql security definer set search_path = app_private, public as $$
declare v_id uuid; v_email text; v_uid uuid; v_lang text; v_pref text; v_ev text := coalesce(p_ev, p_kind); c jsonb; v_url text; v_idem text;
begin
  if p_investor is null then return null; end if;
  insert into app_private.inv_notifications (investor_id, agreement_id, kind, title, body, ref_kind, ref_id, data)
  values (p_investor, p_agreement, p_kind, p_title, p_body, p_ref_kind, p_ref_id, jsonb_build_object('ev', v_ev) || coalesce(p_data, '{}'::jsonb))
  returning id into v_id;
  select email, user_id, preferred_lang, coalesce(notify_email, 'all') into v_email, v_uid, v_lang, v_pref from app_private.inv_investors where id = p_investor;
  v_lang := case when v_lang in ('ur', 'ur_roman') then v_lang else 'en' end;
  v_url := 'https://loadboot.com/app/investor/#n/' || v_id;
  v_idem := 'inv:' || v_ev || ':' || coalesce(p_ref_id, v_id::text) || ':' || p_investor;
  begin
    c := app_private.inv_compose(v_lang, v_ev, jsonb_build_object('title', p_title, 'body', p_body, 'rows', coalesce(p_rows, '[]'::jsonb)) || coalesce(p_data, '{}'::jsonb), p_agreement, v_url);
  exception when others then c := null; end;
  -- phone push: instant, every event, only if the investor turned it on on a device
  begin perform app_private.push_enqueue(v_uid, coalesce(c->>'push_t', p_title), coalesce(c->>'push_b', p_body), v_url, 'inv-' || v_ev || '-' || coalesce(p_ref_id, v_id::text));
  exception when others then null; end;
  if not coalesce(p_email, true) or v_email is null or v_pref = 'off' then return v_id; end if;
  if v_pref = 'important' and not coalesce((c->>'important')::boolean, true) then return v_id; end if;
  if v_ev = 'expense.new' and c is not null then   -- debounced: several expenses logged together = one e-mail
    insert into app_private.inv_email_batch (investor_id, agreement_id, notif_id) values (p_investor, p_agreement, v_id);
    return v_id;
  end if;
  begin
    if c is null then
      perform app_private.sys_email(v_email, 'investor.notice', 'LoadBoot · ' || p_title,
        app_private.inv_email_html(p_title, coalesce(p_body, ''), p_rows, 'Open the portal', v_url),
        p_title || E'\n\n' || coalesce(p_body, '') || E'\n\n' || v_url, v_idem);
    else
      perform app_private.sys_email(v_email, 'investor.notice', c->>'subject', c->>'html', c->>'text', v_idem);
    end if;
  exception when others then null; -- e-mail must never break the money record
  end;
  return v_id;
end $$;

create or replace function app_private.inv_email_flush() returns int
language plpgsql security definer set search_path = app_private, public as $$
declare r record; v_n int := 0; c jsonb; v_email text; v_lang text; v_pref text; v_ref text;
begin
  for r in select investor_id, agreement_id, array_agg(notif_id order by id) nids, array_agg(id order by id) bids
           from app_private.inv_email_batch where sent_at is null group by investor_id, agreement_id
           having max(created_at) < now() - interval '90 seconds' or min(created_at) < now() - interval '10 minutes' loop
    update app_private.inv_email_batch set sent_at = now() where id = any(r.bids);
    select email, preferred_lang, coalesce(notify_email, 'all') into v_email, v_lang, v_pref from app_private.inv_investors where id = r.investor_id;
    v_lang := case when v_lang in ('ur', 'ur_roman') then v_lang else 'en' end;
    if v_email is null or v_pref <> 'all' then continue; end if;
    begin
      if array_length(r.nids, 1) = 1 then
        select app_private.inv_compose(v_lang, 'expense.new', n.data, n.agreement_id, 'https://loadboot.com/app/investor/#n/' || n.id), n.ref_id
          into c, v_ref from app_private.inv_notifications n where n.id = r.nids[1];
        perform app_private.sys_email(v_email, 'investor.notice', c->>'subject', c->>'html', c->>'text', 'inv:expense.new:' || coalesce(v_ref, r.nids[1]::text) || ':' || r.investor_id);
      else
        c := app_private.inv_compose(v_lang, 'expense.batch', jsonb_build_object('nids', to_jsonb(r.nids)), r.agreement_id, 'https://loadboot.com/app/investor/#n/list');
        perform app_private.sys_email(v_email, 'investor.notice', c->>'subject', c->>'html', c->>'text', 'inv:expense.batch:' || r.bids[1] || ':' || r.investor_id);
      end if;
      v_n := v_n + 1;
    exception when others then null; end;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------- 8. triggers
create or replace function app_private.trg_inv_notify() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare v_inv uuid; v_cur text; r record; v_vendor text; v_tr jsonb;
begin
  if tg_table_name = 'inv_updates' then
    if new.agreement_id is null then
      for r in select i.id from app_private.inv_investors i where i.status = 'active' loop
        perform app_private.inv_notify(r.id, null, 'update', new.title, new.body, 'update', new.id::text, '[]'::jsonb, 'update',
          jsonb_build_object('title', new.title, 'body', new.body), coalesce(new.send_email, false));
      end loop;
    else
      perform app_private.inv_notify(app_private.inv_investor_of(new.agreement_id), new.agreement_id, 'update', new.title, new.body, 'update', new.id::text,
        '[]'::jsonb, 'update', jsonb_build_object('title', new.title, 'body', new.body));
    end if;
    return new;
  end if;
  v_inv := app_private.inv_investor_of(new.agreement_id);
  select coalesce(currency, 'PKR') into v_cur from app_private.inv_agreements where id = new.agreement_id;
  v_cur := coalesce(v_cur, 'PKR');

  if tg_table_name = 'inv_requests' then
    if tg_op = 'INSERT' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'request', 'Capital request #' || new.seq || ' — ' || app_private.inv_money(v_cur, new.amount),
        coalesce(new.reason, ''), 'request', new.id::text, '[]'::jsonb, 'request.new',
        jsonb_build_object('cur', v_cur, 'amount', new.amount, 'seq', new.seq, 'reason', new.reason, 'needed_by', new.needed_by,
          'at', coalesce(new.requested_at, now()), 'files', jsonb_array_length(coalesce(new.attachments, '[]'::jsonb))));
    elsif tg_op = 'UPDATE' and new.status = 'pending' and coalesce(new.requested_at, now()) < now() - interval '5 minutes'
          and jsonb_array_length(coalesce(new.attachments, '[]'::jsonb)) > jsonb_array_length(coalesce(old.attachments, '[]'::jsonb)) then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'request', 'File added to request #' || new.seq, coalesce(new.reason, ''), 'request', new.id::text, '[]'::jsonb, 'request.file',
        jsonb_build_object('cur', v_cur, 'amount', new.amount, 'seq', new.seq, 'reason', new.reason, 'files', jsonb_array_length(coalesce(new.attachments, '[]'::jsonb))));
    end if;

  elsif tg_table_name = 'inv_expenses' then
    if tg_op = 'INSERT' and new.reversal_of is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'expense', 'Expense recorded — ' || app_private.inv_money(v_cur, new.amount),
        coalesce(new.vendor, '') || case when new.description is not null then ' · ' || new.description else '' end || ' (' || new.category || ')', 'expense', new.id::text, '[]'::jsonb, 'expense.new',
        jsonb_build_object('id', new.id, 'cur', v_cur, 'amount', new.amount, 'vendor', new.vendor, 'category', new.category, 'description', new.description,
          'date', new.expense_date, 'at', new.txn_at, 'proof', new.receipt_url is not null));
    elsif tg_op = 'INSERT' and new.reversal_of is not null then
      select vendor into v_vendor from app_private.inv_expenses where id = new.reversal_of;
      perform app_private.inv_notify(v_inv, new.agreement_id, 'expense', 'Expense reversed — ' || app_private.inv_money(v_cur, abs(new.amount)), coalesce(v_vendor, ''), 'expense', new.reversal_of::text, '[]'::jsonb, 'expense.reversal',
        jsonb_build_object('id', new.reversal_of, 'cur', v_cur, 'amount', abs(new.amount), 'vendor', coalesce(new.vendor, v_vendor)));
    elsif tg_op = 'UPDATE' and old.receipt_url is null and new.receipt_url is not null and new.reversal_of is null and new.created_at < now() - interval '5 minutes' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'expense', 'Receipt added — ' || coalesce(new.vendor, new.category), coalesce(new.description, ''), 'expense', new.id::text, '[]'::jsonb, 'expense.proof',
        jsonb_build_object('id', new.id, 'cur', v_cur, 'amount', new.amount, 'vendor', new.vendor, 'category', new.category, 'description', new.description, 'date', new.expense_date, 'at', new.txn_at));
    end if;

  elsif tg_table_name = 'inv_receipts' then
    if new.reversal_of is null and new.confirmed_by_staff_at is not null
       and (tg_op = 'INSERT' or (tg_op = 'UPDATE' and old.confirmed_by_staff_at is null)) then
      v_tr := coalesce(new.transfer, '{}'::jsonb);
      perform app_private.inv_notify(v_inv, new.agreement_id, 'receipt', 'Payment confirmed — ' || app_private.inv_money(v_cur, new.amount),
        'LoadBoot confirmed receiving your payment of ' || to_char(new.received_date, 'DD Mon YYYY') || '. It now counts toward your funded amount.', 'receipt', new.id::text, '[]'::jsonb, 'receipt.confirmed',
        jsonb_build_object('cur', v_cur, 'amount', new.amount, 'date', new.received_date, 'at', new.txn_at, 'confirmed_at', new.confirmed_by_staff_at,
          'from', nullif(concat_ws(' · ', v_tr->>'sender_bank', case when v_tr->>'sender_account' is not null then '••' || right(v_tr->>'sender_account', 4) end), ''),
          'into', nullif(split_part(coalesce(v_tr->>'received_into', ''), ' - ', 1), '')));
    elsif tg_op = 'UPDATE' and new.rejected_at is not null and old.rejected_at is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'receipt', 'Declared payment not found', coalesce(new.rejected_reason, ''), 'receipt', new.id::text, '[]'::jsonb, 'receipt.rejected',
        jsonb_build_object('cur', v_cur, 'amount', new.amount, 'reason', new.rejected_reason));
    end if;

  elsif tg_table_name = 'inv_payouts' then
    if tg_op = 'UPDATE' and new.status = 'paid' and old.status is distinct from 'paid' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'payout', 'Payout sent — ' || app_private.inv_money(v_cur, new.total),
        'Please confirm in the portal once it reaches you.', 'payout', new.id::text, '[]'::jsonb, 'payout.paid', jsonb_build_object('cur', v_cur, 'amount', new.total));
    end if;

  elsif tg_table_name = 'inv_agreement_docs' then
    if tg_op = 'INSERT' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'document', 'Agreement version ' || new.version || ' published', 'Read it in the portal and sign when you are ready.',
        'document', new.id::text, '[]'::jsonb, 'document.published', jsonb_build_object('version', new.version));
    end if;

  elsif tg_table_name = 'inv_amendments' then
    if tg_op = 'UPDATE' and new.status in ('accepted', 'declined') and old.status = 'proposed' then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'amendment', 'Your proposal was ' || new.status, coalesce(new.decision_note, ''), 'amendment', new.id::text, '[]'::jsonb, 'amendment',
        jsonb_build_object('status', new.status, 'note', new.decision_note));
    end if;

  elsif tg_table_name = 'inv_flags' then
    if tg_op = 'UPDATE' and new.answer is not null and old.answer is null then
      perform app_private.inv_notify(v_inv, new.agreement_id, 'flag', 'Your question was answered', new.answer, 'flag', new.id::text, '[]'::jsonb, 'flag', jsonb_build_object('answer', new.answer));
    end if;
  end if;
  return new;
end $$;

create or replace function app_private.trg_inv_notify_payout_insert() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare v_inv uuid; v_cur text; v_month date; v_profit numeric;
begin
  v_inv := app_private.inv_investor_of(new.agreement_id);
  select coalesce(currency, 'PKR') into v_cur from app_private.inv_agreements where id = new.agreement_id;
  select period_month, profit into v_month, v_profit from app_private.inv_statements where id = new.statement_id;
  perform app_private.inv_notify(v_inv, new.agreement_id, 'statement',
    case when new.kind = 'capital_return' then 'Capital return recorded' else 'Statement published — ' || to_char(coalesce(v_month, current_date), 'Mon YYYY') end,
    case when new.kind = 'capital_return' then 'Unspent money is being returned to you: ' || app_private.inv_money(v_cur, new.total)
         when coalesce(new.total, 0) > 0 then 'Profit ' || app_private.inv_money(v_cur, coalesce(v_profit, 0)) || ' · your payout ' || app_private.inv_money(v_cur, new.total)
         else 'No profit this month — nothing is owed and nothing piles up.' end,
    'statement', new.statement_id::text, '[]'::jsonb, 'statement',
    jsonb_build_object('cur', v_cur, 'month', coalesce(v_month, current_date), 'profit', coalesce(v_profit, 0), 'total', coalesce(new.total, 0), 'capital_return', new.kind = 'capital_return'));
  return new;
end $$;

-- agreement signed by BOTH sides (whichever side signs last)
create or replace function app_private.trg_inv_notify_sig() returns trigger
language plpgsql security definer set search_path = app_private, public as $$
declare v_agr uuid; v_ver int; v_you timestamptz; v_lb timestamptz;
begin
  select agreement_id, version into v_agr, v_ver from app_private.inv_agreement_docs where id = new.doc_id;
  if v_agr is null then return new; end if;
  if (select count(*) from app_private.inv_signatures where doc_id = new.doc_id and party = new.party) > 1 then return new; end if;
  select max(signed_at) filter (where party = 'investor'), max(signed_at) filter (where party = 'company') into v_you, v_lb
  from app_private.inv_signatures where doc_id = new.doc_id;
  if v_you is null or v_lb is null then return new; end if;
  perform app_private.inv_notify(app_private.inv_investor_of(v_agr), v_agr, 'document', 'Agreement v' || v_ver || ' signed by both sides',
    'Your signed copy is in the portal.', 'document', new.doc_id::text, '[]'::jsonb, 'document.signed',
    jsonb_build_object('version', v_ver, 'you_at', v_you, 'lb_at', v_lb));
  return new;
exception when others then return new;
end $$;

drop trigger if exists inv_notify_expenses on app_private.inv_expenses;
create trigger inv_notify_expenses after insert or update of receipt_url on app_private.inv_expenses for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_receipts on app_private.inv_receipts;
create trigger inv_notify_receipts after insert or update on app_private.inv_receipts for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_requests on app_private.inv_requests;
create trigger inv_notify_requests after insert or update of attachments on app_private.inv_requests for each row execute function app_private.trg_inv_notify();
drop trigger if exists inv_notify_sigs on app_private.inv_signatures;
create trigger inv_notify_sigs after insert on app_private.inv_signatures for each row execute function app_private.trg_inv_notify_sig();

-- ---------------------------------------------------------------- 9. portal RPCs
create or replace function public.inv_notifications(p_limit integer default 50) returns jsonb
language plpgsql stable security definer set search_path = app_private, public as $$
declare v_inv uuid;
begin
  v_inv := app_private.inv_my_investor();
  if v_inv is null then raise exception 'not authorized' using errcode = '42501'; end if;
  return jsonb_build_object('ok', true,
    'unread', (select count(*) from app_private.inv_notifications where investor_id = v_inv and read_at is null),
    'pref', (select coalesce(notify_email, 'all') from app_private.inv_investors where id = v_inv),
    'items', (select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'title', n.title, 'body', n.body, 'ref_kind', n.ref_kind, 'ref_id', n.ref_id,
                'agreement_id', n.agreement_id, 'created_at', n.created_at, 'read_at', n.read_at, 'data', n.data) order by n.created_at desc), '[]'::jsonb)
              from (select * from app_private.inv_notifications where investor_id = v_inv order by created_at desc limit greatest(1, least(p_limit, 200))) n));
end $$;

create or replace function public.inv_set_notify_pref(p_pref text) returns jsonb
language plpgsql security definer set search_path = app_private, public as $$
declare v_inv uuid;
begin
  v_inv := app_private.inv_my_investor();
  if v_inv is null then raise exception 'not authorized' using errcode = '42501'; end if;
  if p_pref not in ('all', 'important', 'off') then raise exception 'bad preference' using errcode = '22023'; end if;
  update app_private.inv_investors set notify_email = p_pref where id = v_inv;
  return jsonb_build_object('ok', true, 'pref', p_pref);
end $$;
revoke all on function public.inv_set_notify_pref(text) from public, anon;
grant execute on function public.inv_set_notify_pref(text) to authenticated;

-- ---------------------------------------------------------------- 10. back-fill structured data on existing notices (no re-send)
update app_private.inv_notifications n set data = jsonb_build_object('ev', 'expense.new', 'id', x.id, 'cur', coalesce(a.currency, 'PKR'), 'amount', x.amount, 'vendor', x.vendor,
    'category', x.category, 'description', x.description, 'date', x.expense_date, 'at', x.txn_at, 'proof', x.receipt_url is not null)
from app_private.inv_expenses x join app_private.inv_agreements a on a.id = x.agreement_id
where n.data is null and n.kind = 'expense' and n.ref_id = x.id::text and x.reversal_of is null;
update app_private.inv_notifications n set data = jsonb_build_object('ev', 'request.new', 'cur', coalesce(a.currency, 'PKR'), 'amount', q.amount, 'seq', q.seq, 'reason', q.reason,
    'needed_by', q.needed_by, 'at', q.requested_at, 'files', jsonb_array_length(coalesce(q.attachments, '[]'::jsonb)))
from app_private.inv_requests q join app_private.inv_agreements a on a.id = q.agreement_id
where n.data is null and n.kind = 'request' and n.ref_id = q.id::text;
update app_private.inv_notifications n set data = jsonb_build_object('ev', 'document.published', 'version', dd.version)
from app_private.inv_agreement_docs dd where n.data is null and n.kind = 'document' and n.ref_id = dd.id::text;

-- ---------------------------------------------------------------- 11. schedules + e-mail catalog
do $$ begin perform cron.unschedule('inv-email-flush'); exception when others then null; end $$;
select cron.schedule('inv-email-flush', '* * * * *', $c$select app_private.inv_email_flush()$c$);
do $$ begin perform cron.unschedule('push-outbox-sweep'); exception when others then null; end $$;
select cron.schedule('push-outbox-sweep', '* * * * *',
  $c$select app_private.push_kick() where exists (select 1 from app_private.push_outbox where sent_at is null and attempts < 5 and created_at > now() - interval '1 day')$c$);

update app_private.email_catalog set
  purpose = 'Investor record notice (v2, bl_inv_0414): one e-mail per CC action on the investor''s money — expense, capital request, payment confirmed/rejected, receipt/file added, expense reversed, agreement published / signed by both sides, statement, payout, proposal decision, question answered, founder update. In the investor''s language (en / Roman Urdu / Urdu), amount + given/spent/left strip + button to the exact item. Expense e-mails debounced 90 s into one list. Investor preference all/important/off.',
  trigger_source = 'app_private.inv_notify → inv_compose / inv_email_v2 (triggers on inv_* tables + inv_signatures); expenses via inv_email_batch → inv_email_flush (cron inv-email-flush)',
  updated_at = now()
where key = 'investor.notice';
