@echo off
setlocal
REM ============================================================
REM  COMMIT-STRIPE.bat  -  Stripe fee billing ka kaam commit karta hai.
REM
REM  Plain CMD mein "git" nahi milta - GitHub Desktop apna git bundle karta
REM  hai lekin PATH mein nahi daalta. Isi liye neeche khud dhoondha jata hai
REM  (wahi tareeqa jo FIX-LOCKS-AND-COMMIT.bat mein hai).
REM
REM  Ye SIRF named files commit karta hai. "git add -A" jaan boojh kar nahi
REM  hai - repo mein pehle se doosra kaam bhi uncommitted para hai (driver
REM  access frontend, MOBILE_FIX_CSS, header v2) aur wo is commit mein nahi
REM  aana chahiye.
REM ============================================================
cd /d "%~dp0"

echo ==== git dhoondh raha hoon ====
set "GIT="
for %%P in (
  "%ProgramFiles%\Git\cmd\git.exe"
  "%ProgramFiles(x86)%\Git\cmd\git.exe"
  "%LOCALAPPDATA%\Programs\Git\cmd\git.exe"
) do (
  if not defined GIT if exist %%P set "GIT=%%~P"
)
if not defined GIT (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if not defined GIT if exist "%%D\resources\app\git\cmd\git.exe" set "GIT=%%D\resources\app\git\cmd\git.exe"
  )
)
if not defined GIT (
  for /d %%D in ("%LOCALAPPDATA%\GitHubDesktop\app-*") do (
    if not defined GIT if exist "%%D\resources\app\git\mingw64\bin\git.exe" set "GIT=%%D\resources\app\git\mingw64\bin\git.exe"
  )
)
if not defined GIT (
  echo   git kahin nahi mila.
  echo.
  echo   GitHub Desktop kholein aur wahan se commit kar dein - neeche wali
  echo   files select karke. Ya Git for Windows install kar lein:
  echo   https://git-scm.com/download/win
  echo.
  pause
  exit /b 1
)
echo   mil gaya: %GIT%

echo.
echo ==== feature branch banata hoon ====
"%GIT%" checkout -b stripe-fee-billing 2>nul || "%GIT%" checkout stripe-fee-billing
"%GIT%" --no-pager rev-parse --abbrev-ref HEAD

echo.
echo ==== ye files commit hongi ====
"%GIT%" add migrations/bl_stripe_0346_fee_billing_rails.sql
"%GIT%" add migrations/bl_stripe_0347_invoice_no_sequence.sql
"%GIT%" add migrations/bl_stripe_0348_carrier_autopay.sql
"%GIT%" add supabase/functions/stripe-webhook/index.ts
"%GIT%" add supabase/functions/stripe-worker/index.ts
"%GIT%" add supabase/functions/stripe-autopay/index.ts
"%GIT%" add app/command-center/views/feeApprovals.js
"%GIT%" add app/command-center/views/finance.js
"%GIT%" add app/command-center/app.js
"%GIT%" add app/shared/api.js
"%GIT%" add app/carrier/account-view.js
"%GIT%" add docs/STRIPE-HANDOFF.md
"%GIT%" --no-pager diff --cached --stat
echo.
echo Upar SIRF yehi 12 files honi chahiyen. Agar koi aur file dikhe to
echo ye window band kar dein aur pehle poochh lein.
echo.
pause

"%GIT%" commit -m "Stripe fee billing: owner approval queue, Net-30, invoice sequence, carrier auto-pay" -m "The fee-invoice engine already auto-issued 5%% on delivery and emailed the carrier. This adds the Stripe rail underneath it and an owner approval step in front of it. Invoices now hold at draft until approved in Command Center (Finance -> Fee approvals), then send Net-30 with a hosted ACH/card pay page; the signature-verified webhook is the only thing that marks one paid, because ACH clears days later and can be returned for up to 60 days. Terms moved net-15 to net-30 in all three places that set them, so the database, the Stripe account and loadboot.com finally agree. Invoice numbers moved off count(*)+1 onto a sequence - concurrent deliveries used to mint the same number and voiding one made the next reuse a number already sent to a carrier. Carriers can also authorise their bank once on a Stripe-hosted page and have each invoice settle itself on its due date, revocable instantly from the portal. Both feature flags ship OFF."

echo.
echo ==== nateeja ====
"%GIT%" --no-pager log --oneline -1
echo.
echo Branch par commit ho gaya. PUSH ABHI NAHI kiya - pehle staging par
echo test karein, phir main mein merge karke push karna.
echo.
echo Push karna ho to:  "%GIT%" push -u origin stripe-fee-billing
echo.
pause
endlocal
