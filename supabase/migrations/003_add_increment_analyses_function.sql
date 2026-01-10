-- Migration: Add function to increment user analyses count
-- Date: 2026-01-10
-- Description: Adds a PostgreSQL function to safely increment the analyses count for a user

-- Create function to increment analyses count
CREATE OR REPLACE FUNCTION increment_user_analyses_count(user_id_param UUID)
RETURNS void AS $$
BEGIN
  UPDATE public.users
  SET 
    analyses_this_month = analyses_this_month + 1,
    updated_at = NOW()
  WHERE id = user_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION increment_user_analyses_count(UUID) TO authenticated;
