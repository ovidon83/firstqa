# FirstQA Ovi AI Chrome Extension - Installation Guide

## Quick Start

### 1. Download the Extension
- Download the `chrome_extension` folder from this repository
- Ensure all files are present (manifest.json, content.js, popup.html, etc.)

### 2. Generate Icons
Before loading the extension, you need to generate the PNG icons from the SVG:

**Option A: Using ImageMagick (Recommended)**
```bash
cd chrome_extension/icons
convert icon.svg -resize 16x16 icon16.png
convert icon.svg -resize 48x48 icon48.png
convert icon.svg -resize 128x128 icon128.png
```

**Option B: Online Converter**
1. Open `icons/icon.svg` in a web browser
2. Use an online SVG to PNG converter
3. Generate sizes: 16x16, 48x48, and 128x128
4. Save as `icon16.png`, `icon48.png`, and `icon128.png` in the `icons/` folder

### 3. Load in Chrome
1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top-right corner)
3. Click "Load unpacked"
4. Select the `chrome_extension` folder
5. The extension should now appear in your extensions list

### 4. Configure API Key
1. Click the extension icon in your toolbar
2. Click "Open Settings" in the popup
3. Enter your FirstQA API key
4. Click "Test Connection" to verify
5. Click "Save API Key"

### 5. Test the Extension
1. Navigate to any Linear or Jira ticket
2. The extension should automatically detect the ticket
3. Click "Analyze Current Ticket" in the popup
4. Wait for analysis to complete
5. Try "Insert as Comment" to add analysis to the ticket

## Troubleshooting

### Extension Not Loading
- Check that all files are present in the folder
- Ensure icons are generated and in the correct location
- Check Chrome's extension page for error messages
- Try reloading the extension

### API Connection Issues
- Verify your API key is correct
- Check that you have internet connectivity
- Test the API endpoint directly: `https://www.firstqa.dev/api/health`
- Contact support if issues persist

### Analysis Not Working
- Ensure you're on a supported platform (Linear/Jira)
- Check that the ticket page is fully loaded
- Verify your API key is configured
- Check browser console for error messages

### Comments Not Inserting
- Ensure you have write permissions on the ticket
- Check that comment fields are present on the page
- Try refreshing the page and trying again
- Some ticket types may not support comments

## Development

### Making Changes
1. Edit the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon on the extension
4. Test your changes

### Debugging
- **Content Script**: Check browser console on ticket pages
- **Background Script**: Click "service worker" link in extension details
- **Popup**: Right-click popup and select "Inspect"

### File Structure
```
chrome_extension/
├── manifest.json          # Extension configuration
├── background.js          # Background service worker
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic
├── content.js             # Content script for ticket pages
├── utils.js               # Utility functions
├── ui.css                 # Styles for floating panel
├── settings.html          # Settings page
├── settings.js            # Settings logic
├── scripts/
│   └── firstqa-api.js     # API integration
└── icons/
    ├── icon.svg           # Source icon
    ├── icon16.png         # 16x16 icon (generate this)
    ├── icon48.png         # 48x48 icon (generate this)
    └── icon128.png        # 128x128 icon (generate this)
```

## Support

- Check the [main README](../README.md) for detailed documentation
- Contact support at support@firstqa.dev
- Report issues on GitHub
- Check the [FirstQA documentation](https://www.firstqa.dev/docs)
