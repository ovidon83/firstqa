/**
 * Flow-aware test recipe instructions when flow discovery context is available
 * Guides AI to trace complete user journeys, use extracted routes/UI/messages, connect to state changes
 */
module.exports = `
**FLOW-AWARE TEST RECIPE (when FLOW DISCOVERY context exists above):**

1. **NAMING RULE** - Use only page names, section titles, and component names that appear in FLOW DISCOVERY (Routes & suggested page names, Page and section titles, UI Elements) or in FULL FILE CONTENTS. Do not invent synonyms (e.g. do not say "engagement calendar" if the code uses "Total Engagements" or "heatmap"; do not say "calendar day" if the UI is a grid of engagement cells). Prefer the exact section title as shown in the app.
2. **NAVIGATION** - Use "Navigate to [Page name] (path: [route])" with the route and suggested page name from FLOW DISCOVERY (e.g. "Navigate to Overview (path: /analytics/overview)").
3. **SECTIONS** - For actions inside a screen, use "In the **[Section Title]** section, …" with the exact title from "Page and section titles" (e.g. "In the **Total Engagements** section, hover over a cell").
4. **TRACE COMPLETE FLOWS** - Don't test isolated components; test the full user journey from trigger to completion.
5. **USE EXTRACTED VALUES** - Routes, Page and section titles, UI Elements, Messages in FLOW DISCOVERY are from the actual code. Use them exactly:
   - Use exact paths and suggested page names from Routes for Navigation steps
   - Use exact section titles from "Page and section titles" for "In the **X** section" steps
   - Use exact button/label text from UI Elements
   - Use exact error/success messages from Messages for verification steps
6. **MANDATORY FLOW TRACE FOR E2E STEPS** - Before writing steps for any E2E scenario:
   - What does the user SEE on the starting page? (infer from code: components, buttons, forms)
   - What action (button/link text) must they take to proceed to the next screen?
   - What do they see next? Repeat until goal.
   - Never assume a form or input is visible without the click that reveals it. (e.g., /welcome may show a "Get Started" button first; the LinkedIn form appears only after that click.)
   - Step 1 must match what's actually on the first page; include the click before the form-fill.
7. **FLOW CONTEXT PER SCENARIO** - For each test scenario, consider:
   - **Trigger point**: Where/how does the user start?
   - **Entry URL**: Starting path (from Routes)
   - **Prerequisites**: e.g., "User is logged in", "Has valid session"
   - **State changes**: What changes after each action? (URL, UI, data)
8. **CONNECT STEPS TO FLOW** - Each step should advance the user toward the goal. Include Wait steps for loading/redirects.
9. **EDGE CASES FROM CODE** - Validation rules, API endpoints in FLOW DISCOVERY indicate what to test.
10. **CONNECT TO BUGS** - Test scenarios should verify fixes and exercise code paths that could have the bugs identified in Bugs & Risks.
`;
