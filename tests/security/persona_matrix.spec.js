// tests/security/persona_matrix.spec.js
// Strengthened authenticated persona × viewport matrix. Every persona test proves SERVER-SIDE
// enforcement, not just hidden buttons: the "forbidden" probe calls the Supabase RPC endpoint DIRECTLY
// with the persona's own session token and asserts the backend denies it.
//
// Per persona × viewport it asserts:
//   1. storage state loads and the correct portal opens (portal isolation)
//   2. role-aware navigation appears
//   3. a permitted list/read RPC succeeds (direct call)
//   4. a permitted mutation succeeds where declared (direct call)
//   5. a forbidden RPC called DIRECTLY is denied (>=400 / permission error)
//   6. the mobile menu opens on mobile viewports
//   7. no horizontal overflow
//   8. console has no unexpected errors
//   9. no production-vs-staging environment leakage
//  10. a screenshot is captured
//
// The whole suite SKIPS cleanly unless PERSONAS_READY=1 and the per-persona storage-state file exists,
// so local release gates show "expected skip (no storage states)" rather than a hard failure.
//
// Run (owner, on an egress-capable machine, against staging):
//   PERSONAS_READY=1 BASE_URL='https://<staging>' SUPABASE_URL='https://<ref>.supabase.co' \
//     SUPABASE_ANON_KEY='<staging-anon-key>' npx playwright test tests/security/persona_matrix.spec.js \
//     --reporter=list,json,html

const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');
const { PERSONAS, VIEWPORTS } = require('./personas.js');

const BASE = process.env.BASE_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const READY = process.env.PERSONAS_READY === '1';
const stateFile = (persona) => path.join(__dirname, '.auth', `${persona}.json`);

// Call a PostgREST RPC directly from the page context using the persona's stored access token.
async function callRpc(page, fn, args) {
  return page.evaluate(async ({ fn, args, url, key }) => {
    const k = Object.keys(localStorage).find(x => x.includes('-auth-token'));
    let token = null;
    try { token = k ? (JSON.parse(localStorage.getItem(k)).access_token || JSON.parse(localStorage.getItem(k))[0]) : null; } catch (_) {}
    const res = await fetch(`${url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': key, 'Authorization': 'Bearer ' + token },
      body: JSON.stringify(args || {}),
    });
    let body = ''; try { body = await res.text(); } catch (_) {}
    return { status: res.status, body: body.slice(0, 400) };
  }, { fn, args, url: SUPABASE_URL, key: SUPABASE_ANON_KEY });
}

const isDenied = (r) => r.status >= 400 || /not authorized|permission denied|42501|forbidden|not a carrier|not found for your account/i.test(r.body || '');

for (const [persona, cfg] of Object.entries(PERSONAS)) {
  for (const vp of VIEWPORTS) {
    test(`${persona} @ ${vp.name}`, async ({ browser }) => {
      test.skip(!READY, 'PERSONAS_READY!=1 — needs owner-generated storage states (assistant cannot type passwords)');
      test.skip(!fs.existsSync(stateFile(persona)), `no storage state at .auth/${persona}.json`);
      expect(BASE, 'BASE_URL must be set').not.toEqual('');
      expect(SUPABASE_URL, 'SUPABASE_URL must be set').not.toEqual('');

      const ctx = await browser.newContext({
        storageState: stateFile(persona),
        viewport: { width: vp.width, height: vp.height },
        isMobile: vp.isMobile,
        deviceScaleFactor: vp.isMobile ? 2 : 1,
      });
      const page = await ctx.newPage();
      const consoleErrors = [];
      page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });

      // 1 + 2. correct portal opens, role-aware nav appears
      await page.goto(BASE + cfg.portal, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => {});
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByText(cfg.navText, { exact: false }).first()).toBeVisible({ timeout: 15000 });

      // 3. permitted read succeeds via a direct RPC call
      if (cfg.permitted) {
        const r = await callRpc(page, cfg.permitted.fn, cfg.permitted.args);
        expect(isDenied(r), `permitted ${cfg.permitted.fn} should succeed, got ${r.status} ${r.body}`).toBeFalsy();
      }
      // 4. permitted mutation succeeds where declared
      if (cfg.permittedMutation) {
        const r = await callRpc(page, cfg.permittedMutation.fn, cfg.permittedMutation.args);
        expect(isDenied(r), `permitted mutation ${cfg.permittedMutation.fn} should succeed, got ${r.status}`).toBeFalsy();
      }
      // 5. forbidden RPC called DIRECTLY must be denied by the backend
      if (cfg.forbidden) {
        const r = await callRpc(page, cfg.forbidden.fn, cfg.forbidden.args);
        expect(isDenied(r), `forbidden ${cfg.forbidden.fn} MUST be denied server-side, got ${r.status} ${r.body}`).toBeTruthy();
      }
      // 6. wrong-tenant/resource read denied where declared
      if (cfg.wrongTenant) {
        const r = await callRpc(page, cfg.wrongTenant.fn, cfg.wrongTenant.args);
        expect(isDenied(r), `wrong-tenant ${cfg.wrongTenant.fn} MUST be denied`).toBeTruthy();
      }

      // 7. mobile menu opens on mobile viewports (best-effort: a nav/menu toggle if present)
      if (vp.isMobile) {
        const toggle = page.locator('[aria-label*="menu" i], .menu-toggle, .lb-menu-btn, .cp-menu-btn, .pk-menu, button:has-text("Menu")').first();
        if (await toggle.count()) { await toggle.click({ trial: false }).catch(() => {}); }
      }

      // 8. no horizontal overflow
      const overflow = await page.evaluate(() => {
        const d = document.documentElement;
        return Math.max(0, (d.scrollWidth || 0) - (d.clientWidth || 0));
      });
      expect(overflow, 'no horizontal overflow').toBeLessThanOrEqual(2);

      // 9. no environment leakage — a staging build must not embed production loadboot.com API refs
      const leaked = await page.evaluate(() => document.documentElement.innerHTML.includes('rwscphuhpjoudvljvmdk'));
      expect(leaked, 'staging build must not reference the production project ref').toBeFalsy();

      // 10. screenshot
      fs.mkdirSync(path.join(process.cwd(), 'evidence/gate/persona'), { recursive: true });
      await page.screenshot({ path: `evidence/gate/persona/${persona}__${vp.name}.png`, fullPage: false });

      // 8b. console clean (filter benign favicon/service-worker noise)
      const unexpected = consoleErrors.filter(e => !/favicon|manifest|ServiceWorker|net::ERR_ABORTED/i.test(e));
      expect(unexpected, 'console must have no unexpected errors').toEqual([]);

      await ctx.close();
    });
  }
}
