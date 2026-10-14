import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  assertOwnedGatewayContainer, connectGateway, createGatewaySpec, extractGatewayRuntime, gatewayHelperIdentity,
} from '../connect-ai.mjs';

const fixtureNow = Date.parse('2026-10-14T12:00:00Z');
const fixtureExpiry = '2026-10-14T13:00:00Z';
const fixtureOutput = `AI Gateway development key minted (expires ${fixtureExpiry})`;
const fixtureId = '123456789abc';

function fixtureContainer(identity) {
  return {
    Config: {
      Env: ['ASTRO_GATEWAY_URL=https://aig.test', 'ASTRO_GATEWAY_API_KEY=dummy-test-key', 'MODEL_DEFAULT=claude-haiku-4-5'],
      Labels: {
        'com.docker.compose.project': identity.projectName,
        'com.docker.compose.service': 'agent',
        'com.docker.compose.project.working_dir': identity.workingDirectory,
        'com.docker.compose.oneoff': 'False',
      },
    },
    HostConfig: { PortBindings: {}, NetworkMode: `${identity.projectName}-network` },
    NetworkSettings: { Ports: {} },
    State: { Running: true },
  };
}

async function createProjectFixture(context) {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), 'agree-first-ai-'));
  context.after(() => rm(fixtureDirectory, { recursive: true, force: true }));
  const templateDirectory = join(fixtureDirectory, 'scripts', 'astropods-gateway');
  await mkdir(join(templateDirectory, 'agent'), { recursive: true });
  await writeFile(join(templateDirectory, 'Dockerfile'), 'FROM node:22.23.3-alpine\n');
  await writeFile(join(templateDirectory, '.dockerignore'), '*\n');
  await writeFile(join(templateDirectory, 'agent', 'keepalive.mjs'), 'setInterval(() => {}, 60_000);\n');
  return fixtureDirectory;
}

function createFakeRunner(identity, options = {}) {
  const commands = [];
  let started = false;
  let stopped = false;
  const container = options.container ?? fixtureContainer(identity);
  return {
    commands,
    get stopped() { return stopped; },
    run: async (executable, args) => {
      commands.push([executable, ...args]);
      if (args[0] === 'info') {
        if (options.noDocker) throw new Error('dummy secret in Docker failure');
        return '29.4.0';
      }
      if (args[0] === 'whoami') {
        if (options.noLogin) throw new Error('dummy secret in auth failure');
        return 'Authenticated';
      }
      if (args[0] === 'ps') return (started && !stopped) || options.existing ? fixtureId : '';
      if (args[0] === 'inspect') return JSON.stringify([container]);
      if (args[0] === 'spec') return 'Spec valid';
      if (args[1] === 'start') {
        started = true;
        if (options.startFailure) throw new Error('Astropods API failed: dummy secret in CLI failure');
        return fixtureOutput;
      }
      if (args[1] === 'stop') {
        stopped = true;
        if (options.stopFailure) throw new Error('dummy secret in stop failure');
        return 'Stopped';
      }
      throw new Error('Unexpected test command');
    },
  };
}

test('helper name is stable for the same project and differs between projects', () => {
  assert.equal(gatewayHelperIdentity('C:/project').projectName, gatewayHelperIdentity('C:/project').projectName);
  assert.notEqual(gatewayHelperIdentity('C:/project').projectName, gatewayHelperIdentity('C:/other').projectName);
});

test('helper spec disables both interfaces and only requests the documented cheap model', () => {
  const spec = createGatewaySpec(gatewayHelperIdentity('C:/project').projectName);
  assert.match(spec, /frontend: false\n    messaging: false/);
  assert.match(spec, /provider: gateway\n    models: \[claude-haiku-4-5\]/);
  assert.doesNotMatch(spec, /port:|adapters:|runtime:/);
  assert.throws(() => createGatewaySpec('another-project'), /helper name is invalid/);
});

test('runtime credentials use only the owned helper and parse the provider expiry', () => {
  const identity = gatewayHelperIdentity('C:/project');
  const runtime = extractGatewayRuntime(fixtureContainer(identity), fixtureOutput, identity, fixtureNow);
  assert.equal(runtime.baseUrl, 'https://aig.test');
  assert.equal(runtime.apiKey, 'dummy-test-key');
  assert.equal(runtime.expiresAt, fixtureExpiry.replace('Z', '.000Z'));
  assert.equal(runtime.model, 'claude-haiku-4-5');
});

for (const label of ['com.docker.compose.project', 'com.docker.compose.service',
  'com.docker.compose.project.working_dir', 'com.docker.compose.oneoff']) {
  test(`rejects a helper with an incorrect ${label} label`, () => {
    const identity = gatewayHelperIdentity('C:/project');
    const container = fixtureContainer(identity);
    container.Config.Labels[label] = 'foreign-value';
    assert.throws(() => assertOwnedGatewayContainer(container, identity), /belongs to another project/);
  });
}

for (const setting of ['binding', 'published', 'host']) {
  test(`rejects a helper exposing a ${setting} port`, () => {
    const identity = gatewayHelperIdentity('C:/project');
    const container = fixtureContainer(identity);
    if (setting === 'binding') container.HostConfig.PortBindings = { '80/tcp': [{ HostPort: '3200' }] };
    if (setting === 'published') container.NetworkSettings.Ports = { '80/tcp': [{ HostPort: '3200' }] };
    if (setting === 'host') container.HostConfig.NetworkMode = 'host';
    assert.throws(() => extractGatewayRuntime(container, fixtureOutput, identity, fixtureNow), /exposes a network port/);
  });
}

for (const setting of ['missing-key', 'wrong-model', 'expired', 'missing-expiry', 'http', 'path', 'duplicate', 'stopped']) {
  test(`rejects unusable runtime credentials: ${setting}`, () => {
    const identity = gatewayHelperIdentity('C:/project');
    const container = fixtureContainer(identity);
    let output = fixtureOutput;
    if (setting === 'missing-key') container.Config.Env[1] = 'ASTRO_GATEWAY_API_KEY=';
    if (setting === 'wrong-model') container.Config.Env[2] = 'MODEL_DEFAULT=not-a-model';
    if (setting === 'expired') output = 'AI Gateway development key minted (expires 2026-10-14T11:00:00Z)';
    if (setting === 'missing-expiry') output = 'No expiry information';
    if (setting === 'http') container.Config.Env[0] = 'ASTRO_GATEWAY_URL=http://aig.test';
    if (setting === 'path') container.Config.Env[0] = 'ASTRO_GATEWAY_URL=https://aig.test/some-path';
    if (setting === 'duplicate') container.Config.Env.push('ASTRO_GATEWAY_API_KEY=another-dummy');
    if (setting === 'stopped') container.State.Running = false;
    assert.throws(() => extractGatewayRuntime(container, output, identity, fixtureNow));
  });
}

test('connect copies dummy credentials only after stopping the owned helper', async (context) => {
  const projectDirectory = await createProjectFixture(context);
  const identity = gatewayHelperIdentity(projectDirectory);
  const runner = createFakeRunner(identity);
  const result = await connectGateway(projectDirectory, { run: runner.run, now: () => fixtureNow });
  assert.equal(runner.stopped, true);
  const runtime = JSON.parse(await readFile(join(projectDirectory, '.tools', 'astropods', 'gateway-runtime.json'), 'utf8'));
  assert.equal(runtime.apiKey, 'dummy-test-key');
  assert.deepEqual(Object.keys(result).sort(), ['expiresAt', 'model']);
  assert.ok(runner.commands.some((command) => command.includes('no-secrets.conf')));
  assert.equal(await readFile(join(identity.workingDirectory, 'no-secrets.conf'), 'utf8'), '');
});

test('connect never starts or stops a helper owned by another directory', async (context) => {
  const projectDirectory = await createProjectFixture(context);
  const identity = gatewayHelperIdentity(projectDirectory);
  const container = fixtureContainer(identity);
  container.Config.Labels['com.docker.compose.project.working_dir'] = 'C:/foreign';
  const runner = createFakeRunner(identity, { existing: true, container });
  await assert.rejects(connectGateway(projectDirectory, { run: runner.run }), /belongs to another project/);
  assert.equal(runner.commands.some((command) => command.includes('start') || command.includes('stop')), false);
});

test('connect cleans up and reports a safe error after a CLI failure', async (context) => {
  const projectDirectory = await createProjectFixture(context);
  const runner = createFakeRunner(gatewayHelperIdentity(projectDirectory), { startFailure: true });
  await assert.rejects(connectGateway(projectDirectory, { run: runner.run }), (error) => {
    assert.doesNotMatch(error.message, /dummy secret/);
    return /AI connection failed/.test(error.message);
  });
  assert.equal(runner.stopped, true);
  await assert.rejects(readFile(join(projectDirectory, '.tools', 'astropods', 'gateway-runtime.json')), { code: 'ENOENT' });
});

test('connect keeps credentials unsaved when helper cleanup fails', async (context) => {
  const projectDirectory = await createProjectFixture(context);
  const runner = createFakeRunner(gatewayHelperIdentity(projectDirectory), { stopFailure: true });
  await assert.rejects(connectGateway(projectDirectory, { run: runner.run, now: () => fixtureNow }), /could not be stopped/);
  await assert.rejects(readFile(join(projectDirectory, '.tools', 'astropods', 'gateway-runtime.json')), { code: 'ENOENT' });
});

for (const setting of ['noDocker', 'noLogin']) {
  test(`connect explains ${setting} without leaking raw CLI errors`, async (context) => {
    const projectDirectory = await createProjectFixture(context);
    const runner = createFakeRunner(gatewayHelperIdentity(projectDirectory), { [setting]: true });
    await assert.rejects(connectGateway(projectDirectory, { run: runner.run }), (error) => {
      assert.doesNotMatch(error.message, /dummy secret/);
      return true;
    });
    assert.equal(runner.commands.some((command) => command.includes('start')), false);
  });
}

test('the real helper template contains no listener or secret output', async () => {
  const templateDirectory = dirname(fileURLToPath(import.meta.url));
  const helper = await readFile(join(templateDirectory, 'agent', 'keepalive.mjs'), 'utf8');
  const dockerfile = await readFile(join(templateDirectory, 'Dockerfile'), 'utf8');
  assert.doesNotMatch(helper, /listen\(|console\.|process\.env/);
  assert.doesNotMatch(dockerfile, /EXPOSE|ENV /);
  assert.match(dockerfile, /USER node/);
});

