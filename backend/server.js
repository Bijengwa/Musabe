// Kept so "node server.js" still works. The real code is in src/server.js.
const app = require('./src/server');

app.start(4310).catch((e) => { console.error(e.message); process.exit(1); });
