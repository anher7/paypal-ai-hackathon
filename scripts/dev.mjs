import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const bundledNpm = resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
const npmCli = existsSync(bundledNpm) ? bundledNpm : process.env.npm_execpath;
if (!npmCli) {
  throw new Error('Start development with npm run dev or scripts/run.ps1.');
}
const children = ['@agree-first/api', '@agree-first/web'].map((workspace) => spawn(
  process.execPath, [npmCli, 'run', 'dev', '-w', workspace],
  { cwd: process.cwd(), stdio: 'inherit', env: process.env },
));

let stopping = false;
function stopChildren(exitCode = 0) {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of children) {
    if (!child.pid || child.exitCode !== null) {
      continue;
    }
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    } else {
      child.kill('SIGTERM');
    }
  }
  setTimeout(() => process.exit(exitCode), 500);
}
for (const child of children) {
  child.on('error', (error) => {
    console.error(error.message);
    stopChildren(1);
  });
  child.on('exit', (code) => stopChildren(code ?? 0));
}
process.on('SIGINT', () => stopChildren());
process.on('SIGTERM', () => stopChildren());
console.log('Agree First: http://127.0.0.1:4200 (API: http://127.0.0.1:3001)');

