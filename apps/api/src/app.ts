import express, { type ErrorRequestHandler, type Request } from 'express';
import { z } from 'zod';
import {
  currency, quoteCreateSchema, quoteUpdateSchema, revisionSchema, checkoutSchema,
  type AppConfig,
} from '@agree-first/shared';
import { AppError } from './errors.js';
import { examples, exampleDraftProvider } from './drafting.js';
import { createQuoteService } from './service.js';
import type { QuoteStore } from './store.js';
import { createPaypalProvider, type PaymentProvider } from './paypal.js';
import type { DraftProvider } from '@agree-first/shared';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface AppOptions {
  store: QuoteStore;
  payments?: PaymentProvider;
  drafting?: DraftProvider;
  frontendDirectory?: string;
  allowedPorts?: number[];
}

function loopbackUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname) &&
      !parsed.username && !parsed.password ? parsed : null;
  } catch {
    return null;
  }
}

function localRequest(request: Request, allowedPorts: number[]): boolean {
  const host = loopbackUrl(`http://${request.headers.host ?? ''}`);
  if (!host || !allowedPorts.includes(Number(host.port || '80'))) {
    return false;
  }
  const origin = request.headers.origin;
  if (origin) {
    const parsed = loopbackUrl(origin);
    if (!parsed || parsed.protocol !== 'http:' || !allowedPorts.includes(Number(parsed.port || '80'))) {
      return false;
    }
  }
  return request.headers['sec-fetch-site'] !== 'cross-site';
}

function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new AppError('INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Check the information and try again.');
  }
  return parsed.data;
}

export function createApp(options: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  const payments = options.payments ?? createPaypalProvider();
  const drafting = options.drafting ?? exampleDraftProvider;
  const service = createQuoteService(options.store, drafting, payments);
  const allowedPorts = options.allowedPorts ?? [3001, 4200];

  app.use((_request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use('/api', (request, _response, next) => {
    if (!localRequest(request, allowedPorts)) {
      next(new AppError('LOCAL_REQUEST_ONLY', 'Open Agree First on this computer to continue.', 403));
      return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method) && !request.is('application/json')) {
      next(new AppError('JSON_REQUIRED', 'Send this request as JSON.', 415));
      return;
    }
    next();
  });
  app.use(express.json({ limit: '64kb' }));

  app.get('/api/config', (_request, response) => {
    const config: AppConfig = {
      currency, paypalConfigured: payments.configured, paypalClientId: payments.clientId,
      aiMode: drafting.mode ?? 'examples', aiConfigured: drafting.configured ?? false,
      aiModel: drafting.model ?? null, localOnly: true,
    };
    response.json(config);
  });
  app.get('/api/examples', (_request, response) => response.json(examples));
  app.get('/api/quotes', (_request, response) => response.json(service.list()));
  app.get('/api/quotes/:id/checkout-recovery', (request, response) => response.json(service.recovery(request.params.id)));
  app.get('/api/quotes/:id', (request, response) => response.json(service.get(request.params.id)));
  app.post('/api/quotes', (request, response) => {
    response.status(201).json(service.create(input(quoteCreateSchema, request.body)));
  });
  app.put('/api/quotes/:id', async (request, response) => {
    response.json(await service.update(request.params.id, input(quoteUpdateSchema, request.body)));
  });
  app.post('/api/quotes/:id/draft', async (request, response) => {
    const { expectedRevision } = input(revisionSchema, request.body);
    response.json(await service.draft(request.params.id, expectedRevision));
  });
  app.post('/api/quotes/:id/estimate', async (request, response) => {
    const { expectedRevision } = input(revisionSchema, request.body);
    response.json(await service.estimate(request.params.id, expectedRevision));
  });
  app.post('/api/quotes/:id/approve', async (request, response) => {
    const { expectedRevision } = input(revisionSchema, request.body);
    response.json(await service.approve(request.params.id, expectedRevision));
  });
  app.post('/api/quotes/:id/orders', async (request, response) => {
    const { approvedRevision } = input(checkoutSchema, request.body);
    response.json(await service.createOrder(request.params.id, approvedRevision));
  });
  app.post('/api/quotes/:id/orders/:orderId/capture', async (request, response) => {
    const { approvedRevision } = input(checkoutSchema, request.body);
    response.json(await service.capture(request.params.id, request.params.orderId, approvedRevision));
  });
  app.use('/api', (_request, _response, next) => next(new AppError('NOT_FOUND', 'This action could not be found.', 404)));

  if (options.frontendDirectory && existsSync(join(options.frontendDirectory, 'index.html'))) {
    app.use(express.static(options.frontendDirectory));
    app.get('/{*path}', (_request, response) => response.sendFile(join(options.frontendDirectory!, 'index.html')));
  }

  const handleError: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof AppError) {
      response.status(error.status).json({ error: { code: error.code, message: error.message } });
      return;
    }
    if (error instanceof SyntaxError && 'body' in error) {
      response.status(400).json({ error: { code: 'INVALID_JSON', message: 'Check the JSON request and try again.' } });
      return;
    }
    if (typeof error === 'object' && error !== null && 'type' in error && error.type === 'entity.too.large') {
      response.status(413).json({ error: { code: 'REQUEST_TOO_LARGE', message: 'This request is too long. Shorten it and try again.' } });
      return;
    }
    console.error('An unexpected API error occurred.');
    response.status(500).json({ error: { code: 'SERVER_ERROR', message: 'This action could not be completed. Try again.' } });
  };
  app.use(handleError);
  return app;
}
