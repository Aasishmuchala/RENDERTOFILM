// electron-builder's afterPack: flips the Electron fuses, then seals the app with
// an ad-hoc signature, in that order because a flip changes the signed binary.
// Nothing packaged uses run-as-node: the server is a utility process. No
// certificate is involved. `identity: null` alone leaves stock Electron's
// signature on a changed bundle: codesign and syspolicy_check reject that as
// broken, and a quarantined copy exits with nothing left to approve. Sealed,
// macOS holds the launch for a decision instead. It also gives the app its own
// code hash, where stock Electron's is shared by every app on this version.
const { execFileSync } = require('node:child_process');
const path = require('node:path');

exports.default = async function afterPack({ electronPlatformName, appOutDir, packager }) {
  const { FuseV1Options, FuseVersion, flipFuses } = await import('@electron/fuses'); // ESM only
  const extension = electronPlatformName === 'darwin' ? 'app' : 'exe';
  const app = path.join(appOutDir, `${packager.appInfo.productFilename}.${extension}`);
  await flipFuses(app, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: true,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
  });
  if (electronPlatformName !== 'darwin') return;
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--identifier', packager.appInfo.id, app], {
    stdio: 'inherit',
  });
};
