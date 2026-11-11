// Kept so "node server.js" still works. The real code is in src/server.js.
const app = require('./src/server');
const port = Number(process.env.PORT) || 4310;
app.listen(port, () => console.log(`Musabe API running on http://localhost:${port}`));
