require('dotenv').config({ quiet: true });
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { loadUser, requireAuth } = require('./auth/session');
const realtime = require('./realtime');
const { parseTrustProxy } = require('./lib/proxy');
const { checkDbRole } = require('./db-role');
const guard = require('./lib/guard');
const { cleanSessions } = require('./auth/session');

const app = express();
// Only the configured proxy (Nginx) may say what the client IP is. See src/lib/proxy.js.
// req.ip is then the real client address; the rate limiter, audit log and sessions all use req.ip.
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', trustProxy);
app.disable('x-powered-by');
app.use(guard.headers);
app.use('/api', guard.sameOrigin);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/api/health', async (_req, res) => {
  try {
    await db.raw('select 1');
    res.json({ ok: true, database: 'connected' });
  } catch (e) {
    console.error('Health check:', e.message); // details only in the server log, never to the public
    res.status(500).json({ ok: false, database: 'not connected' });
  }
});

app.use('/api', loadUser);
// Parents' mobile app: its own sign-in (SMS code + token) and its own limits (many parents share one mobile address).
app.use('/api/parent', require('./routes/parent').router);
app.use('/api', guard.apiLimit);
app.get('/api/events', requireAuth, realtime.stream); // live updates (see src/realtime.js)
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/me', require('./routes/me'));
app.use('/api/users', require('./routes/users'));
app.use('/api/schools', require('./routes/schools'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/items', require('./routes/items'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/receipts', require('./routes/receipts'));
app.use('/api/students', require('./routes/students'));
app.use('/api/interviews', require('./routes/interviews'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/stock', require('./routes/stock'));
app.use('/api/requests', require('./routes/requests'));
app.use('/api/damage', require('./routes/damage'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/bills', require('./routes/bills'));
app.use('/api/money', require('./routes/money'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/store', require('./routes/store'));
app.use('/api/purchases', require('./routes/purchases'));
app.use('/api/suppliers', require('./routes/suppliers'));
app.use('/api/lpos', require('./routes/lpos'));
app.use('/api/contracts', require('./routes/contracts'));
app.use('/api/vehicles', require('./routes/vehicles'));
app.use('/api/counts', require('./routes/counts'));
app.use('/api/idcards', require('./routes/idcards'));
app.use('/api/requisitions', require('./routes/requisitions'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/help', require('./routes/help'));
app.use('/api/store-books', require('./routes/storebooks'));
app.use('/api/parent-requests', require('./routes/parent-requests'));
app.use('/api/verify', require('./routes/verify'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Errors: known ones go to the user, unknown ones are logged.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message, ...(err.extra || {}) });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  // Values the database cannot read (letters where a number belongs, a number too big, a broken date or character)
  // and objects sent where text belongs: a wrong request, not a server fault.
  if (['22P02', '22003', '22007', '22008', '22021', '2201W', '2201X'].includes(err.code)
    || (err instanceof TypeError && /Cannot convert object to primitive value/.test(err.message)))
    return res.status(400).json({ error: 'Bad request. Check what you typed and try again.' });
  // A table or column the code needs is missing: the database was not updated after pulling new code.
  if (err.code === '42P01' || err.code === '42703') {
    console.error(`Database not up to date: ${err.message}. Run "npm run migrate" (and db/provision-roles.sql), then restart.`);
    return res.status(503).json({ error: 'The database is not up to date. In the backend folder run "npm run migrate", then run db/provision-roles.sql again and restart the server.' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

// Warn at start when the database is behind the code (migrations not run).
async function checkTables() {
  const need = ['receipts', 'students', 'deliveries', 'bills', 'money_checks', 'alerts_sent', 'issues', 'purchases', 'stock_counts', 'id_cards', 'requisitions', 'parents'];
  try {
    const { rows } = await db.raw(`SELECT t FROM unnest(?::text[]) t WHERE to_regclass('public.' || t) IS NULL`, [need]);
    if (rows.length) console.error(`\n*** DATABASE NOT UP TO DATE: missing ${rows.map((r) => r.t).join(', ')}. In backend run "npm run migrate", then db/provision-roles.sql, then restart. ***\n`);
  } catch { /* the health check will show the connection problem */ }
}

// Start the server. Both start files (src/server.js and backend/server.js) come here.
async function start(defaultPort = 3001) {
  guard.checkConfig();  // refuses unsafe settings in production (see src/lib/guard.js)
  await checkTables();
  await checkDbRole(); // refuses a PostgreSQL superuser in production (see src/db-role.js)
  realtime.listen();
  // Receipts paid but not given for too long: alert once each (see routes/receipts.js).
  const late = () => require('./routes/receipts').alertLate().catch((e) => console.error('Late receipts check:', e.message));
  setTimeout(late, 10000).unref();
  setInterval(late, 5 * 60 * 1000).unref();
  // Reminders for work waiting too long (see src/lib/reminders.js), and old sessions removed.
  const remind = () => require('./lib/reminders').run().catch((e) => console.error('Reminders:', e.message));
  setTimeout(remind, 20000).unref();
  setInterval(remind, 15 * 60 * 1000).unref();
  setInterval(() => cleanSessions().catch((e) => console.error('Session cleanup:', e.message)), 60 * 60 * 1000).unref();
  const port = Number(process.env.PORT) || defaultPort;
  console.log(`Trusted proxy for client IP: ${trustProxy === false ? 'none' : trustProxy.join(', ')}`);
  const server = app.listen(port, () => console.log(`Musabe API running on http://localhost:${port}`));
  // Node closes idle keep-alive sockets after 5 s. A proxy (Vite, Nginx) that reuses such a socket gets
  // ECONNRESET. Keep them open longer than any proxy's idle timeout.
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  // Stop cleanly (node --watch restart, PM2, Ctrl+C): end the live connections so browsers reconnect
  // quietly, and free the port before the new process starts.
  // Requests in progress finish first (up to 4 s); idle keep-alive sockets close at once.
  let stopping = false;
  const stop = () => {
    if (stopping) return; stopping = true;
    realtime.closeAll();
    server.close(() => process.exit(0));
    // A keep-alive socket becomes idle when its request ends: keep closing them so the exit is quick.
    server.closeIdleConnections();
    setInterval(() => server.closeIdleConnections(), 50).unref();
    setTimeout(() => process.exit(0), 4000).unref();
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  // Windows has no real SIGTERM (it kills at once), so the dev runner (backend/dev.js) asks by message.
  process.on('message', (m) => { if (m === 'shutdown') stop(); });
  // One bad request must not take the whole API down.
  process.on('unhandledRejection', (e) => console.error('Unhandled rejection:', e));
  // If the API does die, the reason and the time must be in the log (it used to vanish with a bare ECONNRESET in Vite).
  process.on('uncaughtException', (e) => { console.error(`\n*** API CRASHED ${new Date().toLocaleTimeString()} ***\n`, e); process.exit(1); });
  return server;
}

if (require.main === module) {
  start().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = app;
module.exports.start = start;
