/**
 * Flow Discovery - Extracts application flows from code for accurate test recipe generation
 * Analyzes file contents to discover: routes, navigation, UI elements, API calls, validation, error handling
 * Used by PR and ticket analysis to generate executable, flow-aware test scenarios
 */

/**
 * Extract routes/paths from code (React Router, Next.js, Express, Vue Router, etc.)
 */
function extractRoutes(filePath, content) {
  const routes = [];
  const pathPatterns = [
    // React Router: path="/login" path='/dashboard'
    /path=["']([^"']+)["']/g,
    // Next.js: router.push('/x'), href="/x"
    /(?:router\.push|href|to)=["']([^"']+)["']/g,
    // Express/Node: app.get('/api/...'), router.get('/
    /(?:app|router)\.(?:get|post|put|delete|patch)\s*\(\s*["']([^"']+)["']/g,
    // Route definition: <Route path=
    /<Route\s+path=["']([^"']+)["']/g,
    // navigate('/path')
    /navigate\s*\(\s*["']([^"']+)["']/g,
    // redirect('/path')
    /redirect\s*\(\s*["']([^"']+)["']/g,
    // window.location = '/path'
    /window\.location\s*=\s*["']([^"']+)["']/g,
  ];
  const seen = new Set();
  for (const re of pathPatterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const path = m[1].trim();
      if (path && path.length > 1 && path.length < 200 && !seen.has(path)) {
        seen.add(path);
        routes.push({ path, file: filePath });
      }
    }
  }
  return routes;
}

/**
 * Extract button/link text, labels from JSX/HTML
 */
function extractUIElements(filePath, content) {
  const elements = [];
  const patterns = [
    // Button text: >Submit<, >Save<, >Send SMS<
    { re: />\s*([A-Za-z0-9\s\-_&]+)\s*<\/(?:button|Button)/g, type: 'button' },
    // Link text: <a>Text</a>, <Link>Text</Link>
    { re: /<(?:a|Link)[^>]*>\s*([^<]{1,80})\s*<\/(?:a|Link)/g, type: 'link' },
    // Label: label>Email</label
    { re: /<label[^>]*>\s*([^<]{1,60})\s*<\/label>/g, type: 'label' },
    // Placeholder: placeholder="Enter email"
    { re: /placeholder=["']([^"']+)["']/g, type: 'placeholder' },
    // Button/label in strings: 'Submit', "Save"
    { re: /['"`](?:Submit|Save|Cancel|Send|Add|Create|Delete|Edit|Update|Login|Sign up|Logout|Continue|Next|Back|Close|Confirm|Get Started|Start|Begin)[^'"`]*['"`]/g, type: 'action' },
  ];
  const seen = new Set();
  for (const { re, type } of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      let text = (m[1] || m[0]).replace(/^['"`]|['"`]$/g, '').trim();
      if (text && text.length < 60 && !seen.has(`${type}:${text}`)) {
        seen.add(`${type}:${text}`);
        elements.push({ type, text, file: filePath });
      }
    }
  }
  return elements;
}

/**
 * Extract error/success messages, toast text
 */
function extractMessages(filePath, content) {
  const messages = [];
  const patterns = [
    /(?:error|message|msg|toast|notification|alert)\s*[=:]\s*["']([^"']{5,120})["']/gi,
    /(?:showError|showSuccess|toast\.success|toast\.error)\s*\(\s*["']([^"']+)["']/g,
    /["']([^"']*(?:invalid|error|required|success|failed|not found)[^"']*)["']/gi,
    /throw new Error\s*\(\s*["']([^"']+)["']/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const msg = m[1].trim();
      if (msg && msg.length >= 5 && msg.length < 150 && !seen.has(msg)) {
        seen.add(msg);
        messages.push({ message: msg, file: filePath });
      }
    }
  }
  return messages;
}

/**
 * Extract API endpoints and HTTP calls
 */
function extractAPIEndpoints(filePath, content) {
  const endpoints = [];
  const patterns = [
    /(?:fetch|axios\.(?:get|post|put|delete|patch))\s*\(\s*[`'"]([^`'"]+)[`'"]/g,
    /\/api\/[a-zA-Z0-9/_-]+/g,
    /["'`](\/(?:api|v\d)\/[^"'`\s]+)["'`]/g,
  ];
  const seen = new Set();
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const ep = (m[1] || m[0]).replace(/^["'`]|["'`]$/g, '').trim();
      if (ep && ep.startsWith('/') && ep.length < 150 && !seen.has(ep)) {
        seen.add(ep);
        endpoints.push({ endpoint: ep, file: filePath });
      }
    }
  }
  return endpoints;
}

/**
 * Extract validation rules (min, max, required, pattern)
 */
function extractValidationRules(filePath, content) {
  const rules = [];
  const patterns = [
    { re: /minLength\s*[=:]\s*(\d+)/g, type: 'minLength', value: (m) => m[1] },
    { re: /maxLength\s*[=:]\s*(\d+)/g, type: 'maxLength', value: (m) => m[1] },
    { re: /min\s*[=:]\s*(\d+)/g, type: 'min', value: (m) => m[1] },
    { re: /max\s*[=:]\s*(\d+)/g, type: 'max', value: (m) => m[1] },
    { re: /required\s*[=:]\s*true/g, type: 'required', value: () => 'true' },
    { re: /pattern\s*[=:]\s*["']([^"']+)["']/g, type: 'pattern', value: (m) => m[1] },
    { re: /\.(?:email|isEmail)\(\)/g, type: 'email', value: () => 'email format' },
  ];
  for (const { re, type, value } of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      rules.push({ type, value: value(m), file: filePath });
    }
  }
  return rules;
}

/**
 * Extract section and page titles (headings, title props) for accurate test steps.
 * Returns strings that appear as visible section/page names in the UI.
 */
function extractSectionTitles(filePath, content) {
  const titles = [];
  const seen = new Set();
  const isValid = (s) => {
    const t = s.trim();
    if (t.length < 2 || t.length > 50) return false;
    if (/^[\s\-_:]+$/.test(t)) return false;
    if (t.includes('\n')) return false;
    const words = t.split(/\s+/).length;
    if (words > 8) return false;
    if (/\.\s+[a-z]/.test(t)) return false;
    return true;
  };
  const add = (title) => {
    const n = title.trim();
    if (isValid(n) && !seen.has(n.toLowerCase())) {
      seen.add(n.toLowerCase());
      titles.push({ title: n, file: filePath });
    }
  };
  const patterns = [
    /<h[1-3][^>]*>\s*([^<]{1,80}?)<\/h[1-3]>/gi,
    /<title[^>]*>\s*([^<]{1,80}?)<\/title>/gi,
    /title\s*=\s*["']([^"']{1,50})["']/g,
    /label\s*=\s*["']([^"']{1,50})["']/g,
    /heading\s*=\s*["']([^"']{1,50})["']/gi,
    /sectionTitle\s*=\s*["']([^"']{1,50})["']/gi,
    />\s*([A-Z][A-Za-z0-9\s&\-]{1,45}?)\s*<\/(?:Section|Card|Panel|Box|Block)/g,
  ];
  for (const re of patterns) {
    let m;
    while ((m = re.exec(content)) !== null) {
      const raw = (m[1] || '').replace(/\s+/g, ' ').trim();
      if (raw) add(raw);
    }
  }
  return titles;
}

/**
 * Extract selectors (data-testid, aria-label, id) - enhanced version
 */
function extractSelectorsFromContent(filePath, content) {
  const selectors = [];
  const patternConfigs = [
    { re: /data-testid=["']([^"']+)["']/g, type: 'data-testid', selector: (v) => `[data-testid="${v}"]` },
    { re: /aria-label=["']([^"']+)["']/g, type: 'aria-label', selector: (v) => `[aria-label="${v}"]` },
    { re: /id=["']([a-zA-Z][a-zA-Z0-9_-]*)["']/g, type: 'id', selector: (v) => `#${v}` },
    { re: /name=["']([^"']+)["']/g, type: 'name', selector: (v) => `[name="${v}"]` },
    { re: /data-cy=["']([^"']+)["']/g, type: 'data-cy', selector: (v) => `[data-cy="${v}"]` },
  ];
  for (const { re, type, selector } of patternConfigs) {
    let m;
    while ((m = re.exec(content)) !== null) {
      selectors.push({
        type,
        value: m[1],
        selector: selector(m[1]),
        file: filePath
      });
    }
  }
  return selectors;
}

/**
 * Discover flows from file contents
 * @param {Object} fileContents - { filePath: content }
 * @param {Array} selectorHints - Existing selector hints from githubService
 * @returns {Object} Flow discovery context for prompt
 */
function discoverFlows(fileContents = {}, selectorHints = []) {
  const routes = [];
  const sectionTitles = [];
  const uiElements = [];
  const messages = [];
  const apiEndpoints = [];
  const validationRules = [];
  const toSelector = (h) => {
    const v = h.value;
    switch (h.type) {
      case 'data-testid': return `[data-testid="${v}"]`;
      case 'data-cy': return `[data-cy="${v}"]`;
      case 'aria-label': return `[aria-label="${v}"]`;
      case 'id': return `#${v}`;
      case 'name': return `[name="${v}"]`;
      default: return `[data-testid="${v}"]`;
    }
  };
  const selectors = [...selectorHints.map(h => ({
    type: h.type,
    value: h.value,
    selector: toSelector(h),
    file: h.file
  }))];

  for (const [filePath, content] of Object.entries(fileContents)) {
    if (!content || typeof content !== 'string') continue;
    routes.push(...extractRoutes(filePath, content));
    sectionTitles.push(...extractSectionTitles(filePath, content));
    uiElements.push(...extractUIElements(filePath, content));
    messages.push(...extractMessages(filePath, content));
    apiEndpoints.push(...extractAPIEndpoints(filePath, content));
    validationRules.push(...extractValidationRules(filePath, content));
    if (selectors.length < 50) {
      selectors.push(...extractSelectorsFromContent(filePath, content));
    }
  }

  // Deduplicate and limit
  const uniqueRoutes = [...new Map(routes.map(r => [r.path, r])).values()].slice(0, 30);
  const uniqueSectionTitles = [...new Map(sectionTitles.map(s => [s.title.toLowerCase(), s])).values()].slice(0, 30);
  const uniqueUI = [...new Map(uiElements.map(u => [`${u.type}:${u.text}`, u])).values()].slice(0, 40);
  const uniqueMessages = [...new Map(messages.map(m => [m.message, m])).values()].slice(0, 20);
  const uniqueAPI = [...new Map(apiEndpoints.map(e => [e.endpoint, e])).values()].slice(0, 25);

  return {
    routes: uniqueRoutes,
    sectionTitles: uniqueSectionTitles,
    uiElements: uniqueUI,
    messages: uniqueMessages,
    apiEndpoints: uniqueAPI,
    validationRules,
    selectors: selectors.slice(0, 50)
  };
}

/**
 * Derive a short page label from a route path (e.g. /analytics/overview -> "Overview (Analytics)")
 */
function routeToPageLabel(path) {
  const segments = path.replace(/^\//, '').split('/').filter(Boolean);
  if (segments.length === 0) return null;
  const last = segments[segments.length - 1];
  const name = last.charAt(0).toUpperCase() + last.slice(1).replace(/[-_](.)/g, (_, c) => ' ' + c.toUpperCase());
  if (segments.length === 1) return `${name}`;
  const parent = segments[segments.length - 2];
  const parentName = parent.charAt(0).toUpperCase() + parent.slice(1).replace(/[-_](.)/g, (_, c) => ' ' + c.toUpperCase());
  return `${name} (${parentName})`;
}

/**
 * Format flow discovery for prompt inclusion
 */
function formatFlowContextForPrompt(flowContext) {
  if (!flowContext || (!flowContext.routes?.length && !flowContext.sectionTitles?.length && !flowContext.uiElements?.length &&
      !flowContext.messages?.length && !flowContext.apiEndpoints?.length && !flowContext.selectors?.length)) {
    return null;
  }
  const parts = [];
  if (flowContext.routes?.length) {
    const routeLines = flowContext.routes.map(r => {
      const label = routeToPageLabel(r.path);
      return label ? `- \`${r.path}\` → ${label} (${r.file})` : `- \`${r.path}\` (${r.file})`;
    });
    parts.push('### Routes & suggested page names (use for navigation steps)\n' + routeLines.join('\n'));
  }
  if (flowContext.sectionTitles?.length) {
    parts.push('### Page and section titles (use these exact names in test steps)\n' + flowContext.sectionTitles.map(s =>
      `- "${s.title}" (${s.file})`
    ).join('\n'));
  }
  if (flowContext.uiElements?.length) {
    const byType = {};
    flowContext.uiElements.forEach(u => {
      if (!byType[u.type]) byType[u.type] = [];
      byType[u.type].push(u.text);
    });
    parts.push('### UI Elements (from code)\n' + Object.entries(byType).map(([type, texts]) =>
      `- **${type}**: ${[...new Set(texts)].slice(0, 15).map(t => `"${t}"`).join(', ')}`
    ).join('\n'));
  }
  if (flowContext.messages?.length) {
    parts.push('### Messages (errors, toasts, notifications)\n' + flowContext.messages.slice(0, 12).map(m =>
      `- "${m.message}"`
    ).join('\n'));
  }
  if (flowContext.apiEndpoints?.length) {
    parts.push('### API Endpoints\n' + flowContext.apiEndpoints.map(e =>
      `- \`${e.endpoint}\` (${e.file})`
    ).join('\n'));
  }
  if (flowContext.validationRules?.length) {
    const rules = flowContext.validationRules.slice(0, 15);
    parts.push('### Validation Rules\n' + rules.map(r =>
      `- ${r.type}: ${r.value}`
    ).join('\n'));
  }
  if (flowContext.selectors?.length) {
    parts.push('### Automation Selectors (use in steps)\n' + flowContext.selectors.slice(0, 35).map(s =>
      `- \`${s.selector}\` (${s.type}, ${s.file || 'unknown'})`
    ).join('\n'));
  }
  return parts.join('\n\n');
}

module.exports = {
  discoverFlows,
  formatFlowContextForPrompt,
  extractRoutes,
  extractSectionTitles,
  extractUIElements,
  extractMessages,
  extractAPIEndpoints,
  extractValidationRules,
  extractSelectorsFromContent
};
