import type { CapacitorConfig } from '@capacitor/cli';

// LoadBoot iOS shell — REMOTE mode.
// The WKWebView loads the live PWA at https://loadboot.com/app/ (same build Netlify
// serves to browsers and to the Android TWA), so every web deploy reaches iOS users
// instantly with no App Store review. Capacitor injects its native bridge into the
// remote page, which is how app/shared/native.js reaches APNs push, the system
// browser, haptics, deep links, etc.
//
// SUPABASE_REF: production project (the live site is wired to it). Never point this
// shell at staging for a store build.
const SUPABASE_REF = 'rwscphuhpjoudvljvmdk';

const config: CapacitorConfig = {
  appId: 'com.loadboot.app',          // same id as the Play package — one identity across stores
  appName: 'LoadBoot',
  webDir: 'www',                       // offline fallback page only (see www/index.html)
  server: {
    url: 'https://loadboot.com/app/',
    // Hosts the WKWebView may navigate to IN-APP. Anything else is opened in the system
    // browser (native.js also enforces this for target=_blank links).
    allowNavigation: ['loadboot.com', '*.loadboot.com', `${SUPABASE_REF}.supabase.co`],
  },
  ios: {
    contentInset: 'automatic',
    // App-bound domains (WKAppBoundDomains in Info.plist) → Service Workers + web push
    // APIs are allowed inside WKWebView for the listed hosts. Required so the PWA's
    // sw.js keeps working in the shell. Max 10 domains (Apple limit).
    limitsNavigationsToAppBoundDomains: true,
    allowsLinkPreview: false,
    scrollEnabled: true,
    backgroundColor: '#0F172A',
    preferredContentMode: 'mobile',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 4000,        // safety cap; native.js hides it as soon as the web app has painted
      launchAutoHide: true,
      backgroundColor: '#0F172A',
      showSpinner: false,
      iosSpinnerStyle: 'small',
      splashImmersive: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    Keyboard: {
      resize: 'native',
      resizeOnFullScreen: true,
    },
    StatusBar: {
      style: 'DARK',                   // light text on the navy header
      backgroundColor: '#0F172A',
      overlaysWebView: false,
    },
  },
};

export default config;
