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
