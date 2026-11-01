import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { connect } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fontsCss = resolve(root, "src/web/src/fonts.generated.css");
// API port: 8787 unless API_PORT is set. vite.config.ts reads the same variable
// for its /api proxy, so both servers follow it.
const apiPort = process.env.API_PORT || "8787";

const isWindows = process.platform === "win32";
const children = new Set();
let cleaningUp = false;

function terminateChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return;
  }

  if (isWindows) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
    });
    return;
  }

  child.kill("SIGTERM");
}

function terminateChildren() {
  for (const child of children) {
    terminateChild(child);
  }
}

function spawnNpm(args, { longRunning = false } = {}) {
  const child = spawn("npm", args, {
    stdio: "inherit",
    shell: isWindows,
  });

  children.add(child);
  child.on("exit", () => {
    children.delete(child);
  });

  if (!longRunning) {
    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("exit", (code, signal) => {
        if (code === 0) {
          resolve();
          return;
        }

        reject(
          new Error(
            `npm ${args.join(" ")} exited with code ${code ?? "null"}${
              signal ? ` (signal: ${signal})` : ""
            }`,
          ),
        );
      });
    });
  }

  child.on("error", (error) => {
    console.error(error);
    void cleanup(1);
  });

  child.on("exit", (code) => {
    if (!cleaningUp) {
      void cleanup(code ?? 0);
    }
  });

  return child;
}

async function cleanup(exitCode = 0) {
  if (cleaningUp) {
    return;
  }

  cleaningUp = true;
  terminateChildren();

  process.exit(exitCode);
}

process.on("SIGINT", () => {
  void cleanup(0);
});

process.on("SIGTERM", () => {
  void cleanup(0);
});

process.on("exit", () => {
  terminateChildren();
});

// Fresh clone: the web app imports fonts.generated.css, which is not committed.
if (!existsSync(fontsCss)) {
  console.log("fonts.generated.css is missing: downloading fonts (once)...");
  const fonts = spawnSync(process.execPath, [resolve(root, "scripts/download-fonts.mjs")], {
    stdio: "inherit",
  });
  if (fonts.status !== 0) {
    console.error("Font download failed. Check your network, then run: make fonts");
    process.exit(fonts.status ?? 1);
  }
}

// The API needs APP_BASE_URL, SENDER_NAME and JWT_SECRET from src/server/.dev.vars (git-ignored).
// A fresh clone gets a copy of the example, which holds localhost values.
const devVars = resolve(root, "src/server/.dev.vars");
if (!existsSync(devVars)) {
  copyFileSync(resolve(root, "src/server/.dev.vars.example"), devVars);
  console.log("Created src/server/.dev.vars from .dev.vars.example (local values; edit it to add secrets).");
}

// Stop early, with a clear message, when the API port is taken (wrangler would fail later
// with a less clear error). Probes IPv4 and IPv6 loopback.
function portInUse(port) {
  const probe = (host) =>
    new Promise((resolveProbe) => {
      const socket = connect({ port: Number(port), host });
      socket.once("connect", () => {
        socket.destroy();
        resolveProbe(true);
      });
      socket.once("error", () => resolveProbe(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((r) => r.some(Boolean));
}
if (await portInUse(apiPort)) {
  console.error(
    `API port ${apiPort} is already in use. Stop the process using it, or pick another port: API_PORT=8788 make dev`,
  );
  process.exit(1);
}

await spawnNpm(["run", "db:migrate:local"]);
// If either server exits (for example, port already in use), the exit handler
// in spawnNpm stops the other one and this script exits with the same code.
spawnNpm(["run", "dev:web"], { longRunning: true });
spawnNpm(["-w", "@smriti/server", "run", "dev", "--", "--port", apiPort], {
  longRunning: true,
});
