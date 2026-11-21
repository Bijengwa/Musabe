module.exports = {
  apps: [{
    name: 'musabe-api',
    script: './backend/src/server.js',
    cwd: __dirname,
    instances: 'max',
    exec_mode: 'cluster',
    autorestart: true,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 4310,
    },
  }],
};
