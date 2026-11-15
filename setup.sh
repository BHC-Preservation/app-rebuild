#!/usr/bin/env bash
# Recreate the Colonies rebuild project from scratch:
#   cordova-ios 8.2.0 (UIScene, required by iOS 27 SDK) + the original 23 plugins + preserved www/.
# Usage: ./setup.sh [--unlock-fleets]
#   (then: cd colonies && npx cordova build ios --emulator --buildConfig=build.json)
#   --unlock-fleets  apply patches/fleet_gate.py: the fleet picker uses the ARC's fleet table
#                    (the release build hides every fleet behind _debug)
set -euo pipefail
UNLOCK_FLEETS=0
for a in "$@"; do
  case "$a" in
    --unlock-fleets) UNLOCK_FLEETS=1 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
cd "$(dirname "$0")"
export LANG=en_US.UTF-8
CDV="mise exec -- npx cordova"
P=colonies
SNAP=../re/app-snapshot/www

[ -d node_modules/cordova ] || mise exec -- npm i -D cordova@12

# Keep our hand-written files, rebuild the rest.
mkdir -p .keep && cp $P/config.xml $P/build.json .keep/ && cp -R $P/hooks .keep/
rm -rf $P
$CDV create $P org.bhcpreserve.colonies "Colonies BHC" >/dev/null
cp .keep/config.xml .keep/build.json $P/ && rm -rf $P/hooks && cp -R .keep/hooks $P/ && rm -rf .keep
cd $P
$CDV telemetry off >/dev/null 2>&1 || true
$CDV platform add ios@8.2.0

# Original plugin set (re/app-snapshot/www/cordova_plugins.js metadata), in dependency order.
# Deviations from the original are marked BHC.
PLUGINS=(
  cordova-plugin-file@6.0.2
  cordova-plugin-device@2.1.0
  cordova-plugin-screen-orientation@3.0.3
  cordova-plugin-statusbar@2.4.3
  # cordova-plugin-add-swift-support@2.0.2        BHC: dropped, cordova-ios 8 is Swift-native and its hook expects the old project name
  cordova-plugin-network-information@2.0.2          # BHC: hook drops a private #import
  cordova-plugin-zip@3.1.0
  cordova-plugin-file-md5@0.3.3
  https://github.com/apache/cordova-plugin-file-transfer.git   # original: 2.0.0-dev
  cordova-plugin-file-downloader@0.4.0
  cordova-plugin-app-version@0.1.14
  cordova-plugin-battery-status@2.0.3
  cordova.plugins.diagnostic@7.1.1
  cordova-plugin-globalization@1.11.0
  cordova-plugin-insomnia@4.3.0
  ../local-plugins/cordova-plugin-lock-font-size    # BHC: JS-only (no iOS native part existed)
  cordova-plugin-inappbrowser@6.0.0                 # BHC: 5.0.0 headers relied on the PCH dropped in cordova-ios 8
  cordova-plugin-dialogs@2.0.2
  cordova-plugin-media@5.0.4
  cordova-plugin-bluetoothle@6.7.2
  cordova-plugin-device-motion@2.0.1
  # @globules-io/cordova-plugin-ios-xhr@1.2.4     BHC: dropped; its XHR polyfill returns 400 for app:// URLs (cordova-ios 8 serves www via
  #                                                its own scheme handler, so file:// XHR workarounds are not needed)
  ../local-plugins/cordova-plugin-dfu-update        # BHC: 1.3.0 with iOSDFULibrary 4.8.0 -> 4.11.1
)
for p in "${PLUGINS[@]}"; do
  echo "== $p"
  $CDV plugin add "$p" --nosave --force 2>&1 | grep -vE '^\s+(at|from) ' | tail -2
done

# Original www/ minus files Cordova generates itself.
rm -rf www && rsync -a --exclude cordova.js --exclude cordova_plugins.js --exclude plugins/ --exclude cordova-js-src/ ../$SNAP/ www/
# BHC additions, loaded before cordova.js:
#   bhc-compat.js  required shims for current iOS/WebKit (see file)
#   bhc-debug.js   on-screen console / errors / fetch log (drop for a pristine build)
# Optional game-code patch (off by default; the default build keeps www/js/index.min.js untouched).
if [ $UNLOCK_FLEETS = 1 ]; then python3 -I ../patches/fleet_gate.py www/js/index.min.js; fi
cp ../overlay/bhc-compat.js ../overlay/bhc-debug.js www/
sed -i '' 's#    <script src="cordova.js"></script>#    <script src="bhc-debug.js"></script>\n    <script src="bhc-compat.js"></script>\n    <script src="cordova.js"></script>#' www/index.html
$CDV prepare ios

# Sanity check: same JS plugin modules as the original app.
diff <(grep -o '"id": "[^"]*"' ../$SNAP/cordova_plugins.js | grep -v 'cordova-plugin-ios-xhr' | sort) \
     <(grep -o '"id": "[^"]*"' platforms/ios/www/cordova_plugins.js | sort) \
  && echo "OK: plugin modules identical to original (minus ios-xhr, see above)"
