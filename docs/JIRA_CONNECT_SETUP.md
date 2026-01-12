# Jira Connect App Setup Guide

FirstQA now uses **Atlassian Connect** for seamless Jira integration with automatic webhook setup!

## What is Atlassian Connect?

Atlassian Connect allows FirstQA to:
- ✅ Install at the **Jira site level** (works for all users)
- ✅ **Automatically register webhooks** (no manual setup needed)
- ✅ Provide a **GitHub-like installation experience**
- ✅ Work as a **team tool** (not user-specific)

## Private Installation (Without Marketplace)

Since FirstQA is not yet on the Atlassian Marketplace, customers can install it privately using the descriptor URL.

### Installation Steps for Customers

1. **Go to Jira Settings** (⚙️ icon in top right)
   - Select **Apps** → **Manage apps**

2. **Enable Private Apps**
   - Click **Settings** at the bottom left
   - Enable **"Enable development mode"** or **"Enable private listings"**
   - Click **Apply**

3. **Install FirstQA via URL**
   - Click **Upload app** (or **Install app from URL**)
   - Enter the descriptor URL: `https://www.firstqa.dev/atlassian-connect.json`
   - Click **Upload** or **Install**

4. **Done!**
   - FirstQA is now installed for your entire Jira site
   - All users can comment `/qa` on any ticket
   - No additional setup needed

### Testing the Installation

1. Go to any Jira ticket
2. Add a comment: `/qa`
3. FirstQA will analyze the ticket and post a comprehensive QA analysis

## Architecture

### How It Works

```
Customer installs FirstQA
    ↓
Jira calls /jira-connect/installed
    ↓
FirstQA stores installation (clientKey, sharedSecret)
    ↓
Webhooks automatically registered
    ↓
User comments /qa on ticket
    ↓
Jira sends webhook to FirstQA
    ↓
FirstQA verifies JWT, analyzes ticket
    ↓
Posts analysis as comment
```

### Key Components

1. **Descriptor** (`atlassian-connect.json`)
   - Defines app name, permissions, webhooks
   - Hosted at `/atlassian-connect.json`

2. **Lifecycle Endpoints**
   - `/jira-connect/installed` - App installation
   - `/jira-connect/uninstalled` - App removal
   - `/jira-connect/enabled` - App enabled
   - `/jira-connect/disabled` - App disabled

3. **Webhook Endpoint**
   - `/jira-connect/webhook` - Receives `comment_created` events

4. **Authentication**
   - Uses JWT (JSON Web Tokens) with shared secret
   - No OAuth needed
   - Each installation has unique clientKey + sharedSecret

## Database

### New Table: `jira_connect_installations`

Stores installation data:
- `client_key` - Unique identifier for Jira site
- `shared_secret` - For JWT verification
- `base_url` - Jira site URL
- `site_name` - Human-readable site name
- `enabled` - Installation status

### Migration

Run this migration in Supabase:

```sql
-- See: supabase/migrations/006_jira_connect_installations.sql
```

## Development & Testing

### Local Testing with ngrok

Atlassian Connect requires HTTPS. For local development:

1. Install ngrok: `npm install -g ngrok`
2. Start server: `npm start`
3. Start ngrok: `ngrok http 3000`
4. Update `atlassian-connect.json` baseUrl to ngrok URL
5. Install app in test Jira using ngrok descriptor URL

### Production Setup

1. Ensure `BASE_URL` environment variable is set to `https://www.firstqa.dev`
2. Descriptor is automatically served at `https://www.firstqa.dev/atlassian-connect.json`
3. Customers install via this URL

## Customer Support

### Installation Help

Provide customers with:
1. Link to this guide
2. Descriptor URL: `https://www.firstqa.dev/atlassian-connect.json`
3. Support email for any issues

### Common Issues

**"Enable development mode" not visible:**
- User needs Jira admin permissions
- Contact Jira administrator

**Installation fails:**
- Check descriptor URL is accessible
- Verify HTTPS is working
- Check Render logs for errors

**Webhooks not triggering:**
- Verify installation in Jira Apps
- Check webhook registration in logs
- Test with `/qa` comment

## Future: Atlassian Marketplace

When ready to scale:

1. Submit app to Atlassian Marketplace
2. Go through security review
3. Customers can install directly from Marketplace
4. No "development mode" needed

## Comparison: OAuth vs Connect

| Feature | OAuth (Old) | Connect (New) |
|---------|-------------|---------------|
| Installation | Per-user | Per-site |
| Webhooks | Manual setup | Automatic |
| Admin required | No | Yes (for install) |
| Works for team | ❌ No | ✅ Yes |
| Seamless | ❌ No | ✅ Yes |

---

**Questions?** Check Render logs or contact support.
