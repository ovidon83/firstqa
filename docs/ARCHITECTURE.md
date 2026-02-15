# FirstQA Architecture

> Technical architecture documentation for the FirstQA platform.

---

## What FirstQA Does

FirstQA is an **AI-powered QA Engineer** that acts as a startup’s first QA hire. It covers QA end-to-end:

| Capability | Description |
|------------|-------------|
| **Requirements & design analysis** | Understands tickets and PR context |
| **Test recipe creation** | Generates structured test scenarios from AI |
| **Test automation** | Runs Playwright tests from AI recipes |
| **Code review** | AI analysis of diffs, risks, and edge cases |
| **Manual-style execution** | Runs tests in the browser like a human tester |
| **Test results & release decision** | Shares results, Release Pulse, Go/No-Go |

**Entry points:**
- **GitHub**: `/qa` in PR comments
- **Jira**: `/qa` in ticket comments (Atlassian Connect)
- **Linear**: Chrome extension for ticket analysis
- **Bitbucket**: OAuth + webhooks (optional)

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Backend** | Node.js, Express |
| **Frontend** | EJS templates, Bootstrap 5 |
| **Database** | Supabase (PostgreSQL) |
| **Auth** | Supabase Auth, GitHub OAuth, Linear OAuth, Jira OAuth |
| **AI** | OpenAI GPT-4 (via `openai` package) |
| **Testing** | Playwright |
| **Integrations** | GitHub App, Linear API, Jira (Atlassian Connect) |
| **Payments** | Stripe |
| **Email** | Nodemailer |
| **HTTP** | Axios |

---

## How the System Works

### 1. Authentication

- **Supabase Auth** for signup/login (email + password, optional OAuth)
- **GitHub App** for repo access; installation linked to the user in `integrations`
- **Linear OAuth** for Linear workspace access
- **Jira OAuth** for Jira Cloud (or Atlassian Connect for Jira Data Center/Server)
- **Bitbucket OAuth** (optional)

Auth flow:
1. User signs up/logs in via Supabase Auth.
2. User connects GitHub via `/github/install-redirect`.
3. GitHub App installation is stored in `integrations` with `user_id`.
4. Linear/Jira are connected from the dashboard and stored in `integrations`.

### 2. Integrations

| Integration | Type | Purpose |
|-------------|------|---------|
| **GitHub App** | App installation | PR webhooks, `/qa` comments, Checks API |
| **Linear** | OAuth | Ticket analysis via Chrome extension |
| **Jira** | OAuth or Atlassian Connect | Ticket analysis, webhook for `/qa` |
| **Bitbucket** | OAuth | Optional PR/ticket analysis |

### 3. AI Pipeline

1. **Trigger**: `/qa` in GitHub PR, Jira ticket, or Linear ticket (via Chrome extension)
2. **Data**: PR/ticket content, diff, commits, optional product knowledge from Supabase
3. **OpenAI**: `backend/ai/openaiClient.js` – Release Pulse, Test Recipe, Risk Assessment
4. **Output**: Markdown comment posted back (GitHub/Jira) or shown in extension (Linear)

Product knowledge (optional):
- Codebase indexed into `product_knowledge` in Supabase
- `contextRetriever.js` fetches relevant context for prompts
- `codebaseAnalyzer.js` and `prKnowledgeSync.js` handle indexing

### 4. Automated Testing (Optional)

- **Trigger**: `/qa -testrun` in PR comment, or labels (e.g. `run-tests`)
- **Flow**: `automatedTestOrchestrator.js` → `testExecutor.js` (Playwright)
- **Output**: GitHub Check Run, comment with results, screenshots, video

---

## Project Structure

```
FirstQA/
├── webhook-server.js       # Express app, route mounting, static files
├── atlassian-connect.json  # Jira Connect descriptor (served at /atlassian-connect.json)
├── .env.example            # Env template
│
├── backend/
│   ├── routes/             # Express routers
│   │   ├── auth.js         # Login, signup, logout, OAuth callbacks
│   │   ├── dashboard.js    # Dashboard, integrations
│   │   ├── github.js       # Webhooks, install redirect
│   │   ├── jira.js         # Jira OAuth
│   │   ├── jiraConnect.js  # Jira Atlassian Connect lifecycle
│   │   ├── linear.js       # Linear OAuth
│   │   ├── linearConnect.js# Linear Connect webhooks
│   │   ├── onboarding.js   # Onboarding flow
│   │   ├── knowledge.js    # Product knowledge API
│   │   └── ...
│   ├── services/           # Business logic
│   │   ├── automatedTestOrchestrator.js  # Playwright test orchestration
│   │   ├── githubChecksService.js        # GitHub Checks API
│   │   ├── knowledgeBase/                # Codebase indexing, retrieval
│   │   │   ├── codebaseAnalyzer.js
│   │   │   ├── contextRetriever.js
│   │   │   ├── firstTimeIndexTrigger.js
│   │   │   └── prKnowledgeSync.js
│   │   └── ...
│   ├── utils/              # Shared utilities
│   │   ├── githubService.js    # Webhook handling, PR analysis, /qa logic
│   │   ├── githubAppAuth.js    # GitHub App JWT, installation tokens
│   │   ├── jiraService.js
│   │   ├── linearConnectService.js
│   │   └── ...
│   ├── lib/
│   │   └── supabase.js     # Supabase client (anon + admin)
│   └── ai/
│       ├── openaiClient.js # QA insights, test recipe, risk analysis
│       ├── testExecutor.js # Playwright execution from recipe
│       └── prompts/        # EJS templates for AI prompts
│
├── frontend/
│   ├── views/              # EJS templates
│   │   ├── auth/
│   │   ├── dashboard/
│   │   ├── onboarding/
│   │   └── ...
│   ├── public/             # CSS, images, logos
│   └── chrome_extension/   # Linear & Jira ticket analysis
│
├── docs/
├── scripts/
├── supabase/migrations/    # SQL migrations
└── data/                   # Runtime JSON (subscribers, customers)
```

---

## Main File & Folder Purposes

| Path | Purpose |
|------|---------|
| `webhook-server.js` | Express entry, CORS, session, static files, route mounting |
| `backend/utils/githubService.js` | Webhook processing, `/qa` handling, PR fetching, AI calls |
| `backend/ai/openaiClient.js` | OpenAI client, Release Pulse, Test Recipe, Risk Assessment |
| `backend/ai/testExecutor.js` | Playwright execution from AI test recipe |
| `backend/lib/supabase.js` | Supabase client, auth, DB access |
| `backend/utils/githubAppAuth.js` | GitHub App JWT, installation Octokit |
| `frontend/chrome_extension/` | Linear/Jira ticket UI, calls FirstQA API |
| `atlassian-connect.json` | Jira Connect app descriptor |

---

## Database (Supabase)

Main tables:
- **users** – Profiles, plan, usage limits
- **integrations** – GitHub, Linear, Jira, Bitbucket connections per user
- **analyses** – Analysis history
- **product_knowledge** – Indexed codebase chunks
- **jira_connect_installations** / **linear_connect_installations** – App installations

Migrations live in `supabase/migrations/`.

---

## How to Run Locally

### Prerequisites

- Node.js 14+
- npm
- Supabase project (optional for full auth)
- GitHub App (for PR analysis)
- OpenAI API key

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
   Minimum: `SESSION_SECRET`, `OPENAI_API_KEY`, `SUPABASE_*`, `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`.

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

6. **Extension**
   - Build: `npm run build:extension`
   - Load `frontend/chrome_extension/` as unpacked extension in Chrome

---

## NPM Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `start` | `node webhook-server.js` | Run server |
| `dev` | `nodemon webhook-server.js` | Run with auto-reload |
| `webhook` | `node backend/utils/fixed-webhook.js` | Smee webhook proxy |
| `test:automation` | `node scripts/test-automated-testing.js` | Test automation |
| `build:extension` | `bash scripts/create-chrome-extension-release.sh` | Package Chrome extension |
