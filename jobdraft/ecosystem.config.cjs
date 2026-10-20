// pm2 processes for JobDraft (separate from Tradenaya's "tradenaya" process).
// Build first:  npm run build   then:  pm2 start ecosystem.config.cjs
const path = require("node:path");

module.exports = {
  apps: [
    {
      name: "jobdraft-server",
      cwd: path.join(__dirname, "server"),
      script: "dist/index.js",
      // One instance: the scheduler runs inside the server process. (Running
      // more is safe — slots are claimed in the DB — but not needed.)
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      kill_timeout: 10000,
      time: true,
    },
    {
      name: "jobdraft-client",
      cwd: path.join(__dirname, "client"),
      script: "node_modules/next/dist/bin/next",
      args: "start --port 3055",
      instances: 1,
      exec_mode: "fork",
      env: { NODE_ENV: "production" },
      max_memory_restart: "400M",
      time: true,
    },
  ],
};
