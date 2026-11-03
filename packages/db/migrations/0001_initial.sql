-- Migration 0001: Initial schema for Cloudflare EasyTmp Mail
-- Stores sanitized messages with a strict 7-day retention period.

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  address TEXT NOT NULL,
  envelope_from TEXT,
  from_name TEXT NOT NULL DEFAULT '',
  from_address TEXT,
  from_domain TEXT,
  subject TEXT NOT NULL,
  text_body TEXT NOT NULL,
  text_truncated INTEGER NOT NULL DEFAULT 0 CHECK (text_truncated IN (0, 1)),
  html_body TEXT,
  html_status TEXT NOT NULL CHECK (html_status IN ('available', 'not_present', 'too_large', 'unavailable')),
  code_candidates_json TEXT NOT NULL,
  links_json TEXT NOT NULL,
  dmarc_pass INTEGER NOT NULL CHECK (dmarc_pass IN (0, 1)),
  size_bytes INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  CHECK (expires_at = received_at + 604800000)
);

-- Primary query index for listing messages by address in reverse chronological order
CREATE INDEX IF NOT EXISTS idx_messages_address_received_id
  ON messages(address, received_at DESC, id DESC);

-- Index for cron cleanup of expired messages
CREATE INDEX IF NOT EXISTS idx_messages_expires_at
  ON messages(expires_at);
