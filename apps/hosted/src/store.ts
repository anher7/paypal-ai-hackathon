import type { Quote } from '@agree-first/shared';
import { AppError } from '../../api/src/errors.js';
import type { PaymentAttempt, QuoteStore } from '../../api/src/store.js';

/** The small D1 surface used here also makes persistence testable without a Worker. */
export interface HostedDatabase {
  prepare(query: string): {
    bind(...values: unknown[]): ReturnType<HostedDatabase['prepare']>;
    first<T = Record<string, unknown>>(): Promise<T | null>;
    all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
    run(): Promise<{ meta: { changes?: number } }>;
  };
}

interface StoredRow {
  id: string;
  payload: string;
  attempts: string;
}

const leaseMilliseconds = 180_000;
const maxPayloadBytes = 512 * 1024;
const maxWorkspaceQuotes = 20;
const copy = <T>(value: T): T => structuredClone(value);
const busy = () => new AppError('QUOTE_BUSY', 'This quote is being updated. Try again in a moment.', 409);
const lostLease = () => new AppError('QUOTE_CHANGED', 'This quote changed. Reload it before continuing.', 409);

/**
 * Adapt the synchronous quote service to D1. One quote and all of its payment
 * attempts are committed in one fenced SQL statement. The caller checkpoints
 * before each external provider call, and closes in finally, including errors.
 * Migrations intentionally happen during deployment, never during requests.
 */
export async function openHostedStore(
  db: HostedDatabase,
  workspaceId: string,
  quoteId?: string,
  mutating = false,
): Promise<{ store: QuoteStore; checkpoint(): Promise<void>; close(): Promise<void> }> {
  let activeId = quoteId;
  const token = crypto.randomUUID();
  let locked = false;
  let closed = false;
  let pendingNewId: string | undefined;
  let quotes = new Map<string, Quote>();
  let attempts = new Map<string, PaymentAttempt>();
  const ensureOpen = () => {
    if (closed) throw new Error('The hosted store is closed.');
  };
  const ensureWritable = () => {
    ensureOpen();
    if (!mutating) throw new AppError('READ_ONLY', 'This request cannot change quotes.', 405);
  };

  if (quoteId && mutating) {
    const currentTime = Date.now();
    const result = await db.prepare(`UPDATE hosted_quotes SET lock_token = ?, lock_until = ?
      WHERE id = ? AND workspace_id = ? AND lock_until <= ?`)
      .bind(token, currentTime + leaseMilliseconds, quoteId, workspaceId, currentTime).run();
    if (result.meta.changes !== 1) {
      const owned = await db.prepare('SELECT id FROM hosted_quotes WHERE id = ? AND workspace_id = ?')
        .bind(quoteId, workspaceId).first();
      if (!owned) throw new AppError('QUOTE_NOT_FOUND', 'This quote could not be found.', 404);
      throw busy();
    }
    locked = true;
  }

  const release = async () => {
    if (!locked || !activeId) return;
    await db.prepare(`UPDATE hosted_quotes SET lock_token = NULL, lock_until = 0
      WHERE id = ? AND workspace_id = ? AND lock_token = ?`)
      .bind(activeId, workspaceId, token).run();
    locked = false;
  };

  try {
    const rows = quoteId
      ? await db.prepare('SELECT id, payload, attempts FROM hosted_quotes WHERE id = ? AND workspace_id = ?')
        .bind(quoteId, workspaceId).all<StoredRow>()
      : await db.prepare('SELECT id, payload, attempts FROM hosted_quotes WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 20')
        .bind(workspaceId).all<StoredRow>();
    for (const row of rows.results) {
      const quote: Quote = JSON.parse(row.payload);
      if (quote.id !== row.id) throw new Error('Stored quote identity is invalid.');
      quotes.set(quote.id, { ...quote, hourlyRateCents: quote.hourlyRateCents ?? null, workEstimate: quote.workEstimate ?? null });
      const savedAttempts: PaymentAttempt[] = JSON.parse(row.attempts);
      for (const attempt of savedAttempts) {
        if (attempt.quoteId !== row.id) throw new Error('Stored payment identity is invalid.');
        attempts.set(attempt.id, attempt);
      }
    }
  } catch (error) {
    await release();
    throw error;
  }

  const store: QuoteStore = {
    listQuotes: () => {
      ensureOpen();
      return [...quotes.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(copy);
    },
    getQuote: (id) => {
      ensureOpen();
      const quote = quotes.get(id);
      return quote ? copy(quote) : undefined;
    },
    saveQuote: (quote) => {
      ensureWritable();
      if (activeId) {
        if (quote.id !== activeId) throw new AppError('QUOTE_NOT_FOUND', 'This quote could not be found.', 404);
      } else {
        // The create route can insert one new quote, never modify loaded rows.
        if ((quotes.has(quote.id) && pendingNewId !== quote.id) || (pendingNewId && pendingNewId !== quote.id)) throw lostLease();
        if (!pendingNewId && quotes.size >= maxWorkspaceQuotes) {
          throw new AppError('WORKSPACE_FULL', 'This demo workspace has reached its 20 quote limit.', 429);
        }
        pendingNewId = quote.id;
      }
      quotes.set(quote.id, copy(quote));
    },
    getAttempt: (id, revision) => {
      ensureOpen();
      const attempt = [...attempts.values()].find((value) => value.quoteId === id && value.revision === revision);
      return attempt ? copy(attempt) : undefined;
    },
    getAttemptByOrder: (orderId) => {
      ensureOpen();
      const attempt = [...attempts.values()].find((value) => value.orderId === orderId);
      return attempt ? copy(attempt) : undefined;
    },
    saveAttempt: (attempt) => {
      ensureWritable();
      if (attempt.quoteId !== (activeId ?? pendingNewId)) throw lostLease();
      if ([...attempts.values()].some((value) => value.id !== attempt.id &&
        ((value.quoteId === attempt.quoteId && value.revision === attempt.revision) ||
          (attempt.orderId !== null && value.orderId === attempt.orderId)))) throw lostLease();
      attempts.set(attempt.id, copy(attempt));
    },
    transaction: <T>(callback: () => T): T => {
      ensureWritable();
      const previousQuotes = copy(quotes);
      const previousAttempts = copy(attempts);
      const previousNewId = pendingNewId;
      try {
        const result = callback();
        if (result && typeof (result as { then?: unknown }).then === 'function') {
          throw new Error('Hosted store transactions must be synchronous.');
        }
        return result;
      } catch (error) {
        quotes = previousQuotes;
        attempts = previousAttempts;
        pendingNewId = previousNewId;
        throw error;
      }
    },
    // The service never closes its store. The request owner must await session.close().
    close: () => { throw new Error('Use the asynchronous hosted session close().'); },
  };

  const checkpoint = async () => {
    ensureOpen();
    if (!mutating) return;
    const id = activeId ?? pendingNewId;
    if (!id) return;
    const quote = quotes.get(id);
    if (!quote) throw lostLease();
    const payload = JSON.stringify(quote);
    const savedAttempts = JSON.stringify([...attempts.values()].filter((attempt) => attempt.quoteId === id));
    if (new TextEncoder().encode(payload).length + new TextEncoder().encode(savedAttempts).length > maxPayloadBytes) {
      throw new AppError('QUOTE_TOO_LARGE', 'This quote exceeds the hosted demo size limit.', 413);
    }
    const currentTime = Date.now();
    if (!activeId) {
      // INSERT SELECT makes the workspace capacity check atomic across Workers.
      const result = await db.prepare(`INSERT INTO hosted_quotes
        (id, workspace_id, payload, attempts, updated_at, lock_token, lock_until)
        SELECT ?, ?, ?, ?, ?, ?, ? WHERE
        (SELECT COUNT(*) FROM hosted_quotes WHERE workspace_id = ?) < ?`)
        .bind(id, workspaceId, payload, savedAttempts, quote.updatedAt, token,
          currentTime + leaseMilliseconds, workspaceId, maxWorkspaceQuotes).run();
      if (result.meta.changes !== 1) {
        throw new AppError('WORKSPACE_FULL', 'This demo workspace has reached its 20 quote limit.', 429);
      }
      activeId = id;
      locked = true;
      return;
    }
    const result = await db.prepare(`UPDATE hosted_quotes SET payload = ?, attempts = ?, updated_at = ?, lock_until = ?
      WHERE id = ? AND workspace_id = ? AND lock_token = ? AND lock_until > ?`)
      .bind(payload, savedAttempts, quote.updatedAt, currentTime + leaseMilliseconds,
        id, workspaceId, token, currentTime).run();
    if (result.meta.changes !== 1) throw lostLease();
  };

  return {
    store,
    checkpoint,
    close: async () => {
      if (closed) return;
      try {
        await checkpoint();
      } finally {
        try { await release(); } finally { closed = true; }
      }
    },
  };
}
