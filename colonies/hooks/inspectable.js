// after_prepare compat fixes for building the 2023 plugin set with a current Xcode.
// (Web Inspector is enabled via <preference name="InspectableWebview" value="true"/> in cordova-ios 8.)
const fs = require('fs');
const path = require('path');

function find(dir, name, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory() && e.name !== 'Pods' && e.name !== 'build') find(p, name, out);
    else if (e.name === name) out.push(p);
  }
  return out;
}

module.exports = function (ctx) {
  // cordova-plugin-network-information 2.0.2: private header rejected by Xcode 16+ (netinet/in.h is enough)
  for (const f of find(path.join(ctx.opts.projectRoot, 'platforms/ios'), 'CDVReachability.m')) {
    const s = fs.readFileSync(f, 'utf8');
    if (s.includes('#import <netinet6/in6.h>')) {
      fs.writeFileSync(f, s.replace('#import <netinet6/in6.h>', '// BHC: removed #import <netinet6/in6.h>'));
      console.log('compat hook: removed netinet6/in6.h import in ' + path.relative(ctx.opts.projectRoot, f));
    }
  }
  // Phone battery level (the firmware-update gate needs >= 25 %, 3488.js ~l. 1843). At startup the game subscribes to
  // `batterystatus` (cordova-plugin-battery-status) and calls cordova.plugins.diagnostic.getCurrentBatteryLevel.
  // diagnostic 7.1.1 reads UIDevice.batteryLevel off the main thread right after enabling monitoring (-1 -> "-100 %",
  // so the gate always says "UPGRADE BLOCKED") and then disables monitoring, which also silences battery-status.
  // battery-status 2.0.3 only reports changes, never the level at start. Fix: read on the main thread, keep
  // monitoring on, retry while iOS still says -1 (stays -1 where there is no battery, e.g. the Simulator), and
  // send battery-status's first reading.
  const iosPlugins = path.join(ctx.opts.projectRoot, 'platforms/ios');
  const nativeFixes = [
    ['Diagnostic.m', /- \(void\) getCurrentBatteryLevel: \(CDVInvokedUrlCommand\*\)command \{\n[\s\S]*?\n    \}\];\n\}\n/, `- (void) getCurrentBatteryLevel: (CDVInvokedUrlCommand*)command {
    // BHC: main thread, monitoring left on, retry while the level is still unknown (see hooks/inspectable.js)
    dispatch_async(dispatch_get_main_queue(), ^{ [self bhcSendBatteryLevel:command tries:20]; });
}

- (void) bhcSendBatteryLevel: (CDVInvokedUrlCommand*)command tries:(int)tries {
    UIDevice* currentDevice = [UIDevice currentDevice];
    if (!currentDevice.batteryMonitoringEnabled) [currentDevice setBatteryMonitoringEnabled:YES];
    float level = [currentDevice batteryLevel];
    if (level < 0 && tries > 0) {
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.1 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self bhcSendBatteryLevel:command tries:tries - 1];
        });
        return;
    }
    int batteryLevel = level < 0 ? -1 : (int)lroundf(level * 100);
    [self logDebug:[NSString stringWithFormat:@"Battery level: %d", batteryLevel]];
    [self sendPluginResultInt:batteryLevel:command];
}
`],
    ['CDVBattery.m', /if \(\[UIDevice currentDevice\]\.batteryMonitoringEnabled == NO\) \{/, `// BHC: register even when another plugin already turned monitoring on (see hooks/inspectable.js)
    [[NSNotificationCenter defaultCenter] removeObserver:self name:UIDeviceBatteryStateDidChangeNotification object:nil];
    [[NSNotificationCenter defaultCenter] removeObserver:self name:UIDeviceBatteryLevelDidChangeNotification object:nil];
    {`],
    ['CDVBattery.m', /(name:UIDeviceBatteryLevelDidChangeNotification object:nil\];\r?\n    \}\r?\n)/, `$1    // BHC: also report the level at start, not only changes (see hooks/inspectable.js)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self updateBatteryStatus:nil];
    });
`],
  ];
  for (const name of new Set(nativeFixes.map((x) => x[0]))) {
    for (const f of find(iosPlugins, name)) {
      let s = fs.readFileSync(f, 'utf8');
      if (s.includes('// BHC:')) continue;
      for (const [n, re, repl] of nativeFixes) {
        if (n !== name) continue;
        const t = s.replace(re, repl);
        if (t === s) throw new Error('compat hook: battery fix did not apply to ' + f);
        s = t;
      }
      fs.writeFileSync(f, s);
      console.log('compat hook: battery level fix in ' + path.relative(ctx.opts.projectRoot, f));
    }
  }
  // Pods: iOSDFULibrary/ZIPFoundation end up with a deployment target above the app's 15.0 (seen: 17.6), so
  // `import iOSDFULibrary` fails with "module has a minimum deployment target of iOS 17.6". Pin every pod target to 15.0.
  const pods = path.join(ctx.opts.projectRoot, 'platforms/ios/Pods/Pods.xcodeproj/project.pbxproj');
  if (fs.existsSync(pods)) {
    const s = fs.readFileSync(pods, 'utf8');
    const t = s.replace(/IPHONEOS_DEPLOYMENT_TARGET = [\d.]+;/g, 'IPHONEOS_DEPLOYMENT_TARGET = 15.0;');
    if (t !== s) {
      fs.writeFileSync(pods, t);
      console.log('compat hook: pinned pod deployment targets to iOS 15.0');
    }
  }
};
