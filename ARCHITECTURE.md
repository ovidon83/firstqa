# FirstQA Architecture Documentation

## 🏗️ **Clean Architecture Overview**

This document outlines the clean, single-source-of-truth architecture for FirstQA's Chrome extension and backend services.

---

## 📁 **File Structure**

```
FirstQA/
├── ai/
│   └── openaiClient.js          # 🧠 SINGLE SOURCE: AI Analysis Logic
├── chrome_extension/
│   ├── content.js               # 🎯 MAIN: Chrome extension logic + Linear formatter
│   ├── formatters.js           # 📝 Linear HTML formatter (unused - kept for reference)
│   ├── utils.js                # 🔧 Utility functions (no formatting)
│   ├── submission.js           # 📤 Comment submission logic
│   ├── popup.js                # 🖥️ Extension popup UI
│   ├── background.js           # 🔄 Background service worker
│   ├── manifest.json           # 📋 Extension configuration
│   └── ui.css                  # 🎨 Styling
├── src/
│   └── routes/
│       └── index.js            # 🌐 API endpoints
└── webhook-server.js           # 🚀 Main server
```

---

## 🧠 **AI Analysis Logic - SINGLE SOURCE OF TRUTH**

### **Location**: `ai/openaiClient.js`

**Key Functions:**
- `generateTicketInsights()` - Main entry point for ticket analysis
- `generateSingleAnalysis()` - Core AI prompt and analysis logic

**What it generates:**
```json
{
  "title": "Definition of Ready Analysis",
  "minimalMode": false,
  "changeType": "frontend|backend|full-stack",
  "hasDesignMaterials": true|false,
  "designDetails": "description" or null,
  "qaQuestions": ["array of 5-8 questions"],
  "keyRisks": ["array of risks"],
  "scoreImpactFactors": ["array of score factors"],
  "improvementsNeeded": ["specific actionable items"],
  "testRecipe": [{"scenario": "...", "steps": "...", "expected": "...", "priority": "...", "automation": "...", "reason": "..."}],
  "initialReadinessScore": 1-5,
  "readyForDevelopmentScore": 1-5,
  "scoreBreakdown": {...},
  "tip": "actionable suggestion",
  "missingInfo": ["specific missing details"]
}
```

---

## 🎯 **Chrome Extension - CLEAN STRUCTURE**

### **Main Logic**: `chrome_extension/content.js`

**Key Functions:**
- `formatAsMarkdown()` - **Linear HTML formatter** (for Linear comments)
- `formatAsMarkdownForJira()` - **Jira Markdown formatter** (for Jira clipboard)
- `showJiraPanel()` - **Jira Modal display** (for Jira modal)
- `getScoreLabel()` - Score label helper
- `insertLinearComment()` - Linear comment insertion
- `copyInsightsToClipboard()` - Clipboard functionality

### **Utilities**: `chrome_extension/utils.js`

**Key Functions:**
- `getQAInsights()` - API call to backend
- `getElementText()` - DOM text extraction
- `copyToClipboard()` - Clipboard helper
- Platform detection functions

### **Submission**: `chrome_extension/submission.js`

**Key Functions:**
- Linear comment submission logic
- Retry mechanisms

---

## 🌐 **API Endpoints - SINGLE SOURCE**

### **Location**: `src/routes/index.js`

**Key Endpoint:**
- `POST /api/analyze-ticket` - Main analysis endpoint

**Request Format:**
```json
{
  "ticketId": "PROJ-123",
  "title": "Fix upload issue",
  "description": "Description text...",
  "comments": ["comment1", "comment2"],
  "labels": ["bug", "frontend"],
  "platform": "linear|jira",
  "priority": "medium",
  "type": "story"
}
```

---

## 📊 **Report Structure - CONSISTENT ACROSS PLATFORMS**

### **New Structure (Both Linear & Jira):**

```
# 🤖 QA Analysis

## 📊 READINESS ASSESSMENT
**Current State:** 2/5 (Needs Work)
**After Ovi Enhancement:** 4/5 (Good)

## 🔧 IMPROVEMENTS NEEDED
1. **Add specific acceptance criteria:** "User sees success message after file upload completes"
2. **Define file limits:** "Support .jpg, .png, .pdf files up to 10MB maximum"
3. **Specify error handling:** "Show 'Upload failed' toast notification with retry button"

## 🧠 QA Questions
[5-8 specific questions]

## ⚠️ KEY RISKS
[4-5 specific risks]

## 🧪 TEST RECIPE
[Table format with scenarios, steps, expected results, priority, automation, reason]
```

---

## 🔄 **Data Flow**

```
1. User clicks "Analyze Ticket" in Chrome extension
   ↓
2. content.js extracts ticket data from DOM
   ↓
3. utils.js calls POST /api/analyze-ticket
   ↓
4. openaiClient.js generates AI analysis
   ↓
5. content.js formats and displays results:
   - Linear: HTML comment insertion
   - Jira: Modal display + clipboard copy
```

---

## ✅ **Cleanup Completed**

### **Removed Duplicates:**
- ❌ `chrome_extension/jira-formatter.js` (unused, old logic)
- ❌ `chrome_extension/scripts/firstqa-api.js` (unused, old API)
- ❌ `chrome_extension/scripts/` directory (empty)
- ❌ Duplicate `formatAsMarkdown()` in `utils.js`
- ❌ Duplicate `getScoreLabel()` in `formatters.js`

### **Single Source of Truth:**
- ✅ **AI Logic**: `ai/openaiClient.js` only
- ✅ **Linear Formatting**: `content.js` → `formatAsMarkdown()`
- ✅ **Jira Formatting**: `content.js` → `formatAsMarkdownForJira()` + `showJiraPanel()`
- ✅ **API Endpoint**: `src/routes/index.js` → `/api/analyze-ticket`
- ✅ **Score Labels**: `content.js` → `getScoreLabel()`

---

## 🚀 **Development Workflow**

### **To modify AI analysis:**
1. Edit `ai/openaiClient.js` → `generateSingleAnalysis()` function
2. Test on both Linear and Jira tickets

### **To modify report structure:**
1. Edit `chrome_extension/content.js` → `formatAsMarkdown()` and `formatAsMarkdownForJira()`
2. Both platforms will automatically use the new structure

### **To modify UI:**
1. Edit `chrome_extension/content.js` → `showJiraPanel()` for Jira modal
2. Edit `chrome_extension/ui.css` for styling
3. Edit `chrome_extension/popup.js` for extension popup

---

## 🎯 **Key Principles**

1. **Single Source of Truth**: Each piece of logic exists in exactly one place
2. **Consistent Structure**: Both Linear and Jira show identical report structure
3. **AI-Driven**: All analysis comes from AI, no hardcoded logic
4. **Platform-Agnostic**: Same AI logic works for both platforms
5. **Clean Separation**: UI logic separate from business logic separate from AI logic

---

## 🔧 **Testing**

### **Test Linear:**
1. Go to any Linear ticket
2. Click FirstQA extension
3. Click "Analyze Ticket"
4. Verify comment is inserted with new structure

### **Test Jira:**
1. Go to any Jira ticket
2. Click FirstQA extension
3. Click "Analyze Ticket"
4. Verify modal shows new structure
5. Test "Copy to Clipboard" functionality

---

**Last Updated**: January 2025
**Status**: ✅ Clean Architecture Complete
