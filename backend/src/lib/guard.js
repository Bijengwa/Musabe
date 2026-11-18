// Request guards used by src/server.js (security checklist rows 5.2, 5.4–5.9, 8.2, 9.3).
const rateLimit = require('express-rate-limit').default || require('express-rate-limit');
const { HttpError } = require('./util');

const PROD = process.env.NODE_ENV === 'production';

// Allowed browser origins for changes (POST/PATCH/PUT/DELETE), e.g. APP_ORIGIN=https://musabe.example.com
// Several: comma separated. Locally (not production) any http://localhost:* is allowed.
const ORIGINS = String(process.env.APP_ORIGIN || '').split(',').map((s) => s.trim().replace(/\/$/, '')).filter(Boolean);

// Cross-site request forgery: a change must come from our own pages. Browsers send Origin (and Sec-Fetch-Site)
// with every POST; a form on another site therefore fails here even if SameSite were missing.
function sameOrigin(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (req.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Request refused (another website).');
  const origin = req.get('origin');
  if (!origin) return next(); // not a browser (tests, scripts): the session cookie is still required
  const o = origin.replace(/\/$/, '');
  // Production: only the addresses in APP_ORIGIN. Elsewhere also the address the request came to (and localhost).
  // X-Forwarded-Host is never believed here: anyone who reaches Node directly could write it.
  const host = req.get('host');
  const ok = ORIGINS.includes(o)
    || (!PROD && ((host && (o === `https://${host}` || o === `http://${host}`)) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o)));
  if (!ok) throw new HttpError(403, 'Request refused (wrong website address).');
  next();
}

// Security headers for every API reply. The page itself (index.html) gets its headers from Nginx: see docs/deployment.md.
function headers(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Cache-Control': 'no-store',
  });
  if (PROD || process.env.COOKIE_SECURE === 'true') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// General limit for the whole API: per signed-in person (or per address before sign-in).
const apiLimit = rateLimit({
  windowMs: 60 * 1000, limit: Number(process.env.API_RATE_LIMIT) || 600, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `u${req.user.id}` : `ip${req.ip}`),
  skip: (req) => req.path === '/events' || req.path === '/health',
  message: { error: 'Too many requests. Wait a minute and try again.' },
  validate: { keyGeneratorIpFallback: false },
});

// Excel uploads: at most 20 per person every 10 minutes.
const uploadLimit = rateLimit({
  windowMs: 10 * 60 * 1000, limit: Number(process.env.UPLOAD_RATE_LIMIT) || 20, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => `u${req.user?.id || req.ip}`,
  message: { error: 'Too many uploads. Wait 10 minutes and try again.' },
  validate: { keyGeneratorIpFallback: false },
});

// Settings that must be right before the system runs on the real server. Problems stop the start in production.
function checkConfig() {
  const problems = [], warnings = [];
  if (PROD) {
    if (!ORIGINS.length) problems.push('APP_ORIGIN is not set (the https address of the system, e.g. https://musabe.example.com).');
    if (ORIGINS.some((o) => !o.startsWith('https://'))) problems.push('APP_ORIGIN must start with https://');
    if (!process.env.TRUST_PROXY) warnings.push('TRUST_PROXY is not set: client addresses will be the proxy address. Set it to the Nginx address (e.g. 127.0.0.1).');
    if (!process.env.SEAL_SECRET) warnings.push('SEAL_SECRET is not set: seals on signed papers use a weak default. Set a long random text once and never change it.');
    if (process.env.SUPERADMIN_PASSWORD) warnings.push('SUPERADMIN_PASSWORD is still in .env. Remove it after the first sign-in.');
    if (process.env.DATABASE_HOST && !['localhost', '127.0.0.1'].includes(process.env.DATABASE_HOST) && process.env.DATABASE_SSL !== 'true')
      problems.push('The database is on another machine but DATABASE_SSL is not true.');
  }
  for (const w of warnings) console.warn(`Config warning: ${w}`);
  if (problems.length) throw new Error(`Cannot start: ${problems.join(' ')}`);
}

module.exports = { sameOrigin, headers, apiLimit, uploadLimit, checkConfig, ORIGINS };
