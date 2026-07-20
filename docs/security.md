# Security

- Single configured owner; no registration, OAuth, demo account, or password
  reset route.
- scrypt password hash generated interactively by
  `npm run auth:hash-password`; cleartext passwords are never logged.
- Server-side sessions, login session rotation, 12-hour default TTL, strict
  cookie flags and complete logout destruction.
- Five failed login attempts per 15 minutes plus progressive delay and a generic
  error message.
- Authentication protects the SPA, build assets, all APIs, uploads, imports,
  images and export.
- Same-origin `Origin`/`Referer` checks and per-session CSRF tokens protect
  state-changing requests.
- Helmet CSP, `frame-ancestors 'none'`, no framing, no sniffing, no referrer,
  restrictive same-origin resources, body limits and production-safe errors.
- Image byte signatures, safe Sharp decode, pixel/byte limits, metadata removal,
  re-encoding and server-selected storage paths. HEIC/HEIF is converted to JPEG
  in an isolated browser worker before the same server validation runs.
- OpenAI key exists only in the backend environment. Production accepts only
  `https://api.openai.com`; calls have a timeout, bounded 429/5xx retry, default
  concurrency one and an optional manually configured daily image-generation
  limit (`0` disables only the application cap).
- Private responses use `Cache-Control: private, no-store`. The upstream service
  worker and its image cache were removed.
- No analytics, advertising, tracking or third-party error reporting.

Run `npm run security:audit` locally and review Hostinger's dependency
vulnerability page after deployment. Rotate `SESSION_SECRET` to invalidate all
sessions; rotate an exposed OpenAI key immediately. See [operations](operations.md).
