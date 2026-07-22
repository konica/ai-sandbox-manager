# Installing AI Sandbox Manager

Download the installer for your OS from the
[latest release](https://github.com/mgm-tp/ai-sandbox-manager/releases/latest).

## Prerequisites

AI Sandbox Manager drives Docker Sandboxes; it does **not** bundle them. Before
first launch, install:

- **Docker Desktop** — https://www.docker.com/products/docker-desktop/
- **The `sbx` CLI** — https://docs.docker.com/ai/sandboxes/

The app's first-run screen checks for both and links you here if either is
missing.

## macOS

1. Download the `.dmg` for your chip (Apple Silicon = arm64, Intel = x64).
2. Open it and drag **AI Sandbox Manager** to Applications.
3. The build is not yet notarized, so the first launch is blocked. **Right-click
   the app → Open → Open**, or run:
   ```bash
   xattr -cr "/Applications/AI Sandbox Manager.app"
   ```

## Windows

1. Download and run the `.exe` (NSIS) installer.
2. SmartScreen may warn because the build is unsigned: click **More info → Run
   anyway**.
3. Follow the installer; the app installs per-user (no admin prompt).

## Linux

1. Download the `.AppImage`.
2. Make it executable and run it:
   ```bash
   chmod +x "AI Sandbox Manager-*.AppImage"
   ./"AI Sandbox Manager-*.AppImage"
   ```

## Updating

Download and install the newer version from the releases page; your data
(definitions, credentials, logs) lives under your user data directory and is
preserved across versions.
