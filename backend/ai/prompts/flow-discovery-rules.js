/**
 * Flow-aware test recipe instructions when flow discovery context is available
 * Guides AI to trace complete user journeys, use extracted routes/UI/messages, connect to state changes
 */
module.exports = `
**FLOW-AWARE TEST RECIPE (when FLOW DISCOVERY context exists above):**

1. **TRACE COMPLETE FLOWS** - Don't test isolated components; test the full user journey from trigger to completion.
2. **USE EXTRACTED VALUES** - Routes, UI Elements, Messages in FLOW DISCOVERY are from the actual code. Use them exactly:
   - Use exact paths from Routes for Navigation steps (e.g., "Navigate to /compose")
   - Use exact button/label text from UI Elements
   - Use exact error/success messages from Messages for verification steps
3. **MANDATORY FLOW TRACE FOR E2E STEPS** - Before writing steps for any E2E scenario:
   - What does the user SEE on the starting page? (infer from code: components, buttons, forms)
   - What action (button/link text) must they take to proceed to the next screen?
   - What do they see next? Repeat until goal.
   - Never assume a form or input is visible without the click that reveals it. (e.g., /welcome may show a "Get Started" button first; the LinkedIn form appears only after that click.)
   - Step 1 must match what's actually on the first page; include the click before the form-fill.
4. **FLOW CONTEXT PER SCENARIO** - For each test scenario, consider:
   - **Trigger point**: Where/how does the user start?
   - **Entry URL**: Starting path (from Routes)
   - **Prerequisites**: e.g., "User is logged in", "Has valid session"
   - **State changes**: What changes after each action? (URL, UI, data)
5. **CONNECT STEPS TO FLOW** - Each step should advance the user toward the goal. Include Wait steps for loading/redirects.
6. **EDGE CASES FROM CODE** - Validation rules, API endpoints in FLOW DISCOVERY indicate what to test.
7. **CONNECT TO BUGS** - Test scenarios should verify fixes and exercise code paths that could have the bugs identified in Bugs & Risks.
`;
