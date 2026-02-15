# FirstQA – Product Strategy

> Expert-level guidance on feature prioritization, pricing, competition, and growth.  
> Use this as a living doc; update as you ship and learn.

---

## 1. Feature prioritization

### Principles
- **Outcome over output:** Prioritize what increases activation, retention, or revenue—not "more features."
- **Ovi-first:** Double down on what makes Ovi (AI) indispensable (PR analysis, test recipes, run-in-browser, release pulse). Human QA is a premium add-on, not the core.
- **Stick to one wedge:** "First QA hire for startups" = one clear wedge. Avoid spreading into generic "testing platform" or "dev tools suite" too early.

### Suggested framework: RICE-style

| Factor   | Use for FirstQA |
|----------|------------------|
| **Reach** | # of users/teams who benefit (e.g. all GitHub users vs only Jira users) |
| **Impact** | 1–3: 1 = nice-to-have, 3 = must-have for conversion/retention |
| **Confidence** | % you're right (use 50–100%) |
| **Effort** | Dev weeks (rough) |

**Priority score** = (Reach × Impact × Confidence) / Effort. Use to order the backlog, then adjust by strategy (e.g. "we need one big retention hook this quarter").

### Recommended priority order (next 6–12 months)

1. **Align product and pricing**  
   - Single source of truth for plans (see Pricing section).  
   - **Why first:** Reduces confusion, supports sales and Stripe. **Effort:** Low (copy + config).

2. **Usage-based limits and upsell in-app**  
   - Show "X / Y analyses this month" in dashboard; soft gate at limit with upgrade CTA; optional overage or "request more."  
   - **Why:** Converts free → paid and justifies tiers. **Effort:** Medium.

3. **Activation and "first value"**  
   - First analysis in &lt;5 min: onboarding checklist, "Install GitHub App → open one PR → get first Ovi comment." Optional: first-run email or in-app tip.  
   - **Why:** Early activation predicts retention. **Effort:** Medium.

4. **Retention: "Ovi in the loop"**  
   - Weekly/monthly digest: "Ovi analyzed N PRs; M had risks; top suggestions." Or: "PRs without Ovi this week."  
   - **Why:** Brings churned/inactive users back. **Effort:** Medium.

5. **Differentiation**  
   - One of: (a) Run tests in browser + video proof, (b) Release Pulse / Go No-Go, (c) Linear/Jira ticket analysis. Pick the one that wins in sales conversations and double down.  
   - **Why:** Clear "why FirstQA" story. **Effort:** Depends on current maturity.

6. **Human QA as add-on**  
   - Book human QA (exploratory, regression, etc.) as a separate product or add-on (e.g. "Ovi + Human" pack), not mixed into the same "tests per month" as the AI.  
   - **Why:** Clean positioning (AI first, human when needed) and clearer pricing. **Effort:** Medium (packaging + Stripe).

7. **Integrations**  
   - After Ovi is sticky: Bitbucket, GitLab, Slack, etc. Prioritize by "who's asking" and deal size.  
   - **Why:** Expansion and retention. **Effort:** Per integration.

**Backlog hygiene:** Keep `docs/features.md` updated with 1–2 line descriptions and a RICE-style score (or at least Impact + Effort) so you can re-prioritize quickly.

---

## 2. Pricing strategy (Stripe)

### Current state (from codebase)

- **Stripe (backend):** Starter $49, Growth $149. Plan names: Starter, Growth, Free Trial.
- **Pricing page (UI):** Startup $29, Business $99, Enterprise $299; "tests per month" and "response time" (human QA framing).
- **App logic (Supabase):** `plan` = free | pro | enterprise; free = 10 analyses/month; pro/enterprise = unlimited.

So you have **three different models** (Stripe products, marketing page, app limits). That will confuse customers and ops.

### Recommended direction

**Option A – Simple (recommended for early stage)**  
- **One axis:** Ovi AI analyses per month (or "PR analyses").
- **Tiers:**  
  - **Free:** 5–10 analyses/month, core features, "Powered by FirstQA" or similar.  
  - **Starter (e.g. $49/mo):** 50–100 analyses/month, no branding, maybe priority.  
  - **Growth (e.g. $149/mo):** 250–500 or unlimited analyses, integrations (Linear/Jira), optional human QA add-on.  
  - **Enterprise:** Custom limits, SSO, SLA, dedicated support.
- **Stripe:** Create/update products and prices to match these names and amounts.  
- **Pricing page:** Use the same names and numbers; describe limits in "PR analyses" (or "Ovi analyses"), not "tests" unless you clearly mean "human test runs."
- **App:** Map Stripe plan → `plan` (e.g. Starter → `pro`, Growth → `pro` or `enterprise`) and set `analyses_limit` from plan (or "unlimited" = high cap).

**Option B – Two sides**  
- **Ovi AI:** Per-seat or per-analysis (as in A).  
- **Human QA:** Separate product or add-on (e.g. "Human QA pack: 5 sessions/month for $X").  
Then the main pricing page is Ovi-only; human QA is "Add-on" or "Contact sales."

**Stripe implementation checklist**
- [ ] One set of plan names used everywhere: e.g. Free, Starter, Growth, Enterprise.
- [ ] Stripe product/price IDs stored in env or config; `backend/routes/stripe.js` maps product ID → plan name (and optionally `analyses_limit`).
- [ ] Pricing page shows same names and prices; copy explains "analyses" (or "PR reviews") not "tests."
- [ ] Dashboard and `checkUsageLimits()` use the same `plan` and limits (from DB, synced from Stripe or success page).
- [ ] Optional: Stripe Customer Portal for self-serve upgrade/downgrade/cancel.

**Pricing psychology**
- **Anchor:** Put "Most popular" on the tier you want to sell (e.g. Growth).
- **Trial:** 7–14 day trial on Starter or Growth with full limits; no card for free tier only.
- **Overage:** Either hard cap + upgrade prompt, or overage $ per analysis (simpler: hard cap first).
- **Annual:** 1–2 months free if paid annually (e.g. "$149/mo or $1,490/year").

---

## 3. Competitive analysis

### Who you're competing with

| Space            | Examples                    | How FirstQA is different |
|------------------|-----------------------------|---------------------------|
| **AI code review**| Codium, CodeRabbit, Sourcery, Cody | You focus on **QA angle**: test recipes, risk, release pulse, "run in browser" + video, not just code style/bugs. |
| **Test automation** | Mabl, Testim, Katalon, Cypress Cloud | You're **AI-first + PR-native** (analysis from PR, then run); they're often record/replay or script-first. |
| **QA outsourcing** | Rainforest, Testlio, uTest   | You're **Ovi-first**, human as add-on; they're human-first. |
| **Dev tools / PR** | Linear B, Graphite, Mergify  | You own **QA and release readiness**, not just PR workflow or merge logic. |

### Positioning (one-liner)

- **Internal:** "FirstQA is the first QA hire for startups: Ovi AI does PR analysis, test recipes, and runs tests in the browser; add human QA when you need it."
- **External (e.g. landing):** "Your first QA engineer is an AI — Ovi reviews PRs, writes tests, runs them, and posts results. Not just test cases — actual testing."

### Win themes (for sales and marketing)

1. **Speed:** Analysis in minutes, not days; no hiring delay.  
2. **One place:** PR analysis + test ideas + execution + report (and optionally human QA).  
3. **Startup-fit:** No big QA team required; scales from solo to small team.  
4. **Proof:** Video/screenshots of runs and release pulse so stakeholders see evidence.

### Watch list

- AI-native "QA agents" (e.g. agents that write and run tests from tickets/PRs).  
- GitHub/GitLab adding "AI review" or "suggest tests" (commoditization risk; differentiation = depth + workflow + human add-on).

---

## 4. Growth strategy

### North star (pick one and measure)

- **Activated teams:** e.g. "Teams that had ≥1 Ovi analysis in the last 7 days."  
- Or **analyses per week:** total Ovi analyses (reflects usage and stickiness).

### Funnel

1. **Awareness:** Content (SEO, LinkedIn, X), "First QA hire" and "AI QA" angles; dev/startup communities.  
2. **Sign-up:** Low-friction: GitHub (or Linear) sign-in, install app, no long form.  
3. **Activation:** First analysis in &lt;5 min (onboarding checklist, one PR).  
4. **Retention:** Regular use (e.g. Ovi on every PR or on risk-heavy PRs); email/digest.  
5. **Revenue:** Upgrade when hitting limits or when human QA is requested.  
6. **Referral:** "Invite your team" or "Share FirstQA" with a small incentive (e.g. extra analyses).

### Channels to test (in order of typical ROI for dev tools)

1. **Product-led:** In-app upgrade prompts, docs, and "Share Ovi result" in PR.  
2. **SEO:** "AI QA for startups," "PR test automation," "release readiness," "first QA hire."  
3. **Community:** Indie Hackers, Reddit (r/startups, r/webdev), dev Twitter/X, LinkedIn.  
4. **Partnerships:** Startup accelerators, "starter stacks," GitHub/Linear ecosystem lists.  
5. **Outbound:** Short, personalized outreach to eng leads at seed/Series A with no QA hire.  
6. **Paid:** Later; focus on one channel (e.g. Google or LinkedIn) once conversion and LTV are clear.

### Metrics to track

- **Acquisition:** Sign-ups, installs (GitHub App / integrations).  
- **Activation:** % with ≥1 analysis in 7 days; time to first analysis.  
- **Engagement:** Analyses per user/team per week; PRs with Ovi comment.  
- **Retention:** WAU/MAU; churn by plan.  
- **Revenue:** MRR, ARPU; conversion free → paid; LTV (once you have 3–6 months of data).

### One-page plan (next 90 days)

| Focus            | Actions |
|------------------|--------|
| **Pricing clarity** | Align Stripe, pricing page, and app limits; one plan naming. |
| **Activation**   | Onboarding checklist + "first analysis in 5 min" goal; track %. |
| **Retention**    | Weekly or monthly Ovi digest email; "PRs without Ovi" nudge. |
| **Positioning**  | Use "First QA hire" + "Ovi runs tests" in all touchpoints; one CTA (e.g. "Get started"). |
| **Distribution** | 5–10 pieces of content (blog, LinkedIn, X) on QA/startups/PR; 1–2 partnerships or listings. |

---

## Summary

- **Features:** Prioritize "align pricing + limits," then activation and retention; keep Ovi at the center; add human QA as a clear add-on.  
- **Pricing:** One model (e.g. analyses/month), one set of plan names (Free, Starter, Growth, Enterprise), same in Stripe, pricing page, and app.  
- **Competition:** Position as "first QA hire" + "Ovi = analysis + test recipes + run in browser"; differentiate from pure code review and human-only QA.  
- **Growth:** Define north star and funnel; optimize activation and retention first; then distribution (content, community, partnerships).

If you want, next step can be: (1) a concrete Stripe + pricing page change list (file-by-file), or (2) a filled `docs/features.md` with RICE-style backlog items.
