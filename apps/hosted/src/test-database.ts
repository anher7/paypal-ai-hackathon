import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import type { HostedDatabase } from './store.js';

/** Real SQLite and the deployment migration exercise SQL and fencing semantics. */
export function database() {
  const connection = new Database(':memory:');
  connection.exec(readFileSync(new URL('../../../drizzle/0000_hosted_workspace.sql', import.meta.url), 'utf8'));
  const db: HostedDatabase = {
    prepare(sql) {
      let values: unknown[] = [];
      const statement: ReturnType<HostedDatabase['prepare']> = {
        bind(...args) { values = args; return statement; },
        async first<T>() { return (connection.prepare(sql).get(...values) as T | undefined) ?? null; },
        async all<T>() { return { results: connection.prepare(sql).all(...values) as T[] }; },
        async run() { return { meta: { changes: connection.prepare(sql).run(...values).changes } }; },
      };
      return statement;
    },
  };
  return { db, connection };
}
