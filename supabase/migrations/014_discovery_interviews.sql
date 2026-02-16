-- Discovery interview (Launch Partner) applications
-- Stores multi-step form responses and qualification status

CREATE TYPE discovery_qualification_status AS ENUM (
  'high_priority',
  'medium',
  'low',
  'disqualified'
);

CREATE TABLE IF NOT EXISTS public.discovery_interviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Step 1
  qa_process TEXT,
  qa_process_other TEXT,

  -- Step 2
  bug_fix_percentage TEXT,

  -- Step 3
  solution_interest TEXT,

  -- Step 4
  commitment_level TEXT,

  -- Step 5
  company_name TEXT,
  role TEXT,
  team_size TEXT,
  tech_stack TEXT,
  start_timeline TEXT,

  -- Step 6
  email TEXT NOT NULL,
  linkedin_url TEXT,
  meeting_tool TEXT,
  additional_notes TEXT,

  -- Qualification
  qualification_status discovery_qualification_status NOT NULL DEFAULT 'medium',
  disqualification_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_discovery_interviews_submitted_at
  ON public.discovery_interviews (submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_discovery_interviews_qualification_status
  ON public.discovery_interviews (qualification_status);

COMMENT ON TABLE public.discovery_interviews IS 'Launch Partner discovery interview submissions';
