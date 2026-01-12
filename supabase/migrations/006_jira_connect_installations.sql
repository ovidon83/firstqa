-- Create table for Jira Connect installations
CREATE TABLE IF NOT EXISTS jira_connect_installations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_key TEXT UNIQUE NOT NULL,
  shared_secret TEXT NOT NULL,
  base_url TEXT NOT NULL,
  product_type TEXT,
  description TEXT,
  site_name TEXT,
  installed_at TIMESTAMPTZ DEFAULT NOW(),
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_jira_connect_client_key ON jira_connect_installations(client_key);
CREATE INDEX IF NOT EXISTS idx_jira_connect_site_name ON jira_connect_installations(site_name);

-- Add RLS policies (Jira Connect installations are system-managed)
ALTER TABLE jira_connect_installations ENABLE ROW LEVEL SECURITY;

-- Allow service role to manage installations
CREATE POLICY "Service role can manage Jira Connect installations"
  ON jira_connect_installations
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Comment on table
COMMENT ON TABLE jira_connect_installations IS 'Stores Atlassian Connect app installations for Jira sites';
