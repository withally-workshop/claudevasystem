const Redis = require('ioredis');

let client;

function getRedis() {
  if (!client) {
    client = new Redis(process.env.UPSTASH_REDIS_URL, {
      tls: {},
      maxRetriesPerRequest: 3,
      lazyConnect: false,
    });
    client.on('error', (err) => console.error('[Redis]', err.message));
    client.on('connect', () => console.log('[Redis] connected'));
  }
  return client;
}

module.exports = { getRedis };
