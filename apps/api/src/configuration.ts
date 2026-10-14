import { loadEnvFile } from 'node:process';
import { join } from 'node:path';

export interface RuntimeConfiguration {
  port: number;
  databasePath: string;
}

export function loadWorkspaceEnvironment(root: string, environmentFilePath = join(root, '.env')): void {
  try {
    loadEnvFile(environmentFilePath);
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return;
    }
    throw new Error('The local environment file could not be loaded. Check its permissions.');
  }
}

export function readRuntimeConfiguration(root: string, environment: NodeJS.ProcessEnv = process.env): RuntimeConfiguration {
  const port = Number(environment.PORT?.trim() || '3001');
  if (!Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('Choose a PORT from 1024 to 65535.');
  }
  return {
    port,
    databasePath: environment.AGREE_FIRST_DATABASE_PATH?.trim() || join(root, 'work/agree-first.sqlite'),
  };
}
