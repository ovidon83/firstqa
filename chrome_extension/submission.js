/**
 * Handles comment submission for Linear tickets
 */

async function insertLinearComment(commentText) {
  console.log('🚀 Starting Linear comment insertion (improved selector)');

  try {
    // More specific selectors for Linear comment input
    // Try multiple selectors in order of specificity
    const selectors = [
      // Most specific: comment placeholder with "Leave a comment" text
      '[data-empty-text="Leave a comment..."]',
      // Comment placeholder elements
      '.editor-placeholder',
      // Comment input in activity section
      '.activity-section .ProseMirror',
      '.activity-section [contenteditable="true"]',
      // Generic comment input (fallback)
      '[data-testid="comment-input"] .ProseMirror',
      '[data-testid="comment-input"] [contenteditable="true"]',
      // Last resort: any ProseMirror that's not in description
      '.ProseMirror:not([aria-label="Issue description"])'
    ];
    
    let commentInput = null;
    for (const selector of selectors) {
      commentInput = document.querySelector(selector);
      if (commentInput) {
        console.log(`✅ Found comment input with selector: ${selector}`);
        break;
      }
    }
    
    if (!commentInput) {
      console.error('❌ Linear comment input not found with any selector.');
      console.log('Available ProseMirror elements:', document.querySelectorAll('.ProseMirror'));
      return false;
    }

    // Focus and insert text
    commentInput.focus();
    commentInput.innerHTML = commentText;
    
    // Trigger input event to notify Linear
    commentInput.dispatchEvent(new Event('input', { bubbles: true }));
    
    console.log('✅ Comment text inserted successfully');
    
    // Note: We don't auto-submit anymore to avoid errors
    // User can manually submit with Cmd+Enter or click submit
    return true;
  } catch (error) {
    console.error('❌ Error in insertLinearComment:', error);
    return false;
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { insertLinearComment };
} else {
  // Browser environment
  window.insertLinearComment = insertLinearComment;
}