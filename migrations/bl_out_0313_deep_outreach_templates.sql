-- bl_out_0313_deep_outreach_templates
-- 2026-09-01 — publish the audited 7-touch broker + 7-touch carrier sequences.
--
-- Copy rules:
--   * one real operating problem, one concrete offer, one primary CTA
--   * business voice uses "we", never a fabricated individual sender
--   * no coverage, revenue, rate, verification-result or availability guarantee
--   * broker posting is free forever
--   * carrier fee is 5% of linehaul only on LoadBoot-booked, delivered and paid loads
--   * official outreach contact: WhatsApp +1 (928) 393-6198 / hello@loadboot.com
--   * real LoadBoot logo + physical address + visible {UNSUB} in every template
--
-- parts is cleared deliberately: outreach_prepare renders parts when present, otherwise html.

with payload(audience, day, subject, preheader, body, cta_url, cta_label) as (
  values
  (
    'broker', 1,
    $s$Your next uncovered load$s$,
    $p$A second capacity channel without another broker subscription.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">When an open load does not clear through the usual carrier list, another subscription is not the same as another qualified truck.</p>
      <p style="margin:0 0 16px">LoadBoot gives brokerages a second capacity channel without replacing the TMS, load boards, or carrier relationships already in place.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">Reply with one open load: origin, destination, equipment, pickup time, weight, and target rate. We will structure it and tell you plainly whether a relevant carrier fit is available.</div>
      <p style="margin:0 0 16px"><strong>No account is required for the first review.</strong></p>
    $b$,
    $u$https://loadboot.com/free-load-board-for-brokers.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d1&oc={OC}$u$,
    $l$See the one-load process$l$
  ),
  (
    'broker', 2,
    $s$A carrier identity check your team can repeat$s$,
    $p$A practical carrier-vetting workflow for rushed coverage.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">A rushed carrier setup is where identity mismatches become freight claims.</p>
      <p style="margin:0 0 16px">A repeatable review starts with the carrier phone number on the federal record, authority status, insurance confirmed through the agency, company and equipment details, and any mismatch between the documents and the people handling the load.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">LoadBoot records authority and insurance checks before a carrier is treated as eligible. If a result cannot be confirmed, we do not present it as a pass.</div>
      <p style="margin:0 0 16px">Reply <strong>CHECKLIST</strong> and we will send the one-page version.</p>
    $b$,
    $u$https://loadboot.com/compliance.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d2&oc={OC}$u$,
    $l$Review the verification process$l$
  ),
  (
    'broker', 3,
    $s$One uncovered load is enough to test us$s$,
    $p$Test LoadBoot with freight your usual list has not covered.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">The useful test is not a product demo. It is a real load your normal carrier list has not covered.</p>
      <p style="margin:0 0 16px">Reply with the origin, destination, equipment, pickup time, weight, commodity, and target rate. We will review the operating requirements and whether a currently eligible carrier profile fits.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">If there is no relevant fit, we will say so. If there is, your team keeps control of the rate confirmation and booking decision.</div>
      <p style="margin:0 0 16px">Is there one load we can review?</p>
    $b$,
    $u$https://loadboot.com/free-load-board-for-brokers.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d3&oc={OC}$u$,
    $l$See how free posting works$l$
  ),
  (
    'broker', 4,
    $s$Fewer check calls on the next load$s$,
    $p$Put trip status, timestamps, ETA and documents in one record.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">Operations loses time when the load status lives across phone calls, texts, tracking links, and inbox attachments.</p>
      <p style="margin:0 0 16px">For a load booked through LoadBoot, authorized trip tracking can keep location updates, arrival and departure events, ETA, BOL, POD, and issue reports with the same load record.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">The live view marks stale tracking instead of presenting an old location as current, and tracking ends when the trip is delivered.</div>
      <p style="margin:0 0 16px">Would a sample broker tracking view help your operations team?</p>
    $b$,
    $u$https://loadboot.com/gps-tracking.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d4&oc={OC}$u$,
    $l$See the tracking record$l$
  ),
  (
    'broker', 5,
    $s$A cleaner detention file$s$,
    $p$Make the written rate terms and trip evidence easier to review.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">Detention becomes harder to resolve when free time, hourly amount, notice requirements, or supporting evidence were never clear in writing.</p>
      <p style="margin:0 0 16px">The cleaner workflow is simple: put the accessorial terms on the rate record, capture arrival and departure timestamps, keep the notice, and attach the documents to the same trip.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">LoadBoot keeps the agreed terms and evidence together. The broker still decides payment under the written agreement; the record makes that decision easier to audit.</div>
      <p style="margin:0 0 16px">Reply <strong>ACCESSORIALS</strong> for the short review checklist.</p>
    $b$,
    $u$https://loadboot.com/detention-pay-policy.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d5&oc={OC}$u$,
    $l$Review the detention workflow$l$
  ),
  (
    'broker', 6,
    $s$Why broker posting stays free forever$s$,
    $p$No subscription, posting fee, or hidden broker charge.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">LoadBoot does not need a broker subscription to make the economics work.</p>
      <p style="margin:0 0 16px">Broker posting is free forever. There is no subscription, per-post charge, or hidden broker fee. LoadBoot earns from the carrier side: 5% of linehaul only when a load booked through LoadBoot is delivered and paid. Approved accessorials pass through to the carrier.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">That keeps the first test simple: send one open load, review any eligible response, and decide from a real operating result.</div>
      <p style="margin:0 0 16px">Open to a one-load test?</p>
    $b$,
    $u$https://loadboot.com/pricing.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d6&oc={OC}$u$,
    $l$Review the pricing model$l$
  ),
  (
    'broker', 7,
    $s$Should we close the loop?$s$,
    $p$A final note about free broker posting and one-load testing.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">We will close the loop after this note.</p>
      <p style="margin:0 0 16px">If an uncovered load comes up later, reply with the lane, equipment, pickup time, weight, and target rate. We will confirm what we received and whether a relevant carrier profile fits the requirements.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">There is no broker subscription, no posting fee, and no obligation to move freight through LoadBoot.</div>
      <p style="margin:0 0 16px">Should we keep {NAME} open for a future test, or mark this as not interested?</p>
    $b$,
    $u$https://loadboot.com/create-broker-account.html?utm_source=email&utm_medium=outreach&utm_campaign=broker-d7&oc={OC}$u$,
    $l$Keep the free broker option$l$
  ),
  (
    'carrier', 1,
    $s$Before you accept the next load$s$,
    $p$Evaluate the full trip before committing to the posted rate.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">A load can look profitable at the posted rate and still lose money after deadhead, fuel, tolls, and time.</p>
      <p style="margin:0 0 16px">LoadBoot helps carriers evaluate the full trip before committing, not just the loaded rate.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">We review total miles, all-in RPM, operating cost, broker details, and delivery requirements. You approve every load. We can then handle negotiation, rate-confirmation review, trip follow-up, and paperwork.</div>
      <p style="margin:0 0 16px">What equipment are you running, and where is the truck usually empty?</p>
    $b$,
    $u$https://loadboot.com/carriers.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d1&oc={OC}$u$,
    $l$Review how dispatch works$l$
  ),
  (
    'carrier', 2,
    $s$Check the real all-in RPM before you say yes$s$,
    $p$Loaded RPM alone does not show whether the whole trip works.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">A posted rate can look strong until deadhead, tolls, and the dispatch fee are included.</p>
      <p style="margin:0 0 16px">Reply with four numbers from any load: rate, loaded miles, deadhead miles, and estimated tolls.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">We will return loaded RPM, all-in RPM, estimated toll impact, and the carrier amount after LoadBoot's 5% linehaul fee. No signup is required for the calculation.</div>
      <p style="margin:0 0 16px">Want us to check one before you call the broker?</p>
    $b$,
    $u$https://loadboot.com/cost-per-mile-calculator.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d2&oc={OC}$u$,
    $l$Use the free cost-per-mile calculator$l$
  ),
  (
    'carrier', 3,
    $s$What actually fits your truck?$s$,
    $p$Good dispatch starts with the loads the truck should refuse.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">Good dispatch starts with the loads the truck should refuse.</p>
      <p style="margin:0 0 16px">Equipment dimensions, payload, liftgate or dock limits, maximum deadhead, minimum all-in RPM, home time, and loading restrictions all matter before anyone calls a broker.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">Reply in one line: <strong>equipment + current ZIP + max deadhead + minimum RPM + any loading limit.</strong> We will tell you whether LoadBoot is a realistic operating fit before asking you to onboard.</div>
      <p style="margin:0 0 16px">The truck profile should control the search, not the other way around.</p>
    $b$,
    $u$https://loadboot.com/carriers.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d3&oc={OC}$u$,
    $l$See the carrier workflow$l$
  ),
  (
    'carrier', 4,
    $s$Three rate-confirmation lines worth checking$s$,
    $p$Read the money and risk terms before signing the rate confirmation.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">Before signing a rate confirmation, check three areas carefully: free-time and accessorial terms, cancellation or chargeback language, and when the payment clock starts after POD submission.</p>
      <p style="margin:0 0 16px">Also confirm the pickup and delivery appointments, commodity, weight, equipment, rate, and every required document.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">Reply with a redacted rate confirmation if you want an operational second look. We will flag questions worth asking before signature. This is not legal advice.</div>
      <p style="margin:0 0 16px">A five-minute review can prevent a thirty-day payment problem.</p>
    $b$,
    $u$https://loadboot.com/how-to-read-a-rate-confirmation.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d4&oc={OC}$u$,
    $l$Read the rate-confirmation checklist$l$
  ),
  (
    'carrier', 5,
    $s$When a broker says your authority is too new$s$,
    $p$New authority is a qualification issue to manage honestly.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">Some brokers decline newer authority even when authority and insurance are active. The useful response is not to hide the authority age.</p>
      <p style="margin:0 0 16px">Target brokers whose age rules you meet, keep the carrier packet complete, confirm insurance is visible on the federal record, and have the W-9, COI, banking or factoring instructions, and operating details ready.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">LoadBoot can help organize the qualification steps and focus the search on freight the carrier is actually eligible to book.</div>
      <p style="margin:0 0 16px">Reply <strong>NEW</strong> and we will send the setup checklist.</p>
    $b$,
    $u$https://loadboot.com/how-to-get-loads-with-new-authority.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d5&oc={OC}$u$,
    $l$Review the new-authority guide$l$
  ),
  (
    'carrier', 6,
    $s$When and where will your truck be empty?$s$,
    $p$A usable availability signal needs time, place, equipment, and direction.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">A dispatcher cannot evaluate the right freight from “available tomorrow.” The useful signal includes when, where, what equipment, and where the truck should go.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0"><strong>EMPTY [date/time] — [city/state or ZIP] — [equipment] — [destination preference] — [max deadhead]</strong></div>
      <p style="margin:0 0 16px">Reply with that one line. We will evaluate only options that fit the information you provide, and you approve every load before booking.</p>
      <p style="margin:0 0 16px"><strong>No forced dispatch.</strong></p>
    $b$,
    $u$https://loadboot.com/create-carrier-account.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d6&oc={OC}$u$,
    $l$Create your carrier profile$l$
  ),
  (
    'carrier', 7,
    $s$Should we close your file?$s$,
    $p$A final note about dispatch support and carrier control.$p$,
    $b$
      <p style="margin:0 0 16px;color:#10223B;font-size:16px;font-weight:700">Hello {NAME},</p>
      <p style="margin:0 0 16px">This is our last outreach note.</p>
      <p style="margin:0 0 16px">If you want to evaluate LoadBoot later, reply with your equipment, home ZIP, and the date the truck will next be empty. We will start with operating fit and load math before asking you to commit to anything.</p>
      <div style="margin:18px 0;padding:15px 17px;background:#F7FAFF;border-left:3px solid #0883F7;border-radius:0 7px 7px 0">You approve every load. There is no contract, no forced dispatch, and no hidden fee beyond the stated 5% linehaul charge on a LoadBoot-booked, delivered, and paid load.</div>
      <p style="margin:0 0 16px">Reply <strong>YES</strong> to keep the conversation open or <strong>NO</strong> and we will close the file.</p>
    $b$,
    $u$https://loadboot.com/pricing.html?utm_source=email&utm_medium=outreach&utm_campaign=carrier-d7&oc={OC}$u$,
    $l$Review the 5% pricing$l$
  )
),
rendered as (
  select
    audience,
    day,
    subject,
    $h1$<div style="display:none;max-height:0;overflow:hidden;mso-hide:all">$h1$ || preheader ||
    $h2$&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="width:100%;margin:0;background:#EEF2F7">
<tr><td align="center" style="padding:24px 10px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#FFFFFF;border:1px solid #E2E8F0;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif">
<tr><td style="height:4px;background:#0883F7;background:linear-gradient(90deg,#0883F7,#FC5305);font-size:0;line-height:0">&nbsp;</td></tr>
<tr><td style="padding:18px 32px 16px;border-bottom:1px solid #EDF2F7">
  <a href="https://loadboot.com/?utm_source=email&amp;utm_medium=outreach&amp;utm_campaign=$h2$ || audience || '-d' || day::text ||
    $h3$&amp;oc={OC}" style="text-decoration:none">
    <img src="https://loadboot.com/logo-full.png" width="210" alt="LoadBoot — The Operating System for Trucking" style="display:block;width:210px;max-width:100%;height:auto;border:0">
  </a>
</td></tr>
<tr><td style="padding:26px 32px 28px;color:#27364A;font-size:15px;line-height:1.66">$h3$ || body ||
    $h4$
  <p style="margin:20px 0 22px">
    <a href="$h4$ || replace(cta_url, '&', '&amp;') ||
    $h5$" style="display:inline-block;background:#0883F7;color:#FFFFFF!important;text-decoration:none;border-radius:7px;padding:12px 18px;font-size:14px;font-weight:700">
      <span style="color:#FFFFFF!important;text-decoration:none">$h5$ || cta_label ||
    $h6$ &rarr;</span>
    </a>
  </p>
  <p style="margin:0;color:#334155"><strong style="color:#10223B">LoadBoot $h6$ ||
    case when audience='broker' then 'Broker Partnerships' else 'Carrier Operations' end ||
    $h7$</strong><br>
    WhatsApp: <a href="https://wa.me/19283936198" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">+1 (928) 393-6198</span></a><br>
    <a href="mailto:hello@loadboot.com" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">hello@loadboot.com</span></a><br>
    <a href="https://loadboot.com/" style="color:#0883F7;text-decoration:none"><span style="color:#0883F7!important">loadboot.com</span></a>
  </p>
</td></tr>
<tr><td style="padding:18px 32px 22px;background:#F8FAFC;border-top:1px solid #E2E8F0;color:#64748B;font-size:11px;line-height:1.65;text-align:center">
  <p style="margin:0 0 7px">You are receiving this business email because your $h7$ ||
    case when audience='broker' then 'brokerage' else 'carrier' end ||
    $h8$ contact information is listed in a public transportation-industry record or business directory.</p>
  <p style="margin:0 0 7px"><strong style="color:#475569">LoadBoot LLC</strong> &middot; 30 N Gould St Ste N, Sheridan, WY 82801</p>
  <p style="margin:0 0 7px"><a href="{UNSUB}" style="color:#475569;text-decoration:underline"><span style="color:#475569!important">Unsubscribe</span></a> &nbsp;&middot;&nbsp; <a href="https://loadboot.com/privacy.html" style="color:#475569;text-decoration:underline"><span style="color:#475569!important">Privacy</span></a></p>
  <p style="margin:0;color:#94A3B8">$h8$ ||
    case when audience='broker'
      then 'Broker posting is free forever—no subscription or per-load posting fee. Carrier availability depends on lane, equipment, timing, rate, and eligibility.'
      else 'No hidden fees. LoadBoot charges 5% of linehaul only on loads booked through LoadBoot, delivered, and paid. Accessorials pass through to the carrier; load and rate availability varies by market.'
    end ||
    $h9$</p>
</td></tr>
</table>
</td></tr>
</table>$h9$ as html
  from payload
)
update app_private.outreach_templates t
set subject = r.subject,
    html = r.html,
    parts = null,
    active = true
from rendered r
where t.audience = r.audience
  and t.day = r.day;

do $verify$
declare
  v_count int;
begin
  select count(*) into v_count
  from app_private.outreach_templates
  where audience in ('broker','carrier') and day between 1 and 7 and active;
  if v_count <> 14 then
    raise exception 'expected 14 active broker/carrier templates, found %', v_count;
  end if;

  if exists (
    select 1 from app_private.outreach_templates
    where audience in ('broker','carrier') and day between 1 and 7
      and (
        parts is not null
        or html is null
        or html not like '%https://loadboot.com/logo-full.png%'
        or html not like '%https://wa.me/19283936198%'
        or html not like '%+1 (928) 393-6198%'
        or html not like '%mailto:hello@loadboot.com%'
        or html not like '%{UNSUB}%'
        or html not like '%{OC}%'
        or html like '%+1 (469) 253-7575%'
        or html like '%Riley%'
      )
  ) then
    raise exception 'one or more outreach templates failed brand/contact/unsubscribe validation';
  end if;

  if exists (
    select 1 from app_private.outreach_templates
    where audience='broker' and day between 1 and 7
      and html not ilike '%free forever%'
  ) then
    raise exception 'every broker template must state free forever';
  end if;

  if exists (
    select 1 from app_private.outreach_templates
    where audience='carrier' and day between 1 and 7
      and (
        html not ilike '%no hidden fees%'
        or html not like '%5% of linehaul%'
        or html not ilike '%delivered, and paid%'
      )
  ) then
    raise exception 'every carrier template must state the complete 5 percent pricing rule';
  end if;
end;
$verify$;

