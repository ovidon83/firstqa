# FirstQA

> **Your First QA Hire for Solo Founders & Startups** - Ovi AI + Human QA Experts

FirstQA is a comprehensive QA platform that combines AI-powered analysis with on-demand human QA expertise. Our platform offers instant PR feedback through Ovi AI and connects you with expert QA engineers for complex testing scenarios.

## 🚀 **What We Offer**

### **🤖 Ovi AI - Your 24/7 QA Agent**
- **⚡ Instant Analysis**: Get comprehensive QA feedback in seconds, not days
- **🎯 Smart Testing**: AI analyzes tickets and PRs like a senior QA engineer
- **🔍 Risk Detection**: Identifies potential issues, bugs, and edge cases
- **📋 Test Recipes**: Generates actionable test plans and scenarios
- **💡 Expert Questions**: Asks the right questions a QA engineer would ask

### **👥 Human QA Experts - When You Need Real Expertise**
- **🔬 Exploratory Testing**: Deep-dive testing for complex features
- **🛡️ Security Testing**: Vulnerability assessment and penetration testing
- **📱 Cross-Platform Validation**: Testing across devices, browsers, and platforms
- **🔄 Regression Testing**: Full/partial regression testing for major releases
- **🎭 User Experience Testing**: Real user scenario validation

## ✨ **Key Features**

- **🎯 Release Pulse Analysis**: Instant assessment of user value, confidence, and change impact
- **🧪 AI-Generated Test Recipes**: Comprehensive test scenarios with actionable steps
- **⚠️ Risk & Bug Detection**: Identifies potential issues and missing error handling
- **🔍 Product Area Analysis**: Maps changes to affected features and user flows
- **⚡ Instant GitHub Integration**: Works directly in your PRs with `/qa` command
- **👥 Human QA Experts**: On-demand senior QA when you need real expertise

## 🏗️ **Project Structure**

```
FirstQA/
├── 📁 docs/                          # Documentation per product area
│   ├── 📁 landing-page/             # Landing page documentation
│   ├── 📁 github-app/               # GitHub App implementation docs
│   ├── 📁 chrome-extension/         # Chrome extension docs (future)
│   ├── 📁 api/                      # API documentation
│   └── 📁 deployment/               # Deployment guides
├── 📁 src/                          # Main application source
│   ├── 📁 modules/                  # Feature modules
│   ├── 📁 components/               # Reusable UI components
│   ├── 📁 services/                 # Business logic services
│   ├── 📁 config/                   # Configuration files
│   ├── 📁 routes/                   # Express.js routes
│   ├── 📁 views/                    # EJS templates
│   ├── 📁 utils/                    # Utility functions
│   └── 📁 public/                   # Static assets
├── 📁 FirstQA-Extension/            # Chrome extension (future)
├── 📁 ai/                           # AI integration and prompts
├── 📁 data/                         # Data storage (JSON files)
├── 📁 public/                       # Public static assets
├── webhook-server.js                # Main production server
├── fixed-webhook.js                 # Webhook proxy for development
└── package.json                     # Dependencies and scripts
```

## 🛠️ **Tech Stack**

- **Frontend**: EJS templates, Bootstrap 5, Tailwind-inspired CSS
- **Backend**: Node.js/Express
- **AI**: OpenAI GPT-4 integration
- **Storage**: JSON file storage (no database required)
- **Integration**: GitHub API via Octokit, GitHub App authentication
- **Deployment**: Ready for production deployment

## 🚀 **Getting Started**

### **Prerequisites**

- Node.js (v14+)
- npm
- A GitHub repository with a webhook configured
- A smee.io channel for webhook proxying (for local development)

### **Installation**

1. **Clone the repository**:
```bash
git clone https://github.com/ovidon83/firstqa.git
cd firstqa
```

2. **Install dependencies**:
```bash
npm install
```

3. **Create a `.env` file** with your configuration:
```bash
# Server configuration
PORT=3000
NODE_ENV=development

# Session management
SESSION_SECRET=your-session-secret-key

# GitHub App configuration (recommended)
GITHUB_APP_ID=your-app-id
GITHUB_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
GITHUB_WEBHOOK_SECRET=your-webhook-secret

# GitHub PAT (legacy, optional fallback)
GITHUB_TOKEN=your-github-token

# OpenAI Configuration
OPENAI_API_KEY=your-openai-api-key
OPENAI_MODEL=gpt-4o

# Webhook configuration
WEBHOOK_PROXY_URL=https://smee.io/your-smee-url
ENABLE_GITHUB=true

# Notification settings
NOTIFICATION_EMAIL=your-email@example.com
```

4. **Start the webhook server**:
```bash
npm start
```

5. **Visit the application**:
- Main site: http://localhost:3000
- Dashboard: http://localhost:3000/dashboard
- Documentation: http://localhost:3000/docs

## 🤖 **Ovi AI - Your AI QA Agent**

FirstQA features **Ovi**, an AI-powered QA Agent that provides comprehensive analysis for your pull requests.

### **What Ovi Analyzes**

1. **🔍 Release Pulse Analysis**
   - **User Value**: Assesses the meaningful value and benefit to end users
   - **Release Confidence**: Evaluates test coverage, implementation quality, and edge case handling
   - **Change Impact**: Analyzes scope of changes and affected components
   - **Release Decision**: Provides Go/No-Go recommendation with clear reasoning

2. **🧪 Test Recipe**
   - Creates comprehensive test scenarios (Critical Priority, High Priority)
   - Includes both positive and negative test cases
   - Provides actionable test steps with expected results
   - Focuses on business impact and user dependency

3. **⚠️ Risk Assessment**
   - Identifies potential runtime issues and security vulnerabilities
   - Highlights missing error handling and code defects
   - Asks critical questions about edge cases and integration
   - Analyzes affected product areas and dependencies

## 🌐 **Production Deployment**

### **Environment Setup**
- Set `NODE_ENV=production`
- Configure production database/storage
- Set up proper SSL certificates
- Configure production webhook endpoints

### **Deployment Options**
- **Heroku**: Easy deployment with Git integration
- **AWS**: EC2, ECS, or Lambda deployment
- **DigitalOcean**: App Platform or Droplet deployment
- **Vercel**: Serverless deployment option

## 🔒 **Security & Privacy**

FirstQA takes security seriously. We understand that granting access to your codebase is a significant decision.

### **🔐 GitHub App Permissions**
- **Read-only access** to repository contents (code, pull requests, issues)
- **No write access** - We cannot modify your code
- **No admin access** - We cannot change repository settings
- **Revocable at any time** - You maintain full control

### **🛡️ Data Protection**
- **Analysis results**: Stored securely for 14 days, then automatically deleted
- **Code content**: Processed in memory only, never permanently stored
- **Personal information**: Never collected or stored
- **HTTPS/TLS encryption** for all data transmission

### **📋 Security Documentation**
- **🔒 Security Policy**: [View Security Details →](SECURITY.md)
- **🔐 Privacy Policy**: [Privacy Policy](https://firstqa.dev/privacy)
- **📄 Terms of Service**: [Terms](https://firstqa.dev/terms)
- **📧 Security Contact**: security@firstqa.dev

## 📚 **Documentation & Support**

- **📖 Documentation**: [View Documentation →](https://firstqa.dev/docs)
- **💬 Support**: [Get Support](https://firstqa.dev/support)
- **📧 Contact**: [Contact Us](https://firstqa.dev/contact)
- **💰 Pricing**: [View Plans](https://firstqa.dev/pricing)

## 🔗 **Quick Links**

- **🚀 Start Free Trial**: [Get Started](https://firstqa.dev)
- **📅 Schedule Demo**: [Book Demo](https://calendly.com/firstqa/demo)
- **📧 Contact Sales**: [Contact Sales](mailto:sales@firstqa.dev)
- **🐛 Report Issues**: [GitHub Issues](https://github.com/ovidon83/firstqa/issues)

## 📄 **License**

This project is licensed under the ISC License.

---

**Built with ❤️ by the FirstQA Team**

*The Only QA Stack Your Startup Needs* 