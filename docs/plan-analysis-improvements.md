# PR & Ticket Analysis – Improvements Plan

Investigation and implementation plan for the requested changes. Each item maps to specific files and changes.

---

## PR analysis

### 1. Single title “QA Analysis by…” at the very top

**Problem:** Two titles appear: (1) from the prefixed block in `githubService.js` (“QA Analysis - by Ovi (the AI QA)” or “Analysis Update - New Commits Detected”), and (2) from the AI output (same “# 🎯 QA Analysis - by Ovi (the AI QA)” again before Release Pulse).

**Root cause:**
- **`backend/utils/githubService.js`** (around 2024–2039): When there are commits, we prepend a heading and “Analyzing N commit(s)” + list, then append the full AI response.
- The AI response (from **`backend/ai/prompts/enhanced-deep-analysis.ejs`**) starts with `# 🎯 QA Analysis - by Ovi (the AI QA)` and then `## 🧪 Release Pulse`.

**Plan:**
- Use a **single** top-level title: always “# 🎯 QA Analysis - by Ovi (the AI QA)” at the very top.
- When there are commits: under that title, add “Analyzing N commit(s):” and the list, then **strip the duplicate title from the AI output** before appending (remove the leading `# 🎯 QA Analysis...` line and the following blank line so the next thing is `## 🧪 Release Pulse`).
- Implement the strip in **`formatHybridAnalysisForComment`** (or in the place that builds `acknowledgmentComment`) when the comment is built with a commits prefix: pass a flag or detect “we already added the title” and remove the first H1 from `aiData` before concatenation.
- Alternative: stop adding a heading in the commits block and instead prepend only “Analyzing N commit(s):” + list; then the AI output keeps its single title. That gives one title from the AI and no duplicate.

**Files:** `backend/utils/githubService.js` (acknowledgmentComment build ~2022–2050, and optionally `formatHybridAnalysisForComment`).

---

### 2. Text fit better inside the Release Pulse table

**Problem:** The “Details” column in the Release Pulse table has long text that wraps badly in the UI.

**Root cause:** The prompt asks for explanatory text in the Details cells without a strict length limit.

**Plan:**
- In **`backend/ai/prompts/enhanced-deep-analysis.ejs`** (and **`deep-analysis.ejs`** / **`short-analysis.ejs`** if they use the same table), add explicit constraints for the **Details** column, e.g.:
  - “Keep Details to one short line (max 10–15 words) or 2–3 comma-separated phrases.”
  - “Use keywords/phrases, not full sentences (e.g. ‘Markdown + keyboard; test both.’).”
- Optionally suggest using `<br>` only when 2 short lines are needed. No code change to formatting; this is prompt-only.

**Files:** `backend/ai/prompts/enhanced-deep-analysis.ejs` (table row instructions ~86–92), and same idea in `deep-analysis.ejs` / `short-analysis.ejs` if applicable.

---

### 3. Test recipe always sorted by priority (top-down)

**Problem:** Test recipe rows should always appear in priority order (e.g. Smoke → Critical Path → Regression).

**Current state:**
- **Ticket:** **`backend/utils/ticketAnalysisFormatter.js`** already sorts: `recipe.sort((a, b) => (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1))` (line 104). So ticket side is fine.
- **PR:** The PR analysis is raw markdown from the AI; there is no post-processing. The prompt says “ORDERED BY PRIORITY (High first, then Medium)” but doesn’t use the same labels (Smoke / Critical Path / Regression) or “top-down”.

**Plan:**
- In **`backend/ai/prompts/enhanced-deep-analysis.ejs`** (Test Recipe section):
  - Unify priority labels with ticket: **Smoke**, **Critical Path**, **Regression** (and optionally “Edge Case” / “Negative” as medium).
  - Add: “**Always output the Test Recipe table with rows sorted by priority from top to bottom: Smoke first, then Critical Path, then Regression.**”
- No new code path; prompt change only.

**Files:** `backend/ai/prompts/enhanced-deep-analysis.ejs` (Test Recipe requirements and table description). Also align **short-analysis.ejs** and **deep-analysis.ejs** if they have a test recipe table.

---

### 4. Go / No-Go accurately reflect current PR status

**Problem:** Release Decision and QA Recommendation should reflect actual findings (Bugs & Risks, test coverage), not be generic.

**Current state:** The prompt already has “RELEASE PULSE EVALUATION REQUIREMENTS” and “Be REALISTIC and BASE ON ACTUAL FINDINGS”. It can be tightened.

**Plan:**
- In **`backend/ai/prompts/enhanced-deep-analysis.ejs`**:
  - Strengthen the Release Decision / QA Recommendation instructions:
    - “Release Decision and QA Recommendation **must** be derived only from the Bugs & Risks section and the scope of changes. If there are no blockers and no high-severity issues, the decision must be Go (or Caution only if there are concrete, non-blocker concerns). If any BLOCKER or critical bug exists, the decision must be No-Go.”
  - Add: “Do not use Caution or No-Go for theoretical or low-probability concerns; reserve them for real, code-based issues you listed in Bugs & Risks.”

**Files:** `backend/ai/prompts/enhanced-deep-analysis.ejs` (Release Pulse and evaluation sections).

---

### 5. Bugs & Risks accurate and based on real concerns

**Problem:** Only list issues that are real and likely; avoid low-probability or speculative items.

**Current state:** Prompt already says “ONLY SIGNAL, NO NOISE”, “no false positives”, “MAX 6 items”, “real, code-based risks”.

**Plan:**
- In **`backend/ai/prompts/enhanced-deep-analysis.ejs`** (Bugs & Risks section and “CRITICAL” instructions):
  - Add explicit rule: “Only list issues that have **high likelihood** of occurring based on the current code (e.g. missing null check on a used path, wrong condition, data corruption in the diff). Do **not** list theoretical risks, ‘could potentially’, or issues that would require unlikely inputs or environment.”
  - Optionally: “Prefer fewer, high-confidence items over many low-confidence ones.”

**Files:** `backend/ai/prompts/enhanced-deep-analysis.ejs` (Bugs & Risks requirements and BUGS & RISKS REQUIREMENTS block).

---

### 6. Short To Do checklist for the author (to reach Go)

**Problem:** When the PR is not a Go, the author needs a clear, short checklist of what to do so the PR can become Go.

**Plan:**
- Add a **new section** in the PR analysis output, only when the Release Decision is **Caution** or **No-Go**:
  - Title: “## ✅ To Do (for Go)” or “## Checklist for author”.
  - Content: 3–5 concrete, actionable items (e.g. “Fix [blocker] at `file:line`”, “Add null check for X”, “Run E2E test for flow Y”, “Clarify/confirm Z with team”). No generic advice.
- In **`backend/ai/prompts/enhanced-deep-analysis.ejs`**:
  - After the Test Recipe section (or after Bugs & Risks), add instructions:
    - “If Release Decision is Caution or No-Go, add a section **## ✅ To Do (for Go)** with a short checklist (3–5 items) of concrete actions the PR author should take for the PR to become Go. Base items on the Bugs & Risks and missing validations you listed. Use clear, copy-pasteable actions (e.g. ‘Fix … at file:line’, ‘Add test for …’).”
  - If the decision is Go, instruct: “Do not add the To Do section.”

**Files:** `backend/ai/prompts/enhanced-deep-analysis.ejs` (output structure and “REMEMBER: STOP YOUR OUTPUT…” block). Optionally mirror in **deep-analysis.ejs** / **short-analysis.ejs** if they are still used for full analysis.

---

## Ticket analysis

### 7. Recommendations: real changes + optional checklist

**Problem:** Recommendations should be concrete (copy, acceptance criteria, new AC) and ready for dev; optionally shown as a checklist.

**Current state:** **`backend/ai/openaiClient.js`** (`generateSingleAnalysis`) already asks for “ready-to-copy acceptance criteria” and “recommendations: array of max 5 items… READY-TO-COPY… Full, self-contained sentences.” The formatter in **`backend/utils/ticketAnalysisFormatter.js`** renders them as plain paragraphs.

**Plan:**
- **Prompt** (**`backend/ai/openaiClient.js`**):
  - Tighten recommendations: “Each recommendation must be a **concrete change** to the ticket: e.g. change of copy/wording, change or addition of acceptance criteria, new mandatory AC, or a real gap that must be fixed for the ticket to be clear and dev-ready. Do not suggest generic best practices; only things that are **really missing or wrong** in this ticket.”
- **Formatter** (**`backend/utils/ticketAnalysisFormatter.js`**):
  - Render recommendations as a **checklist**: prefix each with `- [ ] ` so they show as unchecked boxes in Markdown (e.g. in Linear/Jira). Keep truncation/limit as today (e.g. 500 chars per item, max 5).

**Files:** `backend/ai/openaiClient.js` (recommendations part of the ticket prompt), `backend/utils/ticketAnalysisFormatter.js` (`formatAnalysisComment` recommendations block).

---

### 8. Test recipe table: copy fit and Steps flow (multiline)

**Problem:** In the ticket Test Recipe table, Name is truncated, Steps are squashed into one line with “ → ”, and the last row can look cut off. User wants better fit and Steps as a clear, multiline flow.

**Current state:** **`backend/utils/ticketAnalysisFormatter.js`**:
  - Name: `truncate(name, 60)`.
  - Steps: `scenarioDisplay = truncate(t.scenario, 350).replace(/\n/g, ' → ')` — so newlines are replaced by “ → ” and total length is capped at 350.

**Plan:**
- **Steps column:**
  - Prefer **multiline inside the cell**: in Markdown, use `<br>` for line breaks so each step is on its own line (e.g. `1. Do X<br>2. Do Y<br>3. Verify Z`). So: build `scenarioDisplay` from the normalized steps array by joining with `<br>` instead of “ → ”, and allow a higher character limit (e.g. 400–500) or no truncation for steps if the platform supports it.
  - Keep a single line as fallback only if the platform doesn’t render `<br>` in table cells (Linear/Jira usually do).
- **Name column:**
  - Optionally increase to 80 characters if needed; keep truncation to avoid breaking tables.
- **Incomplete steps:** If the AI returns truncated scenario text (e.g. “1. Simulate a failure in”), we can’t fix that in the formatter; we can add in the **ticket prompt** (openaiClient.js): “For each test scenario, ensure the **scenario** field is a complete, readable list of steps (no cut-off sentences).”

**Files:** `backend/utils/ticketAnalysisFormatter.js` (recipe table build: `scenarioDisplay`, truncation, and column widths). Optionally **`backend/ai/openaiClient.js`** (ticket testRecipe scenario completeness).

---

### 9. Tag the assignee when posting analysis

**Problem:** The assignee should be notified when the analysis is generated (e.g. mentioned in the comment).

**Current state:**
- **Linear:** **`backend/utils/linearConnectService.js`** fetches issue with `assignee { name }` (line 383–384). Comment is posted with `postComment(issueId, analysisComment, installation)` (line 234–235). We have `issueDetails.assignee` (display name) but not necessarily an ID for @mention. Linear’s comment body is often Markdown; @mentions may use a specific format (e.g. user ID or name).
- **Jira:** **`backend/utils/jiraConnectService.js`** returns `assignee: asString(issue.fields?.assignee?.displayName)` (line 211). Jira Cloud mentions use **`[~accountId]`**; we need `issue.fields.assignee.accountId` from the issue fetch. The connect service already requests `assignee` in fields (line 162); the Jira API returns the full assignee object (including `accountId`). We should add `assigneeAccountId` to the returned ticket details and use it when building the comment.

**Plan:**
- **Linear:**
  - When building the comment in **`backend/utils/linearConnectService.js`**, if `issueDetails.assignee` exists and is not “Unassigned”, prepend to the comment body: e.g. `**@${issueDetails.assignee}** — QA analysis ready:\n\n` (or the exact format Linear expects for mentions; may need to verify in Linear’s docs if they use `@name` or something else). Then append the rest of the analysis.
- **Jira (Connect):**
  - In **`backend/utils/jiraConnectService.js`**, when mapping the issue (return object ~203–219), add e.g. `assigneeAccountId: issue.fields?.assignee?.accountId || null`.
  - When posting the comment (in the flow that calls `postComment`), if we have `assigneeAccountId`, prepend `**[~${assigneeAccountId}]** — QA analysis ready:\n\n` to the comment body. Jira comment API accepts ADF; if comments are sent as ADF, the mention must be an ADF node for a user mention (we need to confirm how comments are sent in jiraConnectService – line 227, might be ADF). So we need to either (a) prepend plain text `[~accountId]` and ensure the API accepts it in the body, or (b) inject an ADF mention node. Checking the current `postComment` implementation for Jira Connect: it may convert body to ADF; if so, we need to add a mention node at the start. Defer exact ADF shape to implementation; the plan is “prepend assignee mention when assigneeAccountId is present”.
- **Jira (OAuth / jiraService.js):**
  - Same idea: when fetching the issue in **jiraService.js**, ensure we have assignee `accountId` (might require requesting it or reading it from the webhook payload). When building the comment before `postComment`, prepend `[~accountId]` (or ADF equivalent) when assignee is set.

**Files:**  
- **`backend/utils/linearConnectService.js`**: build comment with assignee mention prefix when `issueDetails.assignee` is set.  
- **`backend/utils/jiraConnectService.js`**: return `assigneeAccountId`, and in the code path that builds and posts the analysis comment, prepend Jira mention using `[~accountId]`.  
- **`backend/utils/jiraService.js`**: ensure assignee `accountId` is available (from issue fetch or webhook) and prepend mention when posting the analysis comment.

---

## Implementation order (suggested)

1. **PR: Single title** – Quick win, improves clarity (githubService + optional formatHybrid).
2. **PR: Pulse table text fit** – Prompt-only (enhanced-deep-analysis.ejs).
3. **PR: Test recipe sort** – Prompt-only (enhanced-deep-analysis.ejs).
4. **PR: Go/No-Go accuracy** – Prompt-only (enhanced-deep-analysis.ejs).
5. **PR: Bugs & Risks accuracy** – Prompt-only (enhanced-deep-analysis.ejs).
6. **PR: To Do checklist** – Prompt (enhanced-deep-analysis.ejs).
7. **Ticket: Recommendations** – Prompt (openaiClient.js) + formatter checklist (ticketAnalysisFormatter.js).
8. **Ticket: Test recipe table** – Formatter (ticketAnalysisFormatter.js) + optional prompt (openaiClient.js).
9. **Ticket: Tag assignee** – Linear + Jira Connect + Jira service (comment build and post).

---

## Summary table

| # | Area   | Item                         | Main files                                                                 |
|---|--------|------------------------------|----------------------------------------------------------------------------|
| 1 | PR     | Single title at top          | `backend/utils/githubService.js`                                          |
| 2 | PR     | Pulse table text fit         | `backend/ai/prompts/enhanced-deep-analysis.ejs` (and deep/short if used)   |
| 3 | PR     | Test recipe sorted           | `backend/ai/prompts/enhanced-deep-analysis.ejs`                           |
| 4 | PR     | Go/No-Go accuracy            | `backend/ai/prompts/enhanced-deep-analysis.ejs`                           |
| 5 | PR     | Bugs & Risks real only       | `backend/ai/prompts/enhanced-deep-analysis.ejs`                           |
| 6 | PR     | To Do checklist for author    | `backend/ai/prompts/enhanced-deep-analysis.ejs`                           |
| 7 | Ticket | Recommendations real + list  | `backend/ai/openaiClient.js`, `backend/utils/ticketAnalysisFormatter.js`  |
| 8 | Ticket | Test recipe table / Steps    | `backend/utils/ticketAnalysisFormatter.js`, optional `openaiClient.js`      |
| 9 | Ticket | Tag assignee                 | `backend/utils/linearConnectService.js`, `jiraConnectService.js`, `jiraService.js` |

If you want, next step can be implementing these in the order above (or starting with a subset you care about first).
