# File Synchronization Logic

This document describes the file synchronization behavior between your local Obsidian vault and S3 storage in the obsidian-kisss3 plugin.

## Sync Process Overview

The plugin performs three-source synchronization by comparing file states between **Local** vault files, **Remote** S3 objects, and a **State** file, that tracks the last known synchronized state of each file. This approach provides more robust conflict detection and resolution compared to simple timestamp-based sync.

### Three-Source Algorithm

1. **Local Map**: Generated from all vault files (excluding files/folders starting with `.`)
2. **Remote Map**: Generated from all S3 objects (excluding files/folders starting with `.`)
3. **State Map**: Loaded from the sync state file containing previous sync state. The state file contains the modification timestamps for the remote and the local files.

For each unique file path across all three sources, the algorithm:
- Categorizes each file as **Created**, **Modified**, **Deleted**, or **Unchanged** compared to the state
- Applies a decision matrix to determine the appropriate action
- Executes actions in safe order: downloads → uploads → deletes
- Updates the state file only after successful completion

## Sync Decision Matrix

The three-source algorithm categorizes each file's status (Created/Modified/Deleted/Unchanged) by comparing current Local and Remote states against the previous State, then applies this decision matrix:

| Local Status      | Remote Status      | Action Taken         | Description                                      |
|-------------------|-------------------|----------------------|--------------------------------------------------|
| Created           | Unchanged         | Upload               | New local file                                   |
| Modified          | Unchanged         | Upload               | Local file was modified                          |
| Unchanged         | Created           | Download             | New remote file                                  |
| Unchanged         | Modified          | Download             | Remote file was modified                         |
| Created/Modified  | Created/Modified  | Conflict Resolution  | Both sides changed                               |
| Deleted           | Modified/Created  | Download             | Modification beats deletion                      |
| Modified/Created  | Deleted           | Upload               | Modification beats deletion                      |
| Deleted           | Deleted           | Do Nothing           | Both sides deleted                               |
| Unchanged         | Unchanged         | Do Nothing           | No changes                                       |
| Unchanged         | Deleted           | Delete local         | File deleted remotely, still exists locally      |
| Deleted           | Unchanged         | Delete remote        | File deleted locally, still exists remotely      |

### Conflict Resolution Rules

1. **Modification vs. Deletion**: Modification wins (upload or download accordingly)
2. **Creation vs. Deletion**: Creation wins (upload or download accordingly)
3. **All other conflicts**: Newest file wins by modification time (upload or download)
4. **True conflict (both modified):** Both versions are preserved; remote is downloaded as a conflict file, local is uploaded as the primary version.

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

### 7. File deleted remotely, still exists locally
**Action: Delete local**

When a file was deleted on S3 but still exists in your vault, the plugin deletes the local file to match the remote state.

### 8. File deleted locally, still exists remotely
**Action: Delete remote**

When a file was deleted in your vault but still exists on S3, the plugin deletes the remote file to match the local state.

### 9. File deleted both locally and remotely
**Action: Do nothing**

When a file was deleted in both locations, no action is taken.

### 10. Explicit delete event (user triggers delete locally)
**Action: Propagate delete to remote**

> **Note:** This functionality is mentioned in the README.md as a planned feature ("Delete files" is listed in the Todo section) but is not currently implemented in the codebase. When implemented, locally deleted files would trigger removal from S3 during the next sync operation.

## File Filtering

The sync process includes:
- **All file types** (markdown, images, PDFs, attachments, etc.)
- **Files and folders that don't start with a dot** (hidden files/folders are ignored)

## Technical Implementation Details

- **State Storage**: Sync state is stored using Obsidian's Plugin Data API, ensuring it's always hidden from users and robustly managed
- **Exclusion rules**: Files/folders beginning with a dot (`.`) are ignored in all sync operations
- **Safe execution order**: Actions are executed in order: downloads → uploads → deletes to prevent data loss
- **Atomic state updates**: State is only updated after successful completion of all sync actions
- **Folder creation**: Missing folder structures are automatically created when downloading files
- **Folder pruning**: Empty folders are optionally pruned after sync completion
- **S3 prefixes**: Remote file paths respect the configured S3 prefix setting
- **Error handling**: Any sync error aborts the operation and prevents state updates

## Initial Sync Scenarios

The three-source algorithm handles initial synchronization scenarios gracefully when no previous sync state exists:

### Empty Vault + Existing Remote Storage

When syncing a **new empty vault** with an **existing S3 bucket containing files** for the first time:

1. **Local Map**: Empty (no vault files)
2. **Remote Map**: Contains existing S3 files
3. **State Map**: Empty (no previous sync state)

**Behavior:**
- For each remote file: `Local: UNCHANGED, Remote: CREATED` → **Action: DOWNLOAD**
- All existing remote files are downloaded to the local vault
- Folder structures are created automatically as needed
- After successful sync, state file is created with all downloaded files

**Result:** The vault becomes a complete copy of the remote storage.

### Existing Vault + Empty Remote Storage

When syncing an **existing vault with files** to a **new empty S3 bucket** for the first time:

1. **Local Map**: Contains existing vault files
2. **Remote Map**: Empty (no S3 files)
3. **State Map**: Empty (no previous sync state)

**Behavior:**
- For each local file: `Local: CREATED, Remote: UNCHANGED` → **Action: UPLOAD**
- All existing local files are uploaded to S3
- S3 folder structures are created automatically (no explicit folder objects needed)
- After successful sync, state file is created with all uploaded files

**Result:** The remote storage becomes a complete copy of the vault.

### Both Empty (New Setup)

When both vault and remote storage are empty:
- No files to sync in either direction
- Empty state file is created
- Ready for future synchronization as files are added

These scenarios demonstrate the algorithm's ability to handle initial synchronization robustly without data loss or conflicts.

## Sync Frequency

The plugin supports multiple synchronization modes:
- **Startup sync**: Automatically triggered when the plugin loads (if properly configured)
- **Manual sync**: Triggered via the "Sync Now" command
- **Automatic sync**: Configurable interval-based syncing (when enabled in settings)

Only one sync operation can run at a time to prevent conflicts.
