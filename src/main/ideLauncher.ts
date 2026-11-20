import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ActionResult } from '../shared/types.js';

export interface LaunchDeps {
  executable?: string;
  spawnFn?: typeof spawn;
}

export function resolveAntigravityIdeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const candidates = [
      path.join(localAppData, 'Programs', 'Antigravity IDE', 'Antigravity IDE.exe'),
      path.join(programFiles, 'Antigravity IDE', 'Antigravity IDE.exe'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return 'antigravity-ide';
  }
  return 'antigravity-ide';
}

export function resolveAntigravityAppExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform
): string | null {
  if (platform === 'win32') {
    const localAppData = env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const programFiles = env.ProgramFiles ?? 'C:\\Program Files';
    const candidates = [
      path.join(localAppData, 'Programs', 'antigravity', 'Antigravity.exe'),
      path.join(programFiles, 'Antigravity', 'Antigravity.exe'),
    ];
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return null;
  }
  if (platform === 'darwin') {
    const appBin = '/Applications/Antigravity.app/Contents/MacOS/Antigravity';
    return fs.existsSync(appBin) ? appBin : null;
  }
  return 'antigravity';
}

function spawnDetached(
  executable: string,
  args: string[],
  label: string,
  spawnImpl: typeof spawn = spawn
): Promise<ActionResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ActionResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    try {
      const child = spawnImpl(executable, args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: false,
      });

      const timer = setTimeout(() => {
        child.unref();
        finish({ ok: true });
      }, 200);

      child.once('error', (err) => {
        clearTimeout(timer);
        finish({
          ok: false,
          error: `Failed to launch ${label} (${path.basename(executable)}): ${err.message}`,
        });
      });
    } catch (err) {
      finish({
        ok: false,
        error: `Failed to launch ${label}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  });
}

export function launchAntigravityIde(
  workspacePath: string,
  deps: LaunchDeps = {}
): Promise<ActionResult> {
  if (!workspacePath || !fs.existsSync(workspacePath)) {
    return Promise.resolve({
      ok: false,
      error: workspacePath
        ? `Workspace path does not exist: ${workspacePath}`
        : 'No workspace folder attached to this session',
    });
  }

  const executable = deps.executable ?? resolveAntigravityIdeExecutable();
  return spawnDetached(executable, [workspacePath], 'Antigravity IDE', deps.spawnFn);
}

export function launchAntigravityApp(deps: LaunchDeps = {}): Promise<ActionResult> {
  const executable = deps.executable ?? resolveAntigravityAppExecutable();
  if (!executable) {
    return Promise.resolve({
      ok: false,
      error: 'Antigravity desktop app executable not found',
    });
  }
  return spawnDetached(executable, [], 'Antigravity', deps.spawnFn);
}
