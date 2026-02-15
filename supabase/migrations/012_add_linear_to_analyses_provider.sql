-- Add 'linear' as a valid provider for analyses table
-- Migration 007 accidentally omitted linear when adding jira
-- This allows Linear webhook analyses to be saved

ALTER TABLE public.analyses 
DROP CONSTRAINT IF EXISTS analyses_provider_check;

ALTER TABLE public.analyses 
ADD CONSTRAINT analyses_provider_check 
CHECK (provider IN ('github', 'bitbucket', 'jira', 'linear'));

COMMENT ON COLUMN public.analyses.provider IS 'Source provider: github, bitbucket, jira, or linear';
