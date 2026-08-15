# tools/twa — reproducible AAB build (no Android Studio, no Android SDK download)

Builds the Play Store AAB for `com.loadboot.app` from plain Ubuntu packages + two GitHub
jars. Written 2026-08-15 because dl.google.com / maven.google.com were unreachable from
the build container — this path needs only apt + GitHub.

## Why no androidx

`LauncherActivity.java` is a minimal Trusted Web Activity launcher with zero
dependencies: it binds Chrome's CustomTabsService over hand-compiled AIDL
(`ICustomTabsService` / `ICustomTabsCallback`, wire-stable since 2015, explicit
transaction ids), creates a session, and fires an ACTION_VIEW intent with
`EXTRA_LAUNCH_AS_TRUSTED_WEB_ACTIVITY`. Falls back to a plain browser intent if no
Custom-Tabs browser exists. ~150 lines instead of the androidx dependency tree.

## Inputs (this folder)

- `AndroidManifest.xml` — package/version/targetSdk/autoVerify/asset_statements
- `src/com/loadboot/app/LauncherActivity.java`
- `src/android/support/customtabs/ICustomTabsService.java` + `ICustomTabsCallback.java`
  (generated from GoogleChrome/custom-tabs-client AIDL with Ubuntu's `aidl` tool)
- `res/values/strings.xml` — app_name + asset_statements JSON
- mipmap icons are generated from `/icon-512.png` at build time

## Recipe (Linux)

```bash
apt-get install -y android-sdk-build-tools android-sdk-platform-23 dalvik-exchange
# bundletool from github.com/google/bundletool/releases (1.17.2 used)
# aapt2: extract prebuilt/linux/aapt2_64 from apktool_2.9.3.jar (github.com/iBotPeaches/Apktool)

AJ=/usr/lib/android-sdk/platforms/android-23/android.jar
javac -source 8 -target 8 -bootclasspath $AJ -cp src -d classes \
      src/com/loadboot/app/*.java src/android/support/customtabs/*.java
dalvik-exchange --dex --min-sdk-version=21 --output=classes.dex classes

# icons: resize icon-512.png -> res/mipmap-{mdpi:48,hdpi:72,xhdpi:96,xxhdpi:144,xxxhdpi:192}/ic_launcher.png

find res -type f | sort | xargs ./aapt2 compile -o compiled/
./aapt2 link --proto-format -o proto.apk -I $AJ --manifest AndroidManifest.xml \
        --auto-add-overlay compiled/*.flat
mkdir -p module/manifest module/dex && cd module && unzip ../proto.apk \
  && mv AndroidManifest.xml manifest/ && cp ../classes.dex dex/ \
  && zip -r ../base.zip manifest dex res resources.pb && cd ..
java -jar bundletool.jar build-bundle --modules=base.zip --output=loadboot.aab
jarsigner -keystore ../../loadboot-upload.keystore -storepass "$(cat ../../PLAY-KEYSTORE-NOTE.txt | sed -n 's/^Password: //p')" \
          -digestalg SHA-256 -sigalg SHA256withRSA loadboot.aab loadboot
```

## Verify before upload (always)

```bash
java -jar bundletool.jar validate --bundle=loadboot.aab
java -jar bundletool.jar build-apks --bundle=loadboot.aab --output=t.apks --mode=universal \
     --ks=loadboot-upload.keystore --ks-key-alias=loadboot --ks-pass=pass:...
unzip -o t.apks universal.apk && aapt dump badging universal.apk | head
apksigner verify --print-certs universal.apk   # SHA-256 must be A7:F2:…:F1:48
```

## Version bumps

Edit `android:versionCode` (integer, +1 every upload) and `android:versionName` in
`AndroidManifest.xml`. Nothing else changes. The web app itself updates over the air —
the AAB only needs re-uploading when the manifest/icons/launcher change or Play raises
the targetSdk requirement.
