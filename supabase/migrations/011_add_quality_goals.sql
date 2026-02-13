-- Add quality goals / challenges field for onboarding workspace step

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS quality_goals TEXT;

COMMENT ON COLUMN public.users.quality_goals IS 'Quality goals or challenges from onboarding workspace step';
