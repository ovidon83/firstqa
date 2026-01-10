-- CRITICAL FIX: Ensure users are created in public.users when they sign up
-- Run this in Supabase SQL Editor

-- Step 1: Create any missing user records for existing auth users
INSERT INTO public.users (id, email, full_name, avatar_url, created_at, updated_at, plan, analyses_this_month, analyses_limit)
SELECT 
  au.id,
  au.email,
  COALESCE(au.raw_user_meta_data->>'full_name', au.raw_user_meta_data->>'name'),
  au.raw_user_meta_data->>'avatar_url',
  au.created_at,
  NOW(),
  'free',
  0,
  10
FROM auth.users au
LEFT JOIN public.users pu ON au.id = pu.id
WHERE pu.id IS NULL;

-- Step 2: Verify trigger function exists and is correct
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name'),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
EXCEPTION
  WHEN unique_violation THEN
    -- User already exists, that's fine
    RETURN NEW;
  WHEN OTHERS THEN
    -- Log error but don't fail the auth signup
    RAISE WARNING 'Failed to create user profile: %', SQLERRM;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 3: Ensure trigger exists
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Step 4: Verify it worked
SELECT COUNT(*) as auth_users FROM auth.users;
SELECT COUNT(*) as public_users FROM public.users;
-- These numbers should match after running step 1
