import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { DraftProvider } from '@agree-first/shared';
import { createAiDraftProvider, type AiProviderOptions } from './ai.js';

const gatewayRuntimeSchema = z.object({
  baseUrl: z.string().min(1).max(2000),
  apiKey: z.string().min(1).max(10000),
  expiresAt: z.iso.datetime().optional(),
  model: z.string().trim().min(1).max(120).optional(),
});

export function readGatewayEnvironment(root: string, environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  if (environment.AGREE_FIRST_AI_MODE === 'examples' ||
    environment.ASTRO_GATEWAY_URL?.trim() || environment.ASTRO_GATEWAY_API_KEY?.trim()) return environment;
  try {
    const text = readFileSync(join(root, '.tools/astropods/gateway-runtime.json'), 'utf8');
    if (text.length > 16000) return { ...environment, ASTRO_GATEWAY_URL: 'invalid' };
    const parsed = gatewayRuntimeSchema.safeParse(JSON.parse(text));
    if (!parsed.success) return { ...environment, ASTRO_GATEWAY_URL: 'invalid' };
    return {
      ...environment, ASTRO_GATEWAY_URL: parsed.data.baseUrl,
      ASTRO_GATEWAY_API_KEY: parsed.data.apiKey, ASTRO_GATEWAY_EXPIRES_AT: parsed.data.expiresAt,
      MODEL_DEFAULT: environment.MODEL_DEFAULT?.trim() || parsed.data.model || 'claude-haiku-4-5',
    };
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return environment;
    return { ...environment, ASTRO_GATEWAY_URL: 'invalid' };
  }
}

export function createWorkspaceAiDraftProvider(
  root: string,
  environment: NodeJS.ProcessEnv = process.env,
  options: AiProviderOptions = {},
): DraftProvider {
  // Reconnects refresh private runtime settings without restarting the local API.
  const currentProvider = () => createAiDraftProvider(readGatewayEnvironment(root, environment), options);
  return {
    get mode() { return currentProvider().mode; },
    get configured() { return currentProvider().configured; },
    get model() { return currentProvider().model; },
    draft: (request) => currentProvider().draft(request),
    estimate: (context) => currentProvider().estimate!(context),
  };
}