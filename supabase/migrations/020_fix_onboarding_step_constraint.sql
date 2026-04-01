-- Fix onboarding_step constraint: code has 7 steps (staging was added between tools and indexing)
-- Old constraint allowed max 6, but completion sets step to 7 which silently failed.

ALTER TABLE public.users
  DROP CONSTRAINT IF EXISTS users_onboarding_step_check;

ALTER TABLE public.users
  ADD CONSTRAINT users_onboarding_step_check CHECK (onboarding_step >= 1 AND onboarding_step <= 7);

COMMENT ON COLUMN public.users.onboarding_step IS '1=workspace 2=trial 3=tools 4=staging 5=indexing 6=first-review 7=done';
