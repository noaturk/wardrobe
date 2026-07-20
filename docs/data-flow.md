# Data flow

## Login

1. An unauthenticated navigation receives only the server-rendered login page.
2. The server compares the username in constant time and verifies the scrypt
   password hash.
3. A successful login regenerates the session identifier and issues a
   `HttpOnly`, `SameSite=Strict`, production-`Secure` cookie.
4. The frontend retrieves a per-session CSRF token; it is held in memory only.

## Import

1. The owner selects up to 20 PNG, JPEG, WebP, HEIC or HEIF photos at once.
   HEIC/HEIF images are converted privately to JPEG in the browser, and the
   visible upload queue handles every photo sequentially.
2. The browser sends each prepared photo to the authenticated backend.
3. The server checks size, byte signature and decoded pixel count.
4. Sharp decodes, rotates, converts colour space, removes metadata, and
   re-encodes a new PNG.
5. The backend sends only the required image to OpenAI Responses for detection.
6. The owner reviews detected crops. Approved cutout generation enters the
   one-job semaphore, checks the daily server
   limit, then calls the Images endpoint.
7. The owner reviews the clean cutout, fixes its name/category/colours if
   needed, and saves it to the wardrobe. No modeled image is generated during
   this step.
8. Generated cutouts stay in private server storage and are returned only
   through authenticated `no-store` API routes.

## Outfit planning and try-on

1. The browser groups approved items by category and derives up to eight outfit
   suggestions from category and colour compatibility. This is deterministic,
   runs in the browser and does not call OpenAI.
2. The owner selects and reviews one suggestion, or opens one garment directly.
3. Only the explicit **Create AI try-on** action spends one image request.
4. The backend loads the private reference photo and 1–5 selected wardrobe
   cutouts, sends them to the Images endpoint, validates the returned image and
   stores it under the private `outfits/` prefix.
5. MySQL stores the try-on metadata and storage key. The generated image is
   available only through an authenticated `no-store` route and can be deleted
   from Outfit Studio or the selected garment's **On you** section.
6. As an alternative, the owner can take or choose a real photograph of
   themselves wearing one garment. The browser uploads it directly to the
   authenticated `/api/outfits/photos` route; it is sanitized and stored under
   the same private prefix without any OpenAI request or usage charge.

The reference photograph is not required to organize the wardrobe. It is read
server-side only for a try-on and has no download route. See
[privacy](privacy.md).
