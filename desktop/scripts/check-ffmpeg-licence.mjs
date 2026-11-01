// Licence gate for the ffmpeg this app bundles: asks the binary what it was built
// with, and refuses one that says it has nonfree parts, because that one cannot
// be handed to anybody else. RTF_FFMPEG picks the binary, else ffmpeg-static's.
//   node desktop/scripts/check-ffmpeg-licence.mjs [--warn]
// Exits 2 on nonfree parts, 1 when the binary could not be asked or gave no
// licence, 0 when it passes. --warn prints the failure and exits 0: the interim,
// while the macOS binary is still the nonfree one, until
// .github/workflows/ffmpeg.yml's GPL build replaces it.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DESKTOP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NONFREE = 'ffmpeg reports nonfree parts; this binary cannot be redistributed';

const warn = process.argv.includes('--warn');
const ffmpeg =
  process.env.RTF_FFMPEG?.trim() ||
  path.join(
    DESKTOP,
    'node_modules',
    'ffmpeg-static',
    process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  );

const fail = (message, code) => {
  console.error(message);
  process.exit(warn ? 0 : code);
};

const ask = (flag) => spawnSync(ffmpeg, [flag], { encoding: 'utf8', timeout: 30_000 });
const licence = ask('-L');
const version = ask('-version');

// Both streams of both answers: ffmpeg prints its banner, which has the configure
// line, to stderr and -L's text to stdout. Nonfree wins over a crash after saying so.
const said = [licence, version]
  .map((run) => `${run.stdout ?? ''}${run.stderr ?? ''}`)
  .join('\n');
if (said.toLowerCase().includes('nonfree')) fail(NONFREE, 2);

// Saying nothing is not saying it is free, and -L answers on stdout: the banner
// on stderr comes with every run, so it says nothing about the licence.
const unread = `could not read the licence of ${ffmpeg}`;
const broken = [licence, version].find((run) => run.status !== 0);
if (broken) {
  const why = broken.error?.message ?? broken.signal ?? `exit ${broken.status}`;
  fail(`${unread}: ${why}`, 1);
}
if (!licence.stdout.trim()) fail(`${unread}: -L printed nothing`, 1);

console.log(`ffmpeg: ${ffmpeg}`);
console.log(said.match(/^\s*configuration:.*$/m)?.[0].trim() ?? 'configuration: not reported');
console.log(licence.stdout.trim());
