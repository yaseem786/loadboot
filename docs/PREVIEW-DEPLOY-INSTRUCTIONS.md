# Command Center V1 — get the Deploy Preview URL (owner steps)

Branch `preview/command-center-v1` (commit `731d278`) is committed. This environment can't reach
GitHub, so the commit travels to you in a **git bundle**. No file assembly, no code editing.

## Step 1 — bring the branch in and push (2 commands)

Save `preview-command-center-v1.bundle` next to your local `loadboot` clone, then:

```bash
# in your loadboot repo
git fetch /path/to/preview-command-center-v1.bundle preview/command-center-v1:preview/command-center-v1
git push -u origin preview/command-center-v1
```

## Step 2 — open a PR

Open a Pull Request for `preview/command-center-v1`. Netlify auto-builds a **Deploy Preview**. Because
it's a preview context, `build_site.py` targets **staging only** (it refuses to touch production).

Prerequisite already set in Checkpoint 1: the Netlify env must have `LOADBOOT_STAGING_ANON_KEY` (the
staging publishable/anon key). The preview build fails closed without it.

## Step 3 — become the staging Owner (one time)

1. Open the Deploy Preview's Command Center, sign in with a **real staff email** (you'll see a "no staff
   access" screen at first — expected).
2. Get your Auth UID from Supabase → Authentication → Users (staging project).
3. In the staging SQL editor, run (UID stays private — never paste it in shared chat):

```sql
select app_private.provision_staging_owner('<your-staging-auth-uuid>');
-- returns: {"ok":true,"is_staff":true,"is_owner":true,"effective_owner_count":1,"environment":"staging"}
```

4. Enable the app shell (owners can flip it from the Feature Flags screen, or via SQL):
   the `command_center_enabled` flag — sign in again and the full dashboard loads.

## Step 4 — tell me the preview URL

Share the Netlify Deploy Preview URL. I'll then drive the live browser smoke test (Overview real data,
carrier approve/reject, document review, load create + assign + dispatch move, audit rows, Dispatcher
restrictions, Carrier/anon denied, desktop + mobile, zero console errors, no production network calls)
and return a PASS/FAIL table with screenshots.

## Expected Netlify preview behavior
- Context `deploy-preview` ⇒ build targets **staging** (`snslhvmkjusozgjelghi`); **zero** production refs.
- Secret scan: clean (no service-role key in the bundle).
- The Command Center lives at `/app/command-center/` on the preview domain (noindex).
- Only the ten V1 screens exist; deferred modules are absent from the bundle.
