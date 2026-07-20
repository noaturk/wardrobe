# Backup and restore

Create a local application-data archive:

```bash
npm run backup
```

The command copies `WARDROBE_DATA_DIR` and, when it is outside that directory,
the complete local `LOCAL_STORAGE_DIR`. It excludes temporary/session/environment
files, adds a manifest, and creates a timestamped `.tar.gz` under
`WARDROBE_BACKUP_DIR`. Backups are Git-ignored.

Restore requires an interactive destructive confirmation:

```bash
npm run restore -- /absolute/path/wardrobe-YYYY-MM-DD....tar.gz
```

The command validates the manifest, requires typing `RESTORE`, replaces the
current application-data directory, and cleans its temporary extraction.

## Production policy

- Take daily MySQL backups through Hostinger and daily archives of the private
  image directory.
- Keep 7 daily, 4 weekly and 6 monthly copies unless storage/cost requires a
  stricter policy.
- Encrypt any archive that leaves Hostinger (for example with age or an
  encrypted backup provider) before transfer.
- Never include `.env`, OpenAI keys, database passwords, session secrets or live
  sessions.
- Quarterly, restore into an isolated non-production environment and verify
  item counts, asset hashes, authentication boundaries and deletion behaviour.

The included archive command covers local application files and the private
Hostinger image directory. MySQL must be backed up separately through
Hostinger. See [storage](storage.md).
