# Architecture

```text
Browser ── HTTPS / signed HttpOnly session / CSRF ── Hostinger proxy
                                                        │
                                                 Express (Node 22)
                                           ┌────────────┼─────────────┐
                                      React dist    private APIs   /health
                                                        │
                                      ┌─────────────────┼──────────────┐
                                  OpenAI API       MySQL metadata   private images
                                  (server only)    + sessions       Hostinger disk
```

`server/index.mjs` is the production entry point. It reads `process.env.PORT`,
trusts the configured proxy only in production, applies security headers, and
serves the Vite build only after authentication. Vite remains a build tool and
development middleware; it is not the production server.

The current upstream import engine remains in `scripts/import-job-api.mjs`, but
is initialized by Express. All `/api/import/*` routes and images therefore pass
through authentication, same-origin and CSRF controls. See [data flow](data-flow.md)
and [security](security.md).

## Persistence boundary

`StorageAdapter`, `LocalPrivateStorage`, and `S3CompatiblePrivateStorage` live in
`server/storage.mjs`. The S3 adapter never creates public URLs. MySQL migrations
define durable metadata tables and the production session table.

In production, the adapted import engine stores job state and wardrobe metadata
through `MySqlWardrobeRepository`; usage counters and sessions also use MySQL.
Originals, crops, generated cutouts, modeled images and the private reference
photo use `LocalPrivateStorage` in a private Hostinger directory outside the
deployed build. Local JSON remains only the development metadata fallback.
Production startup requires an explicit external `LOCAL_STORAGE_DIR` and
`ALLOW_LOCAL_PRODUCTION_STORAGE=true`. See [storage](storage.md).
