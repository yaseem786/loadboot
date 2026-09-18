#!/usr/bin/env bash
# apply-ios-config.sh — make the generated Xcode project (ios/) store-ready.
# Runs on macOS (Codemagic or a Mac) AFTER `npx cap add ios`, BEFORE `npx cap sync ios`.
# Idempotent: safe to run again on an existing ios/ folder.
#
# What it does:
#   1. Info.plist  — privacy usage strings (camera, photos, location), WKAppBoundDomains,
#                    remote-notification background mode, export compliance, display name.
#   2. Entitlements — aps-environment + associated domains (Universal Links).
#   3. AppDelegate — forwards the APNs device token to the Capacitor push plugin.
#   4. PrivacyInfo.xcprivacy — Apple privacy manifest, added to the App target.
set -euo pipefail
cd "$(dirname "$0")/.."
IOS=ios/App
PLIST="$IOS/App/Info.plist"
PB=/usr/libexec/PlistBuddy
[ -f "$PLIST" ] || { echo "Info.plist not found — run 'npx cap add ios' first"; exit 1; }

set_str() { # key value
  if $PB -c "Print :$1" "$PLIST" >/dev/null 2>&1; then $PB -c "Set :$1 '$2'" "$PLIST"; else $PB -c "Add :$1 string '$2'" "$PLIST"; fi
}
set_bool() { # key true|false
  if $PB -c "Print :$1" "$PLIST" >/dev/null 2>&1; then $PB -c "Set :$1 $2" "$PLIST"; else $PB -c "Add :$1 bool $2" "$PLIST"; fi
}

# ---- 1. Info.plist ----------------------------------------------------------
set_str CFBundleDisplayName "LoadBoot"
set_str NSCameraUsageDescription "LoadBoot uses the camera to photograph proof-of-delivery, bills of lading and compliance documents you choose to upload."
set_str NSPhotoLibraryUsageDescription "LoadBoot lets you pick existing photos of documents (BOL, POD, insurance) to attach to a load or your carrier file."
set_str NSPhotoLibraryAddUsageDescription "LoadBoot can save rate confirmations and settlement PDFs you export to your photo library."
set_str NSLocationWhenInUseUsageDescription "LoadBoot uses your location only while you are running a load you accepted, to show live tracking and GPS-stamped pickup and delivery proof to the broker or shipper."
set_str NSLocationAlwaysAndWhenInUseUsageDescription "Optional: allow background location during an active trip so tracking continues when the app is minimized. You can turn this off at any time."
set_bool ITSAppUsesNonExemptEncryption false      # HTTPS only → export-compliance question answered in the binary
set_bool UIRequiresFullScreen false

# Background modes: remote notifications (silent push wake-ups for tracking reminders)
$PB -c "Delete :UIBackgroundModes" "$PLIST" >/dev/null 2>&1 || true
$PB -c "Add :UIBackgroundModes array" "$PLIST"
$PB -c "Add :UIBackgroundModes:0 string remote-notification" "$PLIST"

# App-bound domains — enables Service Workers + full web APIs in WKWebView for these hosts.
$PB -c "Delete :WKAppBoundDomains" "$PLIST" >/dev/null 2>&1 || true
$PB -c "Add :WKAppBoundDomains array" "$PLIST"
$PB -c "Add :WKAppBoundDomains:0 string loadboot.com" "$PLIST"
$PB -c "Add :WKAppBoundDomains:1 string www.loadboot.com" "$PLIST"
$PB -c "Add :WKAppBoundDomains:2 string rwscphuhpjoudvljvmdk.supabase.co" "$PLIST"

# Deep-link scheme (custom URL) as a fallback next to Universal Links: loadboot://app/carrier/
$PB -c "Delete :CFBundleURLTypes" "$PLIST" >/dev/null 2>&1 || true
$PB -c "Add :CFBundleURLTypes array" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0 dict" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLName string com.loadboot.app" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$PLIST"
$PB -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string loadboot" "$PLIST"

# ---- 2. Entitlements -------------------------------------------------------
cp ios-config/App.entitlements "$IOS/App/App.entitlements"
PBX="$IOS/App.xcodeproj/project.pbxproj"
if ! grep -q "CODE_SIGN_ENTITLEMENTS" "$PBX"; then
  # add to every build configuration of the App target
  sed -i '' 's/PRODUCT_BUNDLE_IDENTIFIER = com.loadboot.app;/PRODUCT_BUNDLE_IDENTIFIER = com.loadboot.app;\n\t\t\t\tCODE_SIGN_ENTITLEMENTS = App\/App.entitlements;/g' "$PBX"
fi

# ---- 3. AppDelegate: APNs token → Capacitor push plugin ---------------------
AD="$IOS/App/AppDelegate.swift"
if ! grep -q "capacitorDidRegisterForRemoteNotifications" "$AD"; then
  python3 - "$AD" <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
hook='''
    // LoadBoot: forward the APNs device token / failure to @capacitor/push-notifications.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }
'''
# insert before the last closing brace of the AppDelegate class
i=s.rstrip().rfind('}')
s=s[:i]+hook+'\n'+s[i:]
open(p,'w').write(s)
PY
fi

# ---- 4. Privacy manifest ---------------------------------------------------
cp ios-config/PrivacyInfo.xcprivacy "$IOS/App/PrivacyInfo.xcprivacy"
if ! grep -q "PrivacyInfo.xcprivacy" "$PBX"; then
  # Register the file with the project + App target resources (Ruby xcodeproj ships with CocoaPods/Codemagic).
  ruby -e '
    require "xcodeproj"
    proj = Xcodeproj::Project.open("ios/App/App.xcodeproj")
    app = proj.targets.find { |t| t.name == "App" }
    grp = proj.main_group.find_subpath("App", true)
    ref = grp.new_file("PrivacyInfo.xcprivacy")
    app.resources_build_phase.add_file_reference(ref, true)
    proj.save
  ' || echo "WARN: could not register PrivacyInfo.xcprivacy (gem xcodeproj missing?) — add it in Xcode: App target → Build Phases → Copy Bundle Resources"
fi

echo "apply-ios-config: OK"
