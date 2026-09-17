-- Schema for the chat service. Safe to run repeatedly.
-- Requires PostgreSQL 13+, where gen_random_uuid() is in core (no pgcrypto).

CREATE TABLE IF NOT EXISTS conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title       TEXT,
  model       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS messages (
  id                BIGSERIAL PRIMARY KEY,
  conversation_id   UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role              TEXT NOT NULL CHECK (role IN ('system', 'user', 'assistant')),
  content           TEXT,
  -- Opaque OpenRouter payload, replayed verbatim on the next request.
  reasoning_details JSONB,
  model             TEXT,
  prompt_tokens     INTEGER,
  completion_tokens INTEGER,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The hot path: newest N messages of one conversation.
CREATE INDEX IF NOT EXISTS messages_conversation_id_id_idx
  ON messages (conversation_id, id DESC);

CREATE INDEX IF NOT EXISTS conversations_updated_at_idx
  ON conversations (updated_at DESC);
