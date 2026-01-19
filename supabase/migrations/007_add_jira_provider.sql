-- Add 'jira' as a valid provider for analyses table
-- This allows Jira Connect webhook analyses to be saved

-- Drop the old constraint
ALTER TABLE public.analyses 
DROP CONSTRAINT IF EXISTS analyses_provider_check;

-- Add new constraint with 'jira' included
ALTER TABLE public.analyses 
ADD CONSTRAINT analyses_provider_check 
CHECK (provider IN ('github', 'bitbucket', 'jira'));

-- Comment
COMMENT ON COLUMN public.analyses.provider IS 'Source provider: github, bitbucket, or jira';
