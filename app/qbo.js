import { getClient } from '/app/shared/supabaseClient.js';
const q = new URLSearchParams(location.search);
const t = document.getElementById('t'), m = document.getElementById('m'), sp = document.getElementById('sp');
(async () => {
  try {
    const code = q.get('code'), realmId = q.get('realmId');
    if (!code || !realmId) throw new Error(q.get('error') || 'Intuit did not return a code — try connecting again.');
    const sb = await getClient();
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { t.textContent = 'Sign in required'; m.innerHTML = 'Open your <a href="/app/carrier/">carrier portal</a>, sign in, then connect QuickBooks again.'; sp.style.display='none'; return; }
    const env = window.__LB_ENV;
    const r = await fetch(env.supabaseUrl + '/functions/v1/qbo-exchange', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'apikey': env.supabaseAnonKey, 'Authorization': 'Bearer ' + session.access_token },
      body: JSON.stringify({ code, realmId, redirect: location.origin + '/app/qbo.html' })
    });
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Connection failed.');
    t.textContent = '✓ QuickBooks connected';
    m.textContent = (j.company ? j.company + ' — ' : '') + 'taking you back to Finance…';
    sp.style.display = 'none';
    setTimeout(() => { location.href = '/app/carrier/#finance'; }, 1400);
  } catch (e) {
    t.textContent = 'Could not connect';
    m.textContent = (e && e.message) || 'Something went wrong — try again from Finance.';
    sp.style.display = 'none';
  }
})();
