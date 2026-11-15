/*global cordova */

var LockFontSize = function() {};

LockFontSize.prototype.init = function () {
  // BHC: no iOS native class exists. cordova-ios 6 answered such calls with "Class not found" (-> false);
  // cordova-ios 8 never answers, which hung app start. Resolve like the original did on iOS.
  if (cordova.platformId === 'ios') return Promise.resolve(false);
  return new Promise(function (resolve) {
    cordova.exec(
      function () { resolve(true); },
      function () { resolve(false); },
      "LockFontSize",
      "init",
      []
    );
  });
};

module.exports = new LockFontSize();

