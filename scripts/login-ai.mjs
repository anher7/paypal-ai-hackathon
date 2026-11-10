import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupAstropodsCli } from './setup-ai.mjs';
try {
  const cli = await setupAstropodsCli(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
  const child = spawn(cli, ['login', '--no-browser'], { stdio: 'inherit' });
  child.on('error', () => { console.error('Astropods sign-in could not start.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch (error) { console.error(error.message); process.exitCode = 1; }
