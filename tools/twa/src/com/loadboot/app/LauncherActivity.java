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

    /** Kept static so the service binding survives this activity finishing. */
    private static ServiceConnection sConnection;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean launched = false;
    private Uri url;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Uri data = getIntent() != null ? getIntent().getData() : null;
        url = data != null ? data : Uri.parse(DEFAULT_URL);

        final String pkg = pickBrowser();
        if (pkg == null) { fallback(); return; }

        Intent bind = new Intent(ACTION_CUSTOM_TABS_CONNECTION).setPackage(pkg);
        sConnection = new ServiceConnection() {
            @Override public void onServiceConnected(ComponentName name, IBinder binder) {
                try {
                    ICustomTabsService service = ICustomTabsService.Stub.asInterface(binder);
                    service.warmup(0);
                    ICustomTabsCallback.Stub cb = new ICustomTabsCallback.Stub() {
                        @Override public void onNavigationEvent(int e, Bundle b) {}
                        @Override public void extraCallback(String s, Bundle b) {}
                        @Override public void onMessageChannelReady(Bundle b) {}
                        @Override public void onPostMessage(String s, Bundle b) {}
                        @Override public void onRelationshipValidationResult(
                                int r, Uri o, boolean res, Bundle b) {}
                    };
                    service.newSession(cb);
                    Intent i = new Intent(Intent.ACTION_VIEW, url);
                    i.setPackage(pkg);
                    Bundle extras = new Bundle();
                    extras.putBinder(EXTRA_SESSION, cb.asBinder());
                    i.putExtras(extras);
                    i.putExtra(EXTRA_LAUNCH_AS_TWA, true);
                    startActivity(i);
                    launched = true;
                    finishSoon();
                } catch (Exception e) {
                    fallback();
                }
            }
            @Override public void onServiceDisconnected(ComponentName name) {}
        };

        boolean ok = false;
        try { ok = bindService(bind, sConnection, Context.BIND_AUTO_CREATE); }
        catch (Exception ignored) {}
        if (!ok) { fallback(); return; }

        // Safety net: if the service never connects, open the plain browser.
        handler.postDelayed(new Runnable() {
            @Override public void run() { if (!launched) fallback(); }
        }, 3000);
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
        if (launched) return;
        launched = true;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url));
        } catch (Exception ignored) {}
        finishSoon();
    }

    private void finishSoon() {
        handler.postDelayed(new Runnable() {
            @Override public void run() { finish(); }
        }, 500);
    }
}
