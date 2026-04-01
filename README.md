# FirstQA

> AI-powered QA analysis for GitHub pull requests.

FirstQA is a GitHub App that analyzes your PRs like a senior QA engineer. Comment `/qa` on any pull request to get an instant analysis with bug detection, risk assessment, and a prioritized test recipe — then optionally run automated browser tests with `/qa testrun`.

**Live at [firstqa.dev](https://www.firstqa.dev)**

---

## How It Works

1. Install the **FirstQA GitHub App** on your repos
2. Open a PR and comment `/qa`
3. Ovi AI analyzes the diff and posts a detailed QA report:
   - **Ship Score** — confidence rating with Go/No-Go recommendation
   - **Bugs & Risks** — potential issues, missing error handling, security concerns
   - **Test Recipe** — prioritized test scenarios with steps and expected results
   - **Questions** — critical questions a QA engineer would ask
4. Optionally, comment `/qa testrun` to execute browser tests automatically

## Features

- **PR Analysis** — Deep code analysis powered by OpenAI GPT-4o
- **Automated Test Execution** — Cloud browser testing via Browserbase + Playwright
- **Executability Scoring** — AI evaluates which test scenarios can be automated vs. need manual testing
- **GitHub Checks Integration** — Results posted as PR comments and Check Runs
- **Linear Integration** — Trigger `/qa` analysis from Linear issue comments
- **Chrome Extension** — Analyze Linear/Jira tickets directly from your browser
- **On-demand Human QA** — Request professional testing at [firstqa.dev/hire](https://www.firstqa.dev/hire)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+, Express |
| Views | EJS templates, Bootstrap 5 |
| Database | Supabase (PostgreSQL) |
| AI | OpenAI API (GPT-4o) |
| Browser Testing | Browserbase (cloud browsers) + Playwright |
| Auth | Supabase Auth, GitHub OAuth |
| Integrations | GitHub App, Linear, Jira Connect |
| Deployment | Render |

## Project Structure

```
FirstQA/
├── backend/
│   ├── ai/              # AI prompts, test executor, executability scorer
│   ├── lib/             # Supabase client
│   ├── routes/          # Express route handlers
│   ├── services/        # Test orchestrator, report formatter, screenshots
│   └── utils/           # GitHub service, auth, email, diff parsing
├── frontend/
│   ├── views/           # EJS templates (dashboard, auth, onboarding, marketing)
│   ├── public/          # Static assets (CSS, logos, images)
│   └── chrome_extension/# Chrome extension source
├── supabase/
│   └── migrations/      # Database schema migrations
├── scripts/             # Ops and dev scripts
├── docs/                # Documentation
├── webhook-server.js    # Application entry point
└── .env.example         # Environment variable template
```

## Getting Started

### Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) project (free tier works)
- An [OpenAI API](https://platform.openai.com) key
- A registered [GitHub App](https://docs.github.com/en/apps/creating-github-apps)

### Setup

```bash
git clone https://github.com/ovidon83/firstqa.git
cd firstqa
npm install
cp .env.example .env
```

Edit `.env` with your credentials (see `.env.example` for all available options).

```bash
npm start
```

The server starts at `http://localhost:3000`.

### Key Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | Yes | Supabase project URL |
| `SUPABASE_ANON_KEY` | Yes | Supabase anonymous key |
| `SUPABASE_SERVICE_KEY` | Yes | Supabase service role key |
| `OPENAI_API_KEY` | Yes | OpenAI API key |
| `GITHUB_APP_ID` | Yes | GitHub App ID |
| `GITHUB_PRIVATE_KEY` | Yes | GitHub App private key (PEM) |
| `GITHUB_WEBHOOK_SECRET` | Yes | Webhook signature secret |
| `SESSION_SECRET` | Yes | Express session secret |
| `BROWSERBASE_API_KEY` | For test execution | Browserbase API key |
| `BROWSERBASE_PROJECT_ID` | For test execution | Browserbase project ID |

See `.env.example` for the full list including Linear, Jira, Stripe, and SMTP configuration.

## Commands

| Command | Where | What it does |
|---------|-------|-------------|
| `/qa` | PR comment | Run full QA analysis |
| `/qa testrun` | PR comment | Execute automated browser tests from the latest analysis |
| `/qa testrun -env=URL` | PR comment | Run tests against a specific URL |
| `/short` | PR comment | Run a shorter, faster analysis |

## Security & Privacy

- **Read-only access** to repository contents (code, PRs, issues)
- **No write access** to your code — only posts comments and Check Runs
- Code is processed in memory and never permanently stored
- All data transmitted over HTTPS/TLS
- [Privacy Policy](https://www.firstqa.dev/privacy) | [Terms of Service](https://www.firstqa.dev/terms)

## Documentation

- [End-to-End Testing Guide](docs/END_TO_END_TESTING_GUIDE.md)
- [GitHub Marketplace Publishing Guide](docs/GITHUB_MARKETPLACE_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)

## License

[ISC](LICENSE)

---

Built by the [FirstQA](https://www.firstqa.dev) team.
