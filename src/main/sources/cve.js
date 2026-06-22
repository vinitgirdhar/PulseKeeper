'use strict';

// NVD CVE 2.0 feed — public, keyless (rate-limited to ~5 req/30s without a key).
// Docs: https://nvd.nist.gov/developers/vulnerabilities
const { getJSON } = require('./httpJson');
const { severityFromCvss } = require('../iocExtractor');

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';

/**
 * Fetch recent CVEs from NVD, optionally filtered by keyword and minimum CVSS.
 * @param {object} source
 * @returns {ContentItem[]}
 */
async function fetchCVE(source) {
  const { config = {}, maxItems = 20, name } = source;
  const keyword = (config.keyword || '').trim();
  const minCvss = parseFloat(config.minCvss);
  const results = Math.min(parseInt(config.results, 10) || maxItems || 20, 100);

  const params = new URLSearchParams();
  params.set('resultsPerPage', String(results));
  // Pull the most recently modified CVEs (last 14 days) so the feed stays fresh.
  const end = new Date();
  const start = new Date(end.getTime() - 14 * 86400000);
  params.set('lastModStartDate', start.toISOString());
  params.set('lastModEndDate', end.toISOString());
  if (keyword) params.set('keywordSearch', keyword);
  if (Number.isFinite(minCvss)) {
    // NVD filters by qualitative severity, not raw score — map the threshold.
    params.set('cvssV3Severity', minCvss >= 9 ? 'CRITICAL' : minCvss >= 7 ? 'HIGH' : minCvss >= 4 ? 'MEDIUM' : 'LOW');
  }

  const data = await getJSON(`${NVD_BASE}?${params.toString()}`);
  const vulns = data?.vulnerabilities || [];

  return vulns.slice(0, results).map(({ cve }) => {
    const id = cve.id;
    const desc = (cve.descriptions || []).find(d => d.lang === 'en')?.value || '';
    const cvss = extractCvss(cve.metrics);
    const sevBand = severityFromCvss(cvss) || (cvss == null ? null : 'info');
    const ref = (cve.references || [])[0]?.url || `https://nvd.nist.gov/vuln/detail/${id}`;

    return {
      id: `cve:${source.id}:${id}`,
      sourceId: source.id,
      sourceName: name || 'NVD CVE Feed',
      sourceType: 'cve',
      title: `${id}${cvss != null ? ` — CVSS ${cvss}` : ''}`,
      description: desc.slice(0, 400),
      url: `https://nvd.nist.gov/vuln/detail/${id}`,
      author: 'NVD',
      publishedAt: cve.published || cve.lastModified || new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      // Security extras consumed by iocExtractor.enrichItem / Threats tab / badges
      cvss,
      severity: sevBand || undefined,
      iocs: { ips: [], domains: [], urls: ref ? [ref] : [], md5: [], sha1: [], sha256: [], cves: [id], emails: [] }
    };
  });
}

// NVD nests CVSS under metrics.cvssMetricV31 / V30 / V2 — take the highest base score available.
function extractCvss(metrics) {
  if (!metrics) return null;
  const buckets = [metrics.cvssMetricV31, metrics.cvssMetricV30, metrics.cvssMetricV2].filter(Boolean);
  let best = null;
  for (const bucket of buckets) {
    for (const m of bucket) {
      const score = m?.cvssData?.baseScore;
      if (typeof score === 'number' && (best == null || score > best)) best = score;
    }
  }
  return best;
}

module.exports = { fetchCVE };
