// glossary.js — plain-language explanations for a non-technical investor.
// Every vendor/tool LoadBoot pays for, every expense category and every money
// term gets ONE line in three languages: what it is and why LoadBoot pays for it.
// Rules: no jargon, no "AI runs everything" — a tool is a tool, a person does the work.
// Used by the investor portal (ledger rows, "?" buttons, glossary sheet) and by
// Command Center (auto-fills the expense description).
const L = (en, ur_roman, ur) => ({ en, ur_roman, ur });

export const VENDORS = [
  ['Netlify',              L('Website hosting — the company that keeps loadboot.com online.', 'Website hosting — jo company loadboot.com ko online rakhti hai.', 'ویب سائٹ ہوسٹنگ — وہ کمپنی جو loadboot.com کو آن لائن رکھتی ہے۔')],
  ['Supabase',             L('Database hosting — where all LoadBoot records (carriers, loads, accounts) are stored securely.', 'Database hosting — jahan LoadBoot ka saara record (carriers, loads, accounts) mehfooz rehta hai.', 'ڈیٹابیس ہوسٹنگ — جہاں لوڈ بوٹ کا سارا ریکارڈ (کیریئرز، لوڈز، اکاؤنٹس) محفوظ رہتا ہے۔')],
  ['Resend',               L('Email sending service — delivers LoadBoot\'s emails to carriers and brokers.', 'Email bhejne ki service — LoadBoot ki emails carriers aur brokers tak pohnchati hai.', 'ای میل بھیجنے کی سروس — لوڈ بوٹ کی ای میلز کیریئرز اور بروکرز تک پہنچاتی ہے۔')],
  ['Retell AI',            L('Phone-call software — the automated phone line that answers and records calls.', 'Phone-call software — automatic phone line jo calls uthati aur record karti hai.', 'فون کال سافٹ ویئر — خودکار فون لائن جو کالز اٹھاتی اور ریکارڈ کرتی ہے۔')],
  ['Telnyx',               L('Phone numbers & SMS — the US phone numbers LoadBoot calls and texts from.', 'Phone numbers aur SMS — LoadBoot ke US phone numbers jin se call aur message hote hain.', 'فون نمبرز اور ایس ایم ایس — لوڈ بوٹ کے امریکی فون نمبر جن سے کال اور میسج ہوتے ہیں۔')],
  ['Claude (Anthropic)',   L('Software subscription used by the team to build and improve the LoadBoot app.', 'Software subscription jo team LoadBoot app banane aur behtar karne ke liye istemal karti hai.', 'سافٹ ویئر سبسکرپشن جو ٹیم لوڈ بوٹ ایپ بنانے اور بہتر کرنے کے لیے استعمال کرتی ہے۔')],
  ['ChatGPT (OpenAI)',     L('Software subscription used by the team for writing and research.', 'Software subscription jo team likhne aur research ke liye istemal karti hai.', 'سافٹ ویئر سبسکرپشن جو ٹیم لکھنے اور ریسرچ کے لیے استعمال کرتی ہے۔')],
  ['Google Workspace',     L('Company email & documents — the @loadboot.com mailboxes and shared files.', 'Company email aur documents — @loadboot.com mailboxes aur shared files.', 'کمپنی ای میل اور دستاویزات — @loadboot.com میل باکسز اور مشترکہ فائلیں۔')],
  ['Domain / DNS',         L('The loadboot.com name — a yearly fee to own the web address.', 'loadboot.com naam — web address apne naam rakhne ki salana fee.', 'loadboot.com نام — ویب ایڈریس اپنے نام رکھنے کی سالانہ فیس۔')],
  ['Namecheap',            L('Where the loadboot.com name and the hello@ mailbox are registered.', 'Jahan loadboot.com naam aur hello@ mailbox register hain.', 'جہاں loadboot.com نام اور hello@ میل باکس رجسٹرڈ ہیں۔')],
  ['Apple Developer',      L('Yearly fee to publish the LoadBoot app on the Apple App Store.', 'Apple App Store par LoadBoot app rakhne ki salana fee.', 'ایپل ایپ اسٹور پر لوڈ بوٹ ایپ رکھنے کی سالانہ فیس۔')],
  ['Google Play',          L('One-time fee to publish the LoadBoot app on Google Play.', 'Google Play par LoadBoot app rakhne ki ek-baari fee.', 'گوگل پلے پر لوڈ بوٹ ایپ رکھنے کی ایک بار کی فیس۔')],
  ['Canva',                L('Design tool — for images, posts and documents.', 'Design tool — tasveerein, posts aur documents ke liye.', 'ڈیزائن ٹول — تصویریں، پوسٹس اور دستاویزات کے لیے۔')],
  ['Zoom',                 L('Video meetings with carriers, brokers and staff.', 'Carriers, brokers aur staff ke sath video meetings.', 'کیریئرز، بروکرز اور عملے کے ساتھ ویڈیو میٹنگز۔')],
  ['Office rent',          L('Monthly rent for the LoadBoot office.', 'LoadBoot office ka mahana kiraya.', 'لوڈ بوٹ آفس کا ماہانہ کرایہ۔')],
  ['Electricity',          L('Office electricity bill.', 'Office ka bijli ka bill.', 'آفس کا بجلی کا بل۔')],
  ['Internet',             L('Office internet connection.', 'Office ka internet connection.', 'آفس کا انٹرنیٹ کنکشن۔')],
  ['Dispatcher salary',    L('Pay for a dispatcher — the person who finds loads and books them for carriers.', 'Dispatcher ki tankhwah — wo shakhs jo carriers ke liye loads dhoondta aur book karta hai.', 'ڈسپیچر کی تنخواہ — وہ شخص جو کیریئرز کے لیے لوڈز ڈھونڈتا اور بک کرتا ہے۔')],
  ['Coordinator salary',   L('Pay for the office coordinator who manages the dispatch team day to day.', 'Office coordinator ki tankhwah jo dispatch team ko rozana chalata hai.', 'آفس کوآرڈینیٹر کی تنخواہ جو ڈسپیچ ٹیم کو روزانہ چلاتا ہے۔')],
  ['Furniture',            L('Desks, chairs and office fittings.', 'Mez, kursiyan aur office ka saman.', 'میز، کرسیاں اور آفس کا سامان۔')],
  ['Computers',            L('Laptops / PCs and headsets for dispatchers.', 'Dispatchers ke liye laptops / PCs aur headsets.', 'ڈسپیچرز کے لیے لیپ ٹاپس / پی سیز اور ہیڈسیٹس۔')],
];
export const VENDOR_NAMES = VENDORS.map(v => v[0]);
const VMAP = Object.fromEntries(VENDORS);
export function vendorWhat(name, lang) {
  if (!name) return '';
  const k = Object.keys(VMAP).find(n => n.toLowerCase() === String(name).trim().toLowerCase() || String(name).toLowerCase().startsWith(n.toLowerCase().split(' ')[0]));
  return k ? (VMAP[k][lang] || VMAP[k].en) : '';
}

export const CATEGORIES = {
  office:     L('Office — one-time setup costs (deposit, fittings).', 'Office — ek-baari setup kharche (deposit, fittings).', 'آفس — ایک بار کے سیٹ اپ اخراجات (ڈپازٹ، فٹنگز)۔'),
  rent:       L('Rent — the monthly office rent.', 'Kiraya — office ka mahana kiraya.', 'کرایہ — آفس کا ماہانہ کرایہ۔'),
  utilities:  L('Utilities — electricity, internet, phone.', 'Utilities — bijli, internet, phone.', 'یوٹیلیٹیز — بجلی، انٹرنیٹ، فون۔'),
  salary:     L('Salaries — pay for dispatchers and office staff.', 'Tankhwahein — dispatchers aur office staff ki pay.', 'تنخواہیں — ڈسپیچرز اور آفس عملے کی تنخواہ۔'),
  equipment:  L('Equipment — computers, headsets, furniture.', 'Saman — computers, headsets, furniture.', 'سامان — کمپیوٹرز، ہیڈسیٹس، فرنیچر۔'),
  tools:      L('Tools & subscriptions — the online services LoadBoot runs on (hosting, database, email, phone).', 'Tools aur subscriptions — online services jin par LoadBoot chalta hai (hosting, database, email, phone).', 'ٹولز اور سبسکرپشنز — آن لائن سروسز جن پر لوڈ بوٹ چلتا ہے (ہوسٹنگ، ڈیٹابیس، ای میل، فون)۔'),
  legal:      L('Legal & professional — lawyer, accountant, registrations.', 'Qanooni aur professional — wakeel, accountant, registrations.', 'قانونی اور پیشہ ورانہ — وکیل، اکاؤنٹنٹ، رجسٹریشنز۔'),
  relocation: L('Relocation — moving the team to the new office city.', 'Muntaqili — team ko naye office wale sheher le jana.', 'منتقلی — ٹیم کو نئے آفس والے شہر لے جانا۔'),
  marketing:  L('Marketing — ads and outreach to bring carriers and brokers.', 'Marketing — ads aur outreach taake carriers aur brokers aayein.', 'مارکیٹنگ — اشتہارات اور رابطہ تاکہ کیریئرز اور بروکرز آئیں۔'),
  misc:       L('Other — anything that fits no category; the note says what.', 'Deegar — jo kisi category mein nahi aata; note mein likha hai kya.', 'دیگر — جو کسی زمرے میں نہیں آتا؛ نوٹ میں لکھا ہے کیا۔'),
};
export const catWhat = (c, lang) => (CATEGORIES[c] || CATEGORIES.misc)[lang] || CATEGORIES[c]?.en || '';

// Money terms shown on the investor's screens.
export const TERMS = {
  commitment:  L('Commitment — the most you agreed to put in. A ceiling, not a debt.', 'Commitment — zyada se zyada jitna aap ne dene ka kaha. Had hai, qarz nahi.', 'کمٹمنٹ — زیادہ سے زیادہ جتنا آپ نے دینے کا کہا۔ حد ہے، قرض نہیں۔'),
  request:     L('Capital request — LoadBoot asks for a stated amount for a stated purpose. You may pay or decline.', 'Capital request — LoadBoot ek raqam ek maqsad ke liye maangta hai. Aap dein ya mana karein.', 'کیپیٹل ریکویسٹ — لوڈ بوٹ ایک رقم ایک مقصد کے لیے مانگتا ہے۔ آپ دیں یا منع کریں۔'),
  funded:      L('Funded — money you sent AND LoadBoot confirmed it received. Only this counts.', 'Diya hua — jo aap ne bheja AUR LoadBoot ne confirm kiya. Sirf yehi ginta hai.', 'دیا ہوا — جو آپ نے بھیجا اور لوڈ بوٹ نے تصدیق کی۔ صرف یہی گنتا ہے۔'),
  fund_cash:   L('Fund cash — your money not yet spent, sitting with LoadBoot.', 'Fund mein baqi — aap ka paisa jo abhi kharch nahi hua.', 'فنڈ میں باقی — آپ کا پیسہ جو ابھی خرچ نہیں ہوا۔'),
  spent:       L('Spent — money used from your tranches. Each expense shows what it bought.', 'Kharch hua — aap ki qiston se jo istemal hua. Har kharcha batata hai kya kharida.', 'خرچ ہوا — آپ کی قسطوں سے جو استعمال ہوا۔ ہر خرچہ بتاتا ہے کیا خریدا۔'),
  profit:      L('Profit — money actually collected in a month minus that month\'s expenses.', 'Munafa — mahine mein jo paisa asal mein aaya, minus us mahine ke kharche.', 'منافع — مہینے میں جو پیسہ اصل میں آیا، منفی اس مہینے کے اخراجات۔'),
  recovery:    L('Recovery — an agreed share of each month\'s profit comes back to you until your funded amount is fully returned.', 'Wapsi — har mahine ke munafay ka tay-shuda hissa aap ko milta hai jab tak poora diya hua paisa wapis na ho.', 'واپسی — ہر مہینے کے منافع کا طے شدہ حصہ آپ کو ملتا ہے جب تک پورا دیا ہوا پیسہ واپس نہ ہو۔'),
  share:       L('Permanent share — an agreed % of profit, every month, for as long as LoadBoot earns profit. Not ownership.', 'Mustaqil hissa — munafay ka tay-shuda %, har mahine, jab tak LoadBoot munafa kamaye. Malkiyat nahi.', 'مستقل حصہ — منافع کا طے شدہ %، ہر مہینے، جب تک لوڈ بوٹ منافع کمائے۔ ملکیت نہیں۔'),
  statement:   L('Statement — the monthly profit sheet LoadBoot publishes; your payout is calculated from it.', 'Statement — mahana munafay ka hisaab jo LoadBoot publish karta hai; aap ka payout isi se banta hai.', 'اسٹیٹمنٹ — ماہانہ منافع کا حساب جو لوڈ بوٹ شائع کرتا ہے؛ آپ کا پے آؤٹ اسی سے بنتا ہے۔'),
  payout:      L('Payout — money LoadBoot pays you for a statement. You confirm you received it.', 'Payout — jo paisa LoadBoot aap ko statement par deta hai. Aap confirm karte hain ke mila.', 'پے آؤٹ — جو پیسہ لوڈ بوٹ آپ کو اسٹیٹمنٹ پر دیتا ہے۔ آپ تصدیق کرتے ہیں کہ ملا۔'),
  no_profit:   L('No-profit month — nothing is owed for that month. Nothing piles up as debt.', 'Bina munafay ka mahina — us mahine kuch wajib nahi. Koi udhaar jama nahi hota.', 'بغیر منافع کا مہینہ — اس مہینے کچھ واجب نہیں۔ کوئی ادھار جمع نہیں ہوتا۔'),
  carrier:     L('Carrier — a trucking company (or owner-operator) that uses LoadBoot to get loads.', 'Carrier — truck company (ya owner-operator) jo loads lene ke liye LoadBoot istemal karti hai.', 'کیریئر — ٹرک کمپنی (یا اونر آپریٹر) جو لوڈز لینے کے لیے لوڈ بوٹ استعمال کرتی ہے۔'),
  broker:      L('Broker — a company that has freight to move and pays carriers to move it.', 'Broker — wo company jis ke paas maal hota hai aur jo carriers ko le jane ke paise deti hai.', 'بروکر — وہ کمپنی جس کے پاس مال ہوتا ہے اور جو کیریئرز کو لے جانے کے پیسے دیتی ہے۔'),
  dispatcher:  L('Dispatcher — a LoadBoot staff member who finds and books loads for carriers; LoadBoot earns a fee per load.', 'Dispatcher — LoadBoot ka staff jo carriers ke liye loads dhoondta aur book karta hai; LoadBoot ko har load par fee milti hai.', 'ڈسپیچر — لوڈ بوٹ کا عملہ جو کیریئرز کے لیے لوڈز ڈھونڈتا اور بک کرتا ہے؛ لوڈ بوٹ کو ہر لوڈ پر فیس ملتی ہے۔'),
  load:        L('Load — one shipment of freight from A to B. LoadBoot\'s income comes from loads delivered.', 'Load — ek maal ki khep A se B tak. LoadBoot ki aamdani deliver hue loads se aati hai.', 'لوڈ — ایک مال کی کھیپ A سے B تک۔ لوڈ بوٹ کی آمدنی ڈیلیور ہوئے لوڈز سے آتی ہے۔'),
};
export const termWhat = (k, lang) => TERMS[k] ? (TERMS[k][lang] || TERMS[k].en) : '';
