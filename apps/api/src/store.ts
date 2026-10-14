import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq, desc } from 'drizzle-orm';
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Quote } from '@agree-first/shared';

const quotesTable = sqliteTable('quotes', {
  id: text('id').primaryKey(),
  payload: text('payload', { mode: 'json' }).$type<Quote>().notNull(),
  updatedAt: text('updated_at').notNull(),
});

export interface PaymentAttempt {
  id: string;
  quoteId: string;
  revision: number;
  createRequestId: string;
  captureRequestId: string;
  orderId: string | null;
  merchantId: string | null;
  createdAt: string;
  captureStartedAt: string | null;
  state: 'creating' | 'created' | 'capturing' | 'paid';
}

const attemptsTable = sqliteTable('payment_attempts', {
  id: text('id').primaryKey(),
  quoteId: text('quote_id').notNull(),
  revision: integer('revision').notNull(),
  orderId: text('order_id').unique(),
  payload: text('payload', { mode: 'json' }).$type<PaymentAttempt>().notNull(),
}, (table) => [uniqueIndex('attempt_revision').on(table.quoteId, table.revision)]);

function normalizeQuote(quote: Quote): Quote {
  return { ...quote, hourlyRateCents: quote.hourlyRateCents ?? null, workEstimate: quote.workEstimate ?? null };
}

export function createStore(path: string) {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const connection = new Database(path);
  connection.pragma('journal_mode = WAL');
  connection.pragma('busy_timeout = 5000');
  connection.exec(`
    CREATE TABLE IF NOT EXISTS quotes (id TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS payment_attempts (
      id TEXT PRIMARY KEY, quote_id TEXT NOT NULL, revision INTEGER NOT NULL,
      order_id TEXT UNIQUE, payload TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS attempt_revision ON payment_attempts (quote_id, revision);
  `);
  const database = drizzle(connection);
  return {
    listQuotes: () => database.select().from(quotesTable).orderBy(desc(quotesTable.updatedAt)).all().map((row) => normalizeQuote(row.payload)),
    getQuote: (id: string) => {
      const quote = database.select().from(quotesTable).where(eq(quotesTable.id, id)).get()?.payload;
      return quote ? normalizeQuote(quote) : undefined;
    },
    saveQuote: (quote: Quote) => {
      database.insert(quotesTable).values({ id: quote.id, payload: quote, updatedAt: quote.updatedAt })
        .onConflictDoUpdate({ target: quotesTable.id, set: { payload: quote, updatedAt: quote.updatedAt } }).run();
    },
    getAttempt: (quoteId: string, revision: number) => database.select().from(attemptsTable)
      .where(eq(attemptsTable.quoteId, quoteId)).all().find((row) => row.revision === revision)?.payload,
    getAttemptByOrder: (orderId: string) => database.select().from(attemptsTable)
      .where(eq(attemptsTable.orderId, orderId)).get()?.payload,
    saveAttempt: (attempt: PaymentAttempt) => {
      database.insert(attemptsTable).values({
        id: attempt.id, quoteId: attempt.quoteId, revision: attempt.revision,
        orderId: attempt.orderId, payload: attempt,
      }).onConflictDoUpdate({ target: attemptsTable.id, set: { payload: attempt, orderId: attempt.orderId } }).run();
    },
    transaction: <T>(callback: () => T): T => connection.transaction(callback)(),
    close: () => connection.close(),
  };
}

export type QuoteStore = ReturnType<typeof createStore>;
