// Scriptable release helper
//
// Check git status (must be clean and tagged).
// Build Scriptable tool in release mode.
// Check build file for same git description, production mode, and newline frequency (minification proxy).

import { promisify } from 'node:util';
import { exec as execCb, spawn } from 'node:child_process';
const exec = promisify(execCb);

import { open, stat } from 'node:fs/promises';
import process from 'node:process';
import { version } from 'utils';

const checks = {
  failed: false,
  assert(bool, message) {
    if (!bool)
      console.error('error:', message);
    this.failed ||= !bool;
  }
};

console.log('Getting Git description of HEAD...');
const description = await exec('git describe --long --dirty')
  .then(e => e.stdout.trim(), () => '(unable to run "git describe")');
const git = (description => {
  const m = description.match(/(.*)-(\d+)-g([0-9a-f]+)(?:-(.*))?/);
  if (!m) return m;
  const [, ref, additional, hash, trailer] = m;
  return { ref, additional, hash, trailer };
})(description);

checks.assert(git, 'no git description?');
checks.assert(git.ref == 'v' + version, `git ref ${git.ref} != v${version} internal version`);
checks.assert(git.additional == '0', 'non-zero commits atop ref');
checks.assert(!git.trailer, 'git description has trailer: ' + git.trailer);

const releasedDir = '../../released';

const exists = (pn, t = () => true) => stat(pn).then(s => t(s), () => false);

{
  const releasedGit = releasedDir + '/.git';
  if (! await exists(releasedGit))
    console.warn(`warning: ${JSON.stringify(releasedDir)} does not appear to be a Git worktree or repository`);
}

const releasedFile = `${releasedDir}/Scriptable/ISBN Tool.js`;

if (!checks.failed) {
  console.log(`Building ${JSON.stringify(releasedFile)}...`);
  await new Promise((resolve, reject) => {
    const cp = spawn('yarn.cmd',
      ['workspace', 'scriptable', 'run', '-T', 'rollup', '-c', '--configRelease', releasedDir],
      {
        shell: false,
        stdio: ['ignore', 'inherit', 'inherit'],
      });
    cp.on('exit', (code, signal) => {
      if (code == 0) resolve();
      if (code != null) reject(`Rollup exited non-zero: ${code}`);
      if (signal != null) reject(`Rollup died: ${signal}`);
      reject('Rollup failed in unknown way?');
    });
  }).catch(e => checks.assert(false, e));
}

if (!checks.failed) {
  console.log(`Checking ${JSON.stringify(releasedFile)}...`);
  const chunk = await (async pn => {
    const fh = await open(pn, 'r');
    const rr = await fh.read({ length: 1 * 1024 });
    return rr.buffer.toString('utf-8', 0, rr.bytesRead);
  })(releasedFile);

  const newlineCount = [].reduce.call(chunk, (count, char) => count + (char == '\n'), 0);
  const bytesPerLine = chunk.length / newlineCount;
  const bannerMatch = chunk.match(/(\S+) git: (\S+)/);
  const isProduction = bannerMatch[1] == 'production';
  const chunkDescription = bannerMatch[2];

  checks.assert(chunkDescription == description, `released file git description ${chunkDescription} != ${description}`);
  checks.assert(isProduction, 'not production');
  checks.assert(bytesPerLine >= 500, `${Math.round(bytesPerLine)} < 500 bytes per line in tested chunk`);
}

if (!checks.failed)
  console.log('Looks okay to release!');

process.exitCode = checks.failed ? 1 : 0;
