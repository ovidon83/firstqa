# GitHub Marketplace Publishing Guide

Step-by-step instructions for publishing FirstQA (Ovi AI) to the GitHub Marketplace.

---

## 1. Pre-requisites Checklist

Before you start the listing, confirm you have:

- [ ] A registered GitHub App (app slug: `oviai-by-firstqa`)
- [ ] The app's GitHub App settings page accessible at:
      `https://github.com/settings/apps/oviai-by-firstqa`
- [ ] A publicly accessible homepage: `https://www.firstqa.dev`
- [ ] Privacy Policy URL: `https://www.firstqa.dev/privacy`
- [ ] Terms of Service URL: `https://www.firstqa.dev/terms`
- [ ] Support URL: `https://www.firstqa.dev/support`
- [ ] A logo file (PNG or SVG, 256x256px minimum). Available at:
      `frontend/public/logos/first-qa-github-app-logo.png`
- [ ] A verified publisher domain (or a GitHub organization with a verified domain)
- [ ] At least one published release or a functional app already installed on a repo

---

## 2. Prepare the GitHub App Settings

Go to **GitHub Settings > Developer settings > GitHub Apps > oviai-by-firstqa**.

### General tab — verify these fields:

| Field | Value |
|-------|-------|
| GitHub App name | `Ovi AI by FirstQA` |
| Description | See suggested copy below |
| Homepage URL | `https://www.firstqa.dev` |
| Callback URL | `https://www.firstqa.dev/auth/github/callback` |
| Webhook URL | `https://www.firstqa.dev/github/webhook` |
| Webhook secret | (already set) |

### Permissions — ensure these are set:

| Permission | Access |
|------------|--------|
| Contents | Read-only |
| Pull requests | Read & write |
| Issues | Read & write |
| Checks | Read & write |
| Metadata | Read-only |

### Events — ensure subscriptions:

- Pull request
- Issue comment
- Check suite
- Installation

### Logo

Upload `frontend/public/logos/first-qa-github-app-logo.png` if not already set.

---

## 3. Create the Marketplace Listing

1. Go to `https://github.com/settings/apps/oviai-by-firstqa`
2. Click **"Marketplace listing"** in the left sidebar (or go to "Edit Marketplace listing")
3. Fill in the listing form:

### Listing Name

```
Ovi AI by FirstQA
```

### Short Description (one-liner, max 140 chars)

```
AI-powered QA analysis for pull requests. Get bugs, risks, and test scenarios instantly — comment /qa on any PR.
```

### Full Description (Markdown supported)

```markdown
## Your AI QA Engineer for Every Pull Request

FirstQA analyzes your pull requests like a senior QA engineer. Comment `/qa` on any PR to get:

- **Ship Score** — Confidence rating with Go / No-Go recommendation
- **Bugs & Risks** — Potential issues, security concerns, missing error handling
- **Test Recipe** — Prioritized test scenarios with steps and expected results
- **Critical Questions** — What a QA engineer would ask before approving

### Automated Browser Testing

Comment `/qa testrun` to execute test scenarios automatically in cloud browsers. Get screenshots, video recordings, and pass/fail results — all posted back to your PR.

### How It Works

1. Install the GitHub App on your repositories
2. Open a pull request
3. Comment `/qa` to trigger analysis
4. Review the detailed QA report posted as a comment
5. Optionally run `/qa testrun` for automated browser testing

### Key Features

- Deep code analysis powered by GPT-4o
- Automated test execution via cloud browsers (Browserbase + Playwright)
- AI executability scoring — knows which scenarios can be automated vs. need manual testing
- GitHub Checks integration
- Linear integration for ticket analysis
- Chrome extension for in-browser analysis
- On-demand human QA testing available

### Who Is It For?

Solo founders, small teams, and startups who ship fast and need QA confidence without a dedicated QA team.

### Links

- [Website](https://www.firstqa.dev)
- [Documentation](https://github.com/ovidon83/firstqa)
- [Privacy Policy](https://www.firstqa.dev/privacy)
- [Terms of Service](https://www.firstqa.dev/terms)
```

### Categories

Select up to **2 categories**:

1. **Code quality** (primary)
2. **Testing**

### Pricing

For MVP launch, select **Free** (you can add paid plans later via Stripe or GitHub Marketplace billing).

If you want to offer a paid tier from the start:
- Free plan: Up to 10 analyses/month
- Pro plan: Unlimited analyses (set price, e.g. $29/month)

### Screenshots

Prepare 2-4 screenshots showing:

1. A PR comment with the full QA analysis report
2. The test execution results comment (with pass/fail, screenshots, video links)
3. The FirstQA dashboard
4. The onboarding flow (optional)

Screenshot specs: 1280x800 or similar, PNG/JPG.

### Support Links

| Field | Value |
|-------|-------|
| Support URL | `https://www.firstqa.dev/support` |
| Support email | `support@firstqa.dev` |

### URLs

| Field | Value |
|-------|-------|
| Privacy policy URL | `https://www.firstqa.dev/privacy` |
| Terms of service URL | `https://www.firstqa.dev/terms` |
| Status URL | (optional, leave blank or use a status page URL) |

---

## 4. Submit for Review

1. After filling in all fields, click **"Save draft"**
2. Review the preview to make sure everything looks correct
3. Click **"Submit for review"**

GitHub reviews marketplace listings manually. Typical review time: **1-5 business days**.

### Common rejection reasons and how to avoid them:

- **Missing privacy policy or terms** — Ensure both URLs return valid pages
- **Logo too small or wrong aspect ratio** — Use at least 256x256px, square
- **Description is vague** — Be specific about what the app does
- **App requires permissions it doesn't use** — Only request permissions you actually need
- **No evidence the app works** — Have the app installed on at least one real repo with activity

---

## 5. Post-Publish Checklist

After the listing is approved:

- [ ] Verify the listing appears at `https://github.com/marketplace/oviai-by-firstqa`
- [ ] Test the install flow: click "Set up a plan" and go through the installation
- [ ] Confirm the webhook fires correctly on a new installation
- [ ] Confirm the onboarding flow works for a new user who installs via Marketplace
- [ ] Update the website with a "Install from GitHub Marketplace" link/badge
- [ ] Announce the listing (Twitter/X, LinkedIn, Product Hunt, etc.)

---

## 6. Maintaining the Listing

- Update the description whenever major features are added
- Keep screenshots current
- Respond to reviews promptly
- Monitor installation/uninstallation events in your webhook logs
- If adding paid plans, integrate with GitHub Marketplace billing API or handle via Stripe with the existing setup
