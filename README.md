[![Test & TypeScript Check](https://github.com/dim0x69/obsidian-kisss3/actions/workflows/github_workflows_test-and-tscheck.yml/badge.svg)](https://github.com/dim0x69/obsidian-kisss3/actions/workflows/github_workflows_test-and-tscheck.yml)
[![Release Obsidian plugin](https://github.com/dim0x69/obsidian-kisss3/actions/workflows/release.yml/badge.svg)](https://github.com/dim0x69/obsidian-kisss3/actions/workflows/release.yml)

# Keep it simple, stupid! Sync your Obsidian vault from and to S3.

A simple, single-backend sync plugin to keep your Obsidian vault in sync with an Amazon S3 bucket (or Cloudflare R2). Minimal configuration and no unnecessary complexity.

ToDo / Hints
* CORS: See before using: https://github.com/dim0x69/obsidian-kisss3/issues/10
* Currently only tested with Cloudflare R2

> [!CAUTION]
> **This plugins comes with absolutely no warranty. Back up your vault before using this plugin. A sync on S3 is not a backup!**

More on the [sync algorithm](SYNC.md)
## Purpose

- This plugin is designed for users who want a straightforward way to back up or share their Obsidian vault using Amazon S3. It follows the KISS (Keep It Simple, Stupid) principle—no extra features, no cloud lock-in, no surprises—just reliable S3 sync for your notes.
- The motivation to create this plugin was driven by a not very good feeling about other sync plugins, especially regarding complexity and the following expense to check their source code.

## Features

- **Bidirectional sync:** Upload new or changed notes to S3, download new or updated notes from S3, and delete files that were removed on either side.
- **Conflict handling:** If a note was changed both locally and remotely since the last sync, the plugin saves both versions so nothing is lost.
- **Minimal configuration:** Easy setup with only the essential options required.
- **No bloat:** The code base is simple and small, making it easy for anyone to review.

## How to Use

1. **Install the Plugin**
   Download or clone this repository into your Obsidian plugins folder, or install via Obsidian's community plugins if available.

2. **Configure S3 Access**
   In the plugin settings, enter your Amazon S3 credentials and specify the bucket you want to use for sync.
   - **Access Key ID**
   - **Secret Access Key**
   - **Bucket Name**
   - (Optional) Region

3. **Sync Your Vault**
   Use the plugin's commands or buttons to start syncing. The plugin will:
   - Upload changed or new notes to S3.
   - Download new or updated notes from S3.
   - Remove files deleted on either side.
   - Handle conflicts by saving both versions.

4. **Review Conflicts**
   If any conflicts are detected, check your vault for duplicated files and review the changes.
