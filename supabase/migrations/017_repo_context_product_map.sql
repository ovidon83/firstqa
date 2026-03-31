-- Add product map columns to repo_context for persistent flow/UI/API knowledge
ALTER TABLE repo_context
  ADD COLUMN IF NOT EXISTS routes JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS ui_elements JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS api_endpoints JSONB DEFAULT '[]',
  ADD COLUMN IF NOT EXISTS messages JSONB DEFAULT '[]';
