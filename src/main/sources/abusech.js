'use strict';

// Abuse.ch threat-intel feeds — public, keyless. One source type with a `feed`
// selector. Each feed is already structured, so we pre-fill exact IoCs rather
// than relying on the regex extractor.
//   urlhaus      — recently submitted malware-distribution URLs
//   threatfox    — recent IOCs (IPs, domains, URLs, hashes) with malware tags
//   feodo        — Feodo Tracker botnet C2 IP blocklist
const { getJSON, getText } = require('./httpJson');

const FEEDS = {
  urlhaus:   'https://urlhaus.abuse.ch/downloads/json_recent/',
  threatfox: 'https://threatfox.abuse.ch/export/json/recent/',
  feodo:     'https://feodotracker.abuse.ch/downloads/ipblocklist.json'
};

const emptyIocs = () => ({ ips: [], domains: [], urls: [], md5: [], sha1: [], sha256: [], cves: [], emails: [] });

async function fetchAbusech(source) {
  const { config = {}, maxItems = 30, name } = source;
  const feed = config.feed || 'urlhaus';
  if (!FEEDS[feed]) throw new Error(`Unknown Abuse.ch feed: ${feed}`);

  switch (feed) {
    case 'urlhaus':   return fetchUrlhaus(source, maxItems, name);
    case 'threatfox': return fetchThreatfox(source, maxItems, name);
    case 'feodo':     return fetchFeodo(source, maxItems, name);
    default:          return [];
  }
}

// ── URLhaus: { "<id>": [ { url, dateadded, threat, tags, ... } ], ... } ──────
async function fetchUrlhaus(source, maxItems, name) {
  const data = await getJSON(FEEDS.urlhaus);
  const rows = [];
  for (const arr of Object.values(data || {})) {
    if (Array.isArray(arr) && arr[0]) rows.push(arr[0]);
  }
  rows.sort((a, b) => String(b.dateadded).localeCompare(String(a.dateadded)));

  return rows.slice(0, maxItems).map(r => {
    const iocs = emptyIocs();
    if (r.url) iocs.urls.push(r.url);
    const host = hostFromUrl(r.url);
    if (host) (isIp(host) ? iocs.ips : iocs.domains).push(host);
    const tags = Array.isArray(r.tags) ? r.tags.join(', ') : '';
    return {
      id: `abusech:${source.id}:urlhaus:${r.id || r.url}`,
      sourceId: source.id,
      sourceName: name || 'URLhaus',
      sourceType: 'abusech',
      title: `Malware URL${r.threat ? ` (${r.threat})` : ''}: ${host || r.url}`,
      description: [r.url, tags && `Tags: ${tags}`].filter(Boolean).join(' — ').slice(0, 400),
      url: r.urlhaus_reference || r.url || '',
      author: 'URLhaus',
      publishedAt: r.dateadded ? new Date(r.dateadded).toISOString() : new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      severity: 'high',
      iocs
    };
  });
}

// ── ThreatFox: { data: [ { ioc, ioc_type, malware, ... } ] } ────────────────
async function fetchThreatfox(source, maxItems, name) {
  const data = await getJSON(FEEDS.threatfox);
  // ThreatFox shape varies (sometimes keyed object, sometimes {data:[...]}).
  let rows = [];
  if (Array.isArray(data?.data)) rows = data.data;
  else if (data && typeof data === 'object') {
    for (const v of Object.values(data)) {
      if (Array.isArray(v)) rows.push(...v);
      else if (v && typeof v === 'object') rows.push(v);
    }
  }
  rows.sort((a, b) => String(b.first_seen_utc || '').localeCompare(String(a.first_seen_utc || '')));

  return rows.slice(0, maxItems).map((r, i) => {
    const iocs = emptyIocs();
    placeIoc(iocs, r.ioc_type, r.ioc);
    return {
      id: `abusech:${source.id}:threatfox:${r.id || r.ioc || i}`,
      sourceId: source.id,
      sourceName: name || 'ThreatFox',
      sourceType: 'abusech',
      title: `${r.malware_printable || r.malware || 'IOC'}: ${r.ioc || ''}`.slice(0, 200),
      description: [r.ioc, r.threat_type_desc, r.confidence_level != null && `Confidence: ${r.confidence_level}%`]
        .filter(Boolean).join(' — ').slice(0, 400),
      url: r.reference || (r.id ? `https://threatfox.abuse.ch/ioc/${r.id}/` : ''),
      author: 'ThreatFox',
      publishedAt: r.first_seen_utc ? new Date(r.first_seen_utc).toISOString() : new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      severity: 'high',
      iocs
    };
  });
}

// ── Feodo Tracker: [ { ip_address, port, malware, first_seen, ... } ] ───────
async function fetchFeodo(source, maxItems, name) {
  let arr;
  try { arr = await getJSON(FEEDS.feodo); }
  catch { arr = JSON.parse(await getText(FEEDS.feodo)); }
  const rows = Array.isArray(arr) ? arr : [];
  rows.sort((a, b) => String(b.first_seen || '').localeCompare(String(a.first_seen || '')));

  return rows.slice(0, maxItems).map((r, i) => {
    const iocs = emptyIocs();
    if (r.ip_address) iocs.ips.push(r.ip_address);
    return {
      id: `abusech:${source.id}:feodo:${r.ip_address || i}:${r.port || ''}`,
      sourceId: source.id,
      sourceName: name || 'Feodo Tracker',
      sourceType: 'abusech',
      title: `Botnet C2: ${r.ip_address}${r.port ? `:${r.port}` : ''}${r.malware ? ` (${r.malware})` : ''}`,
      description: [
        r.ip_address && `IP ${r.ip_address}`,
        r.malware && `Malware: ${r.malware}`,
        r.status && `Status: ${r.status}`
      ].filter(Boolean).join(' — ').slice(0, 400),
      url: 'https://feodotracker.abuse.ch/browse/',
      author: 'Feodo Tracker',
      publishedAt: r.first_seen ? new Date(r.first_seen).toISOString() : new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      severity: 'critical',
      iocs
    };
  });
}

// ── helpers ─────────────────────────────────────────────────────────────────
function placeIoc(iocs, type, value) {
  if (!value) return;
  const t = String(type || '').toLowerCase();
  if (t.includes('ip')) iocs.ips.push(String(value).split(':')[0]);
  else if (t.includes('url')) iocs.urls.push(value);
  else if (t.includes('domain') || t.includes('host')) iocs.domains.push(value);
  else if (t.includes('md5')) iocs.md5.push(String(value).toLowerCase());
  else if (t.includes('sha1')) iocs.sha1.push(String(value).toLowerCase());
  else if (t.includes('sha256')) iocs.sha256.push(String(value).toLowerCase());
  else iocs.domains.push(value); // best-effort fallback
}

function hostFromUrl(url) {
  try { return new URL(url).hostname; } catch { return null; }
}
function isIp(host) {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host);
}

module.exports = { fetchAbusech };
