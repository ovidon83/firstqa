// Utility functions for QA Copilot Chrome Extension

/**
 * Detects if the current page is a Linear or Jira ticket
 * @returns {Object|null} { platform: 'linear'|'jira', ticketData: {id, title, description} }
 */
function detectTicket() {
  const url = window.location.href;
  
  if (url.includes('linear.app')) {
    return detectLinearTicket();
  } else if (url.includes('atlassian.net')) {
    return detectJiraTicket();
  }
  
  return null;
}

/**
 * Detects Linear ticket and extracts data
 * @returns {Object|null}
 */
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
  
  // DOM INSPECTOR: Let's find what elements actually exist
  console.log('🔍 DOM INSPECTOR - All elements containing "password reset":');
  const allElements = document.querySelectorAll('*');
  const relevantElements = Array.from(allElements).filter(el => 
    el.textContent && el.textContent.toLowerCase().includes('password reset')
  ).slice(0, 10); // Limit to first 10 matches
  
  relevantElements.forEach((el, index) => {
    console.log(`🔍 Element ${index}:`, {
      tagName: el.tagName,
      className: el.className,
      id: el.id,
      textContent: el.textContent.substring(0, 100) + '...',
      attributes: Array.from(el.attributes).map(attr => `${attr.name}="${attr.value}"`).join(' ')
    });
  });

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

/**
 * Detects Jira ticket and extracts data
 * @returns {Object|null}
 */
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
    '[aria-label*="Summary"]',
    // Add more modern Jira selectors
    'h1[data-testid*="summary"]',
    '[data-testid*="summary"] h1',
    'h1[data-testid*="heading"]',
    '[data-testid*="issue-title"]',
    'h1[data-testid*="issue-title"]',
    // Fallback selectors
    'h1',
    '[data-testid*="title"]',
    '.title'
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
    '[role="main"] [data-testid*="description"]',
    
    // Additional fallback selectors
    '[data-testid*="field"] .ak-renderer-document',
    '[data-testid*="field"]',
    '.ak-renderer-document p',
    '.ak-renderer-document div',
    '[contenteditable="true"]',
    '.description-text',
    '[data-testid*="content"]',
    'div[data-testid*="description"] p',
    'div[data-testid*="description"] div'
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

/**
 * Helper function to get text from multiple selectors
 * @param {Array} selectors - Array of CSS selectors to try
 * @returns {string|null}
 */
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

/**
 * Calls the external API to get QA insights
 * @param {Object} ticketData - {title, description}
 * @returns {Promise<Object>} API response
 */
async function getQAInsights(ticketData) {
  try {
    const response = await fetch('https://www.firstqa.dev/api/analyze-ticket', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ticketId: ticketData.id || 'UNKNOWN',
        title: ticketData.title,
        description: ticketData.description,
        platform: window.location.href.includes('linear.app') ? 'linear' : 'jira',
        priority: 'medium',
        type: 'story'
      })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('Error calling QA API:', error);
    throw error;
  }
}

/**
 * Copies text to clipboard
 * @param {string} text - Text to copy
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
 * Debounce function to limit API calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
} 