-- Migration: Add Jira and Linear as valid providers
-- Date: 2026-01-10
-- Description: Update the provider check constraint to include 'jira' and 'linear'

-- Drop the old constraint
ALTER TABLE public.integrations 
  DROP CONSTRAINT IF EXISTS integrations_provider_check;

-- Add the new constraint with jira and linear
ALTER TABLE public.integrations 
  ADD CONSTRAINT integrations_provider_check 
  CHECK (provider IN ('github', 'bitbucket', 'jira', 'linear'));

-- Also update the analyses table constraint to match
ALTER TABLE public.analyses 
  DROP CONSTRAINT IF EXISTS analyses_provider_check;

ALTER TABLE public.analyses 
  ADD CONSTRAINT analyses_provider_check 
  CHECK (provider IN ('github', 'bitbucket', 'jira', 'linear'));

-- Make access_token nullable for GitHub App integrations (which use JWT)
ALTER TABLE public.integrations 
  ALTER COLUMN access_token DROP NOT NULL;
