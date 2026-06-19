# PulseKeeper Release Notes

---

## v1.1.0 — April 13, 2026

### What's New

#### In-App Digest Browser
- Navigation toolbar (Back, Forward, Reload, Home, URL bar, Open External) appears when viewing the HTML digest
- Toolbar is automatically injected into external article pages so navigation is always available
- **✕ Digest** close button returns to the digest from any article page
- New setting: **Open Digest Articles In** — choose between the in-app viewer or your system default browser

#### Content & Retention
- New **Keep Records For** setting (1–5 days) — items older than the selected window are pruned automatically on each refresh
- Digest viewer sidebar now shows **unread counts** per source type instead of total counts
- Read items are visually dimmed in the digest viewer

#### Popup Improvements
- Filter chips now show live **unread counts** with red badges per source type
- Chips update instantly when items are marked read
- **Search bar** added to the popup for quick keyword filtering
- **Mark All Read** now shows a 4-second undo toast before committing

#### Digest Improvements
- **Search bar** in the HTML digest filters items by title and description
- **"New" badge** on items that weren't in the previous digest (diff since last generation)
- Unread count shown in the digest header
- New **Digest Font Size** setting: Small, Medium, or Large
- **Auto Digest** — schedule a daily digest generation at a configurable time; saves to history and sends a notification

#### Source Management
- **Import OPML** — bulk-import RSS feeds from any OPML file via the Sources tab header
- **Bypass Global Mute Words** toggle per source — individual sources can opt out of global mute filtering
- **YouTube Playlist** badge shown on source cards when the configured URL is a playlist
- **Unmuted** badge shown on source cards that bypass global mute words

#### Health Dashboard
- New **Health** tab in the main window with a full metrics view per source: last fetch time, new items, cached count, and error status

#### Settings
- Configurable **Max History Count** (5 / 10 / 20 / 30 / 50 digests) exposed in the Export tab
- **Auto Digest** schedule (time picker + enable toggle) in the Settings tab

#### Notifications
- Clicking a Windows notification now opens the relevant content — refresh notification opens the popup; daily digest notification opens the digest

#### Keyboard Shortcuts (main window)
- `Ctrl+R` — Refresh all sources
- `Ctrl+E` — Open digest
- `Ctrl+,` — Jump to Settings tab
- `Ctrl+N` — Add new source

#### Theme
- Theme now **automatically follows Windows dark/light mode**; manual toggle pins your preference and opts out of OS sync

### Installation

| Package | Description |
|---|---|
| `PulseKeeper-Setup-1.1.0.exe` | Full NSIS installer with Start Menu and desktop shortcuts |
| `PulseKeeper-Portable-1.1.0.exe` | Single-file portable — no install required, just run it |

---

## v1.0.0 — April 7, 2026

**Initial public release.**

### What Is PulseKeeper?

PulseKeeper is a Windows 11 system tray app that aggregates content from your chosen sources — RSS feeds, YouTube channels, Reddit, podcasts, newsletters, blogs, and web pages — and delivers it as a clean digest right from your taskbar. It requires no developer accounts, no API keys, and no subscriptions. Everything runs locally on your machine.

---

### Installation

| Package | Description |
|---|---|
| `PulseKeeper-Setup-1.0.0.exe` | Full NSIS installer with Start Menu and desktop shortcuts |
| `PulseKeeper-Portable-1.0.0.exe` | Single-file portable — no install required, just run it |

**Requirements:** Windows 10 / 11 (x64). No other dependencies — Node.js is bundled.

**Requirements:** Windows 10 / 11 (x64). No other dependencies — Node.js is bundled.

---

### Features in This Release

#### System Tray Integration
- Runs quietly in the Windows 11 system tray
- Left-click opens the content popup; right-click opens the context menu
- Unread badge on the tray icon shows new item count
- Optional **Run at Windows startup** setting to launch PulseKeeper automatically at login

#### Content Sources — No API Keys Required
All source types work without a developer account or credentials:

| Source | Notes |
|---|---|
| **RSS / Atom** | Paste any feed URL; auto-discovery finds feeds from plain website URLs |
| **YouTube** | Supports `/channel/UCxxxxxx` URLs and `@handle` — resolved via YouTube's innertube API |
| **Reddit** | Any public subreddit; choose hot / new / top / rising sort |
| **Podcast** | Any public podcast RSS feed |
| **Newsletter** | Substack, Beehiiv, Ghost, and any newsletter with an RSS feed |
| **Blog** | Any blog or publication with a feed |
| **Web Page** | URL scraping with optional CSS selectors for title, link, and content; optional change monitoring |
| **Browser Capture** | Chrome/Edge extension sends pages, selections, and links directly to the app |

#### Tray Popup
- Filter chips to narrow content by source type — fully scrollable with mouse wheel support
- Click any item to open it and mark it read
- **Mark All Read** button to clear the badge in one shot
- Clipboard export — copies all visible items as formatted Markdown
- Manual refresh button to trigger an immediate fetch of all sources

#### Content Controls
- **Mute words** — silently drop items containing specified words across all sources
- **Per-source refresh intervals** — override the global schedule for individual sources
- **Read tracking** — read state persists across sessions
- **RSS auto-discovery** — paste any website URL and PulseKeeper finds the feed

#### Browser Extension
- Chrome and Edge, Manifest V3
- Right-click context menu: send page, send selection, send link
- Extension files automatically copied to `Documents\PulseKeeper\extension\` on every startup
- Live Capture Server Status indicator in settings shows whether the local server (port 7828) is reachable

#### Source Health Monitoring
- Each source card shows last successful fetch time
- Error messages displayed per source so you know exactly what broke and why

#### AI Digest Generation
- Connects to Anthropic (Claude), OpenAI (GPT), xAI (Grok), Ollama (local/offline), or any OpenAI-compatible endpoint
- Generates digests as styled HTML, Markdown, or PDF
- Digest history — last 10 generated digests saved to `Documents\PulseKeeper\history\` and accessible from the Export tab

#### AgentPlatform Integration
- **Export Agent Pack** generates a ready-to-import JSON file for [AgentPlatform](https://github.com/rod-trent/AgentPlatform)
- The pack contains two chained agents:
  - **Content Collector** (Script Agent) — runs `pk-bridge.js` to read all cached source content and output it as Markdown
  - **AI Digest** (Prompt Agent) — feeds that Markdown into your configured LLM and produces a summarized digest
- Schedule the chain in AgentPlatform to generate a personalized newsletter daily, weekly, or on any cron schedule
- `pk-bridge.js` also works standalone from the command line: `node scripts/pk-bridge.js --format markdown --max 40`

#### Settings & Customization
- Light and dark theme (Fluent Design, dark navy/cyan default)
- Global and per-source refresh intervals
- Backup and restore — export/import all sources and settings as a single JSON file
- Configurable maximum items per source
- Collect on startup toggle
- Run at Windows startup toggle

#### Data Storage
All data stored locally at `%USERPROFILE%\Documents\PulseKeeper\`. Nothing is sent to any cloud service except your configured LLM provider when generating a digest.

---

### Known Limitations

- Windows 10 / 11 x64 only in this release
- Browser extension must be manually loaded as an unpacked extension (Chrome/Edge Developer Mode) — browser store submission is planned
- `@handle` YouTube URL resolution depends on YouTube's internal innertube API, which is unofficial and may change without notice; `/channel/UCxxxxxx` URLs are always more reliable
- PDF output uses Electron's built-in `printToPDF` — page formatting depends on the system's print settings

---

### What's Not Included (By Design)

PulseKeeper deliberately excludes source types that require developer credentials or paid API access. Specifically:

- **X / Twitter** — requires a paid API Bearer Token
- **Spotify** — requires OAuth developer credentials

If a source type requires a developer account or API key to access publicly available content, it won't be in PulseKeeper.

---

### Getting Started

Download `PulseKeeper-Setup-1.1.0.exe`, run the installer, and launch PulseKeeper from your Start Menu or desktop shortcut. The tray icon will appear in your system tray. Left-click to open the popup and add your first source from the **Content Sources** tab in settings.

Full documentation: [github.com/rod-trent/PulseKeeper](https://github.com/rod-trent/PulseKeeper)

---

*PulseKeeper is free and open source under the MIT license.*
*It is a companion app to [AgentPlatform](https://github.com/rod-trent/AgentPlatform).*
