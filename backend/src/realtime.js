// Real time: when something changes, every open screen that may see it is told at once.
//
// How it works
// - Browsers keep one connection open to GET /api/events (Server-Sent Events).
// - A change calls publish({ topics, schoolId, userIds }). It goes through PostgreSQL NOTIFY,
//   so it reaches every server process (works with PM2 cluster or several servers).
// - Each process sends it to its own connected browsers that are allowed to see it.
// - The message only says WHAT changed (e.g. "user", "stock"), never the data itself.
//   The screen then reloads its data through the normal API, which checks permissions as usual.
const { Client } = require('pg');
const db = require('./db');
const { ROLES } = require('./auth/roles');

const CHANNEL = 'musabe_events';
const clients = new Set(); // { res, user, sessionId }
let listener = null;
let ready = false;

function send(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* closed */ }
}

// Who may receive an event:
// - the people named in userIds (the one who did it, the one it was done to)
// - administration (all-schools) accounts, for everything
// - staff of the school it happened in
function allowed(c, evt) {
  if (evt.userIds?.includes(c.user.id)) return true;
  if (evt.onlyUsers) return false;
  if (ROLES[c.user.role]?.scope === 'all') return true;
  return evt.schoolId != null && evt.schoolId === c.user.school_id;
}

async function deliver(evt) {
  if (evt.topics.includes('signout')) return checkSessions(evt.userIds);
  for (const c of clients) if (allowed(c, evt)) send(c, 'change', { topics: evt.topics });
}

// Close the live connection of any browser whose session no longer exists
// (signed out elsewhere, switched off, password reset). Its screen then goes to sign-in.
async function checkSessions(userIds) {
  const list = [...clients].filter((c) => !userIds || userIds.includes(c.user.id));
  if (!list.length) return;
  const alive = new Set((await db('sessions').whereIn('id', list.map((c) => c.sessionId))
    .andWhere('expires_at', '>', db.fn.now()).pluck('id')));
  for (const c of list) {
    if (!alive.has(c.sessionId)) { send(c, 'signout', {}); c.res.end(); clients.delete(c); }
  }
}

async function listen() {
  const cfg = db.client.config.connection;
  const client = new Client(typeof cfg === 'string' ? { connectionString: cfg } : cfg);
  const retry = () => { ready = false; listener = null; setTimeout(listen, 3000); };
  client.on('error', () => { client.end().catch(() => {}); });
  client.on('end', retry);
  client.on('notification', (m) => {
    try { deliver(JSON.parse(m.payload)).catch(() => {}); } catch { /* bad payload */ }
  });
  try {
    await client.connect();
    await client.query(`LISTEN ${CHANNEL}`);
    listener = client; ready = true;
  } catch {
    client.removeAllListeners('end');
    retry();
  }
}

// Send an event. Inside a transaction it waits until the change is saved.
function publish(evt, trx) {
  const e = { topics: evt.topics, schoolId: evt.schoolId ?? null, userIds: (evt.userIds || []).filter(Boolean), onlyUsers: !!evt.onlyUsers };
  const go = () => (ready
    ? db.raw('select pg_notify(?, ?)', [CHANNEL, JSON.stringify(e)]).catch(() => deliver(e))
    : deliver(e)).catch(() => {});
  if (trx && trx.executionPromise) trx.executionPromise.then(go, () => {});
  else go();
}

// GET /api/events
function stream(req, res) {
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // Nginx: do not hold the messages back
  });
  res.flushHeaders();
  res.write('retry: 3000\n\n');
  const c = { res, user: req.user, sessionId: req.user.session_id };
  clients.add(c);
  send(c, 'hello', { at: Date.now() });
  req.on('close', () => clients.delete(c));
}

// Keep connections open through proxies, and drop expired or ended sessions once a minute.
let tick = 0;
setInterval(() => {
  for (const c of clients) { try { c.res.write(': ping\n\n'); } catch { /* closed */ } }
  if (++tick % 2 === 0) checkSessions().catch(() => {});
}, 30000).unref();

module.exports = { listen, publish, stream, clientCount: () => clients.size };
