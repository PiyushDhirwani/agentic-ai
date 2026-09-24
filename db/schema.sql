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


-- ---------------------------------------------------------------------------
-- Model catalogue. Kept in the database because OpenRouter's :free model ids
-- change often — a rotation should be an UPDATE, not a redeploy.
--
-- The fallback chain is every enabled row in sort_order. The row flagged
-- is_default is the model offered first in the UI.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS models (
  id          TEXT PRIMARY KEY,
  label       TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  is_default  BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one row may be the default.
CREATE UNIQUE INDEX IF NOT EXISTS models_single_default_idx
  ON models ((is_default)) WHERE is_default;

CREATE INDEX IF NOT EXISTS models_enabled_sort_order_idx
  ON models (sort_order) WHERE enabled;

-- Seed. ON CONFLICT DO NOTHING so re-running never clobbers your edits.
INSERT INTO models (id, label, enabled, is_default, sort_order, notes) VALUES
  ('nvidia/nemotron-3-ultra-550b-a55b:free',              'Nemotron 3 Ultra 550B',      TRUE,  TRUE,  10, NULL),
  ('nvidia/nemotron-3.5-lightning:free',                  'Nemotron 3.5 Lightning',     TRUE,  FALSE, 20, NULL),
  ('nvidia/nemotron-3-super-120b-a12b:free',              'Nemotron 3 Super 120B',      TRUE,  FALSE, 30, NULL),
  ('nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free',  'Nemotron 3 Nano Omni 30B',   TRUE,  FALSE, 40, NULL),
  ('deepseek/deepseek-v4-flash-0731:free',                'DeepSeek V4 Flash',          TRUE,  FALSE, 50, NULL),
  ('thinkingmachines/inkling-small:free',                 'Inkling Small',              TRUE,  FALSE, 60, NULL),
  ('thinkingmachines/inkling:free',                       'Inkling',                    TRUE,  FALSE, 70, NULL),
  ('nvidia/nemotron-3.5-content-safety:free',             'Nemotron 3.5 Content Safety', FALSE, FALSE, 900,
   'Safety classifier, not a chat model. Disabled: in a fallback chain it would answer with a moderation verdict instead of a reply.')
ON CONFLICT (id) DO NOTHING;


-- ---------------------------------------------------------------------------
-- Semantic recall. Embeddings of past messages, searched by cosine distance so
-- a new question can pull in relevant earlier discussion.
--
-- This table is a CACHE: every row is derivable from `messages`, so it can be
-- dropped and rebuilt at any time, losing only the time and cost to re-embed.
--
-- `model` is part of the primary key, not just metadata. Vectors from two
-- different embedding models are not comparable even at identical width, so
-- searches filter on the active model and rows from other models are simply
-- invisible rather than silently poisoning results. Switching EMBEDDING_MODEL
-- therefore needs no migration: the new model finds nothing indexed and
-- backfills itself as conversations are used.
--
-- VECTOR(n) fixes the width. pgvector's HNSW index supports at most 2000
-- dimensions, so a wider model must be narrowed with EMBEDDING_DIMENSIONS
-- (Matryoshka truncation) or the column changed to halfvec, which reaches 4000.
-- ---------------------------------------------------------------------------

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS message_embeddings (
  message_id      BIGINT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  model           TEXT NOT NULL,
  dimensions      INTEGER NOT NULL,
  embedding       VECTOR(1536) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, model)
);

-- Approximate nearest neighbour over cosine distance.
CREATE INDEX IF NOT EXISTS message_embeddings_hnsw_idx
  ON message_embeddings USING hnsw (embedding vector_cosine_ops);

-- Finding what still needs embedding for the active model.
CREATE INDEX IF NOT EXISTS message_embeddings_model_idx
  ON message_embeddings (model);

CREATE INDEX IF NOT EXISTS message_embeddings_conversation_idx
  ON message_embeddings (conversation_id);


-- Sources returned by web search, stored alongside the answer that cited them.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS citations JSONB;


-- ---------------------------------------------------------------------------
-- MCP servers the assistant may call tools on.
--
-- Remote (Streamable HTTP) servers only: a stdio server needs a child process,
-- which a serverless function cannot host.
--
-- Secrets are NOT stored here. `api_key_env` names an environment variable, so
-- the key lives in the platform's secret store and never in the database.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS mcp_servers (
  id          TEXT PRIMARY KEY,
  label       TEXT,
  url         TEXT NOT NULL,
  -- Name of the env var holding the key, e.g. 'EXA_API_KEY'.
  api_key_env TEXT,
  -- Header the key is sent in; Exa uses x-api-key, others use Authorization.
  api_key_header TEXT NOT NULL DEFAULT 'x-api-key',
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INTEGER NOT NULL DEFAULT 100,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS mcp_servers_enabled_idx
  ON mcp_servers (sort_order) WHERE enabled;

-- Exa's hosted server. `agent_run` is deliberately absent from ?tools=: asking
-- for it makes the endpoint require authentication even for the other tools.
INSERT INTO mcp_servers (id, label, url, api_key_env, api_key_header, enabled, sort_order, notes) VALUES
  ('exa', 'Exa Search',
   'https://mcp.exa.ai/mcp?tools=web_search_exa,web_fetch_exa,web_search_advanced_exa',
   'EXA_API_KEY', 'x-api-key', TRUE, 10,
   'Works without a key on a rate-limited free tier; set EXA_API_KEY to lift the limit. Adding agent_run to the tools list forces authentication.')
ON CONFLICT (id) DO NOTHING;


-- Tool calling adds a fourth message role, plus the call and result linkage.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_role_check;
ALTER TABLE messages ADD CONSTRAINT messages_role_check
  CHECK (role IN ('system', 'user', 'assistant', 'tool'));

-- Tool calls the assistant requested, replayed verbatim on the next request.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_calls JSONB;
-- On a 'tool' message, which call this is the result of.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_call_id TEXT;
-- Which MCP tool produced it, for display.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tool_name TEXT;
