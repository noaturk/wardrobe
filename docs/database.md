# Database

Hostinger Business/Cloud managed hosting supports MySQL. Create a dedicated
database and preferably use separate environment variables:

```env
DB_HOST=HOST_FROM_HPINGER
DB_PORT=3306
DB_NAME=FULL_DATABASE_NAME
DB_USER=FULL_DATABASE_USERNAME
DB_PASSWORD=DATABASE_PASSWORD
DB_CONNECTION_LIMIT=5
```

Alternatively set a URL in this form:

```text
mysql://USER:PASSWORD@HOST:3306/DATABASE
```

Do not put the real value in Git. Run:

```bash
npm run db:migrate
npm run db:check
```

`migrations/001_initial.sql` creates:

- `wardrobe_items`
- `wardrobe_assets`
- `import_jobs`
- `generation_jobs`
- `api_usage_daily`
- `app_settings`
- `sessions`

`migrations/002_usage_outcomes.sql` separates logical OpenAI requests into
requested, succeeded and failed counters for analysis and image operations.
Deploy the migration before restarting a production server that contains this
version of the application.

Indexes cover categories, job status/update cleanup queries, asset ownership and
session expiry. Images are not stored as MySQL BLOBs. `npm run db:check` is
read-only: it confirms connectivity and all seven required application tables
without inserting or deleting data. It also verifies that the usage outcome
columns from migration 002 are present.

In production, MySQL holds sessions, usage counters, import-job state, wardrobe
metadata and private storage keys. `MySqlWardrobeRepository` wraps item/job
writes in parameterized queries, and item plus asset metadata updates use a
transaction. Local JSON remains only the development fallback. See
[architecture](architecture.md) and [storage](storage.md).
