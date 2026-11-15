# Colonies rebuild (Cordova)

Własna, podpisywana przez nas kopia apki Colonies 1.3.13: **oryginalne `www/` bez zmian** (z `../re/app-snapshot/www`)
plus publiczne pluginy Cordovy w wersjach z oryginału. Bundle ID `org.bhcpreserve.colonies`, nazwa „Colonies BHC”.
Instaluje się obok oryginału i ma osobne dane (ustawienia, zapisane gry).

## Budowanie

```bash
./setup.sh                                   # odtwarza colonies/ od zera (platforma, pluginy, www, shimy)
cd colonies
LANG=en_US.UTF-8 mise exec -- npx cordova build ios --emulator --buildConfig=build.json   # symulator
```

Na iPhone'a / Maca: otwórz `colonies/platforms/ios/App.xcworkspace` w Xcode → target **App** → *Signing & Capabilities* →
wybierz swój Team (Apple ID dodane w Xcode → Settings → Accounts) → urządzenie: iPhone albo „My Mac (Designed for iPad)” → Run.
Darmowe konto: podpis ważny 7 dni.

## Debug

- **Overlay** (`overlay/bhc-debug.js`): na ekranie widać `console.*`, błędy JS, każdy `fetch` (URL, status, czas,
  „still pending after 10 s”) i wywołania natywne, które nie wróciły (np. wiszący plugin). Pokaż/ukryj: 3× tap w lewy górny róg.
  Pełny log: `window.__bhcLog`.
- **Safari Web Inspector**: `InspectableWebview=true`. Safari → Develop → [urządzenie/symulator] → Colonies BHC.

## Różnice względem oryginału (wszystkie wymuszone przez obecny iOS/Xcode)

| co | dlaczego |
|---|---|
| cordova-ios 6.3.0 → **8.2.0** | iOS 27 SDK wymaga UIScene lifecycle („UIScene life cycle is required”) |
| `cordova-plugin-dfu-update` → lokalna kopia: iOSDFULibrary 4.8.0 → 4.11.1, Swift dostosowany do cordova-ios 8 | 4.8.0 nie kompiluje się z SDK iOS 15+ |
| `cordova-plugin-inappbrowser` 5.0.0 → 6.0.0 | nagłówki 5.0.0 zakładały PCH usunięty w cordova-ios 8 |
| `cordova-plugin-add-swift-support` usunięty | cordova-ios 8 ma Swift natywnie; hook pluginu szuka starej nazwy projektu |
| `@globules-io/cordova-plugin-ios-xhr` usunięty | jego polyfill XHR zwraca 400 dla `app://`; cordova-ios 8 sam serwuje www |
| `cordova-plugin-lock-font-size` → lokalny, tylko JS, na iOS `resolve(false)` | oryginał nie miał części iOS; cordova-ios 8 nie odpowiada na brakującą klasę → start wisiał |
| `cordova-plugin-network-information` 2.0.2 + hook usuwa `#import <netinet6/in6.h>` | prywatny nagłówek odrzucany przez nowy Xcode |
| `bhc-compat.js`: `screen.orientation.lock()` | w nowym WKWebView brak/wisi → gra przerywała start (czarny ekran) |
| `IPHONEOS_DEPLOYMENT_TARGET=15.0` (`build.json`) | Xcode 27 nie wspiera celów < 15 (oryginał też miał min. 15.0) |

Zweryfikowane w symulatorze iPhone 18 Pro (iOS 27.2): intro → disclaimer → menu główne. BLE i DFU wymagają prawdziwego urządzenia.
