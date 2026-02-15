-- Fix: Drop the global (provider, account_id) unique index.
-- This index allows only ONE user across the entire platform to own a given 
-- GitHub installation, which causes cross-user installation theft during 
-- upsert operations (e.g., user A logs in and steals user B's installations).
--
-- The original (user_id, provider, account_id) constraint from migration 001 
-- is sufficient — it prevents the same user from having duplicate entries 
-- while allowing multiple users to reference the same installation.

DROP INDEX IF EXISTS idx_unique_provider_account;
