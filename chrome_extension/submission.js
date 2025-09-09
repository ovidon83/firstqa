/**
 * Handles comment submission for Linear tickets
 */

async function insertLinearComment(commentText) {
  console.log('🚀 Starting Linear comment insertion (simplified)');

  try {
    // Find the comment input field
    const commentInput = document.querySelector('.ProseMirror, [contenteditable="true"]');
    if (!commentInput) {
      console.error('❌ Linear comment input not found.');
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