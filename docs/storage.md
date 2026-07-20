# Private image storage

This deployment keeps every photo on the owner's Hostinger account. MySQL
stores metadata and private storage keys, not image BLOBs.

`server/storage.mjs` still provides two implementations:

```text
StorageAdapter
├── LocalPrivateStorage          ← selected for this deployment
└── S3CompatiblePrivateStorage  ← available but not configured
```

Production job files use `jobs/<uuid>/...`, approved wardrobe assets use
`wardrobe/...`, saved AI try-ons and owner wearing photos use
`outfits/<uuid>.png`, and the private
reference photo uses `settings/model-reference.png`. The local adapter rejects traversal keys and
creates files with private permissions. Every image is returned through a
session-protected `no-store` API route; there is no public image directory or
direct URL.

## Hostinger location

Hostinger documents that server-side Node build files are placed under:

```text
/home/<account>/domains/<domain>/nodejs
```

The image directory must be a sibling of that deployed build, not a child of
it. Use this Hostinger environment configuration:

```env
STORAGE_DRIVER=local
LOCAL_STORAGE_DIR=../wardrobe-private
ALLOW_LOCAL_PRODUCTION_STORAGE=true

S3_ENDPOINT=
S3_REGION=
S3_BUCKET=
S3_ACCESS_KEY_ID=
S3_SECRET_ACCESS_KEY=
S3_FORCE_PATH_STYLE=false

WARDROBE_BACKUP_DIR=../wardrobe-backups
```

When the application working directory is `.../nodejs`, the resolved private
path becomes `.../wardrobe-private`, outside the GitHub-deployed build and
outside `public_html`. Production validation refuses a local path inside the
application directory.

Run this after deployment, from Hostinger's application terminal if available:

```bash
npm run storage:check
```

The check writes 32 random bytes, verifies HEAD/read and deletes the file in
`finally`. It does not upload a photograph and does not call or charge OpenAI.

## Required redeploy test

Hostinger explains where Node build files live and how GitHub redeploy works,
but does not explicitly guarantee application-written file durability. Before
using real photos:

1. Upload a disposable reference/test image.
2. Confirm it appears under the private sibling directory in File Manager.
3. Redeploy the same GitHub branch.
4. Log in and confirm the reference and image still work.
5. Repeat once more, then test `npm run backup`.

If Hostinger removes or blocks that sibling directory, stop before importing
real photos and contact Hostinger support for the plan's persistent private
filesystem path. Do not move images into `public_html`.

Official Hostinger references:

- [Node.js deployment and server file layout](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [GitHub redeployment behavior](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/)
