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
};
