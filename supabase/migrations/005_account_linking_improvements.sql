-- PRODUCTION FIX: Account Linking Improvements
-- This migration ensures proper account linking and prevents duplicate integrations

-- ============================================
-- 1. ADD UNIQUE CONSTRAINT TO PREVENT DUPLICATE INSTALLATIONS
-- ============================================
-- Drop the old constraint if it exists (it allowed duplicates)
ALTER TABLE public.integrations 
DROP CONSTRAINT IF EXISTS integrations_user_id_provider_account_id_key;

-- Add a new constraint: One installation ID per provider (regardless of user)
-- This prevents the same GitHub installation from being linked to multiple FirstQA accounts
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_provider_account 
ON public.integrations(provider, account_id);

-- ============================================
-- 2. ADD HELPER FUNCTION TO MERGE ACCOUNTS
-- ============================================
-- This function is called manually by admins to merge duplicate accounts
CREATE OR REPLACE FUNCTION merge_user_accounts(
  source_user_id UUID,
  target_user_id UUID
)
RETURNS VOID AS $$
BEGIN
  -- Move integrations from source to target (if not already there)
  UPDATE public.integrations
  SET user_id = target_user_id
  WHERE user_id = source_user_id
  ON CONFLICT (provider, account_id) DO NOTHING;
  
  -- Move analyses from source to target
  UPDATE public.analyses
  SET user_id = target_user_id
  WHERE user_id = source_user_id;
  
  -- Update analyses count on target user
  UPDATE public.users
  SET analyses_this_month = (
    SELECT COUNT(*) 
    FROM public.analyses 
    WHERE user_id = target_user_id 
    AND created_at >= date_trunc('month', NOW())
  )
  WHERE id = target_user_id;
  
  -- Delete the source user (cascade will clean up any remaining records)
  DELETE FROM public.users WHERE id = source_user_id;
  
  RAISE NOTICE 'Successfully merged user % into %', source_user_id, target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 3. ADD FUNCTION TO LINK INTEGRATION TO USER BY EMAIL
-- ============================================
-- This function is used during OAuth callback to link installations to existing accounts
CREATE OR REPLACE FUNCTION link_integration_by_email(
  p_email TEXT,
  p_provider TEXT,
  p_account_id TEXT,
  p_account_name TEXT,
  p_account_avatar TEXT DEFAULT NULL,
  p_access_token TEXT DEFAULT NULL,
  p_refresh_token TEXT DEFAULT NULL,
  p_token_expires_at TIMESTAMPTZ DEFAULT NULL,
  p_scopes TEXT[] DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_user_id UUID;
  v_integration_id UUID;
BEGIN
  -- Find user by email
  SELECT id INTO v_user_id
  FROM public.users
  WHERE email = p_email
  LIMIT 1;
  
  -- If user doesn't exist, return NULL (let the calling code handle user creation)
  IF v_user_id IS NULL THEN
    RETURN NULL;
  END IF;
  
  -- Insert or update integration
  INSERT INTO public.integrations (
    user_id,
    provider,
    account_id,
    account_name,
    account_avatar,
    access_token,
    refresh_token,
    token_expires_at,
    scopes,
    updated_at
  ) VALUES (
    v_user_id,
    p_provider,
    p_account_id,
    p_account_name,
    p_account_avatar,
    p_access_token,
    p_refresh_token,
    p_token_expires_at,
    p_scopes,
    NOW()
  )
  ON CONFLICT (provider, account_id) 
  DO UPDATE SET
    user_id = v_user_id,
    account_name = EXCLUDED.account_name,
    account_avatar = EXCLUDED.account_avatar,
    access_token = COALESCE(EXCLUDED.access_token, integrations.access_token),
    refresh_token = COALESCE(EXCLUDED.refresh_token, integrations.refresh_token),
    token_expires_at = COALESCE(EXCLUDED.token_expires_at, integrations.token_expires_at),
    scopes = COALESCE(EXCLUDED.scopes, integrations.scopes),
    updated_at = NOW()
  RETURNING id INTO v_integration_id;
  
  RETURN v_integration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 4. ADD COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON INDEX idx_unique_provider_account IS 
  'Ensures one GitHub/Jira/etc installation can only be linked to one FirstQA account. Prevents duplicate installations.';

COMMENT ON FUNCTION merge_user_accounts IS 
  'Admin function to merge duplicate user accounts. Moves all integrations and analyses from source to target, then deletes source.';

COMMENT ON FUNCTION link_integration_by_email IS 
  'Links a provider integration (GitHub, Jira, etc.) to a user by email. Used during OAuth to enable account linking.';

-- ============================================
-- 5. VERIFY CONSTRAINTS
-- ============================================
-- Check for any existing duplicate integrations
DO $$
DECLARE
  duplicate_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT provider, account_id, COUNT(*) as cnt
    FROM public.integrations
    GROUP BY provider, account_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  IF duplicate_count > 0 THEN
    RAISE WARNING 'Found % duplicate integrations. Run cleanup script to fix.', duplicate_count;
  ELSE
    RAISE NOTICE 'No duplicate integrations found. All good!';
  END IF;
END $$;
