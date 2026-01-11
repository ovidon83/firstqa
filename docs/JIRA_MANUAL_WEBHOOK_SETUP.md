# Jira Manual Webhook Setup (Fallback)

If automatic webhook creation fails, you can manually create the webhook in Jira.

## Steps

### 1. Go to Jira Settings

1. Log in to your Jira site: https://stanwithme.atlassian.net
2. Click ⚙️ **Settings** (gear icon in top right)
3. Click **System** in the dropdown

### 2. Navigate to Webhooks

1. In the left sidebar, scroll down and click **WebHooks**
2. Click **Create a WebHook** button

### 3. Configure the Webhook

Fill in the following details:

| Field | Value |
|-------|-------|
| **Name** | `FirstQA Analysis Webhook` |
| **Status** | ✅ Enabled |
| **URL** | `https://www.firstqa.dev/jira/webhook` |
| **Description** | `Triggers FirstQA AI analysis when /qa is commented on tickets` |

### 4. Select Events

Under **Events**, select:
- ✅ **Issue** → **commented**

OR if you see different options:
- ✅ **Comment** → **created**

### 5. Optional: Add JQL Filter

If you only want the webhook to fire for specific projects:

```
project = YOURPROJECT
```

Otherwise, leave blank to trigger on all issues.

### 6. Save

1. Click **Create** button
2. ✅ Webhook is now active!

## Test the Webhook

1. Go to any Jira ticket
2. Add a comment: `/qa`
3. Wait 10-15 seconds
4. ✅ AI analysis should be posted as a comment!

## Webhook URL Format

Make sure the webhook URL is exactly:
```
https://www.firstqa.dev/jira/webhook
```

- **No trailing slash**
- **Use HTTPS** (not HTTP)
- **Exact path** `/jira/webhook`

## Troubleshooting

### Webhook Not Firing

1. Check that webhook is **Enabled** in Jira settings
2. Verify URL is correct: `https://www.firstqa.dev/jira/webhook`
3. Make sure the event selected is **Issue → commented** or **Comment → created**
4. Try disconnecting and reconnecting Jira in FirstQA dashboard

### Analysis Not Posting

1. Check that you have Jira connected in FirstQA dashboard
2. Verify you're using the correct Jira workspace (**stanwithme**)
3. Check FirstQA logs in Render for error messages

### 401 or 403 Errors

1. Make sure FirstQA has the correct Jira permissions
2. Disconnect and reconnect Jira to refresh tokens
3. Check that your Jira user has permission to add comments

## Need Help?

Email: support@firstqa.dev

---

*Last Updated: January 2026*
