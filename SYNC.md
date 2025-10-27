# File Synchronization Logic

This document describes the file synchronization behavior between your local Obsidian vault and S3 storage in the obsidian-kisss3 plugin.

## Sync Process Overview

The plugin performs three-source synchronization by comparing file states between **Local** vault files, **Remote** S3 objects, and a **State** file, that tracks the last known synchronized state of each file. The state file contains the modification timestamps for the remote and the local files. For remote files, the S3 LastModified timestamp is used. For local files, the file's mtime is used. This allows to compare the modification timestamps of the remote and local files to determine if a file has been modified, created or deleted on both sides.

### Three-Source Algorithm

1. **Local Map**: Generated from all vault files (excluding files/folders starting with `.`)
2. **Remote Map**: Generated from all S3 objects (excluding files/folders starting with `.`)
3. **State Map**: Loaded from the sync state file containing previous sync state. The state file contains the modification timestamps for the remote and the local files. For remote files, the S3 LastModified timestamp is used. For local files, the file's mtime is used.

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
| Deleted           | Unchanged         | Delete remote        | File deleted locally, still exists remotely      |
| Unchanged         | Created           | Download             | New remote file                                  |
| Unchanged         | Modified          | Download             | Remote file was modified                         |
| Unchanged         | Deleted           | Delete local         | File deleted remotely, still exists locally      |
| Deleted           | Deleted           | Do Nothing           | Both sides deleted                               |
| Deleted           | Modified/Created  | Download             | Modification beats deletion                      |
| Modified/Created  | Deleted           | Upload               | Modification beats deletion                      |
| Created/Modified  | Created/Modified  | Conflict Resolution  | Both sides changed                               |
| Unchanged         | Unchanged         | Do Nothing           | No changes                                       |


-----


### Conflict Resolution Rules

1. **Modification vs. Deletion**: Modification wins (upload or download accordingly)
2. **Creation vs. Deletion**: Creation wins (upload or download accordingly)
3. **All other conflicts**: Newest file wins by modification time (upload or download)
4. **True conflict (both modified):** Both versions are preserved; remote is downloaded as a conflict file, local is uploaded as the primary version.


## Technical Implementation Details

- **State Storage**: Sync state is stored using Obsidian's Plugin Data API.
- **Exclusion rules**: Files/folders beginning with a dot (`.`) are ignored in all sync operations
- **Safe execution order**: Actions are executed in order: downloads → uploads → deletes to prevent data loss
- **Atomic state updates**: State is only updated after successful completion of all sync actions
- **Folder creation**: Missing folder structures are automatically created when downloading files
- **Folder pruning**: Empty folders are optionally pruned after sync completion
- **S3 prefixes**: Remote file paths respect the configured S3 prefix setting
- **Error handling**: Any sync error aborts the operation and prevents state updates


-----

# Deliberate Design Decisions

* Files are uploaded as application/octet-stream MIME type to S3. I tried to use npm mime-types package, but what needs nodejs "path" to work.
Installing path-browsify or other modules, would make it work in browser but add extra dependencies and complexity.
* I tried to implement a timestamp-based sync, but that makes it basically impossible to track remote deletions. The current solution is the
simples one, that works in both directions including deletions.
