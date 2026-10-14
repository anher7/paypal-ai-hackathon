import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadWorkspaceEnvironment, readRuntimeConfiguration } from './configuration.js';
import { createPaypalProvider } from './paypal.js';

const configurationKeys = ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'AGREE_FIRST_DATABASE_PATH', 'PORT'] as const;
let originalEnvironment: Partial<Record<typeof configurationKeys[number], string>>;
let fixtureDirectory: string;

beforeEach(() => {
  originalEnvironment = {};
  for (const key of configurationKeys) {
    originalEnvironment[key] = process.env[key];
    delete process.env[key];
  }
  fixtureDirectory = mkdtempSync(join(tmpdir(), 'agree-first-configuration-'));
});

afterEach(() => {
  for (const key of configurationKeys) {
    const originalValue = originalEnvironment[key];
    if (originalValue === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = originalValue;
    }
  }
  rmSync(fixtureDirectory, { recursive: true, force: true });
  vi.restoreAllMocks();
});

function loadFixture(contents: string): void {
  const fixturePath = join(fixtureDirectory, 'dummy-settings.conf');
  writeFileSync(fixturePath, contents);
  loadWorkspaceEnvironment(fixtureDirectory, fixturePath);
}

describe('backend startup configuration', () => {
  it('loads two required sandbox settings from an explicit dummy configuration file', () => {
    loadFixture('PAYPAL_CLIENT_ID=fake-client\nPAYPAL_CLIENT_SECRET=fake-secret\n');
    const provider = createPaypalProvider();
    expect(provider.configured).toBe(true);
    expect(provider.clientId).toBe('fake-client');
    expect(provider.merchantId).toBeUndefined();
    expect(readRuntimeConfiguration(fixtureDirectory)).toEqual({
      port: 3001, databasePath: join(fixtureDirectory, 'work/agree-first.sqlite'),
    });
  });
  it.each([
    'PAYPAL_CLIENT_ID=fake-client\n',
    'PAYPAL_CLIENT_SECRET=fake-secret\n',
    'PAYPAL_CLIENT_ID=\nPAYPAL_CLIENT_SECRET=fake-secret\n',
  ])('requires both nonempty PayPal settings', (contents) => {
    loadFixture(contents);
    expect(createPaypalProvider().configured).toBe(false);
    expect(createPaypalProvider().clientId).toBeNull();
  });
  it('keeps defaults when optional settings are blank', () => {
    loadFixture('PAYPAL_CLIENT_ID=fake-client\nPAYPAL_CLIENT_SECRET=fake-secret\nPAYPAL_MERCHANT_ID=\nAGREE_FIRST_DATABASE_PATH=\nPORT=\n');
    const configuration = readRuntimeConfiguration(fixtureDirectory);
    expect(configuration.port).toBe(3001);
    expect(configuration.databasePath).toBe(join(fixtureDirectory, 'work/agree-first.sqlite'));
    expect(createPaypalProvider().configured).toBe(true);
    expect(createPaypalProvider().merchantId).toBeUndefined();
  });
  it('keeps defaults when optional settings contain only whitespace', () => {
    expect(readRuntimeConfiguration(fixtureDirectory, { PORT: '   ', AGREE_FIRST_DATABASE_PATH: '  ' })).toEqual({
      port: 3001, databasePath: join(fixtureDirectory, 'work/agree-first.sqlite'),
    });
  });
  it('keeps existing process environment values ahead of file settings', () => {
    process.env.PAYPAL_CLIENT_ID = 'existing-client';
    process.env.PAYPAL_CLIENT_SECRET = 'existing-secret';
    process.env.PORT = '3010';
    loadFixture('PAYPAL_CLIENT_ID=file-client\nPAYPAL_CLIENT_SECRET=file-secret\nPORT=3020\n');
    expect(createPaypalProvider().clientId).toBe('existing-client');
    expect(process.env.PAYPAL_CLIENT_SECRET).toBe('existing-secret');
    expect(readRuntimeConfiguration(fixtureDirectory).port).toBe(3010);
  });
  it('allows a missing optional file without reading the real workspace file', () => {
    expect(() => loadWorkspaceEnvironment(fixtureDirectory, join(fixtureDirectory, 'missing-settings.conf'))).not.toThrow();
    expect(createPaypalProvider().configured).toBe(false);
    expect(readRuntimeConfiguration(fixtureDirectory).port).toBe(3001);
  });
  it('uses configured database and port values', () => {
    const databasePath = join(fixtureDirectory, 'custom.sqlite');
    process.env.AGREE_FIRST_DATABASE_PATH = ` ${databasePath} `;
    process.env.PORT = ' 3012 ';
    expect(readRuntimeConfiguration(fixtureDirectory)).toEqual({ port: 3012, databasePath });
  });
  it.each(['not-a-port', '0', '1023', '65536', '3001.5'])('reports invalid PORT %s without echoing its value', (port) => {
    expect(() => readRuntimeConfiguration(fixtureDirectory, { PORT: port })).toThrow('Choose a PORT from 1024 to 65535.');
  });
  it('never logs configuration values or returns secrets in runtime configuration', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    loadFixture('PAYPAL_CLIENT_ID=fake-client\nPAYPAL_CLIENT_SECRET=fake-secret\n');
    const configuration = readRuntimeConfiguration(fixtureDirectory);
    createPaypalProvider();
    expect(JSON.stringify(configuration)).not.toContain('fake-secret');
    expect(configuration).not.toHaveProperty('paypalClientSecret');
    expect(log).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
