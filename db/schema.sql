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
