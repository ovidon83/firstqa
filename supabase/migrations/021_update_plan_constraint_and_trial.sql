-- Migration 021: Update plan constraint and add trial_started_at
--
-- 1. Drop the old restrictive plan CHECK constraint
-- 2. Add the new plan values we now use
-- 3. Add trial_started_at column for tracking when a trial began

-- Drop old constraint (name may vary — drop both possible names safely)
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_fkey;

-- Add updated CHECK constraint with all current plan values
ALTER TABLE users
  ADD CONSTRAINT users_plan_check
  CHECK (plan IN (
    'free',
    'free_trial',
    'Launch Partner',
    'Starter',
    'Pro',
    'pro',
    'Enterprise',
    'enterprise'
  ));

-- Add trial_started_at if it doesn't exist
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS trial_started_at TIMESTAMPTZ DEFAULT NULL;

-- Update existing 'free' users to 'free_trial' so the new logic applies
UPDATE users SET plan = 'free_trial' WHERE plan = 'free';

-- Update default for new rows
ALTER TABLE users ALTER COLUMN plan SET DEFAULT 'free_trial';
