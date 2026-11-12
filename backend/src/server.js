require('dotenv').config({ quiet: true });
const express = require('express');
const cookieParser = require('cookie-parser');
const db = require('./db');
const { loadUser, requireAuth } = require('./auth/session');
const realtime = require('./realtime');
const { parseTrustProxy } = require('./lib/proxy');
const { checkDbRole } = require('./db-role');

const app = express();
// Only the configured proxy (Nginx) may say what the client IP is. See src/lib/proxy.js.
// req.ip is then the real client address; the rate limiter, audit log and sessions all use req.ip.
const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);
app.set('trust proxy', trustProxy);
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
  next();
});

app.get('/api/health', async (_req, res) => {
  try {
    await db.raw('select 1');
    res.json({ ok: true, database: 'connected' });
  } catch (e) {
    res.status(500).json({ ok: false, database: 'not connected', error: e.message });
  }
});

app.use('/api', loadUser);
app.get('/api/events', requireAuth, realtime.stream); // live updates (see src/realtime.js)
app.use('/api/auth', require('./routes/auth').router);
app.use('/api/me', require('./routes/me'));
app.use('/api/users', require('./routes/users'));
app.use('/api/schools', require('./routes/schools'));
app.use('/api/audit', require('./routes/audit'));
app.use('/api/items', require('./routes/items'));
app.use('/api/notifications', require('./routes/notifications'));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found.' }));

// Errors: known ones go to the user, unknown ones are logged.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Bad request.' });
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server. Try again.' });
});

// Start the server. Both start files (src/server.js and backend/server.js) come here.
async function start(defaultPort = 3001) {
  await checkDbRole(); // refuses a PostgreSQL superuser in production (see src/db-role.js)
  realtime.listen();
  const port = Number(process.env.PORT) || defaultPort;
  console.log(`Trusted proxy for client IP: ${trustProxy === false ? 'none' : trustProxy.join(', ')}`);
  return app.listen(port, () => console.log(`Musabe API running on http://localhost:${port}`));
}

if (require.main === module) {
  start().catch((e) => { console.error(e.message); process.exit(1); });
}

module.exports = app;
module.exports.start = start;
