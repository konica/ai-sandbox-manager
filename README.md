# AI Sandbox Manager

Local control-plane GUI for [Docker Sandboxes](https://docs.docker.com/) running Claude Code agents. An Electron desktop app that lets you create, list, and manage isolated sandbox instances without touching the terminal.

## Prerequisites

The app checks for these on startup (see the **Prereq** screen):

| Requirement | Why | Blocking? |
|-------------|-----|-----------|
| **Node.js** ≥ 18 | Build & run tooling | Yes (to run) |
| **Docker** | Runs the sandbox containers | Yes |
| **Docker Sandboxes CLI** (`sbx`) | Control plane for sandboxes | Yes |
| **`sbx` authentication** | Run `sbx login` before use | Yes |
| Free disk space (≥ 2 GiB) | Room for sandbox images | Warning |
| OS keychain | Credential storage (encrypted fallback if absent) | Warning |

Verify your environment:

```bash
node --version      # v18+
docker --version
sbx --version
sbx login           # if not already authenticated
```

## Setup

```bash
# Install dependencies
npm install

# Rebuild native modules (better-sqlite3) against Electron's ABI
npm run rebuild
```

> **Note:** `better-sqlite3` is a native module and must be compiled for
> Electron's Node ABI. If you hit a `NODE_MODULE_VERSION` mismatch at
> launch, re-run `npm run rebuild`.

## Running

```bash
# Development (hot reload, DevTools)
npm run dev

# Production build
npm run build

# Preview the production build
npm start
```

`npm run dev` starts the renderer dev server on a fixed port
(`http://localhost:8100`, configured in `electron.vite.config.ts`) and
launches the Electron window. On first run you'll see the **Prerequisites**
screen; once the blocking checks pass, the app routes to the **Instances**
list.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Launch app in development mode (electron-vite) |
| `npm run build` | Build main, preload, and renderer bundles |
| `npm start` | Preview the production build |
| `npm run typecheck` | Type-check with `tsc --noEmit` |
| `npm test` | Run the test suite (Vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run rebuild` | Rebuild `better-sqlite3` for Electron |

## Project structure

```
src/
├── main/              Electron main process
│   ├── index.ts       App entry — window, store, IPC wiring
│   ├── ipc.ts         IPC handler registration
│   ├── prereq.ts      Prerequisite checks
│   ├── probes.ts      System probes (docker, sbx, disk, keychain)
│   ├── reconciler.ts  Syncs sbx state with local store
│   ├── sbx/           Docker Sandboxes CLI adapter + parsers
│   └── store/         SQLite metadata store (better-sqlite3)
├── preload/           Context-isolated IPC bridge
├── renderer/          React UI
│   ├── App.tsx        Root — prerequisite-based routing
│   ├── screens/       Prereq, Instances
│   ├── ipc/           Typed IPC client
│   └── theme/         Design tokens
└── shared/            Types and errors shared across processes

tests/                 Vitest suites (node + jsdom for renderer)
```

## Tech stack

- **Electron 33** + **electron-vite** — desktop shell & bundler
- **React 18** + **TypeScript 5.7** — renderer UI
- **better-sqlite3** — local metadata persistence
- **Vitest** — testing

## Troubleshooting

- **`NODE_MODULE_VERSION` error on launch** → `npm run rebuild`
- **`spawn .../electron/dist/dist/Electron.app/... ENOENT`** → the Electron
  install is corrupted (usually a bad `path.txt`). Reinstall cleanly:
  `rm -rf node_modules/electron && npm install electron`
- **Prereq screen blocks on `sbx`** → ensure `sbx` is on your `PATH` and run `sbx login`
- **Prereq screen blocks on Docker** → start Docker Desktop
