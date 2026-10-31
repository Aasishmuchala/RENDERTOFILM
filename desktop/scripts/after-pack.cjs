// electron-builder's afterPack: seals the app with an ad-hoc signature. No
// certificate is involved. `identity: null` alone leaves stock Electron's
// signature on a changed bundle: codesign and syspolicy_check reject that as
// broken, and a quarantined copy exits with nothing left to approve. Sealed,
// macOS holds the launch for a decision instead. It also gives the app its own
// code hash, where stock Electron's is shared by every app on this version.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack({ electronPlatformName, appOutDir, packager }) {
  if (electronPlatformName !== 'darwin') return;
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', packager.appInfo.id, app], {
    stdio: 'inherit',
  });
};
