# Tickets to File for Claud-io Integrations

Based on the same process cmt-assistant used (see Censio/cmt-personal-assistant #122, #256, #319).

---

## Ticket 1: INFSUP — Slack App Creation for Claud-io

**Submit at:** https://cmtelematics.atlassian.net/servicedesk/customer/portal/2028

**Summary:** Create Slack app for Claud-io internal tool (read-only user scopes)

**Description:**

> Requesting IT to create a Slack app for **Claud-io** (Claude Visualizer), a new internal tool deployed at `claudio.int-tools.cmtelematics.com`.
>
> This follows the same pattern as the Slack app created for **cmt-assistant** (ref: Censio/cmt-personal-assistant #319).
>
> **App configuration needed:**
>
> - **App Name:** Claud-io
> - **Workspace:** CMT (grid-cmtelematics)
> - **OAuth Redirect URL:** `https://claudio-api.int-tools.cmtelematics.com/api/auth/callback`
>
> **User Token Scopes (read-only, same as cmt-assistant):**
> - `search:read` — search messages
> - `channels:read`, `channels:history` — read public channels
> - `groups:read`, `groups:history` — read private channels
> - `im:read`, `im:history` — read DMs
> - `mpim:read`, `mpim:history` — read group DMs
> - `users:read`, `users:read.email`, `users.profile:read` — user info
> - `usergroups:read` — user groups
> - `pins:read`, `bookmarks:read`, `reactions:read`, `reminders:read`, `stars:read` — content
> - `team:read` — workspace info
>
> **After creation, please provide:**
> 1. Client ID
> 2. Client Secret
>
> These will be stored in AWS Secrets Manager (`int-tools/claudio/oauth_credentials`).

---

## Ticket 2: INFSUP — Add Google OAuth Redirect URI for Claud-io

**Submit at:** https://cmtelematics.atlassian.net/servicedesk/customer/portal/2028

**Summary:** Add Google OAuth redirect URI for Claud-io internal tool

**Description:**

> Requesting that the following redirect URI be added to the existing Google OAuth client used by cmt-assistant.
>
> **GCP Project:** `577801486902`
> **OAuth Client ID:** `577801486902-kmoofld8hrkutb7jsv5nj5kje7q7kh69.apps.googleusercontent.com`
>
> **Redirect URI to add:**
> ```
> https://claudio-api.int-tools.cmtelematics.com/api/auth/callback
> ```
>
> **Steps:**
> 1. Go to https://console.cloud.google.com/apis/credentials?project=577801486902
> 2. Click the OAuth 2.0 Client ID
> 3. Under "Authorized redirect URIs", click "+ ADD URI"
> 4. Enter: `https://claudio-api.int-tools.cmtelematics.com/api/auth/callback`
> 5. Save
>
> No new scopes or permissions needed — Claud-io uses the same Google Workspace scopes as cmt-assistant (Gmail readonly, Calendar readonly, Drive, Docs, Sheets, Slides, Tasks).
>
> Reference: Same OAuth client setup as cmt-assistant (Censio/cmt-personal-assistant).

---

## No Ticket Needed: Atlassian

Atlassian uses API tokens (self-service). Each user:
1. Goes to https://id.atlassian.com/manage-profile/security/api-tokens
2. Creates a token
3. Enters email + token in Claud-io Settings → Atlassian

No IT involvement required.
