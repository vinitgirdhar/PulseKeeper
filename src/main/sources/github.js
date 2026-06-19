'use strict';

const { fetchRSS } = require('./rss');

// GitHub exposes Atom feeds for repo activity — no API key required.
// Converts a human-readable repo/user URL into the appropriate feed URL.
function resolveGitHubFeedUrl(config) {
  const { repoUrl, feedType = 'releases' } = config;
  if (!repoUrl) throw new Error('GitHub source requires a Repository URL');

  // Strip trailing slash and extract owner/repo
  const clean = repoUrl.trim().replace(/\/$/, '');

  // Accept full URLs or "owner/repo" shorthand
  let ownerRepo;
  const match = clean.match(/github\.com\/([^/]+\/[^/]+)/);
  if (match) {
    ownerRepo = match[1].replace(/\.git$/, '');
  } else if (/^[^/]+\/[^/]+$/.test(clean)) {
    ownerRepo = clean;
  } else {
    throw new Error(`Could not parse GitHub repo from: ${repoUrl}`);
  }

  switch (feedType) {
    case 'releases':
      return `https://github.com/${ownerRepo}/releases.atom`;
    case 'commits':
      return `https://github.com/${ownerRepo}/commits.atom`;
    case 'tags':
      return `https://github.com/${ownerRepo}/tags.atom`;
    default:
      return `https://github.com/${ownerRepo}/releases.atom`;
  }
}

async function fetchGitHub(source) {
  const feedUrl = resolveGitHubFeedUrl(source.config);
  const proxied = { ...source, config: { ...source.config, url: feedUrl } };
  const items = await fetchRSS(proxied);
  // Re-tag sourceType so the digest/renderer can distinguish GitHub items
  return items.map(item => ({ ...item, sourceType: 'github' }));
}

module.exports = { fetchGitHub };
