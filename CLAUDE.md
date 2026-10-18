# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**PulseKeeper** — a Windows **Electron desktop app** that aggregates content from YouTube,
podcasts, blogs, RSS/Atom feeds, newsletters, Reddit, and web pages into a **news-aggregator
reader** and a daily "digest," optionally summarized by an LLM (cloud or local). It runs as a
**system-tray app** (no main window on launch).

- Author: rod-trent · License: MIT · Version 1.1.0
- Stack: Electron 41, vanilla JS (no framework, no bundler, no TypeScript), Node 24. UI motion: GSAP (core only). UI font: Inter Variable (`@fontsource-variable/inter`).

## Run / build / test

`node`/`npm` live at `C:\Program Files\nodejs\` but may not be on PATH. If `npm` is
"not recognized", prepend it for the session: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

```powershell
npm install        # first time only
npm start          # runs: electron --no-deprecation .  (entry: src/main/index.js)
npm test           # node:test backend suite (test/backend.test.js) — fake local servers, throwaway HOME
npm run build      # electron-builder --win  → NSIS installer + portable exe
npm run build:dir  # unpacked app dir (fast, for testing a build)
```

The test suite covers the backend only (collector, storage, fetchers, LLM client, scheduler maths). There is
no linter or typecheck configured. Don't invent commands.

## How to actually see the UI (important)

`npm start` opens **no window** — the app lives in the **system tray** (bottom-right of the
taskbar, behind the `^` arrow). The tray icon is a dark-blue square with a cyan EKG line.

- **Right-click tray → Open PulseKeeper** → opens the main window ([src/renderer/index.html](src/renderer/index.html)).
  Sidebar: **All Stories** + the category → source tree (the news aggregator), then Manage: Sources, Health, AI & Models, Settings, Export, Extension, About.
- **Left-click tray** → small content popup ([src/renderer/popup.html](src/renderer/popup.html)).
- **Double-click tray** → opens the digest viewer.

Closing the `npm start` terminal quits the app. `window-all-closed` is intercepted so closing
windows does NOT quit — only the tray "Quit" or killing the process does.

README screenshots (`Images/screenshots/`) are generated the same way: real renderer + mock `pcbAPI` + sample stories, in headless Chromium at 2× scale.

The renderer can also be exercised in a plain browser: load `src/renderer/index.html` with a stub
`window.pcbAPI` injected before the scripts (that's how the UI was verified outside Windows).

## Architecture

Electron with **contextIsolation on, nodeIntegration off**. Renderer never touches Node directly —
everything goes through the preload bridge.

### Main process — [src/main/](src/main/)
- [index.js](src/main/index.js) — app entry: tray, windows (main/popup/digest), all `ipcMain` handlers, notifications, digest orchestration. `openExternalSafe()` is the only path to `shell.openExternal` (http/https/mailto only — feed links are untrusted).
- [storage.js](src/main/storage.js) — JSON file persistence + read model. Read-modify-write sections are synchronous (no `await` between read and write) so parallel callers can't lose updates; reads are cached by mtime. `queryContent()` (filter/search/sort/dedupe/page; `saved: true` queries the saved snapshots) and `getChannels()` (category → source tree with unread/saved counts) feed the UI; mute words, source name/type/category are applied **at read time**.
- [collector.js](src/main/collector.js) — fetches enabled sources 5 at a time, conditional GET, `mergeItems()` (retention by **publish date** with a per-source floor), failure backoff. Emits `start/progress/sourceComplete/sourceError/complete`.
- [scheduler.js](src/main/scheduler.js) — `node-cron` refresh + auto-digest. `cronEvery(minutes)` maps intervals ≥ 60 min to hourly crons (a `*/120` minute field fires every hour).
- [http.js](src/main/http.js) — the one HTTP helper every fetcher uses (UA, timeout, retry, size cap, charset, ETag/Last-Modified). Don't hand-roll `https.get` again.
- [util.js](src/main/util.js) — `stripHTML`, `toISO`, `canonicalUrl`, `httpUrl`, `parseOPML`.
- [server.js](src/main/server.js) — local HTTP **capture server on port 7828** (`127.0.0.1`) for the browser extension; accepts writes only from `*-extension://` origins.
- [llmClient.js](src/main/llmClient.js) — universal LLM client (digests via `generateDigest`, one-story summaries via `summarizeItem`): cloud/custom via the **OpenAI SDK** (streaming, idle watchdog), **Ollama via its native `/api/chat`** (sets `num_ctx`). `generateDigest` packs items to the context budget; `listModels` asks the provider; keys resolve from `apiKey` or the per-provider `apiKeys` map; `isConfigured()` is the single "is the LLM usable" check.
- [outputRenderer.js](src/main/outputRenderer.js) — builds the HTML / Markdown digest (self-contained page; grouped by category).
- [agentExport.js](src/main/agentExport.js) — exports an AgentPlatform agent pack.
- [sources/article.js](src/main/sources/article.js) — `extractArticle(url)`: best-effort readable text of an article page (feeds the AI story summary; returns `''` on failure).
- [sources/](src/main/sources/) — one fetcher per type; [sources/index.js](src/main/sources/index.js) holds `SOURCE_TYPES` (the UI form schema) and `fetchSource(source, state)` → `{ items, state }` or `{ notModified: true }`. RSS/podcast/newsletter/blog all route through [sources/rss.js](src/main/sources/rss.js) (`loadFeed()` is also used by Reddit/YouTube).
- [preload.js](src/main/preload.js) — exposes `window.pcbAPI` (sources/content/settings/output/digest/llm/ui/popup + `on` events) to the renderer via `contextBridge`.

### Renderer — [src/renderer/](src/renderer/)
- [theme.css](src/renderer/theme.css) — design tokens (light/dark via `html[data-theme]`, accent via `html[data-accent]`) + shared controls (buttons, inputs, switch, segmented, tiles). Used by the main window **and** the popup.
- [styles.css](src/renderer/styles.css) — main window layout and views.
- [index.html](src/renderer/index.html) — markup for every view (`#view-news`, `#view-sources`, …) and the sheets.
- Scripts load in this order: `gsap` → [icons.js](src/renderer/icons.js) → [motion.js](src/renderer/motion.js) → [ui.js](src/renderer/ui.js) (helpers, toasts, dialogs, menus) → [news.js](src/renderer/news.js) (channel tree, story list, reader) → [app.js](src/renderer/app.js) (navigation, sources, health, AI, settings, export).
- [popup.html](src/renderer/popup.html) + [popup.css](src/renderer/popup.css) + [popup.js](src/renderer/popup.js) — the tray quick-view.

### Browser extension — [extension/](extension/)
Chrome/Edge MV3 extension (load unpacked). Right-click → "Send to PulseKeeper" POSTs the page/selection/link to the capture server at `http://localhost:7828`.

## Data & config (runtime, not in repo)

User data lives in **`%USERPROFILE%\Documents\PulseKeeper\`**:
`sources.json`, `settings.json`, `read.json`, `saved.json` (full snapshots — survive retention and source deletion), `summaries.json` (cached per-story AI summaries, capped), `health.json`, `ai-digest.json`, and `content/`, `output/`, `history/`, `extension/` folders.
Deleting these resets the app to the defaults defined in [storage.js](src/main/storage.js). An unreadable JSON file is copied to `<file>.corrupt-<ts>` before it can be overwritten.
`health.json` per source also holds `fetchState` (ETag/Last-Modified + request signature), `consecutiveFailures`, `lastDurationMs`.
Sources carry a `category` (defaults inferred from `seedId`, else "General").

## Conventions & gotchas

- **IPC naming:** the renderer-exposed object is `window.pcbAPI` (legacy "PCB" name); IPC channels are `domain:action` (e.g. `content:query`, `llm:generateDigest`). Keep preload, `ipcMain` handlers, and callers in sync when adding one.
- **No build step for renderer** — plain `<script src>`. CSP in [index.html](src/renderer/index.html) is strict: `script-src 'self'` (**no inline scripts or `onclick=` handlers** — use `addEventListener`), `img-src` allows https (feed thumbnails), `connect-src` limited to the 7828 capture server. Update it if you add network calls.
- **Motion:** use `Motion.*` (motion.js) rather than ad-hoc GSAP; every helper degrades to the final state when GSAP is missing or `prefers-reduced-motion` is set. Elements must be visible by default.
- **Theming:** never hard-code colours in components; use the tokens in theme.css. Source-type colours are `.t-<type>` classes (`--tile`).
- **Plain CommonJS** in main, `'use strict'`, 2-space indent, semicolons. Match the terse comment style already in the files.
- **LLM "configured"** = enabled AND (local provider `ollama`/`custom`, OR a key resolvable from `apiKey`/`apiKeys`). Use `isConfigured()` from llmClient.
- Icons (`assets/icon.ico/.png`) are generated programmatically (`makePKIcon` / [scripts/generate-ico.js](scripts/generate-ico.js)); they must sit outside the asar at runtime — that's why they're in `extraResources`.
- Single-instance lock is enforced; a second launch just focuses the existing main window.
- Windows-only target (NSIS + portable, x64). PowerShell is the shell. The main window uses `titleBarStyle: 'hidden'` + a transparent `titleBarOverlay` (52 px); headers reserve space for the caption buttons via `env(titlebar-area-*)`.

## Don't

- Don't add a framework/bundler/TS — this is intentionally dependency-light vanilla JS.
- Don't commit anything under `node_modules/` or the user's `Documents\PulseKeeper\` data.
- Don't expose Node APIs to the renderer outside the `pcbAPI` preload bridge.
- Don't pass feed-supplied URLs to `shell.openExternal` directly.
