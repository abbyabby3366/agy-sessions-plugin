import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  launchAntigravityApp,
  launchAntigravityIde,
  resolveAntigravityAppExecutable,
  resolveAntigravityIdeExecutable,
} from '../dist-electron/main/ideLauncher.js';

describe('ideLauncher', () => {
  it('resolves Antigravity IDE and App executables cleanly on Windows', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ide-bin-'));
    try {
      const ideDir = path.join(tmp, 'Programs', 'Antigravity IDE');
      const appDir = path.join(tmp, 'Programs', 'antigravity');
      fs.mkdirSync(ideDir, { recursive: true });
      fs.mkdirSync(appDir, { recursive: true });
      const ideExe = path.join(ideDir, 'Antigravity IDE.exe');
      const appExe = path.join(appDir, 'Antigravity.exe');
      fs.writeFileSync(ideExe, '');
      fs.writeFileSync(appExe, '');

      assert.equal(resolveAntigravityIdeExecutable({ LOCALAPPDATA: tmp }, 'win32'), ideExe);
      assert.equal(resolveAntigravityAppExecutable({ LOCALAPPDATA: tmp }, 'win32'), appExe);

      const missingEnv = {
        LOCALAPPDATA: path.join(tmp, 'nonexistent'),
        ProgramFiles: path.join(tmp, 'none2'),
      };
      assert.equal(resolveAntigravityIdeExecutable(missingEnv, 'win32'), 'antigravity-ide');
      assert.equal(resolveAntigravityAppExecutable(missingEnv, 'win32'), null);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('rejects missing or non-existent workspace paths loudly', async () => {
    const emptyRes = await launchAntigravityIde('');
    assert.equal(emptyRes.ok, false);
    assert.match(emptyRes.error ?? '', /No workspace folder/i);

    const missingPath = path.join(os.tmpdir(), 'agy-does-not-exist-99999');
    const missingRes = await launchAntigravityIde(missingPath);
    assert.equal(missingRes.ok, false);
    assert.match(missingRes.error ?? '', /does not exist/i);
  });

  it('spawns Antigravity IDE and App detached and surfaces spawn errors explicitly', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agy-ws-'));
    try {
      const calls = [];
      const fakeSpawn = (cmd, args) => {
        calls.push({ cmd, args });
        const ee = new EventEmitter();
        ee.unref = () => {};
        return ee;
      };

      const ideOk = await launchAntigravityIde(tmp, {
        executable: 'C:\\Fake\\Antigravity IDE.exe',
        spawnFn: fakeSpawn,
      });
      const appOk = await launchAntigravityApp({
        executable: 'C:\\Fake\\Antigravity.exe',
        spawnFn: fakeSpawn,
      });
      assert.equal(ideOk.ok, true);
      assert.equal(appOk.ok, true);
      assert.deepEqual(calls, [
        { cmd: 'C:\\Fake\\Antigravity IDE.exe', args: [tmp] },
        { cmd: 'C:\\Fake\\Antigravity.exe', args: [] },
      ]);

      const errSpawn = () => {
        const ee = new EventEmitter();
        ee.unref = () => {};
        setTimeout(() => ee.emit('error', new Error('ENOENT')), 10);
        return ee;
      };
      const failIde = await launchAntigravityIde(tmp, {
        executable: 'C:\\Fake\\missing-ide.exe',
        spawnFn: errSpawn,
      });
      const failApp = await launchAntigravityApp({
        executable: 'C:\\Fake\\missing-app.exe',
        spawnFn: errSpawn,
      });
      assert.equal(failIde.ok, false);
      assert.match(failIde.error ?? '', /ENOENT/);
      assert.equal(failApp.ok, false);
      assert.match(failApp.error ?? '', /ENOENT/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
