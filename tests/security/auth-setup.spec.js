// tests/security/auth-setup.spec.js
// Generates a per-persona storage-state (login) file the persona matrix consumes. Run ONCE per persona.
// Credentials are read from the environment (or a gitignored local .env) and are NEVER written to disk
// in plaintext, printed, or committed — only the resulting Supabase session tokens are saved under
// .auth/<persona>.json, which is gitignored.
//
// Usage (owner, staging accounts only):
//   PERSONA=carrier_owner PERSONA_EMAIL='...' PERSONA_PASSWORD='...' \
//     BASE_URL='https://<staging>' npx playwright test tests/security/auth-setup.spec.js
//
// Repeat for each persona: owner, dispatcher, compliance, finance_maker, finance_checker, marketing,
// carrier_owner, driver, broker, shipper, facility.

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { PERSONAS } = require('./personas.js');

const PERSONA = process.env.PERSONA || '';
const EMAIL = process.env.PERSONA_EMAIL || '';
const PASSWORD = process.env.PERSONA_PASSWORD || '';
const BASE = process.env.BASE_URL || '';

test('generate storage state for persona', async ({ browser }) => {
  test.skip(!PERSONA, 'set PERSONA to one of the defined personas');
  expect(Object.keys(PERSONAS), `unknown persona "${PERSONA}"`).toContain(PERSONA);
  expect(EMAIL, 'PERSONA_EMAIL required').not.toEqual('');
  expect(PASSWORD, 'PERSONA_PASSWORD required').not.toEqual('');
  expect(BASE, 'BASE_URL required').not.toEqual('');

  const cfg = PERSONAS[PERSONA];
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Every portal shares the same email/password form (getSession + signInWithPassword). Land on the
  // persona's portal so the app initializes its Supabase client, then sign in.
  await page.goto(BASE + cfg.portal, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('networkidle').catch(() => {});

  await page.locator('input[type="email"], input[autocomplete="username"]').first().fill(EMAIL);
  await page.locator('input[type="password"], input[autocomplete="current-password"]').first().fill(PASSWORD);
  await page.getByRole('button', { name: /sign in/i }).first().click();

  // Wait until a session token is present in localStorage (login succeeded).
  await page.waitForFunction(() => Object.keys(localStorage).some(k => k.includes('-auth-token')), null, { timeout: 20000 });

  const dir = path.join(__dirname, '.auth');
  fs.mkdirSync(dir, { recursive: true });
  await ctx.storageState({ path: path.join(dir, `${PERSONA}.json`) });
  await ctx.close();
  // Do NOT print tokens or credentials. Only confirm the file was written.
  console.log(`storage state written: .auth/${PERSONA}.json`);
});
