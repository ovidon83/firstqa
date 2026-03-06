-- Product-aware knowledge: add product_area and user_flow types; add repo_context table

-- Allow new knowledge_type values (drop existing CHECK, add new one)
ALTER TABLE product_knowledge DROP CONSTRAINT IF EXISTS product_knowledge_knowledge_type_check;
ALTER TABLE product_knowledge ADD CONSTRAINT product_knowledge_knowledge_type_check CHECK (
  knowledge_type IN (
    'component', 'function', 'api', 'data_model', 'feature', 'other',
    'product_area', 'user_flow'
  )
);

-- Repo context: product areas, user flows, services, tests by area, dependency graph
CREATE TABLE IF NOT EXISTS repo_context (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL UNIQUE,
  product_areas JSONB DEFAULT '{}',
  user_flows JSONB DEFAULT '[]',
  services JSONB DEFAULT '{}',
  tests_by_area JSONB DEFAULT '{}',
  dependency_graph JSONB DEFAULT '{}',
  git_sha TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repo_context_repo_id ON repo_context(repo_id);

ALTER TABLE repo_context ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Service role full access repo_context" ON repo_context FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMENT ON TABLE repo_context IS 'Stores structured repo context: product areas, user flows, services, tests by area, dependency graph for PR analysis';
