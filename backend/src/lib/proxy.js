// Which proxies may tell us the real client IP (through the X-Forwarded-For header).
//
// Express only believes X-Forwarded-For when the connection comes from a trusted proxy.
// If we trusted everyone, any client could write a fake IP in that header and so:
// - get around the login rate limit (it counts tries per IP), and
// - put a false IP in the audit log and the "devices" list.
//
// Set TRUST_PROXY in .env to match how the server is deployed:
//   (empty)               -> "loopback": Nginx runs on the same server (127.0.0.1 / ::1). Default.
//   10.0.0.5              -> Nginx is on another machine with this address (several: comma list).
//   10.0.0.0/24           -> a private network that holds only our proxies.
//   false                 -> no proxy at all; use the connection's own address.
// Not allowed: "true" / "*" (trusts every client) and hop counts like "1" or "2"
// (they trust whatever the client sent if the real number of proxies is different).
const net = require('net');

const NAMED = ['loopback', 'linklocal', 'uniquelocal'];

function validAddress(token) {
  if (NAMED.includes(token)) return true;
  const [ip, bits, extra] = token.split('/');
  if (extra !== undefined || !net.isIP(ip)) return false;
  if (bits === undefined) return true;
  const max = net.isIP(ip) === 4 ? 32 : 128;
  return /^\d{1,3}$/.test(bits) && Number(bits) <= max;
}

function parseTrustProxy(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return ['loopback'];
  const lower = raw.toLowerCase();
  if (['false', 'off', 'none', 'no'].includes(lower)) return false;
  if (['true', '*', 'all', 'yes'].includes(lower)) {
    throw new Error('TRUST_PROXY must name the proxy (e.g. loopback or 10.0.0.5), not "true". Trusting everyone lets clients fake their IP.');
  }
  if (/^\d+$/.test(lower)) {
    throw new Error('TRUST_PROXY must name the proxy (e.g. loopback or 10.0.0.5), not a hop count.');
  }
  const list = lower.split(',').map((t) => t.trim()).filter(Boolean);
  const bad = list.filter((t) => !validAddress(t));
  if (bad.length) throw new Error(`TRUST_PROXY has values that are not an IP address, a network (a.b.c.d/nn) or one of ${NAMED.join(', ')}: ${bad.join(', ')}`);
  return list;
}

module.exports = { parseTrustProxy };
