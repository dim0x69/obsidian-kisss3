# Keep it simple, stupid! S3 Plugin for Obsidian

Todo:
- [ ] Delete files

A simple, single-purpose plugin to keep your Obsidian vault in sync with an Amazon S3 bucket. It does one thing: bidirectional sync between your local vault and S3, with minimal configuration and no unnecessary complexity.

- **Sync both ways:** Upload new or changed notes to S3, download new or updated notes from S3, and delete files that were removed on either side.
- **Conflict handling:** If a note was changed both locally and remotely since the last sync, the plugin saves both versions so nothing is lost.
- **No bloat:** Only syncs markdown files, ignores hidden files/folders, and keeps your workflow simple.
- **KISS principle:** No extra features, no cloud lock-in, no surprises—just reliable S3 sync for your notes.

Perfect for users who want a straightforward way to back up or share their vault using S3, without the overhead of complex sync solutions.
