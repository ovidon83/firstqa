// FirstQA Ovi AI Chrome Extension - Content Script

(function() {
  'use strict';
  
  console.log('🔧 FirstQA Content Script: Starting...');
  
  // Global state
  let qaPanel = null;
  let currentTicketData = null;
  let isCollapsed = false;
  let isLoading = false;
  let firstqaAPI = null;

  // FirstQA API class (embedded for reliability)
  class FirstQAAPI {
    constructor() {
      this.baseURL = 'https://www.firstqa.dev'; // Use production URL
      this.apiKey = null;
    }

    async init() {
      try {
        const result = await chrome.storage.local.get('firstqa_api_key');
        this.apiKey = result.firstqa_api_key;
      } catch (error) {
        console.error('Failed to load API key:', error);
      }
    }

    async generateAnalysis(ticketData) {
      try {
        // Try the new ticket endpoint first
        const analysis = await this.callTicketAnalysis(ticketData);
        return analysis;
      } catch (error) {
        console.error('Ticket analysis failed:', error);
        // Don't fallback to legacy API - just throw the error
        throw error;
      }
    }

    async callTicketAnalysis(ticketData) {
      console.log('🔍 Sending ticket data to API:', ticketData);
      
      // Extract data from the correct structure
      const requestData = {
        ticketId: ticketData.id || ticketData.ticketData?.id,
        title: ticketData.title || ticketData.ticketData?.title,
        description: ticketData.description || ticketData.ticketData?.description,
        comments: ticketData.comments || [],
        labels: ticketData.labels || [],
        platform: ticketData.platform,
        priority: ticketData.priority || 'medium',
        type: ticketData.type || 'story'
      };
      
      console.log('🔍 Processed request data:', requestData);
      
      const response = await fetch(`${this.baseURL}/api/analyze-ticket`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ API Error Response:', errorText);
        throw new Error(`API request failed: ${response.status} ${response.statusText}`);
      }

      const result = await response.json();
      
      // Return the new format structure directly from the API
      return result.data || result;
    }
  }
  
  // Ticket detection functions (embedded from utils.js)
  function detectTicket() {
    const url = window.location.href;
    
    if (url.includes('linear.app')) {
      return detectLinearTicket();
    } else if (url.includes('atlassian.net')) {
      return detectJiraTicket();
    }
    
    return null;
  }

  function detectLinearTicket() {
    // Check if we're on an issue page (Linear uses /issue/ID/ format)
    const issuePattern = /\/issue\/([A-Z]+-\d+)/;
    const match = window.location.pathname.match(issuePattern);
    
    if (!match) {
      return null;
    }

    const ticketId = match[1];

    // Try multiple selectors for title
    const titleSelectors = [
      '[data-testid="issue-title"]',
      '.issue-title',
      'h1[contenteditable="true"]',
      '.title-input',
      '[aria-label*="title"]',
      'h1', // Fallback to any h1
      '[data-testid*="title"]',
      '.title',
      'h1[data-testid*="title"]',
      '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
      'h1:first-of-type'
    ];
    
    // Try multiple selectors for description (updated for current Linear DOM)
    const descriptionSelectors = [
      // EXACT Linear selectors based on real DOM (2024+)
      '[aria-label="Issue description"].ProseMirror.editor',
      '[aria-label="Issue description"][contenteditable="true"]',
      '[role="textbox"].ProseMirror.editor',
      '[role="textbox"][aria-label="Issue description"]',
      '.ProseMirror.editor[contenteditable="true"]',
      
      // Fallback selectors
      '[data-slot="content"] .ProseMirror',
      '[role="textbox"]',
      '.ProseMirror-doc',
      '[data-testid="issue-description"]',
      '.issue-description',
      '.ProseMirror',
      '[data-testid="editor-content"]',
      '.description-content',
      '[data-testid*="description"]',
      '.description',
      '[data-testid="issue.views.field.rich-text.description"]',
      '.ak-renderer-document',
      'div[data-testid*="description"]',
      
      // Fallback selectors
      'main [contenteditable="true"]',
      'main .ProseMirror'
    ];

    const title = getElementText(titleSelectors);
    const description = getElementText(descriptionSelectors);

    console.log('🔍 Linear ticket detection:', {
      ticketId,
      title: title ? title.substring(0, 50) + '...' : null,
      description: description ? description.substring(0, 50) + '...' : null,
      fullDescriptionLength: description ? description.length : 0
    });

    console.log('🔍 FULL LINEAR DESCRIPTION:', description);

    // Debug: Log all h1 elements on the page
    const allH1s = document.querySelectorAll('h1');
    console.log('🔍 All h1 elements found:', Array.from(allH1s).map(h1 => ({
      text: h1.textContent?.substring(0, 50),
      className: h1.className,
      testId: h1.getAttribute('data-testid')
    })));

    // If we have a ticket ID, try to get title from the page text
    if (!title && ticketId) {
      // Look for any text that might be the title
      const pageText = document.body.textContent;
      const lines = pageText.split('\n').map(line => line.trim()).filter(line => line.length > 10);
      const possibleTitle = lines.find(line => 
        line.length > 10 && 
        line.length < 100 && 
        !line.includes('Linear') && 
        !line.includes('firstqa') &&
        !line.includes('FIR-5') &&
        !line.includes('Backlog') &&
        !line.includes('Set priority') &&
        !line.includes('Assign')
      );
      
      if (possibleTitle) {
        console.log('🔍 Found possible title from page text:', possibleTitle);
        return {
          platform: 'linear',
          ticketData: {
            id: ticketId,
            title: possibleTitle,
            description: description ? description.trim() : ''
          }
        };
      }
    }

    // If we still don't have a title but have a ticket ID, use a fallback
    if (!title && ticketId) {
      console.log('🔍 Using fallback title for ticket:', ticketId);
      return {
        platform: 'linear',
        ticketData: {
          id: ticketId,
          title: `Ticket ${ticketId}`, // Fallback title
          description: description ? description.trim() : ''
        }
      };
    }

    if (title) {
      return {
        platform: 'linear',
        ticketData: {
          id: ticketId,
          title: title.trim(),
          description: description ? description.trim() : ''
        }
      };
    }

    return null;
  }

  function detectJiraTicket() {
    // Check if we're on an issue page
    const issuePattern = /\/browse\/([A-Z]+-\d+)/;
    const match = window.location.pathname.match(issuePattern);
    
    if (!match) {
      return null;
    }

    const ticketId = match[1];

    // Try multiple selectors for title
    const titleSelectors = [
      '[data-testid="issue.views.issue-base.foundation.summary.heading"]',
      '#summary-val',
      '.summary',
      'h1[data-test-id*="issue-title"]',
      '[aria-label*="Summary"]'
    ];
    
    // Try multiple selectors for description (updated for modern Jira)
    const descriptionSelectors = [
      // Modern Jira selectors (2024+)
      '[data-testid="issue.views.field.rich-text.description"] .ak-renderer-document',
      '[data-testid="issue.views.field.rich-text.description"]',
      '.ak-renderer-document',
      '[data-testid*="description"] .ak-renderer-document',
      '[data-testid*="description"]',
      
      // Legacy Jira selectors
      '#description-val',
      '.description',
      '.description-content',
      '[id*="description"]',
      
      // Fallback selectors for any rich text content
      'main [data-testid*="description"]',
      'main .ak-renderer-document',
      '[role="main"] [data-testid*="description"]'
    ];

    const title = getElementText(titleSelectors);
    const description = getElementText(descriptionSelectors);

    if (title) {
      return {
        platform: 'jira',
        ticketData: {
          id: ticketId,
          title: title.trim(),
          description: description ? description.trim() : ''
        }
      };
    }

    return null;
  }

  function getElementText(selectors) {
    console.log('🔍 getElementText called with selectors:', selectors);
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      console.log(`🔍 Checking selector "${selector}":`, element ? 'FOUND' : 'NOT FOUND');
      
      if (element) {
        // Try to get text content, handle rich text editors
        let text = '';
        
        // For ProseMirror editors (Linear), get all text content including from child elements
        if (element.classList.contains('ProseMirror') || element.querySelector('.ProseMirror')) {
          const proseMirror = element.classList.contains('ProseMirror') ? element : element.querySelector('.ProseMirror');
          if (proseMirror) {
            text = proseMirror.textContent || proseMirror.innerText || '';
          }
        }
        // For Atlassian Renderer (Jira), get content from the document renderer
        else if (element.classList.contains('ak-renderer-document') || element.querySelector('.ak-renderer-document')) {
          const renderer = element.classList.contains('ak-renderer-document') ? element : element.querySelector('.ak-renderer-document');
          if (renderer) {
            text = renderer.textContent || renderer.innerText || '';
          }
        }
        // Default text extraction
        else {
          text = element.textContent || element.innerText || '';
        }
        
        // Clean up the text
        text = text.trim();
        
        // Only return if we have substantial content (more than just whitespace/short fragments)
        if (text && text.length > 5) {
          console.log(`✅ Found content with selector "${selector}": ${text.substring(0, 100)}...`);
          return text;
        }
      }
    }
    return null;
  }
  
  // Debounced function to check for ticket changes
  const debouncedTicketCheck = debounce(checkForTicketChanges, 1000);
  
  /**
   * Initialize the extension
   */
  async function init() {
    console.log('🔧 FirstQA Content Script: init() called');
    try {
      // Initialize FirstQA API
      console.log('🔧 FirstQA Content Script: Initializing FirstQA API...');
      await initFirstQAAPI();
      
      // Only detect ticket data, but NEVER create panel automatically
      console.log('🔧 FirstQA Content Script: Checking and setting up panel...');
      checkAndSetupPanel();
      
      // Listen for messages from popup
      console.log('🔧 FirstQA Content Script: Setting up message listeners...');
      setupMessageListeners();
      console.log('🔧 FirstQA Content Script: init() completed successfully');
    } catch (error) {
      console.error('🔧 FirstQA Content Script: init() error:', error);
    }
  }
  
  /**
   * Check if current page has a ticket and setup panel accordingly
   */
  function checkAndSetupPanel() {
    const ticketInfo = detectTicket();
    
    console.log('🔍 Ticket detection result:', ticketInfo);
    
    if (ticketInfo) {
      // Only update currentTicketData if a ticket is detected
      currentTicketData = ticketInfo.ticketData;
      console.log('📋 Current ticket data:', currentTicketData);
      // NEVER create or show the panel automatically.
      // Panel will only be created when popup explicitly requests it.
    } else {
      console.log('❌ No ticket detected on this page');
      currentTicketData = null; // Clear ticket data if no ticket is found
    }
  }
  
  /**
   * Setup observers for dynamic content changes
   */
  function setupPageObservers() {
    // Observer for DOM changes
    const observer = new MutationObserver(() => {
      debouncedTicketCheck();
    });
    
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false
    });
  }
  
  /**
   * Setup navigation listeners for SPA routing
   */
  function setupNavigationListeners() {
    // Listen for browser navigation
    window.addEventListener('popstate', () => {
      setTimeout(checkAndSetupPanel, 500);
    });
    
    // Listen for programmatic navigation (pushState/replaceState)
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;
    
    history.pushState = function() {
      originalPushState.apply(history, arguments);
      setTimeout(checkAndSetupPanel, 500);
    };
    
    history.replaceState = function() {
      originalReplaceState.apply(history, arguments);
      setTimeout(checkAndSetupPanel, 500);
    };
  }
  
  /**
   * Check for ticket changes (called by debounced function)
   */
  function checkForTicketChanges() {
    if (qaPanel) {
      checkAndSetupPanel();
    }
  }
  
  /**
   * Create the floating panel UI
   */
  function createPanel() {
    if (qaPanel) {
      return; // Panel already exists
    }
    
    qaPanel = document.createElement('div');
    qaPanel.id = 'qa-copilot-sidebar';
    qaPanel.innerHTML = getPanelHTML();
    
    document.body.appendChild(qaPanel);
    
    // Setup event listeners
    setupPanelEventListeners();
  }
  
  /**
   * Get the HTML structure for the panel
   */
  function getPanelHTML() {
    return `
      <div class="qa-header">
        <h3 class="qa-title">
          🤖 QA Copilot
        </h3>
        <button class="qa-toggle" title="Toggle panel">
          ${isCollapsed ? '▲' : '▼'}
        </button>
      </div>
      <div class="qa-content">
        <div class="qa-loading">
          <div class="qa-spinner"></div>
          <div>Analyzing ticket...</div>
        </div>
      </div>
    `;
  }
  
  /**
   * Setup event listeners for the panel
   */
  function setupPanelEventListeners() {
    const header = qaPanel.querySelector('.qa-header');
    const toggle = qaPanel.querySelector('.qa-toggle');
    
    // Toggle panel collapse/expand
    header.addEventListener('click', togglePanel);
    toggle.addEventListener('click', (e) => {
      e.stopPropagation();
      togglePanel();
    });
  }
  
  /**
   * Toggle panel collapsed state
   */
  function togglePanel() {
    isCollapsed = !isCollapsed;
    
    if (isCollapsed) {
      qaPanel.classList.add('collapsed');
    } else {
      qaPanel.classList.remove('collapsed');
    }
    
    const toggle = qaPanel.querySelector('.qa-toggle');
    toggle.textContent = isCollapsed ? '▲' : '▼';
  }
  
  /**
   * Load QA insights from the API
   */
  async function loadQAInsights(ticketData) {
    if (isLoading) return;
    
    isLoading = true;
    showLoadingState();
    
    try {
      const insights = await getQAInsights(ticketData);
      displayInsights(insights);
    } catch (error) {
      console.error('Failed to load QA insights:', error);
      showErrorState(error.message);
    } finally {
      isLoading = false;
    }
  }
  
  /**
   * Show loading state
   */
  function showLoadingState() {
    const content = qaPanel.querySelector('.qa-content');
    content.innerHTML = `
      <div class="qa-loading">
        <div class="qa-spinner"></div>
        <div>Analyzing ticket...</div>
      </div>
    `;
  }
  
  /**
   * Show error state
   */
  function showErrorState(errorMessage) {
    const content = qaPanel.querySelector('.qa-content');
    content.innerHTML = `
      <div class="qa-error">
        <strong>Failed to load insights:</strong><br>
        ${errorMessage}
      </div>
      <div class="qa-no-ticket">
        <p>Please try refreshing the page or check your connection.</p>
      </div>
    `;
  }
  
  /**
   * Show ready to analyze state
   */
  function showReadyToAnalyzeState() {
    const content = qaPanel.querySelector('.qa-content');
    content.innerHTML = `
      <div class="qa-ready">
        <h3>🎯 Ready to Analyze</h3>
        <p>Ticket detected: <strong>${currentTicketData.id}</strong></p>
        <p>Click the extension icon to generate QA analysis.</p>
        <button class="qa-analyze-button" id="qa-analyze-btn">
          🔍 Analyze Ticket
        </button>
      </div>
    `;
    
    // Setup analyze button
    const analyzeBtn = content.querySelector('#qa-analyze-btn');
    analyzeBtn.addEventListener('click', () => {
      if (currentTicketData) {
        loadQAInsights(currentTicketData);
      }
    });
  }

  /**
   * Show no ticket detected state
   */
  function showNoTicketState() {
    const content = qaPanel.querySelector('.qa-content');
    content.innerHTML = `
      <div class="qa-no-ticket">
        <h3>No ticket detected</h3>
        <p>Navigate to a Linear or Jira ticket to get AI-powered QA insights.</p>
      </div>
    `;
  }
  
  /**
   * Display the QA insights in the panel
   */
  function displayInsights(insights) {
    console.log('🔍 displayInsights called with data:', insights);
    console.log('🔍 Analysis data structure:', {
      hasTopQuestions: !!insights.topQuestions,
      hasKeyRisks: !!insights.keyRisks,
      hasTestRecipe: !!insights.testRecipe,
      testRecipeType: typeof insights.testRecipe,
      hasSmartQuestions: !!insights.smartQuestions,
      hasRiskAreas: !!insights.riskAreas,
      hasReadyForDevelopmentScore: insights.readyForDevelopmentScore !== undefined
    });
    
    const content = qaPanel.querySelector('.qa-content');
    
    let html = '';
    
    // Title
    html += `
      <div class="qa-header">
        <h3 class="qa-title">${insights.title || 'Definition of Ready Analysis'}</h3>
      </div>
    `;
    
    // Top Questions section
    if (insights.topQuestions && insights.topQuestions.length > 0) {
      html += `
        <div class="qa-section questions">
          <h4 class="qa-section-title">🧠 Top Questions</h4>
          <ol class="qa-list">
            ${insights.topQuestions.map(question => 
              `<li class="qa-list-item">${escapeHtml(question)}</li>`
            ).join('')}
          </ol>
        </div>
      `;
    }
    
    // Key Risks section
    if (insights.keyRisks && insights.keyRisks.length > 0) {
      html += `
        <div class="qa-section risks">
          <h4 class="qa-section-title">⚠️ Key Risks</h4>
          <ol class="qa-list">
            ${insights.keyRisks.map(risk => 
              `<li class="qa-list-item">${escapeHtml(risk)}</li>`
            ).join('')}
          </ol>
        </div>
      `;
    }
    
    // Test Recipe section (new format)
    if (insights.testRecipe && insights.testRecipe.length > 0) {
      html += `
        <div class="qa-section tests">
          <h4 class="qa-section-title">🧪 Test Recipe</h4>
          <div class="qa-test-scenarios">
            ${insights.testRecipe.map(test => 
              `<div class="qa-test-scenario">
                <span class="qa-test-icon">${test.icon}</span>
                <span class="qa-test-text">${escapeHtml(test.scenario)}</span>
                <span class="qa-test-category">– <em>${test.category}</em></span>
              </div>`
            ).join('')}
          </div>
        </div>
      `;
    }
    
    // Ready for Development Score
    if (insights.readyForDevelopmentScore !== undefined) {
      const score = insights.readyForDevelopmentScore;
      const scoreClass = score >= 4 ? 'high' : score >= 3 ? 'medium' : 'low';
      html += `
        <div class="qa-section score">
          <h4 class="qa-section-title">📊 Ready for Development Score</h4>
          <div class="qa-score ${scoreClass}">
            <span class="qa-score-value">${score}/5</span>
            <div class="qa-score-bar">
              <div class="qa-score-fill" style="width: ${score * 20}%"></div>
            </div>
          </div>
        </div>
      `;
    }
    
    // Missing Info section (if applicable)
    if (insights.missingInfo && insights.missingInfo.length > 0) {
      html += `
        <div class="qa-section missing">
          <h4 class="qa-section-title">❌ Missing Information</h4>
          <ul class="qa-list">
            ${insights.missingInfo.map(info => 
              `<li class="qa-list-item">${escapeHtml(info)}</li>`
            ).join('')}
          </ul>
        </div>
      `;
    }
    
    // Tip section
    if (insights.tip) {
      html += `
        <div class="qa-section tip">
          <h4 class="qa-section-title">🧠 Tip</h4>
          <p class="qa-tip">${escapeHtml(insights.tip)}</p>
        </div>
      `;
    }
    
    // Legacy format support (fallback)
    if (insights.smartQuestions && insights.smartQuestions.length > 0) {
      html += `
        <div class="qa-section questions">
          <h4 class="qa-section-title">🤔 Smart Questions</h4>
          <ul class="qa-list">
            ${insights.smartQuestions.map(question => 
              `<li class="qa-list-item">${escapeHtml(question)}</li>`
            ).join('')}
          </ul>
        </div>
      `;
    }
    
    // Legacy format support (fallback)
    if (insights.riskAreas && insights.riskAreas.length > 0) {
      html += `
        <div class="qa-section risks">
          <h4 class="qa-section-title">⚠️ Risk Areas</h4>
          <ul class="qa-list">
            ${insights.riskAreas.map(risk => 
              `<li class="qa-list-item">${escapeHtml(risk)}</li>`
            ).join('')}
          </ul>
        </div>
      `;
    }
    
    // Legacy format support (fallback)
    if (insights.testRecipe && typeof insights.testRecipe === 'object' && insights.testRecipe.critical) {
      const { critical = [], general = [], edgeCases = [] } = insights.testRecipe;
      
      if (critical.length > 0) {
        html += `
          <div class="qa-section tests critical">
            <h4 class="qa-section-title">🚨 Critical Test Cases</h4>
            <ul class="qa-list">
              ${critical.map(testCase => 
                `<li class="qa-list-item">${escapeHtml(testCase)}</li>`
              ).join('')}
            </ul>
          </div>
        `;
      }
      
      if (general.length > 0) {
        html += `
          <div class="qa-section tests general">
            <h4 class="qa-section-title">🧪 General Test Cases</h4>
            <ul class="qa-list">
              ${general.map(testCase => 
                `<li class="qa-list-item">${escapeHtml(testCase)}</li>`
              ).join('')}
            </ul>
          </div>
        `;
      }
      
      if (edgeCases.length > 0) {
        html += `
          <div class="qa-section tests edge">
            <h4 class="qa-section-title">🔍 Edge Cases</h4>
            <ul class="qa-list">
              ${edgeCases.map(testCase => 
                `<li class="qa-list-item">${escapeHtml(testCase)}</li>`
              ).join('')}
            </ul>
          </div>
        `;
      }
    }
    
    // Copy button
    html += `
      <button class="qa-copy-button" id="qa-copy-btn">
        📋 Copy to Clipboard
      </button>
    `;
    
    // Insert Comment button
    html += `
      <button class="qa-insert-button" id="qa-insert-btn">
        💬 Insert as Comment
      </button>
    `;
    
    content.innerHTML = html;
    
    // Setup copy button
    const copyBtn = content.querySelector('#qa-copy-btn');
    copyBtn.addEventListener('click', () => copyInsightsToClipboard(insights));
    
    // Setup insert comment button
    const insertBtn = content.querySelector('#qa-insert-btn');
    insertBtn.addEventListener('click', async () => {
      try {
        insertBtn.disabled = true;
        insertBtn.textContent = '💬 Inserting...';
        
        const success = await insertComment(insights);
        
        if (success) {
          insertBtn.textContent = '✅ Comment Inserted!';
          setTimeout(() => {
            insertBtn.textContent = '💬 Insert as Comment';
            insertBtn.disabled = false;
          }, 2000);
        } else {
          insertBtn.textContent = '❌ Failed to Insert';
          setTimeout(() => {
            insertBtn.textContent = '💬 Insert as Comment';
            insertBtn.disabled = false;
          }, 2000);
        }
      } catch (error) {
        console.error('Failed to insert comment:', error);
        insertBtn.textContent = '❌ Error';
        setTimeout(() => {
          insertBtn.textContent = '💬 Insert as Comment';
          insertBtn.disabled = false;
        }, 2000);
      }
    });
  }
  
  /**
   * Copy insights to clipboard as markdown
   */
  async function copyInsightsToClipboard(insights) {
    console.log('🔍 copyInsightsToClipboard called with data:', insights);
    console.log('🔍 Copy data structure:', {
      hasTopQuestions: !!insights.topQuestions,
      hasKeyRisks: !!insights.keyRisks,
      hasTestRecipe: !!insights.testRecipe,
      testRecipeType: typeof insights.testRecipe,
      hasSmartQuestions: !!insights.smartQuestions,
      hasRiskAreas: !!insights.riskAreas,
      hasReadyForDevelopmentScore: insights.readyForDevelopmentScore !== undefined
    });
    
    try {
      const markdown = formatAsMarkdown(insights);
      console.log('📋 Generated markdown:', markdown.substring(0, 200) + '...');
      
      const success = await copyToClipboard(markdown);
      
      if (success) {
        console.log('✅ Successfully copied to clipboard');
        // Show a temporary notification
        showNotification('✅ Analysis copied to clipboard!', 'success');
      } else {
        throw new Error('Copy failed');
      }
    } catch (error) {
      console.error('Copy failed:', error);
      showNotification('❌ Failed to copy analysis', 'error');
    }
  }

  /**
   * Format insights as HTML for rich text editor
   */
  function formatAsMarkdown(insights) {
    console.log('🔍 formatAsMarkdown called with data:', insights);
    console.log('🔍 Format data structure:', {
      hasQaQuestions: !!insights.qaQuestions,
      hasTopQuestions: !!insights.topQuestions,
      hasKeyRisks: !!insights.keyRisks,
      hasTestRecipe: !!insights.testRecipe,
      testRecipeType: typeof insights.testRecipe,
      hasSmartQuestions: !!insights.smartQuestions,
      hasRiskAreas: !!insights.riskAreas,
      hasReadyForDevelopmentScore: insights.readyForDevelopmentScore !== undefined
    });

    // Format analysis for Linear (HTML format)
    let html = `<h2>🤖 QA Analysis</h2>`;
    
    // Check if this is minimal mode - show simplified format
    if (insights.minimalMode) {
      // Simplified format for minimal/missing info tickets
      html += `<h3>📊 TICKET READINESS</h3>`;
      html += `<p><strong>Now:</strong> ${insights.initialReadinessScore}/5 ${getScoreEmoji(insights.initialReadinessScore)} (${getScoreLabel(insights.initialReadinessScore)})</p>`;
      html += `<p><strong>With Ovi's analysis:</strong> ${insights.readyForDevelopmentScore}/5 ${getScoreEmoji(insights.readyForDevelopmentScore)} (${getScoreLabel(insights.readyForDevelopmentScore)})</p>`;
      
      html += `<h3>❌ NOT READY FOR DEVELOPMENT</h3>`;
      html += `<p><strong>Why:</strong> This ticket lacks essential information needed for development.</p>`;
      
      if (insights.scoreImpactFactors && insights.scoreImpactFactors.length > 0) {
        html += `<h3>🔍 WHAT'S MISSING</h3>`;
        html += `<ul>`;
        insights.scoreImpactFactors.forEach(factor => {
          html += `<li>${escapeHtml(factor)}</li>`;
        });
        html += `</ul>`;
      }
      
      if (insights.message) {
        html += `<h3>💡 RECOMMENDATION</h3>`;
        html += `<p>${escapeHtml(insights.message)}</p>`;
      }
    } else {
      // Full detailed format for complete tickets
      
      // User Value (new section)
      if (insights.userValue) {
        html += `<h3>🎯 USER VALUE</h3>`;
        html += `<p><strong>Level:</strong> ${insights.userValue.level}</p>`;
        html += `<p><strong>Summary:</strong> ${insights.userValue.summary}</p>`;
      }

      // Readiness Assessment
      html += `<h3>📊 TICKET READINESS</h3>`;
      html += `<p><strong>Now:</strong> ${insights.initialReadinessScore}/5 ${getScoreEmoji(insights.initialReadinessScore)} (${getScoreLabel(insights.initialReadinessScore)})</p>`;
      html += `<p><strong>With Ovi's analysis:</strong> ${insights.readyForDevelopmentScore}/5 ${getScoreEmoji(insights.readyForDevelopmentScore)} (${getScoreLabel(insights.readyForDevelopmentScore)})</p>`;
      
      // Improvements Needed
      if (insights.improvementsNeeded && insights.improvementsNeeded.length > 0) {
        html += `<h3>🔧 IMPROVEMENTS NEEDED</h3>`;
        html += `<ol>`;
        insights.improvementsNeeded.forEach(improvement => {
          html += `<li>${escapeHtml(improvement)}</li>`;
        });
        html += `</ol>`;
      }

      // QA Questions
      const questions = insights.qaQuestions || [];
      html += `<h3>🧠 QA Questions</h3>`;
      if (questions.length > 0) {
        html += `<ol>`;
        questions.slice(0, 5).forEach((q, i) => {
          const cleanQuestion = q.replace(/^🧠\s*/, '');
          html += `<li>${escapeHtml(cleanQuestion)}</li>`;
        });
        html += `</ol>`;
      } else {
        html += `<p>No specific questions identified.</p>`;
      }

      // Key Risks
      html += `<h3>⚠️ Key Risks</h3>`;
      if (insights.keyRisks && insights.keyRisks.length > 0) {
        html += `<ol>`;
        insights.keyRisks.slice(0, 5).forEach((r, i) => {
          const cleanRisk = r.replace(/^⚠️\s*/, '');
          html += `<li>${escapeHtml(cleanRisk)}</li>`;
        });
        html += `</ol>`;
      } else {
        html += `<p>No significant risks identified.</p>`;
      }

      // Test Recipe
      html += `<h3>🧪 Test Recipe</h3>`;
      if (insights.testRecipe && insights.testRecipe.length > 0) {
        html += `<table style="border-collapse: collapse; width: 100%; margin: 10px 0;">`;
        html += `<thead><tr style="background-color: #f5f5f5;">`;
        html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Scenario</th>`;
        html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Steps</th>`;
        html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Expected</th>`;
        html += `<th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Priority</th>`;
        html += `</tr></thead><tbody>`;

        insights.testRecipe.slice(0, 5).forEach(test => {
          html += `<tr>`;
          html += `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHtml(test.scenario || '')}</td>`;
          html += `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHtml(test.steps || '')}</td>`;
          html += `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHtml(test.expected || '')}</td>`;
          html += `<td style="border: 1px solid #ddd; padding: 8px;">${escapeHtml(test.priority || '')}</td>`;
          html += `</tr>`;
        });

        html += `</tbody></table>`;
      } else {
        html += `<p>No specific test scenarios identified.</p>`;
      }
    }

    return html;
  }

  /**
   * Copy text to clipboard
   */
  async function copyToClipboard(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error('Failed to copy to clipboard:', error);
      return false;
    }
  }
  
  /**
   * Show a temporary notification
   */
  function showNotification(message, type = 'info') {
    // Remove existing notification
    const existingNotification = document.querySelector('.firstqa-notification');
    if (existingNotification) {
      existingNotification.remove();
    }
    
    // Create notification element
    const notification = document.createElement('div');
    notification.className = `firstqa-notification firstqa-notification-${type}`;
    notification.innerHTML = `
      <div class="firstqa-notification-content">
        <span class="firstqa-notification-message">${message}</span>
        <button class="firstqa-notification-close">&times;</button>
      </div>
    `;
    
    // Add styles
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      z-index: 10000;
      background: ${type === 'success' ? '#4CAF50' : type === 'error' ? '#f44336' : '#2196F3'};
      color: white;
      padding: 12px 16px;
      border-radius: 4px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 14px;
      max-width: 300px;
      animation: slideIn 0.3s ease-out;
    `;
    
    // Add animation styles
    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideIn {
        from { transform: translateX(100%); opacity: 0; }
        to { transform: translateX(0); opacity: 1; }
      }
      .firstqa-notification-content {
        display: flex;
        align-items: center;
        justify-content: space-between;
      }
      .firstqa-notification-close {
        background: none;
        border: none;
        color: white;
        font-size: 18px;
        cursor: pointer;
        margin-left: 8px;
        padding: 0;
        line-height: 1;
      }
      .firstqa-notification-close:hover {
        opacity: 0.8;
      }
    `;
    document.head.appendChild(style);
    
    // Add to page
    document.body.appendChild(notification);
    
    // Auto-remove after 3 seconds
    setTimeout(() => {
      if (notification.parentNode) {
        notification.remove();
      }
    }, 3000);
    
    // Close button functionality
    const closeBtn = notification.querySelector('.firstqa-notification-close');
    closeBtn.addEventListener('click', () => {
      notification.remove();
    });
  }

  /**
   * Escape HTML to prevent XSS
   */
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  /**
   * Initialize FirstQA API
   */
  async function initFirstQAAPI() {
    try {
      firstqaAPI = new FirstQAAPI();
      await firstqaAPI.init();
      console.log('✅ FirstQA API initialized successfully');
    } catch (error) {
      console.error('Failed to initialize FirstQA API:', error);
    }
  }

  /**
   * Load a script dynamically
   */
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.head.appendChild(script);
    });
  }

  /**
   * Setup message listeners for popup communication
   */
  function setupMessageListeners() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      // Immediately respond if the API isn't initialized yet
      if (!firstqaAPI && request.action !== 'checkTicketPage') {
        console.log('❌ API not initialized yet, sending error response');
        sendResponse({ success: false, error: 'Extension not fully initialized. Please refresh the page.' });
        return false;
      }

      // Handle the message
      handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  /**
   * Handle messages from popup and background
   */
  async function handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case 'isReady':
          // Check if the extension is fully initialized
          sendResponse(!!firstqaAPI);
          break;
          
        case 'checkTicketPage':
          const ticketInfo = detectTicket();
          sendResponse(!!ticketInfo);
          break;
          
        case 'analyzeAndInsertComment':
          const ticketData = await detectTicket();
          if (!ticketData) {
            sendResponse({ success: false, error: 'No ticket detected on this page' });
            return;
          }
          
          console.log('🔍 Starting analysis and comment insertion for:', ticketData.ticketData.id);
          
          // Analyze the ticket
          const analysis = await analyzeTicket(ticketData.ticketData);
          if (!analysis) {
            sendResponse({ success: false, error: 'Analysis failed' });
            return;
          }
          
                      // Insert and submit the comment using platform-specific formatting
            const insertResult = await insertComment(analysis);
          
          if (insertResult) {
            sendResponse({ 
              success: true, 
              ticketId: ticketData.ticketData.id,
              analysis: analysis 
            });
          } else {
            sendResponse({ success: false, error: 'Failed to insert comment' });
          }
          break;

        case 'getCurrentTicketId':
          const currentTicket = detectTicket();
          const ticketId = currentTicket?.ticketData?.id || null;
          console.log('🔍 getCurrentTicketId called, result:', ticketId);
          sendResponse(ticketId);
          break;

        case 'getTicketInfo':
          const ticketInfo2 = detectTicket();
          console.log('🔍 getTicketInfo called, result:', ticketInfo2);
          if (ticketInfo2 && ticketInfo2.ticketData) {
            // Return the ticket data in the format expected by the popup
            const response = {
              id: ticketInfo2.ticketData.id,
              title: ticketInfo2.ticketData.title,
              description: ticketInfo2.ticketData.description,
              platform: ticketInfo2.platform
            };
            console.log('✅ Sending ticket info to popup:', response);
            sendResponse(response);
          } else {
            console.log('❌ No ticket info found, sending null');
            sendResponse(null);
          }
          break;

        case 'analyzeTicket':
          const analysis2 = await analyzeTicket(request.ticketData);
          sendResponse({ success: true, analysis: analysis2 });
          break;

        case 'insertComment':
          const success = await insertComment(request.analysis);
          sendResponse({ success });
          break;

        default:
          sendResponse({ success: false, error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Message handler error:', error);
      sendResponse({ success: false, error: error.message });
    }
  }

  /**
   * Analyze ticket using FirstQA API
   */
  async function analyzeTicket(ticketData) {
    if (!firstqaAPI) {
      throw new Error('FirstQA API not initialized');
    }

    // Extract additional data from the page
    const enrichedData = await enrichTicketData(ticketData);
    
    // Generate analysis
    const analysis = await firstqaAPI.generateAnalysis(enrichedData);
    
    console.log('🔍 analyzeTicket result:', analysis);
    console.log('🔍 Analysis structure:', {
      hasTopQuestions: !!analysis.topQuestions,
      hasKeyRisks: !!analysis.keyRisks,
      hasTestRecipe: !!analysis.testRecipe,
      testRecipeType: typeof analysis.testRecipe,
      hasSmartQuestions: !!analysis.smartQuestions,
      hasRiskAreas: !!analysis.riskAreas,
      hasReadyForDevelopmentScore: analysis.readyForDevelopmentScore !== undefined
    });
    
    return analysis;
  }

  /**
   * Enrich ticket data with additional information from the page
   */
  async function enrichTicketData(ticketData) {
    const enriched = { ...ticketData };
    
    // Extract comments
    enriched.comments = extractComments();
    
    // Extract labels/tags
    enriched.labels = extractLabels();
    
    // Extract priority
    enriched.priority = extractPriority();
    
    // Extract ticket type
    enriched.type = extractTicketType();
    
    // Extract assignee
    enriched.assignee = extractAssignee();
    
    // Ensure platform is set
    if (!enriched.platform) {
      enriched.platform = window.location.href.includes('linear.app') ? 'linear' : 'jira';
    }
    
    return enriched;
  }

  /**
   * Extract comments from the ticket page
   */
  function extractComments() {
    const comments = [];
    
    if (window.location.href.includes('linear.app')) {
      // Linear comments
      const commentElements = document.querySelectorAll('[data-testid="comment"]');
      commentElements.forEach((element, index) => {
        if (index < 3) { // Only last 3 comments
          const text = element.textContent || element.innerText || '';
          if (text.trim()) {
            comments.push(text.trim());
          }
        }
      });
    } else if (window.location.href.includes('atlassian.net')) {
      // Jira comments
      const commentElements = document.querySelectorAll('.activity-comment');
      commentElements.forEach((element, index) => {
        if (index < 3) { // Only last 3 comments
          const text = element.textContent || element.innerText || '';
          if (text.trim()) {
            comments.push(text.trim());
          }
        }
      });
    }
    
    return comments;
  }

  /**
   * Extract labels/tags from the ticket page
   */
  function extractLabels() {
    const labels = [];
    
    if (window.location.href.includes('linear.app')) {
      // Linear labels
      const labelElements = document.querySelectorAll('[data-testid="label"]');
      labelElements.forEach(element => {
        const text = element.textContent || element.innerText || '';
        if (text.trim()) {
          labels.push(text.trim());
        }
      });
    } else if (window.location.href.includes('atlassian.net')) {
      // Jira labels
      const labelElements = document.querySelectorAll('.aui-label');
      labelElements.forEach(element => {
        const text = element.textContent || element.innerText || '';
        if (text.trim()) {
          labels.push(text.trim());
        }
      });
    }
    
    return labels;
  }

  /**
   * Extract priority from the ticket page
   */
  function extractPriority() {
    if (window.location.href.includes('linear.app')) {
      // Linear priority
      const priorityElement = document.querySelector('[data-testid="priority"]');
      if (priorityElement) {
        const text = priorityElement.textContent || priorityElement.innerText || '';
        return text.trim().toLowerCase();
      }
    } else if (window.location.href.includes('atlassian.net')) {
      // Jira priority
      const priorityElement = document.querySelector('[data-testid="priority-field"]');
      if (priorityElement) {
        const text = priorityElement.textContent || priorityElement.innerText || '';
        return text.trim().toLowerCase();
      }
    }
    
    return 'medium';
  }

  /**
   * Extract ticket type from the ticket page
   */
  function extractTicketType() {
    if (window.location.href.includes('linear.app')) {
      // Linear ticket type
      const typeElement = document.querySelector('[data-testid="issue-type"]');
      if (typeElement) {
        const text = typeElement.textContent || typeElement.innerText || '';
        return text.trim().toLowerCase();
      }
    } else if (window.location.href.includes('atlassian.net')) {
      // Jira ticket type
      const typeElement = document.querySelector('[data-testid="issue-type-field"]');
      if (typeElement) {
        const text = typeElement.textContent || typeElement.innerText || '';
        return text.trim().toLowerCase();
      }
    }
    
    return 'story';
  }

  /**
   * Extract assignee from the ticket page
   */
  function extractAssignee() {
    if (window.location.href.includes('linear.app')) {
      // Linear assignee
      const assigneeElement = document.querySelector('[data-testid="assignee"]');
      if (assigneeElement) {
        const text = assigneeElement.textContent || assigneeElement.innerText || '';
        return text.trim();
      }
    } else if (window.location.href.includes('atlassian.net')) {
      // Jira assignee
      const assigneeElement = document.querySelector('[data-testid="assignee-field"]');
      if (assigneeElement) {
        const text = assigneeElement.textContent || assigneeElement.innerText || '';
        return text.trim();
      }
    }
    
    return null;
  }

  /**
   * Insert analysis as a comment into the ticket
   */
  async function insertComment(analysis) {
    try {
      console.log('🔍 insertComment called with platform detection');
      console.log('🔍 Analysis to insert:', analysis.title);
      
      if (window.location.href.includes('linear.app')) {
        // Use HTML formatting for Linear
        const commentText = formatAsMarkdown(analysis);
        console.log('🔍 Formatted comment text length:', commentText.length);
        const success = await insertLinearComment(commentText);
        console.log('🔍 insertLinearComment result:', success);
        if (!success) {
          console.log('🔍 Comment insertion failed - NOT inserting anywhere else');
          showNotification('❌ Failed to insert comment', 'error');
        }
        return success;
      } else if (window.location.href.includes('atlassian.net')) {
        // For Jira, show a panel with formatted text for manual copy/paste
        showJiraPanel(analysis);
        return true;
      }
      
      console.error('❌ Unknown platform, cannot insert comment');
      return false;
    } catch (error) {
      console.error('❌ Error in insertComment:', error);
      return false;
    }
  }

  /**
   * Format analysis as a comment
   */
  function formatAnalysisAsComment(analysis) {
    console.log('🔍 Formatting analysis as comment:', analysis);
    
    if (!analysis || typeof analysis !== 'object') {
      console.error('❌ Invalid analysis object:', analysis);
      return '# QA Analysis by Ovi AI\n\n## 🧪 Test Recipe\n\n---\n*Generated by Ovi AI - FirstQA*';
    }
    
    // Check if this is the new format
    if (analysis.title === 'Definition of Ready Analysis') {
      console.log('✅ Using new Definition of Ready Analysis format for comment');
      
      let comment = `🤖 **${analysis.title}**\n\n`;
      
      // Ready for Development Score
      if (analysis.readyForDevelopmentScore !== undefined) {
        if (analysis.initialReadinessScore !== undefined) {
          comment += `**📊 Ready for Dev Score:** ${analysis.initialReadinessScore}/5\n`;
          comment += `_Ovi Enhanced Score: ${analysis.readyForDevelopmentScore}/5_\n\n`;
        } else {
          comment += `**📊 Ready for Development Score:** ${analysis.readyForDevelopmentScore}/5\n\n`;
        }
      }
      
      // Top Questions
      if (analysis.topQuestions && Array.isArray(analysis.topQuestions)) {
        comment += '**🧠 Top Questions:**\n';
        analysis.topQuestions.forEach((question, index) => {
          comment += `${index + 1}. ${question}\n`;
        });
        comment += '\n';
      }
      
      // Key Risks
      if (analysis.keyRisks && Array.isArray(analysis.keyRisks)) {
        comment += '**⚠️ Key Risks:**\n';
        analysis.keyRisks.forEach((risk, index) => {
          comment += `${index + 1}. ${risk}\n`;
        });
        comment += '\n';
      }
      
      // Test Recipe
      if (analysis.testRecipe && Array.isArray(analysis.testRecipe)) {
        comment += '**📋 Test Recipe:**\n';
        analysis.testRecipe.forEach(test => {
          if (typeof test === 'object' && test.scenario) {
            comment += `${test.icon} ${test.scenario} – *${test.category}*\n`;
          } else if (typeof test === 'string') {
            comment += `- ${test}\n`;
          }
        });
        comment += '\n';
      }
      
      // Missing Information
      if (analysis.missingInfo && Array.isArray(analysis.missingInfo) && analysis.missingInfo.length > 0) {
        comment += '**❌ Missing Information:**\n';
        analysis.missingInfo.forEach(info => {
          comment += `• ${info}\n`;
        });
        comment += '\n';
      }
      
      // Tip
      if (analysis.tip) {
        comment += `**🧠 Tip:** ${analysis.tip}\n\n`;
      }
      
      comment += '---\n*Generated by Ovi AI - FirstQA*';
      
      console.log('✅ Generated comment markdown:', comment.substring(0, 200) + '...');
      return comment;
    }
    
    // Fallback to old format if needed
    console.log('⚠️ Using fallback format for comment');
    return '# QA Analysis by Ovi AI\n\n## 🧪 Test Recipe\n\n---\n*Generated by Ovi AI - FirstQA*';
  }

  /**
   * Insert comment into Linear ticket using ProseMirror-compatible approach
   */
  async function insertLinearComment(commentText) {
    console.log('🚀 Starting Linear comment insertion (improved selector)');
    
    try {
      // More specific selectors for Linear comment input
      const commentSelectors = [
        // Most specific: comment field with aria-label="Comment"
        '[aria-label="Comment"]',
        // Comment placeholder with specific text
        '[data-empty-text="Leave a comment..."]',
        // Comment input in activity section
        '.activity-section [aria-label="Comment"]',
        '.activity-section [data-empty-text="Leave a comment..."]',
        // Fallback selectors
        '[data-testid="comment-input"] [aria-label="Comment"]',
        '[data-testid="comment-input"] [data-empty-text="Leave a comment..."]'
      ];
      
      let commentInput = null;
      for (const selector of commentSelectors) {
        commentInput = document.querySelector(selector);
        if (commentInput) {
          console.log(`✅ Found comment input with selector: ${selector}`);
          break;
        }
      }
      
      if (!commentInput) {
        console.log('❌ No comment input found');
        return false;
      }
      
      // Focus and insert text
      commentInput.focus();
      commentInput.click();
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Clear any existing content first
      commentInput.innerHTML = '';
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Insert the text
      console.log('🔧 Inserting HTML content into comment field');
      commentInput.innerHTML = commentText;
      
      // Trigger multiple events to ensure Linear processes the HTML content
      commentInput.dispatchEvent(new Event('input', { bubbles: true }));
      commentInput.dispatchEvent(new Event('change', { bubbles: true }));
      commentInput.dispatchEvent(new Event('blur', { bubbles: true }));
      commentInput.dispatchEvent(new Event('focus', { bubbles: true }));
      
      // Wait longer for Linear to process the HTML content
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Try multiple submission methods to ensure proper comment creation
      let submissionSuccess = false;

      // Method 1: Try to find and click the submit button
      const submitSelectors = [
        'button[type="submit"]',
        '.submit-button',
        '[data-testid="submit"]',
        'button:contains("Comment")',
        'button:contains("Post")',
        'button:contains("Send")',
        'button[aria-label*="comment"]',
        'button[aria-label*="submit"]',
        // Linear-specific selectors
        '[data-testid="comment-submit"]',
        'button[data-testid="submit-comment"]',
        '.comment-submit-button'
      ];
      
      let submitButton = null;
      for (const selector of submitSelectors) {
        submitButton = document.querySelector(selector);
        if (submitButton && submitButton.offsetParent !== null) { // Check if button is visible
          console.log(`✅ Found visible submit button with selector: ${selector}`);
          break;
        }
      }
      
      if (submitButton) {
        console.log('✅ Clicking submit button');
        submitButton.click();
        submissionSuccess = true;
      } else {
        console.log('⚠️ No submit button found, trying keyboard shortcuts');
        
        // Method 2: Try Cmd+Enter (Mac)
        const cmdEnterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          metaKey: true, // Cmd key on Mac
          bubbles: true,
          cancelable: true
        });
        commentInput.dispatchEvent(cmdEnterEvent);
        
        // Wait a bit and try Ctrl+Enter as well (Windows/Linux)
        await new Promise(resolve => setTimeout(resolve, 200));
        const ctrlEnterEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          ctrlKey: true, // Ctrl key
          bubbles: true,
          cancelable: true
        });
        commentInput.dispatchEvent(ctrlEnterEvent);
        
        submissionSuccess = true;
      }

      // Wait for the comment to be properly submitted to Linear's system
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Verify the comment was actually submitted by checking if it appears in the comments list
      const commentsSection = document.querySelector('.activity-section, [data-testid="comments"], .comments-section');
      if (commentsSection) {
        const commentText = commentsSection.textContent || commentsSection.innerHTML || '';
        if (commentText.includes('QA Analysis')) {
          console.log('✅ Comment successfully submitted and appears in comments section');
          return true;
        } else {
          console.log('⚠️ Comment may not have been properly submitted - not found in comments section');
        }
      }
      
      console.log('✅ Comment submission process completed');
      return submissionSuccess;
      
    } catch (error) {
      console.error('❌ Error in insertLinearComment:', error);
      return false;
    }
  }
  
  /**
   * Insert text in a ProseMirror-compatible way
   */
  async function insertTextProseMirrorCompatible(element, text) {
    console.log('🔧 Attempting ProseMirror-compatible text insertion');
    
    try {
      // Method 1: Try inserting HTML directly (best for rich content)
      console.log('🌐 Trying HTML insertion first');
      
      element.focus();
      element.click();
      
      // Wait for focus
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Insert HTML directly
      element.innerHTML = text;
      
      // Trigger input event
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      
      // Verify the text was inserted
      await new Promise(resolve => setTimeout(resolve, 300));
      if (element.textContent.includes('QA Grooming') || 
          element.textContent.includes('Top Questions') ||
          element.textContent.includes('Test Recipe')) {
        console.log('✅ HTML insertion successful');
        return true;
      }
      
      // Method 2: Try using execCommand insertHTML
      console.log('📝 Trying execCommand insertHTML');
      
      element.focus();
      element.click();
      
      // Wait for focus
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Use execCommand to insert HTML
      const insertSuccess = document.execCommand('insertHTML', false, text);
      console.log('📝 execCommand insertHTML result:', insertSuccess);
      
      if (insertSuccess) {
        // Verify the text was inserted
        await new Promise(resolve => setTimeout(resolve, 300));
        if (element.textContent.includes('QA Grooming') || 
            element.textContent.includes('Top Questions') ||
            element.textContent.includes('Test Recipe')) {
          console.log('✅ execCommand insertHTML successful');
          return true;
        }
      }
      
      // Method 3: Try using the clipboard API (fallback)
      try {
        console.log('📋 Trying clipboard paste');
        await navigator.clipboard.writeText(text);
        
        // Focus the element
        element.focus();
        element.click();
        
        // Wait a bit for focus to settle
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Use paste command
        const pasteSuccess = document.execCommand('paste');
        console.log('📋 Clipboard paste result:', pasteSuccess);
        
        if (pasteSuccess) {
          // Verify the text was inserted
          await new Promise(resolve => setTimeout(resolve, 300));
          if (element.textContent.includes('QA Grooming') || 
              element.textContent.includes('Top Questions') ||
              element.textContent.includes('Test Recipe')) {
            console.log('✅ Clipboard paste successful');
            return true;
          }
        }
      } catch (clipboardError) {
        console.log('📋 Clipboard method failed:', clipboardError);
      }
      
      // Method 4: Try using execCommand insertText (last resort)
      console.log('📝 Trying execCommand insertText');
      
      element.focus();
      element.click();
      
      // Wait for focus
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Use execCommand to insert text
      const insertTextSuccess = document.execCommand('insertText', false, text);
      console.log('📝 execCommand insertText result:', insertTextSuccess);
      
      if (insertTextSuccess) {
        // Verify the text was inserted
        await new Promise(resolve => setTimeout(resolve, 300));
        if (element.textContent.includes('QA Grooming') || 
            element.textContent.includes('Top Questions') ||
            element.textContent.includes('Test Recipe')) {
          console.log('✅ execCommand insertText successful');
          return true;
        }
      }
      
      console.log('❌ All text insertion methods failed');
      return false;
      
    } catch (error) {
      console.error('❌ Error in insertTextProseMirrorCompatible:', error);
      return false;
    }
  }
  
  /**
   * Submit the comment using multiple strategies
   */
  async function submitComment() {
    console.log('🚀 Attempting to submit comment');
    
    try {
      // Strategy 1: Try to find and submit the form directly
      const commentInput = document.querySelector('.ProseMirror, [contenteditable="true"]');
      if (commentInput) {
        // Look for the form containing the comment input
        const form = commentInput.closest('form');
        if (form) {
          console.log('📋 Found form, dispatching submit event...');
          form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          if (await checkSubmissionSuccess()) {
            console.log('✅ Form submission successful!');
            return true;
          }
        }
      }
      
      // Strategy 2: Try to find and trigger the submit button's click handler directly
      const submitButton = document.querySelector('button[aria-label="Submit comment"]');
      if (submitButton) {
        console.log('🔘 Found submit button, triggering click handler...');
        
        // Try to trigger the button's click handler directly
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: window
        });
        submitButton.dispatchEvent(clickEvent);
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (await checkSubmissionSuccess()) {
          console.log('✅ Direct click handler successful!');
          return true;
        }
      }
      
      // Strategy 2.5: Try to commit the editor content before submission
      if (commentInput) {
        console.log('📝 Trying to commit editor content...');
        
        // Try to trigger a blur event to commit the content
        commentInput.dispatchEvent(new Event('blur', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Try to trigger an input event to ensure content is registered
        commentInput.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Now try the submit button again
        const submitButton2 = document.querySelector('button[aria-label="Submit comment"]');
        if (submitButton2) {
          submitButton2.click();
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          if (await checkSubmissionSuccess()) {
            console.log('✅ Editor commit + button click successful!');
            return true;
          }
        }
      }
      
      // Strategy 3: Try Enter key submission
      const enterSuccess = await submitWithEnterKey();
      if (enterSuccess) {
        return true;
      }
      
      // Strategy 4: Try clicking submit button
      const buttonSuccess = await submitWithButton();
      if (buttonSuccess) {
        return true;
      }
      
      console.log('❌ All submission methods failed');
      return false;
      
    } catch (error) {
      console.error('❌ Error in submitComment:', error);
      return false;
    }
  }
  
  /**
   * Submit comment using Enter key
   */
  async function submitWithEnterKey() {
    console.log('⌨️ Trying Enter key submission');
    
    try {
      // Find the comment input again
      const commentInput = document.querySelector('.ProseMirror, [contenteditable="true"]');
      if (!commentInput) {
        console.log('❌ No comment input found for Enter key submission');
        return false;
      }
      
      // Focus and dispatch Enter key events
      commentInput.focus();
      
      // Wait for focus
      await new Promise(resolve => setTimeout(resolve, 300));
      
      // Try multiple Enter key strategies with more aggressive approach
      const enterStrategies = [
        // Strategy 1: Simple Enter
        () => {
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          commentInput.dispatchEvent(event);
        },
        // Strategy 2: Cmd/Ctrl + Enter (common for rich text editors)
        () => {
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            metaKey: true,
            bubbles: true,
            cancelable: true
          });
          commentInput.dispatchEvent(event);
        },
        // Strategy 3: Enter with shift key
        () => {
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            shiftKey: true,
            bubbles: true,
            cancelable: true
          });
          commentInput.dispatchEvent(event);
        },
        // Strategy 4: Enter with ctrl key
        () => {
          const event = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            ctrlKey: true,
            bubbles: true,
            cancelable: true
          });
          commentInput.dispatchEvent(event);
        }
      ];
      
      // Try each strategy with delays
      for (let i = 0; i < enterStrategies.length; i++) {
        console.log(`⌨️ Trying Enter strategy ${i + 1}...`);
        enterStrategies[i]();
        
        // Wait between attempts
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Check if submission was successful
        if (await checkSubmissionSuccess()) {
          console.log('✅ Enter key submission successful');
          return true;
        }
      }
      
      // Also try the full event sequence for each strategy
      for (let i = 0; i < enterStrategies.length; i++) {
        console.log(`⌨️ Trying full event sequence for strategy ${i + 1}...`);
        
        // keydown
        const keydownEvent = new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          ...(i === 1 ? { metaKey: true } : {}),
          ...(i === 2 ? { shiftKey: true } : {}),
          ...(i === 3 ? { ctrlKey: true } : {})
        });
        commentInput.dispatchEvent(keydownEvent);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // keypress
        const keypressEvent = new KeyboardEvent('keypress', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          ...(i === 1 ? { metaKey: true } : {}),
          ...(i === 2 ? { shiftKey: true } : {}),
          ...(i === 3 ? { ctrlKey: true } : {})
        });
        commentInput.dispatchEvent(keypressEvent);
        
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // keyup
        const keyupEvent = new KeyboardEvent('keyup', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
          ...(i === 1 ? { metaKey: true } : {}),
          ...(i === 2 ? { shiftKey: true } : {}),
          ...(i === 3 ? { ctrlKey: true } : {})
        });
        commentInput.dispatchEvent(keyupEvent);
        
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Check if submission was successful
        if (await checkSubmissionSuccess()) {
          console.log('✅ Enter key submission successful with full event sequence');
          return true;
        }
      }
      
      console.log('❌ Enter key submission failed');
      return false;
      
    } catch (error) {
      console.error('❌ Error in submitWithEnterKey:', error);
      return false;
    }
  }
  
  /**
   * Debug function to log all buttons on the page
   */
  function debugButtons() {
    console.log('🔍 Debugging all buttons on the page:');
    const buttons = document.querySelectorAll('button');
    buttons.forEach((button, index) => {
      const text = button.textContent.trim();
      const disabled = button.disabled;
      const testId = button.getAttribute('data-testid') || '';
      const ariaLabel = button.getAttribute('aria-label') || '';
      const className = button.className || '';
      
      console.log(`Button ${index + 1}: "${text}" (disabled: ${disabled}, testid: "${testId}", aria-label: "${ariaLabel}", class: "${className}")`);
    });
  }

  /**
   * Submit comment using submit button
   */
  async function submitWithButton() {
    console.log('🔘 Trying button submission');
    
    // Debug: Log all buttons to help identify the submit button
    debugButtons();
    
    try {
      // Find submit button using multiple strategies
      let submitButton = null;
      
      // Strategy 1: Look for buttons within comment container
      const commentContainer = document.querySelector('[data-testid*="comment"], .comment-section');
      if (commentContainer) {
        const buttons = commentContainer.querySelectorAll('button');
        for (const button of buttons) {
          const text = button.textContent.toLowerCase();
          if (text.includes('comment') || text.includes('post') || text.includes('submit') || text.includes('send')) {
            submitButton = button;
            console.log('✅ Found submit button in comment container:', text);
            break;
          }
        }
      }
      
      // Strategy 2: Look for buttons with aria-label="Submit comment" (most reliable)
      if (!submitButton) {
        const ariaLabelButton = document.querySelector('button[aria-label="Submit comment"]');
        if (ariaLabelButton) {
          submitButton = ariaLabelButton;
          console.log('✅ Found submit button by aria-label:', ariaLabelButton.getAttribute('aria-label'));
        }
      }
      
      // Strategy 3: Look for buttons with type="submit" near comment input
      if (!submitButton) {
        const submitButtons = document.querySelectorAll('button[type="submit"]');
        const commentInput = document.querySelector('.ProseMirror, [contenteditable="true"]');
        
        if (commentInput && submitButtons.length > 0) {
          const rect = commentInput.getBoundingClientRect();
          
          for (const button of submitButtons) {
            const buttonRect = button.getBoundingClientRect();
            const distance = Math.sqrt(
              Math.pow(rect.left - buttonRect.left, 2) + 
              Math.pow(rect.top - buttonRect.top, 2)
            );
            
            if (distance < 500) { // Within 500px
              submitButton = button;
              console.log('✅ Found nearby submit button by type:', button.getAttribute('aria-label') || button.textContent);
              break;
            }
          }
        }
      }
      
      // Strategy 3: Look for any enabled button that looks like a submit button
      if (!submitButton) {
        const buttons = document.querySelectorAll('button:not([disabled])');
        for (const button of buttons) {
          const text = button.textContent.toLowerCase();
          const exclusions = [
            'add sub-issues', 'add issue', 'create', 'new', 'edit', 'delete', 'close',
            'unsubscribe', 'backlog', 'set priority', 'assign', 'add label', 'add to project',
            'cancel', 'close', 'save', 'update', 'refresh', 'reload', 'filter', 'sort'
          ];
          
          const isExcluded = exclusions.some(exclusion => text.includes(exclusion));
          if (!isExcluded && (text.includes('comment') || text.includes('post') || text.includes('submit') || text.includes('send'))) {
            submitButton = button;
            console.log('✅ Found potential submit button:', text);
            break;
          }
        }
      }
      
      // Strategy 4: Look for buttons with specific attributes or classes
      if (!submitButton) {
        const specificSelectors = [
          'button[type="submit"]',
          'button[data-testid*="submit"]',
          'button[data-testid*="comment"]',
          'button[data-testid*="post"]',
          'button[aria-label*="comment"]',
          'button[aria-label*="post"]',
          'button[aria-label*="submit"]',
          '.submit-button',
          '.comment-button',
          '.post-button'
        ];
        
        for (const selector of specificSelectors) {
          const button = document.querySelector(selector);
          if (button && !button.disabled) {
            submitButton = button;
            console.log('✅ Found submit button using selector:', selector);
            break;
          }
        }
      }
      
      // Strategy 5: Look for buttons with specific text patterns
      if (!submitButton) {
        const buttons = document.querySelectorAll('button:not([disabled])');
        for (const button of buttons) {
          const text = button.textContent.toLowerCase().trim();
          const submitPatterns = [
            'comment', 'post', 'submit', 'send', 'add comment', 'post comment',
            'submit comment', 'send comment', 'reply', 'add reply'
          ];
          
          if (submitPatterns.some(pattern => text.includes(pattern))) {
            submitButton = button;
            console.log('✅ Found submit button with pattern match:', text);
            break;
          }
        }
      }
      
      // Strategy 6: Look for any button that's not disabled and not obviously excluded
      if (!submitButton) {
        const buttons = document.querySelectorAll('button:not([disabled])');
        const commentInput = document.querySelector('.ProseMirror, [contenteditable="true"]');
        
        if (commentInput) {
          const rect = commentInput.getBoundingClientRect();
          
          for (const button of buttons) {
            const buttonRect = button.getBoundingClientRect();
            const distance = Math.sqrt(
              Math.pow(rect.left - buttonRect.left, 2) + 
              Math.pow(rect.top - buttonRect.top, 2)
            );
            
            // If button is close to comment input and not obviously excluded
            if (distance < 300) {
              const text = button.textContent.toLowerCase().trim();
              const exclusions = [
                'add sub-issues', 'add issue', 'create', 'new', 'edit', 'delete', 'close',
                'unsubscribe', 'backlog', 'set priority', 'assign', 'add label', 'add to project',
                'cancel', 'save', 'update', 'refresh', 'reload', 'filter', 'sort', 'more'
              ];
              
              const isExcluded = exclusions.some(exclusion => text.includes(exclusion));
              if (!isExcluded && text.length > 0) {
                submitButton = button;
                console.log('✅ Found nearby button as potential submit:', text);
                break;
              }
            }
          }
        }
      }
      
      if (!submitButton) {
        console.log('❌ No submit button found');
        return false;
      }
      
      // Click the submit button
      console.log('🖱️ Clicking submit button:', submitButton.textContent);
      submitButton.click();
      
      // Wait for submission
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Try multiple submission strategies if the first one doesn't work
      if (!await checkSubmissionSuccess()) {
        console.log('🔄 First submission attempt failed, trying alternative methods...');
        
        // Strategy 1: Try clicking the button again
        submitButton.click();
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        if (!await checkSubmissionSuccess()) {
          // Strategy 2: Try Enter key on the button
          const enterEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
          });
          submitButton.dispatchEvent(enterEvent);
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          if (!await checkSubmissionSuccess()) {
            // Strategy 3: Try Space key on the button
            const spaceEvent = new KeyboardEvent('keydown', {
              key: ' ',
              code: 'Space',
              keyCode: 32,
              which: 32,
              bubbles: true,
              cancelable: true
            });
            submitButton.dispatchEvent(spaceEvent);
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            if (!await checkSubmissionSuccess()) {
              // Strategy 4: Focus and click with more aggressive approach
              submitButton.focus();
              await new Promise(resolve => setTimeout(resolve, 100));
              submitButton.click();
              await new Promise(resolve => setTimeout(resolve, 2000));
              
              if (!await checkSubmissionSuccess()) {
                // Strategy 5: Try programmatic form submission
                const form = submitButton.closest('form');
                if (form) {
                  console.log('🔄 Trying form submission...');
                  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
                  await new Promise(resolve => setTimeout(resolve, 2000));
                }
              }
            }
          }
        }
      }
      
      return await checkSubmissionSuccess();
      
    } catch (error) {
      console.error('❌ Error in submitWithButton:', error);
      return false;
    }
  }

    /**
   * Insert comment into Jira by typing character by character to trigger Markdown
   */
  async function insertJiraComment(commentText) {
    console.log('🔍 Inserting comment into Jira by typing:', commentText.substring(0, 200) + '...');
    
    // Wait for the page to be fully loaded and comment field to appear
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Step 1: Find and click the "Add a comment..." button to reveal the comment field
    const addCommentButton = document.querySelector('[data-testid="canned-comments.common.ui.comment-text-area-placeholder.textarea"]') ||
                           document.querySelector('button[data-testid*="comment-text-area-placeholder"]') ||
                           document.querySelector('button:contains("Add a comment")') ||
                           document.querySelector('button[aria-label*="comment"]') ||
                           document.querySelector('button[title*="comment"]');
    
    if (addCommentButton) {
      console.log('🔘 Found "Add a comment" button, clicking to reveal comment field...');
      addCommentButton.click();
      
      // Wait for the comment field to appear
      await new Promise(resolve => setTimeout(resolve, 1000));
    } else {
      console.log('⚠️ No "Add a comment" button found, proceeding with direct field detection...');
    }
    
    // Step 2: Find the actual comment input field (now that it should be visible)
    let commentInput = document.querySelector('#comment') ||
                       document.querySelector('.comment-input') ||
                       document.querySelector('[data-testid="comment-field"]') ||
                       document.querySelector('.ProseMirror') ||
                       document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('.comment-editor') ||
                       document.querySelector('.comment-input-field') ||
                       document.querySelector('textarea[placeholder*="comment"]') ||
                       document.querySelector('textarea[placeholder*="Comment"]') ||
                       document.querySelector('textarea[placeholder*="add a comment"]') ||
                       document.querySelector('textarea[placeholder*="Add a comment"]') ||
                       document.querySelector('.comment-textarea') ||
                       document.querySelector('.comment-field') ||
                       document.querySelector('[data-testid="comment-textarea"]') ||
                       document.querySelector('[data-testid="comment-editor"]') ||
                       document.querySelector('.comment-form textarea') ||
                       document.querySelector('.comment-form [contenteditable]') ||
                       document.querySelector('.activity-section textarea') ||
                       document.querySelector('.activity-section [contenteditable]') ||
                       document.querySelector('[role="textbox"]') ||
                       document.querySelector('.jira-comment-editor') ||
                       document.querySelector('.comment-editor-field') ||
                       document.querySelector('textarea') ||
                       document.querySelector('[contenteditable="true"]') ||
                       document.querySelector('[contenteditable]');
    
    if (!commentInput) {
      console.error('❌ Comment input field not found');
      
      // Debug: Log all potential comment-related elements
      console.log('🔍 Debugging Jira comment field detection...');
      console.log('🔍 All textareas:', document.querySelectorAll('textarea'));
      console.log('🔍 All contenteditable elements:', document.querySelectorAll('[contenteditable]'));
      console.log('🔍 All elements with "comment" in class:', document.querySelectorAll('[class*="comment"]'));
      console.log('🔍 All elements with "comment" in placeholder:', document.querySelectorAll('[placeholder*="comment"]'));
      console.log('🔍 All elements with "comment" in data-testid:', document.querySelectorAll('[data-testid*="comment"]'));
      
      // Final fallback: Wait a bit more and try again
      console.log('⏳ Waiting for comment field to appear...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      commentInput = document.querySelector('textarea') || 
                    document.querySelector('[contenteditable="true"]') ||
                    document.querySelector('[contenteditable]') ||
                    document.querySelector('[role="textbox"]');
      
      if (commentInput) {
        console.log('🔧 Found comment input after waiting:', commentInput);
      } else {
        throw new Error('Comment input field not found after retry');
      }
    }

    console.log('✅ Found comment input:', commentInput);

    // Focus on the input field
    commentInput.focus();
    await new Promise(resolve => setTimeout(resolve, 200));

    // Clear any existing content
    if (commentInput.value !== undefined) {
      commentInput.value = '';
    } else if (commentInput.textContent !== undefined) {
      commentInput.textContent = '';
    } else if (commentInput.innerHTML !== undefined) {
      commentInput.innerHTML = '';
    }

    // Step 3: Type the text character by character to trigger Markdown interpretation
    console.log('🔍 Typing text character by character to trigger Markdown...');
    await typeTextCharacterByCharacter(commentInput, commentText);
    
    // Wait a moment for the content to settle
    await new Promise(resolve => setTimeout(resolve, 500));

    // Step 4: Submit the comment
    return await submitComment();
  }
  
  /**
   * Type text character by character to trigger Jira's Markdown interpretation
   */
  async function typeTextCharacterByCharacter(element, text) {
    console.log('🔍 Starting character-by-character typing with proper line breaks...');
    
    // Focus the element first
    element.focus();
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Split text into lines
    const lines = text.split('\n');
    
    // Type each line
    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
        const line = lines[lineIndex];
        
        // Type each character in the line
        for (let charIndex = 0; charIndex < line.length; charIndex++) {
            const char = line[charIndex];
            
            // Create keyboard events for the character
            const keydownEvent = new KeyboardEvent('keydown', {
                key: char,
                code: `Key${char.toUpperCase()}`,
                bubbles: true,
                cancelable: true
            });
            
            const keypressEvent = new KeyboardEvent('keypress', {
                key: char,
                code: `Key${char.toUpperCase()}`,
                bubbles: true,
                cancelable: true
            });
            
            const inputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                data: char,
                inputType: 'insertText'
            });
            
            const keyupEvent = new KeyboardEvent('keyup', {
                key: char,
                code: `Key${char.toUpperCase()}`,
                bubbles: true,
                cancelable: true
            });
            
            // Insert the character
            if (element.value !== undefined) {
                element.value += char;
            } else if (element.textContent !== undefined) {
                element.textContent += char;
            } else if (element.innerHTML !== undefined) {
                element.innerHTML += char;
            }
            
            // Dispatch events in sequence
            element.dispatchEvent(keydownEvent);
            await new Promise(resolve => setTimeout(resolve, 5));
            element.dispatchEvent(keypressEvent);
            await new Promise(resolve => setTimeout(resolve, 5));
            element.dispatchEvent(inputEvent);
            await new Promise(resolve => setTimeout(resolve, 5));
            element.dispatchEvent(keyupEvent);
            
            // Small delay between characters
            await new Promise(resolve => setTimeout(resolve, 10));
        }
        
        // Add a newline after each line (except the last one)
        if (lineIndex < lines.length - 1) {
            // Create keyboard events for Enter key
            const enterKeydownEvent = new KeyboardEvent('keydown', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            });
            
            const enterKeypressEvent = new KeyboardEvent('keypress', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            });
            
            const enterInputEvent = new InputEvent('input', {
                bubbles: true,
                cancelable: true,
                data: '\n',
                inputType: 'insertLineBreak'
            });
            
            const enterKeyupEvent = new KeyboardEvent('keyup', {
                key: 'Enter',
                code: 'Enter',
                keyCode: 13,
                which: 13,
                bubbles: true,
                cancelable: true
            });
            
            // Insert the newline
            if (element.value !== undefined) {
                element.value += '\n';
            } else if (element.textContent !== undefined) {
                element.textContent += '\n';
            } else if (element.innerHTML !== undefined) {
                element.innerHTML += '\n';
            }
            
            // Dispatch Enter key events in sequence
            element.dispatchEvent(enterKeydownEvent);
            await new Promise(resolve => setTimeout(resolve, 5));
            element.dispatchEvent(enterKeypressEvent);
            await new Promise(resolve => setTimeout(resolve, 5));
            element.dispatchEvent(enterInputEvent);
            await new Promise(resolve => setTimeout(resolve, 5));
            element.dispatchEvent(enterKeyupEvent);
            
            // Longer delay after newlines
            await new Promise(resolve => setTimeout(resolve, 100));
        }
    }
    
    // Final delay to let Jira process the input
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Trigger a final change event
    const changeEvent = new Event('change', { bubbles: true });
    element.dispatchEvent(changeEvent);
    
    console.log('✅ Finished typing text with proper line breaks');
  }
  
  /**
   * Click a toolbar button by its text content with improved detection
   */
  async function clickToolbarButton(buttonText) {
    const toolbar = document.querySelector('[data-testid="comment-editor-toolbar"]') ||
                   document.querySelector('.comment-editor-toolbar') ||
                   document.querySelector('.editor-toolbar') ||
                   document.querySelector('[role="toolbar"]') ||
                   document.querySelector('.ProseMirror-menubar') ||
                   document.querySelector('.ProseMirror-toolbar');
    
    if (!toolbar) {
      console.log('⚠️ Toolbar not found, skipping button click');
      return;
    }
    
    // Find button by text content, aria-label, title, or data attributes
    const buttons = toolbar.querySelectorAll('button, [role="button"], .ProseMirror-menu-item');
    for (const button of buttons) {
      const buttonTextContent = button.textContent?.trim() || '';
      const ariaLabel = button.getAttribute('aria-label') || '';
      const title = button.getAttribute('title') || '';
      const dataTestId = button.getAttribute('data-testid') || '';
      
      if (buttonTextContent.includes(buttonText) || 
          ariaLabel.includes(buttonText) ||
          title.includes(buttonText) ||
          dataTestId.includes(buttonText.toLowerCase().replace(/\s+/g, '-'))) {
        console.log(`🔘 Clicking toolbar button: ${buttonText} (found: ${buttonTextContent || ariaLabel || title})`);
        
        // Ensure button is visible and clickable
        if (button.offsetParent !== null) {
          button.click();
          return;
        } else {
          console.log(`⚠️ Button ${buttonText} is not visible`);
        }
      }
    }
    
    console.log(`⚠️ Toolbar button not found: ${buttonText}`);
  }
  
  /**
   * Click a toolbar dropdown option with improved detection
   */
  async function clickToolbarOption(optionText) {
    // Wait for dropdown to appear
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Find dropdown options in multiple possible locations
    const options = document.querySelectorAll('[role="option"], [role="menuitem"], .dropdown-item, .ProseMirror-menu-dropdown-item');
    for (const option of options) {
      const optionTextContent = option.textContent?.trim() || '';
      const ariaLabel = option.getAttribute('aria-label') || '';
      
      if (optionTextContent.includes(optionText) || ariaLabel.includes(optionText)) {
        console.log(`🔘 Clicking toolbar option: ${optionText} (found: ${optionTextContent || ariaLabel})`);
        
        // Ensure option is visible and clickable
        if (option.offsetParent !== null) {
          option.click();
          return;
        } else {
          console.log(`⚠️ Option ${optionText} is not visible`);
        }
      }
    }
    
    console.log(`⚠️ Toolbar option not found: ${optionText}`);
  }
  
  /**
   * Type a single character with proper event dispatching
   */
  async function typeCharacter(element, char) {
    // Create keyboard events for the character
    const keydownEvent = new KeyboardEvent('keydown', {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true
    });
    
    const keypressEvent = new KeyboardEvent('keypress', {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true
    });
    
    const inputEvent = new InputEvent('input', {
      bubbles: true,
      cancelable: true,
      data: char,
      inputType: 'insertText'
    });
    
    const keyupEvent = new KeyboardEvent('keyup', {
      key: char,
      code: `Key${char.toUpperCase()}`,
      bubbles: true,
      cancelable: true
    });
    
    // Insert the character
    if (element.value !== undefined) {
      element.value += char;
    } else if (element.textContent !== undefined) {
      element.textContent += char;
    } else if (element.innerHTML !== undefined) {
      element.innerHTML += char;
    }
    
    // Dispatch events in sequence
    element.dispatchEvent(keydownEvent);
    await new Promise(resolve => setTimeout(resolve, 5));
    element.dispatchEvent(keypressEvent);
    await new Promise(resolve => setTimeout(resolve, 5));
    element.dispatchEvent(inputEvent);
    await new Promise(resolve => setTimeout(resolve, 5));
    element.dispatchEvent(keyupEvent);
    
    // Small delay to allow Markdown interpretation
    await new Promise(resolve => setTimeout(resolve, 10));
  }

  /**
   * Check if comment submission was successful
   */
  async function checkSubmissionSuccess() {
    // Wait a moment for the submission to process
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Check multiple indicators of successful submission
    
    // 1. Check if the Save button is disabled or not visible (indicating submission)
    const saveButton = document.querySelector('[data-testid="comment-save-button"]');
    if (saveButton) {
      const isDisabled = saveButton.disabled || saveButton.getAttribute('aria-disabled') === 'true';
      const isVisible = saveButton.offsetParent !== null;
      if (isDisabled || !isVisible) {
        console.log('✅ Save button is disabled/not visible, indicating successful submission');
        return true;
      } else {
        console.log('❌ Save button is still visible and enabled, submission failed');
        return false;
      }
    }
    
    // 2. Check if the "Add a comment..." placeholder is visible again
    const addCommentPlaceholder = document.querySelector('[data-testid="canned-comments.common.ui.comment-text-area-placeholder.textarea"]');
    if (addCommentPlaceholder && addCommentPlaceholder.offsetParent !== null) {
      console.log('✅ "Add a comment" placeholder is visible again, indicating successful submission');
      return true;
    }
    
    // 3. Check if the comment field is empty (content was submitted)
    const commentInput = document.querySelector('#comment') ||
                         document.querySelector('.comment-input') ||
                         document.querySelector('[data-testid="comment-field"]') ||
                         document.querySelector('.ProseMirror') ||
                         document.querySelector('[contenteditable="true"]') ||
                         document.querySelector('textarea[placeholder*="comment"]') ||
                         document.querySelector('textarea[placeholder*="Comment"]') ||
                         document.querySelector('textarea[placeholder*="add a comment"]') ||
                         document.querySelector('textarea[placeholder*="Add a comment"]') ||
                         document.querySelector('.comment-textarea') ||
                         document.querySelector('.comment-field') ||
                         document.querySelector('[data-testid="comment-textarea"]') ||
                         document.querySelector('[data-testid="comment-editor"]') ||
                         document.querySelector('.comment-form textarea') ||
                         document.querySelector('.comment-form [contenteditable]') ||
                         document.querySelector('.activity-section textarea') ||
                         document.querySelector('.activity-section [contenteditable]') ||
                         document.querySelector('[role="textbox"]') ||
                         document.querySelector('.jira-comment-editor') ||
                         document.querySelector('.comment-editor-field') ||
                         document.querySelector('textarea') ||
                         document.querySelector('[contenteditable="true"]') ||
                         document.querySelector('[contenteditable]');
    
    if (commentInput) {
      const content = commentInput.value || commentInput.textContent || commentInput.innerHTML || '';
      if (content.trim() === '' || content.includes('Add a comment') || content.includes('add a comment')) {
        console.log('✅ Comment field is empty, indicating successful submission');
        return true;
      }
    }
    
    // 4. Check if there are any success messages or notifications
    const successMessages = document.querySelectorAll('.aui-message-success, .success-message, .notification-success, [data-testid*="success"]');
    for (const message of successMessages) {
      if (message.textContent.includes('comment') || message.textContent.includes('saved') || message.textContent.includes('posted')) {
        console.log('✅ Success message found, indicating successful submission');
        return true;
      }
    }
    
    // 5. Check if the comment appears in the comments section (but NOT in the input field)
    const commentsSection = document.querySelector('.activity-section') ||
                           document.querySelector('.comment-list') ||
                           document.querySelector('.comments-section') ||
                           document.querySelector('[data-testid="comment-list"]') ||
                           document.querySelector('.issue-comments') ||
                           document.querySelector('.activity-stream');
    
    if (commentsSection) {
      const commentText = commentsSection.textContent || commentsSection.innerHTML || '';
      // Only check for our content if it's NOT in the input field
      const inputContent = commentInput ? (commentInput.value || commentInput.textContent || commentInput.innerHTML || '') : '';
      if (commentText.includes('QA Grooming by Ovi') && !inputContent.includes('QA Grooming by Ovi')) {
        console.log('✅ Comment found in comments section (not in input field), indicating successful submission');
        return true;
      }
    }
    
    // 6. Check if comment was submitted by looking for it in the comments section (original logic)
    const commentsSectionAlt = document.querySelector('[data-testid*="comment"], .comment-section, .comments-section');
    if (commentsSectionAlt) {
      const commentText = commentsSectionAlt.textContent || '';
      // Only check for our content if it's NOT in the input field
      const inputContent = commentInput ? (commentInput.value || commentInput.textContent || commentInput.innerHTML || '') : '';
      if ((commentText.includes('QA Grooming') || 
           commentText.includes('Ready for Dev Score') ||
           commentText.includes('Top Questions') ||
           commentText.includes('Key Risks') ||
           commentText.includes('Test Recipe') ||
           commentText.includes('Definition of Ready Analysis')) && 
          !inputContent.includes('QA Grooming')) {
        console.log('✅ Submission successful (found in comments, not in input)');
        return true;
      }
    }
    
    // 7. Alternative: Look for the comment in the activity feed
    const activityFeed = document.querySelector('[data-testid*="activity"], .activity-feed, .timeline');
    if (activityFeed) {
      const activityText = activityFeed.textContent || '';
      // Only check for our content if it's NOT in the input field
      const inputContent = commentInput ? (commentInput.value || commentInput.textContent || commentInput.innerHTML || '') : '';
      if ((activityText.includes('QA Grooming') || 
           activityText.includes('Ready for Dev Score') ||
           activityText.includes('Top Questions') ||
           activityText.includes('Key Risks') ||
           activityText.includes('Test Recipe') ||
           activityText.includes('Definition of Ready Analysis')) && 
          !inputContent.includes('QA Grooming')) {
        console.log('✅ Submission successful (found in activity feed, not in input)');
        return true;
      }
    }
    
    // 8. Final check: Look for our analysis anywhere on the page (but NOT in the input field)
    const pageText = document.body.textContent || '';
    const inputContent = commentInput ? (commentInput.value || commentInput.textContent || commentInput.innerHTML || '') : '';
    if (pageText.includes('QA Grooming') && 
        (pageText.includes('Ready for Dev Score') || 
         pageText.includes('Top Questions') || 
         pageText.includes('Key Risks') || 
         pageText.includes('Test Recipe') ||
         pageText.includes('Definition of Ready Analysis')) && 
       !inputContent.includes('QA Grooming')) {
      console.log('✅ Submission successful (found analysis on page, not in input)');
      return true;
    }
    
    console.log('❌ No indicators of successful submission found');
    return false;
  }

  /**
   * Remove the panel (cleanup)
   */
  function removePanel() {
    if (qaPanel) {
      qaPanel.remove();
      qaPanel = null;
      currentTicketData = null;
    }
  }
  
  /**
   * Close the Jira panel and backdrop
   */
  function closeJiraPanel() {
    const backdrop = document.getElementById('qa-modal-backdrop');
    if (backdrop) {
      backdrop.remove();
    }
    
    if (qaPanel) {
      qaPanel.remove();
      qaPanel = null;
    }
  }

  /**
   * Show a panel with formatted text for Jira
   */
  function showJiraPanel(analysis) {
    // Create backdrop
    if (!document.getElementById('qa-modal-backdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'qa-modal-backdrop';
      backdrop.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 999999998 !important;
        animation: backdropFadeIn 0.3s ease;
      `;
      document.body.appendChild(backdrop);
      
      // Add CSS animation
      const style = document.createElement('style');
      style.textContent = `
        @keyframes backdropFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      `;
      document.head.appendChild(style);
      
      // Close on backdrop click
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) {
          closeJiraPanel();
        }
      });
      
      // Close on Escape key
      const handleEscape = (e) => {
        if (e.key === 'Escape') {
          closeJiraPanel();
          document.removeEventListener('keydown', handleEscape);
        }
      };
      document.addEventListener('keydown', handleEscape);
    }

    // Create panel if it doesn't exist
    if (!qaPanel) {
      qaPanel = document.createElement('div');
      qaPanel.id = 'qa-copilot-panel';
      document.body.appendChild(qaPanel);
    }

    // Create panel content with enhanced design
    let html = `
      <div class="qa-modal-header">
        <h3>🤖 FirstQA</h3>
        <button id="qa-close-btn" class="close-btn">&times;</button>
      </div>
      <div class="qa-modal-content">
    `;

    // Use the same formatAsMarkdown function for consistency
    const formattedContent = formatAsMarkdown(analysis);
    
    // Convert HTML to Jira panel format
    html += `<div class="qa-modal-section">
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6;">
        ${formattedContent}
      </div>
    </div>`;
    
    // Close modal
    html += `
      </div>
      <div class="qa-modal-footer">
        <button id="qa-close-btn" class="qa-modal-button">Close</button>
      </div>
    `;
    
    qaPanel.innerHTML = html;
    
    // Add close button listener
    const closeBtn = qaPanel.querySelector('#qa-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => closeJiraPanel());
    }
  }

/**
 * Get score label for display
 */
function getScoreLabel(score) {
  if (score <= 2) return 'Needs Work';
  if (score === 3) return 'Decent';
  if (score === 4) return 'Good';
  if (score === 5) return 'Excellent';
  return 'Unknown';
}
function getScoreEmoji(score) {
  if (score <= 2) return '😞';
  if (score === 3) return '😐';
  if (score === 4) return '😊';
  if (score === 5) return '🎉';
  return '❓';
}

  /**
   * Format analysis as Markdown for Jira (with proper newlines and formatting)
   */
  function formatAsMarkdownForJira(insights) {
    console.log('🔍 formatAsMarkdownForJira called with data:', insights);
    
    let text = '';
    
    // Handle minimal mode
    if (insights.minimalMode) {
      text += `⚠️ **Insufficient Information for Full Analysis**\n\n`;
      text += `📊 Ready for Development Score: ${insights.readyForDevelopmentScore}/5\n\n`;
      
      if (insights.scoreImpactFactors && insights.scoreImpactFactors.length > 0) {
        text += 'What\'s Missing:\n';
        insights.scoreImpactFactors.slice(0, 5).forEach(factor => {
          text += `• ${factor}\n`;
        });
        text += '\n';
      }
      
      if (insights.message) {
        text += `${insights.message}\n\n`;
      }
      
      return text;
    }

           // User Value (new section)
           if (insights.userValue) {
             text += '## 🎯 USER VALUE\n';
             text += `**Level:** ${insights.userValue.level}\n`;
             text += `**Summary:** ${insights.userValue.summary}\n\n`;
           }

           // Readiness Assessment
           text += '## 📊 TICKET READINESS\n';
           text += `**As-is:** ${insights.initialReadinessScore}/5 ${getScoreEmoji(insights.initialReadinessScore)} (${getScoreLabel(insights.initialReadinessScore)})\n`;
           text += `**With Ovi's analysis:** ${insights.readyForDevelopmentScore}/5 ${getScoreEmoji(insights.readyForDevelopmentScore)} (${getScoreLabel(insights.readyForDevelopmentScore)})\n\n`;
    
    // Improvements Needed
    if (insights.improvementsNeeded && insights.improvementsNeeded.length > 0) {
      text += '## 🔧 IMPROVEMENTS NEEDED\n';
      insights.improvementsNeeded.forEach((improvement, i) => {
        text += `${i + 1}. **${improvement}**\n`;
      });
      text += '\n';
    }

    // QA Questions
    const questions = insights.qaQuestions || insights.topQuestions || [];
    if (questions.length > 0) {
      text += '🧠 QA Questions\n\n';
      questions.slice(0, 5).forEach((q, i) => {
        const cleanQuestion = q.replace(/^🧠\s*/, '');
        text += `${i + 1}. ${cleanQuestion}\n`;
      });
      text += '\n';
    }

    // Key Risks
    if (insights.keyRisks && insights.keyRisks.length > 0) {
      text += '⚠️ Key Risks\n\n';
      insights.keyRisks.slice(0, 5).forEach((r, i) => {
        const cleanRisk = r.replace(/^⚠️\s*/, '');
        text += `${i + 1}. ${cleanRisk}\n`;
      });
      text += '\n';
    }

    // Test Recipe
    if (insights.testRecipe && insights.testRecipe.length > 0) {
      text += '🧪 Test Recipe\n\n';
      
      // Sort test scenarios by priority
      const sortedTestRecipe = insights.testRecipe.sort((a, b) => {
        const priorityOrder = { 'Happy Path': 1, 'Critical Path': 2, 'Edge Case': 3 };
        return (priorityOrder[a.priority] || 4) - (priorityOrder[b.priority] || 4);
      });

      // Create table header
      text += '||Scenario||Steps||Expected||Type||\n';

      // Add table rows
      sortedTestRecipe.forEach(tr => {
        text += `|${tr.scenario}|${tr.steps}|${tr.expected}|${tr.priority}|\n`;
      });
      text += '\n';
    }

    // Footer
    text += '\nGenerated by Ovi AI - FirstQA';

    return text;
  }
  
  // Initialize the extension
  console.log('🔧 FirstQA Content Script: About to call init()...');
  init();
  console.log('🔧 FirstQA Content Script: Script loaded successfully');
})(); 