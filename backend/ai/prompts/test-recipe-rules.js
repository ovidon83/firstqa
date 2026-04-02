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

**STEP TYPES TO USE:**
- **Navigation**: "Navigate to [exact URL or page name]" (e.g., "Navigate to /login" or "Navigate to Settings page")
- **Input**: "Enter '[exact text]' in the [specific field name] field" (e.g., "Enter 'test@example.com' in the 'Email Address' field")
- **Action**: "Click the [specific button/link text]" (e.g., "Click the 'Submit' button")
- **Verification**: "Verify that [specific, observable outcome]" (e.g., "Verify that the text 'Order Confirmed' appears at the top of the page")
- **Wait**: "Wait for [specific element/state] to appear/complete" (e.g., "Wait for the 'Loading...' spinner to disappear")

**GOOD STEP EXAMPLES:**
- "Click the 'Submit' button (blue button, bottom right)"
- "Enter 'test@example.com' in the 'Email Address' field"
- "Verify that the text 'Order Confirmed' appears at the top of the page"
- "Navigate to /dashboard"
- "Wait for the success toast to appear"

**BAD STEP EXAMPLES (too vague — avoid these):**
- "Submit the form"
- "Enter a valid email"
- "Check if it worked"
- "Test the flow"
- "Verify functionality"

**AUTOMATION COLUMN (choose exactly one):**
- **UI**: The test is executed in a browser or against the DOM (clicks, typing, navigation, visible UI state). Use for: E2E, Playwright/Cypress, any scenario that requires a rendered page or user interaction.
- **API**: The test asserts on HTTP request/response, status codes, or payloads without driving a browser. Use for: endpoint tests, contract tests, integration tests that call APIs directly (e.g. fetch/axios).
- **Unit**: The test runs against a single function or module in isolation with mocked dependencies. Use for: pure functions, utilities, isolated component/hook tests with mocks.
- **Other**: Analytics/telemetry verification, visual regression, manual exploratory, or a mix of UI+API in one scenario where the primary verification is not purely UI, API, or unit.
Do not use "UI" for API-only tests or "API" for browser-driven tests.

**Test recipe must be based on indexed product context, affected flows, and dependency impact — no invented flows. Cover every meaningful change (at least 1 Smoke + 1 Critical Path per change area).**

**SCENARIO TITLE RULES (STRICT):**
- The title must describe the EXPECTED BEHAVIOR — what "pass" looks like. It should read as a statement of what should happen, not what you're testing.
- WRONG (component/implementation names): "Verify InputBar Flex Layout", "Dynamic Padding with ResizeObserver", "Verify Banner Overlay Visibility"
- RIGHT (expected behavior): "Messages stay scrollable above expanded input", "Spacing adjusts when input bar grows or shrinks", "Banner doesn't hide last message"
- NEVER start with "Verify", "Test", "Check", or "Validate" — just state the expected behavior directly.
- Frame from the user's perspective, not the developer's. Users don't know about ResizeObserver, flex layouts, or component names.
- Keep titles short (under 10 words) and immediately understandable.

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
