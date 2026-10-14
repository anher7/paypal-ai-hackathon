import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const executeFile = promisify(execFile);
export const gatewayModel = 'claude-haiku-4-5';
export class GatewayConnectionError extends Error {}
const projectLabel = 'com.docker.compose.project';
const serviceLabel = 'com.docker.compose.service';
const workingDirectoryLabel = 'com.docker.compose.project.working_dir';
const oneoffLabel = 'com.docker.compose.oneoff';

function normalizeDirectory(directory) {
  return resolve(directory).replaceAll('\\', '/').toLowerCase();
}

export function gatewayHelperIdentity(projectDirectory) {
  const directoryHash = createHash('sha256').update(normalizeDirectory(projectDirectory)).digest('hex').slice(0, 12);
  return {
    projectName: `agree-first-ai-${directoryHash}`,
    workingDirectory: join(resolve(projectDirectory), 'work', 'astropods-gateway'),
  };
}

export function createGatewaySpec(projectName) {
  if (!/^agree-first-ai-[a-f0-9]{12}$/.test(projectName)) throw new GatewayConnectionError('The local AI helper name is invalid.');
  return `spec: blueprint/v1
name: ${projectName}
agent:
  build:
    context: .
    dockerfile: Dockerfile
  interfaces:
    frontend: false
    messaging: false
models:
  default:
    provider: gateway
    models: [${gatewayModel}]
dev:
  watch: [agent]
`;
}

export function assertOwnedGatewayContainer(container, identity) {
  const labels = container?.Config?.Labels ?? {};
  if (labels[projectLabel] !== identity.projectName || labels[serviceLabel] !== 'agent'
    || labels[oneoffLabel] !== 'False'
    || normalizeDirectory(labels[workingDirectoryLabel] ?? '') !== normalizeDirectory(identity.workingDirectory)) {
    throw new GatewayConnectionError('The AI helper container belongs to another project. No credentials were copied.');
  }
  const bindings = Object.values(container?.HostConfig?.PortBindings ?? {});
  const publishedPorts = Object.values(container?.NetworkSettings?.Ports ?? {});
  if (bindings.some((entries) => entries?.length) || publishedPorts.some((entries) => entries?.length)
    || container?.HostConfig?.NetworkMode === 'host') {
    throw new GatewayConnectionError('The AI helper unexpectedly exposes a network port. No credentials were copied.');
  }
}

export function extractGatewayRuntime(container, cliOutput, identity, now = Date.now()) {
  assertOwnedGatewayContainer(container, identity);
  if (!container.State?.Running) throw new GatewayConnectionError('The local AI helper did not start.');
  const environment = new Map();
  for (const entry of container.Config.Env ?? []) {
    const separator = entry.indexOf('=');
    if (separator > 0) {
      const name = entry.slice(0, separator);
      if (environment.has(name)) throw new GatewayConnectionError('The AI helper contains duplicate settings.');
      environment.set(name, entry.slice(separator + 1));
    }
  }
  const baseUrl = environment.get('ASTRO_GATEWAY_URL')?.trim();
  const apiKey = environment.get('ASTRO_GATEWAY_API_KEY')?.trim();
  const model = environment.get('MODEL_DEFAULT')?.trim();
  const expiresAt = cliOutput.replace(/\u001b\[[0-9;]*m/g, '').match(/AI Gateway development key minted \(expires ([^)]+)\)/)?.[1];
  const expiryTime = Date.parse(expiresAt ?? '');
  let gatewayUrl;
  try { gatewayUrl = new URL(baseUrl); } catch { throw new GatewayConnectionError('Astropods did not supply a valid gateway address.'); }
  if (gatewayUrl.protocol !== 'https:' || gatewayUrl.username || gatewayUrl.password
    || gatewayUrl.search || gatewayUrl.hash || gatewayUrl.pathname !== '/'
    || (gatewayUrl.port && gatewayUrl.port !== '443')) {
    throw new GatewayConnectionError('Astropods did not supply a secure gateway host.');
  }
  if (!apiKey || model !== gatewayModel || !Number.isFinite(expiryTime) || expiryTime <= now + 60_000) {
    throw new GatewayConnectionError('Astropods did not supply a usable gateway credential. Connect AI again.');
  }
  return { baseUrl: gatewayUrl.origin, apiKey, expiresAt: new Date(expiryTime).toISOString(), model };
}

export async function connectGateway(projectDirectory, options = {}) {
  const identity = gatewayHelperIdentity(projectDirectory);
  const cliExecutable = join(projectDirectory, '.tools', 'ast-0.29.0', 'ast.exe');
  const run = options.run ?? (async (executable, args, timeout = 30_000) => {
    const result = await executeFile(executable, args, {
      cwd: identity.workingDirectory, windowsHide: true, timeout, maxBuffer: 5 * 1024 * 1024,
    });
    return result.stdout + result.stderr;
  });
  const templatesDirectory = join(projectDirectory, 'scripts', 'astropods-gateway');
  await mkdir(join(identity.workingDirectory, 'agent'), { recursive: true });
  for (const file of ['Dockerfile', '.dockerignore', 'agent/keepalive.mjs']) {
    await copyFile(join(templatesDirectory, file), join(identity.workingDirectory, file));
  }
  await writeFile(join(identity.workingDirectory, 'astropods.yml'), createGatewaySpec(identity.projectName));
  await writeFile(join(identity.workingDirectory, 'no-secrets.conf'), '');
  try { await run('docker', ['info', '--format', '{{.ServerVersion}}']); }
  catch { throw new GatewayConnectionError('Start Docker Desktop, then run .\\scripts\\connect-ai.ps1 again.'); }
  try { await run(cliExecutable, ['whoami']); }
  catch { throw new GatewayConnectionError('Sign in with .\\scripts\\connect-ai.ps1 -Login, then finish the code shown in your browser.'); }

  const listHelperIds = async () => {
    const output = await run('docker', ['ps', '--all', '--filter', `label=${projectLabel}=${identity.projectName}`,
      '--filter', `label=${serviceLabel}=agent`, '--format', '{{.ID}}']);
    const containerIds = output.trim().split(/\s+/).filter(Boolean);
    if (containerIds.some((id) => !/^[a-f0-9]{12,64}$/.test(id))) throw new GatewayConnectionError('The local AI helper could not be identified.');
    return containerIds;
  };
  const inspectOwned = async (containerIds) => {
    const output = await run('docker', ['inspect', ...containerIds]);
    const containers = JSON.parse(output);
    if (!Array.isArray(containers) || containers.length !== containerIds.length) {
      throw new GatewayConnectionError('The local AI helper could not be inspected.');
    }
    containers.forEach((container) => assertOwnedGatewayContainer(container, identity));
    return containers;
  };
  const existingIds = await listHelperIds();
  if (existingIds.length) await inspectOwned(existingIds);
  let startAttempted = false;
  let failure;
  let runtime;
  try {
    await run(cliExecutable, ['spec', 'validate']);
    startAttempted = true;
    const startOutput = await run(cliExecutable, ['project', 'start', '--background',
      '--env-file', 'no-secrets.conf'], 180_000);
    const containerIds = await listHelperIds();
    if (containerIds.length !== 1) throw new GatewayConnectionError('Astropods did not create exactly one local AI helper.');
    const [container] = await inspectOwned(containerIds);
    runtime = extractGatewayRuntime(container, startOutput, identity, options.now?.() ?? Date.now());
  } catch (error) {
    failure = error instanceof GatewayConnectionError ? error
      : new GatewayConnectionError('AI connection failed. Check Docker Desktop and your Astropods sign-in, then try again.');
  } finally {
    if (startAttempted) {
      try {
        const containerIds = await listHelperIds();
        if (containerIds.length) {
          await inspectOwned(containerIds);
          await run(cliExecutable, ['project', 'stop']);
        }
      } catch {
        failure = new GatewayConnectionError('The local AI helper could not be stopped. Open Docker Desktop and stop this project’s AI helper before reconnecting.');
      }
    }
  }
  if (failure) throw failure;
  const runtimeDirectory = join(projectDirectory, '.tools', 'astropods');
  await mkdir(runtimeDirectory, { recursive: true });
  const pendingFile = join(runtimeDirectory, `gateway-runtime-${process.pid}.json.tmp`);
  await writeFile(pendingFile, JSON.stringify(runtime), { mode: 0o600 });
  await rename(pendingFile, join(runtimeDirectory, 'gateway-runtime.json'));
  return { expiresAt: runtime.expiresAt, model: runtime.model };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  try {
    await connectGateway(projectDirectory);
    console.log('AI is connected. Refresh the app to use live drafting. Reconnect with .\\scripts\\connect-ai.ps1 when the development key expires.');
  } catch (error) {
    console.error(error instanceof GatewayConnectionError ? error.message : 'AI connection failed. Check Docker Desktop and your Astropods sign-in, then try again.');
    process.exitCode = 1;
  }
}




