# Contact data — kahan se, kaise (Yaseen: 10-min kaam, phir sheets bhar jayengi)
## CARRIERS (Asim ki sheet)
1. Kholo: https://ai.fmcsa.dot.gov/SMS/Tools/Downloads.aspx → "Motor Carrier Census File" download (CSV/txt).
2. Excel mein kholo → filter: ADD_DATE = pichhle 60-90 din (new authorities) · TRUCKS/POWER_UNITS 1-5 · states pehle: TX, GA, FL, CA, PA, NJ, IL, NC.
3. Columns utha kar carriers-asim.csv mein paste: LEGAL_NAME, EMAIL_ADDRESS, TELEPHONE, MC/DOT, STATE, TRUCKS. (Census file mein EMAIL hota hai.)
4. Bina-email rows delete. Roz Brevo mein import → aaj ki email POORI list ko.
## BROKERS (Ali ki sheet)
1. Kholo: https://li-public.fmcsa.dot.gov → "Licensing & Insurance" → Carrier/Broker search → Authority Type = BROKER, Active.
2. Chhote/naye brokers (authority < 2 saal) pehle. Naam/MC lo, email unki website ya Google se (broker census mein email kam hota hai).
3. brokers-ali.csv bharo. Extra source: DAT directory + LinkedIn "freight broker" filter.
## RULES
- Brevo free = 300 emails/din/account — dono apna account banayen (dispatch@ / hello@ se sender verify).
- CC → Analytics mein "Outreach emails" card clicks/signups dikhayega (UTM already emails mein hai). Sends/opens Brevo dashboard mein.
- "unsubscribe" reply → us row ke notes mein UNSUB likh kar list se nikaal do.
