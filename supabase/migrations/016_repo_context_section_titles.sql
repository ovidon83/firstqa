-- Add section_titles to repo_context so PR analysis can use accurate page/section names
-- even when the PR only touches a few files (flow discovery from changed files may miss them).

ALTER TABLE repo_context
  ADD COLUMN IF NOT EXISTS section_titles JSONB DEFAULT '[]';

COMMENT ON COLUMN repo_context.section_titles IS 'List of { "title": string, "file": string } from full repo index; used for Test Recipe naming.';
