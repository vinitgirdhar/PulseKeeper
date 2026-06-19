# Your Newsletter, Your Rules: Building a Personal Newsletter with PulseKeeper and AgentPlatform

Most newsletters are a compromise. You subscribe because three or four articles a week hit the mark, but the rest is noise — sponsored content, tangential topics, someone else's editorial agenda. You have no say in the pacing, the depth, or what actually shows up. You either accept the package deal or unsubscribe entirely.

There is a better way.

PulseKeeper, paired with AgentPlatform, flips the model. You decide what goes in. You decide when it arrives. No ads. No filler. No algorithm trying to keep you engaged longer than you want to be.

---

## What You're Actually Building

The idea is straightforward: PulseKeeper acts as your personal content curator, pulling from the sources you care about on a schedule you define. AgentPlatform then picks that up and delivers it as a newsletter on whatever cadence makes sense for you — daily, twice a week, Sunday mornings. You set it, it runs.

The result is a newsletter that reflects your actual interests, not the interests of an advertiser or an editor with a word-count goal.

---

## Step 1: Build Your Source List in PulseKeeper

PulseKeeper lives in your Windows 11 system tray and supports more source types than you probably need:

- **RSS feeds** — standard blogs, news sites, anything with a feed
- **YouTube channels** — paste a channel URL or @handle, PulseKeeper resolves it automatically
- **Reddit** — subreddits via public RSS, no API key required
- **Podcasts** — episode titles and descriptions from any podcast RSS feed
- **Newsletters and blogs** — treated like RSS; paste the URL and PulseKeeper auto-discovers the feed
- **Web pages with CSS selector scraping** — this is the powerful one (more on this below)
- **Browser captures** — the companion Chrome/Edge extension lets you send any page, selection, or link directly to PulseKeeper from your browser

For most sources, you paste a URL and you're done. PulseKeeper handles feed discovery. No developer accounts, no API keys, no OAuth dance.

---

## The Web Scrape Feature: Surgical Precision

This is where PulseKeeper gets genuinely interesting for newsletter building.

Most sources — even good ones — publish far more than you want. A tech blog might cover ten topics you care about and fifteen you don't. Traditional RSS gives you everything or nothing.

PulseKeeper's webpage source type lets you point at a specific element on a page using a CSS selector. You target exactly the section that gets updated — a release notes table, a headline block, a pricing update — and PulseKeeper monitors only that. When it changes, you get it. When it doesn't change, you don't hear about it.

This means your newsletter can include things that have no RSS feed at all: a product changelog page, a research lab's latest publications section, a competitor's pricing page, a government data release. If it's a web page and it has a repeating structure, you can source from it.

Combined with change monitoring, PulseKeeper will only surface that content when something actually changes — so you're not re-reading the same static content every issue.

---

## Step 2: Set Your Mute Words and Per-Source Schedules

Before you export anything, two settings are worth configuring.

**Mute words** let you filter across all sources at once. If you're tracking AI news but don't want anything about cryptocurrency, add it to the mute list. Items containing those words won't make it into your digest regardless of the source.

**Per-source refresh intervals** let you pull from time-sensitive sources more frequently (hourly breaking news) and slower sources less often (weekly opinion pieces). The global schedule sets the default; individual sources can override it.

This is the kind of control that no third-party newsletter service gives you, because they're not built for one reader — they're built for thousands.

---

## Step 3: Export to AgentPlatform

Once your sources are configured and pulling content you actually want to read, go to the **Export** tab in PulseKeeper and export an AgentPlatform agent pack. This produces a ready-to-import JSON file that contains everything AgentPlatform needs to run PulseKeeper as an agent.

PulseKeeper includes a bridge script — `pk-bridge.js` — that AgentPlatform's Script Agent uses to fetch and render your digest. The export wires all of this up automatically.

In AgentPlatform, import the agent pack. From there, you configure delivery: how often the newsletter runs, where it goes, and in what format. HTML, Markdown, PDF — PulseKeeper generates all three, and AgentPlatform delivers whichever you prefer.

---

## Step 4: Set Your Delivery Schedule

This is the part that makes it feel like a real newsletter rather than a dashboard.

In AgentPlatform, you configure the agent's schedule. Daily at 7am. Monday and Thursday evenings. First thing Sunday morning. Whatever fits how you actually consume information.

The agent runs on that schedule, pulls the latest content from your PulseKeeper sources, renders it into your chosen format, and delivers it. You don't have to open PulseKeeper. You don't have to remember to check anything. It shows up when you told it to show up.

This is the combination that makes the whole thing work as a newsletter rather than an RSS reader. PulseKeeper is the editorial layer — you curate the sources. AgentPlatform is the delivery layer — it handles the scheduling and distribution. Neither one tries to do the other's job.

---

## What This Looks Like in Practice

Say you're a security researcher who wants a weekly briefing. Your PulseKeeper sources might include:

- Three RSS feeds from security blogs you trust
- A YouTube channel from a researcher you follow
- A web scrape of the CISA Known Exploited Vulnerabilities catalog (targeting just the recently-added table)
- A subreddit or two
- A web capture of a vendor's security advisories page

Mute words filter out topics outside your focus area. Per-source schedules pull the advisories page more frequently than the blogs. AgentPlatform delivers the digest every Friday afternoon.

That's a newsletter that didn't exist before, written entirely by sources you chose, arriving exactly when you want it. No subscription fee. No editorial board. No sponsored posts.

---

## Getting Started

- **PulseKeeper:** [github.com/rod-trent/PulseKeeper](https://github.com/rod-trent/PulseKeeper) — download the v1.0.0 installer, no Node.js required
- **AgentPlatform:** [github.com/rod-trent/AgentPlatform](https://github.com/rod-trent/AgentPlatform)

Both are free and open source. PulseKeeper runs on Windows 10/11. The installer handles everything — no developer setup needed to use it.

Start with a handful of sources. Get the digest looking the way you want it. Then export to AgentPlatform and set a delivery schedule. The whole setup takes less than an hour, and the newsletter you end up with will be more useful than anything you've subscribed to.
