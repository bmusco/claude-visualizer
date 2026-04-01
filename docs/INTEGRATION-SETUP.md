# Claud-io Integration Setup

## What's needed

Claud-io uses the same OAuth clients as cmt-assistant. Only redirect URIs need to be added — no new apps or credentials.

### Google Workspace (GCP)

**Who:** GCP project admin for project `577801486902`
**Action:** Add redirect URI to existing OAuth client

1. Go to https://console.cloud.google.com/apis/credentials?project=577801486902
2. Click the OAuth 2.0 Client ID (the one cmt-assistant uses)
3. Under **Authorized redirect URIs**, add:
   ```
   https://claudio-api.int-tools.cmtelematics.com/api/auth/callback
   ```
4. Save

### Slack

**Who:** Slack app admin for app `2448386507.1064...`
**Action:** Add redirect URI to existing Slack app

1. Go to https://api.slack.com/apps
2. Select the CMT Assistant app
3. Go to **OAuth & Permissions**
4. Under **Redirect URLs**, add:
   ```
   https://claudio-api.int-tools.cmtelematics.com/api/auth/callback
   ```
5. Save

### Atlassian

**Who:** Any user (self-service)
**Action:** Generate API token and enter in Claud-io settings

1. Go to https://id.atlassian.com/manage-profile/security/api-tokens
2. Create API Token
3. In Claud-io Settings → Atlassian, enter your email and token

No ticket needed for Atlassian.

---

## Slack message to send

> Hey! I'm deploying **Claud-io** (Claude Visualizer) as a new internal tool. It uses the same Google and Slack OAuth clients as cmt-assistant. Could you add one redirect URI to each?
>
> **Google (GCP project 577801486902):**
> Add `https://claudio-api.int-tools.cmtelematics.com/api/auth/callback` to the OAuth client's authorized redirect URIs
>
> **Slack (CMT Assistant app):**
> Add `https://claudio-api.int-tools.cmtelematics.com/api/auth/callback` to OAuth & Permissions → Redirect URLs
>
> That's it — no new scopes, no new apps. Just two redirect URIs. Everything else is already deployed. Thanks!
