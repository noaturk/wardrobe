# Operations

## Routine

- Check `/health`, Hostinger runtime/resource logs and vulnerability monitoring.
- Check the app usage estimate and the authoritative OpenAI Usage/Billing page.
- Review failed/stale import jobs without logging images, base64, keys or full
  prompts.
- Run/test daily backups and the retention policy.
- Apply lockfile-reviewed dependency updates and rerun all checks.

## Incidents

- **Suspected OpenAI key exposure:** revoke the key, create a project-scoped
  replacement, update hPanel, redeploy, and review Usage.
- **Session concern:** rotate `SESSION_SECRET`; every session becomes invalid.
- **Password concern:** generate a new hash locally, update
  `ADMIN_PASSWORD_HASH`, and rotate the session secret.
- **Lost images after deployment:** stop imports, preserve logs/database, restore
  the last verified backup, and move assets to durable private storage.
- **Daily limit reached:** verify Usage before increasing
  `DAILY_IMAGE_GENERATION_LIMIT`. Set a positive integer for a manual daily cap,
  or `0` for no application-level cap. OpenAI account limits and billing still
  apply, so investigate unexplained usage before changing it.

## Transient OpenAI image errors

An HTTP `520` without an OpenAI request ID is treated as a transient gateway
failure. Image edits use streaming to keep long requests observable and retry
up to three times with a newly constructed multipart body. Each attempt logs
its HTTP status, total duration, OpenAI request ID when present, Cloudflare ray
identifier when present, outcome and short error message. Usage counts one
logical request as requested/succeeded/failed rather than counting transport
retries as new image generations.

TOTP is optional. Leave `ADMIN_TOTP_SECRET` empty for password-only login. To
enable it later, create a strong base32 secret in an authenticator application,
store it only in Hostinger's environment, redeploy, and verify access in a
second browser before closing the first session. Removing the variable disables
TOTP. Treat the base32 secret like a password and include it in neither Git nor
application backups.
