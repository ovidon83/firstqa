# User Tracking & History Implementation

## ✅ What Was Built

### 1. **Link Webhooks to User Accounts** 
- Extract `installation_id` from GitHub webhooks
- Look up `user_id` from `integrations` table
- Pass `user_id` through entire analysis flow
- All analyses are now attributed to specific users

### 2. **Save Analyses to Database**
- Every analysis saved to `analyses` table with:
  - User ID
  - Provider (github/bitbucket/jira)
  - Repository & PR details
  - Analysis type (full/short)
  - Full AI output (raw + formatted)
  - Timestamps
- Auto-increment user's monthly count
- PostgreSQL function: `increment_user_analyses_count()`

### 3. **Enforce Usage Limits**
- Check limits before processing analysis
- **Free tier**: 10 analyses/month
- **Pro/Enterprise**: Unlimited
- Post friendly upgrade message when limit reached
- Fail-open strategy (allow on error)

### 4. **Dashboard History Page** (`/dashboard/history`)
- List all user's analyses (last 50)
- Shows:
  - PR title with GitHub link
  - Repository & PR number
  - Analysis type badge (full/short)
  - Timestamps
- Empty state when no analyses

### 5. **Dashboard Overview** (`/dashboard`)
- Real-time stats:
  - Analyses this month with limit progress
  - Connected integrations count
  - Current plan (free/pro/enterprise)
- Recent 5 analyses preview
- Smart empty states:
  - No integrations → CTA to connect
  - Has integrations but no analyses → Instructions to use `/qa`
  - Has analyses → Show recent activity

---

## 🗄️ Database Migrations Required

You need to run these SQL migrations in Supabase:

### Migration 003: Add Increment Function

```sql
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

-- Grant execute permission
GRANT EXECUTE ON FUNCTION increment_user_analyses_count(UUID) TO authenticated;
```

**Run this in**: Supabase Dashboard → SQL Editor

---

## 🧪 Testing Checklist

### Test 1: GitHub Webhook Integration
1. Comment `/qa` on a PR in a connected repo
2. Check Render logs for: `✅ Found user_id: [uuid] for installation: [id]`
3. Verify analysis completes
4. Check `/dashboard/history` - analysis should appear
5. Check `/dashboard` - stats should increment

### Test 2: Usage Limits (Free Tier)
1. Set your user's `analyses_this_month` to 9 in Supabase
2. Comment `/qa` on a PR → should work
3. Set it to 10
4. Comment `/qa` again → should get limit message

### Test 3: Dashboard Pages
1. Visit `/dashboard` → should show real stats
2. Visit `/dashboard/history` → should list analyses
3. Click PR links → should open GitHub
4. Visit `/dashboard/integrations` → should show connected integrations

---

## 📊 Database Queries for Debugging

### Check if analysis was saved:
```sql
SELECT * FROM analyses 
WHERE user_id = '[your-user-id]' 
ORDER BY created_at DESC 
LIMIT 5;
```

### Check user's analysis count:
```sql
SELECT 
  email, 
  plan, 
  analyses_this_month, 
  analyses_limit 
FROM users 
WHERE id = '[your-user-id]';
```

### Check webhook → user mapping:
```sql
SELECT 
  u.email,
  i.provider,
  i.account_id,
  i.account_name
FROM integrations i
JOIN users u ON u.id = i.user_id
WHERE u.email = 'your@email.com';
```

---

## 🚀 Deployment Steps

1. **Run Database Migrations** (in Supabase)
   - Migration 003: `increment_user_analyses_count()` function

2. **Merge to Main & Deploy**
   ```bash
   git checkout main
   git merge feature/user-tracking-and-history
   git push origin main
   ```

3. **Verify in Production**
   - Comment `/qa` on a test PR
   - Check Render logs for user tracking
   - Visit dashboard to see stats

---

## 🎯 What's Next?

### Option A: Automated Test Execution ⭐ **RECOMMENDED**
- Build local agent CLI
- Run actual tests (Playwright)
- Post video results to PR
- **This is the killer feature**

### Option B: Linear Integration
- Add Linear OAuth
- Analyze Linear tickets
- Complete ticket analysis story

### Option C: Polish & Growth
- Email notifications
- Slack integration
- Analytics dashboard
- Marketing site updates
