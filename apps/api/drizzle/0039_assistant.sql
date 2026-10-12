-- 0039_assistant.sql
-- The accounts assistant: an AI chat that reads the books through the same
-- services the screens use, and proposes postings a person must confirm.
--
-- A conversation belongs to one user and is never shared. Every model turn,
-- tool call and tool result is kept, so a follow-up question ("and last
-- month?") has the context the first answer was built from, and so anyone
-- reviewing an answer can see exactly which figures the model was given.
--
-- A write is never made by the model. It stores a PENDING action describing
-- the exact request; only the user's own confirm replays it through the real
-- route, under their session, with every permission, approval, day lock and
-- audit rule that route already applies.

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  branch_id TEXT,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assistant_conversations_user
  ON assistant_conversations (user_id, archived, updated_at);

CREATE TABLE IF NOT EXISTS assistant_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
  seq INTEGER NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'tool')),
  content TEXT NOT NULL DEFAULT '',
  -- assistant turns: the tool calls the model asked for, as JSON
  tool_calls_json TEXT,
  -- tool turns: which call this answers, and the tool's name
  tool_call_id TEXT,
  tool_name TEXT,
  model TEXT,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE (conversation_id, seq)
);

CREATE TABLE IF NOT EXISTS assistant_actions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES assistant_conversations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  -- the assistant reply the confirm card is shown under
  message_id TEXT,
  tool TEXT NOT NULL,
  title TEXT NOT NULL,
  -- human-readable lines shown on the confirm card
  summary_json TEXT NOT NULL,
  method TEXT NOT NULL CHECK (method IN ('POST', 'PATCH', 'PUT')),
  path TEXT NOT NULL,
  body_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'RUNNING', 'DONE', 'SENT_FOR_APPROVAL', 'FAILED', 'CANCELLED', 'EXPIRED')),
  result_json TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  decided_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_assistant_actions_conversation
  ON assistant_actions (conversation_id, created_at);

-- A rolling per-user request count, so a stuck client or a loop cannot run
-- up the AI bill.
CREATE TABLE IF NOT EXISTS assistant_usage (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

INSERT INTO settings (key, value_json, type) VALUES
  ('assistant_enabled', 'true', 'boolean'),
  ('assistant_daily_request_limit', '200', 'number')
ON CONFLICT(key) DO NOTHING;
