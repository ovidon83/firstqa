// Background script for FirstQA Ovi AI Chrome Extension

class BackgroundManager {
    constructor() {
        this.init();
    }

    async init() {
        this.setupEventListeners();
        // Removed checkInstallation call since it doesn't exist
    }

    setupEventListeners() {
        // Listen for extension installation
        chrome.runtime.onInstalled.addListener((details) => {
            this.handleInstallation(details);
        });

        // Listen for messages from content scripts and popup
        chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
            this.handleMessage(request, sender, sendResponse);
            return true; // Keep message channel open for async responses
        });

        // Listen for tab updates to inject content scripts
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
            this.handleTabUpdate(tabId, changeInfo, tab);
        });

        // Listen for tab activation to update badge
        chrome.tabs.onActivated.addListener((activeInfo) => {
            this.handleTabActivation(activeInfo);
        });
    }

    async handleInstallation(details) {
        if (details.reason === 'install') {
            console.log('FirstQA Ovi AI extension installed');
            
            // Set default settings
            await chrome.storage.local.set({
                'firstqa_settings': {
                    autoAnalyze: true,
                    showNotifications: true,
                    insertComments: false,
                    theme: 'light'
                }
            });

            // Show a notification instead of opening a page
            await this.showNotification(
                'FirstQA Ovi AI Installed!', 
                'Navigate to any Linear or Jira ticket to start analyzing.'
            );
        } else if (details.reason === 'update') {
            console.log('FirstQA Ovi AI extension updated');
        }
    }

    async handleMessage(request, sender, sendResponse) {
        try {
            switch (request.action) {
                case 'getSettings':
                    const settings = await this.getSettings();
                    sendResponse({ success: true, settings });
                    break;

                case 'updateSettings':
                    await this.updateSettings(request.settings);
                    sendResponse({ success: true });
                    break;

                case 'getAPIKey':
                    const apiKey = await this.getAPIKey();
                    sendResponse({ success: true, apiKey });
                    break;

                case 'setAPIKey':
                    await this.setAPIKey(request.apiKey);
                    sendResponse({ success: true });
                    break;

                case 'testConnection':
                    const isConnected = await this.testConnection();
                    sendResponse({ success: true, isConnected });
                    break;

                case 'getUsageStats':
                    const stats = await this.getUsageStats();
                    sendResponse({ success: true, stats });
                    break;

                case 'updateBadge':
                    await this.updateBadge(request.text, request.color);
                    sendResponse({ success: true });
                    break;

                case 'showNotification':
                    await this.showNotification(request.title, request.message);
                    sendResponse({ success: true });
                    break;

                default:
                    sendResponse({ success: false, error: 'Unknown action' });
            }
        } catch (error) {
            console.error('Background message handler error:', error);
            sendResponse({ success: false, error: error.message });
        }
    }

    async handleTabUpdate(tabId, changeInfo, tab) {
        // Only inject content script when page is complete and matches our patterns
        if (changeInfo.status === 'complete' && tab.url) {
            const isSupportedPlatform = this.isSupportedPlatform(tab.url);
            
            if (isSupportedPlatform) {
                // Update badge to show we're on a supported platform
                await this.updateBadge('QA', '#10b981');

                // Wait a moment for the page to fully load
                await new Promise(resolve => setTimeout(resolve, 1000));

                // Check if content script is ready
                try {
                    await chrome.tabs.sendMessage(tabId, { action: 'checkTicketPage' });
                } catch (error) {
                    console.log('Content script not ready yet, will load automatically');
                    // Don't reload - content script will be injected automatically on next page load
                }
            } else {
                // Clear badge
                await this.updateBadge('', '');
            }
        }
    }

    async handleTabActivation(activeInfo) {
        try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            
            if (tab.url && this.isSupportedPlatform(tab.url)) {
                await this.updateBadge('QA', '#10b981');
            } else {
                await this.updateBadge('', '');
            }
        } catch (error) {
            console.error('Error handling tab activation:', error);
        }
    }

    isSupportedPlatform(url) {
        return url.includes('linear.app') || url.includes('atlassian.net');
    }

    async getSettings() {
        const result = await chrome.storage.local.get('firstqa_settings');
        return result.firstqa_settings || {
            autoAnalyze: true,
            showNotifications: true,
            insertComments: false,
            theme: 'light'
        };
    }

    async updateSettings(settings) {
        await chrome.storage.local.set({ 'firstqa_settings': settings });
    }

    async getAPIKey() {
        const result = await chrome.storage.local.get('firstqa_api_key');
        return result.firstqa_api_key || null;
    }

    async setAPIKey(apiKey) {
        await chrome.storage.local.set({ 'firstqa_api_key': apiKey });
    }

    async testConnection() {
        try {
            const apiKey = await this.getAPIKey();
            if (!apiKey) return false;

            const response = await fetch('https://www.firstqa.dev/api/health', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                }
            });
            return response.ok;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }

    async getUsageStats() {
        try {
            const apiKey = await this.getAPIKey();
            if (!apiKey) return null;

            const response = await fetch('https://www.firstqa.dev/api/usage', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                }
            });

            if (!response.ok) return null;
            return await response.json();
        } catch (error) {
            console.error('Failed to get usage stats:', error);
            return null;
        }
    }

    async updateBadge(text, color) {
        try {
            await chrome.action.setBadgeText({ text });
            if (color) {
                await chrome.action.setBadgeBackgroundColor({ color });
            }
        } catch (error) {
            console.error('Failed to update badge:', error);
        }
    }

    async showNotification(title, message) {
        try {
            const settings = await this.getSettings();
            if (!settings.showNotifications) return;

            await chrome.notifications.create({
                type: 'basic',
                iconUrl: 'icons/icon48.png',
                title: title,
                message: message
            });
        } catch (error) {
            console.error('Failed to show notification:', error);
        }
    }
}

// Initialize background manager
new BackgroundManager();
