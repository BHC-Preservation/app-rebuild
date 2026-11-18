# Android and Amazon Fire (sketch, untested)

Nobody has built Colonies for Android from this repo yet. This folder holds notes and an outline
([`sketch.sh`](sketch.sh)), not a working build. If you try it, please report what you had to change.

## Why it should be possible

- The game is Cordova, and the game code (`www/`) is the same on every platform. It already has Android branches:
  it asks for location permission and, on Android 12+, for Bluetooth scan/connect permissions (deob `3488.js`
  ~l. 1293–1345), and it plays audio from `/android_asset/www/` on non-iOS platforms (`4263.js` ~l. 661).
- The original `config.xml` carries Android settings (minSdk 22, targetSdk 33, AndroidX), so the publisher built
  it for Android as well.
- All native plugins the game uses have Android implementations, including Bluetooth LE
  (`cordova-plugin-bluetoothle`) and Nordic DFU (`cordova-plugin-dfu-update` → Nordic Android-DFU-Library).
- The `www/` extracted from the iOS app is enough: Cordova regenerates `cordova.js` and `cordova_plugins.js` for
  each platform, and `setup.sh` already leaves those out.

## Amazon Fire tablets

Fire OS is Android without Google services (Fire OS 7 = Android 9, Fire OS 8 = Android 11). The game doesn't use
Google services, so the same APK should work. There is no Play Store on Fire, so you sideload it: enable
*Apps from unknown sources* (or developer options + `adb install`). Fire OS 8 is below Android 12, so the game
takes its location-permission path; Bluetooth needs location turned on.

## What is different from the iOS build

| | iOS (`setup.sh`) | Android (to do) |
|---|---|---|
| platform | cordova-ios 8.2.0 | cordova-android 13/14 (current Google Play target SDK); needs JDK 17 + Android SDK, works on Linux/Windows too |
| hooks | `hooks/inspectable.js` (Xcode build fixes, iOS battery level fix) | not needed; whether the phone battery gate works has to be checked separately |
| DFU plugin | local copy with iOSDFULibrary 4.11.1 | the same local copy, Android part still on Nordic DFU 1.11.0; likely needs 2.x for targetSdk 34+ (foreground service rules) |
| lock-font-size | local JS-only copy, answers on iOS | our copy has no Android part; the original plugin does, take it from npm or extend ours |
| `bhc-compat.js` | iOS/WebKit shims | should be harmless on Android; the BLE session workaround (3) is iOS-specific |
| debugging | Safari Web Inspector | `chrome://inspect` (debug builds) |

## Open questions

- **Audio paths.** cordova-android 10+ serves the app from `https://localhost/` instead of `file://`, while the game
  points audio at `/android_asset/www/…`. If sounds are missing, try `<preference name="AndroidInsecureFileModeEnabled" value="true" />`
  (back to `file://`) or a shim in `bhc-compat.js`.
- **Plugin versions.** Several 2023 plugins may need newer releases for current cordova-android / target SDK
  (`file`, `media`, `diagnostic`, `dfu-update`). Each bump should be listed with its reason, as in the iOS deviations table.
- **Permissions on Android 12+.** `bluetoothle` 6.7.2 declares `BLUETOOTH_SCAN`/`BLUETOOTH_CONNECT`; check the merged
  `AndroidManifest.xml` and that the DFU service (now in bootloader mode under a different address, `…_DFU`) is found.
- **Signing.** A debug APK is enough for yourself. As with iOS: build it for your own device, don't share the APK
  (it contains the publisher's `www/`).
