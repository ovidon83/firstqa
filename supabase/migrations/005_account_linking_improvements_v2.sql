-- PRODUCTION FIX: Account Linking Improvements (Version 2)
-- This migration handles existing duplicates before creating constraints

-- ============================================
-- STEP 1: CLEAN UP DUPLICATE INTEGRATIONS
-- ============================================
-- Find and remove duplicate integrations, keeping only the oldest one

DO $$
DECLARE
  duplicate_record RECORD;
  rows_deleted INTEGER := 0;
BEGIN
  RAISE NOTICE 'Step 1: Cleaning up duplicate integrations...';
  
  -- For each duplicate (provider, account_id) combination
  FOR duplicate_record IN
    SELECT provider, account_id, COUNT(*) as duplicate_count
    FROM public.integrations
    GROUP BY provider, account_id
    HAVING COUNT(*) > 1
  LOOP
    RAISE NOTICE 'Found % duplicate(s) for provider=%, account_id=%', 
      duplicate_record.duplicate_count, 
      duplicate_record.provider, 
      duplicate_record.account_id;
    
    -- Delete all but the oldest integration (keep the one created first)
    WITH ranked_integrations AS (
      SELECT id, created_at,
        ROW_NUMBER() OVER (ORDER BY created_at ASC) as rn
      FROM public.integrations
      WHERE provider = duplicate_record.provider
        AND account_id = duplicate_record.account_id
    )
    DELETE FROM public.integrations
    WHERE id IN (
      SELECT id FROM ranked_integrations WHERE rn > 1
    );
    
    GET DIAGNOSTICS rows_deleted = ROW_COUNT;
    RAISE NOTICE 'Deleted % duplicate integration(s)', rows_deleted;
  END LOOP;
  
  RAISE NOTICE 'Step 1 complete: Duplicate integrations cleaned up';
END $$;

-- ============================================
-- STEP 2: ADD UNIQUE CONSTRAINT
-- ============================================
-- Now that duplicates are removed, create the unique index

DO $$
BEGIN
  RAISE NOTICE 'Step 2: Creating unique index...';
  
  -- Drop the old constraint if it exists
  DROP INDEX IF EXISTS idx_unique_provider_account;
  
  -- Create new unique index
  CREATE UNIQUE INDEX idx_unique_provider_account 
  ON public.integrations(provider, account_id);
  
  RAISE NOTICE 'Step 2 complete: Unique index created';
END $$;

-- ============================================
-- STEP 3: ADD HELPER FUNCTION TO MERGE ACCOUNTS
-- ============================================
-- This function is called manually by admins to merge duplicate accounts
CREATE OR REPLACE FUNCTION merge_user_accounts(
  source_user_id UUID,
  target_user_id UUID
)
RETURNS VOID AS $$
BEGIN
  -- Move integrations from source to target
  -- Use UPDATE, and the unique constraint will prevent duplicates
  UPDATE public.integrations
  SET user_id = target_user_id
  WHERE user_id = source_user_id;
  
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
EXCEPTION
  WHEN unique_violation THEN
    -- If there are duplicate integrations, delete from source and keep target's
    DELETE FROM public.integrations WHERE user_id = source_user_id;
    -- Still move analyses
    UPDATE public.analyses SET user_id = target_user_id WHERE user_id = source_user_id;
    -- Delete source user
    DELETE FROM public.users WHERE id = source_user_id;
    RAISE NOTICE 'Merged user % into % (with duplicate handling)', source_user_id, target_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 4: ADD FUNCTION TO LINK INTEGRATION TO USER BY EMAIL
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
EXCEPTION
  WHEN unique_violation THEN
    -- If unique constraint still violated (race condition), just update
    UPDATE public.integrations
    SET user_id = v_user_id,
        account_name = p_account_name,
        account_avatar = p_account_avatar,
        updated_at = NOW()
    WHERE provider = p_provider AND account_id = p_account_id
    RETURNING id INTO v_integration_id;
    
    RETURN v_integration_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- STEP 5: ADD COMMENTS FOR DOCUMENTATION
-- ============================================
COMMENT ON INDEX idx_unique_provider_account IS 
  'Ensures one GitHub/Jira/etc installation can only be linked to one FirstQA account. Prevents duplicate installations.';

COMMENT ON FUNCTION merge_user_accounts IS 
  'Admin function to merge duplicate user accounts. Moves all integrations and analyses from source to target, then deletes source.';

COMMENT ON FUNCTION link_integration_by_email IS 
  'Links a provider integration (GitHub, Jira, etc.) to a user by email. Used during OAuth to enable account linking.';

-- ============================================
-- FINAL VERIFICATION
-- ============================================
DO $$
DECLARE
  duplicate_count INTEGER;
  total_integrations INTEGER;
BEGIN
  -- Check for any remaining duplicate integrations
  SELECT COUNT(*) INTO duplicate_count
  FROM (
    SELECT provider, account_id, COUNT(*) as cnt
    FROM public.integrations
    GROUP BY provider, account_id
    HAVING COUNT(*) > 1
  ) duplicates;
  
  SELECT COUNT(*) INTO total_integrations
  FROM public.integrations;
  
  IF duplicate_count > 0 THEN
    RAISE WARNING 'Still found % duplicate integrations after cleanup!', duplicate_count;
  ELSE
    RAISE NOTICE '✅ Migration complete! Total integrations: %. No duplicates found.', total_integrations;
  END IF;
END $$;
