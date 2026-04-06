# FirstQA Architecture

> Technical architecture documentation for the FirstQA platform.

---

## What FirstQA Does

FirstQA is an **AI-powered QA Engineer** that acts as a startup's first QA hire. It covers QA end-to-end:

| Capability | Description |
|------------|-------------|
| **PR Analysis** | AI analysis of diffs — bugs, risks, edge cases, UI/UX issues |
| **Ticket Analysis** | Reviews Linear/Jira tickets for gaps before coding starts |
| **Test Recipe** | Generates prioritized test scenarios with steps and expected results |
| **Browser Test Execution** | AI agent runs tests in real Chromium via Stagehand + Browserbase |
| **Playwright Test Code** | Generates downloadable spec files with accurate selectors |
| **Test Reports** | Pass/fail results with screenshots and video posted on the PR |
| **On-demand Human QA** | Senior QA engineers available for exploratory and manual testing |

**Entry points:**
- **GitHub**: `/qa` in PR comments, or automatic on PR open/update
- **Linear**: `/qa` via Linear webhooks or Chrome extension for ticket analysis
- **Jira**: `/qa` in ticket comments (Atlassian Connect)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js, Express |
| **Frontend** | EJS templates |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth, GitHub OAuth, Linear OAuth, Jira OAuth |
| **AI — Analysis** | Anthropic Claude Sonnet (primary), OpenAI GPT-4o (fallback) |
| **AI — Test Execution** | Anthropic Claude Haiku via Stagehand agent mode |
| **AI — Scoring** | Anthropic Claude Sonnet (executability scoring, verification) |
| **Browser Automation** | Stagehand (`@browserbasehq/stagehand`) + Playwright |
| **Cloud Browsers** | Browserbase (session replay, screenshots, video) |
| **Integrations** | GitHub App, Linear API, Jira (Atlassian Connect) |
| **Payments** | Stripe |
| **Email** | Nodemailer |
| **Deployment** | Render |

---

## How the System Works

### 1. Authentication

- **Supabase Auth** for signup/login (email + password, optional OAuth)
- **GitHub App** for repo access; installation linked to the user in `integrations`
- **Linear OAuth** for Linear workspace access
- **Jira OAuth** for Jira Cloud (or Atlassian Connect for Jira Data Center/Server)

Auth flow:
1. User signs up/logs in via Supabase Auth.
2. User connects GitHub via `/github/install-redirect`.
3. GitHub App installation is stored in `integrations` with `user_id`.
4. Linear/Jira are connected from the dashboard and stored in `integrations`.

### 2. Integrations

| Integration | Type | Purpose |
|-------------|------|---------|
| **GitHub App** | App installation | PR webhooks, `/qa` comments, Checks API |
| **Linear** | OAuth + webhooks | Ticket analysis via Chrome extension or webhooks |
| **Jira** | OAuth or Atlassian Connect | Ticket analysis, webhook for `/qa` |

### 3. AI Pipeline

1. **Trigger**: `/qa` in GitHub PR comment, or automatic on PR open/update, or from Linear/Jira
2. **Data**: PR/ticket content, diff, commits, file contents, optional product knowledge from Supabase
3. **Analysis**: `backend/ai/openaiClient.js` calls Anthropic Claude Sonnet — ship score, bugs, test recipe, Playwright code
4. **Output**: Markdown comment posted back on the PR (GitHub) or shown in extension (Linear)

Product knowledge (optional):
- Codebase indexed into `product_knowledge` in Supabase
- `contextRetriever.js` fetches relevant context for prompts
- `codebaseAnalyzer.js` and `prKnowledgeSync.js` handle indexing

### 4. Automated Test Execution

- **Trigger**: `/qa testrun` in PR comment (with optional `-env=URL` and `-context cookie:name=value`)
- **Flow**: `automatedTestOrchestrator.js` → `testExecutor.js` (Stagehand agent mode)
- **Agent**: Stagehand's `agent.execute()` with Anthropic Claude Haiku drives each scenario autonomously
- **Auth**: Cookie injection via `-context` parameter, or deterministic login with configured credentials
- **Infrastructure**: Browserbase cloud browsers with session replay, screenshots, and video
- **Output**: GitHub PR comment with pass/fail results, screenshot links, video links per scenario

---

## Project Structure

```
FirstQA/
├── webhook-server.js       # Express app, route mounting, static files
├── .env.example            # Env template
│
├── backend/
│   ├── routes/             # Express routers
│   │   ├── auth.js         # Login, signup, logout, OAuth callbacks
│   │   ├── dashboard.js    # Dashboard, integrations, settings
│   │   ├── github.js       # Webhooks, install redirect
│   │   ├── jira.js         # Jira OAuth
│   │   ├── jiraConnect.js  # Jira Atlassian Connect lifecycle
│   │   ├── linear.js       # Linear OAuth
│   │   ├── linearConnect.js# Linear Connect webhooks
│   │   ├── onboarding.js   # Onboarding flow
│   │   ├── knowledge.js    # Product knowledge API
│   │   ├── docs.js         # Documentation page
│   │   ├── hire.js         # Human QA request page
│   │   └── stripe.js       # Billing and subscription
│   ├── services/           # Business logic
│   │   ├── automatedTestOrchestrator.js  # Test execution orchestration
│   │   ├── testReportFormatter.js        # PR comment report formatting
│   │   ├── githubChecksService.js        # GitHub Checks API
│   │   └── knowledgeBase/                # Codebase indexing, retrieval
│   │       ├── codebaseAnalyzer.js
│   │       ├── contextRetriever.js
│   │       ├── firstTimeIndexTrigger.js
│   │       └── prKnowledgeSync.js
│   ├── utils/              # Shared utilities
│   │   ├── githubService.js    # Webhook handling, PR analysis, /qa command parsing
│   │   ├── githubAppAuth.js    # GitHub App JWT, installation tokens
│   │   ├── jiraService.js
│   │   └── linearConnectService.js
│   ├── lib/
│   │   └── supabase.js     # Supabase client (anon + admin)
│   └── ai/
│       ├── openaiClient.js       # QA analysis orchestration (calls Anthropic/OpenAI)
│       ├── anthropicClient.js    # Anthropic Claude SDK wrapper
│       ├── testExecutor.js       # Stagehand agent test execution
│       ├── executabilityScorer.js# Scenario executability scoring
│       ├── playwrightGenerator.js# Playwright spec file generation
│       └── prompts/              # EJS templates for AI prompts
│
├── frontend/
│   ├── views/              # EJS templates
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── onboarding/
│   │   ├── landing.ejs
│   │   ├── docs.ejs
│   │   ├── hire.ejs
│   │   └── ...
│   └── public/             # CSS, images, logos
│
├── docs/
├── supabase/migrations/    # SQL migrations
└── data/                   # Runtime JSON (subscribers, customers)
```

---

## Main File & Folder Purposes

| Path | Purpose |
|------|---------|
| `webhook-server.js` | Express entry, CORS, session, static files, route mounting |
| `backend/utils/githubService.js` | Webhook processing, `/qa` handling, PR fetching, AI calls |
| `backend/ai/openaiClient.js` | Analysis orchestration — calls Anthropic Claude for QA insights |
| `backend/ai/testExecutor.js` | Stagehand agent test execution with cookie injection and auto-login |
| `backend/ai/executabilityScorer.js` | Scores scenarios for browser testability |
| `backend/ai/playwrightGenerator.js` | Generates downloadable Playwright spec files |
| `backend/lib/supabase.js` | Supabase client, auth, DB access |
| `backend/utils/githubAppAuth.js` | GitHub App JWT, installation Octokit |

---

## Database (Supabase)

Main tables:
- **users** — Profiles, plan, usage limits
- **integrations** — GitHub, Linear, Jira connections per user
- **analyses** — Analysis history (bugs, test recipes, ship scores)
- **client_settings** — Per-user config (staging URL, test credentials)
- **product_knowledge** — Indexed codebase chunks
- **jira_connect_installations** / **linear_connect_installations** — App installations

Migrations live in `supabase/migrations/`.

---

## How to Run Locally

### Prerequisites

- Node.js 18+
- npm
- Supabase project
- Anthropic API key (primary AI provider)
- GitHub App (for PR analysis)

### Steps

1. **Clone and install**
   ```bash
   git clone https://github.com/ovidon83/firstqa.git
   cd firstqa
   npm install
   ```

2. **Environment**
   ```bash
   cp .env.example .env
   # Edit .env with your keys
   ```
   Minimum: `SESSION_SECRET`, `ANTHROPIC_API_KEY`, `SUPABASE_*`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`.

3. **Run**
   ```bash
   npm start
   # or: npm run dev  (with nodemon)
   ```

4. **URLs**
   - App: http://localhost:3000
   - Health: http://localhost:3000/github/health
   - Dashboard: http://localhost:3000/dashboard

5. **Local webhooks (optional)**
   Use smee.io or `npm run webhook` with `WEBHOOK_PROXY_URL` in `.env` to forward webhooks to localhost.

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `node webhook-server.js` | Run server |
| `dev` | `nodemon webhook-server.js` | Run with auto-reload |
| `webhook` | `node backend/utils/fixed-webhook.js` | Smee webhook proxy |
