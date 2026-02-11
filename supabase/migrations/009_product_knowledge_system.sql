-- Product Knowledge System for FirstQA
-- Enables continuous codebase understanding for better PR and ticket analysis

-- Enable pgvector extension for embeddings (OpenAI ada-002 uses 1536 dimensions)
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================
-- PRODUCT_KNOWLEDGE TABLE
-- Stores extracted knowledge from codebase (components, APIs, data models, etc.)
-- ============================================
CREATE TABLE IF NOT EXISTS product_knowledge (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  knowledge_type TEXT NOT NULL CHECK (knowledge_type IN ('component', 'function', 'api', 'data_model', 'feature', 'other')),
  entity_name TEXT NOT NULL,
  description TEXT,
  file_paths TEXT[] DEFAULT '{}',
  dependencies TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  embedding vector(1536),
  git_sha TEXT,
  last_updated TIMESTAMPTZ DEFAULT NOW(),
  source_pr_number INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for product_knowledge
CREATE INDEX IF NOT EXISTS idx_product_knowledge_repo_id ON product_knowledge(repo_id);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_git_sha ON product_knowledge(git_sha);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_type ON product_knowledge(knowledge_type);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_entity ON product_knowledge(repo_id, entity_name);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_file_paths ON product_knowledge USING GIN(file_paths);
CREATE INDEX IF NOT EXISTS idx_product_knowledge_last_updated ON product_knowledge(last_updated);

-- IVFFlat index for vector similarity search (lists=1 works for empty/small tables)
CREATE INDEX IF NOT EXISTS idx_product_knowledge_embedding ON product_knowledge 
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);

-- ============================================
-- KNOWLEDGE_SYNC_JOBS TABLE
-- Tracks codebase analysis and PR sync jobs
-- ============================================
CREATE TABLE IF NOT EXISTS knowledge_sync_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  repo_id TEXT NOT NULL,
  job_type TEXT NOT NULL CHECK (job_type IN ('initial_analysis', 'pr_sync')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  progress INTEGER DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for knowledge_sync_jobs
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_jobs_repo_id ON knowledge_sync_jobs(repo_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_jobs_status ON knowledge_sync_jobs(status);
CREATE INDEX IF NOT EXISTS idx_knowledge_sync_jobs_created ON knowledge_sync_jobs(created_at DESC);

-- ============================================
-- RPC: match_product_knowledge
-- Vector similarity search for product knowledge
-- ============================================
CREATE OR REPLACE FUNCTION match_product_knowledge(
  query_embedding vector(1536),
  match_repo_id TEXT,
  match_threshold FLOAT DEFAULT 0.7,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  repo_id TEXT,
  knowledge_type TEXT,
  entity_name TEXT,
  description TEXT,
  file_paths TEXT[],
  dependencies TEXT[],
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pk.id,
    pk.repo_id,
    pk.knowledge_type,
    pk.entity_name,
    pk.description,
    pk.file_paths,
    pk.dependencies,
    pk.metadata,
    1 - (pk.embedding <=> query_embedding) AS similarity
  FROM product_knowledge pk
  WHERE pk.repo_id = match_repo_id
    AND pk.embedding IS NOT NULL
    AND (1 - (pk.embedding <=> query_embedding)) > match_threshold
  ORDER BY pk.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- RLS policies (service_role bypasses these; add for future client access)
ALTER TABLE product_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access product_knowledge" ON product_knowledge FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "Service role full access knowledge_sync_jobs" ON knowledge_sync_jobs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Comments
COMMENT ON TABLE product_knowledge IS 'Stores extracted product/codebase knowledge for context-aware PR analysis';
COMMENT ON TABLE knowledge_sync_jobs IS 'Tracks codebase indexing and PR sync job progress';
COMMENT ON FUNCTION match_product_knowledge IS 'Vector similarity search for product knowledge by embedding';
