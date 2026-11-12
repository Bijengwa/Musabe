// Small helpers for the HTTP tests. No extra packages: Node's own http and test runner.
const http = require('http');
const os = require('os');

// An IPv4 address of this machine that is NOT loopback, to act as a "public" client.
// Returns null if the machine has none (the tests that need it are then skipped).
function publicLikeAddress() {
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) return a.address;
  }
  return null;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '0.0.0.0', () => resolve({ server, port: server.address().port }));
  });
}

// Send a request. `from` = local address to connect from (127.0.0.1 = through Nginx on the same server).
function request({ port, host = '127.0.0.1', from, method = 'GET', path, headers = {}, body, cookie }) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null : JSON.stringify(body);
    const req = http.request({
      host, port, method, path, localAddress: from || undefined,
      headers: { ...(data ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } : {}),
        ...(cookie ? { Cookie: cookie } : {}), ...headers },
    }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(text); } catch { /* not json */ }
        resolve({ status: res.statusCode, headers: res.headers, json });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

module.exports = { publicLikeAddress, listen, request };
