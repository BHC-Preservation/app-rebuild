#!/usr/bin/env bash
# UNTESTED SKETCH of an Android / Fire OS build. Not run by anyone yet, not maintained, not called by setup.sh.
# It shows what an Android counterpart of ../setup.sh would roughly look like. Read it, adapt it, and expect
# to fix things along the way (see README.md next to it for the known open questions).
#
# Assumes: ../extract/out/app-snapshot (www/ from your own copy of the app), Android SDK + JDK 17,
# ANDROID_HOME set, mise (Node 22) as for iOS.
echo "android/sketch.sh is an untested outline, read it and remove this line before running" >&2; exit 1

set -euo pipefail
cd "$(dirname "$0")/.."
SNAP=${BHC_SNAPSHOT:-../extract/out/app-snapshot}
P=colonies-android
CDV="mise exec -- npx cordova"

[ -d node_modules/cordova ] || mise exec -- npm i -D cordova@12
rm -rf $P
$CDV create $P org.bhcpreserve.colonies "Colonies BHC" >/dev/null
cp colonies/config.xml $P/            # shared config; the <platform name="android"> block still has to be written
cd $P
$CDV platform add android@14          # TODO: pick a version; 14 targets API 35, minSdk 24 (Fire OS 7 = API 28, OK)

# Same plugin list as ../setup.sh. Plugins that are iOS-only fixes there are not needed here, but the versions
# may need bumping for a current targetSdk (Android 12+ Bluetooth permissions, Android 14 foreground services).
PLUGINS=(
  cordova-plugin-file@6.0.2           # TODO: 8.x for cordova-android 12+?
  cordova-plugin-device@2.1.0
  cordova-plugin-screen-orientation@3.0.3
  cordova-plugin-statusbar@2.4.3
  cordova-plugin-network-information@2.0.2
  cordova-plugin-zip@3.1.0
  cordova-plugin-file-md5@0.3.3
  cordova-plugin-file-downloader@0.4.0
  cordova-plugin-app-version@0.1.14
  cordova-plugin-battery-status@2.0.3
  cordova.plugins.diagnostic@7.1.1
  cordova-plugin-globalization@1.11.0
  cordova-plugin-insomnia@4.3.0
  cordova-plugin-inappbrowser@6.0.0
  cordova-plugin-dialogs@2.0.2
  cordova-plugin-media@5.0.4          # TODO: 7.x for current cordova-android?
  cordova-plugin-bluetoothle@6.7.2    # has the Android 12 scan/connect permission calls the game uses
  cordova-plugin-device-motion@2.0.1
  # + the other original plugins from ../setup.sh, same order
  ../../local-plugins/cordova-plugin-lock-font-size   # TODO: its Android native part is missing in our copy
  ../../local-plugins/cordova-plugin-dfu-update       # TODO: Nordic Android DFU 1.11.0 → 2.x for targetSdk 34+
)
for p in "${PLUGINS[@]}"; do $CDV plugin add "$p" --nosave --force; done

# Original www/ minus Cordova's own files, plus our overlay (same as iOS).
rm -rf www && rsync -a --exclude cordova.js --exclude cordova_plugins.js --exclude plugins/ --exclude cordova-js-src/ "$SNAP/www/" www/
cp ../overlay/bhc-compat.js ../overlay/bhc-debug.js www/
# TODO: the sed lines from ../setup.sh use BSD `sed -i ''`; on Linux it's `sed -i`.
sed -i.bak 's#    <script src="cordova.js"></script>#    <script src="bhc-debug.js"></script>\n    <script src="bhc-compat.js"></script>\n    <script src="cordova.js"></script>#' www/index.html && rm www/index.html.bak

$CDV build android --debug            # → platforms/android/app/build/outputs/apk/debug/app-debug.apk
# Install: adb install -r platforms/android/app/build/outputs/apk/debug/app-debug.apk
