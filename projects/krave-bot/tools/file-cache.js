'use strict';

// Shared in-memory cache for file data downloaded at intake time.
// Keyed by url_private — populated in server.js buildUserContent,
// consumed by slack_download_file tool to avoid re-downloading stale URLs.
const cache = new Map();

function store(urlPrivate, base64) {
  cache.set(urlPrivate, base64);
}

function retrieve(urlPrivate) {
  return cache.get(urlPrivate) || null;
}

module.exports = { store, retrieve };
