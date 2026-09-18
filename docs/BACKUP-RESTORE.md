# LoadBoot — Backup & Restore Runbook

Last verified: **17 Sep 2026**

## Why this exists

The Supabase org `QuickFreights` is on the **Free plan**, and the Free plan takes
**no automatic backups at all** — Supabase's own docs tell free-tier users to export
their data themselves. Until this workflow runs, production
(`rwscphuhpjoudvljvmdk`) has exactly zero recoverable copies.

Production, measured 17 Sep 2026:

| Thing | Size |
|---|---|
| Postgres database | 432 MB on disk |
| Storage objects (carrier COI / W-9 / authority PDFs) | 259 files, 141 MB |
| auth.users | 155 |

## Retention and the R2 free tier

R2's free tier is 10 GB stored, 1 million Class A and 10 million Class B
operations per month. This workflow makes a few dozen operations a day, so only
stored bytes matter:

- **DB dump: daily.** Compressed size is **unknown until the first run** — 432 MB
  on disk includes indexes and bloat, so the dump will be smaller, but do not
  assume a figure. Check the first run's printed size and revisit this section.
- **Storage archive (141 MB): Sundays and the 1st only**, not nightly. Carrier
  documents barely change, and a nightly 141 MB tarball would fill the free tier
  on its own. Run the workflow manually any time you need a fresh one.
- Retention: 30 days of dailies, plus a monthly copy that pruning never touches.

That should land in the low single-digit GB, i.e. **$0/month**. If it ever goes
over, overage is $0.015/GB-month — 5 GB over costs about 8 cents. Cloudflare
requires a card on file to activate R2 even on the free tier; the base fee is $0.

## What we chose, and what we did not

- **Own nightly dump to R2 — chosen.** ~$0/month, 30-day daily + 12-month monthly
  retention, and the copy lives *outside* Supabase, so it also survives an account
  suspension or a wrong-project delete. Supabase's own backups do not.
- **Supabase Pro ($25/mo) — later.** Buys 7 days of daily backups plus no
  inactivity pause and better compute. Worth it when paying loads start moving;
  it is not a substitute for the off-platform copy above.
- **PITR ($100/mo) — not yet.** Overkill at current volume, and switching it on
  *disables* the daily backups. Revisit when losing one hour of settlements costs
  real money.

## What is covered

- All application data and schema: `public`, `app_private`, `auth` (users and
  identities), `storage` (object metadata).
- Every Storage file, downloaded and archived separately — `pg_dump` saves only
  the object *metadata*, so without this the carrier documents would be gone.
- The `pg_cron` job list, exported to CSV (the `cron` schema itself is not dumpable).
- A plain-text table of contents per dump, so coverage can be checked without
  decrypting anything.

## Known gaps — read these, do not assume they are handled

- **Vault secrets are not in the dump.** Anything in `vault` (API tokens/keys)
  must be re-entered by hand after a restore. Keep them in a password manager.
- **Edge functions** are not dumped — they live in git, which is the right place.
- **JWT secret / API keys** are project-level settings, not data. A restore into a
  *new* project gets new keys, so the frontend and Netlify env vars need updating.
- **Realtime, pgbouncer, supabase_functions, extensions** schemas are excluded on
  purpose; Supabase recreates them.

## Encryption model

Backups are encrypted with `age` using a **public key only**. GitHub Actions can
encrypt but can never read a backup, so a leaked CI token does not leak carrier
documents. The private key lives with Yaseen, offline — **if it is lost, every
backup is unreadable**. Store it in a password manager *and* on a USB stick.

---

# One-time setup

## Step 1 — Cloudflare R2 bucket

1. Cloudflare dashboard → **R2** → **Create bucket** → name `loadboot-backups`,
   location Automatic. (Same account that already proxies loadboot.com.)
2. R2 → **Manage API tokens** → **Create API token**
   - Permission: **Object Read & Write**
   - Scope: only the `loadboot-backups` bucket
3. Copy the three values it shows once: **Access Key ID**, **Secret Access Key**,
   and your **Account ID** (in the R2 sidebar / the S3 endpoint URL).

## Step 2 — Generate the age key pair

On Windows PowerShell:

```powershell
winget install FiloSottile.age      # or: scoop install age
mkdir $HOME\.age
age-keygen -o $HOME\.age\loadboot.key
```

It prints `Public key: age1....`.

- The **public key** goes into GitHub secrets (step 4).
- The file `loadboot.key` is the **private key**. Copy its contents into your
  password manager and onto a USB stick, then never put it in the repo, in GitHub
  secrets, or in a chat.

## Step 3 — Collect the Supabase values (production project)

1. Supabase dashboard → project **quickfreights-portal** → **Connect** →
   **Session pooler** → copy the URI. It looks like
   `postgresql://postgres.rwscphuhpjoudvljvmdk:<PASSWORD>@aws-0-us-east-1.pooler.supabase.com:5432/postgres`
   Put the real database password in place of `<PASSWORD>`.
   *Use the pooler, not `db.<ref>.supabase.co` — the direct host is IPv6-only and
   GitHub Actions runners have no IPv6.*
2. **Project Settings → API** → copy the **Project URL**
   (`https://rwscphuhpjoudvljvmdk.supabase.co`) and the **service_role** key.

## Step 4 — Add the GitHub secrets

Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Seven secrets:

| Secret | Value |
|---|---|
| `SUPABASE_DB_URL` | the Session pooler URI from step 3 |
| `SUPABASE_URL` | `https://rwscphuhpjoudvljvmdk.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role key |
| `BACKUP_AGE_PUBKEY` | the `age1...` **public** key |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | from step 1 |
| `R2_SECRET_ACCESS_KEY` | from step 1 |
| `R2_BUCKET` | `loadboot-backups` |

## Step 5 — First run

```bash
git add .github/workflows/backup.yml scripts/backup docs/BACKUP-RESTORE.md
git commit -m "Add nightly prod backup to Cloudflare R2"
git push
```

Then repo → **Actions → Nightly backup → Run workflow**. Watch it finish green.
The last step prints what landed in R2; expect a `.dump.age`, a `.toc.txt`,
a `.cron.csv` and a `storage-*.tar.gz.age` under `daily/<today>/`.

If it fails, GitHub emails you automatically — there is nothing extra to wire up.

## Step 6 — Put the restore drill on the calendar

A backup nobody has restored is not a backup. Once a month, download the newest
`.dump.age` from R2 and run:

```bash
bash scripts/backup/restore_local.sh ~/Downloads/loadboot-prod-<date>.dump.age ~/.age/loadboot.key
```

It restores into a throwaway Docker Postgres 17 and prints row counts for
`profiles`, `fleet_trucks`, `auth.users` and `storage.objects`. Compare them with
production. `GRANT`/owner errors during the restore are expected — the Supabase
roles do not exist in a plain container.

---

# Restoring for real

1. Create a fresh Supabase project (or use `loadboot-staging` to rehearse).
2. Decrypt: `age -d -i ~/.age/loadboot.key -o prod.dump prod-<date>.dump.age`
3. `pg_restore --no-owner --no-privileges -d "<new session pooler URI>" prod.dump`
4. Untar the storage archive and re-upload the files to the matching buckets.
5. Re-enter Vault secrets by hand, re-create the `pg_cron` jobs from the
   `.cron.csv`, redeploy edge functions from git.
6. Update the Supabase URL and anon key in `build_site.py` / Netlify env, rebuild,
   and verify the live site — Netlify has shipped a green-but-broken deploy before.
