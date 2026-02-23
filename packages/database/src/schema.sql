-- Work Items table
CREATE TABLE IF NOT EXISTS work_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key VARCHAR(255) NOT NULL,
  source VARCHAR(50) NOT NULL,
  source_ref VARCHAR(500) NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'NEW',
  title TEXT NOT NULL,
  payload JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for work_items
CREATE INDEX IF NOT EXISTS idx_work_items_session_key ON work_items(session_key);
CREATE INDEX IF NOT EXISTS idx_work_items_status ON work_items(status);
CREATE INDEX IF NOT EXISTS idx_work_items_created_at ON work_items(created_at DESC);

-- Idempotency Keys table for deduplication
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key VARCHAR(255) PRIMARY KEY,
  work_item_id UUID REFERENCES work_items(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Session Summaries table (for compacted conversation history)
CREATE TABLE IF NOT EXISTS session_summaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_key VARCHAR(255) NOT NULL,
  agent_id UUID NOT NULL,
  summary TEXT NOT NULL,
  turn_count INTEGER NOT NULL,
  start_time BIGINT NOT NULL,
  end_time BIGINT NOT NULL,
  embedding BYTEA,
  compacted_at BIGINT DEFAULT EXTRACT(EPOCH FROM NOW())::BIGINT
);

-- Indexes for session_summaries
CREATE INDEX IF NOT EXISTS idx_session_summaries_session_key ON session_summaries(session_key);
CREATE INDEX IF NOT EXISTS idx_session_summaries_agent_id ON session_summaries(agent_id);
CREATE INDEX IF NOT EXISTS idx_session_summaries_compacted_at ON session_summaries(compacted_at DESC);

-- Add embedding column to messages table (for semantic search)
ALTER TABLE messages ADD COLUMN IF NOT EXISTS embedding BYTEA;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS todo_state JSONB;

-- Trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS update_work_items_updated_at ON work_items;
CREATE TRIGGER update_work_items_updated_at
    BEFORE UPDATE ON work_items
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
