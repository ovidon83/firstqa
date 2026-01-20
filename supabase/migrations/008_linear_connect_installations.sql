-- Create table for Linear installations (API key based)
CREATE TABLE IF NOT EXISTS linear_connect_installations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  api_key TEXT NOT NULL, -- Linear Personal API Key
  organization_id TEXT NOT NULL,
  organization_name TEXT,
  team_id TEXT, -- Optional: specific team ID if scoped
  webhook_secret TEXT, -- For webhook signature verification
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_linear_connect_org_id ON linear_connect_installations(organization_id);
CREATE INDEX IF NOT EXISTS idx_linear_connect_api_key ON linear_connect_installations(api_key);

-- Add RLS policies (Linear installations are system-managed)
ALTER TABLE linear_connect_installations ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage installations
CREATE POLICY "Service role can manage Linear Connect installations"
  ON linear_connect_installations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE linear_connect_installations IS 'Stores Linear API installations for organizations';
