import fs from 'node:fs';
import path from 'node:path';
import { app, nativeImage, type NativeImage } from 'electron';

function getAssetsDir(): string {
  return path.join(app.getAppPath(), 'assets');
}

export function getAppIconPath(): string {
  const assetsDir = getAssetsDir();
  if (process.platform === 'win32') {
    const ico = path.join(assetsDir, 'icon.ico');
    if (fs.existsSync(ico)) return ico;
  }
  return path.join(assetsDir, 'icon.png');
}

export function createAppIcon(): NativeImage {
  return nativeImage.createFromPath(getAppIconPath());
}

export function createTrayIcon(
  hasActiveRuns: boolean,
  hasWaitingInput: boolean,
  hasOverdueInput = false
): NativeImage {
  const fileName = hasOverdueInput
    ? 'tray-overdue.png'
    : hasWaitingInput
      ? 'tray-waiting.png'
      : hasActiveRuns
        ? 'tray-running.png'
        : 'tray-idle.png';

  const iconPath = path.join(getAssetsDir(), fileName);
  if (fs.existsSync(iconPath)) {
    const img = nativeImage.createFromPath(iconPath);
    if (!img.isEmpty()) return img;
  }
  return createAppIcon();
}
