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
├── docs/                    # Documentation
│   ├── plan.md             # Daily/weekly plans, work log
│   ├── features.md         # Feature backlog
│   ├── marketing/          # LinkedIn, X, IG content
│   └── customer-support/   # Support docs, FAQs
├── backend/                 # Server-side code
│   ├── routes/             # Express routes
│   ├── services/           # Business logic
│   ├── utils/              # Utilities
│   ├── lib/                # Shared libs
│   └── ai/                 # AI prompts & OpenAI client
├── frontend/                # Client-side code
│   ├── views/              # EJS templates
│   ├── public/             # Static assets (CSS, images)
│   └── chrome_extension/   # Chrome extension
├── scripts/                # Dev/ops scripts
├── supabase/               # DB migrations
├── webhook-server.js       # Entry point
└── .env.example            # Env template (copy to .env)
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

3. **Create a `.env` file** (`.env.example` documents all required variables):
```bash
cp .env.example .env
# Edit .env with your GitHub App, OpenAI, Supabase, etc.
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
- **Render / Production**: Set `ENABLE_KNOWLEDGE_SYNC=true` to enable codebase indexing during onboarding. If unset, the indexing step will show "Indexing is not enabled" and users can continue without it.

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