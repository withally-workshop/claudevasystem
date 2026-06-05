const { customAlphabet } = require('nanoid');
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 12);
const { getRedis } = require('./redis');

const TTL = parseInt(process.env.SESSION_TTL_SECONDS || '86400', 10);
const SOCKET_TTL = 30;

function metaKey(id) { return `session:${id}:meta`; }
function historyKey(id) { return `session:${id}:history`; }
function socketKey(id) { return `session:${id}:socket`; }

async function createSession(email) {
  const id = nanoid();
  const now = new Date().toISOString();
  const redis = getRedis();
  await redis.hset(metaKey(id),
    'id', id,
    'email', email || '',
    'owner', 'bot',
    'escalatedAt', '',
    'slackThreadTs', '',
    'slackChannel', '',
    'createdAt', now,
    'lastActivityAt', now,
  );
  await redis.expire(metaKey(id), TTL);
  return id;
}

async function getSession(id) {
  const redis = getRedis();
  const data = await redis.hgetall(metaKey(id));
  if (!data || !data.id) return null;
  return data;
}

async function updateSessionEmail(id, email) {
  const redis = getRedis();
  await redis.hset(metaKey(id), 'email', email);
}

async function setOwner(id, owner) {
  const redis = getRedis();
  const now = new Date().toISOString();
  await redis.hset(metaKey(id), 'owner', owner, 'lastActivityAt', now);
  if (owner === 'human') await redis.hset(metaKey(id), 'escalatedAt', now);
}

async function setSlackThread(id, { threadTs, channel }) {
  const redis = getRedis();
  await redis.hset(metaKey(id), 'slackThreadTs', threadTs, 'slackChannel', channel);
}

async function appendHistory(id, { role, content }) {
  const redis = getRedis();
  const entry = JSON.stringify({ role, content, ts: new Date().toISOString() });
  await redis.rpush(historyKey(id), entry);
  await redis.expire(historyKey(id), TTL);
}

async function getHistory(id) {
  const redis = getRedis();
  const raw = await redis.lrange(historyKey(id), 0, -1);
  return raw.map(e => { try { return JSON.parse(e); } catch { return null; } }).filter(Boolean);
}

async function registerSocket(id, socketId) {
  const redis = getRedis();
  await redis.set(socketKey(id), socketId, 'EX', SOCKET_TTL);
}

async function getSocketId(id) {
  const redis = getRedis();
  return redis.get(socketKey(id));
}

async function touchSession(id) {
  const redis = getRedis();
  const now = new Date().toISOString();
  await redis.hset(metaKey(id), 'lastActivityAt', now);
  await redis.expire(metaKey(id), TTL);
}

module.exports = {
  createSession,
  getSession,
  updateSessionEmail,
  setOwner,
  setSlackThread,
  appendHistory,
  getHistory,
  registerSocket,
  getSocketId,
  touchSession,
};
