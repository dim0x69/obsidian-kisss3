# File Synchronization Logic

This document describes the file synchronization behavior between your local Obsidian vault and S3 storage in the obsidian-kisss3 plugin.

## Sync Process Overview

The plugin performs bidirectional synchronization by comparing file states between local and remote storage. Each sync operation compares modification timestamps and determines the appropriate action based on when files were last changed relative to the previous sync timestamp.

## Sync Situations and Actions

| Situation | Local File | Remote File | Local Modified Since Last Sync | Remote Modified Since Last Sync | Action Taken |
|-----------|------------|-------------|--------------------------------|--------------------------------|--------------|
| 1. Remote only | ❌ Not exists | ✅ Exists | N/A | N/A | **Download** remote file |
| 2. Local only | ✅ Exists | ❌ Not exists | N/A | N/A | **Upload** local file |
| 3. Local modified | ✅ Exists | ✅ Exists | ✅ Yes | ❌ No | **Upload** local file |
| 4. Remote modified | ✅ Exists | ✅ Exists | ❌ No | ✅ Yes | **Download** remote file |
| 5. Both modified (conflict) | ✅ Exists | ✅ Exists | ✅ Yes | ✅ Yes | **Keep both** - rename remote copy |
| 6. No changes | ✅ Exists | ✅ Exists | ❌ No | ❌ No | **Do nothing** |
| 7. Explicit delete | ❌ Deleted locally | ✅ Exists | N/A | N/A | **Delete** from remote |

## Detailed Situation Descriptions

### 1. File exists on remote, not locally
**Action: Download**

When a file exists in S3 but not in your local vault, the plugin downloads it to maintain synchronization. This typically happens when:
- A file was added to S3 from another device
- A file was deleted locally but still exists remotely from a previous sync

The plugin creates any necessary folder structure locally before downloading the file and preserves the remote modification timestamp.

### 2. File exists locally, not on remote
**Action: Upload**

When a file exists in your local vault but not in S3, the plugin uploads it. This occurs when:
- You create a new file locally
- A file was deleted from S3 but still exists locally

### 3. File was modified locally
**Action: Upload**

When a file exists both locally and remotely, but only the local version was modified since the last sync, the local version takes precedence and is uploaded to S3. The plugin determines this by comparing:
- Local file modification time > last sync timestamp
- Remote file modification time ≤ last sync timestamp

### 4. File was modified remotely
**Action: Download**

When a file exists both locally and remotely, but only the remote version was modified since the last sync, the remote version takes precedence and is downloaded to replace the local file. The plugin determines this by comparing:
- Local file modification time ≤ last sync timestamp  
- Remote file modification time > last sync timestamp

The local file is updated with the remote content and the remote modification timestamp is preserved.

### 5. File was modified both locally and remotely (conflict)
**Action: Keep both, rename older and append timestamp**

When both local and remote versions have been modified since the last sync, the plugin resolves the conflict by:

1. **Preserving both versions** to prevent data loss
2. **Downloading the remote version** to a new conflict file with naming pattern: `filename (conflict YYYYMMDD-HHMMSS).ext`
3. **Uploading the local version** to S3, overwriting the remote file
4. **Notifying the user** about the conflict resolution

This ensures your latest local changes remain as the "primary" version while preserving the remote changes for manual review.

**Example conflict file naming:**
- Original file: `Meeting Notes.md`
- Conflict file: `Meeting Notes (conflict 20241022-143055).md`
- Original file: `diagram.png`
- Conflict file: `diagram (conflict 20241022-143055).png`

### 6. File is identical locally and remotely
**Action: Do nothing**

When both files exist and neither has been modified since the last sync, no action is taken. This is determined when:
- Local file modification time ≤ last sync timestamp
- Remote file modification time ≤ last sync timestamp
- Files are considered synchronized

### 7. Explicit delete event (user triggers delete locally)
**Action: Propagate delete to remote**

> **Note:** This functionality is mentioned in the README.md as a planned feature ("Delete files" is listed in the Todo section) but is not currently implemented in the codebase. When implemented, locally deleted files would trigger removal from S3 during the next sync operation.

## File Filtering

The sync process includes:
- **All file types** (markdown, images, PDFs, attachments, etc.)
- **Files and folders that don't start with a dot** (hidden files/folders are ignored)

## Technical Implementation Details

- **Timestamp comparison**: The plugin uses millisecond precision timestamps for modification time comparisons
- **Last sync tracking**: A `lastSyncTimestamp` is stored in plugin settings and updated after each successful sync
- **Folder creation**: Missing folder structures are automatically created when downloading files
- **Content encoding**: Files are handled as UTF-8 encoded text
- **S3 prefixes**: Remote file paths respect the configured S3 prefix setting

## Sync Frequency

The plugin supports both manual and automatic synchronization:
- **Manual sync**: Triggered via the "Sync Now" command
- **Automatic sync**: Configurable interval-based syncing (when enabled in settings)

Only one sync operation can run at a time to prevent conflicts.