-- Add feedback columns to analyses table for thumbs up/down on analysis comments
ALTER TABLE analyses
  ADD COLUMN IF NOT EXISTS feedback TEXT CHECK (feedback IN ('positive', 'negative')),
  ADD COLUMN IF NOT EXISTS feedback_at TIMESTAMPTZ;
