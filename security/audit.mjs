import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function auditPasses(report, exitCode) {
  const counts = report?.metadata?.vulnerabilities;
  const levels = ['info', 'low', 'moderate', 'high', 'critical'];
  if (!counts || levels.some(level => !Number.isSafeInteger(counts[level]) || counts[level] < 0)) return false;
  if (counts.high > 0 || counts.critical > 0) return false;
  // npm exits nonzero for errors or advisories at the requested threshold.
  return exitCode === 0;
}

export function auditLockfiles(root, npm = 'npm') {
  for (const directory of [root, fileURLToPath(new URL('../distribution/companion/', import.meta.url))]) {
    const result = spawnSync(npm, ['audit', '--package-lock-only', '--audit-level=high', '--json', '--ignore-scripts'], {
      cwd: directory, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024,
    });
    let report;
    try { report = JSON.parse(result.stdout); } catch { throw new Error('npm audit returned invalid output or could not reach its registry'); }
    if (!auditPasses(report, result.status)) throw new Error('npm audit failed or reported high/critical vulnerabilities for ' + (directory === root ? 'root' : 'companion'));
    console.log('npm audit passed: ' + (directory === root ? 'root' : 'companion'));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  auditLockfiles(fileURLToPath(new URL('../', import.meta.url)));
}
