# Deploy to Hostinger

## GitHub and application

1. Create a **private** GitHub repository and push this branch after reviewing
   `git diff` and ensuring `.env`/`data`/photos are absent.
2. In hPanel choose **Websites → Add Website → Deploy Web App → Import Git
   Repository**, authorize the private repository, and select the deployment
   branch.
3. Select Express/Other server-side app and Node.js `22.x`.
4. Build command: `npm ci && npm run build`.
5. Start command: `npm run start` (entry file `server.cjs` if requested).
   Output directory is `dist`, but this is not a static-only deployment.
6. Create a Hostinger MySQL database and configure either `DATABASE_URL` or the
   `DB_*` variables. Apply `migrations/001_initial.sql` through phpMyAdmin if
   hPanel cannot run `npm run db:migrate` as a release command. Confirm it with
   the read-only `npm run db:check` command.
7. Add every required variable from `.env.example` in hPanel. Existing admin
   email/username and password values on `noaturk.from.hr` are configuration
   inputs only; never copy the clear password into this repository.
8. Generate `ADMIN_PASSWORD_HASH` locally with
   `npm run auth:hash-password`. Generate `SESSION_SECRET` with a password
   manager or a cryptographically secure 32+ byte generator. If hPanel alters
   dollar signs in the hash, replace every `$` separator with `.` before saving
   it; the application normalizes this Hostinger-safe representation at startup.
9. Configure `STORAGE_DRIVER=local`, `LOCAL_STORAGE_DIR=../wardrobe-private`,
   `ALLOW_LOCAL_PRODUCTION_STORAGE=true` and
   `WARDROBE_BACKUP_DIR=../wardrobe-backups` as described in
   [storage](storage.md). Leave every `S3_*` secret empty.
10. Upload the private reference photo after login through Settings; do not add
    it to GitHub.

## Domain and HTTPS

1. Deploy the Node app as an independent website, then choose **Connect domain**
   and enter `wardrobe.noaturk.from.hr`.
2. If DNS uses Hostinger nameservers, follow hPanel's automatic record setup. If
   DNS is external, create the exact record hPanel requests.
3. Wait for propagation. Hostinger documents that SSL is installed
   automatically after the custom domain connects.
4. Confirm `https://wardrobe.noaturk.from.hr/health` returns only
   `{"status":"ok"}` and HTTP redirects to HTTPS.

## Persistence gate

The application stores wardrobe/job metadata in MySQL and all private image
bytes in a local Hostinger directory outside the deployed `nodejs` build. The
production validator rejects a path inside the application directory. Because
Hostinger does not explicitly document a durability guarantee for app-written
files, complete the two-redeploy test in [storage](storage.md) before importing
real photographs.

## Rollback and secrets

- Record the last known-good Git commit and database migration before deploy.
- Roll back by redeploying that commit/branch. Database migrations are forward
  only; restore a tested database backup if a schema rollback is necessary.
- Rotating `SESSION_SECRET` logs out every session. Revoke/replace the OpenAI key
  in the OpenAI project and update hPanel. Environment changes require redeploy
  or restart.
- Test backups and restore before first real import.

Official Hostinger references:

- [Deploy a Node.js web app](https://www.hostinger.com/support/how-to-deploy-a-nodejs-website-in-hostinger/)
- [Environment variables](https://www.hostinger.com/support/how-to-add-environment-variables-during-node-js-application-deployment/)
- [Connect MySQL](https://www.hostinger.com/support/connecting-a-hostinger-mysql-database-to-a-node-js-application/)
- [Connect a custom domain and SSL](https://www.hostinger.com/support/how-to-connect-a-custom-domain-to-a-node-js-application/)
- [Redeploy a Node.js application](https://www.hostinger.com/support/how-to-redeploy-a-node-js-application/)
