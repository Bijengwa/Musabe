// One command starts both servers: `npm run dev` in this folder.
// The backend is restarted if it crashes, so the frontend never sits with "ECONNREFUSED".
const { spawn } = require('child_process');
const path = require('path');

function run(name, dir, args, restart) {
  const start = () => {
    const p = spawn('npm', args, { cwd: path.join(__dirname, dir), stdio: 'inherit', shell: true });
    p.on('exit', (code) => {
      if (restart && code !== 0 && !stopping) { console.log(`[${name}] stopped (code ${code}), restarting in 2 s...`); setTimeout(start, 2000); }
    });
    children.push(p);
  };
  start();
}
const children = [];
let stopping = false;
process.on('SIGINT', () => { stopping = true; children.forEach((c) => c.kill()); process.exit(0); });

run('backend', 'backend', ['run', 'dev'], true);
run('frontend', 'frontend', ['run', 'dev'], false);
