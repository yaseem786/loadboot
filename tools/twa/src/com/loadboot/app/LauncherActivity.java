package com.loadboot.app;

import android.app.Activity;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import java.util.List;

import android.support.customtabs.ICustomTabsCallback;
import android.support.customtabs.ICustomTabsService;

/**
 * Minimal Trusted Web Activity launcher for LoadBoot (no androidx dependency).
 * Binds Chrome's CustomTabsService, creates a session, and launches
 * https://loadboot.com/app/ as a TWA. Falls back to a plain browser intent
 * if no Custom-Tabs-capable browser is available.
 */
public class LauncherActivity extends Activity {

    private static final String DEFAULT_URL = "https://loadboot.com/app/";
    private static final String ACTION_CUSTOM_TABS_CONNECTION =
            "android.support.customtabs.action.CustomTabsService";
    private static final String EXTRA_SESSION =
            "android.support.customtabs.extra.SESSION";
    private static final String EXTRA_LAUNCH_AS_TWA =
            "android.support.customtabs.extra.LAUNCH_AS_TRUSTED_WEB_ACTIVITY";

    /** Digital Asset Links origin; relation 2 = CustomTabsService.RELATION_HANDLE_ALL_URLS. */
    private static final String ORIGIN = "https://loadboot.com";
    private static final int RELATION_HANDLE_ALL_URLS = 2;
    private static final long VALIDATION_TIMEOUT_MS = 3000;

    private static final String STATE_LAUNCHED = "launched";

    // v1.0.4 (25 Sep 2026): the binding used to live in a static field. A bindService() binding is
    // owned by the Context that made it, so a static never made it outlive this activity — it only
    // meant that a second instance (a loadboot.com deep link while the launcher was still in the
    // back stack) overwrote the first instance's reference, the first binding was never unbound
    // (Android logs "leaked ServiceConnection" and drops it on destroy), and the first instance's
    // onDestroy unbound the *second* instance's binding instead. Each instance now owns its binding.
    private ServiceConnection connection;
    /** Browser package and Custom Tabs session this instance launched into; kept for onNewIntent. */
    private String browserPkg;
    private ICustomTabsCallback.Stub session;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean launched = false;
    private boolean connected = false;
    private boolean destroyed = false;
    private Uri url;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Recreated by the system (config change, or reclaimed for memory while the web app was on
        // top) after we had already launched the TWA: the user is on their way back out, so behave
        // like onRestart and close, instead of binding again and launching a second TWA on top.
        if (savedInstanceState != null && savedInstanceState.getBoolean(STATE_LAUNCHED, false)) {
            launched = true;
            finish();
            return;
        }

        Uri data = getIntent() != null ? getIntent().getData() : null;
        url = data != null ? data : Uri.parse(DEFAULT_URL);

        final String pkg = pickBrowser();
        if (pkg == null) { fallback(); return; }

        Intent bind = new Intent(ACTION_CUSTOM_TABS_CONNECTION).setPackage(pkg);
        connection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                try {
                    if (destroyed) return;
                    ICustomTabsService service = ICustomTabsService.Stub.asInterface(binder);
                    connected = true;
                    service.warmup(0);
                    final ICustomTabsCallback.Stub[] holder = new ICustomTabsCallback.Stub[1];
                    final Runnable launch = new Runnable() {
                        @Override public void run() { launchTwa(pkg, holder[0]); }
                    };
                    holder[0] = new ICustomTabsCallback.Stub() {
                        @Override public void onNavigationEvent(int e, Bundle b) {}
                        @Override public void extraCallback(String s, Bundle b) {}
                        @Override public void onMessageChannelReady(Bundle b) {}
                        @Override public void onPostMessage(String s, Bundle b) {}
                        // Arrives on a binder thread; hop to the main thread before launching.
                        @Override public void onRelationshipValidationResult(
                                int r, Uri o, boolean res, Bundle b) { handler.post(launch); }
                    };
                    service.newSession(holder[0]);
                    browserPkg = pkg;
                    session = holder[0];
                    // v1.0.3 (25 Sep 2026): on a cold start Chrome has to verify Digital Asset Links
                    // over the network. If the TWA opens before that finishes, Chrome shows a Custom
                    // Tab ("X · loadboot.com · share" bar). Ask Chrome to verify first and launch on
                    // its answer — but never wait more than VALIDATION_TIMEOUT_MS.
                    boolean asked = false;
                    try {
                        asked = service.validateRelationship(holder[0], RELATION_HANDLE_ALL_URLS,
                                Uri.parse(ORIGIN), null);
                    } catch (Exception ignored) {}
                    if (asked) handler.postDelayed(launch, VALIDATION_TIMEOUT_MS);
                    else launch.run();
                } catch (Exception e) {
                    fallback();
                }
            }
            @Override public void onServiceDisconnected(ComponentName name) {}
        };

        boolean ok = false;
        try { ok = bindService(bind, connection, Context.BIND_AUTO_CREATE); }
        catch (Exception ignored) {}
        if (!ok) { connection = null; fallback(); return; }

        // Safety net: if the service never connects, open the plain browser. Once connected, the
        // validation wait (up to VALIDATION_TIMEOUT_MS) owns the launch, so this must not cut it short.
        handler.postDelayed(new Runnable() {
            @Override public void run() { if (!connected) fallback(); }
        }, 2000);
    }

    /** Main thread only. Runs once: on Chrome's validation answer or on the timeout, whichever is first. */
    private void launchTwa(String pkg, ICustomTabsCallback.Stub cb) {
        if (launched || destroyed || isFinishing()) return;
        launched = true;
        if (!openInSession(pkg, cb, url)) { launched = false; fallback(); return; }
        // v1.0.2 (24 Sep 2026): do NOT finish here. Chrome ties the TWA's trust to this
        // app's live session binder. Finishing 0.5 s after launch left the process with no
        // activity, and aggressive Android skins killed it — the session died with it and
        // Chrome fell back to a Custom Tab: the "X · loadboot.com · share" bar on top.
        // The official android-browser-helper launcher stays in the back stack the same way
        // and closes itself when the user comes back from the web app (onRestart below).
    }

    /** Fires the ACTION_VIEW into an existing Custom Tabs session as a TWA. False if the browser refused. */
    private boolean openInSession(String pkg, ICustomTabsCallback.Stub cb, Uri target) {
        Intent i = new Intent(Intent.ACTION_VIEW, target);
        i.setPackage(pkg);
        Bundle extras = new Bundle();
        extras.putBinder(EXTRA_SESSION, cb.asBinder());
        i.putExtras(extras);
        i.putExtra(EXTRA_LAUNCH_AS_TWA, true);
        try { startActivity(i); return true; }
        catch (Exception e) { return false; }
    }

    /**
     * A new intent delivered to this same instance (a launcher tap or a loadboot.com link while this
     * instance is top of its task). Reuse this instance's binding and session — never bind again.
     * Before launch: the pending launch simply picks up the new URL. After launch: navigate the
     * existing TWA there.
     */
    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        Uri data = intent != null ? intent.getData() : null;
        if (data == null) return;
        url = data;
        if (launched && session != null && browserPkg != null && !isFinishing()) {
            openInSession(browserPkg, session, url);
        }
    }

    /** User pressed Back out of the web app and landed here: close the app, as the official launcher does. */
    @Override
    protected void onRestart() {
        super.onRestart();
        if (launched) finish();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        outState.putBoolean(STATE_LAUNCHED, launched);
    }

    @Override
    protected void onDestroy() {
        destroyed = true;
        // Nothing queued may run against a dead activity (the 2 s safety net, the 3 s validation timeout).
        handler.removeCallbacksAndMessages(null);
        // The binding belongs to this Context and cannot outlive it: on destroy Android drops it
        // anyway, logging a "leaked ServiceConnection". Release it ourselves, every time.
        if (connection != null) {
            try { unbindService(connection); } catch (Exception ignored) {}
            connection = null;
        }
        super.onDestroy();
    }

    /** Prefer Chrome; otherwise any browser exposing the Custom Tabs service. */
    private String pickBrowser() {
        Intent probe = new Intent(ACTION_CUSTOM_TABS_CONNECTION);
        List<ResolveInfo> services =
                getPackageManager().queryIntentServices(probe, 0);
        String first = null;
        for (ResolveInfo ri : services) {
            String p = ri.serviceInfo.packageName;
            if ("com.android.chrome".equals(p)) return p;
            if (first == null) first = p;
        }
        return first;
    }

    private void fallback() {
        if (launched || destroyed) return;
        launched = true;
        // Open in a real browser, never back into this app (our own VIEW filter
        // for loadboot.com could otherwise loop once app links verify).
        Intent i = new Intent(Intent.ACTION_VIEW, url);
        i.addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            Intent probe = new Intent(Intent.ACTION_VIEW, Uri.parse("https://example.com"));
            probe.addCategory(Intent.CATEGORY_BROWSABLE);
            String pick = null;
            for (ResolveInfo ri : getPackageManager().queryIntentActivities(probe, 0)) {
                String p = ri.activityInfo.packageName;
                if (getPackageName().equals(p)) continue;
                if ("com.android.chrome".equals(p)) { pick = p; break; }
                if (pick == null) pick = p;
            }
            if (pick != null) i.setPackage(pick);
        } catch (Exception ignored) {}
        try { startActivity(i); }
        catch (Exception e) {
            try { startActivity(new Intent(Intent.ACTION_VIEW, url)); }
            catch (Exception ignored) {}
        }
        finishSoon();
    }

    private void finishSoon() {
        handler.postDelayed(new Runnable() {
            @Override public void run() { finish(); }
        }, 500);
    }
}
