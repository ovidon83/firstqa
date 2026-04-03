/**
 * Shared Test Recipe rules for GitHub PRs and Linear/Jira tickets.
 * Ensures steps are atomic, unambiguous, executable, and automation-ready.
 * Works for both UI/functional changes and backend changes.
 */
module.exports = `
**TEST RECIPE FORMATTING RULES (STRICT):**
1. Each step must be ATOMIC (one action only — no compound steps like "Fill form and submit")
2. Each step must be UNAMBIGUOUS (no interpretation needed — anyone who doesn't know the app can execute it)
3. Each step must be EXECUTABLE by a human or Playwright
4. Number each step clearly (1., 2., 3., …)
5. Include specific, observable expected results after verification steps

**PREREQUISITE-AWARE STEPS (CRITICAL):**
Steps must be complete from the perspective of an unauthenticated user arriving at the base URL. A browser automation agent will execute these steps literally — it cannot infer implicit prerequisites. Include ALL intermediate steps:
- If the page requires authentication, start with: "Log in with test credentials" (the agent has credentials)
- If reaching a page requires clicking through navigation (sidebar, menu, user dropdown), include each click
- If a modal or panel must be opened before interacting with elements inside it, include the trigger step
- NEVER write "Navigate to Settings" if Settings requires login + sidebar + user menu. Instead: "1. Log in<br>2. Click user avatar/menu<br>3. Click 'Settings'"
- Trace the real user journey from the app's entry point to the target screen

**STEP TYPES TO USE:**
- **Login**: "Log in with test credentials" (agent will use provided email/password on whatever login form exists)
- **Navigation**: "Navigate to [exact URL or page name]" or "Click '[menu item]' in the [sidebar/navbar/user menu]"
- **Input**: "Enter '[exact text]' in the [specific field name] field" (e.g., "Enter 'test@example.com' in the 'Email Address' field")
- **Action**: "Click the [specific button/link text]" (e.g., "Click the 'Submit' button")
- **Verification**: "Verify that [specific, observable outcome]" (e.g., "Verify that the text 'Order Confirmed' appears at the top of the page")
- **Wait**: "Wait for [specific element/state] to appear/complete" (e.g., "Wait for the 'Loading...' spinner to disappear")

**GOOD STEP EXAMPLES:**
- "1. Log in with test credentials<br>2. Click 'Settings' in the sidebar<br>3. Click 'Connect LinkedIn' button<br>4. Verify success toast appears"
- "1. Navigate to /signup<br>2. Enter 'test@example.com' in the 'Email' field<br>3. Enter 'Password123' in the 'Password' field<br>4. Click the 'Sign Up' button<br>5. Verify redirect to /dashboard"

**BAD STEP EXAMPLES (missing prerequisites — avoid these):**
- "Navigate to Settings page" (HOW? Does it need login? Where is the link?)
- "Open the Post Editor" (HOW? What clicks get you there from the homepage?)
- "Submit the form" (WHICH form? What fields? What values?)
- "Verify functionality" (WHAT specific outcome?)

**AUTOMATION COLUMN (choose exactly one):**
- **UI**: The test is executed in a browser or against the DOM (clicks, typing, navigation, visible UI state). Use for: E2E, Playwright/Cypress, any scenario that requires a rendered page or user interaction.
- **API**: The test asserts on HTTP request/response, status codes, or payloads without driving a browser. Use for: endpoint tests, contract tests, integration tests that call APIs directly (e.g. fetch/axios).
- **Unit**: The test runs against a single function or module in isolation with mocked dependencies. Use for: pure functions, utilities, isolated component/hook tests with mocks.
- **Other**: Analytics/telemetry verification, visual regression, manual exploratory, or a mix of UI+API in one scenario where the primary verification is not purely UI, API, or unit.
Do not use "UI" for API-only tests or "API" for browser-driven tests.

**Test recipe must be based on indexed product context, affected flows, and dependency impact — no invented flows. Cover every meaningful change (at least 1 Smoke + 1 Critical Path per change area). Scenario title = user-visible outcome (what a real user sees when it passes). NEVER start with "Verify/Test/Check". NEVER use source code names (DraftsPage, PostEditor, InputBar) or implementation jargon (race condition, optimistic, conditional action). Keep under 10 words. Wrong: "DraftsPage auto-save functionality". Right: "Draft auto-saves after editing".**

**TABLE LAYOUT:** Keep Steps and Expected Result cells short so the table aligns well. Use one concise line per step; separate steps with <br>. Avoid long paragraphs inside a single cell; prefer "1. Do X<br>2. Do Y<br>3. Verify Z" over run-on text.

**ROW ORDER:** Always output Test Recipe rows in this order: all Smoke rows first, then all Critical Path rows, then all Regression rows. Do not interleave priorities.

**FOR UI/FRONTEND CHANGES:** Use exact labels, button text, field names, and URLs from the code. Include selectors in parentheses when available: (data-testid="submit-btn").

**FOR BACKEND/API CHANGES:** Use concrete requests and assertions:
- "Send GET request to /api/users/123"
- "Verify response status is 200"
- "Verify response body contains { \"id\": 123, \"email\": \"user@example.com\" }"
- "Send POST request with body { \"name\": \"test\" } to /api/items"
- "Verify database row exists where id=123"

**EDGE CASES TO INCLUDE (when relevant to the change):**
- Empty fields (e.g., "Leave 'Email' field empty and click Submit")
- Invalid inputs (e.g., "Enter 'invalid-email' in the 'Email' field")
- Boundary conditions (e.g., "Enter exactly 255 characters in the 'Name' field")
- Error states (e.g., "Verify error message 'Invalid email format' appears")
- Loading states (e.g., "Wait for loading indicator to disappear before verifying")
- Permission variations (e.g., "As unauthenticated user, attempt to access /admin")
`;
