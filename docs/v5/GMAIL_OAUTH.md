# MAJIN V5: Gmail OAuth (read-only, opt-in)
This is a **standalone connector** and does not yet automatically click verification links, read email bodies, or continue job applications. It does not inherit the ChatGPT Gmail connection.

1. In Google Cloud Console, enable the Gmail API and configure an OAuth consent screen; create an **OAuth Desktop app** client and download its JSON to a private local location. If the app is in Testing mode, add your Google account as a test user. Do not commit the JSON to GitHub.
2. In PowerShell:
```powershell
$env:MAJIN_GMAIL_CLIENT_JSON = "$env:USERPROFILE\Downloads\client_secret.json" # adjust to actual downloaded filename
node scripts/v5/gmail-oauth.mjs login
node scripts/v5/gmail-oauth.mjs status
node scripts/v5/gmail-oauth.mjs list
```
3. Sign into Google in your browser and approve **read-only Gmail** access. Login uses OAuth authorization code + PKCE, a temporary loopback server on 127.0.0.1, and saves tokens under %LOCALAPPDATA%\\MAJIN\\v5\\gmail\\oauth-token.json. Do not share this token file, or pass it to an LLM.
4. Use `logout` to delete the local token file, and revoke Google access in your Google Account if you no longer need it.

The list command fetches only metadata (sender, subject and date) of up to 20 recent possible verification messages. It **does not** print codes, links, message bodies, or Gmail tokens. No Gmail data is pushed to GitHub. The connector is designed to enable future explicit per-application verification workflows, but those workflows require additional integration and tests.

Security notes: repository is public. Never place credentials, application letters, CV contents, verification codes, or mailbox data into GitHub debugging reports. Use a private local secrets location. OAuth token storage uses filesystem user permissions; Windows DPAPI/credential vault hardening is still recommended. Google may impose OAuth test-mode token expiration or verification requirements.
