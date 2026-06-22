'use strict';

// Indicator-of-Compromise (IoC) extraction for security/malware-lab use.
// Pure, dependency-free. Parses IPs, domains, URLs, file hashes, CVE IDs and
// emails out of free text, with "defang" normalization (hxxp, [.], (dot)) that
// threat reports use to keep IoCs unclickable.

// ─── Regexes ────────────────────────────────────────────────────────────────
const RE = {
  ipv4:   /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/g,
  url:    /\bhttps?:\/\/[^\s"'<>)\]]+/gi,
  md5:    /\b[a-f0-9]{32}\b/gi,
  sha1:   /\b[a-f0-9]{40}\b/gi,
  sha256: /\b[a-f0-9]{64}\b/gi,
  cve:    /\bCVE-\d{4}-\d{4,7}\b/gi,
  email:  /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi,
  // Domain: label(s) + TLD; TLD validated against the allow-list below.
  domain: /\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}\b/gi
};

// Common TLDs — guards the domain regex against matching version strings,
// filenames, etc. (e.g. "config.json", "v1.2.3"). Not exhaustive by design;
// covers the TLDs that actually show up in threat intel.
const TLDS = new Set([
  'com','net','org','io','co','ru','cn','de','uk','info','biz','xyz','top','site',
  'online','club','live','app','dev','gov','edu','mil','int','eu','us','ca','au',
  'in','br','jp','fr','it','nl','se','no','fi','pl','ua','ir','tr','kr','tk','ml',
  'ga','cf','gq','su','cc','ws','pw','me','tv','sh','to','st','mobi','pro','name',
  'asia','space','website','tech','store','cloud','link','click','download','zip',
  'mov','work','support','win','stream','bid','loan','trade','date','party','review'
]);

// Strings that look like domains/IPs but should be dropped (false positives).
const NOISE_DOMAINS = new Set([
  'example.com','example.org','example.net','schema.org','www.w3.org','w3.org',
  'localhost'
]);
const NOISE_IPS = new Set(['0.0.0.0','127.0.0.1','255.255.255.255']);

// ─── Defang ─────────────────────────────────────────────────────────────────
// Reverse the obfuscation analysts apply so IoCs aren't live links.
function refang(text) {
  if (!text) return '';
  return String(text)
    .replace(/\bh(?:xx|XX)?p(s?)\b/gi, 'http$1')   // hxxp/hxxps/hXXp → http(s)
    .replace(/\[\s*\.\s*\]/g, '.')                  // [.] → .
    .replace(/\(\s*\.\s*\)/g, '.')                  // (.) → .
    .replace(/\{\s*\.\s*\}/g, '.')                  // {.} → .
    .replace(/\[\s*dot\s*\]/gi, '.')                // [dot] → .
    .replace(/\(\s*dot\s*\)/gi, '.')                // (dot) → .
    .replace(/\s+dot\s+/gi, '.')                    // " dot " → .
    .replace(/\[\s*:\s*\]/g, ':')                   // [:] → :
    .replace(/\[\s*@\s*\]/g, '@')                   // [@] → @
    .replace(/\[\s*at\s*\]/gi, '@');                // [at] → @
}

function uniq(arr) {
  return [...new Set(arr)];
}

function matchAll(text, re) {
  const m = text.match(re);
  return m ? m : [];
}

/**
 * Extract IoCs from a blob of text.
 * @param {string} text
 * @returns {{ips:string[],domains:string[],urls:string[],md5:string[],sha1:string[],sha256:string[],cves:string[],emails:string[]}}
 */
function extractIoCs(text) {
  const t = refang(text);

  // Hashes: match longest-first so a sha256 isn't also picked up as md5/sha1.
  const sha256 = uniq(matchAll(t, RE.sha256).map(h => h.toLowerCase()));
  const sha256Set = new Set(sha256);
  const sha1 = uniq(matchAll(t, RE.sha1).map(h => h.toLowerCase()))
    .filter(h => !sha256.some(s => s.includes(h)));
  const md5 = uniq(matchAll(t, RE.md5).map(h => h.toLowerCase()))
    .filter(h => !sha256Set.has(h) && !sha1.includes(h) && !sha256.some(s => s.includes(h)));

  const urls = uniq(matchAll(t, RE.url));
  const emails = uniq(matchAll(t, RE.email).map(e => e.toLowerCase()));
  const cves = uniq(matchAll(t, RE.cve).map(c => c.toUpperCase()));

  const ips = uniq(matchAll(t, RE.ipv4)).filter(ip => !NOISE_IPS.has(ip));

  // Domains: validate TLD, drop noise, and drop hosts already inside emails
  // (the email domain is captured by the email IoC, not as a standalone domain).
  const emailDomains = new Set(emails.map(e => e.split('@')[1]));
  const domains = uniq(matchAll(t, RE.domain).map(d => d.toLowerCase()))
    .filter(d => {
      const tld = d.split('.').pop();
      return TLDS.has(tld) && !NOISE_DOMAINS.has(d) && !emailDomains.has(d);
    });

  return { ips, domains, urls, md5, sha1, sha256, cves, emails };
}

function isEmpty(iocs) {
  return Object.values(iocs).every(a => !a || a.length === 0);
}

function totalCount(iocs) {
  return Object.values(iocs).reduce((n, a) => n + (a ? a.length : 0), 0);
}

// ─── Severity heuristic ──────────────────────────────────────────────────────
const SEVERITY_RANK = { critical: 3, high: 2, medium: 1, info: 0 };

// Map a numeric CVSS base score to a severity band (CVSS v3 ranges).
function severityFromCvss(cvss) {
  const n = Number(cvss);
  if (!Number.isFinite(n)) return null;
  if (n >= 9.0) return 'critical';
  if (n >= 7.0) return 'high';
  if (n >= 4.0) return 'medium';
  return 'info';
}

const CRITICAL_KW = /\b(?:zero[\s-]?day|0[\s-]?day|in the wild|actively exploited|exploited in|ransomware|wormable|unauthenticated rce)\b/i;
const HIGH_KW     = /\b(?:rce|remote code execution|exploit|critical|privilege escalation|backdoor|c2|command[\s-]?and[\s-]?control|malware|trojan|botnet)\b/i;
const MEDIUM_KW   = /\b(?:vulnerabilit|cve-|phishing|spoof|xss|sql injection|dos|denial of service|advisory|patch)\b/i;

/**
 * Best-effort severity for an item. An explicit numeric CVSS wins; otherwise a
 * keyword heuristic over title+description; otherwise null (no badge shown).
 * @param {{title?:string,description?:string,cvss?:number}} item
 * @param {object} iocs  pre-extracted IoCs (used so a bare CVE bumps to medium)
 * @returns {'critical'|'high'|'medium'|'info'|null}
 */
function scoreSeverity(item, iocs) {
  if (item && item.cvss != null) {
    const s = severityFromCvss(item.cvss);
    if (s) return s;
  }
  const text = `${item?.title || ''} ${item?.description || ''}`;
  if (CRITICAL_KW.test(text)) return 'critical';
  if (HIGH_KW.test(text)) return 'high';
  if (MEDIUM_KW.test(text) || (iocs && iocs.cves.length)) return 'medium';
  return null;
}

/**
 * Enrich a ContentItem in place: attach `.iocs`, `.iocCount`, and `.severity`.
 * Respects any severity/cvss a structured feed already set. Safe to call twice.
 * @param {object} item
 * @returns {object} the same item
 */
function enrichItem(item) {
  if (!item || typeof item !== 'object') return item;

  // Merge regex-extracted IoCs with any the feed already provided (structured
  // feeds like Abuse.ch pre-fill exact IoCs — keep those, add anything in text).
  const text = `${item.title || ''}\n${item.description || ''}\n${item.content || ''}`;
  const extracted = extractIoCs(text);
  const seeded = item.iocs && typeof item.iocs === 'object' ? item.iocs : {};

  const merged = {};
  for (const key of Object.keys(extracted)) {
    merged[key] = uniq([...(seeded[key] || []), ...extracted[key]]);
  }
  item.iocs = merged;
  item.iocCount = totalCount(merged);

  // Severity: don't downgrade a feed-supplied severity.
  const computed = scoreSeverity(item, merged);
  if (item.severity) {
    if (computed && SEVERITY_RANK[computed] > (SEVERITY_RANK[item.severity] ?? -1)) {
      item.severity = computed;
    }
  } else if (computed) {
    item.severity = computed;
  }

  return item;
}

module.exports = {
  extractIoCs,
  enrichItem,
  scoreSeverity,
  severityFromCvss,
  refang,
  isEmpty,
  totalCount,
  SEVERITY_RANK
};
