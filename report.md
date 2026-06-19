# Project Analysis: PulseKeeper

**Prepared by:** Vinit Girdhar
**Team:** Malware Analysis, Sequretek
**Date:** 4 June 2026
**Source project:** https://github.com/rod-trent/PulseKeeper (Open-source, MIT licence)

---

## Executive Summary

PulseKeeper is an open-source **content aggregator with built-in AI summarization**. It collects items from web feeds (RSS, Reddit, YouTube, web pages, and browser clips) and uses a Large Language Model — which can run **fully locally via Ollama** — to turn them into a clean daily digest (HTML / Markdown / PDF).

It is best understood as an **intelligence / awareness layer**, not a security operations tool. It does **one** job: gather open-source intelligence (OSINT) and summarize it on-premises. It does **not** perform malware detonation, dark-web crawling, email parsing, or network-scan correlation.

Because it performs only this single function, the right question for each of our team's domains is: *"Does an automated, locally-summarized OSINT feed add value here — strongly, moderately, or not at all?"* This report answers that domain by domain, and recommends a phased pilot focused on the strongest-fit areas.

---

## 1. What PulseKeeper Is — and Is Not

| It **is** | It is **not** |
|---|---|
| A Windows tray app (Electron / Node.js) | A Threat Intelligence Platform (TIP) |
| An aggregator of RSS, Reddit, YouTube, web pages, browser captures | A malware sandbox or analysis engine |
| A local AI summarizer (Ollama / Anthropic / OpenAI / xAI) | A dark-web / Tor / paste-site crawler |
| A digest generator (HTML / Markdown / PDF) | An email / header analysis tool |
| Free, open-source, on-premises | A Shodan / GreyNoise / honeypot correlation engine |

**Confirmed source types** (verified in the code, `src/main/sources/index.js`):
RSS / Atom · Podcast · YouTube · Reddit · Newsletter · Blog · Web Page (CSS-selector scrape, with *alert-on-change*) · Browser Capture (Chrome/Edge extension).

There are **no** other source types. Any capability beyond ingesting and summarizing these feeds is outside the tool's scope.

---

## 2. Core Capability

> **PulseKeeper collects OSINT from web feeds and summarizes it with a local LLM into a scheduled digest — entirely on our own infrastructure.**

The single most valuable property for a security organisation: with the **Ollama (local)** provider, summarization runs on `http://localhost:11434` and **no intelligence ever leaves our network**. No API keys are required for collection.

In every domain below, PulseKeeper's role is the same — *feed that team timely, summarized context.* Only the **strength of fit** changes.

---

## 3. Domain-by-Domain Fit Assessment

| Domain | Fit | Role PulseKeeper can realistically play |
|---|:---:|---|
| Threat Portal | 🟢 **Strong** | Automated aggregation + summarization engine for the portal's briefings |
| Sandbox / Malware Analysis | 🟡 **Moderate** | Pre-analysis context feed on malware families and new research |
| Phishing (Campaign & Drill) | 🟡 **Moderate** | Lure-trend awareness feed; can *inform* drill content |
| Decoy / Honeypots | 🟠 **Weak** | Scanning / vulnerability-trend awareness only |
| Email Analysis | 🟠 **Weak** | Active-campaign context only — cannot ingest email |
| Dark Web | 🔴 **Poor** | Surface-web *news about* leaks only — cannot reach the dark web |

### 3.1 Threat Portal — 🟢 Strong fit

This is exactly what PulseKeeper was built to do: pull from many sources and produce an aggregated, summarized briefing.

- **Role:** Primary intel-aggregation and morning-briefing engine feeding the portal.
- **Suggested sources:** CISA advisories, vendor threat blogs (Microsoft MSTIC, Mandiant, Cisco Talos, Unit 42, Securelist), `r/netsec`, `r/threatintel`, selected researcher YouTube channels.
- **Output:** Scheduled HTML / PDF digest; optional automation via AgentPlatform.

### 3.2 Sandbox / Malware Analysis — 🟡 Moderate fit

PulseKeeper cannot detonate or analyze a sample. It **can** give analysts a daily feed of public intel about malware families so they know what to look for before/while detonating.

- **Role:** Pre-analysis context and threat-awareness feed.
- **Suggested sources:** abuse.ch feeds (MalwareBazaar / ThreatFox), Securelist, family-specific researcher blogs, malware-analysis YouTube channels.
- **Boundary:** Behavioural analysis of the binary still happens in our sandbox tooling — PulseKeeper only summarizes *reports*, never *samples*.

### 3.3 Phishing (Campaign & Drill) — 🟡 Moderate fit

- **Role:** Awareness of trending phishing lures and themes. With a custom digest prompt, the local LLM can *summarize* current lures to **inform** internal drill content — with mandatory human review.
- **Suggested sources:** APWG reports, anti-phishing vendor blogs, and PhishTank / OpenPhish feeds *if* they parse as RSS (see caveat in §5).
- **Boundary:** The browser extension only captures page **text** — it is **not** a safe sandbox for visiting live phishing sites, and PulseKeeper is **not** a phishing-simulation platform.

### 3.4 Decoy / Honeypots — 🟠 Weak fit

- **Role:** Awareness of which CVEs and exploits are being mass-scanned, per public reporting.
- **Suggested sources:** GreyNoise blog, Shodan blog, CVE / exploit feeds.
- **Boundary:** PulseKeeper has **no** Shodan / GreyNoise API integration. Correlating global scan data against our own decoy hits remains a **manual** task or needs a dedicated tool.

### 3.5 Email Analysis — 🟠 Weak fit

- **Role:** Context on active malspam / BEC campaigns so the email team knows what is circulating.
- **Suggested sources:** abuse.ch URLhaus, malspam-tracking blogs.
- **Boundary:** PulseKeeper **cannot ingest emails, parse headers, or detect spoofing.** There is no email source type. The actual analysis needs our existing email tooling.

### 3.6 Dark Web — 🔴 Poor fit

- **Role:** Surface-web *news coverage* of breaches and leaks only.
- **Suggested sources:** Breach-notification news feeds, vendor leak-coverage blogs.
- **Boundary:** PulseKeeper **cannot access Tor / onion services, paste sites, or Telegram.** It performs no credential-leak detection. For genuine dark-web monitoring, a purpose-built tool is required.

---

## 4. Recommended Implementation (for strong / moderate fits)

A low-risk pilot focused on the **Threat Portal**, **Sandbox**, and **Phishing** domains:

1. **Deploy** PulseKeeper on a dedicated analyst workstation (`npm install`, `npm start`).
2. **Install Ollama** locally and pull a small model (e.g. `llama3.2`); point PulseKeeper's AI provider to `http://localhost:11434/v1` so all summarization stays on-premises.
3. **Add curated security feeds** per domain (see §3); enable *alert-on-change* on advisory pages that lack RSS.
4. **Schedule** auto-refresh and generate a **morning digest** (HTML / PDF).
5. *(Optional)* **Automate** the collect → summarize pipeline via AgentPlatform using the exported agent pack (`scripts/pk-bridge.js`).

---

## 5. Limitations & Security Considerations

- **Not a TIP:** No IOC extraction, no STIX/TAXII, no enrichment, correlation, or MISP integration.
- **LLM hallucination:** AI summaries can be inaccurate — treat every digest as a *pointer*, and always verify at the original source.
- **Feed-format caveat:** Some intel sources (PhishTank, OpenPhish, abuse.ch) publish *data exports*, not always clean RSS. Each must be tested; some may need the web-scraper source type or may not import at all.
- **Deployment security review required before any production use:**
  - Runs a local HTTP capture server on **port 7828**.
  - Fetches and parses remote web content (scraping / RSS).
  - Uses an **unpacked** Chrome/Edge browser extension.
  - These should be reviewed and, ideally, run in a contained/segmented environment given our threat model.

---

## 6. Proof of Concept (PoC)

**Goal:** Demonstrate PulseKeeper collecting real security feeds and producing a locally-summarized digest.

**Architecture (diagram):**

```
Security OSINT sources                 PulseKeeper                 Output
(RSS / Reddit / YouTube /   ──▶   Collector + scheduler   ──▶   Daily digest
 web-page scrape)                        │                       (HTML / PDF)
                                         ▼                            │
                              Local LLM (Ollama, on-prem)             ▼
                                    summarization              Analyst / Threat Portal
```

> *[Insert your architecture diagram here]*

**PoC evidence:**

> *[Insert screenshot of a generated digest from real security feeds, summarized via local Ollama]*

**Steps performed:**
1. Installed and launched PulseKeeper.
2. Configured Ollama (local) as the AI provider.
3. Added sample security feeds (CISA, a vendor threat blog, `r/netsec`).
4. Triggered a refresh and generated a digest.

---

## 7. Conclusion & Recommendation

PulseKeeper is a lightweight, free, on-premises **OSINT collection and summarization layer**. It is a genuinely useful *bolt-on* to domains that benefit from automated threat-news awareness — **strongest for the Threat Portal**, and a useful context feed for **Sandbox** and **Phishing**. For **Dark Web, Email, and Honeypots**, the core capability must come from dedicated tooling; PulseKeeper can only add surrounding context.

**Recommendation:** Run a **2-week pilot** on the Threat Portal domain using a local Ollama model. If the digests prove useful and the security review passes, extend curated feeds to the Sandbox and Phishing teams. Do **not** position it as a replacement for any domain's existing technical tooling.
ev a made a diag gram of this   


