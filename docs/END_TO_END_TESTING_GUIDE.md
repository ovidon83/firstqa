# FirstQA — End-to-End Testing Guide

Test the full product as a new client would experience it.

---

## Prerequisites

You need the following before you start:

| Item | Where to get it |
|------|----------------|
| GitHub account | https://github.com/signup |
| A GitHub repo with at least one open PR | Create a test repo or use an existing one |
| Linear account *(optional)* | https://linear.app/signup |
| Modern browser (Chrome recommended) | — |

---

## Step 1 — Sign Up

1. Go to **https://www.firstqa.dev/signup**
2. Enter your email and a password
3. Check your inbox for a confirmation email and click the link
4. You'll be redirected back to FirstQA and logged in

**Alternative:** Click "Continue with GitHub" on the signup page to use GitHub OAuth instead.

---

## Step 2 — Complete Onboarding

After signup you're redirected to the onboarding flow. Follow each step:

1. **Workspace** — Confirm your workspace name
2. **Trial** — Acknowledge your free trial
3. **Tools** — Connect at least GitHub (required). Linear/Jira are optional
4. **Staging URL** — Enter your app's staging/production URL (e.g. `https://staging.myapp.com`). This is used for automated test execution later
5. **Indexing** — Optional codebase indexing for deeper analysis
6. **First Review** — Complete the onboarding

---

## Step 3 — Connect GitHub

This is the most important step. If you didn't do it during onboarding:

1. Go to **Dashboard → Integrations** (`/dashboard/integrations`)
2. Click **Connect GitHub**
3. You'll be redirected to GitHub to install the **FirstQA GitHub App**
4. Choose which repos to grant access to (select "All repositories" or pick specific ones)
5. Click **Install**
6. You'll be redirected back to FirstQA — the integration should show as connected

**What this does:**
- Installs the GitHub App on your account/org
- Enables webhook delivery (PR events, comments) to FirstQA
- Allows FirstQA to read PR diffs and post analysis comments

---

## Step 4 — Run Your First PR Analysis

1. Open any PR in a repo where the GitHub App is installed
2. Add a comment with just: `/qa`
3. Wait ~30–60 seconds
4. FirstQA posts a detailed analysis comment on the PR containing:
   - **Summary** with Ship Score and risk level
   - **Bugs & Risks** found in the code changes
   - **Test Recipe** — prioritized test scenarios
   - **Questions** for the PR author

**Tips:**
- The PR must have actual code changes (not just docs/config)
- You can re-run analysis by commenting `/qa` again (e.g. after pushing new commits)
- Check your usage at `/dashboard` — free tier has a monthly limit

---

## Step 5 — Run Automated Test Execution

After a `/qa` analysis has been posted (it generates the test recipe), you can run automated browser tests:

1. On the same PR, add a comment: `/qa testrun`
2. FirstQA will:
   - Score each test scenario for browser-executability
   - Launch a cloud browser (via Browserbase)
   - Execute the feasible scenarios step by step
   - Post a test execution report with pass/fail results, screenshots, and video recordings

**Specifying a different URL:**

```
/qa testrun -env=https://staging.myapp.com
```

If you don't pass `-env`, it uses the staging URL from your settings.

**What you'll see in the report:**
- Pass/fail status per scenario
- Duration per test
- Screenshot + video links (Browserbase session recordings)
- Failed test details with expected vs actual
- Scenarios marked for manual testing (if not browser-automatable)

---

## Step 6 — Connect Linear *(Optional)*

1. Go to **Dashboard → Integrations** (`/dashboard/integrations`)
2. Click **Connect Linear**
3. Choose one of:
   - **OAuth:** Redirects to Linear for authorization
   - **API Key:** Paste a Linear API key directly
4. Once connected, you can trigger `/qa` analysis from Linear issue comments

---

## Step 7 — Configure Settings

Go to **Dashboard → Settings** (`/dashboard/settings`) to configure:

| Setting | What it does |
|---------|-------------|
| **Staging URL** | Default URL for `/qa testrun` execution |
| **Auto-analyze PRs** | Automatically run analysis when PRs are opened (no `/qa` needed) |
| **Post-merge tests** | Run tests automatically after a PR is merged |

---

## Quick Test Checklist

Use this to verify everything works end-to-end:

- [ ] **Signup** — Create account, confirm email, land on onboarding
- [ ] **Onboarding** — Complete all steps, reach the dashboard
- [ ] **GitHub connect** — Install the App, see it as "Connected" on integrations page
- [ ] **Dashboard** — See your connected repos and usage stats
- [ ] **PR Analysis** — Comment `/qa` on a PR, receive analysis comment within ~60s
- [ ] **Analysis quality** — Check that the summary, bugs, test recipe, and questions make sense for the actual code changes
- [ ] **Test execution** — Comment `/qa testrun` (or `/qa testrun -env=<url>`), receive test report with results
- [ ] **Test artifacts** — Click screenshot (IMG) and video links in the report, confirm they load
- [ ] **Settings** — Update staging URL, verify it persists
- [ ] **Linear** *(optional)* — Connect Linear, trigger `/qa` from an issue comment
- [ ] **Hire page** — Visit `/hire`, submit the form, confirm the success screen appears

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `/qa` comment gets no response | Check that the GitHub App is installed on that repo. Visit Dashboard → Integrations |
| Analysis shows "Unable to analyze" or data access error | Re-install the GitHub App. The installation token may have expired or permissions changed |
| `/qa testrun` says "No test recipe found" | Run `/qa` first to generate the analysis, then retry `/qa testrun` |
| Test execution shows all failures | Confirm your staging URL is reachable and the app is running. Check the video recordings for clues |
| Screenshots/videos don't load | Browserbase session may have expired. Re-run the test |
| "Usage limit reached" | Free tier has a monthly cap. Upgrade your plan or wait for the reset |
