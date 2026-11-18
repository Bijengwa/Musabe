// Development runner: "npm run dev". Replaces "node --watch", which on Windows
// - restarts on file events that are not real edits (a program only opening or scanning a file), and
// - kills the API at once, so a request in progress (e.g. a sign-in) dies with ECONNRESET in the Vite proxy.
// This runner restarts only when the CONTENT of a file changed, lets requests in progress finish first,
// prints which file caused the restart, and starts the API again if it crashes.
const { fork } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const ENTRY = path.join(ROOT, 'src', 'server.js');
const WATCH_DIRS = ['src'];
const WATCH_FILES = ['.env', 'knexfile.js', 'server.js'];
const EXT = /\.(js|cjs|mjs|json)$/;

const time = () => new Date().toLocaleTimeString();
const log = (m) => console.log(`[dev ${time()}] ${m}`);
const hashOf = (file) => { try { return crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex'); } catch { return null; } };

const hashes = new Map();
function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p); else if (EXT.test(e.name)) hashes.set(p, hashOf(p));
  }
}
for (const d of WATCH_DIRS) walk(path.join(ROOT, d));
for (const f of WATCH_FILES) hashes.set(path.join(ROOT, f), hashOf(path.join(ROOT, f)));

let child = null, restarting = false, again = false, quitting = false, crashes = 0;

function start() {
  const startedAt = Date.now();
  child = fork(ENTRY, { cwd: ROOT, stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    child = null;
    if (quitting) return process.exit(0);
    if (restarting) { restarting = false; return start(); }
    // Not asked to stop: it crashed. Say so, and start it again (slower each time if it keeps crashing).
    crashes = Date.now() - startedAt > 30000 ? 1 : crashes + 1;
    const wait = Math.min(1000 * crashes, 10000);
    log(`API STOPPED BY ITSELF (code ${code}${signal ? `, ${signal}` : ''}). The error is printed above. Starting again in ${wait / 1000}s.`);
    setTimeout(() => { if (!child && !quitting) start(); }, wait);
  });
}

// Ask the API to finish what it is doing and exit (see "shutdown" in src/server.js). Force after 5 s.
function stopChild() {
  if (!child) return;
  const c = child;
  try { c.send('shutdown'); } catch { c.kill(); }
  setTimeout(() => { if (child === c) c.kill(); }, 5000).unref();
}

function restart(why) {
  log(`restart: ${why}`);
  if (restarting) { again = true; return; }
  if (!child) return; // waiting after a crash: the timer starts it with the new code
  restarting = true;
  stopChild();
}

// Many events come for one save; wait a moment, then check which files really changed.
const pending = new Set();
let timer = null;
function check() {
  timer = null;
  const changed = [];
  for (const p of pending) {
    const h = hashOf(p);
    if (h !== hashes.get(p)) { hashes.set(p, h); changed.push(path.relative(ROOT, p)); }
  }
  pending.clear();
  if (changed.length) restart(`${changed.join(', ')} changed`);
}
function touched(p) {
  if (!EXT.test(p) && !WATCH_FILES.includes(path.basename(p))) return;
  pending.add(p);
  clearTimeout(timer);
  timer = setTimeout(check, 250);
}

for (const d of WATCH_DIRS) {
  const dir = path.join(ROOT, d);
  fs.watch(dir, { recursive: true }, (_evt, name) => { if (name) touched(path.join(dir, String(name))); });
}
fs.watch(ROOT, (_evt, name) => { if (name && WATCH_FILES.includes(String(name))) touched(path.join(ROOT, String(name))); });

const quit = () => { if (quitting) process.exit(0); quitting = true; if (child) stopChild(); else process.exit(0); };
process.on('SIGINT', quit); process.on('SIGTERM', quit);
process.on('message', (m) => { if (m === 'quit') quit(); }); // when a script started this runner

log('watching src/ and .env (restarts only on real edits; requests in progress finish first)');
start();
