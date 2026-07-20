# Implementation plan

This plan turns the upstream local-first Vite application into a private,
single-user production application for `wardrobe.noaturk.from.hr`.

## Baseline

- Preserve the upstream React gallery, import/review flow, visual language, and
  MIT licence.
- Replace Vite's development middleware as the production runtime with an
  Express server that serves the built frontend and owns every API route.
- Keep all OpenAI credentials, reference photographs, wardrobe images, jobs,
  exports, and backups outside the frontend build and Git repository.

## Delivery sequence

1. Add strict environment validation, proxy/origin policy, security headers,
   production error handling, and `/health`.
2. Add single-user authentication backed by a server-side session store,
   Argon2id/scrypt password hashing, session rotation, CSRF and login throttling.
3. Put the application shell, APIs, imports, generated assets, reference image,
   exports, and destructive actions behind the authenticated session.
4. Harden image ingestion with byte-signature checks, limits, safe decoding,
   metadata removal, random server-side names, and cleanup on failure.
5. Add bounded OpenAI execution with host allow-listing, timeouts, limited
   retries, one-job concurrency by default, daily generation enforcement, and
   sanitized usage counters.
6. Introduce `StorageAdapter` implementations for private local and optional
   S3-compatible storage, plus MySQL migrations for durable metadata. This
   deployment selects a private Hostinger directory outside the deployed build;
   local JSON remains only the development metadata mode.
7. Add privacy/data controls, reference-image controls, export, backup/restore,
   cleanup, usage reporting, logout, accessible confirmations, and mobile UI.
8. Add automated tests for authentication boundaries, images, OpenAI controls,
   storage and secret leakage; run tests, build, checks, and dependency audit.
9. Document architecture, data flow, security, persistence, privacy, operations,
   Hostinger deployment, OpenAI setup, testing, backup and restore.

## Production invariants

- No request can retrieve a private page, API response, or image without a
  valid authenticated session.
- No browser bundle or response contains `OPENAI_API_KEY`.
- State-changing requests require same-origin validation and a CSRF token.
- Production refuses to boot without strong auth/session secrets and durable
  database/storage configuration.
- Private responses are `no-store`; image responses also use
  `X-Content-Type-Options: nosniff`.
- Deployments run `npm run build` and `npm run start`, never `vite preview`.

## Verification gates

- Unit/integration tests use a mock OpenAI endpoint and never consume credits.
- `npm test`, `npm run check`, and `npm run build` must pass.
- The built frontend is searched for configured secrets.
- A production-like smoke test checks login, logout, CSRF, unauthenticated API
  and image denial, secure headers, health, and static route protection.
- Persistent storage and rollback must still be validated in the owner's
  Hostinger account because those guarantees cannot be proven locally.
