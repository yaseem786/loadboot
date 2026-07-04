# Account & Settings — LOCKED design spec (approved)

Approved premium mobile design for the Carrier portal Account & Settings screen.
File: `account-settings-premium.html` (self-contained; real LoadBoot logo embedded as base64).
Locked copy: `account-settings-premium.LOCKED.html`.

## Sections (approved)
Profile (photo upload) · Verification & documents (synced live status + progress ring, CC-approve demo)
· Business profile · Dispatch preferences · Security (email change, password reset, Face/Fingerprint
passkey, 2FA, sessions) · Notifications · Payments & payouts · Support (live chat + email + WhatsApp)
· Legal & policies (redirects) · App (install/clear/version) · Danger zone.

## Wiring map (when we implement into app/carrier/app.js)
- Photo → shared/ui/avatar.js (already built) + cc_set_my_avatar
- Doc status → pocketCompliance (one source; CC approves via cc_set_compliance)
- Email/password → Supabase updateUser / updatePassword
- Passkey → WebAuthn; 2FA → Supabase MFA
- Payout → cc_set_my_payment_profile; Notifications → pocketSavePreferences
Status: DESIGN LOCKED — awaiting go-ahead to wire into the live carrier portal.
