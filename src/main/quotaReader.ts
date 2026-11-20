import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { ModelPoolQuota, QuotaState } from '../shared/types.js';

interface RawUsageBucket {
  id?: unknown;
  window?: unknown;
  remaining_fraction?: unknown;
  reset_time?: unknown;
}

interface RawUsageGroup {
  name?: unknown;
  buckets?: unknown;
}

interface RawUsagePayload {
  status?: unknown;
  command?: {
    name?: unknown;
    data?: {
      groups?: unknown;
    };
  };
}

function toPct(fraction: unknown, label: string): number {
  if (typeof fraction !== 'number' || !Number.isFinite(fraction) || fraction < 0 || fraction > 1) {
    throw new Error(`Invalid remaining_fraction for ${label}`);
  }
  return Math.round(fraction * 100);
}

function parseGroupPool(
  groups: RawUsageGroup[],
  bucketIdPrefix: 'gemini' | '3p',
  groupPattern: RegExp,
  label: string
): ModelPoolQuota {
  const weeklyId = `${bucketIdPrefix}-weekly`;
  const fiveHourId = `${bucketIdPrefix}-5h`;

  const group =
    groups.find((g) => {
      if (!Array.isArray(g.buckets)) return false;
      return g.buckets.some((b) => (b as RawUsageBucket)?.id === weeklyId);
    }) ??
    groups.find((g) => typeof g.name === 'string' && groupPattern.test(g.name));

  if (!group || !Array.isArray(group.buckets)) {
    throw new Error(`Missing quota group for ${label}`);
  }

  const buckets = group.buckets as RawUsageBucket[];
  const weeklyBucket =
    buckets.find((b) => b.id === weeklyId) ?? buckets.find((b) => b.window === 'weekly');

  if (!weeklyBucket) {
    throw new Error(`Missing weekly quota bucket for ${label}`);
  }

  const fiveHourBucket =
    buckets.find((b) => b.id === fiveHourId) ?? buckets.find((b) => b.window === '5h');

  let fiveHourRemainingPct: number | null = null;
  let fiveHourResetAt: string | null = null;
  if (fiveHourBucket && typeof fiveHourBucket.remaining_fraction === 'number') {
    fiveHourRemainingPct = toPct(fiveHourBucket.remaining_fraction, `${label} 5h`);
    fiveHourResetAt =
      typeof fiveHourBucket.reset_time === 'string' ? fiveHourBucket.reset_time : null;
  }

  return {
    weeklyRemainingPct: toPct(weeklyBucket.remaining_fraction, `${label} weekly`),
    weeklyResetAt: typeof weeklyBucket.reset_time === 'string' ? weeklyBucket.reset_time : null,
    fiveHourRemainingPct,
    fiveHourResetAt,
  };
}

export function parseAgyUsageJson(rawStdout: string, nowMs = Date.now()): QuotaState {
  const fetchedAt = new Date(nowMs).toISOString();
  const trimmed = rawStdout.trim();
  if (!trimmed) {
    return { status: 'error', error: 'agy /usage returned empty output', fetchedAt };
  }

  let parsed: RawUsagePayload;
  try {
    parsed = JSON.parse(trimmed) as RawUsagePayload;
  } catch (err) {
    return {
      status: 'error',
      error: `Invalid /usage JSON: ${err instanceof Error ? err.message : String(err)}`,
      fetchedAt,
    };
  }

  if (parsed.status !== 'SUCCESS' || parsed.command?.name !== 'usage') {
    return {
      status: 'error',
      error: `agy /usage returned status ${String(parsed.status)}`,
      fetchedAt,
    };
  }

  const groups = parsed.command?.data?.groups;
  if (!Array.isArray(groups)) {
    return {
      status: 'error',
      error: 'agy /usage response is missing model groups',
      fetchedAt,
    };
  }

  try {
    const gemini = parseGroupPool(groups as RawUsageGroup[], 'gemini', /gemini/i, 'Gemini');
    const thirdParty = parseGroupPool(
      groups as RawUsageGroup[],
      '3p',
      /claude|gpt/i,
      'Claude and GPT'
    );
    return {
      status: 'ok',
      fetchedAt,
      gemini,
      thirdParty,
    };
  } catch (err) {
    return {
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
      fetchedAt,
    };
  }
}

export function resolveAgyExecutable(): string {
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const installedPath = path.join(localAppData, 'agy', 'bin', 'agy.exe');
    if (fs.existsSync(installedPath)) {
      return installedPath;
    }
    return 'agy.exe';
  }
  return 'agy';
}

export function fetchModelQuota(): Promise<QuotaState> {
  const bin = resolveAgyExecutable();
  const nullLogPath = process.platform === 'win32' ? 'NUL' : '/dev/null';
  const args = ['--log-file', nullLogPath, '-p', '/usage', '--output-format', 'json'];

  return new Promise((resolve) => {
    execFile(
      bin,
      args,
      {
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      },
      (err, stdout, stderr) => {
        if (err) {
          const detail = stderr?.trim() || err.message;
          resolve({
            status: 'error',
            error: `Failed to run ${path.basename(bin)} /usage: ${detail}`,
            fetchedAt: new Date().toISOString(),
          });
          return;
        }
        resolve(parseAgyUsageJson(stdout));
      }
    );
  });
}
