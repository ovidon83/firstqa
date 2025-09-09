# FirstQA Ovi AI Chrome Extension

A Chrome extension that provides AI-powered QA analysis for Linear and Jira tickets. The extension automatically detects ticket pages, analyzes the content, and generates comprehensive QA insights including smart questions, risk areas, and test recipes.

## Features

### 🤖 AI-Powered Analysis
- **Smart Questions**: Generates relevant questions a QA engineer would ask
- **Risk Areas**: Identifies potential risk areas and edge cases
- **Test Recipe**: Creates comprehensive test cases (Critical, General, Edge Cases)
- **Production Readiness Score**: Provides a 1-10 score for production readiness

### 🎯 Platform Support
- **Linear**: Full support for Linear issue pages
- **Jira**: Full support for Jira ticket pages
- **Automatic Detection**: Automatically detects when you're on a supported platform

### 💬 Comment Integration
- **Direct Comment Insertion**: Insert analysis directly as a comment in the ticket
- **Formatted Output**: Clean, markdown-formatted comments with proper structure
- **Branded Comments**: Comments appear under "Ovi by FirstQA" with robot emoji

### 🎨 Modern UI
- **Floating Panel**: Clean, collapsible panel on ticket pages
- **Extension Popup**: Modern popup with status indicators and controls
- **Responsive Design**: Works on all screen sizes
- **Loading States**: Smooth loading animations and feedback

## Installation

### Development Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd chrome_extension
   ```

2. **Generate Icons**
   ```bash
   # Using ImageMagick (if available)
   convert icons/icon.svg -resize 16x16 icons/icon16.png
   convert icons/icon.svg -resize 48x48 icons/icon48.png
   convert icons/icon.svg -resize 128x128 icons/icon128.png
   
   # Or use online SVG to PNG converters
   ```

3. **Load in Chrome**
   - Open Chrome and go to `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `chrome_extension` folder

4. **Configure API Key**
   - Click the extension icon
   - Enter your FirstQA API key
   - Test the connection

### Production Installation

The extension will be available on the Chrome Web Store once published.

## Usage

### Automatic Analysis
1. Navigate to any Linear or Jira ticket
2. The extension automatically detects the ticket
3. Analysis begins automatically (if enabled in settings)
4. Results appear in the floating panel

### Manual Analysis
1. Click the extension icon in the toolbar
2. Click "Analyze Current Ticket"
3. Wait for analysis to complete
4. View results in the popup

### Inserting Comments
1. After analysis is complete
2. Click "Insert as Comment" in the popup
3. The analysis will be inserted as a formatted comment
4. Comments appear under "Ovi by FirstQA"

### Copying Analysis
1. After analysis is complete
2. Click "Copy Analysis" in the popup
3. Analysis is copied to clipboard as markdown
4. Paste anywhere you need the analysis

## Configuration

### Settings
- **Auto Analyze**: Automatically analyze tickets when detected
- **Show Notifications**: Display notifications for analysis completion
- **Insert Comments**: Automatically insert comments after analysis
- **Theme**: Light or dark theme (future feature)

### API Configuration
- **API Key**: Your FirstQA API key for authentication
- **Connection Test**: Test API connectivity
- **Usage Stats**: View API usage statistics

## Architecture

### File Structure
```
chrome_extension/
├── manifest.json          # Extension manifest
├── background.js          # Background service worker
├── popup.html             # Extension popup UI
├── popup.js               # Popup logic
├── content.js             # Content script for ticket pages
├── utils.js               # Utility functions
├── ui.css                 # Styles for floating panel
├── scripts/
│   └── firstqa-api.js     # API integration
└── icons/
    ├── icon.svg           # Source icon
    ├── icon16.png         # 16x16 icon
    ├── icon48.png         # 48x48 icon
    └── icon128.png        # 128x128 icon
```

### Key Components

#### Background Script (`background.js`)
- Manages extension lifecycle
- Handles settings and API key storage
- Updates badge and notifications
- Coordinates between popup and content scripts

#### Content Script (`content.js`)
- Detects ticket pages
- Extracts ticket data
- Manages floating panel UI
- Handles comment insertion
- Communicates with API

#### Popup (`popup.html` + `popup.js`)
- Modern UI for extension controls
- Status indicators and progress
- Manual analysis triggers
- Settings management

#### API Integration (`scripts/firstqa-api.js`)
- Handles communication with FirstQA backend
- Manages authentication
- Provides fallback to legacy API
- Error handling and retry logic

## API Integration

### Endpoints
- **Analysis**: `/api/analyze-ticket` - Generate QA analysis
- **Health**: `/api/health` - Check API status
- **Usage**: `/api/usage` - Get usage statistics

### Request Format
```json
{
  "ticketId": "PROJ-123",
  "title": "Ticket title",
  "description": "Ticket description",
  "comments": ["Comment 1", "Comment 2"],
  "labels": ["bug", "frontend"],
  "platform": "linear",
  "priority": "high",
  "type": "story"
}
```

### Response Format
```json
{
  "smartQuestions": ["Question 1", "Question 2"],
  "riskAreas": ["Risk 1", "Risk 2"],
  "testRecipe": {
    "critical": ["Test 1", "Test 2"],
    "general": ["Test 3", "Test 4"],
    "edgeCases": ["Test 5", "Test 6"]
  },
  "productionReadinessScore": 8,
  "summary": "Analysis summary",
  "confidence": 0.9
}
```

## Development

### Local Development
1. Make changes to the code
2. Reload the extension in Chrome
3. Test on Linear or Jira ticket pages
4. Check console for any errors

### Debugging
- **Content Script**: Check browser console on ticket pages
- **Background Script**: Check extension background page console
- **Popup**: Check popup console (right-click > Inspect)

### Testing
- Test on both Linear and Jira
- Test different ticket types
- Test error scenarios (no API key, network issues)
- Test comment insertion functionality

## Security

### API Key Security
- API keys are stored securely in Chrome's storage
- Keys are never exposed in client-side code
- All API calls go through secure HTTPS endpoints

### Data Privacy
- Only ticket data is sent to FirstQA API
- No personal data is collected or stored
- Analysis results are cached locally for performance

## Troubleshooting

### Common Issues

#### Extension Not Working
- Check if you're on a supported platform (Linear/Jira)
- Verify API key is configured correctly
- Check browser console for errors
- Reload the extension

#### Analysis Failing
- Verify internet connection
- Check API key is valid
- Try refreshing the page
- Check API status at https://www.firstqa.dev/api/health

#### Comments Not Inserting
- Ensure you have write permissions on the ticket
- Check if comment fields are present on the page
- Try manual comment insertion
- Check browser console for errors

### Support
- Check the [FirstQA documentation](https://www.firstqa.dev/docs)
- Contact support at support@firstqa.dev
- Report issues on GitHub

## Changelog

### v1.0.0
- Initial release
- Support for Linear and Jira
- AI-powered QA analysis
- Comment insertion functionality
- Modern UI with popup and floating panel
- Background script for lifecycle management

## License

This extension is part of the FirstQA platform. See the main repository for license information. 