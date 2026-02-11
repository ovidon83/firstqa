-- Onboarding flow: workspace, trial, tools, indexing, first review
-- Adds columns to track onboarding progress for new users

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS company_name TEXT,
  ADD COLUMN IF NOT EXISTS team_size TEXT CHECK (team_size IN ('1-5', '6-20', '21-50', '50+')),
  ADD COLUMN IF NOT EXISTS onboarding_step INTEGER DEFAULT 1 CHECK (onboarding_step >= 1 AND onboarding_step <= 6),
  ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.onboarding_step IS '1=workspace 2=trial 3=tools 4=indexing 5=first-review 6=done';
COMMENT ON COLUMN public.users.trial_started_at IS 'When 5-day/10-PR trial started';
