CREATE TABLE hosted_customer_grants (
  quote_id TEXT PRIMARY KEY NOT NULL,
  workspace_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  approved_revision INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (quote_id) REFERENCES hosted_quotes(id)
);
