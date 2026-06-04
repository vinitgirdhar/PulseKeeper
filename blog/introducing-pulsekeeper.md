# Introducing PulseKeeper: Your Personal Content Hub That Builds Its Own Newsletter

There's a problem I kept running into. Too many tabs. Too many bookmarks. Too many feeds spread across too many apps. Somewhere buried in that mess was the content I actually cared about — a handful of YouTube channels, a few subreddits, some RSS blogs, a podcast or two, the occasional newsletter — and finding any of it meant jumping through six different apps before my morning coffee was even cold.

So I built something to fix it.

**PulseKeeper** is a free, open-source Windows 11 system tray app that quietly aggregates all of your content sources in one place, gives you a clean reading view right from the tray, and — here's the part I'm most excited about — can export everything directly into [AgentPlatform](https://github.com/rod-trent/AgentPlatform) to generate a personalized, AI-written newsletter on any schedule you choose.

No subscriptions. No API accounts. No monthly fees. Everything runs locally on your machine.

Let's dig in.

---

## It Lives in Your Tray and Stays Out of Your Way

PulseKeeper isn't another browser tab or a full-blown window you have to manage. It lives in the Windows 11 system tray — that little cluster of icons in the bottom-right corner of your taskbar. It's just *there*, doing its job in the background.

When new content arrives, a red badge appears on the tray icon with an unread count. Left-click the icon and a compact popup slides up showing your latest items. Right-click for the full menu. That's the entire interaction model. If you don't want to look at it, you don't have to — but it's always ready when you do.

You can even configure PulseKeeper to launch automatically at Windows startup so it's running before you even sit down at your desk.

---

## No Developer Accounts Required — For Any Source

This was a deliberate design decision and one I feel strongly about.

A lot of content aggregation apps eventually hit you with a requirement: go create a developer account, generate API credentials, agree to terms of service, wait for approval. I've been through that loop with Twitter's API (now X), Spotify's developer portal, and others. It's a barrier that turns a five-minute setup into an afternoon project — and then the API changes its pricing model and breaks everything six months later.

PulseKeeper takes a different philosophy: **if the content is publicly available, you shouldn't need a special key to read it.**

Every source type in PulseKeeper works completely credential-free:

| Source Type | What You Provide | API Key? |
|---|---|---|
| **RSS / Atom** | Feed URL | No |
| **Podcast** | Podcast RSS feed URL | No |
| **YouTube** | Channel URL or `@handle` | No |
| **Reddit** | Subreddit name + sort order | No |
| **Newsletter** | Feed URL (Substack, Beehiiv, Ghost, etc.) | No |
| **Blog** | Feed URL | No |
| **Web Page** | URL + optional CSS selectors | No |
| **Browser Capture** | Managed by the extension | No |

YouTube channels are resolved using YouTube's internal innertube API — paste a `@handle` or a full channel URL and PulseKeeper figures out the channel ID and RSS feed behind the scenes. Reddit uses the public RSS feed for any subreddit. Podcasts just need the show's public RSS URL (easily found on [podchaser.com](https://podchaser.com) or [Listen Notes](https://listennotes.com)). It all just works.

---

## A Quick Tour of the Features

### Smart Content Popup

The tray popup is where you spend most of your time. It loads fast, scrolls smoothly, and shows you everything that's come in since you last looked. Filter chips across the top let you narrow to a specific source type — click **YouTube** to see only YouTube items, **Reddit** to see only your subreddits, and so on. The chip row is fully scrollable so no matter how many source types you've added, none of them get cut off.

Click any item to open it and mark it as read (it fades out so you know you've seen it). Hit **Mark All Read** to clear the badge in one shot. Need to share or save what you're looking at? The clipboard button copies everything visible as clean, formatted Markdown.

### RSS Auto-Discovery

Can't find a feed URL? Don't worry about it. Paste any website URL into PulseKeeper and it will crawl the page looking for an RSS or Atom feed link automatically. Most modern blogs, newsletters, and publications include these in their page headers even if they don't advertise them.

### CSS Selector Scraping for Web Pages

Some sites don't have feeds. For those, PulseKeeper includes a web scraping source type. Point it at any URL, optionally provide CSS selectors to target the specific title, link, and content elements you care about, and PulseKeeper will pull the content on your refresh schedule. You can even enable change monitoring so you only get notified when the page content actually changes — useful for things like release notes pages, documentation updates, or status pages.

### Browser Extension for Capturing Anything

Sometimes you're already in the browser and you just want to capture something quickly. The PulseKeeper browser extension (Chrome and Edge, Manifest V3) adds a right-click menu to every page:

- **Send page to PulseKeeper** — captures the full current page
- **Send selection to PulseKeeper** — sends highlighted text
- **Send link to PulseKeeper** — queues a URL from any hyperlink

The extension communicates with the desktop app over a local HTTP server on port 7828. A live status indicator in the settings panel tells you whether the capture server is reachable. The extension files are automatically copied to your data folder (`Documents\PulseKeeper\extension\`) every time PulseKeeper starts — no manual file management needed.

### Mute Words

Not every word in a feed is worth your attention. The Mute Words setting lets you enter words or phrases — one per line — and any content item containing those words is silently dropped across all sources. Great for filtering out topics you're tired of seeing without having to remove the source entirely.

### Per-Source Refresh Intervals

Different sources update at different rates. You probably don't need to check a monthly newsletter as often as you check a busy tech news RSS feed. PulseKeeper lets you override the global refresh interval on a per-source basis so each source fetches at the cadence that makes sense for it.

### Source Health Monitoring

Each source card shows a last-fetched timestamp and any errors from the most recent attempt. If a feed goes down or changes its URL, you'll know exactly which source broke and what the error was.

### Digest History

Every time you generate a digest, it's saved automatically to `Documents\PulseKeeper\history\`. The Export tab lists the last 10 digests with an Open button for each, so you can always go back to yesterday's summary even if you've since refreshed all your sources.

### Light and Dark Theme

PulseKeeper uses a Fluent Design aesthetic — dark navy and cyan by default, with a matching light mode if you prefer. Toggle it from the settings sidebar at any time.

### Backup and Restore

Your source list, settings, and configuration can be exported to a single JSON file at any time. Import it on a new machine and you're back up in seconds.

---

## The Part I'm Most Excited About: Your Personal AI Newsletter

Everything described above is genuinely useful on its own. But PulseKeeper's deepest feature is what happens when you connect it to [AgentPlatform](https://github.com/rod-trent/AgentPlatform).

Here's the concept: you've spent time curating your sources in PulseKeeper. You've added the YouTube channels you follow, the subreddits you read, the RSS blogs you trust, the podcasts you listen to. That collection represents *your* interests, *your* topics, *your* corner of the internet. PulseKeeper is already fetching all of that content on a schedule and caching it locally.

What if an AI agent could read all of that cached content and write you a digest — a real newsletter — tailored exactly to those sources, in your preferred format, on whatever schedule you choose?

That's exactly what the AgentPlatform integration does.

### How It Works

In the Export tab, click **Export Agent Pack**. PulseKeeper generates a JSON file containing two fully configured agents ready to import into AgentPlatform:

**Agent 1 — Content Collector (Script Agent)**

This is a script agent that runs `pk-bridge.js`, a lightweight Node.js bridge script included with PulseKeeper. When executed, it reads the latest cached content from all of your enabled sources and outputs it as clean, structured Markdown. No network calls. No API keys. It just reads what PulseKeeper has already fetched and formats it.

```bash
node scripts/pk-bridge.js --format markdown --max 40
```

You can also run this from the command line directly. It supports `--format text`, `--format markdown`, or `--format json` and a `--max` flag to limit how many items it includes. But inside AgentPlatform, it's wired up automatically — no configuration needed beyond importing the pack.

**Agent 2 — AI Digest (Prompt Agent)**

This is a prompt agent that takes the Markdown output from Agent 1 and feeds it into your configured LLM with a summarization prompt. The result is a readable, AI-written digest of everything your sources surfaced since the last run.

The two agents are chained — Agent 2 automatically receives Agent 1's output as its input. Import the pack, set a schedule, and the pipeline runs end-to-end without any further intervention.

### Choosing Your LLM

PulseKeeper's AI/LLM settings support a range of providers, and the AgentPlatform export respects whichever one you've configured:

- **Anthropic** — Claude models
- **OpenAI** — GPT models
- **xAI** — Grok models
- **Ollama** — Local models, completely offline and free, no API key required
- **Any OpenAI-compatible endpoint** — bring your own

If you want to keep everything local and free, Ollama with a model like Llama 3 or Mistral runs entirely on your own hardware. Point PulseKeeper at `http://localhost:11434/v1` and you have a fully local, fully private AI newsletter pipeline.

### Setting the Schedule

Once the agent pack is imported into AgentPlatform, you set the schedule there — daily at 7 AM, weekly every Monday morning, every few hours, whatever fits your reading habits. AgentPlatform handles the execution and you get a fresh digest waiting for you exactly when you want it.

Think about what this actually means: you define your sources once in PulseKeeper. You set the schedule once in AgentPlatform. From that point forward, you have a personalized newsletter written by an AI that knows exactly which sources you care about, surfacing the content that came in since last time, summarized and formatted exactly how you want it. No editorial team. No algorithm trying to maximize engagement. Just your sources, your schedule, your digest.

---

## Getting Started

The easiest way to get PulseKeeper is to grab the official v1.0.0 release directly from GitHub:

**[⬇ Download PulseKeeper v1.0.0](https://github.com/rod-trent/PulseKeeper/releases/tag/v1.0.0)**

Download **PulseKeeper-Setup-1.0.0.exe** — a full installer that creates Start Menu and desktop shortcuts.

No Node.js. No npm. No command line. Download, run, done.

If you'd rather run from source, clone the repo and follow the standard setup:

```bash
git clone https://github.com/rod-trent/PulseKeeper.git
cd PulseKeeper
npm install
npm start
```

Either way, the app appears in your system tray immediately. Add your first source from the Content Sources tab, hit Collect Now, and your first items will appear within seconds.

The full source code, documentation, and issue tracker are on GitHub at [https://github.com/rod-trent/PulseKeeper](https://github.com/rod-trent/PulseKeeper).

---

## What's Next

PulseKeeper is already in a solid, daily-driver state — I've been running it myself for content discovery and it's become a core part of how I stay on top of topics I care about. That said, there's more on the roadmap: additional source types, richer digest formatting options, and deeper AgentPlatform integration as that project evolves.

If you build something interesting with it, run into a bug, or have a source type you'd like to see added, open an issue or drop a comment. This is open source — built in public, improved in public.

Go keep your pulse on the content that matters.

---

*PulseKeeper is free and open source under the MIT license. [AgentPlatform](https://github.com/rod-trent/AgentPlatform) is a companion project for building and running chained AI agents on Windows.*
