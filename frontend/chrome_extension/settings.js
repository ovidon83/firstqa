// Settings page script for FirstQA Ovi AI Chrome Extension

class SettingsManager {
    constructor() {
        this.init();
    }

    async init() {
        this.setupEventListeners();
        await this.loadCurrentSettings();
    }

    setupEventListeners() {
        // API Key buttons
        document.getElementById('testConnection').addEventListener('click', () => {
            this.testConnection();
        });

        document.getElementById('saveApiKey').addEventListener('click', () => {
            this.saveApiKey();
        });

        // Settings buttons
        document.getElementById('saveSettings').addEventListener('click', () => {
            this.saveSettings();
        });

        // Statistics button
        document.getElementById('loadStats').addEventListener('click', () => {
            this.loadStatistics();
        });

        // Action buttons
        document.getElementById('clearCache').addEventListener('click', () => {
            this.clearCache();
        });

        document.getElementById('resetSettings').addEventListener('click', () => {
            this.resetSettings();
        });
    }

    async loadCurrentSettings() {
        try {
            // Load API key
            const apiKeyResult = await chrome.storage.local.get('firstqa_api_key');
            if (apiKeyResult.firstqa_api_key) {
                document.getElementById('apiKey').value = apiKeyResult.firstqa_api_key;
            }

            // Load settings
            const settingsResult = await chrome.storage.local.get('firstqa_settings');
            const settings = settingsResult.firstqa_settings || {
                autoAnalyze: true,
                showNotifications: true,
                insertComments: false,
                theme: 'light'
            };

            document.getElementById('autoAnalyze').checked = settings.autoAnalyze;
            document.getElementById('showNotifications').checked = settings.showNotifications;
            document.getElementById('insertComments').checked = settings.insertComments;
        } catch (error) {
            console.error('Error loading settings:', error);
            this.showStatus('Error loading settings', 'error');
        }
    }

    async testConnection() {
        const button = document.getElementById('testConnection');
        const spinner = button.querySelector('.loading-spinner');
        const originalText = button.textContent;

        try {
            button.disabled = true;
            spinner.classList.remove('hidden');
            button.textContent = 'Testing...';

            const apiKey = document.getElementById('apiKey').value;
            if (!apiKey) {
                throw new Error('Please enter an API key first');
            }

            // Send message to background script to test connection
            const response = await chrome.runtime.sendMessage({
                action: 'testConnection',
                apiKey: apiKey
            });

            if (response.success && response.isConnected) {
                this.showStatus('✅ Connection successful!', 'success');
            } else {
                throw new Error('Connection failed. Please check your API key.');
            }
        } catch (error) {
            console.error('Connection test failed:', error);
            this.showStatus(`❌ ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            spinner.classList.add('hidden');
            button.textContent = originalText;
        }
    }

    async saveApiKey() {
        try {
            const apiKey = document.getElementById('apiKey').value.trim();
            
            if (!apiKey) {
                throw new Error('Please enter an API key');
            }

            await chrome.storage.local.set({ 'firstqa_api_key': apiKey });
            this.showStatus('✅ API key saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving API key:', error);
            this.showStatus(`❌ ${error.message}`, 'error');
        }
    }

    async saveSettings() {
        try {
            const settings = {
                autoAnalyze: document.getElementById('autoAnalyze').checked,
                showNotifications: document.getElementById('showNotifications').checked,
                insertComments: document.getElementById('insertComments').checked,
                theme: 'light' // Default theme
            };

            await chrome.storage.local.set({ 'firstqa_settings': settings });
            this.showStatus('✅ Settings saved successfully!', 'success');
        } catch (error) {
            console.error('Error saving settings:', error);
            this.showStatus(`❌ ${error.message}`, 'error');
        }
    }

    async loadStatistics() {
        const button = document.getElementById('loadStats');
        const originalText = button.textContent;

        try {
            button.disabled = true;
            button.textContent = 'Loading...';

            // Send message to background script to get stats
            const response = await chrome.runtime.sendMessage({
                action: 'getUsageStats'
            });

            if (response.success && response.stats) {
                this.displayStatistics(response.stats);
                this.showStatus('✅ Statistics loaded successfully!', 'success');
            } else {
                throw new Error('Failed to load statistics');
            }
        } catch (error) {
            console.error('Error loading statistics:', error);
            this.showStatus(`❌ ${error.message}`, 'error');
        } finally {
            button.disabled = false;
            button.textContent = originalText;
        }
    }

    displayStatistics(stats) {
        const container = document.getElementById('statsContainer');
        const totalAnalyses = document.getElementById('totalAnalyses');
        const thisMonth = document.getElementById('thisMonth');
        const avgScore = document.getElementById('avgScore');

        totalAnalyses.textContent = stats.totalAnalyses || 0;
        thisMonth.textContent = stats.thisMonth || 0;
        avgScore.textContent = stats.averageScore ? stats.averageScore.toFixed(1) : '-';

        container.classList.remove('hidden');
    }

    async clearCache() {
        try {
            // Get all keys that start with 'analysis_'
            const result = await chrome.storage.local.get(null);
            const analysisKeys = Object.keys(result).filter(key => key.startsWith('analysis_'));
            
            if (analysisKeys.length > 0) {
                await chrome.storage.local.remove(analysisKeys);
                this.showStatus(`✅ Cleared ${analysisKeys.length} cached analyses!`, 'success');
            } else {
                this.showStatus('ℹ️ No cached analyses to clear', 'info');
            }
        } catch (error) {
            console.error('Error clearing cache:', error);
            this.showStatus(`❌ ${error.message}`, 'error');
        }
    }

    async resetSettings() {
        try {
            const defaultSettings = {
                autoAnalyze: true,
                showNotifications: true,
                insertComments: false,
                theme: 'light'
            };

            await chrome.storage.local.set({ 'firstqa_settings': defaultSettings });
            
            // Update UI
            document.getElementById('autoAnalyze').checked = defaultSettings.autoAnalyze;
            document.getElementById('showNotifications').checked = defaultSettings.showNotifications;
            document.getElementById('insertComments').checked = defaultSettings.insertComments;

            this.showStatus('✅ Settings reset to defaults!', 'success');
        } catch (error) {
            console.error('Error resetting settings:', error);
            this.showStatus(`❌ ${error.message}`, 'error');
        }
    }

    showStatus(message, type) {
        const statusElement = document.getElementById('statusMessage');
        statusElement.textContent = message;
        statusElement.className = `status ${type}`;
        statusElement.classList.remove('hidden');

        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusElement.classList.add('hidden');
        }, 5000);
    }
}

// Initialize settings manager when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SettingsManager();
});
