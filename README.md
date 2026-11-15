# Colonies rebuild (Cordova)

## What this is

A copy of the **Colonies 1.3.13** companion app that you build and sign yourself.

The App Store build can't be re-signed or patched: its native binary is FairPlay-encrypted, and any change to
`www/` breaks the signature. But the app is plain Cordova. All of the game logic lives in `www/js/index.min.js`,
and the native side is just public Cordova plugins. This repo rebuilds that native shell from public sources and
puts the **original, unmodified `www/`** inside it.

That way the app keeps working when the App Store version stops installing or running on new iOS versions, and it
gives us a debuggable build (on-screen log, Safari Web Inspector) for reverse engineering.

- Bundle ID `org.bhcpreserve.colonies`, display name **"Colonies BHC"**, version 1.3.13.
- It installs **next to** the original app and keeps its own data (settings, saved games).
- The game code isn't patched. The only additions are two small scripts loaded before `cordova.js` (see
  [Deviations](#deviations-from-the-original)).

**Status:** in the iOS Simulator it starts up and reaches the main menu (intro, disclaimer, main menu; iPhone 18 Pro,
iOS 27.2). BLE (talking to the ARC) and DFU haven't been tested yet because they need real hardware.

## Prerequisites

| what | notes |
|---|---|
| macOS + **Xcode** (tested with 27.2) | with an iOS Simulator runtime installed. Run Xcode once so it installs its extra components |
| **CocoaPods** (tested with 1.17) | `brew install cocoapods`. `cordova-plugin-dfu-update` pulls in `iOSDFULibrary` as a pod |
| **mise** | provides Node 22 (`mise.toml`). Run `mise install` in this directory |
| `git`, `rsync` | one plugin (`cordova-plugin-file-transfer`) installs straight from GitHub |
| network access | npm registry, GitHub, CocoaPods CDN |
| **`../re/app-snapshot/`** | **required.** The original `www/` from the 1.3.13 app comes from the private `BHC/re` repo and isn't stored here |
| Apple ID added in Xcode | only for building to a real iPhone/iPad/Mac. A free account works, but the signature expires after 7 days |

The original `www/` is copyrighted by the publisher, which is why it lives only in the private `re` repo. Clone the
repos side by side:

```bash
git clone <private reference copy of the app www/>
git clone https://github.com/BHC-Preservation/app-rebuild.git
cd app-rebuild && mise install
```

Make sure `../re/app-snapshot/www/index.html` exists before going on.

CocoaPods needs a UTF-8 locale. `setup.sh` sets `LANG=en_US.UTF-8` for its own commands, so also set it for any
manual `cordova`/`pod` commands (as shown below).

## Build

```bash
./setup.sh
cd colonies
LANG=en_US.UTF-8 mise exec -- npx cordova build ios --emulator --buildConfig=build.json
```

`setup.sh` rebuilds `colonies/` from scratch on every run. It keeps the hand-written files (`config.xml`,
`build.json`, `hooks/`) and regenerates everything else:

1. installs the Cordova CLI 12 locally (`node_modules/`) if it's missing
2. `cordova create` + `cordova platform add ios@8.2.0`
3. adds the original plugin set at the original versions, apart from the deviations listed below (two of the
   plugins come from `local-plugins/`)
4. copies `../re/app-snapshot/www/` into `colonies/www/`, leaving out the files Cordova generates itself
5. copies `overlay/bhc-compat.js` and `overlay/bhc-debug.js` and loads them before `cordova.js` in `index.html`
6. runs `cordova prepare ios`, then checks that the JS plugin modules match the original app's
   `cordova_plugins.js` (expected output: `OK: plugin modules identical to original ...`)

The first run takes a few minutes (npm + CocoaPods).

### Running it

- **Simulator:** after the build, open `colonies/platforms/ios/App.xcworkspace` in Xcode and run on a simulator, or
  install the built `.app` from `colonies/platforms/ios/build/` with `xcrun simctl install booted <path>`.
- **iPhone / iPad / Apple Silicon Mac:** open `colonies/platforms/ios/App.xcworkspace` (the **workspace**, not the
  `.xcodeproj`), select target **App**, go to *Signing & Capabilities* and pick your Team. Then choose your device
  or "My Mac (Designed for iPad)" and Run. On iOS, enable Developer Mode on the device the first time.
  You need a real device for Bluetooth (the ARC).

Don't run `cordova build` after changing things in Xcode unless you're happy to lose those changes:
`platforms/` is generated.

## Debugging

- **On-screen overlay** (`overlay/bhc-debug.js`): shows `console.*`, JS errors, every `fetch` (URL, status, timing,
  plus a "still pending after 10 s" warning) and native plugin calls that never returned (such as a hung plugin).
  Triple-tap the top-left corner to show or hide it. The full log is in `window.__bhcLog`.
  To get a clean build without it, leave it out of `setup.sh`.
- **Safari Web Inspector:** turned on with `InspectableWebview=true`. In Safari go to Develop → [device or
  simulator] → Colonies BHC.

The publisher's API (`exogen.space/bhcapi`) is dead (see `AGENTS.md` in the main repo). The app falls back to
local checks when its requests fail, so it works offline.

## Deviations from the original

Every one of these was forced by current iOS/Xcode. Nothing in the game code changes.

| what | why |
|---|---|
| cordova-ios 6.3.0 → **8.2.0** | the iOS 27 SDK requires the UIScene lifecycle ("UIScene life cycle is required") |
| `cordova-plugin-dfu-update` → local copy: iOSDFULibrary 4.8.0 → 4.11.1, Swift adapted to cordova-ios 8 | 4.8.0 doesn't compile against the iOS 15+ SDK |
| `cordova-plugin-inappbrowser` 5.0.0 → 6.0.0 | the 5.0.0 headers relied on the PCH that cordova-ios 8 removed |
| `cordova-plugin-add-swift-support` dropped | cordova-ios 8 supports Swift natively, and the plugin's hook looks for the old project name |
| `@globules-io/cordova-plugin-ios-xhr` dropped | its XHR polyfill returns 400 for `app://` URLs; cordova-ios 8 serves `www/` itself |
| `cordova-plugin-lock-font-size` → local, JS-only, `resolve(false)` on iOS | the original had no iOS native part; cordova-ios 8 never answers calls to a missing class, so startup hung |
| `cordova-plugin-network-information` 2.0.2 + a hook that removes `#import <netinet6/in6.h>` | new Xcode rejects that private header |
| `bhc-compat.js`: `screen.orientation.lock()` shim | on current WKWebView it's missing or never settles, so the game aborted at startup (black screen) |
| `IPHONEOS_DEPLOYMENT_TARGET=15.0` (`build.json`) | Xcode 27 doesn't support targets below 15 (the original's minimum was 15.0 as well) |

## Layout

```
setup.sh            rebuilds colonies/ (see above)
colonies/           Cordova project; only config.xml, build.json, hooks/ and package*.json are tracked
  hooks/            after_prepare fixes for building the 2023 plugin set with current Xcode
local-plugins/      patched plugins (dfu-update, lock-font-size)
overlay/            bhc-compat.js (required shims), bhc-debug.js (on-screen debug log)
mise.toml           Node 22
```

This repo is private. Don't push it, or anything built from it, to a public remote: the built app contains the
publisher's copyrighted `www/`.
