'use strict';

// X / Twitter via Twitter API v2
// Requires a Bearer Token from developer.twitter.com
const https = require('https');

const API_BASE = 'https://api.twitter.com/2';

function apiRequest(path, bearerToken) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + path);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${bearerToken}`,
        'User-Agent': 'PersonalContentBuilder/1.0'
      }
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.errors || parsed.error) {
            reject(new Error(parsed.errors?.[0]?.message || parsed.error || 'API error'));
          } else {
            resolve(parsed);
          }
        } catch (e) {
          reject(e);
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Request timeout')); });
    req.end();
  });
}

/**
 * Fetch tweets from a user's timeline or search query
 */
async function fetchTwitter(source) {
  const { config, maxItems = 20, name } = source;

  if (!config?.bearerToken) {
    throw new Error('X/Twitter source requires a Bearer Token. Get one at developer.twitter.com');
  }

  let tweets = [];

  if (config.username) {
    // Look up user ID first
    const userRes = await apiRequest(
      `/users/by/username/${encodeURIComponent(config.username.replace('@', ''))}?user.fields=name,profile_image_url`,
      config.bearerToken
    );
    const userId = userRes.data?.id;
    if (!userId) throw new Error(`User @${config.username} not found`);

    const timelineRes = await apiRequest(
      `/users/${userId}/tweets?max_results=${Math.min(maxItems, 100)}&tweet.fields=created_at,public_metrics,attachments&expansions=attachments.media_keys&media.fields=preview_image_url,url`,
      config.bearerToken
    );
    tweets = timelineRes.data || [];

  } else if (config.searchQuery) {
    const searchRes = await apiRequest(
      `/tweets/search/recent?query=${encodeURIComponent(config.searchQuery)}&max_results=${Math.min(maxItems, 100)}&tweet.fields=created_at,author_id,public_metrics`,
      config.bearerToken
    );
    tweets = searchRes.data || [];
  } else if (config.listId) {
    const listRes = await apiRequest(
      `/lists/${config.listId}/tweets?max_results=${Math.min(maxItems, 100)}&tweet.fields=created_at,author_id,public_metrics`,
      config.bearerToken
    );
    tweets = listRes.data || [];
  } else {
    throw new Error('X/Twitter source needs username, searchQuery, or listId');
  }

  return tweets.slice(0, maxItems).map(tweet => ({
    id: `twitter:${source.id}:${tweet.id}`,
    sourceId: source.id,
    sourceName: name || (config.username ? `@${config.username}` : 'X/Twitter'),
    sourceType: 'twitter',
    title: tweet.text.slice(0, 100) + (tweet.text.length > 100 ? '…' : ''),
    description: tweet.text,
    url: `https://x.com/i/web/status/${tweet.id}`,
    thumbnail: null,
    author: config.username || '',
    publishedAt: tweet.created_at || new Date().toISOString(),
    metrics: tweet.public_metrics || null,
    fetchedAt: new Date().toISOString()
  }));
}

module.exports = { fetchTwitter };
