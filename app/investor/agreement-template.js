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
};

export function hasPlaceholders(md) { return /class="ph"/.test(md); }

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
  const D = lang === 'ur_roman' ? UR : EN;
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
