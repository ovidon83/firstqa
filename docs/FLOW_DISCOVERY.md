# Flow Discovery System

Flow Discovery extracts application flows from code during PR analysis to generate **accurate, executable test recipes** that trace complete user journeys and use exact values from the codebase.

## Goals

- **Accuracy for manual execution**: Steps are unambiguous; anyone can run them without app knowledge
- **Accuracy for automated/Playwright execution**: Selectors, routes, and messages come from actual code
- **Accuracy of bugs in PR analysis**: Test scenarios exercise code paths that could have the identified bugs

## What Gets Extracted

From changed file contents, Flow Discovery extracts:

| Category | Examples |
|----------|----------|
| **Routes** | `/login`, `/dashboard`, `/api/users` (React Router, Next.js, Express) |
| **UI Elements** | Button text ("Submit", "Save"), link labels, placeholders ("Enter email") |
| **Messages** | Error/success text, toast content, validation messages |
| **API Endpoints** | `/api/items`, fetch/axios URLs |
| **Validation Rules** | minLength, maxLength, required, pattern |
| **Selectors** | `data-testid`, `aria-label`, `id`, `name` |

## Pipeline

```
PR Comment (/qa)
    ↓
githubService: fetchChangedFileContents → fileContents, selectorHints
    ↓
openaiClient.generateQAInsights
    ↓
flowDiscovery.discoverFlows(fileContents, selectorHints)
    ↓
formatFlowContextForPrompt(flowContext)
    ↓
enhanced-deep-analysis.ejs
    ├── FLOW DISCOVERY context (routes, UI, messages, APIs, selectors)
    └── FLOW-AWARE TEST RECIPE rules
    ↓
AI generates test recipe with exact values, complete flows
```

## Flow-Aware Rules (when context exists)

1. **Trace complete flows** – Full user journey from trigger to completion
2. **Use extracted values** – Exact paths, button text, messages from code
3. **Flow context per scenario** – Trigger point, entry URL, prerequisites
4. **State changes** – Note URL/UI/data changes after each action
5. **Edge cases from code** – Validation rules, API endpoints indicate what to test
6. **Connect to bugs** – Scenarios verify fixes and exercise risky code paths

## Files

- `backend/ai/flowDiscovery.js` – Extractor (routes, UI, messages, APIs, validation, selectors)
- `backend/ai/prompts/flow-discovery-rules.js` – Flow-aware test recipe instructions
- `backend/ai/openaiClient.js` – Integrates flow discovery into PR analysis

## Example Output

For a PR that changes login flow, Flow Discovery might extract:
- Routes: `/login`, `/dashboard`
- UI: button "Sign in", placeholder "Email address"
- Messages: "Invalid email format"
- Selectors: `[data-testid="email"]`, `[data-testid="submit-btn"]`

The AI then generates steps like:
1. Navigate to `/login`
2. Enter 'test@example.com' in the Email field (`[data-testid="email"]`)
3. Click the 'Sign in' button (`[data-testid="submit-btn"]`)
4. Verify that URL changes to `/dashboard`
