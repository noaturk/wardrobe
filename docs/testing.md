# Testing

Run:

```bash
npm test
npm run check
npm run build
npm run security:audit
npm run db:check
npm run storage:check
```

Automated tests cover password hashing, image signatures/re-encoding and private
storage traversal. Integration tests cover unauthenticated page/API denial,
generic bad-login behaviour, session regeneration, CSRF, logout, private image
denial, secure headers and health.

The outfit try-on API is covered by `test/outfits.test.mjs`, which mocks the
OpenAI image endpoint (a dummy key and an in-memory `fetch` returning a
generated PNG), a temporary private storage directory and a temporary data
directory. It asserts: a stored try-on never leaks its storage key; the gallery
`GET` routes are not blocked by the upload rate limiter; item-count validation
(1–5); a missing reference photo returns `409` without any OpenAI call; an
invalid CSRF token returns `403` (not `500`); deleting one try-on removes its
private image; and deleting the whole wardrobe also removes generated outfits
and their private images. It also verifies that a real wearing photo can be
attached to one garment without calling OpenAI or incrementing API usage. The suggestion algorithm lives in the JSX-free module
`src/outfit-suggestions.mjs` and is unit tested in
`test/outfit-suggestions.test.mjs`.

OpenAI tests must inject a mock endpoint and dummy key. Never run automated
tests against the real OpenAI API.

`db:check` reads schema metadata only. `storage:check` uses a random disposable
object and always attempts to delete it; neither command calls OpenAI.

Production-only manual checks:

1. HTTP→HTTPS and `Secure` cookie behind Hostinger's proxy.
2. Five-attempt login limit from the real client IP.
3. Every private image URL returns 401 without the cookie.
4. An import survives a redeploy/rollback with MySQL plus the private Hostinger
   image directory.
5. MySQL migration and restore work on a disposable copy.
6. Browser build contains no configured key or secret.
7. A daily-limit boundary blocks the next image call.
8. File Manager confirms images are outside both `nodejs` and `public_html`.
9. Select several photos in one picker action and confirm every detected item
   reaches its own review state before it enters the wardrobe.
   Repeat once with an iPhone HEIC photo and confirm its queue status changes
   from **Converting HEIC** to **Detecting items** without a CSP error.
10. Confirm opening and selecting outfit suggestions does not increment image
    usage; only **Try this outfit on me** increments it once.
11. Confirm an outfit try-on is unavailable without a reference photo and that
    its generated image returns 401 without the authenticated session cookie.
12. Capture a reference photo with **Take a photo of yourself** (camera) in
    Outfit Studio or Settings over HTTPS, confirm the try-on unlocks
    immediately, and that a blocked or absent camera falls back to photo upload.
13. Open one garment and verify both **Create AI try-on** and **Add my real
    photo** are visible. The second path must not increment image usage.

The remaining release gate is an end-to-end persistence test against the real
Hostinger filesystem after deployment. Automated tests deliberately do
not spend OpenAI credit or upload private photographs.
