# File Synchronization Logic

This document describes the file synchronization behavior between your local Obsidian vault and S3 storage in the obsidian-kisss3 plugin.

## Sync Process Overview

The plugin performs three-source synchronization by comparing file states between **Local** vault files, **Remote** S3 objects, and a **State** file (`.obsidian/plugins/kisss3/sync-state.json`) that tracks the last known synchronized state of each file. This approach provides more robust conflict detection and resolution compared to simple timestamp-based sync.

### Three-Source Algorithm

1. **Local Map**: Generated from all vault files (excluding files/folders starting with `.`)
2. **Remote Map**: Generated from all S3 objects (excluding files/folders starting with `.`) 
3. **State Map**: Loaded from the sync state file containing previous sync state

For each unique file path across all three sources, the algorithm:
- Categorizes each file as **Created**, **Modified**, **Deleted**, or **Unchanged** compared to the state
- Applies a decision matrix to determine the appropriate action
- Executes actions in safe order: downloads → uploads → deletes
- Updates the state file only after successful completion

## Sync Decision Matrix

The three-source algorithm categorizes each file's status (Created/Modified/Deleted/Unchanged) by comparing current Local and Remote states against the previous State, then applies this decision matrix:

| Local Status | Remote Status | Action Taken | Description |
|-------------|---------------|--------------|-------------|
| **Created** | **Unchanged** | **Upload** | New local file |
| **Modified** | **Unchanged** | **Upload** | Local file was modified |
| **Unchanged** | **Created** | **Download** | New remote file |
| **Unchanged** | **Modified** | **Download** | Remote file was modified |
| **Created/Modified** | **Created/Modified** | **Conflict Resolution** | Both sides changed |
| **Deleted** | **Modified/Created** | **Download** | Modification beats deletion |
| **Modified/Created** | **Deleted** | **Upload** | Modification beats deletion |
| **Deleted** | **Deleted** | **Do Nothing** | Both sides deleted |
| **Unchanged** | **Unchanged** | **Do Nothing** | No changes |

### Conflict Resolution Rules

1. **Modification vs. Deletion**: Modification wins (upload or download accordingly)
2. **Creation vs. Deletion**: Creation wins (upload or download accordingly)  
3. **All other conflicts**: Newest file wins by modification time (upload or download)

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

- **State File**: Sync state is stored in `.obsidian/plugins/kisss3/sync-state.json` as a JSON map of `{ "file/path": "mtime_timestamp" }`
- **Timestamp precision**: Uses millisecond precision Unix timestamps for modification time comparisons
- **Exclusion rules**: Files/folders beginning with a dot (`.`) are ignored in all sync operations
- **Safe execution order**: Actions are executed in order: downloads → uploads → deletes to prevent data loss
- **Atomic state updates**: State file is only updated after successful completion of all sync actions
- **Folder creation**: Missing folder structures are automatically created when downloading files
- **Folder pruning**: Empty folders are optionally pruned after sync completion
- **S3 prefixes**: Remote file paths respect the configured S3 prefix setting
- **Error handling**: Any sync error aborts the operation and prevents state file updates

## Sync Frequency

The plugin supports multiple synchronization modes:
- **Startup sync**: Automatically triggered when the plugin loads (if properly configured)
- **Manual sync**: Triggered via the "Sync Now" command
- **Automatic sync**: Configurable interval-based syncing (when enabled in settings)

Only one sync operation can run at a time to prevent conflicts.