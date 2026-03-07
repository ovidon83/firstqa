# Fix Linear 401 – Authentication required

When Linear analysis stops with **401 Authentication required, not authenticated**, the token stored for your Linear Connect installation is expired or revoked. Follow these steps to fix it.

---

## 1. Get a new Linear token

**Option A – Personal API key (recommended; long-lived)**

1. In Linear: open **Settings** (gear) → **API** → **Personal API keys**.
2. Click **Create key**, name it (e.g. `FirstQA`), copy the key (starts with `lin_api_`).
3. Use this key in step 2 below.

**Option B – OAuth (if you use Linear Connect OAuth)**

1. Re-authenticate your app (e.g. “Connect to Linear” in FirstQA or your OAuth flow).
2. Copy the new access token (starts with `lin_oa_`) and use it in step 2.

---

## 2. Update the installation in FirstQA

**Option A – Call the install endpoint**

If you have a way to call the Linear Connect install API (e.g. internal tool or curl):

```bash
curl -X POST https://<your-firstqa-host>/linear-connect/install \
  -H "Content-Type: application/json" \
  -d '{
    "apiKey": "<NEW_TOKEN>",
    "organizationId": "<LINEAR_ORG_ID>",
    "organizationName": "Stan",
    "teamId": "<optional-team-id>",
    "webhookSecret": "<existing-webhook-secret-if-any>"
  }'
```

- Replace `<NEW_TOKEN>` with the key from step 1.
- Replace `<LINEAR_ORG_ID>` with your Linear organization ID (UUID). You can find it in Linear URL or in the `linear_connect_installations` row in Supabase.
- If you don’t know `webhookSecret`, omit it; the backend will keep the existing one if present.

**Option B – Update directly in Supabase**

1. Open Supabase → **Table Editor** → `linear_connect_installations`.
2. Find the row for your org (e.g. `organization_name = 'Stan'`).
3. Edit the `api_key` column and set it to the **new** token (paste the full value).
4. Save.

---

## 3. Deploy the backend (if you pulled the auth-header fix)

If you use the latest FirstQA backend that sends OAuth tokens as `Bearer <token>`:

- Deploy that version so the fix is live.
- No change to the token is required for this; it only fixes how the token is sent.

---

## 4. Test

1. In Linear, add a **new comment** on an issue (e.g. “/qa” or any trigger text).
2. Check FirstQA logs: you should see the webhook, then a successful fetch of the comment and the analysis running (no 401).
3. Confirm the analysis comment appears on the Linear issue.

If you still see 401, the token is still invalid or not updated: repeat step 1 (new token) and step 2 (update installation).
