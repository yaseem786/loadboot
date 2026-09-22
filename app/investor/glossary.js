// glossary.js — plain-language explanations for a non-technical investor.
// Every vendor/tool LoadBoot pays for, every expense category and every money
// term gets ONE line in three languages: what it is and why LoadBoot pays for it.
// Rules: no jargon, no "AI runs everything" — a tool is a tool, a person does the work.
// Used by the investor portal (ledger rows, "?" buttons, glossary sheet) and by
// Command Center (auto-fills the expense description).
const L = (en, ur_roman, ur) => ({ en, ur_roman, ur });

export const VENDORS = [
  ['Netlify',              L('Website hosting — the company that keeps loadboot.com online.', 'Website hosting — ye wo company hai jis ke server par loadboot.com chalti hai. Iska bill na dein to site band ho jaye.', 'ویب سائٹ ہوسٹنگ — وہ کمپنی جو loadboot.com کو آن لائن رکھتی ہے۔')],
  ['Supabase',             L('Database hosting — where all LoadBoot records (carriers, loads, accounts) are stored securely.', 'Database — yahan LoadBoot ka saara record rehta hai: carriers, loads, accounts, ye portal bhi. Iske bagair kuch nahi chalta.', 'ڈیٹابیس ہوسٹنگ — جہاں لوڈ بوٹ کا سارا ریکارڈ (کیریئرز، لوڈز، اکاؤنٹس) محفوظ رہتا ہے۔')],
  ['Resend',               L('Email sending service — delivers LoadBoot\'s emails to carriers and brokers.', 'Email bhejne ka system — LoadBoot ki emails carriers aur brokers ke inbox tak pohnchata hai, spam mein nahi jane deta.', 'ای میل بھیجنے کی سروس — لوڈ بوٹ کی ای میلز کیریئرز اور بروکرز تک پہنچاتی ہے۔')],
  ['Retell AI',            L('Phone-call software — the automated phone line that answers and records calls.', 'Phone line ka software — jab koi call kare to ye uthata hai, baat record karta hai aur team ko batata hai.', 'فون کال سافٹ ویئر — خودکار فون لائن جو کالز اٹھاتی اور ریکارڈ کرتی ہے۔')],
  ['Telnyx',               L('Phone numbers & SMS — the US phone numbers LoadBoot calls and texts from.', 'America ke phone numbers aur SMS — carriers aur brokers ko isi number se call aur message jate hain.', 'فون نمبرز اور ایس ایم ایس — لوڈ بوٹ کے امریکی فون نمبر جن سے کال اور میسج ہوتے ہیں۔')],
  ['Claude (Anthropic)',   L('Software subscription used by the team to build and improve the LoadBoot app.', 'Software ki mahana fee — team is se LoadBoot ki app banati aur theek karti hai. Ye ek tool hai, kaam team karti hai.', 'سافٹ ویئر سبسکرپشن جو ٹیم لوڈ بوٹ ایپ بنانے اور بہتر کرنے کے لیے استعمال کرتی ہے۔')],
  ['ChatGPT (OpenAI)',     L('Software subscription used by the team for writing and research.', 'Software ki mahana fee — team is se likhne aur research ka kaam karti hai. Tool hai, kaam team ka.', 'سافٹ ویئر سبسکرپشن جو ٹیم لکھنے اور ریسرچ کے لیے استعمال کرتی ہے۔')],
  ['Google Workspace',     L('Company email & documents — the @loadboot.com mailboxes and shared files.', 'Company ki email aur files — @loadboot.com wale email address aur team ki shared files yahin hain.', 'کمپنی ای میل اور دستاویزات — @loadboot.com میل باکسز اور مشترکہ فائلیں۔')],
  ['Domain / DNS',         L('The loadboot.com name — a yearly fee to own the web address.', 'loadboot.com naam ki salana fee — ye naam apne paas rakhne ke liye har saal deni parti hai.', 'loadboot.com نام — ویب ایڈریس اپنے نام رکھنے کی سالانہ فیس۔')],
  ['Namecheap',            L('Where the loadboot.com name and the hello@ mailbox are registered.', 'Jahan loadboot.com ka naam aur hello@loadboot.com wala mailbox register hai.', 'جہاں loadboot.com نام اور hello@ میل باکس رجسٹرڈ ہیں۔')],
  ['Apple Developer',      L('Yearly fee to publish the LoadBoot app on the Apple App Store.', 'iPhone wali app Apple ke store par rakhne ki salana fee.', 'ایپل ایپ اسٹور پر لوڈ بوٹ ایپ رکھنے کی سالانہ فیس۔')],
  ['Google Play',          L('One-time fee to publish the LoadBoot app on Google Play.', 'Android wali app Google Play par rakhne ki ek dafa ki fee.', 'گوگل پلے پر لوڈ بوٹ ایپ رکھنے کی ایک بار کی فیس۔')],
  ['Canva',                L('Design tool — for images, posts and documents.', 'Design ka tool — tasveerein, social media posts aur documents banane ke liye.', 'ڈیزائن ٹول — تصویریں، پوسٹس اور دستاویزات کے لیے۔')],
  ['Zoom',                 L('Video meetings with carriers, brokers and staff.', 'Video meeting ka software — carriers, brokers aur staff se online meeting.', 'کیریئرز، بروکرز اور عملے کے ساتھ ویڈیو میٹنگز۔')],
  ['Office rent',          L('Monthly rent for the LoadBoot office.', 'Daftar ka mahana kiraya.', 'لوڈ بوٹ آفس کا ماہانہ کرایہ۔')],
  ['Electricity',          L('Office electricity bill.', 'Daftar ka bijli ka bill.', 'آفس کا بجلی کا بل۔')],
  ['Internet',             L('Office internet connection.', 'Daftar ka internet.', 'آفس کا انٹرنیٹ کنکشن۔')],
  ['Dispatcher salary',    L('Pay for a dispatcher — the person who finds loads and books them for carriers.', 'Dispatcher ki tankhwah — ye banda carriers ke liye loads dhoondta hai aur book karta hai; isi se LoadBoot ki kamai hoti hai.', 'ڈسپیچر کی تنخواہ — وہ شخص جو کیریئرز کے لیے لوڈز ڈھونڈتا اور بک کرتا ہے۔')],
  ['Coordinator salary',   L('Pay for the office coordinator who manages the dispatch team day to day.', 'Coordinator ki tankhwah — daftar aur dispatch team ko rozana sambhalta hai.', 'آفس کوآرڈینیٹر کی تنخواہ جو ڈسپیچ ٹیم کو روزانہ چلاتا ہے۔')],
  ['Furniture',            L('Desks, chairs and office fittings.', 'Mez, kursiyan aur daftar ka saman.', 'میز، کرسیاں اور آفس کا سامان۔')],
  ['Computers',            L('Laptops / PCs and headsets for dispatchers.', 'Dispatchers ke liye laptop / computer aur headset.', 'ڈسپیچرز کے لیے لیپ ٹاپس / پی سیز اور ہیڈسیٹس۔')],
];
export const VENDOR_NAMES = VENDORS.map(v => v[0]);
const VMAP = Object.fromEntries(VENDORS);
export function vendorWhat(name, lang) {
  if (!name) return '';
  const k = Object.keys(VMAP).find(n => n.toLowerCase() === String(name).trim().toLowerCase() || String(name).toLowerCase().startsWith(n.toLowerCase().split(' ')[0]));
  return k ? (VMAP[k][lang] || VMAP[k].en) : '';
}

export const CATEGORIES = {
  office:     L('Office — one-time setup costs (deposit, fittings).', 'Daftar — ek dafa ke setup kharche (advance, deposit, fittings).', 'آفس — ایک بار کے سیٹ اپ اخراجات (ڈپازٹ، فٹنگز)۔'),
  rent:       L('Rent — the monthly office rent.', 'Kiraya — daftar ka mahana kiraya.', 'کرایہ — آفس کا ماہانہ کرایہ۔'),
  utilities:  L('Utilities — electricity, internet, phone.', 'Bill — bijli, internet, phone.', 'یوٹیلیٹیز — بجلی، انٹرنیٹ، فون۔'),
  salary:     L('Salaries — pay for dispatchers and office staff.', 'Tankhwahein — dispatchers aur daftar ke staff ki pay.', 'تنخواہیں — ڈسپیچرز اور آفس عملے کی تنخواہ۔'),
  equipment:  L('Equipment — computers, headsets, furniture.', 'Saman — computer, headset, furniture.', 'سامان — کمپیوٹرز، ہیڈسیٹس، فرنیچر۔'),
  tools:      L('Tools & subscriptions — the online services LoadBoot runs on (hosting, database, email, phone).', 'Software ki mahana fees — jin online services par LoadBoot chalta hai (website, database, email, phone).', 'ٹولز اور سبسکرپشنز — آن لائن سروسز جن پر لوڈ بوٹ چلتا ہے (ہوسٹنگ، ڈیٹابیس، ای میل، فون)۔'),
  legal:      L('Legal & professional — lawyer, accountant, registrations.', 'Wakeel aur accountant — qanooni kaam, registration, hisaab-kitab.', 'قانونی اور پیشہ ورانہ — وکیل، اکاؤنٹنٹ، رجسٹریشنز۔'),
  relocation: L('Relocation — moving the team to the new office city.', 'Shift hona — team ko naye daftar wale sheher le jana.', 'منتقلی — ٹیم کو نئے آفس والے شہر لے جانا۔'),
  marketing:  L('Marketing — ads and outreach to bring carriers and brokers.', 'Marketing — ishtihar aur rabta taake naye carriers aur brokers aayein.', 'مارکیٹنگ — اشتہارات اور رابطہ تاکہ کیریئرز اور بروکرز آئیں۔'),
  misc:       L('Other — anything that fits no category; the note says what.', 'Deegar — jo kisi khaane mein nahi aata; note mein likha hai ke kya tha.', 'دیگر — جو کسی زمرے میں نہیں آتا؛ نوٹ میں لکھا ہے کیا۔'),
};
export const catWhat = (c, lang) => (CATEGORIES[c] || CATEGORIES.misc)[lang] || CATEGORIES[c]?.en || '';

// Money terms shown on the investor's screens.
export const TERMS = {
  commitment:  L('Commitment — the most you agreed to put in. A ceiling, not a debt.', 'Commitment — zyada se zyada jitna aap ne dene ka wada kiya. Ye had hai, aap par qarz nahi.', 'کمٹمنٹ — زیادہ سے زیادہ جتنا آپ نے دینے کا کہا۔ حد ہے، قرض نہیں۔'),
  request:     L('Capital request — LoadBoot asks for a stated amount for a stated purpose. You may pay or decline.', 'Paise ki darkhwast — LoadBoot ek raqam ek kaam ke liye maangta hai. Aap dein ya mana kar dein, dono theek.', 'کیپیٹل ریکویسٹ — لوڈ بوٹ ایک رقم ایک مقصد کے لیے مانگتا ہے۔ آپ دیں یا منع کریں۔'),
  funded:      L('Funded — money you sent AND LoadBoot confirmed it received. Only this counts.', 'Diya hua — jo aap ne bheja AUR LoadBoot ne haan ki ke mil gaya. Sirf yehi ginti mein aata hai.', 'دیا ہوا — جو آپ نے بھیجا اور لوڈ بوٹ نے تصدیق کی۔ صرف یہی گنتا ہے۔'),
  fund_cash:   L('Fund cash — your money not yet spent, sitting with LoadBoot.', 'Fund mein baqi — aap ka wo paisa jo abhi kharch nahi hua, LoadBoot ke paas pada hai.', 'فنڈ میں باقی — آپ کا پیسہ جو ابھی خرچ نہیں ہوا۔'),
  spent:       L('Spent — money used from your tranches. Each expense shows what it bought.', 'Kharch hua — aap ki qiston se jo istemal hua. Har kharcha batata hai kya kharida.', 'خرچ ہوا — آپ کی قسطوں سے جو استعمال ہوا۔ ہر خرچہ بتاتا ہے کیا خریدا۔'),
  profit:      L('Profit — money actually collected in a month minus that month\'s expenses.', 'Munafa — mahine mein jo paisa sach mein aaya, us mein se us mahine ke kharche nikaal kar jo bacha.', 'منافع — مہینے میں جو پیسہ اصل میں آیا، منفی اس مہینے کے اخراجات۔'),
  recovery:    L('Recovery — an agreed share of each month\'s profit comes back to you until your funded amount is fully returned.', 'Wapsi — har mahine ke munafay ka tay-shuda hissa aap ko milta rahega jab tak aap ka poora diya hua paisa wapis na ho jaye.', 'واپسی — ہر مہینے کے منافع کا طے شدہ حصہ آپ کو ملتا ہے جب تک پورا دیا ہوا پیسہ واپس نہ ہو۔'),
  share:       L('Permanent share — an agreed % of profit, every month, for as long as LoadBoot earns profit. Not ownership.', 'Pakka hissa — munafay ka tay-shuda %, har mahine, jab tak LoadBoot kamata rahe. Ye company mein malkiyat nahi hai.', 'مستقل حصہ — منافع کا طے شدہ %، ہر مہینے، جب تک لوڈ بوٹ منافع کمائے۔ ملکیت نہیں۔'),
  statement:   L('Statement — the monthly profit sheet LoadBoot publishes; your payout is calculated from it.', 'Statement — har mahine ka hisaab (aamdani, kharcha, munafa) jo LoadBoot lagata hai; aap ka payout isi se nikalta hai.', 'اسٹیٹمنٹ — ماہانہ منافع کا حساب جو لوڈ بوٹ شائع کرتا ہے؛ آپ کا پے آؤٹ اسی سے بنتا ہے۔'),
  payout:      L('Payout — money LoadBoot pays you for a statement. You confirm you received it.', 'Payout — jo paisa LoadBoot mahine ke hisaab par aap ko deta hai. Aap batate hain ke mil gaya.', 'پے آؤٹ — جو پیسہ لوڈ بوٹ آپ کو اسٹیٹمنٹ پر دیتا ہے۔ آپ تصدیق کرتے ہیں کہ ملا۔'),
  no_profit:   L('No-profit month — nothing is owed for that month. Nothing piles up as debt.', 'Jis mahine munafa na ho — us mahine kuch nahi banta. Koi udhaar aage nahi chalta.', 'بغیر منافع کا مہینہ — اس مہینے کچھ واجب نہیں۔ کوئی ادھار جمع نہیں ہوتا۔'),
  carrier:     L('Carrier — a trucking company (or owner-operator) that uses LoadBoot to get loads.', 'Carrier — truck wali company ya apna truck chalane wala, jo LoadBoot se loads leta hai.', 'کیریئر — ٹرک کمپنی (یا اونر آپریٹر) جو لوڈز لینے کے لیے لوڈ بوٹ استعمال کرتی ہے۔'),
  broker:      L('Broker — a company that has freight to move and pays carriers to move it.', 'Broker — wo company jis ke paas maal hota hai aur jo truck walon ko dhulai ke paise deti hai.', 'بروکر — وہ کمپنی جس کے پاس مال ہوتا ہے اور جو کیریئرز کو لے جانے کے پیسے دیتی ہے۔'),
  dispatcher:  L('Dispatcher — a LoadBoot staff member who finds and books loads for carriers; LoadBoot earns a fee per load.', 'Dispatcher — LoadBoot ka banda jo carriers ke liye loads dhoondta aur book karta hai; har load par LoadBoot ko fee milti hai.', 'ڈسپیچر — لوڈ بوٹ کا عملہ جو کیریئرز کے لیے لوڈز ڈھونڈتا اور بک کرتا ہے؛ لوڈ بوٹ کو ہر لوڈ پر فیس ملتی ہے۔'),
  load:        L('Load — one shipment of freight from A to B. LoadBoot\'s income comes from loads delivered.', 'Load — ek maal ki khep jo ek jagah se doosri jagah jati hai. Jitne loads deliver honge utni LoadBoot ki kamai.', 'لوڈ — ایک مال کی کھیپ A سے B تک۔ لوڈ بوٹ کی آمدنی ڈیلیور ہوئے لوڈز سے آتی ہے۔'),
};
export const termWhat = (k, lang) => TERMS[k] ? (TERMS[k][lang] || TERMS[k].en) : '';

// Impact of each business number on the investor's money — plain words, both directions.
export const IMPACT = {
  carriers_verified:   L('More verified carriers = more trucks LoadBoot can put on loads = more fee income. Fewer means income stalls.', 'Verified carriers zyada = zyada truck jin par loads lag sakte hain = zyada fee. Kam hon to kamai ruk jati hai.', 'ویریفائیڈ کیریئرز زیادہ = زیادہ ٹرک جن پر لوڈز لگ سکتے ہیں = زیادہ فیس۔ کم ہوں تو کمائی رک جاتی ہے۔'),
  carriers_unverified: L('Signed up but not verified yet — no income from them until documents clear. A big number here is work waiting, not money.', 'Signup kiya lekin abhi verify nahi — jab tak documents clear na hon in se kamai nahi. Bara number yahan kaam baqi hai, paisa nahi.', 'سائن اپ کیا لیکن ابھی ویریفائی نہیں — دستاویزات کلیئر ہونے تک ان سے کمائی نہیں۔ بڑا نمبر یہاں کام باقی ہے، پیسہ نہیں۔'),
  carriers_assigned:   L('Carriers with a LoadBoot dispatcher working for them — this is where fees actually come from.', 'Jin carriers ke liye LoadBoot ka dispatcher kaam kar raha hai — fee asal mein yahin se aati hai.', 'جن کیریئرز کے لیے لوڈ بوٹ کا ڈسپیچر کام کر رہا ہے — فیس اصل میں یہیں سے آتی ہے۔'),
  dispatchers_active:  L('Each dispatcher can serve a few carriers. More dispatchers = more carriers served = more loads = more fees, but also more salary cost.', 'Ek dispatcher kuch carriers sambhal sakta hai. Zyada dispatchers = zyada carriers = zyada loads = zyada fee, lekin tankhwah bhi zyada.', 'ایک ڈسپیچر کچھ کیریئرز سنبھال سکتا ہے۔ زیادہ ڈسپیچرز = زیادہ کیریئرز = زیادہ لوڈز = زیادہ فیس، لیکن تنخواہ بھی زیادہ۔'),
  brokers_active:      L('Brokers bring the freight. More active brokers = more loads to book. Pending brokers cannot post yet.', 'Broker maal late hain. Zyada active brokers = zyada loads. Pending brokers abhi load nahi daal sakte.', 'بروکر مال لاتے ہیں۔ زیادہ فعال بروکرز = زیادہ لوڈز۔ زیرِ التوا بروکرز ابھی لوڈ نہیں ڈال سکتے۔'),
  trips_delivered:     L('A delivered trip is the moment LoadBoot earns its fee. This number moving up is your payout moving closer.', 'Trip deliver hui = LoadBoot ko fee mili. Ye number barhe to aap ka payout qareeb aata hai.', 'ٹرپ ڈیلیور ہوئی = لوڈ بوٹ کو فیس ملی۔ یہ نمبر بڑھے تو آپ کا پے آؤٹ قریب آتا ہے۔'),
  fees_collected:      L('Fees actually collected — this is LoadBoot\'s real income. Profit = this minus expenses. Fees billed but not yet paid are not income yet.', 'Jo fee sach mein wasool hui — yehi LoadBoot ki asal kamai hai. Munafa = ye minus kharche. Jo fee abhi wasool nahi hui wo kamai nahi.', 'جو فیس واقعی وصول ہوئی — یہی لوڈ بوٹ کی اصل کمائی ہے۔ منافع = یہ منفی اخراجات۔ جو فیس ابھی وصول نہیں ہوئی وہ کمائی نہیں۔'),
  fees_outstanding:    L('Billed to carriers but not paid yet. If it grows, cash is stuck; if it clears, income arrives.', 'Carriers ko bill bheja lekin abhi paisa nahi aaya. Barhe to paisa phansa hua; clear ho to kamai aati hai.', 'کیریئرز کو بل بھیجا لیکن ابھی پیسہ نہیں آیا۔ بڑھے تو پیسہ پھنسا ہوا؛ کلیئر ہو تو کمائی آتی ہے۔'),
  traffic:             L('More people finding loadboot.com on Google = more carrier and broker signups, without paying for ads.', 'Google se zyada log loadboot.com par aayein = zyada carriers aur brokers signup, bina ishtihar ke paise diye.', 'گوگل سے زیادہ لوگ loadboot.com پر آئیں = زیادہ کیریئرز اور بروکرز سائن اپ، بغیر اشتہار کے پیسے دیے۔'),
};
export const impactWhat = (k, lang) => IMPACT[k] ? (IMPACT[k][lang] || IMPACT[k].en) : '';
