# FirstQA

> Meet Ovi — your top 1% AI QA engineer.

FirstQA is an AI-powered QA engineer for startups. Ovi onboards in under 10 minutes, connects to GitHub and Linear, and immediately starts reviewing every PR and ticket, running browser tests, and writing Playwright code — like a real senior QA hire would.

**Live at [firstqa.dev](https://www.firstqa.dev)**

---

## How It Works

1. **Hire Ovi** — Sign up at [firstqa.dev](https://www.firstqa.dev) and install the GitHub App on your repos
2. **Onboard Ovi** — Connect GitHub and Linear. Ovi indexes your codebase and learns your product
3. **Ovi gets to work** — Every PR and ticket is reviewed automatically. Trigger a full run with `/qa`

---

## What Ovi Does

| Capability | Description |
|------------|-------------|
| **Ticket Analysis** | Reviews Linear/Jira tickets for gaps, edge cases, and QA questions before coding starts |
| **PR Analysis** | Analyzes every PR diff for bugs, logic errors, edge cases, and UI/UX risks |
| **Test Recipe** | Generates prioritized test scenarios with exact steps and expected results |
| **Browser Test Execution** | AI agent runs scenarios in real cloud Chromium with screenshots and video |
| **Playwright Code** | Downloadable `.spec.js` files with accurate selectors from your codebase |
| **Ship Score / Go-No-Go** | Clear release decision with blockers and non-blockers separated |

---

## Commands

| Command | Where | What it does |
|---------|-------|-------------|
| `/qa` | PR or Linear/Jira comment | Run full QA analysis |
| `/qa testrun` | PR comment | Execute automated browser tests |
| `/qa testrun -env=URL` | PR comment | Run tests against a specific environment |
| `/qa testrun -context "..."` | PR comment | Pass context (user type, auth state) to the test agent |
| `/short` | PR comment | Run a shorter, faster analysis |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 18+, Express |
| Views | EJS templates |
| Database | Supabase (PostgreSQL) |
| AI | OpenAI API |
| Browser Testing | Stagehand + Browserbase (cloud Chromium) + Playwright |
| Auth | Supabase Auth, GitHub OAuth, Linear OAuth |
| Integrations | GitHub App, Linear, Jira Connect |
| Payments | Stripe |
| Deployment | Render |

---

## Project Structure

```
FirstQA/
├── backend/
│   ├── ai/              # AI prompts and test execution
│   ├── lib/             # Supabase client
│   ├── routes/          # Express route handlers
│   ├── services/        # Test orchestrator, report formatter, screenshots
│   └── utils/           # GitHub service, auth, email, diff parsing
├── frontend/
│   ├── views/           # EJS templates (dashboard, auth, onboarding, marketing)
│   └── public/          # Static assets (CSS, logos, images)
├── supabase/
│   └── migrations/      # Database schema migrations
├── docs/                # Internal documentation
├── webhook-server.js    # Application entry point
└── .env.example         # Environment variable template
```

---

## Getting Started (Local Dev)

### Prerequisites

- Node.js 18+ and npm
- A [Supabase](https://supabase.com) project
- An [OpenAI API](https://platform.openai.com) key
- A registered [GitHub App](https://docs.github.com/en/apps/creating-github-apps)

### Setup

```bash
git clone https://github.com/ovidon83/firstqa.git
cd firstqa
npm install
cp .env.example .env
```

Edit `.env` with your credentials, then:

```bash
npm start
```

Server starts at `http://localhost:3000`.

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

See `.env.example` for the full list including Linear, Jira, Stripe, and SMTP.

---

## Security & Privacy

- **Read-only** access to repository contents — never modifies your code
- Code is processed in memory and **never permanently stored**
- Only writes PR comments and Check Runs back to GitHub
- All data transmitted over HTTPS/TLS
- [Privacy Policy](https://www.firstqa.dev/privacy) · [Terms of Service](https://www.firstqa.dev/terms)

---

## Documentation

- [User Guide & Docs](https://www.firstqa.dev/docs)
- [End-to-End Testing Guide](docs/END_TO_END_TESTING_GUIDE.md)
- [GitHub Marketplace Guide](docs/GITHUB_MARKETPLACE_GUIDE.md)
- [Architecture](docs/ARCHITECTURE.md)

---

## License

[ISC](LICENSE)

---

Built by [FirstQA](https://www.firstqa.dev)
