# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

**PulseKeeper** — a Windows **Electron desktop app** that aggregates content from YouTube,
podcasts, blogs, RSS/Atom feeds, newsletters, Reddit, and web pages into a daily "digest,"
optionally summarized by an LLM. It runs as a **system-tray app** (no main window on launch).

- Author: rod-trent · License: MIT · Version 1.1.0
- Stack: Electron 41, vanilla JS (no framework, no bundler, no TypeScript), Node 24.
- Repository: https://github.com/vinitgirdhar/PulseKeeper

## Run / build

`node`/`npm` live at `C:\Program Files\nodejs\` but may not be on PATH. If `npm` is
"not recognized", prepend it for the session: `$env:Path = "C:\Program Files\nodejs;" + $env:Path`

```powershell
npm install        # first time only
npm start          # runs: electron --no-deprecation .  (entry: src/main/index.js)
npm run build      # electron-builder --win  → NSIS installer + portable exe
npm run build:dir  # unpacked app dir (fast, for testing a build)
```

There is **no test suite, linter, or typecheck** configured. Don't invent commands.

## How to actually see the UI (important)

`npm start` opens **no window** — the app lives in the **system tray** (bottom-right of the
taskbar, behind the `^` arrow). The tray icon is a dark-blue square with a cyan EKG line.

- **Right-click tray → ⚙️ Settings** → opens the main window ([src/renderer/index.html](src/renderer/index.html)),
  whose left sidebar has the tabs: Sources, **Content** (in-window reader for all collected items), Settings, **AI / LLM**, Health, Export, Extension, About.
- **Left-click tray** → small content popup ([src/renderer/popup.html](src/renderer/popup.html)).
- **Double-click tray** → opens the digest viewer.

Closing the `npm start` terminal quits the app. `window-all-closed` is intercepted so closing
windows does NOT quit — only the tray "Quit" or killing the process does.

## Architecture

Electron with **contextIsolation on, nodeIntegration off**. Renderer never touches Node directly —
everything goes through the preload bridge.

### Main process — [src/main/](src/main/)
- [index.js](src/main/index.js) — app entry: tray, windows (settings/popup/digest), all `ipcMain` handlers, notifications, digest rendering orchestration.
- [storage.js](src/main/storage.js) — JSON file persistence (see Data below); defaults for settings & sources.
- [collector.js](src/main/collector.js) — fetches all enabled sources, dedups, prunes by retention, applies mute words.
- [scheduler.js](src/main/scheduler.js) — `node-cron` driven refresh + auto-digest. Auto-digest has two modes: `interval` (every N hours, default 8) and `daily` (once at a fixed `HH:MM`). Configured via `settings.autoDigest.mode` / `everyHours` / `time`.
- [server.js](src/main/server.js) — local HTTP **capture server on port 7828** (`127.0.0.1`) for the browser extension.
- [llmClient.js](src/main/llmClient.js) — universal LLM client via the **OpenAI SDK** against per-provider `baseURL` (Anthropic/OpenAI/Gemini/xAI/Groq/Ollama/custom). Supports per-config `timeoutMs` (default 15 min for slow local models) and `maxItems` cap on digest prompt size.
- [outputRenderer.js](src/main/outputRenderer.js) — builds the HTML / Markdown digest. Supports `theme` (`dark`/`light`), AI digest status states (`aiPending` spinner, `aiError` banner, `aiGeneratedAt` timestamp), and CSS vars for both themes (including scrollbar thumb colors).
- [agentExport.js](src/main/agentExport.js) — exports an AgentPlatform agent pack.
- [sources/](src/main/sources/) — one fetcher per type; [sources/index.js](src/main/sources/index.js) holds `SOURCE_TYPES` (the UI form schema) and `fetchSource()` dispatch. RSS/podcast/newsletter/blog all route through [sources/rss.js](src/main/sources/rss.js).
- [preload.js](src/main/preload.js) — exposes `window.pcbAPI` (sources/content/settings/output/digest/llm/ui/popup + `on` events) to the renderer via `contextBridge`. LLM methods: `generateDigest`, `generateDigestNow` (force immediate), `getDigestStatus`. Events: `digestGenerating`, `digestGenerated`, `digestError`.

### Renderer — [src/renderer/](src/renderer/)
- [index.html](src/renderer/index.html) + [app.js](src/renderer/app.js) — the main settings/management window (tabbed sidebar).
- [popup.html](src/renderer/popup.html) + [popup.js](src/renderer/popup.js) — the tray quick-view popup.
- [styles.css](src/renderer/styles.css) — all styling; dark/light theme via CSS vars, follows OS theme unless pinned.

### Browser extension — [extension/](extension/)
Chrome/Edge MV3 extension (load unpacked). Right-click → "Send to PulseKeeper" POSTs the page/selection/link to the capture server at `http://localhost:7828`.

## Data & config (runtime, not in repo)

User data lives in **`%USERPROFILE%\Documents\PulseKeeper\`**:
`sources.json`, `settings.json`, `read.json`, `health.json`, `ai-digest.json` (cached AI summary), and `content/`, `output/`, `history/`, `extension/` folders.
Deleting these resets the app to the defaults defined in [storage.js](src/main/storage.js).

## Conventions & gotchas

- **IPC naming:** the renderer-exposed object is `window.pcbAPI` (legacy "PCB" name); IPC channels are `domain:action` (e.g. `sources:list`, `llm:generateDigest`). Keep preload, `ipcMain` handlers, and callers in sync when adding one.
- **No build step for renderer** — plain `<script src>`. A strict CSP is set in [index.html](src/renderer/index.html#L6) (`connect-src` limited to the 7828 capture server). Update it if you add network calls.
- **Plain CommonJS**, `'use strict'`, 2-space indent, semicolons. Match the terse comment style already in the files.
- **LLM "configured"** = enabled AND (local provider `ollama`/`custom`, OR an `apiKey` present). See `llmConfigured()` in [index.js](src/main/index.js#L23).
- **AI digest caching:** the AI summary is generated on a schedule and cached to `ai-digest.json`; opening the digest reads the cache instead of re-calling the model. `aiDigestState` in `index.js` prevents concurrent generation. The digest view shows a spinner (`aiPending`), a stale-timestamp (`aiGeneratedAt`), or an error banner (`aiError`) accordingly.
- **Digest nav bar theming:** the injected `__pk_nav__` toolbar in the internal browser adapts to dark/light theme via computed CSS variables passed into the injected `executeJavaScript` string.
- **Groq provider** added alongside Anthropic/OpenAI/Gemini/xAI/Ollama/custom. Error hint links to `console.groq.com/keys`.
- **Ollama remote:** `baseURL` is honoured for Ollama (e.g. `http://192.168.1.95:11434/v1`) — previously only `custom` forwarded the user URL.
- Icons (`assets/icon.ico/.png`) are generated programmatically (`makePKIcon` / [scripts/generate-ico.js](scripts/generate-ico.js)); they must sit outside the asar at runtime — that's why they're in `extraResources`.
- Single-instance lock is enforced; a second launch just focuses the existing settings window.
- Windows-only target (NSIS + portable, x64). PowerShell is the shell.
- **Never write the data JSONs with a UTF-8 BOM.** `storage.js` reads them with bare
  `JSON.parse(fs.readFileSync(...,'utf8'))` and a BOM makes the parse throw — `getSources()`
  then silently returns `[]` and the UI looks wiped. PS 5.1 `Set-Content -Encoding utf8`
  WRITES a BOM; use `[IO.File]::WriteAllText($p,$s,(New-Object Text.UTF8Encoding($false)))` instead.

## Don't

- Don't add a framework/bundler/TS — this is intentionally dependency-light vanilla JS.
- Don't commit anything under `node_modules/` or the user's `Documents\PulseKeeper\` data.
- Don't expose Node APIs to the renderer outside the `pcbAPI` preload bridge.
