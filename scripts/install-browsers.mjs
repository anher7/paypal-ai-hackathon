import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const result = spawnSync(process.execPath, [resolve('node_modules/@playwright/test/cli.js'), 'install', 'chromium', ...process.argv.slice(2)], {
  stdio: 'inherit', env: process.env,
});
if (result.error) console.error('Browser installation could not start. Run npm ci first.');
process.exitCode = result.status ?? 1;
