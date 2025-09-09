// Popup script for FirstQA Ovi AI Chrome Extension

document.addEventListener('DOMContentLoaded', function() {
    const analyzeBtn = document.getElementById('analyzeBtn');
    const statusText = document.getElementById('statusText');
    const statusDot = document.getElementById('statusDot');

    // Load current state
    loadCurrentState();

    // Handle analyze button click
    analyzeBtn.addEventListener('click', async function() {
        try {
            // Update UI to analyzing state
            setStatus('analyzing', '🔄 Analyzing...');
            analyzeBtn.disabled = true;

            // Get current tab
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            
            if (!tab) {
                throw new Error('No active tab found');
            }

            // Check if we're on a supported ticket page with improved retry logic
            let isTicketPage = false;
            let retryCount = 0;
            const maxRetries = 5; // Increased retries
            const retryDelay = 800; // Increased delay

            while (!isTicketPage && retryCount < maxRetries) {
                try {
                    setStatus('loading', `🔍 Detecting ticket... (${retryCount + 1}/${maxRetries})`);
                    
                    // First check if content script is ready
                    const isReady = await chrome.tabs.sendMessage(tab.id, { action: 'isReady' });
                    if (!isReady) {
                        throw new Error('Content script not ready');
                    }
                    
                    // Then check for ticket
                    isTicketPage = await chrome.tabs.sendMessage(tab.id, { action: 'checkTicketPage' });
                    if (isTicketPage) break;
                    
                } catch (error) {
                    console.log(`Retry ${retryCount + 1}/${maxRetries}: ${error.message}`);
                    // Progressive delay: 800ms, 1200ms, 1600ms, 2000ms, 2400ms
                    const delay = retryDelay + (retryCount * 400);
                    await new Promise(resolve => setTimeout(resolve, delay));
                }
                retryCount++;
            }
            
            if (!isTicketPage) {
                throw new Error('Could not detect ticket. The page may still be loading. Please wait a moment and try again.');
            }

            // Start dynamic thinking progress
            startThinkingProgress();

            // Analyze the ticket and automatically insert comment
            const result = await chrome.tabs.sendMessage(tab.id, { 
                action: 'analyzeAndInsertComment' 
            });
            
            // Stop thinking progress
            stopThinkingProgress();

            if (result.success) {
                // Extract score for display
                const score = result.analysis?.readyForDevelopmentScore || 'N/A';
                
                // Show completion first
                setStatus('success', `✅ Analysis complete!`);
                
                // After a brief delay, show score with Ready for Dev note if applicable
                setTimeout(() => {
                    const readyNote = (score >= 4 && score !== 'N/A') ? ' • Ready for Dev!' : '';
                    setStatus('success', `📊 Score: ${score}/5${readyNote}`);
                }, 1000);
                
                // Store the analysis for potential future use (only if we have a valid score)
                if (score !== 'N/A' && score !== undefined) {
                    await chrome.storage.local.set({
                        lastAnalysis: {
                            timestamp: Date.now(),
                            ticketId: result.ticketId,
                            analysis: result.analysis,
                            status: 'completed',
                            score: score,
                            readyForDev: score >= 4
                        }
                    });
                }

                // Close popup after successful analysis so modal can appear on top
                setTimeout(() => {
                    window.close();
                }, 1500);
            } else {
                throw new Error(result.error || 'Analysis failed');
            }

        } catch (error) {
            console.error('Analysis error:', error);
            stopThinkingProgress();
            setStatus('error', `❌ ${error.message || 'Analysis failed'}`);
        } finally {
            // Reset button state
            analyzeBtn.disabled = false;
        }
    });

    // Thinking progress variables
    let thinkingInterval;
    let progressStep = 0;
    
    const thinkingMessages = [
        '🧠 Processing ticket...',
        '🔍 Analyzing content...',
        '⚡ Generating insights...',
        '🤔 Thinking through edge cases...',
        '📝 Crafting test scenarios...',
        '🎯 Almost done...',
        '✨ Finalizing analysis...'
    ];

    function startThinkingProgress() {
        progressStep = 0;
        setStatus('loading', thinkingMessages[0]);
        
        // Update message every 4 seconds
        thinkingInterval = setInterval(() => {
            progressStep++;
            if (progressStep < thinkingMessages.length) {
                setStatus('loading', thinkingMessages[progressStep]);
            } else {
                // Cycle back to "almost done" messages
                const almostDoneMessages = [
                    '🎯 Almost done...',
                    '⏳ Just a moment more...',
                    '🚀 Nearly finished...'
                ];
                const cycleIndex = (progressStep - thinkingMessages.length) % almostDoneMessages.length;
                setStatus('loading', almostDoneMessages[cycleIndex]);
            }
        }, 4000);
    }

    function stopThinkingProgress() {
        if (thinkingInterval) {
            clearInterval(thinkingInterval);
            thinkingInterval = null;
        }
    }

    function setStatus(type, message) {
        statusText.textContent = message;
        statusDot.className = `status-dot ${type}`;
    }

    async function loadCurrentState() {
        try {
            // Check if we have a recent analysis
            const result = await chrome.storage.local.get('lastAnalysis');
            const lastAnalysis = result.lastAnalysis;
            
            if (lastAnalysis && isRecentAnalysis(lastAnalysis.timestamp)) {
                // Get current tab to check if we're still on the same ticket
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                
                if (tab) {
                    try {
                        // Check if we're still on the same ticket
                        const currentTicket = await chrome.tabs.sendMessage(tab.id, { action: 'getCurrentTicketId' });
                        
                        if (currentTicket === lastAnalysis.ticketId && lastAnalysis.score !== undefined) {
                            // Restore the completed state only if we have a valid score
                            const readyNote = lastAnalysis.readyForDev ? ' • Ready for Dev!' : '';
                            setStatus('success', `📊 Score: ${lastAnalysis.score}/5${readyNote}`);
                            return;
                        }
                    } catch (error) {
                        console.log('Could not check current ticket:', error);
                    }
                }
            }
            
            // Default to idle state
            setStatus('idle', 'Ready to analyze');
        } catch (error) {
            console.error('Error loading state:', error);
            setStatus('error', 'Error loading state');
        }
    }

    function isRecentAnalysis(timestamp) {
        // Consider analysis recent if within last 10 minutes
        const tenMinutes = 10 * 60 * 1000;
        return (Date.now() - timestamp) < tenMinutes;
    }
});
