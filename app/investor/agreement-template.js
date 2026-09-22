// agreement-template.js — generates the Investment Agreement text (markdown) from
// the agreement record + a few extra terms. Published from Command Center as a
// versioned, hashed document; signed in the investor portal. Two languages.
// Anything not yet agreed renders as a highlighted placeholder so it cannot be
// missed — and CC warns before publishing a document that still has one.
//
// This is a plain-language commercial template, NOT legal advice. It is built to
// be reviewed by a lawyer, then published. Every clause maps to a portal feature
// so the words and the software never disagree.
const nf = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const money = (n, cur) => (cur || 'PKR') + ' ' + nf.format(Number(n || 0));
const pct = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 }) + '%';
const PH = (label) => '<span class="ph">[' + label + ']</span>';
const or = (v, label) => (v == null || v === '') ? PH(label) : String(v);

export const DEFAULT_EXTRA = {
  company_name: 'LoadBoot LLC', company_state: 'Wyoming, United States',
  company_signer: 'Muhammad Yaseen', company_signer_title: 'Member / Manager',
  statement_day: 10, payout_days: 7, flag_answer_days: 5, request_response_days: 7,
  mediator: '', governing_law: '', notify_new_investor: true, audit_per_year: 1,
  owner_salary_in_expenses: '', tax_treatment: '',
  separate_account: '', bank_statement_access: '', key_person: '', other_members: '', visits: '',
};

export function hasPlaceholders(md) { return /class="ph"/.test(md); }
// A published document stores { agreement, investor, extra } (bl_inv_0405). Rebuild it in any
// language for READING; the signature stays bound to the published text's hash.
export function buildFromParams(params, lang) {
  if (!params || !params.agreement) return null;
  return buildAgreement(params.agreement, params.investor || {}, params.extra || {}, lang);
}

export function buildAgreement(a, investor, extra, lang) {
  const x = Object.assign({}, DEFAULT_EXTRA, extra || {});
  const cur = a.currency || 'PKR';
  const cap = money(a.original_cap || a.commitment_cap, cur);
  const pay = pct(a.payback_rate_pct), share = pct(a.permanent_share_pct);
  const isEquity = a.share_type === 'equity';
  const shareType = a.share_type === 'equity' ? 'EQUITY' : a.share_type === 'profit_share' ? 'PROFIT_SHARE' : null;
  const stopMode = a.early_stop_share_mode === 'keep' ? 'KEEP' : 'PRO_RATA';
  const exitPct = a.exit_participation_pct != null ? pct(a.exit_participation_pct) : null;
  const target = a.payback_basis === 'fixed' ? money(a.payback_fixed_amount, cur) : null;
  const D = lang === 'ur_roman' ? UR : lang === 'ur' ? URS : EN;
  return D({ a, investor, x, cur, cap, pay, share, isEquity, shareType, stopMode, exitPct, target });
}

function EN({ a, investor, x, cur, cap, pay, share, isEquity, shareType, stopMode, exitPct, target }) {
  const inv = or(investor && investor.name, 'INVESTOR FULL NAME');
  return `# Investment Agreement

**Between** ${x.company_name}, a limited liability company organised in ${x.company_state} (the **Company**), represented by ${x.company_signer}, ${x.company_signer_title}, **and** ${inv} (the **Investor**).

This agreement is written in plain language on purpose. Every number in it is also shown live in the Investor Portal, and the Portal record is the record both sides rely on.

## 1. Background
The Company runs LoadBoot, a dispatch and load-management service for trucking carriers. The Investor is putting money into the Company's operations in exchange for a share of profit as set out below. The Investor is not lending money and is not buying a fixed return.

## 2. Definitions
| Term | Meaning |
|---|---|
| **Commitment** | The most the Investor has agreed to put in: **${cap}**. A ceiling, not an obligation. |
| **Capital Request** | A request by the Company, made in the Portal, for a stated amount and purpose. |
| **Tranche** | One payment by the Investor against a Capital Request (or recorded without one). |
| **Funded Amount** | The total of all Tranches that BOTH sides have confirmed in the Portal. Only confirmed money counts. |
| **Fund** | The Funded Amount less what has been spent from it. |
| **Profit** | Revenue actually collected in a calendar month, less the expenses listed in clause 7. |
| **Recovery Target** | ${target ? 'The fixed amount of **' + target + '**.' : 'The **Funded Amount** — whatever the Investor actually paid in, no more.'} |
| **Recovery Period** | From the first Tranche until the Recovery Target has been paid back through Payouts. |
| **Permanent Share** | **${share}** of Profit, paid for as long as the Company earns profit, subject to clauses 10 and 11. |
| **Statement** | The monthly Profit statement published in the Portal. |
| **Payout** | Money paid by the Company to the Investor for a Statement, confirmed by the Investor in the Portal. |
| **Portal** | The Investor Portal at loadboot.com/app/investor, and the Company's Command Center that writes to it. |

## 3. What this investment is — and is not
3.1 The money is **at risk**. If the Company does not earn profit, the Investor receives nothing for that period. If the Company fails, the Investor may lose what has been spent (clause 11).
3.2 This is **not a loan**. There is no interest, no fixed repayment date, and no guaranteed return.
3.3 **No personal liability.** Neither ${x.company_signer} nor any other member, officer or employee of the Company is personally liable to the Investor. The Investor's only recourse is against the Company.
3.4 ${isEquity ? 'The Investor **acquires membership interest** (ownership) in the Company as set out in clause 9. ' : shareType === 'PROFIT_SHARE' ? 'The Investor **does not acquire ownership**, voting rights or a seat in management. The Investor\'s rights are to money only: the Recovery Payouts, the Permanent Share, and the sale participation in clause 12. ' : PH('NATURE OF THE 5% — EQUITY OR PROFIT SHARE') + ' '}

## 4. Commitment and Capital Requests
4.1 The Company may raise a Capital Request in the Portal stating the amount, purpose and category. The total of all Tranches will not exceed the Commitment unless both sides change the Commitment in writing (an edit in the Portal by the Company, visible to the Investor, counts as writing).
4.2 The Investor will respond to a Capital Request within **${x.request_response_days} days** — by paying, or by saying no. Saying no to a request is **not a breach**; it simply leaves the Funded Amount where it is.
4.3 Money paid above the remaining Commitment is not accepted until the Commitment has been raised in the Portal.
4.4 As at signing, **${money(a.position && a.position.funded, cur)}** has been funded and confirmed.

## 5. Paying, confirming and proof
5.1 The Portal shows the Company's payment details. The Investor pays only to those details.
5.2 After paying, the Investor marks the payment as paid in the Portal, with the amount, date, method, reference and proof (a bank slip or screenshot uploaded to the Portal's private storage).
5.3 The Company confirms receipt in the Portal. **A Tranche counts only after both confirmations.** A declared payment the Company cannot find is rejected in the Portal with a written reason; the Investor may re-declare it with better proof.
5.4 A confirmed entry is never edited. A mistake is corrected by a visible reversal entry with a reason, and any entry may be reversed only once.

## 6. Use of the Fund
6.1 The Fund is used only for the Company's business: office, staff, equipment, tools and subscriptions, professional fees, marketing and similar operating costs.
6.2 Every expense is recorded in the Portal within **48 hours** of payment, tagged with the Tranche it was paid from and its category, with a receipt where one exists.
6.3 Money that has been spent is not returned, except as clause 11 provides on wind-down.

## 7. Profit — the formula
7.1 **Profit** for a calendar month = revenue actually **collected** in that month (invoices merely issued do not count) **minus**:
${or(a.profit_definition, 'THE AGREED LIST OF EXPENSE LINES — rent, utilities, salaries and commission, tools and subscriptions, professional fees, bank charges, equipment or its depreciation, taxes')}
7.2 ${x.owner_salary_in_expenses ? 'Owner remuneration: ' + x.owner_salary_in_expenses : PH('WHETHER THE OWNER\'S OWN SALARY IS AN EXPENSE, AND ITS CAP')}
7.3 ${x.tax_treatment ? 'Taxes: ' + x.tax_treatment : PH('HOW COMPANY TAXES ARE TREATED IN THE FORMULA')}
7.4 The Company publishes the Statement for each month in the Portal by the **${x.statement_day}th** of the following month, showing revenue, expenses, Profit and the Investor's Payout.
7.5 ${a.loss_carry_forward ? '**Losses carry forward.** A month with negative Profit creates a loss pool. Later Profit first fills the pool; Payouts are calculated only on Profit above it. The pool counts only months from the start of this agreement.' : '**Each month stands alone.** A month with no Profit pays nothing and is not carried into later months. Nothing accumulates as a debt.'}

## 8. The Investor's return during the Recovery Period
8.1 For each Statement with positive Profit, the Investor receives: **${pay} of Profit** toward the Recovery Target, **plus ${share} of Profit** as the Permanent Share. The Recovery portion never exceeds what is still outstanding.
8.2 Payouts are paid within **${x.payout_days} days** of the Statement and recorded in the Portal with proof. The Investor confirms receipt in the Portal.
8.3 Payouts come from Profit only. **The Company owes nothing in a month without Profit.** No Payout is ever owed from the Fund itself, from the Company's other money, or personally by anyone.
8.4 The Company may pay early or pay more; it never has to.

## 9. After the Recovery Target is reached
9.1 The Recovery portion stops. The Permanent Share of **${share}** continues for as long as the Company earns Profit, on the same monthly Statements.
9.2 ${isEquity ? 'Ownership: the Investor holds a ' + share + ' membership interest, ' + (a.equity_vesting_mode === 'pro_rata' ? 'vesting in proportion to the Funded Amount over the Commitment' : 'issued in full at signing') + '. Membership terms are set out in the Company\'s operating agreement, which prevails on ownership matters.' : shareType === 'PROFIT_SHARE' ? 'The Permanent Share is a right to money, not ownership. It ends only under clauses 11, 12 or 13.' : PH('EQUITY OR PROFIT-SHARE WORDING FOR CLAUSE 9.2')}

## 10. If funding stops before the Commitment is reached
10.1 The Investor may stop at any time. The Company may close the Commitment in the Portal at the Funded Amount, with a written reason visible to the Investor. Open Capital Requests are cancelled.
10.2 The Recovery Target becomes the Funded Amount.
10.3 The Permanent Share becomes: ${stopMode === 'KEEP' ? '**the full ' + share + '**, unchanged.' : '**' + share + ' × (Funded Amount ÷ Commitment)** — pro-rated to what was actually paid. Example: ' + money(800000, cur) + ' of ' + cap + ' gives ' + pct((Number(a.permanent_share_pct) || 0) * 800000 / (Number(a.original_cap || a.commitment_cap) || 1)) + '.'}
10.4 Stopping is not a breach and carries no penalty. The Company may reopen the Commitment later by agreement, recorded in the Portal.
${a.early_stop_terms ? '10.5 Additional agreed wording: ' + a.early_stop_terms : ''}

## 11. Loss, shutdown and wind-down
11.1 If the Company cannot continue, the Company records a wind-down in the Portal with a written reason.
11.2 In this order: (a) cash still in the Fund is returned to the Investor; (b) equipment bought from the Fund is sold and the proceeds returned; (c) money already spent is recorded as lost and is not repaid.
11.3 Payouts already received are the Investor's and are not clawed back. The Recovery portion and Permanent Share both end.
11.4 A final Statement is published; both sides confirm the return in the Portal. Clause 3.3 (no personal liability) applies in full.

## 12. Sale of the Company
${exitPct ? '12.1 If the Company or substantially all of its business is sold, the Investor receives **' + exitPct + ' of the net proceeds** received by the Company\'s owners, paid within 30 days of the Company receiving them, whether or not the Recovery Target has been reached. This is a payment right only; it gives no ownership or vote.\n12.2 After that payment this agreement ends.' : (a.exit_treatment ? '12.1 ' + a.exit_treatment : PH('WHAT THE INVESTOR RECEIVES IF THE COMPANY IS SOLD'))}

## 13. Buyout
${a.buyout_terms ? '13.1 ' + a.buyout_terms + '\n13.2 The Investor is never obliged to sell.' : '13.1 After the Recovery Target is reached, the Company may offer to buy out the Permanent Share. ' + PH('BUYOUT PRICE FORMULA') + ' The Investor is never obliged to sell.'}

## 14. Information and the Portal
14.1 The Investor has continuous access to the Portal showing: every Tranche, every expense with receipt, the Fund balance, every Statement, every Payout, this agreement and its signatures, and aggregate business progress (counts only).
14.2 The Investor may question any entry in the Portal. The Company answers in the Portal within **${x.flag_answer_days} days**.
14.3 The Investor may export the ledger at any time and may have an accountant review it up to **${x.audit_per_year}** time(s) per year at the Investor's cost.
14.4 The Portal record is the record. Messages, calls and memory do not override it.

## 15. What the Investor does not do
15.1 No role in management, hiring, pricing, carriers, brokers or spending decisions. No veto.
15.2 No contact with the Company's carriers, brokers, shippers or staff on the Company's behalf.
15.3 Confidentiality: the Company's numbers, customers, rates and methods stay private, during and after this agreement.
15.4 The Investor may not assign or pledge this agreement without the Company's written consent.

## 16. Other investors
16.1 The Company may take money from others.${x.notify_new_investor ? ' It will tell the Investor in the Portal before a new investor is added.' : ''} The Investor's percentages under this agreement do not change because another investor joins.

## 17. Currency and taxes
17.1 All amounts are in **${cur}**. Any other currency shown in the Portal is for convenience only.
17.2 Each side bears its own taxes. If the law requires the Company to withhold tax from a Payout, it will, and will record it in the Portal.

## 18. Death, incapacity, transfer
18.1 If the Investor dies or loses capacity, the Investor's heirs or representative step into the money rights only (Payouts, returns, sale participation), on proof of entitlement. No management rights arise.
18.2 The Company may pause Payouts until entitlement is clear, then pay the paused amounts.

## 19. Delays outside anyone's control
19.1 Neither side is in breach for delay caused by events outside its reasonable control (banking outages, regulation, disasters). Obligations resume when the event ends.

## 20. Disputes
20.1 First, the two sides talk — within 30 days of a written notice in the Portal.
20.2 Then, a neutral person both accept: ${or(x.mediator, 'NAMED MEDIATOR OR HOW ONE IS CHOSEN')}.
20.3 Then, the courts. Governing law and venue: ${or(x.governing_law, 'GOVERNING LAW AND VENUE')}.
20.4 The Portal keeps running during any dispute.

## 21. General
21.1 This agreement replaces all earlier conversations and messages about this investment.
21.2 Changes are made in writing and signed by both sides — a new version published and signed in the Portal is such a writing.
21.3 If a clause is unenforceable, the rest stands.
21.4 Notices are given in the Portal and by email to the addresses on file.
21.5 The English text governs. Translations shown in the Portal are for convenience.

## 22. Electronic signature
22.1 Both sides agree to sign electronically in the Portal. A signature records the signer's typed name, an optional drawn signature, the time, the device, and a cryptographic hash of exactly this text. A signature is valid only against the version it was made on.
22.2 Each side may download this signed document at any time.

## 23. Changes the Investor may start from the Portal
23.1 The Investor may propose in the Portal: to raise or lower the Commitment (never below the Funded Amount), to stop funding at the Funded Amount, or to resume after a stop.
23.2 A proposal binds no one until the Company accepts it in the Portal. The Company answers within **${x.request_response_days} days**, with a written reason if it declines. The Investor may withdraw a proposal before it is decided.
23.3 When accepted, the change applies at once to the Portal figures, this document is marked **out of date**, and the Company publishes a new version reflecting the change. Both sides sign the new version. Until then the last fully signed version, together with the accepted change in the Portal record, governs.
23.4 Lowering the Commitment to the Funded Amount is the same as stopping under clause 10; the pro-rata rule in clause 10.3 applies.

## 24. Seeing and acknowledging entries
24.1 Every Capital Request, Tranche, expense, Statement and Payout appears in the Portal as soon as it is recorded, with the plain-language meaning of what was bought and why.
24.2 The Investor may mark an expense as **seen**, or **question** it (clause 14.2). Silence is neither agreement nor objection: the Portal record stands and any entry may still be questioned later.
24.3 The Portal shows the Investor what is new since their last visit.

## 25. Questions investors usually ask — the answers are part of this agreement
**Can I get my money back early?** No. Money already spent is not returned. Cash still unspent in the Fund is returned only on wind-down (clause 11) or by agreement.
**Can I put in more than the Commitment?** Only after the Commitment is raised in the Portal (clause 23). Money above it is not accepted.
**Can I stop after paying part?** Yes, at any time, from the Portal, without penalty (clauses 10 and 23).
**Is my money kept in a separate bank account?** ${or(x.separate_account, 'SEPARATE ACCOUNT: YES / NO — and where')}
**Can I see bank statements?** The Investor sees every entry and receipt in the Portal, and may have an accountant review the ledger once a year (clause 14.3). ${or(x.bank_statement_access, 'BANK STATEMENT ACCESS: yes on request / no')}
**Who owns the LoadBoot software, brand and customers?** The Company. This agreement gives the Investor money rights only (clause 3.4).
**What if the Company takes a bigger investor or venture money later?** The Investor is told in the Portal first (clause 16). The Investor's percentages under this agreement do not change. On a sale, clause 12 applies.
**What if the owner dies, leaves or cannot work?** The Company continues with its remaining members. ${or(x.key_person, 'KEY PERSON RULE: e.g. if the founder cannot run the Company for 90+ days, the Investor may ask for wind-down under clause 11')}
**Who else is behind the Company?** ${or(x.other_members, 'OTHER MEMBERS / CO-FOUNDERS and whether they are on the Company record')}
**Can I sell or give my rights to someone else?** Not without the Company's written consent (clause 15.4). On death, clause 18 applies.
**Is there a minimum profit or guaranteed return?** No (clause 3.2). A month without Profit pays nothing.
**How is Profit checked?** From the Statement; every expense is tagged, receipted and questionable in the Portal (clauses 7, 14).
**What currency am I paid in?** ${cur} (clause 17).
**Can I visit the office or meet the team?** ${or(x.visits, 'VISITS: e.g. yes, on reasonable notice')}
**What happens if the Company breaks this agreement?** Clause 20 (talk → neutral person → courts). The Portal record is the evidence.
`;
}

function UR({ a, investor, x, cur, cap, pay, share, isEquity, shareType, stopMode, exitPct, target }) {
  const inv = or(investor && investor.name, 'INVESTOR KA POORA NAAM');
  return `# Investment Agreement (Sarmaya-kari ka Muahida)

**Fareeqain:** ${x.company_name}, ${x.company_state} mein registered limited liability company (**Company**), jis ki taraf se ${x.company_signer}, ${x.company_signer_title} sign kar rahe hain — **aur** ${inv} (**Investor**).

Ye agreement jaan boojh kar aasan zubaan mein likha gaya hai. Is ka har number Investor Portal mein live dikhta hai, aur Portal ka record hi wo record hai jis par dono fareeq bharosa karte hain. **English matn asal hai; ye tarjuma sirf samajhne ke liye hai.**

## 1. Pas-manzar
Company LoadBoot chalati hai — trucking carriers ke liye dispatch aur load-management service. Investor Company ke operations mein paisa laga raha hai, jis ke badle usay neeche likhe hisaab se munafay ka hissa milega. Investor qarz nahi de raha aur koi fixed return nahi khareed raha.

## 2. Ta'reefein
| Lafz | Matlab |
|---|---|
| **Commitment** | Zyada se zyada jitna Investor dene par raazi hai: **${cap}**. Ye hadd hai, majboori nahi. |
| **Capital Request** | Company ki Portal mein ki gayi talab — raqam aur maqsad ke sath. |
| **Tranche (Qist)** | Investor ki ek adayegi kisi Capital Request ke jawab mein (ya bina request ke darj). |
| **Funded Amount** | Wo kul raqam jo DONO fareeqon ne Portal mein confirm ki ho. Sirf confirmed paisa ginta hai. |
| **Fund** | Funded Amount manfi jo us mein se kharch ho chuka. |
| **Profit (Munafa)** | Kisi mahine mein asal mein WASOOL hui aamdani manfi clause 7 ke kharche. |
| **Recovery Target** | ${target ? 'Fixed raqam **' + target + '**.' : '**Funded Amount** — jitna Investor ne asal mein diya, us se zyada nahi.'} |
| **Recovery Period** | Pehli qist se le kar us waqt tak jab Recovery Target Payouts ke zariye poora ho jaye. |
| **Permanent Share** | Munafay ka **${share}** — jab tak Company munafa kamaye, clause 10 aur 11 ke tabe. |
| **Statement** | Portal mein publish hone wala mahana munafay ka hisaab. |
| **Payout** | Kisi Statement par Company ki Investor ko adayegi, jise Investor Portal mein confirm kare. |
| **Portal** | loadboot.com/app/investor ka Investor Portal aur Company ka Command Center jo is mein likhta hai. |

## 3. Ye investment kya hai — aur kya nahi
3.1 Paisa **khatre mein** hai. Agar Company munafa na kamaye to us muddat ka Investor ko kuch nahi milta. Agar Company nakaam ho jaye to jo kharch ho chuka wo ja sakta hai (clause 11).
3.2 Ye **qarz nahi**. Na sood, na wapsi ki koi fixed tareekh, na koi guaranteed return.
3.3 **Koi zaati zimmedari nahi.** Na ${x.company_signer} aur na Company ka koi aur member, officer ya mulazim Investor ke samne zaati tor par zimmedar hai. Investor ka haq sirf Company par hai.
3.4 ${isEquity ? 'Investor ko Company mein **malkiyat (membership interest)** milti hai — clause 9 ke mutabiq. ' : shareType === 'PROFIT_SHARE' ? 'Investor ko **malkiyat nahi milti**, na voting, na management mein jagah. Investor ke haqooq sirf paise ke hain: Recovery Payouts, Permanent Share, aur clause 12 ka bikri ka hissa. ' : PH('5% KI NAUIYAT — EQUITY YA PROFIT SHARE') + ' '}

## 4. Commitment aur Capital Requests
4.1 Company Portal mein Capital Request uthayegi — raqam, maqsad, category. Kul qistein Commitment se zyada nahi hongi jab tak dono fareeq likhit mein Commitment na badlein (Company ka Portal mein edit, jo Investor ko nazar aaye, likhit shumar hoga).
4.2 Investor **${x.request_response_days} din** mein jawab dega — paisa de kar, ya inkaar kar ke. Kisi request par inkaar **khilaf-warzi nahi** — Funded Amount bas wahin rehta hai.
4.3 Baqi Commitment se zyada paisa tab tak qubool nahi jab tak Portal mein Commitment barhai na jaye.
4.4 Sign ke waqt **${money(a.position && a.position.funded, cur)}** funded aur confirmed hai.

## 5. Adayegi, tasdeeq aur saboot
5.1 Portal Company ki payment details dikhata hai. Investor sirf unhi par paisa bhejega.
5.2 Bhejne ke baad Investor Portal mein "paid" mark karega — raqam, tareekh, tareeqa, reference aur saboot (bank slip ya screenshot, Portal ki private storage mein upload).
5.3 Company Portal mein wasooli confirm karegi. **Qist sirf dono tasdeeqon ke baad ginti hai.** Jo declared payment Company ko na mile, Portal mein likhit wajah ke sath reject hogi; Investor behtar saboot ke sath dobara declare kar sakta hai.
5.4 Confirmed entry kabhi edit nahi hoti. Ghalti ka izala ek nazar aane wali reversal entry se hota hai, wajah ke sath, aur koi bhi entry sirf ek dafa reverse ho sakti hai.

## 6. Fund ka istemal
6.1 Fund sirf Company ke kaarobar par lagega: office, staff, equipment, tools aur subscriptions, professional fees, marketing aur aise operating kharche.
6.2 Har kharcha adayegi ke **48 ghante** ke andar Portal mein darj hoga — kis qist se, kis category ka, aur receipt (jahan ho).
6.3 Kharch shuda paisa wapis nahi hota, siwaye clause 11 ke wind-down ke.

## 7. Munafa — formula
7.1 Kisi mahine ka **Munafa** = us mahine asal mein **wasool** hui aamdani (sirf invoice bhejna nahi ginta) **manfi**:
${or(a.profit_definition, 'KHARCHON KI TAY-SHUDA LIST — kiraya, utilities, salary aur commission, tools/subscriptions, professional fees, bank charges, equipment ya us ki depreciation, tax')}
7.2 ${x.owner_salary_in_expenses ? 'Malik ki tankhwah: ' + x.owner_salary_in_expenses : PH('MALIK KI APNI TANKHWAH KHARCHA HAI YA NAHI, AUR US KI HADD')}
7.3 ${x.tax_treatment ? 'Tax: ' + x.tax_treatment : PH('COMPANY KE TAX FORMULA MEIN KAISE GINE JAYENGE')}
7.4 Company har mahine ka Statement agle mahine ki **${x.statement_day} tareekh** tak Portal mein publish karegi — aamdani, kharche, Munafa aur Investor ka Payout.
7.5 ${a.loss_carry_forward ? '**Nuqsan aage jata hai.** Jis mahine Munafa manfi ho, wo nuqsan ek pool mein jama hota hai. Baad ka Munafa pehle pool bharta hai; Payout sirf us se ooper ke Munafay par nikalta hai. Pool mein sirf is agreement ke shuru ke baad ke mahine ginte hain.' : '**Har mahina alag hai.** Jis mahine Munafa nahi, us mahine kuch nahi milta aur wo agle mahine mein nahi jata. Koi raqam udhaar ke tor par jama nahi hoti.'}

## 8. Recovery Period mein Investor ka hissa
8.1 Har us Statement par jis mein Munafa musbat ho, Investor ko milega: **Munafay ka ${pay}** Recovery Target ki taraf, **aur Munafay ka ${share}** Permanent Share ke tor par. Recovery ka hissa kabhi baqi raqam se zyada nahi hoga.
8.2 Payout Statement ke **${x.payout_days} din** ke andar ada hoga aur Portal mein saboot ke sath darj hoga. Investor Portal mein wasooli confirm karega.
8.3 Payout sirf Munafay se aata hai. **Jis mahine Munafa nahi, Company par kuch wajib nahi.** Koi Payout kabhi Fund se, Company ke doosre paise se, ya kisi ki zaati jeb se wajib nahi hota.
8.4 Company pehle ya zyada ada kar sakti hai; majboor kabhi nahi.

## 9. Recovery Target poora hone ke baad
9.1 Recovery ka hissa ruk jata hai. **${share}** ka Permanent Share jab tak Company Munafa kamaye, unhi mahana Statements par jari rehta hai.
9.2 ${isEquity ? 'Malkiyat: Investor ke paas ' + share + ' membership interest hai, ' + (a.equity_vesting_mode === 'pro_rata' ? 'jo Funded Amount ÷ Commitment ke tanasub se vest hota hai' : 'jo sign par poora jari hota hai') + '. Malkiyat ke mamlaat mein Company ka operating agreement chalega.' : shareType === 'PROFIT_SHARE' ? 'Permanent Share paise ka haq hai, malkiyat nahi. Ye sirf clause 11, 12 ya 13 ke tahat khatam hota hai.' : PH('CLAUSE 9.2 KE LIYE EQUITY YA PROFIT-SHARE KA MATN')}

## 10. Agar Commitment poora hone se pehle paisa ruk jaye
10.1 Investor kabhi bhi ruk sakta hai. Company Portal mein Commitment ko Funded Amount par band kar degi, likhit wajah ke sath jo Investor ko nazar aaye. Khuli Capital Requests cancel hongi.
10.2 Recovery Target = Funded Amount.
10.3 Permanent Share ban jayega: ${stopMode === 'KEEP' ? '**poora ' + share + '**, bila tabdeeli.' : '**' + share + ' × (Funded Amount ÷ Commitment)** — jitna diya utna hissa. Misal: ' + cap + ' mein se ' + money(800000, cur) + ' par ' + pct((Number(a.permanent_share_pct) || 0) * 800000 / (Number(a.original_cap || a.commitment_cap) || 1)) + '.'}
10.4 Rukna khilaf-warzi nahi, koi jurmana nahi. Baad mein dono ki razamandi se Commitment dobara khul sakti hai — Portal mein record ke sath.
${a.early_stop_terms ? '10.5 Mazeed tay-shuda alfaz: ' + a.early_stop_terms : ''}

## 11. Nuqsan, band hona aur wind-down
11.1 Agar Company chal na sake, Company Portal mein likhit wajah ke sath wind-down record karegi.
11.2 Is tarteeb se: (a) Fund mein jo cash bacha ho Investor ko wapis; (b) Fund se khareeda saman bech kar raqam wapis; (c) jo kharch ho chuka wo nuqsan ke tor par darj — wapis nahi.
11.3 Jo Payouts mil chuke wo Investor ke hain, wapis nahi liye jayenge. Recovery aur Permanent Share dono khatam.
11.4 Aakhri Statement publish hoga; dono fareeq wapsi Portal mein confirm karenge. Clause 3.3 (koi zaati zimmedari nahi) poori tarah lagu hai.

## 12. Company ki bikri
${exitPct ? '12.1 Agar Company ya us ka taqreeban poora kaarobar bik jaye, to Investor ko Company ke maalikaan ko milne wali **net raqam ka ' + exitPct + '** milega — Company ko raqam milne ke 30 din ke andar — chahe Recovery Target poora hua ho ya nahi. Ye sirf adayegi ka haq hai; malkiyat ya vote nahi deta.\n12.2 Us adayegi ke baad ye agreement khatam.' : (a.exit_treatment ? '12.1 ' + a.exit_treatment : PH('COMPANY BIKNE PAR INVESTOR KO KYA MILEGA'))}

## 13. Buyout
${a.buyout_terms ? '13.1 ' + a.buyout_terms + '\n13.2 Investor bechne par kabhi majboor nahi.' : '13.1 Recovery Target ke baad Company Permanent Share khareedne ki peshkash kar sakti hai. ' + PH('BUYOUT KI QEEMAT KA FORMULA') + ' Investor bechne par kabhi majboor nahi.'}

## 14. Maloomat aur Portal
14.1 Investor ko Portal tak musalsal rasai hai: har qist, har kharcha receipt ke sath, Fund ka balance, har Statement, har Payout, ye agreement aur dastakhat, aur kaarobar ki majmui taraqqi (sirf ginti).
14.2 Investor Portal mein kisi bhi entry par sawal utha sakta hai. Company **${x.flag_answer_days} din** mein Portal mein jawab degi.
14.3 Investor kabhi bhi ledger export kar sakta hai aur saal mein **${x.audit_per_year}** dafa apne kharche par accountant se jaanch karwa sakta hai.
14.4 Portal ka record hi record hai. Messages, calls aur yaad-dasht is par ghalib nahi.

## 15. Jo Investor nahi karega
15.1 Management, hiring, rates, carriers, brokers ya kharche ke faislon mein koi kirdar nahi. Koi veto nahi.
15.2 Company ki taraf se carriers, brokers, shippers ya staff se koi rabta nahi.
15.3 Raazdaari: Company ke numbers, customers, rates aur tareeqe — agreement ke dauran aur baad — private rahenge.
15.4 Investor Company ki likhit ijazat ke bagair ye agreement kisi ko muntaqil ya girwi nahi kar sakta.

## 16. Doosre investors
16.1 Company doosron se paisa le sakti hai.${x.notify_new_investor ? ' Naya investor shamil karne se pehle Portal mein Investor ko batayegi.' : ''} Doosra investor aane se is agreement ke Investor ke percentages nahi badalte.

## 17. Currency aur tax
17.1 Saari raqmein **${cur}** mein hain. Portal mein koi aur currency sirf sahoolat ke liye dikhti hai.
17.2 Har fareeq apna tax khud bhare ga. Agar qanoon Company ko Payout se tax rokne par majboor kare, wo rokegi aur Portal mein darj karegi.

## 18. Wafat, ma'zoori, muntaqili
18.1 Investor ki wafat ya ma'zoori par us ke waris ya numainda sirf paise ke haqooq (Payouts, wapsi, bikri ka hissa) mein us ki jagah lenge — haq ka saboot dene par. Management ka koi haq paida nahi hota.
18.2 Company haq saaf hone tak Payouts rok sakti hai, phir ruki hui raqam ada karegi.

## 19. Qaboo se bahar takheer
19.1 Bank ki bandish, qanoon, aafat jaise waqiat se hone wali takheer khilaf-warzi nahi. Waqia khatam hote hi zimmedariyan bahal.

## 20. Ikhtilaf
20.1 Pehle dono baat karenge — Portal mein likhit notice ke 30 din ke andar.
20.2 Phir ek aisa shakhs jise dono maanein: ${or(x.mediator, 'NAAM YA CHUNNE KA TAREEQA')}.
20.3 Phir adalat. Lagu qanoon aur adalat: ${or(x.governing_law, 'QANOON AUR ADALAT')}.
20.4 Ikhtilaf ke dauran bhi Portal chalta rahega.

## 21. Aam shartein
21.1 Ye agreement is investment ke bare mein pichli tamam baaton aur messages ki jagah leta hai.
21.2 Tabdeeli likhit aur dono ke dastakhat se hogi — Portal mein publish aur sign shuda naya version aisi hi likhit hai.
21.3 Koi clause na chale to baqi qaim rehta hai.
21.4 Notice Portal mein aur record shuda email par di jayegi.
21.5 English matn asal hai; Portal ka tarjuma sahoolat ke liye hai.

## 22. Electronic dastakhat
22.1 Dono fareeq Portal mein electronic dastakhat par raazi hain. Dastakhat mein type kiya naam, ikhtiyari khincha hua signature, waqt, device, aur bilkul isi matn ka cryptographic hash record hota hai. Dastakhat sirf usi version par jaiz hai jis par kiya gaya.
22.2 Har fareeq sign shuda document kabhi bhi download kar sakta hai.

## 23. Jo tabdeeliyan Investor Portal se shuru kar sakta hai
23.1 Investor Portal mein tajweez kar sakta hai: Commitment barhana ya ghatana (Funded Amount se neeche kabhi nahi), Funded Amount par funding rokna, ya rukne ke baad dobara shuru karna.
23.2 Tajweez kisi ko paband nahi karti jab tak Company Portal mein qabool na kare. Company **${x.request_response_days} din** mein jawab deti hai, inkaar ho to likhi wajah ke sath. Faisle se pehle Investor tajweez wapis le sakta hai.
23.3 Qabool hone par tabdeeli Portal ke aadad par foran lagu hoti hai, ye document **purana** nishan-zad ho jata hai, aur Company nayi version publish karti hai. Dono fareeq nayi version par sign karte hain. Tab tak aakhri poori sign shuda version + Portal record mein qabool shuda tabdeeli lagu hai.
23.4 Commitment ko Funded Amount tak ghatana shaq 10 ke rukne jaisa hai; shaq 10.3 ka pro-rata usool lagu hoga.

## 24. Entries dekhna aur tasdeeq karna
24.1 Har Capital Request, Tranche, kharcha, Statement aur Payout record hote hi Portal mein nazar aata hai, saade alfaz mein ke kya khareeda aur kyun.
24.2 Investor kharche ko **dekh liya** nishan laga sakta hai, ya us par **sawal** utha sakta hai (shaq 14.2). Khamoshi na razamandi hai na aitraaz: Portal record qaim rehta hai aur baad mein bhi sawal ho sakta hai.
24.3 Portal Investor ko batata hai ke pichli baar ke baad naya kya hai.

## 25. Jo sawal investor aksar poochte hain — jawab is agreement ka hissa hain
**Kya main apna paisa jaldi wapis le sakta hoon?** Nahi. Kharch shuda paisa wapis nahi hota. Fund mein bacha hua cash sirf wind-down (shaq 11) ya bahami razamandi se wapis hota hai.
**Kya main Commitment se zyada de sakta hoon?** Sirf jab Commitment Portal mein barha di jaye (shaq 23). Us se upar paisa qabool nahi.
**Kya kuch de kar ruk sakta hoon?** Haan, kabhi bhi, Portal se, bina jurmana (shaq 10 aur 23).
**Kya mera paisa alag bank account mein rakha jata hai?** ${or(x.separate_account, 'ALAG ACCOUNT: HAAN / NAHI — aur kahan')}
**Kya main bank statements dekh sakta hoon?** Investor Portal mein har entry aur raseed dekhta hai, aur saal mein ek baar accountant se ledger check karwa sakta hai (shaq 14.3). ${or(x.bank_statement_access, 'BANK STATEMENT: darkhwast par haan / nahi')}
**LoadBoot ka software, brand aur customers kis ke hain?** Company ke. Ye agreement Investor ko sirf paise ke huqooq deta hai (shaq 3.4).
**Agar Company baad mein bara investor ya venture paisa le?** Investor ko pehle Portal mein bataya jayega (shaq 16). Is agreement ke fisad nahi badalte. Sale par shaq 12 lagu hai.
**Agar malik faut ho jaye, chhor de ya kaam na kar sake?** Company apne baqi members ke sath chalti hai. ${or(x.key_person, 'KEY PERSON USOOL: maslan founder 90+ din Company na chala sake to Investor shaq 11 ke tahat wind-down maang sakta hai')}
**Company ke peeche aur kaun hai?** ${or(x.other_members, 'DEEGAR MEMBERS / CO-FOUNDERS aur kya wo Company record par hain')}
**Kya main apne huqooq kisi aur ko bech ya de sakta hoon?** Company ki likhi ijazat ke bagair nahi (shaq 15.4). Wafat par shaq 18.
**Kya kam se kam munafa ya guaranteed wapsi hai?** Nahi (shaq 3.2). Bina munafay ka mahina kuch nahi deta.
**Munafa kaise check hota hai?** Statement se; har kharcha tag shuda, raseed ke sath, aur Portal mein sawal ke qabil (shaq 7, 14).
**Mujhe kis currency mein milega?** ${cur} (shaq 17).
**Kya main office aa sakta hoon ya team se mil sakta hoon?** ${or(x.visits, 'VISITS: maslan haan, munasib ittila par')}
**Agar Company ye agreement tore to?** Shaq 20 (baat → neutral shakhs → adalat). Portal record saboot hai.
`;
}

// Minimal markdown → HTML for the portal/CC viewer (headings, tables, bold, lists, paragraphs).
export function mdToHtml(md) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const inline = (s) => esc(s).replace(/&lt;span class="ph"&gt;(.*?)&lt;\/span&gt;/g, '<span class="ph">$1</span>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const lines = md.split('\n'); let out = [], i = 0;
  while (i < lines.length) {
    const L = lines[i];
    if (/^\|/.test(L)) { const rows = []; while (i < lines.length && /^\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const cells = rows.filter(r => !/^\|\s*-/.test(r)).map(r => r.replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim())));
      out.push('<table><tr>' + cells[0].map(c => '<th>' + c + '</th>').join('') + '</tr>' + cells.slice(1).map(r => '<tr>' + r.map(c => '<td>' + c + '</td>').join('') + '</tr>').join('') + '</table>'); continue; }
    if (/^# /.test(L)) out.push('<h1>' + inline(L.slice(2)) + '</h1>');
    else if (/^## /.test(L)) out.push('<h2>' + inline(L.slice(3)) + '</h2>');
    else if (L.trim() === '') { /* skip */ }
    else out.push('<p>' + inline(L) + '</p>');
    i++;
  }
  return out.join('\n');
}

// اردو (Nastaliq script). Same clauses, same numbers; English text governs (clause 21.5).
function URS({ a, investor, x, cur, cap, pay, share, isEquity, shareType, stopMode, exitPct, target }) {
  const inv = or(investor && investor.name, 'سرمایہ کار کا پورا نام');
  return `# سرمایہ کاری کا معاہدہ

**فریقین:** ${x.company_name}، ${x.company_state} میں رجسٹرڈ لمیٹڈ لائبلٹی کمپنی (**کمپنی**)، جس کی طرف سے ${x.company_signer}، ${x.company_signer_title}، **اور** ${inv} (**سرمایہ کار**)۔

یہ معاہدہ جان بوجھ کر سادہ زبان میں لکھا گیا ہے۔ اس کا ہر نمبر انویسٹر پورٹل میں لائیو دکھتا ہے، اور پورٹل کا ریکارڈ ہی وہ ریکارڈ ہے جس پر دونوں فریق بھروسہ کرتے ہیں۔

## 1. پس منظر
کمپنی لوڈ بوٹ چلاتی ہے — ٹرکنگ کیریئرز کے لیے ڈسپیچ اور لوڈ مینجمنٹ سروس۔ سرمایہ کار کمپنی کے کاروبار میں پیسہ لگا رہا ہے جس کے بدلے اسے منافع میں حصہ ملے گا جیسا نیچے لکھا ہے۔ سرمایہ کار قرض نہیں دے رہا اور نہ کوئی مقررہ واپسی خرید رہا ہے۔

## 2. تعریفات
| اصطلاح | مطلب |
|---|---|
| **کمٹمنٹ** | زیادہ سے زیادہ جتنا سرمایہ کار دینے پر راضی ہوا: **${cap}**۔ یہ حد ہے، پابندی نہیں۔ |
| **کیپیٹل ریکویسٹ** | کمپنی کی پورٹل میں کی گئی درخواست — رقم اور مقصد کے ساتھ۔ |
| **قسط (ٹرانچ)** | کیپیٹل ریکویسٹ پر (یا اس کے بغیر) سرمایہ کار کی ایک ادائیگی۔ |
| **فنڈڈ اماؤنٹ** | تمام قسطوں کا مجموعہ جن کی **دونوں** فریقوں نے پورٹل میں تصدیق کی۔ صرف تصدیق شدہ پیسہ گنتا ہے۔ |
| **فنڈ** | فنڈڈ اماؤنٹ منفی جو اس میں سے خرچ ہو چکا۔ |
| **منافع** | کیلنڈر مہینے میں اصل میں وصول شدہ آمدنی، منفی شق 7 کے اخراجات۔ |
| **ریکوری ٹارگٹ** | ${target ? 'مقررہ رقم **' + target + '**۔' : '**فنڈڈ اماؤنٹ** — جتنا سرمایہ کار نے اصل میں دیا، اس سے زیادہ نہیں۔'} |
| **ریکوری پیریڈ** | پہلی قسط سے اس وقت تک جب ریکوری ٹارگٹ پے آؤٹس کے ذریعے واپس ہو جائے۔ |
| **مستقل حصہ** | منافع کا **${share}**، جب تک کمپنی منافع کمائے، شق 10 اور 11 کے تابع۔ |
| **اسٹیٹمنٹ** | ماہانہ منافع کا حساب جو پورٹل میں شائع ہوتا ہے۔ |
| **پے آؤٹ** | اسٹیٹمنٹ پر کمپنی کی سرمایہ کار کو ادائیگی، جس کی سرمایہ کار پورٹل میں تصدیق کرتا ہے۔ |
| **پورٹل** | loadboot.com/app/investor پر انویسٹر پورٹل، اور کمپنی کا کمانڈ سینٹر جو اس میں لکھتا ہے۔ |

## 3. یہ سرمایہ کاری کیا ہے — اور کیا نہیں
3.1 پیسہ **خطرے میں** ہے۔ اگر کمپنی منافع نہ کمائے تو اس مدت کا سرمایہ کار کو کچھ نہیں ملتا۔ اگر کمپنی ناکام ہو جائے تو خرچ شدہ رقم ضائع ہو سکتی ہے (شق 11)۔
3.2 یہ **قرض نہیں** ہے۔ نہ سود، نہ مقررہ تاریخِ واپسی، نہ ضمانت شدہ منافع۔
3.3 **کوئی ذاتی ذمہ داری نہیں۔** نہ ${x.company_signer} اور نہ کمپنی کا کوئی اور ممبر، افسر یا ملازم سرمایہ کار کے سامنے ذاتی طور پر ذمہ دار ہے۔ سرمایہ کار کا واحد سہارا کمپنی ہے۔
3.4 ${isEquity ? 'سرمایہ کار کو کمپنی میں **ملکیت (ممبرشپ انٹرسٹ)** ملتی ہے — شق 9 کے مطابق۔ ' : shareType === 'PROFIT_SHARE' ? 'سرمایہ کار کو **ملکیت نہیں ملتی**، نہ ووٹ، نہ انتظامیہ میں جگہ۔ اس کے حقوق صرف پیسے کے ہیں: ریکوری پے آؤٹس، مستقل حصہ، اور شق 12 کی فروخت میں شرکت۔ ' : PH('5% کی نوعیت — ایکویٹی یا منافع میں حصہ') + ' '}

## 4. کمٹمنٹ اور کیپیٹل ریکویسٹ
4.1 کمپنی پورٹل میں کیپیٹل ریکویسٹ اٹھا سکتی ہے — رقم، مقصد اور زمرہ لکھ کر۔ تمام قسطوں کا مجموعہ کمٹمنٹ سے زیادہ نہیں ہوگا جب تک دونوں فریق تحریری طور پر کمٹمنٹ نہ بدلیں (کمپنی کی پورٹل میں ترمیم، جو سرمایہ کار کو نظر آئے، تحریر شمار ہوگی)۔
4.2 سرمایہ کار **${x.request_response_days} دن** میں جواب دے گا — ادائیگی کر کے یا انکار کر کے۔ انکار **خلاف ورزی نہیں**؛ فنڈڈ اماؤنٹ جہاں ہے وہیں رہتا ہے۔
4.3 باقی کمٹمنٹ سے زیادہ رقم اس وقت تک قبول نہیں جب تک پورٹل میں کمٹمنٹ بڑھائی نہ جائے۔
4.4 دستخط کے وقت **${money(a.position && a.position.funded, cur)}** فنڈ اور تصدیق شدہ ہے۔

## 5. ادائیگی، تصدیق اور ثبوت
5.1 پورٹل کمپنی کی ادائیگی کی تفصیلات دکھاتا ہے۔ سرمایہ کار صرف انہی پر ادائیگی کرتا ہے۔
5.2 ادائیگی کے بعد سرمایہ کار پورٹل میں رقم، تاریخ، طریقہ، ریفرنس اور ثبوت (بینک سلپ یا اسکرین شاٹ، پورٹل کی نجی اسٹوریج میں) کے ساتھ اسے درج کرتا ہے۔
5.3 کمپنی پورٹل میں وصولی کی تصدیق کرتی ہے۔ **قسط دونوں تصدیقوں کے بعد ہی گنتی ہے۔** جو ادائیگی کمپنی کو نہ ملے وہ لکھی وجہ کے ساتھ مسترد ہوتی ہے؛ سرمایہ کار بہتر ثبوت کے ساتھ دوبارہ درج کر سکتا ہے۔
5.4 تصدیق شدہ اندراج کبھی ایڈٹ نہیں ہوتا۔ غلطی وجہ کے ساتھ ایک نظر آنے والے ریورسل اندراج سے درست ہوتی ہے، اور کوئی بھی اندراج صرف ایک بار ریورس ہو سکتا ہے۔

## 6. فنڈ کا استعمال
6.1 فنڈ صرف کمپنی کے کاروبار پر خرچ ہوتا ہے: دفتر، عملہ، سامان، ٹولز اور سبسکرپشنز، پیشہ ورانہ فیس، مارکیٹنگ اور ایسے ہی آپریٹنگ اخراجات۔
6.2 ہر خرچہ ادائیگی کے **48 گھنٹے** کے اندر پورٹل میں درج ہوتا ہے — کس قسط سے ادا ہوا اور کس زمرے کا، رسید کے ساتھ جہاں ہو۔
6.3 خرچ شدہ پیسہ واپس نہیں ہوتا، سوائے شق 11 کے وائنڈ ڈاؤن کے۔

## 7. منافع — فارمولا
7.1 کیلنڈر مہینے کا **منافع** = اس مہینے میں اصل میں **وصول** شدہ آمدنی (صرف جاری کردہ انوائس نہیں گنتی) **منفی**:
${or(a.profit_definition, 'اخراجات کی طے شدہ فہرست — کرایہ، یوٹیلیٹیز، تنخواہ اور کمیشن، ٹولز/سبسکرپشنز، پیشہ ورانہ فیس، بینک چارجز، سامان')}
7.2 ${x.owner_salary_in_expenses ? 'مالک کا معاوضہ: ' + x.owner_salary_in_expenses : PH('مالک کی اپنی تنخواہ خرچہ ہے یا نہیں، اور اس کی حد')}
7.3 ${x.tax_treatment ? 'ٹیکس: ' + x.tax_treatment : PH('کمپنی کے ٹیکس فارمولے میں کیسے گنے جائیں گے')}
7.4 کمپنی ہر مہینے کا اسٹیٹمنٹ اگلے مہینے کی **${x.statement_day} تاریخ** تک پورٹل میں شائع کرتی ہے — آمدنی، اخراجات، منافع اور سرمایہ کار کا پے آؤٹ۔
7.5 ${a.loss_carry_forward ? '**نقصان آگے جاتا ہے۔** منفی منافع والا مہینہ نقصان کا پول بناتا ہے۔ بعد کا منافع پہلے پول بھرتا ہے؛ پے آؤٹ صرف اس سے اوپر کے منافع پر بنتا ہے۔ پول میں صرف اس معاہدے کے مہینے گنتے ہیں۔' : '**مہینہ بہ مہینہ۔** نقصان والا مہینہ کچھ واجب نہیں کرتا اور آگے نہیں جاتا؛ اگلے منافع والے مہینے کا پے آؤٹ اسی مہینے پر بنتا ہے۔'}

## 8. ریکوری پیریڈ میں سرمایہ کار کی واپسی
8.1 مثبت منافع والے ہر اسٹیٹمنٹ پر سرمایہ کار کو ملتا ہے: **منافع کا ${pay}** ریکوری ٹارگٹ کی طرف، **مزید منافع کا ${share}** مستقل حصے کے طور پر۔ ریکوری کا حصہ کبھی باقی رقم سے زیادہ نہیں ہوتا۔
8.2 پے آؤٹ اسٹیٹمنٹ کے **${x.payout_days} دن** کے اندر ادا ہوتا ہے اور ثبوت کے ساتھ پورٹل میں درج ہوتا ہے۔ سرمایہ کار پورٹل میں وصولی کی تصدیق کرتا ہے۔
8.3 پے آؤٹ صرف منافع سے آتا ہے۔ **بغیر منافع کے مہینے میں کمپنی پر کچھ واجب نہیں۔** نہ فنڈ سے، نہ کمپنی کے دوسرے پیسے سے، نہ کسی پر ذاتی طور پر۔
8.4 کمپنی جلدی یا زیادہ ادا کر سکتی ہے؛ اسے کبھی ایسا کرنا نہیں پڑتا۔

## 9. ریکوری ٹارگٹ پورا ہونے کے بعد
9.1 ریکوری کا حصہ رک جاتا ہے۔ **${share}** کا مستقل حصہ اسی ماہانہ اسٹیٹمنٹ پر جاری رہتا ہے جب تک کمپنی منافع کمائے۔
9.2 ${isEquity ? 'ملکیت: سرمایہ کار کے پاس ' + share + ' ممبرشپ انٹرسٹ ہے، ' + (a.equity_vesting_mode === 'pro_rata' ? 'جو فنڈڈ اماؤنٹ ÷ کمٹمنٹ کے تناسب سے ویسٹ ہوتا ہے' : 'جو دستخط پر پورا جاری ہوتا ہے') + '۔ ملکیت کے معاملات میں کمپنی کا آپریٹنگ ایگریمنٹ فوقیت رکھتا ہے۔' : shareType === 'PROFIT_SHARE' ? 'مستقل حصہ پیسے کا حق ہے، ملکیت نہیں۔ یہ صرف شق 11، 12 یا 13 کے تحت ختم ہوتا ہے۔' : PH('ایکویٹی یا منافع میں حصے کی عبارت')}

## 10. اگر کمٹمنٹ پوری ہونے سے پہلے فنڈنگ رک جائے
10.1 سرمایہ کار کسی بھی وقت رک سکتا ہے۔ کمپنی پورٹل میں فنڈڈ اماؤنٹ پر کمٹمنٹ بند کر سکتی ہے، لکھی وجہ کے ساتھ جو سرمایہ کار کو نظر آئے۔ کھلی کیپیٹل ریکویسٹس منسوخ ہو جاتی ہیں۔
10.2 ریکوری ٹارگٹ فنڈڈ اماؤنٹ بن جاتا ہے۔
10.3 مستقل حصہ بن جاتا ہے: ${stopMode === 'KEEP' ? '**پورا ' + share + '**، بلا تبدیلی۔' : '**' + share + ' × (فنڈڈ اماؤنٹ ÷ کمٹمنٹ)** — جتنا دیا اس کے تناسب سے۔ مثال: ' + money(800000, cur) + ' از ' + money(2000000, cur) + ' → 2%۔'}
10.4 رکنا خلاف ورزی نہیں اور اس پر کوئی جرمانہ نہیں۔ کمپنی بعد میں باہمی رضامندی سے کمٹمنٹ دوبارہ کھول سکتی ہے، پورٹل میں درج۔
${a.early_stop_terms ? '10.5 مزید طے شدہ الفاظ: ' + a.early_stop_terms : ''}

## 11. نقصان، بندش اور وائنڈ ڈاؤن
11.1 اگر کمپنی جاری نہ رہ سکے تو کمپنی پورٹل میں لکھی وجہ کے ساتھ وائنڈ ڈاؤن درج کرتی ہے۔
11.2 اس ترتیب سے: (الف) فنڈ میں باقی نقد سرمایہ کار کو واپس؛ (ب) فنڈ سے خریدا سامان بیچ کر رقم واپس؛ (ج) خرچ شدہ پیسہ نقصان درج ہوتا ہے اور واپس نہیں ہوتا۔
11.3 پہلے سے ملے پے آؤٹ سرمایہ کار کے ہیں اور واپس نہیں لیے جاتے۔ ریکوری اور مستقل حصہ دونوں ختم۔
11.4 حتمی اسٹیٹمنٹ شائع ہوتا ہے؛ دونوں فریق پورٹل میں واپسی کی تصدیق کرتے ہیں۔ شق 3.3 (کوئی ذاتی ذمہ داری نہیں) پوری طرح لاگو۔

## 12. کمپنی کی فروخت
${exitPct ? '12.1 اگر کمپنی یا اس کا تقریباً پورا کاروبار بک جائے تو سرمایہ کار کو کمپنی کے مالکان کو ملنے والی **خالص رقم کا ' + exitPct + '** ملے گا، کمپنی کو ملنے کے 30 دن میں، چاہے ریکوری ٹارگٹ پورا ہوا ہو یا نہیں۔ یہ صرف ادائیگی کا حق ہے؛ نہ ملکیت نہ ووٹ۔\\n12.2 اس ادائیگی کے بعد یہ معاہدہ ختم۔' : (a.exit_treatment ? '12.1 ' + a.exit_treatment : '12.1 ' + PH('فروخت پر سرمایہ کار کو کیا ملے گا'))}

## 13. بائی آؤٹ
${a.buyout_terms ? '13.1 ' + a.buyout_terms + '\\n13.2 سرمایہ کار بیچنے پر کبھی مجبور نہیں۔' : '13.1 ریکوری ٹارگٹ کے بعد کمپنی مستقل حصہ خریدنے کی پیشکش کر سکتی ہے۔ ' + PH('بائی آؤٹ قیمت کا فارمولا') + ' سرمایہ کار بیچنے پر کبھی مجبور نہیں۔'}

## 14. معلومات اور پورٹل
14.1 سرمایہ کار کو پورٹل تک مسلسل رسائی ہے: ہر قسط، رسید کے ساتھ ہر خرچہ، فنڈ کا بیلنس، ہر اسٹیٹمنٹ، ہر پے آؤٹ، یہ معاہدہ اور اس کے دستخط، اور کاروبار کی مجموعی ترقی (صرف گنتی)۔
14.2 سرمایہ کار پورٹل میں کسی بھی اندراج پر سوال اٹھا سکتا ہے۔ کمپنی **${x.flag_answer_days} دن** میں پورٹل میں جواب دیتی ہے۔
14.3 سرمایہ کار کبھی بھی لیجر ایکسپورٹ کر سکتا ہے اور سال میں **${x.audit_per_year}** بار اپنے خرچ پر اکاؤنٹنٹ سے جانچ کروا سکتا ہے۔
14.4 پورٹل کا ریکارڈ ہی ریکارڈ ہے۔ پیغامات، کالیں اور یادداشت اسے رد نہیں کرتے۔

## 15. سرمایہ کار کیا نہیں کرتا
15.1 انتظام، بھرتی، قیمتوں، کیریئرز، بروکرز یا خرچ کے فیصلوں میں کوئی کردار نہیں۔ کوئی ویٹو نہیں۔
15.2 کمپنی کی طرف سے اس کے کیریئرز، بروکرز، شپرز یا عملے سے کوئی رابطہ نہیں۔
15.3 رازداری: کمپنی کے اعداد، گاہک، ریٹس اور طریقے نجی رہتے ہیں — معاہدے کے دوران اور بعد میں۔
15.4 سرمایہ کار کمپنی کی تحریری اجازت کے بغیر یہ معاہدہ منتقل یا گروی نہیں رکھ سکتا۔

## 16. دوسرے سرمایہ کار
16.1 کمپنی دوسروں سے پیسہ لے سکتی ہے۔${x.notify_new_investor ? ' نیا سرمایہ کار شامل کرنے سے پہلے پورٹل میں سرمایہ کار کو بتائے گی۔' : ''} دوسرے سرمایہ کار کے آنے سے اس معاہدے کے فیصد نہیں بدلتے۔

## 17. کرنسی اور ٹیکس
17.1 تمام رقمیں **${cur}** میں ہیں۔ پورٹل میں دکھائی کوئی اور کرنسی صرف سہولت کے لیے ہے۔
17.2 ہر فریق اپنا ٹیکس خود بھرتا ہے۔ اگر قانون کمپنی سے پے آؤٹ پر ٹیکس کٹوتی چاہے تو کمپنی کرے گی اور پورٹل میں درج کرے گی۔

## 18. وفات، معذوری، منتقلی
18.1 اگر سرمایہ کار فوت ہو جائے یا اہلیت کھو دے تو اس کے ورثا یا نمائندہ صرف پیسے کے حقوق (پے آؤٹ، واپسی، فروخت میں شرکت) میں اس کی جگہ لیتے ہیں، حق کے ثبوت پر۔ انتظامی حقوق پیدا نہیں ہوتے۔
18.2 کمپنی حق واضح ہونے تک پے آؤٹ روک سکتی ہے، پھر رکی رقم ادا کرے گی۔

## 19. قابو سے باہر تاخیر
19.1 بینکنگ بندش، ضوابط، آفات جیسے واقعات سے تاخیر پر کوئی فریق خلاف ورزی میں نہیں۔ واقعہ ختم ہونے پر ذمہ داریاں بحال۔

## 20. تنازعات
20.1 پہلے دونوں فریق بات کرتے ہیں — پورٹل میں تحریری نوٹس کے 30 دن میں۔
20.2 پھر ایک ایسا شخص جسے دونوں مانیں: ${or(x.mediator, 'نام یا چننے کا طریقہ')}۔
20.3 پھر عدالت۔ لاگو قانون اور عدالت: ${or(x.governing_law, 'قانون اور عدالت')}۔
20.4 کسی تنازعے کے دوران پورٹل چلتا رہتا ہے۔

## 21. عام شرائط
21.1 یہ معاہدہ اس سرمایہ کاری کے بارے میں تمام پچھلی باتوں اور پیغامات کی جگہ لیتا ہے۔
21.2 تبدیلی تحریری اور دونوں کے دستخط سے — پورٹل میں شائع اور دستخط شدہ نئی ورژن ایسی تحریر ہے۔
21.3 کوئی شق ناقابلِ نفاذ ہو تو باقی قائم رہتا ہے۔
21.4 نوٹس پورٹل میں اور ریکارڈ پر موجود ای میل پر دیے جاتے ہیں۔
21.5 انگریزی متن اصل ہے؛ پورٹل کا ترجمہ سہولت کے لیے ہے۔

## 22. الیکٹرانک دستخط
22.1 دونوں فریق پورٹل میں الیکٹرانک دستخط پر راضی ہیں۔ دستخط میں ٹائپ کیا نام، اختیاری کھینچا ہوا دستخط، وقت، ڈیوائس، اور بالکل اسی متن کا کرپٹوگرافک ہیش ریکارڈ ہوتا ہے۔ دستخط صرف اسی ورژن پر جائز ہے جس پر کیا گیا۔
22.2 ہر فریق دستخط شدہ دستاویز کبھی بھی ڈاؤن لوڈ کر سکتا ہے۔

## 23. جو تبدیلیاں سرمایہ کار پورٹل سے شروع کر سکتا ہے
23.1 سرمایہ کار پورٹل میں تجویز کر سکتا ہے: کمٹمنٹ بڑھانا یا گھٹانا (فنڈڈ اماؤنٹ سے نیچے کبھی نہیں)، فنڈڈ اماؤنٹ پر فنڈنگ روکنا، یا رکنے کے بعد دوبارہ شروع کرنا۔
23.2 تجویز کسی کو پابند نہیں کرتی جب تک کمپنی پورٹل میں قبول نہ کرے۔ کمپنی **${x.request_response_days} دن** میں جواب دیتی ہے، انکار ہو تو لکھی وجہ کے ساتھ۔ فیصلے سے پہلے سرمایہ کار تجویز واپس لے سکتا ہے۔
23.3 قبول ہونے پر تبدیلی پورٹل کے اعداد پر فوراً لاگو ہوتی ہے، یہ دستاویز **پرانی** نشان زد ہو جاتی ہے، اور کمپنی نئی ورژن شائع کرتی ہے۔ دونوں فریق نئی ورژن پر دستخط کرتے ہیں۔ تب تک آخری مکمل دستخط شدہ ورژن اور پورٹل ریکارڈ میں قبول شدہ تبدیلی لاگو ہے۔
23.4 کمٹمنٹ کو فنڈڈ اماؤنٹ تک گھٹانا شق 10 کے رکنے جیسا ہے؛ شق 10.3 کا تناسبی اصول لاگو ہوگا۔

## 24. اندراجات دیکھنا اور تصدیق کرنا
24.1 ہر کیپیٹل ریکویسٹ، قسط، خرچہ، اسٹیٹمنٹ اور پے آؤٹ درج ہوتے ہی پورٹل میں نظر آتا ہے، سادہ الفاظ میں کہ کیا خریدا اور کیوں۔
24.2 سرمایہ کار خرچے کو **دیکھ لیا** نشان لگا سکتا ہے، یا اس پر **سوال** اٹھا سکتا ہے (شق 14.2)۔ خاموشی نہ رضامندی ہے نہ اعتراض: پورٹل ریکارڈ قائم رہتا ہے اور بعد میں بھی سوال ہو سکتا ہے۔
24.3 پورٹل سرمایہ کار کو بتاتا ہے کہ پچھلی بار کے بعد نیا کیا ہے۔

## 25. جو سوال سرمایہ کار اکثر پوچھتے ہیں — جواب اس معاہدے کا حصہ ہیں
**کیا میں اپنا پیسہ جلدی واپس لے سکتا ہوں؟** نہیں۔ خرچ شدہ پیسہ واپس نہیں ہوتا۔ فنڈ میں بچا نقد صرف وائنڈ ڈاؤن (شق 11) یا باہمی رضامندی سے واپس ہوتا ہے۔
**کیا میں کمٹمنٹ سے زیادہ دے سکتا ہوں؟** صرف جب پورٹل میں کمٹمنٹ بڑھا دی جائے (شق 23)۔ اس سے اوپر پیسہ قبول نہیں۔
**کیا کچھ دے کر رک سکتا ہوں؟** ہاں، کبھی بھی، پورٹل سے، بغیر جرمانہ (شق 10 اور 23)۔
**کیا میرا پیسہ الگ بینک اکاؤنٹ میں رکھا جاتا ہے؟** ${or(x.separate_account, 'الگ اکاؤنٹ: ہاں / نہیں — اور کہاں')}
**کیا میں بینک اسٹیٹمنٹ دیکھ سکتا ہوں؟** سرمایہ کار پورٹل میں ہر اندراج اور رسید دیکھتا ہے، اور سال میں ایک بار اکاؤنٹنٹ سے لیجر چیک کروا سکتا ہے (شق 14.3)۔ ${or(x.bank_statement_access, 'بینک اسٹیٹمنٹ: درخواست پر ہاں / نہیں')}
**لوڈ بوٹ کا سافٹ ویئر، برانڈ اور گاہک کس کے ہیں؟** کمپنی کے۔ یہ معاہدہ سرمایہ کار کو صرف پیسے کے حقوق دیتا ہے (شق 3.4)۔
**اگر کمپنی بعد میں بڑا سرمایہ کار یا وینچر پیسہ لے؟** سرمایہ کار کو پہلے پورٹل میں بتایا جائے گا (شق 16)۔ اس معاہدے کے فیصد نہیں بدلتے۔ فروخت پر شق 12 لاگو۔
**اگر مالک فوت ہو جائے، چھوڑ دے یا کام نہ کر سکے؟** کمپنی اپنے باقی ممبرز کے ساتھ چلتی ہے۔ ${or(x.key_person, 'کلیدی شخص اصول: مثلاً بانی 90+ دن کمپنی نہ چلا سکے تو سرمایہ کار شق 11 کے تحت وائنڈ ڈاؤن مانگ سکتا ہے')}
**کمپنی کے پیچھے اور کون ہے؟** ${or(x.other_members, 'دیگر ممبرز / شریک بانی اور کیا وہ کمپنی ریکارڈ پر ہیں')}
**کیا میں اپنے حقوق کسی اور کو بیچ یا دے سکتا ہوں؟** کمپنی کی تحریری اجازت کے بغیر نہیں (شق 15.4)۔ وفات پر شق 18۔
**کیا کم از کم منافع یا ضمانت شدہ واپسی ہے؟** نہیں (شق 3.2)۔ بغیر منافع کا مہینہ کچھ نہیں دیتا۔
**منافع کیسے چیک ہوتا ہے؟** اسٹیٹمنٹ سے؛ ہر خرچہ ٹیگ شدہ، رسید کے ساتھ، اور پورٹل میں سوال کے قابل (شق 7، 14)۔
**مجھے کس کرنسی میں ملے گا؟** ${cur} (شق 17)۔
**کیا میں دفتر آ سکتا ہوں یا ٹیم سے مل سکتا ہوں؟** ${or(x.visits, 'ملاقات: مثلاً ہاں، مناسب اطلاع پر')}
**اگر کمپنی یہ معاہدہ توڑے تو؟** شق 20 (بات → غیر جانبدار شخص → عدالت)۔ پورٹل ریکارڈ ثبوت ہے۔
`;
}
