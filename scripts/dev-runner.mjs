import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

const VITE_URL = 'http://127.0.0.1:5173';
const MAIN_ENTRY = path.resolve('dist-electron/main/main.js');
const ELECTRON_BIN = path.resolve(
  process.platform === 'win32'
    ? 'node_modules/.bin/electron.cmd'
    : 'node_modules/.bin/electron'
);

function waitForVite(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const req = http.get(VITE_URL, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for Vite dev server at ${VITE_URL}`));
          return;
        }
        setTimeout(check, 250);
      });
    };
    check();
  });
}

function waitForMainBuild(timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (fs.existsSync(MAIN_ENTRY)) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`Timed out waiting for ${MAIN_ENTRY}`));
        return;
      }
      setTimeout(check, 250);
    };
    check();
  });
}

let child = null;
let restartTimer = null;
let shuttingDown = false;

function startElectron() {
  if (shuttingDown) return;
  const env = { ...process.env, VITE_DEV_SERVER_URL: VITE_URL };
  child = spawn(ELECTRON_BIN, ['.'], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env,
  });
  child.on('exit', () => {
    child = null;
  });
}

function restartElectron() {
  if (shuttingDown) return;
  if (restartTimer) clearTimeout(restartTimer);
  restartTimer = setTimeout(() => {
    if (child) {
      const prev = child;
      child = null;
      prev.once('exit', () => startElectron());
      prev.kill();
    } else {
      startElectron();
    }
  }, 300);
}

async function main() {
  await Promise.all([waitForVite(), waitForMainBuild()]);
  startElectron();

  const mainDir = path.dirname(MAIN_ENTRY);
  fs.watch(mainDir, { recursive: true }, (_eventType, filename) => {
    if (filename && filename.endsWith('.js')) {
      restartElectron();
    }
  });
}

function shutdown() {
  shuttingDown = true;
  if (child) {
    child.kill();
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

main().catch((err) => {
  console.error('[dev-runner]', err);
  process.exit(1);
});
