CREATE TABLE hosted_quotes (
  id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  attempts TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL,
  lock_token TEXT,
  lock_until INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX hosted_quotes_workspace ON hosted_quotes(workspace_id, updated_at);
--> statement-breakpoint
CREATE TABLE hosted_limits (
  id TEXT PRIMARY KEY NOT NULL,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
