'use strict';

// CISA Known Exploited Vulnerabilities (KEV) catalog — a single public JSON
// file, no key. Every entry is a CVE confirmed exploited in the wild, so each
// item is tagged severity:'critical'.
// https://www.cisa.gov/known-exploited-vulnerabilities-catalog
const { getJSON } = require('./httpJson');

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

/**
 * Fetch the CISA KEV catalog (most recently added first).
 * @param {object} source
 * @returns {ContentItem[]}
 */
async function fetchCisaKev(source) {
  const { maxItems = 25, name } = source;
  const data = await getJSON(KEV_URL);
  const vulns = data?.vulnerabilities || [];

  // Catalog is roughly chronological; newest dateAdded first.
  const sorted = [...vulns].sort((a, b) => String(b.dateAdded).localeCompare(String(a.dateAdded)));

  return sorted.slice(0, maxItems).map(v => {
    const id = v.cveID;
    const summary = [
      v.vendorProject && v.product ? `${v.vendorProject} ${v.product}` : '',
      v.shortDescription || '',
      v.requiredAction ? `Action: ${v.requiredAction}` : '',
      v.knownRansomwareCampaignUse && /known/i.test(v.knownRansomwareCampaignUse) ? '⚠ Known ransomware use.' : ''
    ].filter(Boolean).join(' — ');

    return {
      id: `kev:${source.id}:${id}`,
      sourceId: source.id,
      sourceName: name || 'CISA KEV',
      sourceType: 'cisaKev',
      title: `${id}${v.vulnerabilityName ? ` — ${v.vulnerabilityName}` : ''}`,
      description: summary.slice(0, 400),
      url: `https://nvd.nist.gov/vuln/detail/${id}`,
      author: 'CISA',
      publishedAt: v.dateAdded ? new Date(v.dateAdded).toISOString() : new Date().toISOString(),
      fetchedAt: new Date().toISOString(),
      // KEV = actively exploited → always critical
      severity: 'critical',
      iocs: { ips: [], domains: [], urls: [], md5: [], sha1: [], sha256: [], cves: [id], emails: [] }
    };
  });
}

module.exports = { fetchCisaKev };
