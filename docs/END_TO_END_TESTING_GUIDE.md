# End-to-End Testing Guide

A practical guide for setting up and testing the full FirstQA flow from scratch — as if you were a new user.

---

## Part 1 — Prerequisites Setup

### 1.1 Create a Test GitHub Account

You need a second GitHub account to simulate a real user. Your primary account (`ovidon83`) owns the GitHub App, so it cannot install the app on itself as a "client."

1. Go to [github.com/signup](https://github.com/signup)
2. Use a secondary email (e.g. `yourname+test@gmail.com`)
3. Pick a recognizable username (e.g. `firstqa-tester`)
4. Verify the email

### 1.2 Create a Test GitHub Organization

An org isolates the app installation and keeps your personal repos clean.

1. Log in as the test account
2. Go to **Settings > Organizations > New organization**
3. Choose the **Free** plan
4. Name: `firstqa-test-org` (or similar)

### 1.3 Create a Test Repository

You need a repo with a simple web app so test execution has something to run against.

```bash
# On your local machine, logged in as the test account
mkdir test-webapp && cd test-webapp
git init
```

Create a minimal `index.html`:

```html
<!DOCTYPE html>
<html>
<head><title>Test App</title></head>
<body>
  <h1>Welcome</h1>
  <form id="contact">
    <label for="name">Name</label>
    <input id="name" name="name" required />
    <label for="email">Email</label>
    <input id="email" name="email" type="email" required />
    <button type="submit">Submit</button>
  </form>
</body>
</html>
```

```bash
git add . && git commit -m "initial commit"
gh repo create firstqa-test-org/test-webapp --public --source=. --push
```

### 1.4 Install the GitHub App on the Test Org

1. Go to: `https://github.com/apps/oviai-by-firstqa/installations/new`
2. Select the **test organization** (e.g. `firstqa-test-org`)
3. Choose **"All repositories"** or select `test-webapp`
4. Click **Install**

This triggers the `installation.created` webhook on production.

### 1.5 Environment Variables

These are the variables required for a working production or local setup. See `.env.example` for the full list.

**Required for core functionality:**

| Variable | How to get it |
|----------|---------------|
| `SUPABASE_URL` | Supabase project dashboard > Settings > API |
| `SUPABASE_ANON_KEY` | Same location |
| `SUPABASE_SERVICE_KEY` | Same location (service_role key) |
| `OPENAI_API_KEY` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `GITHUB_APP_ID` | GitHub > Settings > Developer settings > GitHub Apps > oviai-by-firstqa |
| `GITHUB_PRIVATE_KEY` | Download from the same page (PEM format) |
| `GITHUB_WEBHOOK_SECRET` | Set when creating the app |
| `GITHUB_CLIENT_ID` | Same app page, OAuth section |
| `GITHUB_CLIENT_SECRET` | Same app page, OAuth section |
| `SESSION_SECRET` | Any random string (`openssl rand -hex 32`) |

**Required for test execution:**

| Variable | How to get it |
|----------|---------------|
| `BROWSERBASE_API_KEY` | [browserbase.com](https://www.browserbase.com) > Settings > API Keys |
| `BROWSERBASE_PROJECT_ID` | Browserbase dashboard > Project ID |

**Optional (for integrations):**

| Variable | Used for |
|----------|----------|
| `LINEAR_CLIENT_ID` / `LINEAR_CLIENT_SECRET` | Linear integration |
| `JIRA_CLIENT_ID` / `JIRA_CLIENT_SECRET` | Jira integration |
| `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` | Email notifications (`/hire` form) |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` | Billing (not needed for MVP testing) |

### 1.6 Local Development (Optional)

If testing locally instead of against production:

```bash
git clone https://github.com/ovidon83/firstqa.git
cd firstqa
npm install
cp .env.example .env
# Fill in .env with real values

npm run dev
```

For webhooks to reach localhost, use [smee.io](https://smee.io):

1. Go to `https://smee.io/new` — copy the URL
2. Set `WEBHOOK_PROXY_URL` in `.env` to that URL
3. Update the GitHub App webhook URL to the smee URL
4. Run: `npx smee -u https://smee.io/YOUR_CHANNEL -t http://localhost:3000/github/webhook`

---

## Part 2 — Test Flow (Step by Step)

### 2.1 Sign Up

1. Go to `https://www.firstqa.dev/signup` (or `localhost:3000/signup`)
2. Enter:
   - Full name: `Test User`
   - Email: the test account's email
   - Password: any strong password
3. Click **Sign Up**
4. Check email for confirmation (if email confirmation is enabled in Supabase)
5. You should be redirected to `/onboarding/workspace`

**Alternative:** Click "Continue with GitHub" on the signup page to use GitHub OAuth.

### 2.2 Complete Onboarding

#### Step 1 — Workspace (`/onboarding/workspace`)

- Company name: `Test Company`
- Team size: `1-5`
- Quality goals: `Catch bugs before production`
- Click **Continue**

#### Step 2 — Trial (`/onboarding/trial`)

- Click **Start Free Trial**
- This sets `trial_started_at` and `trial_ends_at` (5 days)

#### Step 3 — Tools (`/onboarding/tools`)

- You should see the GitHub App as **Connected** (from step 1.4)
- If not connected, click **Connect GitHub** and install the app
- Click **Continue** (requires at least one GitHub integration)

#### Step 4 — Staging (`/onboarding/staging`)

- Enter a staging URL (e.g. `https://www.firstqa.dev`) or click **Skip**
- Click **Continue**

#### Step 5 — Indexing (`/onboarding/indexing`)

- Select repositories to index (or let it auto-index)
- Wait for indexing to complete (poll status shown on page)
- Click **Continue**

#### Step 6 — First Review (`/onboarding/first-review`)

- Shows open PRs from connected repos
- Click **Complete Setup**
- Redirected to `/dashboard?onboarding=complete`

### 2.3 Create a PR in the Test Repo

```bash
cd test-webapp
git checkout -b test-feature
```

Make a small change (e.g. add a paragraph to `index.html`):

```html
<p>This is a new feature added for testing.</p>
```

```bash
git add . && git commit -m "feat: add test paragraph"
git push -u origin test-feature
gh pr create --title "Add test paragraph" --body "Testing FirstQA analysis"
```

### 2.4 Trigger QA Analysis

1. Go to the PR on GitHub
2. Post a comment: `/qa`
3. Wait 30-60 seconds
4. The bot (`oviai-by-firstqa[bot]`) posts a QA analysis comment with:
   - Summary and Ship Score
   - Bugs & Risks
   - Test Recipe (scenarios with steps)
   - Questions

**Verify:**
- Comment appears and is properly formatted
- Ship Score is reasonable for the change
- Test scenarios make sense for the diff
- No false positives in Bugs & Risks

### 2.5 Trigger Test Execution

Post another comment on the same PR:

```
/qa testrun -env=https://www.firstqa.dev
```

This runs automated browser tests against the specified URL using the test recipe from the analysis.

**Verify:**
- Bot posts an acknowledgment comment
- After 1-3 minutes, bot posts a test execution report with:
  - Pass/Fail status per scenario
  - Screenshot and video evidence links
  - Manual testing section (for scenarios that couldn't be automated)
- GitHub Check Run is created (if SHA is available)

### 2.6 Check Dashboard Pages

Log in to `https://www.firstqa.dev/dashboard` and verify:

| Page | URL | What to check |
|------|-----|---------------|
| Dashboard Home | `/dashboard` | Usage count updated, recent analysis shows |
| Integrations | `/dashboard/integrations` | GitHub shows connected |
| History | `/dashboard/history` | Analysis from step 2.4 appears, filters work |
| Settings | `/dashboard/settings` | Staging URL saved from onboarding, settings save correctly |

### 2.7 Test the Hire Page

1. Go to `https://www.firstqa.dev/hire`
2. Fill in:
   - Name: `Test User`
   - Email: `test@example.com`
   - Project description: `Test project`
3. Submit the form
4. Verify success message appears (or error if SMTP is not configured)

**Also test validation:**
- Submit with empty name — should show error
- Submit with invalid email — should show error

### 2.8 Test Additional Flows

| Flow | How to test |
|------|-------------|
| `/short` command | Comment `/short` on the PR — should produce a shorter analysis |
| Password reset | Go to `/forgot-password`, enter test email, follow email link to `/auth/reset-password` |
| GitHub OAuth | Log out, log back in with "Continue with GitHub" |
| Linear integration | Dashboard > Integrations > Add Linear API key |

---

## Part 3 — Quick Re-test Checklist

Use this after major code changes. Skip the setup steps that are already done.

### What You Can Skip

- Account creation (test account already exists)
- GitHub App installation (already installed on test org)
- Onboarding (already completed)

### How to Reset State

**Reset analysis count (to re-test usage limits):**

```sql
-- In Supabase SQL Editor
DELETE FROM analyses WHERE user_id = 'YOUR_TEST_USER_ID';
```

**Re-run onboarding (to test onboarding flow changes):**

```sql
UPDATE users
SET onboarding_step = 1,
    onboarding_completed_at = NULL
WHERE id = 'YOUR_TEST_USER_ID';
```

**Reset trial (to test trial flow):**

```sql
UPDATE users
SET trial_started_at = NULL,
    trial_ends_at = NULL
WHERE id = 'YOUR_TEST_USER_ID';
```

**Clear client settings:**

```sql
DELETE FROM client_settings WHERE user_id = 'YOUR_TEST_USER_ID';
```

### How to Trigger a Fresh Analysis on an Existing PR

Simply comment `/qa` again on the PR. The system re-analyzes the full diff fresh each time.

### Quick Smoke Test Sequence

After deploying a major change, run through this minimal checklist:

1. [ ] Go to `/dashboard` — page loads, no errors
2. [ ] Go to `/dashboard/settings` — settings load
3. [ ] Go to `/dashboard/history` — history loads
4. [ ] Comment `/qa` on a test PR — analysis posts correctly
5. [ ] Comment `/qa testrun -env=https://www.firstqa.dev` — test execution runs
6. [ ] Go to `/hire` — page loads, form validation works
7. [ ] Go to `/signup` — page loads (don't submit if account exists)
8. [ ] Go to `/login` — login works with test credentials

### Finding Your Test User ID

```sql
SELECT id, email, onboarding_step, trial_started_at
FROM users
WHERE email = 'your-test-email@example.com';
```

Or check the Supabase Auth dashboard under **Authentication > Users**.
