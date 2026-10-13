"""bl_train_0548 — sample PDFs for the carrier training sandbox.

Every page carries a diagonal "TRAINING SAMPLE — NOT A REAL DOCUMENT" watermark and contains no
real names, numbers or signatures. Output: tools/training/samples/*.pdf (committed; not published
with the site). tools/training/upload-samples.mjs puts them where training_seed expects them.

    python3 tools/training/make-samples.py
"""
import os
from reportlab.lib.pagesizes import letter
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'samples')
NAVY, ORANGE, GREY = HexColor('#10223B'), HexColor('#FC5305'), HexColor('#64748B')
MARK = 'TRAINING SAMPLE — NOT A REAL DOCUMENT'

DOCS = {
    'authority.pdf': ('Operating Authority (MC) — Certificate', [
        'Carrier: LOADBOOT TRAINING CARRIER', 'Docket: MC-TRAINING   ·   USDOT: TRAINING',
        'Authority type: Common carrier — property (except household goods)',
        'Status: ACTIVE (training data — never issued by FMCSA)',
        'This page exists so a trainee can see what an authority letter looks like in the portal.']),
    'coi.pdf': ('Certificate of Liability Insurance', [
        'Insured: LOADBOOT TRAINING CARRIER', 'Producer: Training Insurance Agency (not real)',
        'Auto liability: $1,000,000 combined single limit', 'Motor truck cargo: $100,000 · deductible $1,000',
        'Scheduled auto: 2023 Mercedes-Benz Sprinter 2500 — VIN W1YTRNXX00T······ (not a real VIN)',
        'Certificate holder: LoadBoot (training)', 'Policy dates: shown in the portal — training data only.']),
    'w9.pdf': ('Form W-9 (sample) — Request for Taxpayer Identification Number', [
        'Name: Training Owner', 'Business name: LOADBOOT TRAINING CARRIER', 'Classification: LLC (S)',
        'TIN: 00-0000000 (not a real number)', 'Address: 100 Training Way, Dallas, TX 75201 (not a real address)',
        'Signature: none — this is not a tax document.']),
    'mcs150.pdf': ('MCS-150 Biennial Update (sample)', [
        'Carrier: LOADBOOT TRAINING CARRIER', 'Power units: 1   ·   Drivers: 1',
        'Operation: Interstate — general freight, expedite', 'Filed: never — training data only.']),
    'bank.pdf': ('Voided Check / Bank Letter (sample)', [
        'Account holder: LOADBOOT TRAINING CARRIER', 'Bank: TRAINING BANK — NOT A REAL ACCOUNT',
        'Routing: 000000000   ·   Account: 000000000000', 'Nothing can ever be paid into or out of this "account".']),
    'dispatch-agreement.pdf': ('Dispatch Service Agreement (sample)', [
        'Between LoadBoot and LOADBOOT TRAINING CARRIER', 'Fee: flat 5% of gross line-haul on delivered loads booked by LoadBoot;',
        '     fuel surcharge, detention, TONU, layover and lumper stay 100% the carrier\'s.',
        'Invoicing: separate LoadBoot fee invoice after delivery, Net-30 (see loadboot.com/pricing).',
        'Signed: Training Owner — a practice signature, not a contract.']),
    'training-pod.pdf': ('Proof of Delivery — Bill of Lading (sample)', [
        'Shipper: Dallas, TX 75236 (training)', 'Consignee: San Antonio, TX 78218 (training)',
        'Pieces: 6 crates · Trade-show displays · 3,100 lb', 'Received in good order — signature: TRAINING',
        'Delivery: on site 4 h (2 h free) → 2 h detention at $40/hr = $80 (pass-through to carrier, no LoadBoot fee).']),
}


def page(c, title, lines):
    w, h = letter
    c.setFillColor(NAVY); c.rect(0, h - 78, w, 78, fill=1, stroke=0)
    c.setFillColor(ORANGE); c.setFont('Helvetica-Bold', 11); c.drawString(40, h - 30, 'LOADBOOT · TRAINING SANDBOX')
    c.setFillColor(HexColor('#FFFFFF')); c.setFont('Helvetica-Bold', 17); c.drawString(40, h - 56, title)
    c.setFillColor(NAVY); c.setFont('Helvetica', 12)
    y = h - 120
    for ln in lines:
        c.drawString(48, y, ln); y -= 22
    c.setFillColor(GREY); c.setFont('Helvetica', 9)
    c.drawString(40, 36, MARK + ' · Created for dispatcher onboarding. Do not use for anything else.')
    # diagonal watermark across the page
    c.saveState(); c.translate(w / 2, h / 2); c.rotate(35)
    c.setFillColor(ORANGE, alpha=0.18); c.setFont('Helvetica-Bold', 30)
    for dy in (-220, -110, 0, 110, 220):
        c.drawCentredString(0, dy, MARK)
    c.restoreState()


def main():
    os.makedirs(OUT, exist_ok=True)
    for name, (title, lines) in DOCS.items():
        p = os.path.join(OUT, name)
        c = canvas.Canvas(p, pagesize=letter)
        c.setTitle(MARK + ' — ' + title); c.setAuthor('LoadBoot training sandbox'); c.setSubject(MARK)
        page(c, title, lines); c.showPage(); c.save()
        print('wrote', os.path.relpath(p))


if __name__ == '__main__':
    main()
