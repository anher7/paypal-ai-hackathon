import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createApp } from './app.js';
import { createWorkspaceAiDraftProvider } from './ai-configuration.js';
import { createStore } from './store.js';
import { loadWorkspaceEnvironment, readRuntimeConfiguration } from './configuration.js';

function workspaceDirectory(start: string): string {
  let candidate = resolve(start);
  while (!existsSync(join(candidate, 'packages/shared/package.json'))) {
    const parent = dirname(candidate);
    if (parent === candidate) {
      throw new Error('Start the API from the Agree First workspace.');
    }
    candidate = parent;
  }
  return candidate;
}

const root = workspaceDirectory(process.cwd());
loadWorkspaceEnvironment(root);
const { port, databasePath } = readRuntimeConfiguration(root);
const store = createStore(databasePath);
const app = createApp({
  store, drafting: createWorkspaceAiDraftProvider(root),
  allowedPorts: [...new Set([port, 4200])],
  frontendDirectory: join(root, 'apps/web/dist/agree-first/browser'),
});
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Agree First is running at http://127.0.0.1:${port}`);
});
server.on('error', () => {
  console.error('The local API could not start. Check whether its port is already in use.');
  store.close();
  process.exitCode = 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => server.close(() => {
    store.close();
    process.exit(0);
  }));
}
