#!/usr/bin/env bash
# Recreate the Colonies rebuild project from scratch:
#   cordova-ios 8.2.0 (UIScene, required by iOS 27 SDK) + the original 23 plugins + preserved www/.
# Usage: ./setup.sh [--unlock-fleets] [--fix-task-queue] [--api=timeout|block|fake|<URL>] [--no-pause-fade]
#                   [--snapshot=DIR] [--from-deob[=DIR]] [--patch=FILE ...]
#   (then: cd colonies && npx cordova build ios --emulator --buildConfig=build.json)
#   --unlock-fleets  apply patches/fleet_gate.py: the fleet picker uses the ARC's fleet table
#                    (the release build hides every fleet behind _debug)
#   --fix-task-queue apply patches/task_queue.py: removeTask no longer drops the last queued task, which left the
#                    app stuck at "synchronizing with ARC" when the publisher API answers slowly (e.g. --api=<URL>)
#   --api=MODE       what happens to requests for the dead publisher API exogen.space/bhcapi (see overlay/bhc-compat.js):
#                    timeout (default, fail after 1 s), block (fail at once), fake (local answers: FW current,
#                    app compatible), or a base URL of a replacement server, e.g. --api=https://bhc.example.org/bhcapi/
#   --no-pause-fade  keep the screen visible when the app goes to the background (the game hides it, so returning
#                    to the app flashes black); see overlay/bhc-compat.js, shim 4
#   --snapshot=DIR   the original app's web layer: a directory holding www/ (default: $BHC_SNAPSHOT, else the first of
#                    ../re/app-snapshot and ../extract/out/app-snapshot; the latter is what extract.sh produces from
#                    your own copy of the app, see https://github.com/BHC-Preservation/extract)
#   --from-deob[=DIR] build www/js/index.min.js from the deobfuscated modules instead of the original file: copy DIR
#                    (default: deob/ next to the snapshot, i.e. ../extract/out/deob), apply patches, then put the modules
#                    back together with ../extract/rebundle.mjs. Game-code patches are then diffs on the modules:
#                    --unlock-fleets -> patches/deob/fleet-gate.patch, --fix-task-queue -> patches/deob/task-queue.patch
#   --patch=FILE     (with --from-deob, repeatable) apply your own diff to the modules, e.g. made with
#                    diff -U1 a/3488.js b/3488.js (paths relative to the deob dir, -p1)
set -euo pipefail
UNLOCK_FLEETS=0
FIX_TASK_QUEUE=0
NO_PAUSE_FADE=0
API_MODE=timeout
SNAPSHOT="${BHC_SNAPSHOT:-}"
FROM_DEOB=0
DEOB=""
USER_PATCHES=()
for a in "$@"; do
  case "$a" in
    --unlock-fleets) UNLOCK_FLEETS=1 ;;
    --fix-task-queue) FIX_TASK_QUEUE=1 ;;
    --no-pause-fade) NO_PAUSE_FADE=1 ;;
    --snapshot=*) SNAPSHOT="${a#--snapshot=}" ;;
    --from-deob) FROM_DEOB=1 ;;
    --from-deob=*) FROM_DEOB=1; DEOB="${a#--from-deob=}" ;;
    --patch=*) USER_PATCHES+=("${a#--patch=}") ;;
    --api=timeout|--api=block|--api=fake|--api=http://*|--api=https://*) API_MODE="${a#--api=}" ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done
# A user-given snapshot path is relative to the caller's directory, so resolve it before cd.
if [ -n "$SNAPSHOT" ]; then
  _s="$SNAPSHOT"; SNAPSHOT="$(cd "$_s" 2>/dev/null && pwd)" || { echo "snapshot directory not found: $_s" >&2; exit 2; }
fi
abspath() { (cd "$(dirname "$1")" 2>/dev/null && echo "$(pwd)/$(basename "$1")") || { echo "not found: $1" >&2; exit 2; }; }
if [ -n "$DEOB" ]; then DEOB="$(cd "$DEOB" 2>/dev/null && pwd)" || { echo "deob directory not found" >&2; exit 2; }; fi
if [ ${#USER_PATCHES[@]} -gt 0 ]; then
  [ $FROM_DEOB = 1 ] || { echo "--patch needs --from-deob" >&2; exit 2; }
  for i in "${!USER_PATCHES[@]}"; do USER_PATCHES[$i]="$(abspath "${USER_PATCHES[$i]}")"; [ -f "${USER_PATCHES[$i]}" ] || { echo "patch not found: ${USER_PATCHES[$i]}" >&2; exit 2; }; done
fi
cd "$(dirname "$0")"
export LANG=en_US.UTF-8
CDV="mise exec -- npx cordova"
P=colonies
if [ -z "$SNAPSHOT" ]; then
  for d in ../re/app-snapshot ../extract/out/app-snapshot; do
    [ -f "$d/www/index.html" ] && { SNAPSHOT="$d"; break; }
  done
fi
[ -n "$SNAPSHOT" ] && [ -f "$SNAPSHOT/www/js/index.min.js" ] || {
  echo "original www/ not found${SNAPSHOT:+ in $SNAPSHOT}. Extract it from your own copy of the app:" >&2
  echo "  git clone https://github.com/BHC-Preservation/extract ../extract && ../extract/extract.sh" >&2
  echo "or pass --snapshot=DIR (a directory holding www/)" >&2
  exit 2
}
SNAP="$(cd "$SNAPSHOT/www" && pwd)"   # absolute: used from inside $P below
echo "== original www/: $SNAP"

# --from-deob: patched modules -> bundle, before the slow part, so a patch that doesn't apply fails early.
BUNDLE=""
if [ $FROM_DEOB = 1 ]; then
  [ -n "$DEOB" ] || DEOB="$(cd "$SNAPSHOT/.." && pwd)/deob"
  [ -f "$DEOB/deobfuscated.js" ] || { echo "no webcrack output in $DEOB (run extract.sh, or pass --from-deob=DIR)" >&2; exit 2; }
  EXTRACT="$(cd .. && pwd)/extract"
  [ -f "$EXTRACT/rebundle.mjs" ] && [ -d "$EXTRACT/node_modules/@babel/parser" ] \
    || { echo "needs ../extract with its npm packages (git clone https://github.com/BHC-Preservation/extract ../extract && ../extract/extract.sh)" >&2; exit 2; }
  WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
  cp -R "$DEOB" "$WORK/deob"
  DPATCHES=()
  [ $UNLOCK_FLEETS = 1 ] && DPATCHES+=("$(pwd)/patches/deob/fleet-gate.patch")
  [ $FIX_TASK_QUEUE = 1 ] && DPATCHES+=("$(pwd)/patches/deob/task-queue.patch")
  for p in ${DPATCHES[@]+"${DPATCHES[@]}"} ${USER_PATCHES[@]+"${USER_PATCHES[@]}"}; do
    echo "== patch $(basename "$p")"
    patch -p1 -d "$WORK/deob" --forward --batch --no-backup-if-mismatch < "$p" || { echo "patch failed: $p" >&2; exit 1; }
  done
  (cd "$EXTRACT" && mise exec -- node rebundle.mjs "$WORK/deob" "$WORK/index.js")
  BUNDLE="$WORK/index.js"
  echo "== www/js/index.min.js from $DEOB (rebundled)"
fi

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
rm -rf www && rsync -a --exclude cordova.js --exclude cordova_plugins.js --exclude plugins/ --exclude cordova-js-src/ "$SNAP/" www/
# BHC additions, loaded before cordova.js:
#   bhc-compat.js  required shims for current iOS/WebKit (see file)
#   bhc-debug.js   on-screen console / errors / fetch log (drop for a pristine build)
# Optional game-code patches (off by default; the default build keeps www/js/index.min.js untouched).
if [ -n "$BUNDLE" ]; then
  cp "$BUNDLE" www/js/index.min.js   # --from-deob: patches were applied to the modules above
else
  if [ $UNLOCK_FLEETS = 1 ]; then python3 -I ../patches/fleet_gate.py www/js/index.min.js; fi
  if [ $FIX_TASK_QUEUE = 1 ]; then python3 -I ../patches/task_queue.py www/js/index.min.js; fi
fi
cp ../overlay/bhc-compat.js ../overlay/bhc-debug.js www/
# Publisher API mode (--api); characters special to sed / the JS string literal are rejected.
case "$API_MODE" in *"#"*|*"'"*|*"&"*|*"\\"*) echo "--api URL must not contain # ' & or \\" >&2; exit 2 ;; esac
sed -i '' "s#^  var API_MODE = '[^']*';#  var API_MODE = '$API_MODE';#" www/bhc-compat.js
grep -q "^  var API_MODE = '$API_MODE';" www/bhc-compat.js || { echo "failed to set API_MODE in bhc-compat.js" >&2; exit 1; }
if [ $NO_PAUSE_FADE = 1 ]; then
  sed -i '' 's#^  var NO_PAUSE_FADE = false;#  var NO_PAUSE_FADE = true;#' www/bhc-compat.js
  grep -q '^  var NO_PAUSE_FADE = true;' www/bhc-compat.js || { echo "failed to set NO_PAUSE_FADE in bhc-compat.js" >&2; exit 1; }
fi
sed -i '' 's#    <script src="cordova.js"></script>#    <script src="bhc-debug.js"></script>\n    <script src="bhc-compat.js"></script>\n    <script src="cordova.js"></script>#' www/index.html
$CDV prepare ios

# Sanity check: same JS plugin modules as the original app.
diff <(grep -o '"id": "[^"]*"' "$SNAP/cordova_plugins.js" | grep -v 'cordova-plugin-ios-xhr' | sort) \
     <(grep -o '"id": "[^"]*"' platforms/ios/www/cordova_plugins.js | sort) \
  && echo "OK: plugin modules identical to original (minus ios-xhr, see above)"
