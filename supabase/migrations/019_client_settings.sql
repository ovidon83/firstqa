-- Per-client settings for FirstQA analysis and test execution configuration
CREATE TABLE IF NOT EXISTS client_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staging_url TEXT,
  auto_analyze_prs BOOLEAN NOT NULL DEFAULT false,
  post_merge_tests BOOLEAN NOT NULL DEFAULT false,
  post_merge_delay_ms INTEGER NOT NULL DEFAULT 300000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT client_settings_user_id_unique UNIQUE (user_id)
);

-- RLS
ALTER TABLE client_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own settings"
  ON client_settings FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own settings"
  ON client_settings FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own settings"
  ON client_settings FOR UPDATE
  USING (auth.uid() = user_id);

-- Service role bypass
CREATE POLICY "Service role full access on client_settings"
  ON client_settings FOR ALL
  USING (auth.role() = 'service_role');
